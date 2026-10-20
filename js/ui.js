// =============================================
// js/ui.js
// 画面描画・UIアップデート系の関数群
// =============================================

import { supabaseClient } from './config.js';
import { setLightForPhase } from './theme.js';
import { GAME_TIMELINE, phaseNames, ROLES_INFO, ROLE_BADGE_CLASS, NIGHT_ACTION_ROLES, DUMMY_QUESTIONS, dayOfTimelineIndex } from './config.js';
import {
    getMyPlayerName, getMyPlayerId, isMyPlayer, getMyRoleType, getMyRoleName, setMyRoleName,
    getCurrentPlayers, setCurrentPlayers, setCurrentPlayersCount,
    getLastKnownPhase, setLastKnownPhase,
    getHasActedTonight, setHasActedTonight,
    getResultShown, setResultShown,
    getHasVotedToday, setHasVotedToday,
    getIsCountingVotes, setIsCountingVotes,
    getVoteCountdownTimer, setVoteCountdownTimer,
    getHideVoteDetails,
    getCurrentTimelineIndex,
    getPendingWinner,
    getDummyNightState, clearDummyNightState,
    getMorningMessage, getDeathLog,
    playerListArea, myRoleArea, roleSettingsArea, gmHint, playerList, phaseElement
} from './state.js';

// 循環依存を避けるため、action.jsの関数はimport onDemandではなく引数/コールバックで受け取る
// ただし実際は同一モジュールバンドルではないため、window経由で呼ぶ設計にする

// =============================================
// アイコン（index.html のインラインSVG を参照する）
// =============================================
function iconHtml(id) {
    return `<svg class="icon" aria-hidden="true"><use href="#${id}" /></svg>`;
}

// 役職 → 役職カードのマーク
const ROLE_MARK = {
    '人狼': 'i-wolf',
    '市民': 'i-house',
    '預言者': 'i-eye',
    '霊媒師': 'i-candle',
    '騎士': 'i-shield',
    'てるてる': 'i-teru'
};

/**
 * 役職カードの表面（陣営・マーク・役職名・説明）を入れる
 * カードの寸法は全員同じで、伏せている間は表面が見えない
 */
function setRoleFace(roleName) {
    const info = ROLES_INFO.find(r => r.name === roleName);
    const nameEl = document.getElementById('my-role-name');
    if (nameEl) nameEl.textContent = roleName || '???';
    const factionEl = document.getElementById('my-role-faction');
    if (factionEl) factionEl.textContent = info ? info.faction : '';
    const summaryEl = document.getElementById('my-role-summary');
    if (summaryEl) summaryEl.textContent = info ? info.summary : '';
    const markUse = document.querySelector('#my-role-mark use');
    if (markUse) markUse.setAttribute('href', `#${ROLE_MARK[roleName] || 'i-question'}`);
}

// =============================================
// 夜フェーズ：全員共通の選択画面の部品
// =============================================
// 夜アクションがある役職 → パネル種別（ここにない役職はダミー質問）
const NIGHT_KIND_BY_ROLE = {
    '人狼': 'wolf',
    '預言者': 'seer',
    '霊媒師': 'medium',
    '騎士': 'knight'
};
const NIGHT_PANEL_IDS = ['night-wolf', 'night-seer', 'night-medium', 'night-knight', 'night-dummy', 'night-waiting'];
const NIGHT_RENDER_FUNCS = {
    wolf: 'renderWolfTargets',
    seer: 'renderSeerTargets',
    medium: 'renderMediumTargets',
    knight: 'renderKnightTargets',
    dummy: 'renderDummyTargets'
};

/**
 * その役職がこのプレイヤーを選べるか
 * @param {'wolf'|'seer'|'medium'|'knight'|'dummy'} kind
 */
function canPickAtNight(kind, p) {
    if (kind === 'medium') return !p.is_alive;          // 霊媒師は死者だけ
    if (kind === 'wolf') return p.is_alive && p.role !== '人狼'; // 人狼は仲間の人狼を襲撃できない
    return p.is_alive;                                   // 預言者・騎士・ダミー質問は生存者だけ
}

/**
 * 夜の選択肢（役職に関係なく全員同じリスト）
 * 役職がバレないよう、自分以外の全員を「生存者（名前順）→ 死者（名前順）」で並べ、
 * ボタンの個数・並び順を全員そろえる。選べない人は selectable: false（押したときに案内を出す）
 * @param {'wolf'|'seer'|'medium'|'knight'|'dummy'} kind
 * @returns {{ player: object, selectable: boolean }[]}
 */
export function getNightChoices(kind) {
    const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
    const others = getCurrentPlayers().filter(p => !isMyPlayer(p));
    const alive = others.filter(p => p.is_alive).sort(byName);
    const dead = others.filter(p => !p.is_alive).sort(byName);
    return [...alive, ...dead].map(p => ({ player: p, selectable: canPickAtNight(kind, p) }));
}

/** 今夜、自分にどのパネルを出すか */
export function getMyNightKind() {
    const role = getMyRoleName();
    const kind = NIGHT_ACTION_ROLES.includes(role) ? NIGHT_KIND_BY_ROLE[role] : null;
    // 夜アクションがない役職、または選べる相手がいない（死者のいない夜の霊媒師など）→ ダミー質問
    if (!kind || !getNightChoices(kind).some(c => c.selectable)) return 'dummy';
    return kind;
}

/**
 * 全員共通の「選択完了」画面を表示する
 * @param {string} kind - 選び直し時に開くパネル種別
 * @param {string|null} pickedName - 選んだ相手の名前
 */
export function renderNightDone(kind, pickedName) {
    const el = document.getElementById('night-waiting');
    el.classList.remove('hidden');
    const pickedHtml = pickedName
        ? `<p class="night-picked">（${escapeHTML(pickedName)}さんを選びました）</p>`
        : '';
    el.innerHTML = `
        <div class="panel-kicker">${iconHtml('i-moon')}今夜の選択</div>
        <h2 class="night-question">選択完了</h2>
        <p class="night-note">朝を待っています…</p>
        ${pickedHtml}
        <button type="button" class="btn-secondary change-night-target-btn" onclick="changeNightTarget('${kind}')">${iconHtml('i-refresh')}選び直す</button>
    `;
}

// =============================================
// フェーズ表示・メインUI更新
// =============================================
export async function updatePhaseDisplay(phase) {
    // フェーズ変更時にスマホ用メモドロワーが開いていたら閉じる
    const sidebar = document.getElementById('left-sidebar');
    if (sidebar && sidebar.classList.contains('show-mobile')) {
        toggleMobileMemo();
    }

    setLastKnownPhase(phase);
    const displayName = phaseNames[phase] || phase;

    // フェーズ変更時に役職カバーをリセット（覗き見防止）
    resetRoleCover();

    if (phaseElement.textContent !== displayName) {
        phaseElement.textContent = displayName;
        phaseElement.classList.remove('update-anim');
        void phaseElement.offsetWidth;
        phaseElement.classList.add('update-anim');
    }

    // リザルトフェーズの処理（最優先）
    if (phase === 'result') {
        await showResultScreen();
        return;
    }

    // リザルト以外のフェーズに戻ったらリザルト画面を閉じる
    document.getElementById('result-overlay').classList.add('hidden');
    setResultShown(false);

    // テーブルの照明（夜・朝・昼）を切り替える
    setLightForPhase(phase);

    // GMヒント（夜フェーズに行動待ちを表示）
    if (getMyRoleType() === 'gm' && phase === 'night') {
        gmHint.classList.remove('hidden');
    } else {
        gmHint.classList.add('hidden');
    }

    // GM用夜フェーズ行動状況インジケーターを更新
    renderNightActionStatus();

    if (phase === 'waiting') {
        const chatLog = document.getElementById('wolf-chat-log');
        if (chatLog) chatLog.innerHTML = '';

        playerListArea.classList.remove('hidden');
        myRoleArea.classList.add('hidden');
        document.getElementById('ghost-mode-overlay').classList.add('hidden');
        document.getElementById('night-action-overlay').classList.add('hidden');
        document.getElementById('morning-overlay').classList.add('hidden');
        document.getElementById('vote-overlay').classList.add('hidden');
        document.getElementById('vote-progress-area').classList.add('hidden');
        document.getElementById('vote-result-overlay').classList.add('hidden');
        hideMyNightResult();
        // waitingフェーズでは幽霊モードUIも消す
        disableGhostSpectatorMode();
        setHasActedTonight(false);
        clearDummyNightState();
        setHasVotedToday(false);
        setIsCountingVotes(false);
        if (getVoteCountdownTimer()) { clearInterval(getVoteCountdownTimer()); setVoteCountdownTimer(null); }

        if (getMyRoleType() === 'gm') {
            roleSettingsArea.classList.remove('hidden');
            document.getElementById('vote-close-area').classList.add('hidden');
        }

    } else {
        roleSettingsArea.classList.add('hidden');

        // ── 夕フェーズ: 投票進捗バーはGM・プレイヤー共通で表示（投票フェーズのみ） ──
        if (phase === 'voting') {
            // 上の進捗は GM 用（プレイヤーは投票パネルの中に同じ進捗が出る）
            document.getElementById('vote-progress-area').classList.toggle('hidden', getMyRoleType() !== 'gm');
            const pArea = document.getElementById('vote-progress-area-player');
            if (pArea) pArea.classList.remove('hidden');
            updateVoteProgress();
        } else {
            document.getElementById('vote-progress-area').classList.add('hidden');
            const pArea = document.getElementById('vote-progress-area-player');
            if (pArea) pArea.classList.add('hidden');
        }

        if (getMyRoleType() === 'gm') {
            playerListArea.classList.remove('hidden');
            // 投票フェーズのみ「投票を締め切る」ボタンを表示
            if (phase === 'voting') {
                document.getElementById('vote-close-area').classList.remove('hidden');
            } else {
                document.getElementById('vote-close-area').classList.add('hidden');
            }
        } else {
            playerListArea.classList.add('hidden');
            document.getElementById('vote-close-area').classList.add('hidden');
        }

        if (getMyRoleType() === 'player') {
            myRoleArea.classList.remove('hidden');
            await fetchMyRole();
            checkMyAliveStatus();

            const me = getCurrentPlayers().find(isMyPlayer);
            const isMeAlive = me ? me.is_alive : false;

            if (phase === 'voting') {
                // ── 投票フェーズ ──
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                if (isMeAlive) {
                    renderVoteUI();
                } else {
                    // 死者は霊界観戦パネル
                    document.getElementById('vote-overlay').classList.remove('hidden');
                    document.getElementById('vote-select').classList.add('hidden');
                    document.getElementById('vote-done').classList.add('hidden');
                    document.getElementById('vote-ghost').classList.remove('hidden');
                }

            } else if (phase === 'morning') {
                // ── 朝フェーズ ──
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.remove('hidden');

                // 昨晩の犠牲者の表示
                showMorningVictims();

                // 全員共通の「🌙 あなたの結果」カード
                await showMyNightResult();

            } else if (phase === 'discussion') {
                // ── 議論フェーズ（明るい昼）──
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                // 議論フェーズでは「あなたの結果」カードは表示しない
                hideMyNightResult();

            } else if (phase === 'confirm_role') {
                // ── 役職確認フェーズ ──
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                hideMyNightResult();

            } else if (phase === 'night') {
                // ── 夜フェーズ ──
                // 「投票日のフラグ」を全クライアントでリセット（2回目以降の投票対策）
                setHasVotedToday(false);
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('vote-result-overlay').classList.add('hidden');
                // 「あなたの結果」カードを隠す（夜フェーズ開始時）
                hideMyNightResult();

                // ── 夜の画面 ──
                // 役職がバレないよう、全員「名前を選ぶ → 決定する → 選択完了（選び直し可）」の同じ流れ・同じ見た目にする。
                // 夜アクションがある役職で候補がいる → 役職パネル、それ以外 → ダミー質問パネル
                const nightKind = getMyNightKind();
                let pickedName = null;

                // ── リロード対策: 行動済みかどうかを復元 ──
                // 役職パネルは Supabase の night_target_id、ダミー質問は sessionStorage から復元する
                if (isMeAlive && nightKind !== 'dummy') {
                    try {
                        const { data: myData } = await supabaseClient
                            .from('players')
                            .select('night_target_id')
                            .eq('id', getMyPlayerId())
                            .single();
                        if (myData && myData.night_target_id) {
                            // DBにnight_target_idが存在する → 今夜すでに行動済み
                            setHasActedTonight(true);
                            const picked = getCurrentPlayers().find(p => p.id === myData.night_target_id);
                            pickedName = picked ? picked.name : null;
                            console.log('[NIGHT] リロード検出: night_target_id あり → hasActedTonight = true');
                        } else {
                            // DBにnight_target_idがない → まだ未行動
                            setHasActedTonight(false);
                            console.log('[NIGHT] フェーズ開始 or リセット済み: hasActedTonight = false');
                        }
                    } catch (e) {
                        console.warn('[NIGHT] night_target_id の確認に失敗:', e);
                        setHasActedTonight(false);
                    }
                } else if (isMeAlive) {
                    const dummyState = getDummyNightState();
                    setHasActedTonight(!!(dummyState && dummyState.answerId));
                    pickedName = dummyState ? dummyState.answerName : null;
                } else {
                    setHasActedTonight(false);
                }

                if (isMeAlive) {
                    document.getElementById('night-action-overlay').classList.remove('hidden');
                    NIGHT_PANEL_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));

                    if (getHasActedTonight()) {
                        renderNightDone(nightKind, pickedName);
                    } else {
                        document.getElementById(`night-${nightKind}`).classList.remove('hidden');
                        window[NIGHT_RENDER_FUNCS[nightKind]]();
                    }
                } else {
                    document.getElementById('night-action-overlay').classList.add('hidden');
                }

            } else {
                // その他のフェーズ
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                hideMyNightResult();
                setHasActedTonight(false);
            }
        }
    }
}

// =============================================
// 役職取得
// =============================================
export async function fetchMyRole() {
    if (getMyRoleType() !== 'player') return;
    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('role')
            .eq('id', getMyPlayerId())
            .single();

        if (error || !data) {
            // データが取得できない場合はキックされたとみなして安全にログアウト
            console.warn('[KICKED] 自分のプレイヤーデータが取得できません。強制退避します。');
            sessionStorage.removeItem('werewolf_playerName');
            sessionStorage.removeItem('werewolf_roleType');
            sessionStorage.removeItem('werewolf_playerId');
            alert("GMによって部屋からキックされました。");
            location.reload();
            return;
        }

        if (data && data.role) {
            setMyRoleName(data.role);
        } else {
            setMyRoleName('役職なし');
        }
        setRoleFace(getMyRoleName());
        // 人狼チャットボタンの表示制御
        updateWolfChatButtonVisibility();
    } catch (err) {
        console.error('役職取得エラー:', err);
        // エラー発生時もDBに自分が存在するか再確認し、無ければキックとみなす
        try {
            const { data } = await supabaseClient
                .from('players')
                .select('id')
                .eq('id', getMyPlayerId());
            if (!data || data.length === 0) {
                sessionStorage.removeItem('werewolf_playerName');
                sessionStorage.removeItem('werewolf_roleType');
                sessionStorage.removeItem('werewolf_playerId');
                alert("GMによって部屋からキックされました。");
                location.reload();
                return;
            }
        } catch (checkErr) {
            console.error('キック再確認エラー:', checkErr);
        }
        document.getElementById('my-role-name').textContent = '取得エラー';
    }
}

// =============================================
// 生存状態チェック
// =============================================
export function checkMyAliveStatus() {
    const me = getCurrentPlayers().find(isMyPlayer);
    console.log('👻 [checkMyAliveStatus] me=', me?.name, 'is_alive=', me?.is_alive);
    if (me && !me.is_alive) {
        // 霊界カメラ使用時は「あなたは死亡しました」全画面を即座に非表示にする
        // （霊界カメラで他プレイヤーの視点を覗き見するため、画面をクリアにする）
        const ghostModeOverlay = document.getElementById('ghost-mode-overlay');
        if (ghostModeOverlay) {
            ghostModeOverlay.classList.add('hidden');
            ghostModeOverlay.style.display = 'none';
        }
        document.getElementById('night-action-overlay').classList.add('hidden');
        // 幽霊観戦モード：霊界カメラUIを有効化
        console.log('👻 幽霊モード有効化:', me);
        enableGhostSpectatorMode();
    } else {
        // 生存中は ghost-mode-overlay も霊界カメラも非表示
        const ghostModeOverlay = document.getElementById('ghost-mode-overlay');
        if (ghostModeOverlay) {
            ghostModeOverlay.classList.add('hidden');
            ghostModeOverlay.style.display = '';
        }
        disableGhostSpectatorMode();
    }
}

/**
 * 幽霊観戦モードをONにする（霊界カメラヘッダーを表示・視点を初期化）
 */
export function enableGhostSpectatorMode() {
    console.log('👻 [enableGhostSpectatorMode] 霊界カメラ起動');

    // 「あなたは死亡しました」全画面オーバーレイを確実に非表示にする
    // （これが残っていると霊界カメラの背面が真っ暗になり操作不能になる）
    const ghostModeOverlay = document.getElementById('ghost-mode-overlay');
    if (ghostModeOverlay) {
        ghostModeOverlay.classList.add('hidden');
        ghostModeOverlay.style.display = 'none';
    }

    // 既存の浮遊バナー/パネルは念のため隠す（残存DOM対策）
    const oldBanner = document.getElementById('ghost-spectator-banner');
    if (oldBanner) { oldBanner.classList.add('hidden'); oldBanner.style.display = ''; }
    const oldPanel = document.getElementById('ghost-spectator-panel');
    if (oldPanel) oldPanel.classList.add('hidden');
    const oldRolePanel = document.getElementById('ghost-role-list-panel');
    if (oldRolePanel) oldRolePanel.classList.add('hidden');

    // bodyにghost-camera-activeクラスを付与（上部余白確保用）
    document.body.classList.add('ghost-camera-active');

    // 霊界カメラヘッダーを生成・表示
    renderGhostCameraHeader();
}

/**
 * 幽霊観戦モードをOFFにする（霊界カメラヘッダーを隠す）
 */
export function disableGhostSpectatorMode() {
    const header = document.getElementById('ghost-camera-header');
    if (header) header.classList.add('hidden');

    // bodyのghost-camera-activeクラスを削除
    document.body.classList.remove('ghost-camera-active');

    // _ghostViewTargetNameをリセット（次の死亡時に再初期化させる）
    window._ghostViewTargetName = null;

    // 既存の浮遊バナー/パネルも念のため隠す
    const oldBanner = document.getElementById('ghost-spectator-banner');
    if (oldBanner) { oldBanner.classList.add('hidden'); oldBanner.style.display = ''; }
    const oldPanel = document.getElementById('ghost-spectator-panel');
    if (oldPanel) oldPanel.classList.add('hidden');
    const oldRolePanel = document.getElementById('ghost-role-list-panel');
    if (oldRolePanel) oldRolePanel.classList.add('hidden');
}

/**
 * 霊界カメラヘッダーを描画する（生存者タブ一覧を生成）
 */
function renderGhostCameraHeader() {
    const header = document.getElementById('ghost-camera-header');
    const tabs = document.getElementById('ghost-camera-tabs');
    if (!header || !tabs) return;

    // 自分が死亡しているか確認
    const me = getCurrentPlayers().find(isMyPlayer);
    if (!me || me.is_alive || getMyRoleType() !== 'player') {
        header.classList.add('hidden');
        return;
    }

    header.classList.remove('hidden');
    tabs.innerHTML = '';

    const alivePlayers = getCurrentPlayers().filter(p => p.is_alive);

    if (alivePlayers.length === 0) {
        tabs.innerHTML = '<span class="ghost-camera-no-alive">生存者なし</span>';
        return;
    }

    // 現在選択中の視点（state管理）
    const currentViewName = window._ghostViewTargetName || alivePlayers[0].name;
    // 初期値を設定
    if (!window._ghostViewTargetName) {
        window._ghostViewTargetName = alivePlayers[0].name;
    }

    const ROLE_BADGE = {
        '人狼': 'role-badge-wolf',
        '市民': 'role-badge-citizen',
        '預言者': 'role-badge-seer',
        '霊媒師': 'role-badge-medium',
        '騎士': 'role-badge-knight',
        'てるてる': 'role-badge-teruteru'
    };

    alivePlayers.forEach(p => {
        const btn = document.createElement('button');
        btn.className = `ghost-camera-tab${p.name === currentViewName ? ' active' : ''}`;
        btn.dataset.playerName = p.name;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'gct-name';
        nameSpan.textContent = p.name;

        const roleBadge = document.createElement('span');
        roleBadge.className = `gct-role ${ROLE_BADGE[p.role] || 'role-badge-unknown'}`;
        roleBadge.textContent = p.role || '???';

        btn.appendChild(nameSpan);
        btn.appendChild(roleBadge);
        btn.onclick = () => window.switchGhostViewTo(p.name);
        tabs.appendChild(btn);
    });

    // 現在の視点で画面を描画
    renderGhostViewFor(currentViewName);
}

/**
 * 霊界カメラ：指定プレイヤーの視点に切り替えてメイン画面を再描画
 * @param {string} playerName - 視点切り替え対象のプレイヤー名
 */
export function switchGhostViewTo(playerName) {
    console.log('👻 [switchGhostViewTo]', playerName);
    window._ghostViewTargetName = playerName;

    // タブのアクティブ状態を更新
    const tabs = document.querySelectorAll('.ghost-camera-tab');
    tabs.forEach(btn => {
        if (btn.dataset.playerName === playerName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 指定プレイヤーの視点で画面を描画
    renderGhostViewFor(playerName);
}

/**
 * 指定プレイヤーのデータに基づいてメインエリアをジャック描画する
 * @param {string} playerName - 視点対象プレイヤー名
 */
function renderGhostViewFor(playerName) {
    const target = getCurrentPlayers().find(p => p.name === playerName);
    if (!target) return;

    const phase = getLastKnownPhase();

    const ROLE_BADGE = {
        '人狼': 'role-badge-wolf',
        '市民': 'role-badge-citizen',
        '預言者': 'role-badge-seer',
        '霊媒師': 'role-badge-medium',
        '騎士': 'role-badge-knight',
        'てるてる': 'role-badge-teruteru'
    };

    // --- 役職エリア: 選択プレイヤーの「本当の役職」を開示表示 ---
    const myRoleArea = document.getElementById('my-role-area');
    if (myRoleArea) {
        myRoleArea.classList.remove('hidden');
        const roleNameEl = document.getElementById('my-role-name');
        if (roleNameEl) {
            setRoleFace(target.role || '???');
            // 役職バッジのクラスを反映
            roleNameEl.className = `my-role-name ghost-view-role ${ROLE_BADGE[target.role] || 'role-badge-unknown'}`;
        }
        // role-cover（タップして確認カバー）は幽霊視点なら常に開示状態にする
        const revealWrapper = document.getElementById('role-reveal-wrapper');
        if (revealWrapper) revealWrapper.classList.add('is-revealed');
    }

    // --- 夜フェーズ：選択プレイヤーの行動対象を表示（操作不可） ---
    if (phase === 'night') {
        const idToName = {};
        getCurrentPlayers().forEach(p => { idToName[p.id] = p.name; });
        const targetName = target.night_target_id ? (idToName[target.night_target_id] || '選択中…') : null;

        // 夜フェーズオーバーレイを表示
        const nightOverlay = document.getElementById('night-action-overlay');
        if (nightOverlay) nightOverlay.classList.remove('hidden');

        // 全夜UIを一旦隠す
        ['night-wolf', 'night-seer', 'night-medium', 'night-knight', 'night-waiting'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });

        // 対象プレイヤーの役職に応じたUIパネルを選択し、内容を書き換えて表示
        const NIGHT_PANEL_BY_ROLE = {
            '人狼': 'night-wolf',
            '預言者': 'night-seer',
            '霊媒師': 'night-medium',
            '騎士': 'night-knight'
        };
        const panelId = NIGHT_PANEL_BY_ROLE[target.role] || 'night-waiting';
        const panel = document.getElementById(panelId);

        if (panel) {
            panel.classList.remove('hidden');

            // ターゲットリストを「霊界視点（非活性）」で再描画
            const listId = {
                'night-wolf': 'wolf-target-list',
                'night-seer': 'seer-target-list',
                'night-medium': 'medium-target-list',
                'night-knight': 'knight-target-list'
            }[panelId];

            if (listId) {
                const listEl = document.getElementById(listId);
                if (listEl) {
                    // 全プレイヤーを非活性ボタンで描画（選択中のものをハイライト）
                    // 実際の候補リスト（action.js の render〇〇Targets）と同じ条件にそろえる
                    const candidates = getCurrentPlayers().filter(p => {
                        if (panelId === 'night-medium') return !p.is_alive;
                        if (panelId === 'night-wolf') return p.is_alive && p.name !== target.name && p.role !== '人狼';
                        return p.is_alive && p.name !== target.name;
                    });

                    if (candidates.length === 0) {
                        listEl.innerHTML = '<p class="empty-note">対象なし</p>';
                    } else {
                        listEl.innerHTML = '';
                        candidates.forEach(c => {
                            const btn = document.createElement('button');
                            btn.className = `target-btn ghost-view-btn${target.night_target_id === c.id ? ' ghost-selected' : ''}`;
                            btn.textContent = c.name;
                            btn.disabled = true;  // 幽霊側は操作不可
                            listEl.appendChild(btn);
                        });
                    }

                    // 行動サブミットボタンも非活性化
                    const submitBtnId = {
                        'night-wolf': 'btn-wolf-attack',
                        'night-seer': 'btn-seer-divinate',
                        'night-medium': 'btn-medium-action',
                        'night-knight': 'btn-knight-action'
                    }[panelId];
                    if (submitBtnId) {
                        const submitBtn = document.getElementById(submitBtnId);
                        if (submitBtn) {
                            submitBtn.disabled = true;
                            submitBtn.style.display = 'block';
                            submitBtn.style.opacity = '0.3';
                        }
                    }
                }
            }

            // 「誰を選択しているか」の情報テキストを追加（夜-waiting にも表示）
            let ghostInfo = panel.querySelector('.ghost-view-info');
            if (!ghostInfo) {
                ghostInfo = document.createElement('div');
                ghostInfo.className = 'ghost-view-info';
                panel.appendChild(ghostInfo);
            }
            if (targetName) {
                ghostInfo.innerHTML = `<strong>${escapeHTML(target.name)}</strong> の現在の選択: <span class="ghost-view-target-name">${escapeHTML(targetName)}</span>`;
            } else {
                ghostInfo.innerHTML = `<strong>${escapeHTML(target.name)}</strong> はまだ選択していません`;
            }
        }
    }
}

/**
 * 幽霊観戦モード：神視点 全プレイヤー役職一覧を描画
 * (後方互換のため残置。霊界カメラヘッダーのtab描画内に統合済み)
 */
export function renderGhostRoleList() {
    // 霊界カメラ方式では renderGhostCameraHeader() が役職バッジを表示するため、
    // renderPlayerList から呼ばれるこの関数はヘッダー更新のみ行う
    const me = getCurrentPlayers().find(isMyPlayer);
    if (!me || me.is_alive || getMyRoleType() !== 'player') return;
    renderGhostCameraHeader();
}

/**
 * 幽霊観戦モード：神視点 夜の行動状況をリアルタイム描画
 * (後方互換のため残置。霊界カメラ方式では renderGhostViewFor が担当)
 */
export function renderGhostNightActions() {
    // 霊界カメラ方式ではswitchGhostViewTo/renderGhostViewForが担当
    const me = getCurrentPlayers().find(isMyPlayer);
    if (!me || me.is_alive || getMyRoleType() !== 'player') return;
    // 現在の視点で再描画
    const currentViewName = window._ghostViewTargetName;
    if (currentViewName) {
        renderGhostViewFor(currentViewName);
    } else {
        renderGhostCameraHeader();
    }
}

// =============================================
// プレイヤーリスト描画
// =============================================
export function renderPlayerList() {
    playerList.innerHTML = '';

    // 自分が死亡中（幽霊）かどうか
    const myPlayer = getCurrentPlayers().find(isMyPlayer);
    const iAmGhost = getMyRoleType() === 'player' && myPlayer && !myPlayer.is_alive;

    getCurrentPlayers().forEach(p => {
        const div = document.createElement('div');
        div.className = `player-item ${p.is_alive ? '' : 'dead'}`;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        div.appendChild(nameSpan);

        if (getMyRoleType() === 'gm') {
            const actions = document.createElement('div');
            actions.className = 'player-item-actions';
            if (p.is_alive) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn-kill';
                btn.textContent = '追放';
                btn.onclick = () => window.killPlayer(p.id, p.name);
                actions.appendChild(btn);
            } else {
                const badge = document.createElement('span');
                badge.className = 'badge-dead';
                badge.textContent = '死亡';
                actions.appendChild(badge);
            }

            // GMだけが見える「キック」ボタン
            const kickBtn = document.createElement('button');
            kickBtn.type = 'button';
            kickBtn.className = 'btn-kick';
            kickBtn.textContent = 'キック';
            kickBtn.onclick = () => window.kickPlayer(p.id, p.name);
            actions.appendChild(kickBtn);
            div.appendChild(actions);
        } else if (iAmGhost && p.role) {
            // 幽霊（死亡プレイヤー）には全員の役職バッジを表示（神視点）
            const ROLE_BADGE = {
                '人狼': 'role-badge-wolf',
                '市民': 'role-badge-citizen',
                '預言者': 'role-badge-seer',
                '霊媒師': 'role-badge-medium',
                '騎士': 'role-badge-knight',
                'てるてる': 'role-badge-teruteru'
            };
            const ghostBadge = document.createElement('span');
            ghostBadge.className = `badge-dead ${ROLE_BADGE[p.role] || 'role-badge-unknown'}`;
            ghostBadge.textContent = p.role;
            div.appendChild(ghostBadge);
        }
        playerList.appendChild(div);
    });

    setCurrentPlayersCount(getCurrentPlayers().length);
    updateTotalInfo();

    // 幽霊モード中なら神視点パネルも更新
    if (iAmGhost) {
        renderGhostRoleList();
        if (getLastKnownPhase() === 'night') {
            renderGhostNightActions();
        }
    }
}

// =============================================
// 考察メモ描画
// =============================================
export function renderMemoList() {
    const memoPlayerList = document.getElementById('memo-player-list');
    if (!memoPlayerList) return;

    // ログイン中の自分のプレイヤー情報を探索してIDを取得
    const myPlayer = getCurrentPlayers().find(isMyPlayer);
    const myPlayerId = myPlayer ? myPlayer.id : null;

    // 自分自身の情報が取得できるまで待機（初期ロード対策）
    if (!myPlayerId) {
        memoPlayerList.innerHTML = '<p class="empty-note">プレイヤー情報取得中...</p>';
        return;
    }

    // すでに「情報取得中」等のテキストがある場合はクリア
    if (memoPlayerList.children.length === 1 && memoPlayerList.firstElementChild.id === '') {
        memoPlayerList.innerHTML = '';
    }

    const aliveIds = new Set(getCurrentPlayers().map(p => p.id));

    // 1. 存在しなくなったプレイヤーのメモ要素を削除
    const existingItems = memoPlayerList.querySelectorAll('.memo-item');
    existingItems.forEach(item => {
        const id = item.dataset.playerId;
        if (!aliveIds.has(id)) {
            item.remove();
        }
    });

    // 2. プレイヤーごとに要素を作成または更新
    getCurrentPlayers().forEach(p => {
        const targetPlayerId = p.id;
        const key = `werewolf_memo_1_${myPlayerId}_${targetPlayerId}`;

        let itemEl = document.getElementById(`memo-item-${targetPlayerId}`);

        if (!itemEl) {
            // 新規作成
            itemEl = document.createElement('div');
            itemEl.id = `memo-item-${targetPlayerId}`;
            itemEl.dataset.playerId = targetPlayerId;
            itemEl.className = 'memo-item';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'memo-player-name';
            nameDiv.textContent = p.name;
            itemEl.appendChild(nameDiv);

            const textarea = document.createElement('textarea');
            textarea.className = 'memo-textarea';
            textarea.placeholder = `${p.name} さんの考察メモ...`;
            textarea.value = localStorage.getItem(key) || '';

            // 入力時に自動保存
            textarea.addEventListener('input', (e) => {
                localStorage.setItem(key, e.target.value);
            });

            itemEl.appendChild(textarea);

            // 新規作成時のみDOMの末尾に追加する（順序移動によるフォーカス外れを防ぐ）
            memoPlayerList.appendChild(itemEl);

            // 生死状態のクラスを初期設定
            if (p.is_alive) {
                itemEl.classList.remove('dead');
            } else {
                itemEl.classList.add('dead');
            }
        } else {
            // 既存更新
            // この要素内の textarea が現在フォーカス（入力中）されている場合は、一切の更新をスルーする
            const textarea = itemEl.querySelector('.memo-textarea');
            if (textarea && document.activeElement === textarea) {
                // 入力中は安全のため完全にスキップ
                return;
            }

            // フォーカスされていない場合のみ更新を行う
            const nameDiv = itemEl.querySelector('.memo-player-name');
            if (nameDiv && nameDiv.textContent !== p.name) {
                nameDiv.textContent = p.name;
            }

            // 生死状態のクラスを更新
            if (p.is_alive) {
                itemEl.classList.remove('dead');
            } else {
                itemEl.classList.add('dead');
            }
        }
    });
}

// =============================================
// 考察メモ 一括リセット
// =============================================
export function resetMemos() {
    if (!confirm('全プレイヤーの考察メモを消去しますか？（この操作は元に戻せません）')) return;

    const myPlayer = getCurrentPlayers().find(isMyPlayer);
    const myPlayerId = myPlayer ? myPlayer.id : null;
    if (!myPlayerId) return;

    // localStorageから全メモキーを削除
    getCurrentPlayers().forEach(p => {
        const key = `werewolf_memo_1_${myPlayerId}_${p.id}`;
        localStorage.removeItem(key);
    });

    // 画面上のテキストエリアもクリア
    const memoPlayerList = document.getElementById('memo-player-list');
    if (memoPlayerList) {
        memoPlayerList.querySelectorAll('.memo-textarea').forEach(ta => {
            ta.value = '';
        });
    }
}

// =============================================
// スマホ用メモドロワー
// =============================================
export function toggleMobileMemo() {
    const sidebar = document.getElementById('left-sidebar');
    if (!sidebar) return;

    const isShowing = sidebar.classList.toggle('show-mobile');

    // 背面の暗幕オーバーレイの制御
    let overlay = document.getElementById('memo-mobile-overlay');
    if (isShowing) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'memo-mobile-overlay';
            overlay.className = 'memo-mobile-overlay';
            overlay.onclick = () => toggleMobileMemo(); // 暗幕タップで閉じる
            document.body.appendChild(overlay);
        }
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        void overlay.offsetWidth; // リフローを強制してトランジションを効かせる
        overlay.style.opacity = '1';
    } else {
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                // アニメーション完了時にまだ閉じられている場合のみ隠す
                if (!sidebar.classList.contains('show-mobile') && overlay) {
                    overlay.classList.add('hidden');
                }
            }, 300);
        }
    }
}

// =============================================
// リザルト画面
// =============================================
export async function showResultScreen() {
    if (getVoteCountdownTimer()) { clearInterval(getVoteCountdownTimer()); setVoteCountdownTimer(null); }

    // 最優先：GM画面などで投票結果オーバーレイが被さったままになるバグを防ぐため、強制的に非表示にする
    document.getElementById('vote-result-overlay').classList.add('hidden');

    if (getResultShown()) return;
    setResultShown(true);

    const overlay = document.getElementById('result-overlay');
    overlay.classList.remove('hidden');

    let winner = getPendingWinner();
    if (!winner) {
        try {
            const { data, error } = await supabaseClient
                .from('game_status')
                .select('winner')
                .eq('id', 1)
                .single();
            if (!error && data && data.winner) {
                winner = data.winner;
            }
        } catch (e) {
            console.warn('winner フィールドの取得に失敗:', e);
        }
    }

    if (!winner) {
        const aliveWolves = getCurrentPlayers().filter(p => p.is_alive && p.role === '人狼');
        winner = aliveWolves.length === 0 ? 'citizen' : 'wolf';
    }

    const isCitizen = winner === 'citizen';
    const isWolf = winner === 'wolf';
    const isTeruteru = winner === 'teruteru' || winner === 'てるてる';

    // 結果発表は昼の照明
    setLightForPhase('result');
    overlay.classList.toggle('teruteru-win', isTeruteru);
    overlay.classList.toggle('citizen-win', !isTeruteru && isCitizen);
    overlay.classList.toggle('wolf-win', !isTeruteru && !isCitizen);

    // 大見出し（狼／家／てるてるのマーク）と一言の理由
    const iconId = isTeruteru ? 'i-teru' : (isCitizen ? 'i-house' : 'i-wolf');
    document.getElementById('result-icon').innerHTML = iconHtml(iconId);

    const titleEl = document.getElementById('result-title');
    if (isTeruteru) {
        titleEl.className = 'result-title teruteru';
        titleEl.textContent = 'てるてるの勝ち';
    } else {
        titleEl.className = `result-title ${isCitizen ? 'citizen' : 'wolf'}`;
        titleEl.textContent = isCitizen ? '村人の勝ち' : '人狼の勝ち';
    }

    if (isTeruteru) {
        document.getElementById('result-subtitle').textContent = 'てるてるが昼の投票で追放されました';
    } else {
        document.getElementById('result-subtitle').textContent = isCitizen
            ? '人狼を全員追放しました'
            : '人狼の数が村人の数に並びました';
    }

    await renderResultPlayerList();

    const btnReturn = document.getElementById('btn-return-lobby');
    if (getMyRoleType() === 'gm') {
        btnReturn.classList.remove('hidden');
    } else {
        btnReturn.classList.add('hidden');
    }
}

export async function renderResultPlayerList() {
    const listEl = document.getElementById('result-player-list');
    listEl.innerHTML = '<p class="empty-note">読み込み中...</p>';

    // 死亡ログは結果発表の直前に取り直す（取れなければ手元の値を使う）
    let deathLog = getDeathLog();
    try {
        const { data: statusRow, error: logError } = await supabaseClient
            .from('game_status')
            .select('death_log')
            .eq('id', 1)
            .maybeSingle();
        if (logError) throw logError;
        if (statusRow && Array.isArray(statusRow.death_log)) deathLog = statusRow.death_log;
    } catch (logErr) {
        console.error('[DEATH_LOG] 結果発表用の死亡ログの取得に失敗しました:', logErr);
    }

    try {
        const { data: players, error } = await supabaseClient
            .from('players')
            .select('id, name, is_alive, role')
            .order('name', { ascending: true });

        if (error) throw error;

        listEl.innerHTML = '';

        if (!players || players.length === 0) {
            listEl.innerHTML = '<p class="empty-note">プレイヤー情報が見つかりません</p>';
            return;
        }

        players.forEach((p) => {
            // 全員の行：小さな役職カード・名前（と役職）・状態
            const item = document.createElement('div');
            // hideVoteDetails=ON の場合、役職でのスタイリングも行わない（人狼判定も隠す）
            const isWolf = !getHideVoteDetails() && p.role === '人狼';
            item.className = `result-player-item${isWolf ? ' is-wolf' : ''}`;

            // hideVoteDetails=ON の場合、役職を表示しない（役職漏洩防止）
            const card = document.createElement('div');
            if (getHideVoteDetails()) {
                card.className = 'mini-role-card is-hidden';
            } else {
                card.className = 'mini-role-card';
                card.innerHTML = iconHtml(ROLE_MARK[p.role] || 'i-question');
            }
            item.appendChild(card);

            const nameDiv = document.createElement('div');
            nameDiv.className = 'result-player-name';
            nameDiv.appendChild(document.createTextNode(p.name));
            if (!getHideVoteDetails()) {
                const roleSpan = document.createElement('span');
                roleSpan.className = 'result-player-role';
                roleSpan.textContent = p.role || '役職なし';
                nameDiv.appendChild(roleSpan);
            }
            item.appendChild(nameDiv);

            // 死亡ログから「1日目の夜に襲撃」「2日目に追放」など。ログに無い死亡者は「死亡」
            const status = document.createElement('span');
            status.className = `result-status${p.is_alive ? '' : ' is-dead'}`;
            const deathEntry = deathLog.find(entry => String(entry.player_id) === String(p.id));
            status.textContent = p.is_alive ? '生存' : (deathEntry ? deathStatusText(deathEntry) : '死亡');
            item.appendChild(status);

            listEl.appendChild(item);
        });

    } catch (err) {
        console.error('リザルトプレイヤー一覧取得エラー:', err);
        listEl.innerHTML = '<p class="empty-note">プレイヤー情報の取得に失敗しました</p>';
    }
}

// =============================================
// 投票UI
// =============================================
export function renderVoteUI() {
    const overlay = document.getElementById('vote-overlay');
    const selectPanel = document.getElementById('vote-select');
    const donePanel = document.getElementById('vote-done');
    const ghostPanel = document.getElementById('vote-ghost');

    overlay.classList.remove('hidden');
    selectPanel.classList.add('hidden');
    donePanel.classList.add('hidden');
    ghostPanel.classList.add('hidden');

    const me = getCurrentPlayers().find(isMyPlayer);
    if (!me || !me.is_alive) {
        ghostPanel.classList.remove('hidden');
        return;
    }

    if (getHasVotedToday() || me.vote_target_id) {
        setHasVotedToday(true);
        donePanel.classList.remove('hidden');
    } else {
        selectPanel.classList.remove('hidden');
        renderVoteTargets();
    }
}

export function renderVoteTargets() {
    const list = document.getElementById('vote-target-list');
    list.innerHTML = '';

    const submitBtn = document.getElementById('btn-vote-submit');
    if (submitBtn) {
        submitBtn.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.onclick = null;
    }
    const closedNote = document.getElementById('vote-closed-note');
    if (closedNote) closedNote.classList.add('hidden');
    const skipBtn = document.getElementById('btn-vote-skip');
    if (skipBtn) skipBtn.disabled = false;

    const targets = getCurrentPlayers().filter(p => p.is_alive && !isMyPlayer(p));

    if (targets.length === 0) {
        list.innerHTML = '<p class="empty-note">投票できるプレイヤーがいません</p>';
        return;
    }

    // 名前カードを選ぶ →「○○さんに投票」で投票（確認ダイアログは submitVote の中）
    targets.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'target-btn';
        btn.textContent = t.name;
        btn.onclick = () => {
            list.querySelectorAll('.target-btn').forEach(x => x.classList.remove('selected'));
            btn.classList.add('selected');
            if (submitBtn) {
                submitBtn.textContent = `${t.name}さんに投票`;
                submitBtn.style.display = '';
                submitBtn.onclick = () => window.submitVote(t.name, t.id);
            }
        };
        list.appendChild(btn);
    });
}

export function updateVoteProgress() {
    const SKIP_SENTINEL = '00000000-0000-0000-0000-000000000000';
    const alivePlayers = getCurrentPlayers().filter(p => p.is_alive);
    // 投票済み：vote_target_idが設定されている（スキップセンチネル含む）
    const votedPlayers = alivePlayers.filter(p => p.vote_target_id && p.vote_target_id !== null);
    const total = alivePlayers.length;
    const voted = votedPlayers.length;

    const textEl = document.getElementById('vote-progress-text');
    const fillEl = document.getElementById('vote-progress-fill');
    if (textEl) textEl.textContent = `${voted} / ${total}人が投票済み`;
    if (fillEl) fillEl.style.width = total > 0 ? `${(voted / total) * 100}%` : '0%';

    const pTextEl = document.getElementById('vote-progress-text-player');
    const pFillEl = document.getElementById('vote-progress-fill-player');
    if (pTextEl) pTextEl.textContent = `${voted} / ${total}人が投票済み`;
    if (pFillEl) pFillEl.style.width = total > 0 ? `${(voted / total) * 100}%` : '0%';
}

export async function showVoteResult(exiledName, voteLog) {
    const overlay = document.getElementById('vote-result-overlay');
    overlay.classList.remove('hidden');

    // 追放者の表示
    const exileEl = document.getElementById('vote-result-exile');
    if (exiledName) {
        exileEl.innerHTML = `「${escapeHTML(exiledName)}」が<br>追放されました`;
        exileEl.classList.remove('is-none');
    } else {
        // 処刑なし
        exileEl.innerHTML = '本日は誰も追放されませんでした';
        exileEl.classList.add('is-none');
    }

    // 投票ログの描画
    const listEl = document.getElementById('vote-result-list');
    listEl.innerHTML = '';

    // GM以外が呼び出した場合（Realtime経由）、自前で currentPlayers から voteLog を生成して全公開する
    let finalVoteLog = voteLog;
    if (!finalVoteLog) {
        const idToName = {};
        getCurrentPlayers().forEach(p => { idToName[p.id] = p.name; });
        finalVoteLog = getCurrentPlayers()
            .filter(p => p.vote_target_id)
            .map(p => ({
                voter: p.name,
                target: idToName[p.vote_target_id] || '不明'
            }));
    }

    // 幽霊（死亡プレイヤー）は hideVoteDetails が ON でも全ログを見られる（神視点）
    const myPlayerForVote = getCurrentPlayers().find(isMyPlayer);
    const iAmGhostForVote = getMyRoleType() === 'player' && myPlayerForVote && !myPlayerForVote.is_alive;

    if (getHideVoteDetails() && !iAmGhostForVote) {
        // ── シークレット投票モード: 票数集計のみ表示 ──
        const tally = {};
        if (finalVoteLog && finalVoteLog.length > 0) {
            finalVoteLog.forEach(entry => {
                if (entry.target) {
                    tally[entry.target] = (tally[entry.target] || 0) + 1;
                }
            });
        }

        const secretHeader = document.createElement('div');
        secretHeader.className = 'vote-secret-note';
        secretHeader.innerHTML = `${iconHtml('i-lock')}投票内容は非公開です`;
        listEl.appendChild(secretHeader);

        const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            sorted.forEach(([name, count], i) => {
                const item = document.createElement('div');
                item.className = 'vote-log-item';

                const nameSpan = document.createElement('span');
                nameSpan.className = name === exiledName ? 'target' : 'voter';
                nameSpan.textContent = name === exiledName ? `${name} ★` : name;

                const countSpan = document.createElement('span');
                countSpan.className = 'arrow';
                countSpan.textContent = `… ${count}票`;

                item.appendChild(nameSpan);
                item.appendChild(countSpan);
                listEl.appendChild(item);
            });
        } else {
            listEl.insertAdjacentHTML('beforeend', '<p class="empty-note">投票記録がありません</p>');
        }
    } else {
        // ── 通常モード: 全ログ表示 ──
        if (finalVoteLog && finalVoteLog.length > 0) {
            finalVoteLog.forEach((entry, i) => {
                const item = document.createElement('div');
                item.className = 'vote-log-item';

                const voterSpan = document.createElement('span');
                voterSpan.className = 'voter';
                voterSpan.textContent = entry.voter;

                const arrowSpan = document.createElement('span');
                arrowSpan.className = 'arrow';
                arrowSpan.textContent = '→';

                const targetSpan = document.createElement('span');
                if (entry.target) {
                    targetSpan.className = 'target';
                    targetSpan.textContent = entry.target === exiledName
                        ? `${entry.target} ★`
                        : entry.target;
                } else {
                    targetSpan.className = 'abstain';
                    targetSpan.textContent = '（棄権）';
                }

                item.appendChild(voterSpan);
                item.appendChild(arrowSpan);
                item.appendChild(targetSpan);
                listEl.appendChild(item);
            });
        } else {
            listEl.innerHTML = '<p class="empty-note">投票記録がありません</p>';
        }
    }

    // 幽霊向け：シークレット投票でも全ログを追記表示
    if (iAmGhostForVote && getHideVoteDetails() && finalVoteLog && finalVoteLog.length > 0) {
        const ghostRevealDiv = document.createElement('div');
        ghostRevealDiv.className = 'ghost-vote-log-reveal';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'ghost-vote-log-reveal-title';
        titleDiv.textContent = '神視点：全員の投票内訳';
        ghostRevealDiv.appendChild(titleDiv);

        finalVoteLog.forEach((entry, i) => {
            const row = document.createElement('div');
            row.className = 'vote-log-item';

            const voterSpan = document.createElement('span');
            voterSpan.className = 'voter';
            voterSpan.textContent = entry.voter;

            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'arrow';
            arrowSpan.textContent = '→';

            const targetSpan = document.createElement('span');
            if (entry.target) {
                targetSpan.className = 'target';
                targetSpan.textContent = entry.target === exiledName ? `${entry.target} ★` : entry.target;
            } else {
                targetSpan.className = 'abstain';
                targetSpan.textContent = '（棄権）';
            }

            row.appendChild(voterSpan);
            row.appendChild(arrowSpan);
            row.appendChild(targetSpan);
            ghostRevealDiv.appendChild(row);
        });
        listEl.appendChild(ghostRevealDiv);
    }

    // GMのみ「夜フェーズへ」ボタンを表示
    const btnNight = document.getElementById('btn-next-night');
    if (getMyRoleType() === 'gm') {
        btnNight.classList.remove('hidden');
    } else {
        btnNight.classList.add('hidden');
    }

    // 全員：7秒カウントダウン後に自動で夜フェーズへ遷移（GMは手動ボタンでも可）
    const countdownEl = document.getElementById('vote-countdown');
    countdownEl.classList.remove('hidden');
    let sec = 7;
    countdownEl.textContent = `${sec}秒後に夜フェーズへ自動遷移...`;

    if (getVoteCountdownTimer()) clearInterval(getVoteCountdownTimer());
    const timer = setInterval(() => {
        sec--;
        if (sec <= 0) {
            clearInterval(timer);
            setVoteCountdownTimer(null);
            window.proceedToNight();
        } else {
            countdownEl.textContent = `${sec}秒後に夜フェーズへ自動遷移...`;
        }
    }, 1000);
    setVoteCountdownTimer(timer);
}

// =============================================
// 朝フェーズ：犠牲者表示
// =============================================
/**
 * game_status.morning_message（'{"victim_ids":[...]}'）から犠牲者の id を取り出す
 * 記録がない・壊れている場合は null
 */
function parseMorningVictimIds(message) {
    if (typeof message !== 'string' || !message) return null;
    try {
        const parsed = JSON.parse(message);
        return parsed && Array.isArray(parsed.victim_ids) ? parsed.victim_ids : null;
    } catch (e) {
        console.warn('[MORNING] morning_message を読めませんでした:', message);
        return null;
    }
}

export function showMorningVictims() {
    const textEl = document.getElementById('victim-result-text');
    if (!textEl) return;

    const players = getCurrentPlayers();
    let victims;

    // 夜→朝の集計で記録した「実際に襲撃で死亡した人」を表示する
    const recordedIds = parseMorningVictimIds(getMorningMessage());
    if (recordedIds) {
        victims = recordedIds.map(id => players.find(p => p.id === id)).filter(Boolean);
    } else {
        // 記録が読めないときだけ、従来どおり「人狼が選んだ人のうち死んでいる人」から推測する
        const wolfTargetIds = [...new Set(players
            .filter(p => p.role === '人狼' && p.night_target_id)
            .map(p => p.night_target_id))];
        victims = players.filter(p => wolfTargetIds.includes(p.id) && !p.is_alive);
    }

    // 犠牲者は少し傾けた名前カード＋「昨晩の犠牲者」「○○さん」
    if (victims.length > 0) {
        const cards = victims.map(v => `<div class="victim-card">${escapeHTML(v.name)}</div>`).join('');
        const victimNames = victims.map(v => `${escapeHTML(v.name)}さん`).join('、');
        textEl.innerHTML = `
            <div class="victim-cards">${cards}</div>
            <div class="victim-label">昨晩の犠牲者</div>
            <div class="victim-names">${victimNames}</div>
        `;
    } else {
        textEl.innerHTML = `
            <div class="victim-cards"><div class="victim-card is-empty"></div></div>
            <div class="victim-label">昨晩の犠牲者</div>
            <div class="victim-names">昨晩は誰も死にませんでした。</div>
        `;
    }
}

// =============================================
// 朝フェーズ：あなたの結果（全員共通のカード。本文だけ役職で変わる）
// =============================================
// 古い呼び出しの結果で新しい表示を上書きしないための連番
let myResultRequestId = 0;

/** 本文は2行の枠。1行で済む文言は2行目を空にする（カードの高さを全員そろえるため） */
function setMyResultLines(line1Html, line2Html = '') {
    document.getElementById('my-result-line1').innerHTML = line1Html;
    document.getElementById('my-result-line2').innerHTML = line2Html;
}

/**
 * 「🌙 あなたの結果」カードを表示する
 * 全員まず「確認中…」→ DB の自分の行を読む → 内容、の同じ流れにする（役職で待ち時間・表示の流れが変わらないように）
 *   - 預言者・霊媒師：「〇〇」さんは【人狼／人間】でした（結果がまだ届いていなければ「確認中…」のまま。届いたら main.js から呼び直す）
 *   - 人狼・騎士：あなたは「〇〇」さんを選びました
 *   - ダミー質問：「（質問文）」→ あなたは「〇〇」さんを選びました（sessionStorage の昨晩の回答）
 *   - 何も選ばなかった：昨晩は誰も選びませんでした
 */
export async function showMyNightResult() {
    const area = document.getElementById('my-result-area');
    if (!area) return;

    const requestId = ++myResultRequestId;
    area.classList.remove('hidden');
    setMyResultLines('確認中…');

    let data;
    try {
        const res = await supabaseClient
            .from('players')
            .select('role, is_alive, night_result, night_target_id')
            .eq('id', getMyPlayerId())
            .maybeSingle();
        if (res.error) throw res.error;
        data = res.data;
    } catch (err) {
        // 取得に失敗したら「確認中…」のまま（次の Realtime 更新で呼び直される）
        console.warn('[MORNING] あなたの結果の取得エラー:', err);
        return;
    }
    if (requestId !== myResultRequestId || getLastKnownPhase() !== 'morning') return;

    if (data && data.night_target_id) {
        const target = getCurrentPlayers().find(p => p.id === data.night_target_id);
        const targetName = escapeHTML(target ? target.name : '不明');
        const role = data.role || getMyRoleName();
        const isInspector = role === '預言者' || role === '霊媒師';

        // アクセント色の語は全員ちょうど1つ（預言者・霊媒師は判定、それ以外は選んだ相手）にして、遠目に役職が分からないようにする
        if (isInspector && data.night_result) {
            const label = data.night_result === '人狼' ? '【人狼】' : '【人間】';
            setMyResultLines(`「${targetName}」さんは <strong class="result-accent">${label}</strong> でした`);
        } else if (isInspector && data.is_alive) {
            // 結果がまだ届いていない → 「確認中…」のまま待つ
        } else {
            // 人狼・騎士（結果のない役職）や、夜のうちに死亡して結果が出ない預言者・霊媒師
            setMyResultLines(`あなたは「<strong class="result-accent">${targetName}</strong>」さんを選びました`);
        }
        return;
    }

    // 朝のタイムライン番号は「昨晩の夜の番号 + 1」
    const dummy = getDummyNightState(getCurrentTimelineIndex() - 1);
    if (dummy && dummy.answerId) {
        const question = DUMMY_QUESTIONS[dummy.q] || '';
        setMyResultLines(`「${escapeHTML(question)}」`, `あなたは「<strong class="result-accent">${escapeHTML(dummy.answerName)}</strong>」さんを選びました`);
        return;
    }

    setMyResultLines('昨晩は誰も選びませんでした');
}

export function hideMyNightResult() {
    myResultRequestId++;
    const area = document.getElementById('my-result-area');
    if (area) area.classList.add('hidden');
}

// =============================================
// GM用夜フェーズ行動状況インジケーター
// =============================================
export function renderNightActionStatus() {
    const statusEl = document.getElementById('night-action-status');
    if (!statusEl) return;

    if (getMyRoleType() !== 'gm' || getLastKnownPhase() !== 'night') {
        statusEl.classList.add('hidden');
        // 幽霊プレイヤーの夜行動パネルも更新
        const myP = getCurrentPlayers().find(isMyPlayer);
        if (getMyRoleType() === 'player' && myP && !myP.is_alive && getLastKnownPhase() === 'night') {
            renderGhostNightActions();
        } else if (getMyRoleType() === 'player') {
            const panel = document.getElementById('ghost-spectator-panel');
            if (panel) panel.classList.add('hidden');
        }
        return;
    }

    const alivePlayers = getCurrentPlayers().filter(p => p.is_alive && p.role);
    if (alivePlayers.length === 0) {
        statusEl.classList.add('hidden');
        return;
    }

    statusEl.classList.remove('hidden');

    const acted = alivePlayers.filter(p => !NIGHT_ACTION_ROLES.includes(p.role) || !!p.night_target_id).length;
    const total = alivePlayers.length;

    let html = `<div class="night-status-header"><span class="night-status-title">${iconHtml('i-moon')}夜の行動状況</span><span class="night-status-count">${acted} / ${total}人 完了</span></div><div class="night-status-list">`;

    alivePlayers.forEach(p => {
        const needsAction = NIGHT_ACTION_ROLES.includes(p.role);
        const hasActed = !needsAction || !!p.night_target_id;
        const icon = hasActed ? iconHtml('i-check') : iconHtml('i-clock');
        const statusClass = hasActed ? 'acted' : 'pending';
        html += `<div class="night-status-item ${statusClass}"><span class="night-status-icon">${icon}</span><span class="night-status-name">${escapeHTML(p.name)}</span><span class="night-status-role">${needsAction ? escapeHTML(p.role) : '（行動なし）'}</span></div>`;
    });

    html += '</div>';
    statusEl.innerHTML = html;
}

// =============================================
// タイムライン描画・GM進行ボタン更新
// =============================================
export function renderTimeline() {
    const listEl = document.getElementById('timeline-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    const currentTimelineIndex = getCurrentTimelineIndex();

    // 上のバーのフェーズ名の下に「○日目・時限」を小さく出す
    const phaseSub = document.getElementById('phase-sub');
    const currentStep = GAME_TIMELINE[currentTimelineIndex];
    if (phaseSub && currentStep) {
        const day = dayOfTimelineIndex(currentTimelineIndex);
        phaseSub.textContent = day !== null ? `${day}日目・${currentStep.period}` : currentStep.period;
    }

    GAME_TIMELINE.forEach((step, idx) => {
        const item = document.createElement('div');
        item.id = `timeline-item-${idx}`;

        // 過去・現在・未来のクラス判定
        let stateClass = 'is-future';

        if (idx < currentTimelineIndex) {
            stateClass = 'is-past';
        } else if (idx === currentTimelineIndex) {
            stateClass = 'is-current';
        }

        item.className = `timeline-item ${stateClass}`;

        item.innerHTML = `
            <div class="timeline-period-badge">${step.period}</div>
            <div class="timeline-label-text">${step.label}</div>
        `;

        listEl.appendChild(item);

        // 現在のステップを自動スクロールで視認しやすくする
        if (idx === currentTimelineIndex) {
            setTimeout(() => {
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    });
}

// =============================================
// 右の列のタブ（進行／記録）と死亡ログ
// =============================================
let activeSideTab = 'timeline';
// 「記録」タブで見たことにした件数（これより増えたらタブに丸を出す）
let deathLogSeenCount = 0;

const DEATH_CAUSE_TEXT = { attack: '襲撃', exile: '追放', gm: 'GMにより追放' };

/** 記録の日付欄（襲撃は「N日目の夜」、それ以外は「N日目」、日付不明は「—」） */
function deathDayLabel(entry) {
    if (entry.day === null || entry.day === undefined) return '—';
    return entry.cause === 'attack' ? `${entry.day}日目の夜` : `${entry.day}日目`;
}

/** 結果発表の各行の右側（「1日目の夜に襲撃」「2日目に追放」「2日目にGMが追放」） */
function deathStatusText(entry) {
    const hasDay = entry.day !== null && entry.day !== undefined;
    if (entry.cause === 'attack') return hasDay ? `${entry.day}日目の夜に襲撃` : '襲撃';
    if (entry.cause === 'exile') return hasDay ? `${entry.day}日目に追放` : '追放';
    if (entry.cause === 'gm') return hasDay ? `${entry.day}日目にGMが追放` : 'GMが追放';
    return '死亡';
}

export function switchSideTab(tab) {
    activeSideTab = tab === 'log' ? 'log' : 'timeline';
    const isLog = activeSideTab === 'log';

    const tabTimeline = document.getElementById('side-tab-timeline');
    const tabLog = document.getElementById('side-tab-log');
    if (tabTimeline && tabLog) {
        tabTimeline.setAttribute('aria-selected', String(!isLog));
        tabLog.setAttribute('aria-selected', String(isLog));
        tabTimeline.tabIndex = isLog ? -1 : 0;
        tabLog.tabIndex = isLog ? 0 : -1;
    }
    document.getElementById('timeline-list')?.classList.toggle('hidden', isLog);
    document.getElementById('death-log-panel')?.classList.toggle('hidden', !isLog);

    // 「記録」を開いたら既読にして丸を消す
    if (isLog) {
        deathLogSeenCount = getDeathLog().length;
        document.getElementById('death-log-dot')?.classList.add('hidden');
    }
}

/** タブを左右キーでも切り替えられるようにする */
export function onSideTabKeydown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = activeSideTab === 'log' ? 'timeline' : 'log';
    switchSideTab(next);
    document.getElementById(next === 'log' ? 'side-tab-log' : 'side-tab-timeline')?.focus();
}

/**
 * 死亡ログ（「記録」タブ）を描画する
 * 新しい記録が増えたとき「記録」タブを開いていなければ、タブに丸を出す（全員の画面で同じタイミングで出る）
 * @param {{ markAsSeen?: boolean }} [options] - markAsSeen: 今ある記録を既読扱いにする（ページを開いたとき）
 */
export function renderDeathLog({ markAsSeen = false } = {}) {
    const list = document.getElementById('death-log-list');
    if (!list) return;
    const log = getDeathLog();

    list.innerHTML = '';
    if (log.length === 0) {
        list.innerHTML = '<li class="death-log-empty">まだ誰も脱落していません</li>';
    } else {
        log.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'death-log-item';

            const daySpan = document.createElement('span');
            daySpan.className = 'death-log-day';
            daySpan.textContent = deathDayLabel(entry);

            const textSpan = document.createElement('span');
            textSpan.className = 'death-log-text';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'death-log-name';
            nameSpan.textContent = `${entry.name}さん`;
            const causeSpan = document.createElement('span');
            causeSpan.className = 'death-log-cause';
            causeSpan.textContent = DEATH_CAUSE_TEXT[entry.cause] || '脱落';
            textSpan.appendChild(nameSpan);
            textSpan.appendChild(causeSpan);

            li.appendChild(daySpan);
            li.appendChild(textSpan);
            list.appendChild(li);
        });
    }

    // 既読の件数を更新（記録タブを開いている・ページを開いた直後・リセットで減ったとき）
    if (markAsSeen || activeSideTab === 'log' || log.length < deathLogSeenCount) {
        deathLogSeenCount = log.length;
    }
    document.getElementById('death-log-dot')?.classList.toggle('hidden', log.length <= deathLogSeenCount);
}

export function updateGmTimelineButtons() {
    const btnNext = document.getElementById('btn-next-step');
    const btnPrev = document.getElementById('btn-prev-step');
    if (!btnNext || !btnPrev) return;

    const currentTimelineIndex = getCurrentTimelineIndex();
    const lastKnownPhase = getLastKnownPhase();
    const pendingWinner = getPendingWinner();

    // 【バグ2修正】勝者が確定済み（まだ result フェーズになっていない）場合は強制ジャンプボタンを表示
    if (pendingWinner && lastKnownPhase !== 'result') {
        btnNext.textContent = '勝利確定！ 終礼（結果発表）へジャンプ';
        btnNext.style.opacity = '';
        btnNext.style.cursor = '';
        btnPrev.style.display = 'none';
        return;
    }

    // 「戻る」ボタンの制御（最初の待機状態なら非表示）
    if (currentTimelineIndex === 0 && lastKnownPhase === 'waiting') {
        btnPrev.style.display = 'none';
    } else {
        btnPrev.style.display = 'inline-block';
    }

    // 「次へ進む」ボタンのテキスト設定（opacityなどのインラインスタイルを念のためリセット）
    btnNext.style.opacity = '';
    btnNext.style.cursor = '';

    if (lastKnownPhase === 'waiting') {
        btnNext.textContent = 'ゲーム開始 (役職確認へ)';
    } else if (lastKnownPhase === 'confirm_role') {
        const nextStep = GAME_TIMELINE[currentTimelineIndex + 1];
        const nextPeriod = nextStep ? nextStep.period : '次';
        btnNext.textContent = `[${nextPeriod}] 夜フェーズへ (1日目夜)`;
    } else if (lastKnownPhase === 'night') {
        const nextStep = GAME_TIMELINE[currentTimelineIndex + 1];
        const nextPeriod = nextStep ? nextStep.period : '次';
        btnNext.textContent = `[${nextPeriod}] 朝フェーズへ (犠牲者発表)`;
    } else if (lastKnownPhase === 'morning') {
        const nextStep = GAME_TIMELINE[currentTimelineIndex + 1];
        const nextPeriod = nextStep ? nextStep.period : '次';
        btnNext.textContent = `[${nextPeriod}] 朝を終了して議論を開始する`;
    } else if (lastKnownPhase === 'discussion') {
        const nextStep = GAME_TIMELINE[currentTimelineIndex + 1];
        const nextPeriod = nextStep ? nextStep.period : '次';
        btnNext.textContent = `[${nextPeriod}] 投票フェーズへ進む`;
    } else if (lastKnownPhase === 'voting') {
        // 投票中か、結果表示中かで文言を変える
        const voteResultOverlay = document.getElementById('vote-result-overlay');
        if (voteResultOverlay && !voteResultOverlay.classList.contains('hidden')) {
            const nextStep = GAME_TIMELINE[currentTimelineIndex + 1];
            if (nextStep) {
                btnNext.textContent = `[${nextStep.period}] 次の夜フェーズへ進む`;
            } else {
                btnNext.textContent = 'ゲーム終了判定へ';
            }
        } else {
            btnNext.textContent = '投票を強制締め切りする';
        }
    } else if (lastKnownPhase === 'result') {
        btnNext.textContent = 'ゲーム終了 (結果発表中)';
        btnNext.style.opacity = '0.6';
        btnNext.style.cursor = 'not-allowed';
    }
}

// =============================================
// 役職設定カウンター（GM専用）
// =============================================
export function initRoleCounters() {
    const container = document.getElementById('role-counters');
    container.innerHTML = '';
    ROLES_INFO.forEach(role => {
        const row = document.createElement('div');
        row.className = 'role-row';
        row.innerHTML = `
            <div class="role-name-wrapper">
                <div class="role-name">${role.name}</div>
                <button type="button" class="info-icon-btn" onclick="showRoleInfoModal('${role.id}')" aria-label="${role.name}の説明">${iconHtml('i-info')}</button>
            </div>
            <div class="counter-group">
                <button type="button" class="counter-btn" onclick="changeRoleCount('${role.id}', -1)" aria-label="${role.name}を減らす">-</button>
                <div id="count-${role.id}" class="role-count-display">0</div>
                <button type="button" class="counter-btn" onclick="changeRoleCount('${role.id}', 1)" aria-label="${role.name}を増やす">+</button>
            </div>
        `;
        container.appendChild(row);
    });
    updateTotalInfo();
}

export function updateTotalInfo() {
    // window._roleCounts はmain.jsでglobal公開されたroleCounts参照
    const rc = window._roleCounts || {};
    const totalRoles = Object.values(rc).reduce((a, b) => a + b, 0);
    const totalInfoEl = document.getElementById('total-info');
    const count = getCurrentPlayers().length;

    document.getElementById('total-role-count').textContent = totalRoles;
    document.getElementById('total-player-count').textContent = count;

    if (totalRoles === count && count > 0) {
        totalInfoEl.className = 'total-info total-ok';
    } else {
        totalInfoEl.className = 'total-info total-error';
    }
}

// =============================================
// 役職説明モーダル
// =============================================
export function openHelpModal() {
    const modal = document.getElementById('help-modal');
    modal.classList.remove('hidden');

    const myHelpArea = document.getElementById('my-role-help-area');
    const myHelpContent = document.getElementById('my-role-help-content');

    // 役職確定状態（myRoleNameが存在する）かつ「確認中...」ではない場合
    if (getMyRoleName() && getMyRoleName() !== '確認中...') {
        const myRoleInfo = ROLES_INFO.find(r => r.name === getMyRoleName());
        if (myRoleInfo) {
            myHelpContent.innerHTML = generateRoleHelpHtml(myRoleInfo);
            myHelpArea.classList.remove('hidden');
        } else {
            // 未確定（ロビー待機中など）
            myHelpArea.classList.remove('hidden');
            myHelpContent.innerHTML = '<p class="empty-note">ゲーム開始後にあなたの役職が表示されます</p>';
        }
    } else {
        // 未確定（ロビー待機中など）
        myHelpArea.classList.remove('hidden');
        myHelpContent.innerHTML = '<p class="empty-note">ゲーム開始後にあなたの役職が表示されます</p>';
    }

    // 全役職一覧の描画（アコーディオン形式）
    const accordion = document.getElementById('all-roles-accordion');
    accordion.innerHTML = '';

    ROLES_INFO.forEach(role => {
        const item = document.createElement('div');
        item.className = 'accordion-item';

        const header = document.createElement('div');
        header.className = 'accordion-header';
        header.innerHTML = `<span>${role.name}</span> <span class="accordion-badge ${ROLE_BADGE_CLASS[role.name]}">${role.faction}</span>`;

        const body = document.createElement('div');
        body.className = 'accordion-body hidden';
        body.innerHTML = generateRoleHelpDetailsHtml(role);

        makeKeyboardClickable(header);
        header.onclick = () => {
            const isHidden = body.classList.contains('hidden');
            document.querySelectorAll('.accordion-body').forEach(b => b.classList.add('hidden'));
            document.querySelectorAll('.accordion-header').forEach(h => h.classList.remove('active'));
            if (isHidden) {
                body.classList.remove('hidden');
                header.classList.add('active');
            }
        };

        item.appendChild(header);
        item.appendChild(body);
        accordion.appendChild(item);
    });
}

/** div などをボタンのようにキーボード（Enter / Space）でも押せるようにする */
function makeKeyboardClickable(el) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            el.click();
        }
    });
}

export function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    modal.classList.add('hidden');
}

export function showRoleInfoModal(roleId) {
    const role = ROLES_INFO.find(r => r.id === roleId);
    if (!role) return;

    const modal = document.getElementById('help-modal');
    modal.classList.remove('hidden');

    // 自分の役職説明エリアを非表示にする
    document.getElementById('my-role-help-area').classList.add('hidden');

    // 全役職リストのアコーディオンを描画
    const accordion = document.getElementById('all-roles-accordion');
    accordion.innerHTML = '';

    ROLES_INFO.forEach(r => {
        const item = document.createElement('div');
        item.className = 'accordion-item';

        const header = document.createElement('div');
        header.className = 'accordion-header';
        header.innerHTML = `<span>${r.name}</span> <span class="accordion-badge ${ROLE_BADGE_CLASS[r.name]}">${r.faction}</span>`;

        const body = document.createElement('div');
        body.className = 'accordion-body';
        if (r.id !== roleId) {
            body.classList.add('hidden');
        } else {
            header.classList.add('active');
        }
        body.innerHTML = generateRoleHelpDetailsHtml(r);

        makeKeyboardClickable(header);
        header.onclick = () => {
            const isHidden = body.classList.contains('hidden');
            document.querySelectorAll('.accordion-body').forEach(b => b.classList.add('hidden'));
            document.querySelectorAll('.accordion-header').forEach(h => h.classList.remove('active'));
            if (isHidden) {
                body.classList.remove('hidden');
                header.classList.add('active');
            }
        };

        item.appendChild(header);
        item.appendChild(body);
        accordion.appendChild(item);
    });
}

export function generateRoleHelpHtml(role) {
    return `
        <div class="role-help-card">
            <div class="role-help-badge-row">
                <span class="role-badge-large ${ROLE_BADGE_CLASS[role.name]}">${role.name}</span>
                <span class="faction-badge">${role.faction}</span>
            </div>
            <p class="role-help-summary"><strong>概要:</strong> ${role.summary}</p>
            <p class="role-help-details"><strong>詳細仕様:</strong> ${role.details}</p>
            <p class="role-help-win"><strong>勝利条件:</strong> ${role.win_condition}</p>
        </div>
    `;
}

export function generateRoleHelpDetailsHtml(role) {
    return `
        <div class="role-help-body-content">
            <p><strong>概要:</strong> ${role.summary}</p>
            <p><strong>詳細仕様:</strong> ${role.details}</p>
            <p><strong>勝利条件:</strong> ${role.win_condition}</p>
        </div>
    `;
}

// =============================================
// 役職覗き見防止
// =============================================
export function toggleRoleReveal() {
    const wrapper = document.getElementById('role-reveal-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('is-revealed');
}

export function resetRoleCover() {
    const wrapper = document.getElementById('role-reveal-wrapper');
    if (wrapper) {
        wrapper.classList.remove('is-revealed');
    }
}

// =============================================
// シークレット投票UI
// =============================================
export function updateHideVoteDetailsUI(value) {
    const checkbox = document.getElementById('check-hide-vote-details');
    if (checkbox) {
        checkbox.checked = !!value;
    }
}

// =============================================
// 人狼チャット UI
// =============================================
export function updateWolfChatButtonVisibility() {
    // 画面上部のボタンは GM 専用。人狼プレイヤーは役職カード（カバーの中）のボタンから開く
    // （上部に人狼だけボタンが出ると、遠目で役職が分かってしまうため）
    const btnWolfChat = document.getElementById('btn-wolf-chat');
    if (btnWolfChat) {
        btnWolfChat.classList.toggle('hidden', getMyRoleType() !== 'gm');
    }

    const btnWolfChatRole = document.getElementById('btn-wolf-chat-role');
    if (btnWolfChatRole) {
        btnWolfChatRole.classList.toggle('hidden', !(getMyRoleType() === 'player' && getMyRoleName() === '人狼'));
    }
}

export async function openWolfChatModal() {
    const modal = document.getElementById('wolf-chat-modal');
    if (!modal) return;

    if (getMyRoleType() !== 'gm' && getMyRoleName() !== '人狼') {
        alert('このチャットを開く権限がありません。');
        return;
    }

    modal.classList.remove('hidden');

    const gmForm = document.getElementById('gm-mission-form-area');
    if (gmForm) {
        if (getMyRoleType() === 'gm') {
            gmForm.classList.remove('hidden');
        } else {
            gmForm.classList.add('hidden');
        }
    }

    try {
        const { data: mission, error: missionErr } = await supabaseClient
            .from('werewolf_mission')
            .select('mission_text')
            .eq('id', 1)
            .single();
        if (!missionErr && mission) {
            receiveMissionUpdate(mission.mission_text);
        }

        const { data: chats, error: chatErr } = await supabaseClient
            .from('werewolf_chat')
            .select('*')
            .order('created_at', { ascending: true });
        if (!chatErr && chats) {
            renderChatHistory(chats);
        }
    } catch (e) {
        console.error('チャットデータ初期ロードエラー:', e);
    }
}

export function closeWolfChatModal() {
    const modal = document.getElementById('wolf-chat-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function receiveChatMessage(data) {
    const log = document.getElementById('wolf-chat-log');
    if (!log) return;

    // 重複描画を防ぐため、既に同じIDのメッセージが描画されていないか確認
    const existingMsg = document.getElementById(`msg-${data.id}`);
    if (existingMsg) return;

    const msgDiv = document.createElement('div');
    msgDiv.id = `msg-${data.id}`;
    const isGm = data.sender_role === 'GM';
    msgDiv.className = `chat-msg ${isGm ? 'is-gm' : 'is-wolf'}`;

    const timeStr = data.created_at ? new Date(data.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    msgDiv.innerHTML = `
        <div class="chat-msg-header">
            <span class="chat-msg-sender">[${escapeHTML(data.sender_role)}] ${escapeHTML(data.sender)}</span>
            <span class="chat-msg-time">${timeStr}</span>
        </div>
        <div class="chat-msg-body">${escapeHTML(data.message)}</div>
    `;

    log.appendChild(msgDiv);
    log.scrollTop = log.scrollHeight;
}

export function receiveMissionUpdate(missionText) {
    const displayArea = document.getElementById('wolf-mission-display-area');
    const textEl = document.getElementById('wolf-mission-text');
    if (!displayArea || !textEl) return;

    if (missionText) {
        textEl.textContent = missionText;
        displayArea.classList.remove('hidden');
    } else {
        displayArea.classList.add('hidden');
    }
}

export function renderChatHistory(messages) {
    const log = document.getElementById('wolf-chat-log');
    if (!log) return;
    log.innerHTML = '';
    messages.forEach(m => receiveChatMessage(m));
}

export function escapeHTML(str) {
    // null / undefined / 数値が来ても落ちないように文字列化してからエスケープ
    return String(str ?? '').replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}


