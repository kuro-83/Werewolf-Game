// =============================================
// js/action.js
// 投票・夜アクション・GM操作・ゲーム進行処理
// =============================================

import { supabaseClient, GAME_TIMELINE, ROLES_INFO, DUMMY_QUESTIONS } from './config.js';
import {
    getMyPlayerName, getMyPlayerId, isMyPlayer, getMyRoleType, getMyRoleName,
    getCurrentPlayers, setCurrentPlayers,
    getLastKnownPhase,
    getHasActedTonight, setHasActedTonight,
    getResultShown, setResultShown,
    getHasVotedToday, setHasVotedToday,
    getIsCountingVotes, setIsCountingVotes,
    getVoteCountdownTimer, setVoteCountdownTimer,
    getHideVoteDetails, setHideVoteDetails,
    getCurrentTimelineIndex, setCurrentTimelineIndex,
    getPendingWinner, setPendingWinner,
    roleCounts, saveSession, clearSessionData,
    getDummyNightState, saveDummyNightState,
    loginView, gameView, gmPanel, gmNameDisplay, nameInput
} from './state.js';
import {
    updatePhaseDisplay, renderPlayerList, renderMemoList,
    showVoteResult, updateVoteProgress, renderTimeline,
    updateGmTimelineButtons, initRoleCounters,
    updateWolfChatButtonVisibility, updateHideVoteDetailsUI,
    receiveChatMessage, receiveMissionUpdate,
    getNightChoices, renderNightDone
} from './ui.js';

// =============================================
// 投票処理
// =============================================
export async function submitVote(targetName, targetId) {
    if (getLastKnownPhase() !== 'voting') return;

    if (!confirm(`${targetName} さんに投票しますか？`)) return;
    if (getHasVotedToday()) return;

    setHasVotedToday(true);

    // 即座にすべての投票ボタンを無効化（二重押し・時間差投票を物理的にブロック）
    const buttons = document.querySelectorAll('#vote-target-list .target-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    });

    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ vote_target_id: targetId })
            .eq('id', getMyPlayerId());

        if (error) throw error;

        setHasVotedToday(true);
        document.getElementById('vote-select').classList.add('hidden');
        document.getElementById('vote-done').classList.remove('hidden');
    } catch (err) {
        console.error('投票エラー:', err);
        alert('投票に失敗しました。もう一度お試しください。');
    }
}

export function checkAllVoted() {
    if (getLastKnownPhase() !== 'voting') return;
    if (getIsCountingVotes()) return;

    const alivePlayers = getCurrentPlayers().filter(p => p.is_alive);
    const votedPlayers = alivePlayers.filter(p => p.vote_target_id);

    if (alivePlayers.length > 0 && votedPlayers.length >= alivePlayers.length) {
        console.log('[VOTE] 全員投票完了。集計開始。');
        countAndExile();
    }
}

export async function closeVoting() {
    if (getLastKnownPhase() !== 'voting') return;
    if (!confirm('投票を締め切り、その時点の票で集計しますか？（未投票は棄権扱い）')) return;
    // 即座に投票ボタンを無効化（未投票プレイヤーの後入り投票を防ぐ）
    disableVoteButtons();
    countAndExile();
}

export function disableVoteButtons() {
    // 投票ボタンを全て disabled に
    const buttons = document.querySelectorAll('#vote-target-list .target-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    });
    // または投票セレクトパネルを「締め切り中」表示に切り替え
    const selectPanel = document.getElementById('vote-select');
    if (selectPanel && !selectPanel.classList.contains('hidden')) {
        selectPanel.innerHTML = '<h2>🔒 締め切り中</h2><p style="color:#c0caf5;">GMが投票を締め切りました。<br>集計中...</p>';
    }
}

/**
 * 投票スキップ（誰も追放しない）
 * スキップ票は vote_target_id = null のままになる（棄権扱い）
 */
export async function submitVoteSkip() {
    if (getLastKnownPhase() !== 'voting') return;
    if (!confirm('今回の投票をスキップしますか？（追放なしに1票として集計されます）')) return;
    if (getHasVotedToday()) return;

    setHasVotedToday(true);

    // ボタンを無効化
    const buttons = document.querySelectorAll('#vote-target-list .target-btn, #btn-vote-skip');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    });

    try {
        // スキップ票: vote_target_id = '__skip__' のプレースホルダー値を使ってDBに書き込む
        // （nullのままだと未投票と区別できないため、小数点第1位の文字列IDを使用）
        // 注意: vote_target_idがUUID型の場合は'__skip__'を入れるとエラーになる。
        // その場合は別列skip_vote(boolean)を使うか、または単純に0000...0のnil UUIDを使用する。
        // ここでは「存在しないUUID = 00000000-0000-0000-0000-000000000000」をスキップ犰として扱う。
        const SKIP_SENTINEL = '00000000-0000-0000-0000-000000000000';
        const { error } = await supabaseClient
            .from('players')
            .update({ vote_target_id: SKIP_SENTINEL })
            .eq('id', getMyPlayerId());

        if (error) throw error;

        document.getElementById('vote-select').classList.add('hidden');
        const donePanel = document.getElementById('vote-done');
        donePanel.classList.remove('hidden');
        donePanel.querySelector('h2').textContent = '⏭️ スキップ';
        donePanel.querySelector('p').textContent = '追放なしに1票。他のプレイヤーを待っています…';
    } catch (err) {
        console.error('スキップ処理エラー:', err);
        // エラー時はフラグを戻す
        setHasVotedToday(false);
    }
}

export async function countAndExile() {
    if (getIsCountingVotes()) return;
    setIsCountingVotes(true);
    // 間に合わせない投票のボタンを無効化（プレイヤークライアント側）
    disableVoteButtons();

    // Supabaseから最新の投票情報を再取得
    let freshPlayers;
    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('id, name, is_alive, role, vote_target_id');
        if (error) throw error;
        freshPlayers = data;
        setCurrentPlayers(freshPlayers);
    } catch (err) {
        console.error('投票情報の取得エラー:', err);
        setIsCountingVotes(false);
        return;
    }

    const alivePlayers = freshPlayers.filter(p => p.is_alive);

    // id → name のマップ
    const idToName = {};
    freshPlayers.forEach(p => { idToName[p.id] = p.name; });

    // スキップのセンチネル値
    const SKIP_SENTINEL = '00000000-0000-0000-0000-000000000000';

    // スキップ票数を集計
    const skipCount = alivePlayers.filter(p => p.vote_target_id === SKIP_SENTINEL).length;

    // 票数集計（生存者への投票のみ有効。スキップセンチネルは除外）
    const aliveIds = new Set(alivePlayers.map(p => p.id));
    const voteCounts = {};
    alivePlayers.forEach(p => {
        const tid = p.vote_target_id;
        if (tid && tid !== SKIP_SENTINEL && aliveIds.has(tid)) {
            voteCounts[tid] = (voteCounts[tid] || 0) + 1;
        }
    });

    // 投票ログ作成（答え合わせ用）
    const voteLog = alivePlayers.map(p => ({
        voter: p.name,
        target: p.vote_target_id === SKIP_SENTINEL
            ? '「スキップ」'
            : (p.vote_target_id ? idToName[p.vote_target_id] : null)
    }));

    // スキップ票が最多か同数の場合は処刑なし
    const maxPlayerVotes = Object.keys(voteCounts).length > 0
        ? Math.max(...Object.values(voteCounts))
        : 0;

    if (skipCount > 0 && skipCount >= maxPlayerVotes) {
        // 処刑なしルート
        console.log(`[VOTE] スキップ票 ${skipCount}票が最多のため追放なし`);
        showVoteResult(null, voteLog);  // exiledName = null で処刑なしとして表示
        return;
    }

    // 最多票を特定（票なし・同数はランダム）
    let exiledId, exiledName;

    if (Object.keys(voteCounts).length === 0) {
        // 有効票が0票（全員スキップまたは棄権） → 処刑なし
        console.log('[VOTE] 有効票。0。追放なし。');
        showVoteResult(null, voteLog);
        return;
    } else {
        const maxVotes = Math.max(...Object.values(voteCounts));
        const topIds = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);
        const pickedId = topIds[Math.floor(Math.random() * topIds.length)];
        exiledId = pickedId;
        exiledName = idToName[pickedId];
    }

    console.log(`[VOTE] 追放: ${exiledName}`);

    const exiledPlayer = alivePlayers.find(p => p.id === exiledId);
    const isTeruteruExiled = exiledPlayer && exiledPlayer.role === 'てるてる';

    // 追放処理：is_alive を false に
    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ is_alive: false })
            .eq('id', exiledId);
        if (error) throw error;
    } catch (err) {
        console.error('追放エラー:', err);
        setIsCountingVotes(false);
        return;
    }

    // てるてるが追放された場合、即座にてるてるの単独勝利としてゲーム終了
    if (isTeruteruExiled) {
        console.log('[VOTE] てるてるが追放されたため、てるてる単独勝利！');
        await triggerGameEnd('teruteru');
        showVoteResult(exiledName, voteLog);
        return;
    }

    // GMは直接リザルトを表示（他クライアントは is_alive の Realtime イベントから呼ばれる）
    showVoteResult(exiledName, voteLog);
}

// =============================================
// 投票結果から夜フェーズへ遷移
// =============================================
export async function proceedToNight() {
    if (getVoteCountdownTimer()) {
        clearInterval(getVoteCountdownTimer());
        setVoteCountdownTimer(null);
    }

    // 投票結果オーバーレイを閉じる（全クライアント）
    document.getElementById('vote-result-overlay').classList.add('hidden');
    document.getElementById('vote-overlay').classList.add('hidden');

    // 全クライアント共通：投票日のフラグをリセット（2回目以降の投票対策）
    setHasVotedToday(false);

    if (getMyRoleType() !== 'gm') return; // GMのみ Supabase を更新

    // GMはタイムラインを1つ進める
    await advanceTimeline(1);
}

// =============================================
// 勝利判定
// =============================================
export function checkWinCondition() {
    if (getMyRoleType() !== 'gm') return;
    if (getLastKnownPhase() === 'waiting' || getLastKnownPhase() === 'result') return;
    if (getPendingWinner()) return; // すでに勝者が確定済みのため再トリガーしない

    const playersWithRole = getCurrentPlayers().filter(p => p.role);
    if (playersWithRole.length === 0) return;

    const alivePlayers = getCurrentPlayers().filter(p => p.is_alive);
    const aliveWolves = alivePlayers.filter(p => p.role === '人狼');
    const aliveOthers = alivePlayers.filter(p => p.role !== '人狼');

    if (aliveWolves.length === 0) {
        triggerGameEnd('citizen');
    } else if (aliveWolves.length >= aliveOthers.length) {
        triggerGameEnd('wolf');
    }
}

export async function triggerGameEnd(winner) {
    if (getPendingWinner()) return; // すでに勝者が確定済みのためスキップ

    setPendingWinner(winner);
    console.log(`[WIN] ${winner} wins! (GMが次へ進むまでリザルト画面は非表示)`);

    // current_phase は変えない。winner のみ書き込み、リザルト遷移は GM の操作に委ねる
    try {
        const { error } = await supabaseClient
            .from('game_status')
            .update({ winner: winner })
            .eq('id', 1);

        if (error) {
            console.warn('winner フィールドの書き込みに失敗しました:', error);
        }
    } catch (err) {
        console.error('ゲーム終了処理エラー:', err);
    }
}

// =============================================
// 夜フェーズ：全員共通の選択処理
// 役職がバレないよう、どの役職（ダミー質問を含む）も
// 「名前を選ぶ → 決定する → 確認 → 選択完了（選び直し可）」の同じ手順・同じ文言にする
// =============================================
// パネル種別ごとの選択中の相手 { id, name }
const nightSelections = {};

/**
 * 名前ボタンを並べ、タップで選択状態にして「決定する」ボタンを出す
 * @param {'wolf'|'seer'|'medium'|'knight'|'dummy'} kind
 */
function renderNightChoices(kind, listId, btnId) {
    const list = document.getElementById(listId);
    list.innerHTML = '';
    nightSelections[kind] = null;

    const btn = document.getElementById(btnId);
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
    }

    const choices = getNightChoices(kind);

    if (choices.length === 0) {
        list.innerHTML = '<p style="color:#888;">選べるプレイヤーがいません</p>';
        return;
    }

    choices.forEach(({ player: t, selectable }) => {
        const b = document.createElement('button');
        b.type = 'button';
        // 死者は全員の画面で同じように薄く表示する（役職による見た目の違いは出さない）
        b.className = t.is_alive ? 'target-btn' : 'target-btn night-dead';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            if (!selectable) {
                // 選べない人（仲間の人狼・死者など）は押したときに初めて案内する。文言は全役職共通
                alert('この人は選べません。別の人を選んでください。');
                return;
            }
            document.querySelectorAll(`#${listId} .target-btn`).forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            nightSelections[kind] = { id: t.id, name: t.name };
            if (btn) btn.style.display = '';
        };
        list.appendChild(b);
    });
}

/**
 * 「決定する」→ 確認 → 保存 → 共通の選択完了画面
 * @param {Function} save - 選んだ相手を保存する処理（失敗時は throw）
 */
async function submitNightChoice(kind, panelId, btnId, save) {
    const selected = nightSelections[kind];
    if (!selected) {
        alert('プレイヤーを選んでください');
        return;
    }
    if (!confirm(`${selected.name}さんに決定しますか？`)) return;

    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;

    try {
        await save(selected);
        setHasActedTonight(true);
        document.getElementById(panelId).classList.add('hidden');
        renderNightDone(kind, selected.name);
    } catch (err) {
        console.error(`夜の選択の送信エラー (${kind}):`, err);
        alert('送信に失敗しました。もう一度お試しください。');
        if (btn) btn.disabled = false;
    }
}

/** 役職アクションの対象を DB に保存する */
async function saveNightTarget(selected) {
    const { error } = await supabaseClient
        .from('players')
        .update({ night_target_id: selected.id })
        .eq('id', getMyPlayerId());
    if (error) throw error;
}

// ---- 預言者 ----
export function renderSeerTargets() {
    renderNightChoices('seer', 'seer-target-list', 'btn-seer-divinate');
}

export function submitDivination() {
    return submitNightChoice('seer', 'night-seer', 'btn-seer-divinate', saveNightTarget);
}

// ---- 霊媒師 ----
export function renderMediumTargets() {
    renderNightChoices('medium', 'medium-target-list', 'btn-medium-action');
}

export function submitMedium() {
    return submitNightChoice('medium', 'night-medium', 'btn-medium-action', saveNightTarget);
}

// ---- 人狼 ----
export function renderWolfTargets() {
    renderNightChoices('wolf', 'wolf-target-list', 'btn-wolf-attack');
}

export function submitAttack() {
    return submitNightChoice('wolf', 'night-wolf', 'btn-wolf-attack', saveNightTarget);
}

// ---- 騎士 ----
export function renderKnightTargets() {
    renderNightChoices('knight', 'knight-target-list', 'btn-knight-action');
}

export function submitKnightGuard() {
    return submitNightChoice('knight', 'night-knight', 'btn-knight-action', saveNightTarget);
}

// ---- ダミー質問（夜アクションがない人） ----
export function renderDummyTargets() {
    // 同じ夜はリロードしても同じ質問になるよう、選んだ質問番号を sessionStorage に残す
    let st = getDummyNightState();
    if (!st) {
        st = {
            night: getCurrentTimelineIndex(),
            name: getMyPlayerName(),
            q: Math.floor(Math.random() * DUMMY_QUESTIONS.length),
            answerId: null,
            answerName: null
        };
        saveDummyNightState(st);
    }
    document.getElementById('dummy-question-text').textContent = DUMMY_QUESTIONS[st.q] || DUMMY_QUESTIONS[0];
    renderNightChoices('dummy', 'dummy-target-list', 'btn-dummy-answer');
}

export function submitDummyAnswer() {
    return submitNightChoice('dummy', 'night-dummy', 'btn-dummy-answer', async (selected) => {
        // 回答は DB に保存しない（完了画面の表示と選び直しのため、この端末にだけ残す）
        const st = getDummyNightState() || { night: getCurrentTimelineIndex(), name: getMyPlayerName(), q: 0 };
        saveDummyNightState({ ...st, answerId: selected.id, answerName: selected.name });
    });
}

// =============================================
// 夜フェーズ：行動選び直し
// =============================================
const NIGHT_PANELS = {
    wolf: { panelId: 'night-wolf', render: renderWolfTargets },
    seer: { panelId: 'night-seer', render: renderSeerTargets },
    medium: { panelId: 'night-medium', render: renderMediumTargets },
    knight: { panelId: 'night-knight', render: renderKnightTargets },
    dummy: { panelId: 'night-dummy', render: renderDummyTargets }
};

/**
 * 夜フェーズ中に行動を選び直す（送信済みでもターゲットを再選択できる）
 * @param {'wolf'|'seer'|'medium'|'knight'|'dummy'} kind - パネル種別
 */
export function changeNightTarget(kind) {
    if (getLastKnownPhase() !== 'night') return;
    const entry = NIGHT_PANELS[kind];
    if (!entry) return;

    // 死亡後（幽霊モード）に古い「選び直す」ボタンが残っていても何もしない
    const me = getCurrentPlayers().find(isMyPlayer);
    if (!me || !me.is_alive) return;

    // 完了画面を隠して選択画面を再表示
    document.getElementById('night-waiting').classList.add('hidden');

    // hasActedTonightをリセット（選び直し中は未行動扱い）
    setHasActedTonight(false);

    document.getElementById(entry.panelId).classList.remove('hidden');
    entry.render();
}

// =============================================
// 追放処理・キック処理（GM専用）
// =============================================
export async function killPlayer(id, name) {
    if (!confirm(`本当に ${name} さんを追放（死亡）しますか？`)) return;
    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ is_alive: false })
            .eq('id', id);
        if (error) throw error;
    } catch (err) {
        console.error('追放エラー:', err);
        alert('追放処理に失敗しました。');
    }
}

export async function kickPlayer(id, name) {
    if (!confirm(`本当に ${name} さんをキック（強制退室）しますか？`)) return;
    try {
        const { error } = await supabaseClient
            .from('players')
            .delete()
            .eq('id', id);
        if (error) throw error;
    } catch (err) {
        console.error('キックエラー:', err);
        alert('キック処理に失敗しました。');
    }
}

// =============================================
// 役職カウンター変更（GM専用）
// =============================================
export function changeRoleCount(id, delta) {
    if (roleCounts[id] + delta < 0) return;
    roleCounts[id] += delta;
    // window._roleCounts を同期（ui.jsのupdateTotalInfo用）
    window._roleCounts = roleCounts;
    document.getElementById(`count-${id}`).textContent = roleCounts[id];
    // updateTotalInfo を直接呼ぶ
    _updateTotalInfoDirect();
}

function _updateTotalInfoDirect() {
    const rc = roleCounts;
    const totalRoles = Object.values(rc).reduce((a, b) => a + b, 0);
    const totalInfoEl = document.getElementById('total-info');
    const currentPlayersCount = getCurrentPlayers().length;

    document.getElementById('total-role-count').textContent = totalRoles;
    document.getElementById('total-player-count').textContent = currentPlayersCount;

    if (totalRoles === currentPlayersCount && currentPlayersCount > 0) {
        totalInfoEl.className = 'total-info total-ok';
    } else {
        totalInfoEl.className = 'total-info total-error';
    }
}

// =============================================
// 役職配布・ゲーム開始（GM専用）
// =============================================
export async function distributeRolesAndStartGame() {
    const totalRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    if (totalRoles === 0) {
        alert('役職が設定されていません。少なくとも1つ設定してください。');
        return false;
    }
    const currentPlayersCount = getCurrentPlayers().length;
    if (totalRoles !== currentPlayersCount) {
        alert(`役職の合計人数（${totalRoles}人）と参加者数（${currentPlayersCount}人）が一致しません！`);
        return false;
    }

    let roleDeck = [];
    ROLES_INFO.forEach(r => {
        for (let i = 0; i < roleCounts[r.id]; i++) {
            roleDeck.push(r.name);
        }
    });

    for (let i = roleDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [roleDeck[i], roleDeck[j]] = [roleDeck[j], roleDeck[i]];
    }

    const { data: players, error } = await supabaseClient.from('players').select('id, name');
    if (error || !players) {
        alert('プレイヤー情報の取得に失敗しました');
        return false;
    }
    // 設定を確認した直後に入退室があった場合は、配る前に中止する
    if (players.length !== roleDeck.length) {
        alert(`役職の合計人数（${roleDeck.length}人）と参加者数（${players.length}人）が一致しません！`);
        return false;
    }

    const FAIL_MSG = '役職の配布に失敗しました。もう一度試してください。';
    // 途中で失敗したときに、配りかけの役職を全員分消す
    const rollbackRoles = async () => {
        const { error: rollbackError } = await supabaseClient
            .from('players')
            .update({ role: null })
            .neq('name', 'dummy_string_for_reset_12345');
        if (rollbackError) console.error('役職の巻き戻しに失敗しました:', rollbackError);
    };

    try {
        for (let i = 0; i < players.length; i++) {
            const { error: updateError } = await supabaseClient
                .from('players')
                .update({ role: roleDeck[i] })
                .eq('id', players[i].id);
            if (updateError) throw updateError;
        }

        // 配布後に取り直して、全員に役職が入っていること・役職ごとの人数が設定どおりであることを確認
        const { data: dealt, error: checkError } = await supabaseClient.from('players').select('id, role');
        if (checkError || !dealt) throw checkError || new Error('配布結果の取得に失敗');

        const countRoles = list => list.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
        const expected = countRoles(roleDeck);
        const actual = countRoles(dealt.map(p => p.role));
        const allDealt = dealt.length === roleDeck.length && dealt.every(p => p.role);
        const countsMatch = Object.keys({ ...expected, ...actual }).every(r => expected[r] === actual[r]);
        if (!allDealt || !countsMatch) {
            throw new Error(`配布結果が設定と一致しません expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
        }
        return true;
    } catch (e) {
        console.error('役職配布エラー:', e);
        await rollbackRoles();
        alert(FAIL_MSG);
        return false;
    }
}

/**
 * 人狼の襲撃先を多数決で1人に決める
 * 最多票が同数ならその中からランダム、誰も選んでいなければ null（襲撃なし）
 * @param {string[]} targetIds - 生存人狼それぞれの night_target_id
 * @returns {string|null}
 */
export function decideWolfVictim(targetIds) {
    const counts = {};
    targetIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const ids = Object.keys(counts);
    if (ids.length === 0) return null;

    const maxVotes = Math.max(...Object.values(counts));
    const topIds = ids.filter(id => counts[id] === maxVotes);
    return topIds[Math.floor(Math.random() * topIds.length)];
}

/**
 * 占い・霊媒の結果を集計して night_result に書き込む
 * 同じ役職が複数いる場合も、生存者全員それぞれの対象について処理する
 * @param {'預言者'|'霊媒師'} roleName
 * @param {string} logTag - ログ用のタグ
 */
async function applyInspectionResults(roleName, logTag) {
    try {
        const { data: actors, error: actorsErr } = await supabaseClient
            .from('players')
            .select('id, name, night_target_id')
            .eq('role', roleName)
            .eq('is_alive', true);

        if (actorsErr) throw actorsErr;

        for (const actor of (actors || [])) {
            if (!actor.night_target_id) continue;
            try {
                const { data: targetData, error: targetErr } = await supabaseClient
                    .from('players')
                    .select('role')
                    .eq('id', actor.night_target_id)
                    .maybeSingle();

                if (targetErr) throw targetErr;
                if (!targetData) continue;

                const result = targetData.role === '人狼' ? '人狼' : '人間';
                const { error: updateErr } = await supabaseClient
                    .from('players')
                    .update({ night_result: result })
                    .eq('id', actor.id);
                if (updateErr) throw updateErr;
                console.log(`[${logTag}] handlePhaseChange ${actor.name} の結果: ${result}`);
            } catch (actorErr) {
                console.warn(`[${logTag}] handlePhaseChange ${actor.name} の集計スキップ:`, actorErr);
            }
        }
    } catch (err) {
        console.warn(`[${logTag}] handlePhaseChange ${roleName}の集計スキップ:`, err);
    }
}

export async function handlePhaseChange(newPhase, newTimelineIndex = null) {
    if (getLastKnownPhase() === 'waiting' && newPhase !== 'waiting') {
        const isSuccess = await distributeRolesAndStartGame();
        if (!isSuccess) return;
    }
    // フェーズ変更時に投票フラグをリセット
    if (newPhase !== 'voting') {
        setHasVotedToday(false);
        setIsCountingVotes(false);
    }
    // 朝の犠牲者の記録（game_status.morning_message）。undefined のときは書き換えない
    // 例: '{"victim_ids":["<id>"]}'、犠牲者なしは '{"victim_ids":[]}'、記録なし（集計エラー・夜に入る）は null
    let morningMessage;
    // 夜フェーズから朝フェーズ（morning）または議論フェーズ（discussion）へ移行する場合：占い師・霊媒師の結果を集計、および人狼の襲撃集計
    if (getLastKnownPhase() === 'night' && (newPhase === 'morning' || newPhase === 'discussion')) {
        // 占い師・霊媒師の集計（同じ役職が複数いても全員分を処理する）
        await applyInspectionResults('預言者', 'SEER');
        await applyInspectionResults('霊媒師', 'MEDIUM');
        // 人狼の襲撃および騎士の守護集計
        // 集計がエラーになった夜は記録なし（null）にして、朝の表示は従来の推測ロジックに任せる
        morningMessage = null;
        try {
            // 1. 生存している人狼の night_target_id を取得
            const { data: wolvesData, error: wolvesErr } = await supabaseClient
                .from('players')
                .select('id, name, night_target_id')
                .eq('role', '人狼')
                .eq('is_alive', true);

            if (wolvesErr) throw wolvesErr;

            // 2. 生存している騎士の night_target_id を取得
            const { data: knightsData, error: knightsErr } = await supabaseClient
                .from('players')
                .select('id, name, night_target_id')
                .eq('role', '騎士')
                .eq('is_alive', true);

            if (knightsErr) throw knightsErr;

            const attackTargetIds = wolvesData
                ? wolvesData.map(w => w.night_target_id).filter(id => id !== null && id !== undefined && id !== '')
                : [];

            const guardTargetIds = knightsData
                ? knightsData.map(k => k.night_target_id).filter(id => id !== null && id !== undefined && id !== '')
                : [];

            // 3. 人狼の票を多数決で1人に絞り、守護対象なら犠牲者なし
            const victimId = decideWolfVictim(attackTargetIds);

            if (victimId && !guardTargetIds.includes(victimId)) {
                // 4. 被襲撃者をID指定で死亡に更新
                const { error: killErr } = await supabaseClient
                    .from('players')
                    .update({ is_alive: false })
                    .eq('id', victimId);

                if (killErr) throw killErr;
                console.log(`[WOLF/KNIGHT] handlePhaseChange 襲撃対象を死亡に更新しました (ID: ${victimId})`);
                morningMessage = JSON.stringify({ victim_ids: [victimId] });
            } else {
                console.log('[WOLF/KNIGHT] handlePhaseChange 襲撃は発生しなかったか、騎士によって守られました。');
                morningMessage = JSON.stringify({ victim_ids: [] });
            }
        } catch (evalErr) {
            console.warn('[WOLF/KNIGHT] handlePhaseChange 襲撃・守護集計スキップ/エラー:', evalErr);
        }
    }
    // 夜フェーズへ移行する場合、各種ターゲット・投票・朝の犠牲者の記録をリセット
    if (newPhase === 'night') {
        morningMessage = null;
        try {
            const { error: nightResetError } = await supabaseClient
                .from('players')
                .update({ vote_target_id: null, night_target_id: null, night_result: null })
                .neq('name', 'dummy_string_for_reset_12345');
            if (nightResetError) throw nightResetError;
            console.log('[NIGHT] handlePhaseChange: vote_target_id / night_target_id / night_result をリセットしました');
        } catch (nightResetErr) {
            console.warn('[NIGHT] night リセットに失敗しましたが、フェーズ移行は続行します:', nightResetErr);
        }
    }

    const updateData = { current_phase: newPhase };
    if (newTimelineIndex !== null) {
        updateData.timeline_index = newTimelineIndex;
    }
    // 犠牲者の記録はフェーズと同じ更新に入れて、全員に同じ Realtime イベントで届くようにする
    if (morningMessage !== undefined) {
        updateData.morning_message = morningMessage;
    }

    try {
        let { error } = await supabaseClient
            .from('game_status')
            .update(updateData)
            .eq('id', 1);
        if (error && 'morning_message' in updateData) {
            // 犠牲者の記録が書けなくてもゲームが止まらないよう、記録なしでフェーズだけ進める
            console.warn('morning_message 付きのフェーズ更新に失敗。記録なしで再試行します:', error);
            delete updateData.morning_message;
            ({ error } = await supabaseClient
                .from('game_status')
                .update(updateData)
                .eq('id', 1));
        }
        if (error) throw error;
    } catch (error) {
        console.error('フェーズ更新エラー:', error);
        alert('フェーズの更新に失敗しました。');
    }
}

// =============================================
// リセット処理（GM専用）
// =============================================
export async function resetGame() {
    const confirmMsg = getLastKnownPhase() === 'result'
        ? 'ゲームを終了してロビーに戻りますか？'
        : 'ゲームを強制終了して、全プレイヤーの役職をリセットしロビーに戻りますか？';

    if (!confirm(confirmMsg)) return;

    if (getVoteCountdownTimer()) { clearInterval(getVoteCountdownTimer()); setVoteCountdownTimer(null); }

    console.log("【修正 2026/06/14】resetGameのリザルトクリア処理を実行しました");

    // リザルト画面・関連フラグを即座にクリア（Realtimeイベント到着前の残留防止）
    document.getElementById('result-overlay').classList.add('hidden');
    document.getElementById('vote-result-overlay').classList.add('hidden');
    // resultShown と _pendingWinner をリセット（既にimport済みのsetterを使用）
    setResultShown(false);
    setPendingWinner(null);

    try {
        // 全プレイヤーの role・is_alive・vote_target_id をリセット
        const { error: resetError } = await supabaseClient
            .from('players')
            .update({ role: null, is_alive: true, vote_target_id: null, night_target_id: null, night_result: null })
            .neq('name', 'dummy_string_for_reset_12345');
        if (resetError) throw resetError;

        // 人狼チャット履歴を削除
        try {
            const { error: chatError } = await supabaseClient
                .from('werewolf_chat')
                .delete()
                .neq('message', 'dummy_string_for_reset_12345');
            if (chatError) console.error("Chat delete error:", chatError);
        } catch (chatResetErr) {
            console.warn('人狼チャット履歴の削除に失敗しました:', chatResetErr);
        }

        const chatLog = document.getElementById('wolf-chat-log');
        if (chatLog) chatLog.innerHTML = '';

        // game_status を waiting に戻す
        const { error: phaseError } = await supabaseClient
            .from('game_status')
            .update({ current_phase: 'waiting', winner: null, timeline_index: 0, hide_vote_details: false, morning_message: null })
            .eq('id', 1);

        if (phaseError) {
            const { error: fallbackError } = await supabaseClient
                .from('game_status')
                .update({ current_phase: 'waiting' })
                .eq('id', 1);
            if (fallbackError) throw fallbackError;
        }

        Object.keys(roleCounts).forEach(k => roleCounts[k] = 0);
        setHasVotedToday(false);
        setIsCountingVotes(false);

    } catch (err) {
        console.error('リセットエラー:', err);
        alert('リセット処理中にエラーが発生しました。');
    }
}

// =============================================
// タイムライン進行（GM専用）
// =============================================
export async function advanceTimeline(offset) {
    if (getMyRoleType() !== 'gm') return;

    const currentTimelineIndex = getCurrentTimelineIndex();
    const lastKnownPhase = getLastKnownPhase();
    const pendingWinner = getPendingWinner();

    if (offset === 1) {
        // 【バグ2修正】勝者がすでに確定している場合は終礼（resultフェーズ）へ強制ジャンプ
        if (pendingWinner) {
            const finalIndex = GAME_TIMELINE.length - 1;
            await handlePhaseChange('result', finalIndex);
            return;
        }

        let nextPhase = '';
        let nextTimelineIndex = currentTimelineIndex;

        if (lastKnownPhase === 'waiting') {
            // 朝礼(rules) -> 役職の確認
            nextTimelineIndex = 1;
            nextPhase = 'confirm_role';
        } else if (lastKnownPhase === 'confirm_role') {
            // 役職の確認 -> 1限前休み(night)
            nextTimelineIndex = 2;
            nextPhase = 'night';
        } else if (lastKnownPhase === 'night') {
            // 夜 -> 朝（タイムスケジュール上の次の枠に進み、朝フェーズを開始）
            nextTimelineIndex = currentTimelineIndex + 1;
            nextPhase = 'morning';
        } else if (lastKnownPhase === 'morning') {
            // 【バグ1修正】朝 -> 議論（タイムスケジュールを1ステップ素直に進める）
            nextTimelineIndex = currentTimelineIndex + 1;
            nextPhase = 'discussion';
        } else if (lastKnownPhase === 'discussion') {
            // 議論 -> 投票（タイムスケジュール上の次の枠に進み、投票フェーズを開始）
            nextTimelineIndex = currentTimelineIndex + 1;
            nextPhase = 'voting';
        } else if (lastKnownPhase === 'voting') {
            // 投票中
            // すでに投票結果が表示されているか、集計完了している場合は次の夜へ進める
            const voteResultOverlay = document.getElementById('vote-result-overlay');
            if (getIsCountingVotes() || (voteResultOverlay && !voteResultOverlay.classList.contains('hidden'))) {
                nextTimelineIndex = currentTimelineIndex + 1;
                nextPhase = 'night';
            } else {
                // まだ投票中なら、投票を強制的に締め切って結果を表示させる
                await closeVoting();
                return;
            }
        } else if (lastKnownPhase === 'result') {
            alert('ゲームはすでに終了しています。リセットしてください。');
            return;
        }

        // 境界値チェック
        if (nextTimelineIndex >= GAME_TIMELINE.length) {
            alert('タイムスケジュールはこれ以上進められません。勝敗を確認するか、ゲーム強制終了してください。');
            return;
        }

        await handlePhaseChange(nextPhase, nextTimelineIndex);

    } else if (offset === -1) {
        let prevPhase = '';
        let prevTimelineIndex = currentTimelineIndex;

        if (lastKnownPhase === 'confirm_role') {
            prevTimelineIndex = 0;
            prevPhase = 'waiting';
        } else if (lastKnownPhase === 'night') {
            // 夜 -> 前の投票 または 役職確認（タイムスケジュールを1つ戻す）
            prevTimelineIndex = currentTimelineIndex - 1;
            if (prevTimelineIndex === 1) {
                prevPhase = 'confirm_role';
            } else {
                prevPhase = 'voting';
            }
            if (prevTimelineIndex < 0) {
                prevTimelineIndex = 0;
                prevPhase = 'waiting';
            }
        } else if (lastKnownPhase === 'morning') {
            // 朝 -> 夜（タイムスケジュールを1つ戻す）
            prevTimelineIndex = currentTimelineIndex - 1;
            prevPhase = 'night';
        } else if (lastKnownPhase === 'discussion') {
            // 議論 -> 朝（タイムスケジュールを1つ戻す）
            prevTimelineIndex = currentTimelineIndex - 1;
            prevPhase = 'morning';
        } else if (lastKnownPhase === 'voting') {
            // 投票 -> 議論（タイムスケジュールを1つ戻す）
            prevTimelineIndex = currentTimelineIndex - 1;
            prevPhase = 'discussion';
        } else if (lastKnownPhase === 'result') {
            prevTimelineIndex = GAME_TIMELINE.length - 1;
            prevPhase = 'voting';
        }

        await handlePhaseChange(prevPhase, prevTimelineIndex);
    }
}

// =============================================
// シークレット投票設定（GM専用）
// =============================================
export async function onHideVoteDetailsChange() {
    if (getMyRoleType() !== 'gm') return;
    const checkbox = document.getElementById('check-hide-vote-details');
    if (!checkbox) return;
    const newValue = checkbox.checked;

    try {
        const { error } = await supabaseClient
            .from('game_status')
            .update({ hide_vote_details: newValue })
            .eq('id', 1);
        if (error) throw error;
        console.log(`[VOTE] シークレット投票: ${newValue ? 'ON（詳細非公開）' : 'OFF（全公開）'}`);
    } catch (err) {
        console.error('シークレット投票設定の更新エラー:', err);
        checkbox.checked = !newValue; // 失敗時はUIを元に戻す
    }
}

// =============================================
// 人狼チャット送信・秘密指令
// =============================================
export async function sendWolfChatMessage() {
    const input = document.getElementById('input-wolf-chat');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    if (getMyRoleType() !== 'gm' && getMyRoleName() !== '人狼') return;

    const sender = getMyRoleType() === 'gm' ? 'GM' : getMyPlayerName();
    const senderRole = getMyRoleType() === 'gm' ? 'GM' : '人狼';

    try {
        const { error } = await supabaseClient
            .from('werewolf_chat')
            .insert([{ sender: sender, sender_role: senderRole, message: msg }]);
        if (error) throw error;
        input.value = '';
    } catch (e) {
        console.error('メッセージ送信エラー:', e);
        alert('メッセージの送信に失敗しました。');
    }
}

export async function submitGmMission() {
    const input = document.getElementById('input-gm-mission');
    if (!input) return;
    if (getMyRoleType() !== 'gm') return;

    const missionText = input.value.trim();

    try {
        const { error } = await supabaseClient
            .from('werewolf_mission')
            .update({ mission_text: missionText })
            .eq('id', 1);
        if (error) throw error;
        input.value = '';
        alert('秘密指令を送信しました。');
    } catch (e) {
        console.error('指令送信エラー:', e);
        alert('秘密指令の送信に失敗しました。');
    }
}

// =============================================
// ログイン・セッション管理
// =============================================
export function clearSession() {
    clearSessionData();
    alert('ログイン情報をリセットしました。');
    location.reload();
}

/**
 * 「部屋を作る」前の確認
 * 参加者が1人以上いれば confirm を出し、ゲーム進行中ならより強い警告にする
 * @returns {Promise<boolean>} 続行してよければ true
 */
async function confirmRecreateRoom() {
    const [{ count, error: countError }, { data: statusData, error: statusError }] = await Promise.all([
        supabaseClient.from('players').select('id', { count: 'exact', head: true }),
        supabaseClient.from('game_status').select('current_phase').eq('id', 1).maybeSingle()
    ]);

    if (countError) {
        // 人数が分からないまま全削除するのは危険なので、確認を挟む
        console.warn('参加者数の取得に失敗しました:', countError);
        return confirm('現在の参加者数を確認できませんでした。部屋を作り直すと全員の参加情報が消えます。続けますか？');
    }
    if (statusError) console.warn('ゲーム状態の取得に失敗しました:', statusError);

    const playerCount = count || 0;
    if (playerCount === 0) return true;

    const phase = statusData ? statusData.current_phase : null;
    const isInGame = phase && phase !== 'waiting' && phase !== 'result';
    const baseMsg = `現在 ${playerCount} 人が参加中です。部屋を作り直すと全員の参加情報が消えます。続けますか？`;
    const msg = isInGame
        ? `⚠️ ゲーム進行中です！\n今部屋を作り直すと、進行中のゲームが壊れます。\n\n${baseMsg}`
        : baseMsg;
    return confirm(msg);
}

export async function joinGame(role) {
    const name = nameInput.value.trim();
    if (!name) {
        alert('名前を入力してください！');
        nameInput.focus();
        return;
    }

    const btns = document.querySelectorAll('.login-btn');
    btns.forEach(btn => btn.disabled = true);
    // await 後は event.currentTarget が null になるため、押されたボタンを先に保持しておく
    const clickedBtn = event.currentTarget;
    const originalText = clickedBtn.innerHTML;
    clickedBtn.textContent = role === 'gm' ? '部屋を作る...' : '部屋に入る...';
    const restoreButtons = () => {
        clickedBtn.innerHTML = originalText;
        btns.forEach(btn => btn.disabled = false);
    };

    try {
        let playerId = null;
        if (role === 'gm') {
            // 参加者がいる場合は、全員の参加情報が消えることを確認してから削除する
            const confirmed = await confirmRecreateRoom();
            if (!confirmed) {
                restoreButtons();
                return;
            }

            const { error: resetError } = await supabaseClient
                .from('players')
                .delete()
                .neq('name', 'dummy_string_for_delete_all_records_12345');
            if (resetError) {
                alert('参加者一覧のリセットに失敗しました。\nSupabaseのRLS設定を確認してください。');
                restoreButtons();
                return;
            }

            // 人狼チャット履歴を削除
            try {
                const { error: chatError } = await supabaseClient
                    .from('werewolf_chat')
                    .delete()
                    .neq('message', 'dummy_string_for_reset_12345');
                if (chatError) console.error("Chat delete error:", chatError);
            } catch (chatResetErr) {
                console.warn('人狼チャット履歴の削除に失敗しました:', chatResetErr);
            }

            const chatLog = document.getElementById('wolf-chat-log');
            if (chatLog) chatLog.innerHTML = '';
        } else if (role === 'player') {
            // 同じ名前の人がいると誰が誰か分からなくなるので、参加させない（DB 側に一意制約はない）
            const { data: sameName, error: sameNameError } = await supabaseClient
                .from('players')
                .select('id')
                .eq('name', name);
            if (sameNameError) {
                alert('参加に失敗しました。もう一度お試しください。');
                restoreButtons();
                return;
            }
            if (sameName && sameName.length > 0) {
                alert('同じ名前の人がもう参加しています。別の名前にしてください。');
                restoreButtons();
                return;
            }

            const { data, error } = await supabaseClient
                .from('players')
                .insert([{ name: name }])
                .select();
            if (error) {
                alert('参加に失敗しました。名前が被っているか、テーブル設定を確認してください。');
                restoreButtons();
                return;
            }
            if (data && data[0]) {
                playerId = data[0].id;
            }
        }

        // state の更新は main.js 経由で行う（setMyPlayerName等）
        window._joinGameCallback(name, role, playerId);
    } catch (err) {
        console.error(err);
        alert('予期せぬエラーが発生しました。');
        restoreButtons();
    }
}
