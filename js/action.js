// =============================================
// js/action.js
// 投票・夜アクション・GM操作・ゲーム進行処理
// =============================================

import { supabaseClient, GAME_TIMELINE, ROLES_INFO } from './config.js';
import {
    getMyPlayerName, getMyRoleType, getMyRoleName,
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
    loginView, gameView, gmPanel, gmNameDisplay, nameInput
} from './state.js';
import {
    updatePhaseDisplay, renderPlayerList, renderMemoList,
    showVoteResult, updateVoteProgress, renderTimeline,
    updateGmTimelineButtons, initRoleCounters,
    updateWolfChatButtonVisibility, updateHideVoteDetailsUI,
    receiveChatMessage, receiveMissionUpdate,
    showSeerResult, showMediumResult
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
            .eq('name', getMyPlayerName());

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
            .eq('name', getMyPlayerName());

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
// 占い師（預言者）専用処理
// =============================================
let selectedSeerTargetId = null;
let selectedSeerTargetName = null;

export function renderSeerTargets() {
    const list = document.getElementById('seer-target-list');
    list.innerHTML = '';
    selectedSeerTargetId = null;
    selectedSeerTargetName = null;
    const btn = document.getElementById('btn-seer-divinate');
    btn.style.display = 'none';
    btn.disabled = false;

    const targets = getCurrentPlayers().filter(p => p.is_alive && p.name !== getMyPlayerName());

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">占えるプレイヤーがいません</p>';
        return;
    }

    targets.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'target-btn';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            document.querySelectorAll('#seer-target-list .target-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedSeerTargetId = t.id;
            selectedSeerTargetName = t.name;
            btn.style.display = '';
        };
        list.appendChild(b);
    });
}

export async function submitDivination() {
    if (!selectedSeerTargetId) {
        alert('占うプレイヤーを選んでください');
        return;
    }
    if (!confirm(`${selectedSeerTargetName} さんを占いますか？`)) return;

    const btn = document.getElementById('btn-seer-divinate');
    btn.disabled = true;

    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ night_target_id: selectedSeerTargetId })
            .eq('name', getMyPlayerName());

        if (error) throw error;

        setHasActedTonight(true);
        // おわり：選び直し可能な完了画面へ
        document.getElementById('night-seer').classList.add('hidden');
        const nightWaiting = document.getElementById('night-waiting');
        nightWaiting.classList.remove('hidden');
        nightWaiting.innerHTML = `
            <h2>🔮 占い完了</h2>
            <p style="color:#c0caf5;">「${selectedSeerTargetName}」を占いました。朝を待っています...<br><span style="font-size:0.8rem;opacity:0.6;">展開変更する場合は下のボタンから</span></p>
            <button type="button" class="change-night-target-btn" onclick="changeNightTarget('seer')">&#x21bb; 占い相手を選び直す</button>
        `;
    } catch (err) {
        console.error('占いエラー:', err);
        alert('占いの送信に失敗しました。');
        btn.disabled = false;
    }
}

// =============================================
// 霊媒師専用処理
// =============================================
let selectedMediumTargetId = null;
let selectedMediumTargetName = null;

export function renderMediumTargets() {
    const list = document.getElementById('medium-target-list');
    list.innerHTML = '';
    selectedMediumTargetId = null;
    selectedMediumTargetName = null;
    const btn = document.getElementById('btn-medium-action');
    btn.style.display = 'none';
    btn.disabled = false;

    const targets = getCurrentPlayers().filter(p => !p.is_alive);

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">霊媒できる死者がいません</p>';
        return;
    }

    targets.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'target-btn';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            document.querySelectorAll('#medium-target-list .target-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedMediumTargetId = t.id;
            selectedMediumTargetName = t.name;
            btn.style.display = '';
        };
        list.appendChild(b);
    });
}

export async function submitMedium() {
    if (!selectedMediumTargetId) {
        alert('霊媒するプレイヤーを選んでください');
        return;
    }
    if (!confirm(`${selectedMediumTargetName} さんを霊媒しますか？`)) return;

    const btn = document.getElementById('btn-medium-action');
    btn.disabled = true;

    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ night_target_id: selectedMediumTargetId })
            .eq('name', getMyPlayerName());

        if (error) throw error;

        setHasActedTonight(true);
        // おわり：選び直し可能な完了画面へ
        document.getElementById('night-medium').classList.add('hidden');
        const nightWaiting = document.getElementById('night-waiting');
        nightWaiting.classList.remove('hidden');
        nightWaiting.innerHTML = `
            <h2>🔮 霊媒完了</h2>
            <p style="color:#c0caf5;">「${selectedMediumTargetName}」を霊媒しました。朝を待っています...<br><span style="font-size:0.8rem;opacity:0.6;">展開変更する場合は下のボタンから</span></p>
            <button type="button" class="change-night-target-btn" onclick="changeNightTarget('medium')">&#x21bb; 霊媒相手を選び直す</button>
        `;
    } catch (err) {
        console.error('霊媒エラー:', err);
        alert('霊媒の送信に失敗しました。');
        btn.disabled = false;
    }
}

// =============================================
// 人狼専用処理
// =============================================
let selectedWolfTargetId = null;
let selectedWolfTargetName = null;

export function renderWolfTargets() {
    const list = document.getElementById('wolf-target-list');
    list.innerHTML = '';
    selectedWolfTargetId = null;
    selectedWolfTargetName = null;

    const btn = document.getElementById('btn-wolf-attack');
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
    }

    const targets = getCurrentPlayers().filter(p => p.is_alive && p.name !== getMyPlayerName());

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">襲撃できるプレイヤーがいません</p>';
        return;
    }

    targets.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'target-btn';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            document.querySelectorAll('#wolf-target-list .target-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedWolfTargetId = t.id;
            selectedWolfTargetName = t.name;
            if (btn) btn.style.display = '';
        };
        list.appendChild(b);
    });
}

export async function submitAttack() {
    if (!selectedWolfTargetId) {
        alert('襲撃するプレイヤーを選んでください');
        return;
    }
    if (!confirm(`${selectedWolfTargetName} さんを襲撃しますか？`)) return;

    const btn = document.getElementById('btn-wolf-attack');
    if (btn) btn.disabled = true;

    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ night_target_id: selectedWolfTargetId })
            .eq('name', getMyPlayerName());

        if (error) throw error;

        setHasActedTonight(true);
        // おわり：選び直し可能な完了画面へ
        document.getElementById('night-wolf').classList.add('hidden');
        const nightWaiting = document.getElementById('night-waiting');
        nightWaiting.classList.remove('hidden');
        nightWaiting.innerHTML = `
            <h2>🔪 襲撃完了（変更可）</h2>
            <p style="color:#c0caf5;">「${selectedWolfTargetName}」を襲撃対象に設定しました。<br><span style="font-size:0.8rem;opacity:0.6;">夜明けまで変更可能です</span></p>
            <button type="button" class="change-night-target-btn" onclick="changeNightTarget('wolf')">&#x21bb; 襲撃対象を選び直す</button>
        `;
    } catch (err) {
        console.error('襲撃送信エラー:', err);
        alert('襲撃の送信に失敗しました。');
        if (btn) btn.disabled = false;
    }
}

// =============================================
// 騎士専用処理
// =============================================
let selectedKnightTargetId = null;
let selectedKnightTargetName = null;

export function renderKnightTargets() {
    const list = document.getElementById('knight-target-list');
    list.innerHTML = '';
    selectedKnightTargetId = null;
    selectedKnightTargetName = null;

    const btn = document.getElementById('btn-knight-action');
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
    }

    const targets = getCurrentPlayers().filter(p => p.is_alive);

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">守護できるプレイヤーがいません</p>';
        return;
    }

    targets.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'target-btn';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            document.querySelectorAll('#knight-target-list .target-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedKnightTargetId = t.id;
            selectedKnightTargetName = t.name;
            if (btn) btn.style.display = '';
        };
        list.appendChild(b);
    });
}

export async function submitKnightGuard() {
    if (!selectedKnightTargetId) {
        alert('守護するプレイヤーを選んでください');
        return;
    }
    if (!confirm(`${selectedKnightTargetName} さんを守護しますか？`)) return;

    const btn = document.getElementById('btn-knight-action');
    if (btn) btn.disabled = true;

    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ night_target_id: selectedKnightTargetId })
            .eq('name', getMyPlayerName());

        if (error) throw error;

        setHasActedTonight(true);
        // おわり：選び直し可能な完了画面へ
        document.getElementById('night-knight').classList.add('hidden');
        const nightWaiting = document.getElementById('night-waiting');
        nightWaiting.classList.remove('hidden');
        nightWaiting.innerHTML = `
            <h2>🛡️ 守護完了（変更可）</h2>
            <p style="color:#c0caf5;">「${selectedKnightTargetName}」を守護対象に設定しました。<br><span style="font-size:0.8rem;opacity:0.6;">夜明けまで変更可能です</span></p>
            <button type="button" class="change-night-target-btn" onclick="changeNightTarget('knight')">&#x21bb; 守護対象を選び直す</button>
        `;
    } catch (err) {
        console.error('守護送信エラー:', err);
        alert('守護の送信に失敗しました。');
        if (btn) btn.disabled = false;
    }
}

// =============================================
// 夜フェーズ：行動選び直し
// =============================================
/**
 * 夜フェーズ中に行動を選び直す（送信済みでもターゲットを再選択できる）
 * @param {'wolf'|'seer'|'medium'|'knight'} role - 役職種別
 */
export function changeNightTarget(role) {
    if (getLastKnownPhase() !== 'night') return;

    // 待檟画面を隐して行動選択画面を再表示
    document.getElementById('night-waiting').classList.add('hidden');

    // hasActedTonightをリセット（選び直し中は未行動扱い）
    setHasActedTonight(false);

    if (role === 'wolf') {
        const panel = document.getElementById('night-wolf');
        panel.classList.remove('hidden');
        window.renderWolfTargets();
    } else if (role === 'seer') {
        const panel = document.getElementById('night-seer');
        panel.classList.remove('hidden');
        window.renderSeerTargets();
    } else if (role === 'medium') {
        const panel = document.getElementById('night-medium');
        panel.classList.remove('hidden');
        window.renderMediumTargets();
    } else if (role === 'knight') {
        const panel = document.getElementById('night-knight');
        panel.classList.remove('hidden');
        window.renderKnightTargets();
    }
}

// =============================================
// 追放処理・キック処理（GM専用）
// =============================================
export async function killPlayer(name) {
    if (!confirm(`本当に ${name} さんを追放（死亡）しますか？`)) return;
    try {
        const { error } = await supabaseClient
            .from('players')
            .update({ is_alive: false })
            .eq('name', name);
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

    const { data: players, error } = await supabaseClient.from('players').select('name');
    if (error || !players) {
        alert('プレイヤー情報の取得に失敗しました');
        return false;
    }

    try {
        for (let i = 0; i < players.length; i++) {
            await supabaseClient.from('players').update({ role: roleDeck[i] }).eq('name', players[i].name);
        }
        return true;
    } catch (e) {
        console.error(e);
        alert('役職の配布中にエラーが発生しました。');
        return false;
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
    // 夜フェーズから朝フェーズ（morning）または議論フェーズ（discussion）へ移行する場合：占い師・霊媒師の結果を集計、および人狼の襲撃集計
    if (getLastKnownPhase() === 'night' && (newPhase === 'morning' || newPhase === 'discussion')) {
        // 占い師の集計
        try {
            const { data: seerData, error: seerErr } = await supabaseClient
                .from('players')
                .select('id, name, night_target_id')
                .eq('role', '預言者')
                .eq('is_alive', true)
                .maybeSingle();

            if (!seerErr && seerData && seerData.night_target_id) {
                const { data: targetData, error: targetErr } = await supabaseClient
                    .from('players')
                    .select('role')
                    .eq('id', seerData.night_target_id)
                    .maybeSingle();

                if (!targetErr && targetData) {
                    const result = targetData.role === '人狼' ? '人狼' : '人間';
                    await supabaseClient
                        .from('players')
                        .update({ night_result: result })
                        .eq('id', seerData.id);
                    console.log(`[SEER] handlePhaseChange 占い結果: ${result}`);
                }
            }
        } catch (seerErr) {
            console.warn('[SEER] handlePhaseChange 占い集計スキップ:', seerErr);
        }
        // 霊媒師の集計
        try {
            const { data: mediumData, error: mediumErr } = await supabaseClient
                .from('players')
                .select('id, name, night_target_id')
                .eq('role', '霊媒師')
                .eq('is_alive', true)
                .maybeSingle();

            if (!mediumErr && mediumData && mediumData.night_target_id) {
                const { data: targetData, error: targetErr } = await supabaseClient
                    .from('players')
                    .select('role')
                    .eq('id', mediumData.night_target_id)
                    .maybeSingle();

                if (!targetErr && targetData) {
                    const result = targetData.role === '人狼' ? '人狼' : '人間';
                    await supabaseClient
                        .from('players')
                        .update({ night_result: result })
                        .eq('id', mediumData.id);
                    console.log(`[MEDIUM] handlePhaseChange 霊媒結果: ${result}`);
                }
            }
        } catch (mediumErr) {
            console.warn('[MEDIUM] handlePhaseChange 霊媒集計スキップ:', mediumErr);
        }
        // 人狼の襲撃および騎士の守護集計
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

            // 3. 襲撃対象から守護対象を除外して、実際の犠牲者IDを決定
            const uniqueAttackIds = [...new Set(attackTargetIds)];
            const actualVictimIds = uniqueAttackIds.filter(attackId => !guardTargetIds.includes(attackId));

            if (actualVictimIds.length > 0) {
                // 4. 被襲撃者を個別にID指定（eq('id', id)）で死亡に更新
                for (const victimId of actualVictimIds) {
                    const { error: killErr } = await supabaseClient
                        .from('players')
                        .update({ is_alive: false })
                        .eq('id', victimId);

                    if (killErr) throw killErr;
                    console.log(`[WOLF/KNIGHT] handlePhaseChange 襲撃対象を死亡に更新しました (ID: ${victimId})`);
                }
            } else {
                console.log('[WOLF/KNIGHT] handlePhaseChange 襲撃は発生しなかったか、騎士によって守られました。');
            }
        } catch (evalErr) {
            console.warn('[WOLF/KNIGHT] handlePhaseChange 襲撃・守護集計スキップ/エラー:', evalErr);
        }
    }
    // 夜フェーズへ移行する場合、各種ターゲット・投票をリセット
    if (newPhase === 'night') {
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

    try {
        const { error } = await supabaseClient
            .from('game_status')
            .update(updateData)
            .eq('id', 1);
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
            .update({ current_phase: 'waiting', winner: null, timeline_index: 0, hide_vote_details: false })
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

export async function joinGame(role) {
    const name = nameInput.value.trim();
    if (!name) {
        alert('名前を入力してください！');
        nameInput.focus();
        return;
    }

    const btns = document.querySelectorAll('.login-btn');
    btns.forEach(btn => btn.disabled = true);
    const originalText = event.currentTarget.innerHTML;
    event.currentTarget.textContent = role === 'gm' ? '部屋を作る...' : '部屋に入る...';

    try {
        let playerId = null;
        if (role === 'gm') {
            const { error: resetError } = await supabaseClient
                .from('players')
                .delete()
                .neq('name', 'dummy_string_for_delete_all_records_12345');
            if (resetError) {
                alert('参加者一覧のリセットに失敗しました。\nSupabaseのRLS設定を確認してください。');
                event.currentTarget.innerHTML = originalText;
                btns.forEach(btn => btn.disabled = false);
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
            const { data, error } = await supabaseClient
                .from('players')
                .insert([{ name: name }])
                .select();
            if (error) {
                alert('参加に失敗しました。名前が被っているか、テーブル設定を確認してください。');
                event.currentTarget.innerHTML = originalText;
                btns.forEach(btn => btn.disabled = false);
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
        event.currentTarget.innerHTML = originalText;
        btns.forEach(btn => btn.disabled = false);
    }
}
