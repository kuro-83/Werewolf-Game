// =============================================
// js/main.js
// エントリーポイント：Supabase Realtime購読 & window公開
// =============================================
console.log("【最新版 2026/10/16 v2】夜フェーズのダミー質問追加・夜の画面の見た目と操作手順を全役職で統一");

import { supabaseClient } from './config.js';
import { initPalette } from './theme.js';
import {
    getMyPlayerName, getMyPlayerId, isMyPlayer, getMyRoleType, getMyRoleName,
    getCurrentPlayers, setCurrentPlayers,
    getLastKnownPhase, setLastKnownPhase,
    getHasActedTonight,
    getResultShown, setResultShown,
    getHasVotedToday, setHasVotedToday,
    getIsCountingVotes, setIsCountingVotes,
    getVoteCountdownTimer, setVoteCountdownTimer,
    getHideVoteDetails, setHideVoteDetails,
    getCurrentTimelineIndex, setCurrentTimelineIndex,
    getPendingWinner, setPendingWinner,
    getMorningMessage, setMorningMessage, getDeathLog, setDeathLog,
    getGameMode, setGameMode, getPhaseEndsAt, setPhaseEndsAt,
    setMyPlayerName, setMyRoleType, setMyRoleName,
    roleCounts,
    saveSession, restoreSessionData, clearSessionData,
    loginView, gameView, gmPanel, gmNameDisplay, phaseElement
} from './state.js';

import {
    updatePhaseDisplay, renderPlayerList, renderMemoList,
    renderTimeline, updateGmTimelineButtons,
    updateWolfChatButtonVisibility, updateHideVoteDetailsUI,
    receiveChatMessage, receiveMissionUpdate,
    showVoteResult, checkMyAliveStatus, renderNightActionStatus,
    showMorningVictims, showMyNightResult, renderDeathLog, switchSideTab, onSideTabKeydown,
    renderGameModeControls, updatePhaseTimer, startPhaseTimer,
    initRoleCounters, toggleMobileMemo,
    openHelpModal, closeHelpModal, showRoleInfoModal,
    toggleRoleReveal, openWolfChatModal, closeWolfChatModal,
    updateVoteProgress, renderVoteUI, renderVoteTargets,
    enableGhostSpectatorMode, disableGhostSpectatorMode,
    renderGhostRoleList, renderGhostNightActions,
    switchGhostViewTo,
    resetMemos
} from './ui.js';

import {
    submitVote, checkAllVoted, closeVoting, disableVoteButtons,
    countAndExile, proceedToNight,
    checkWinCondition, triggerGameEnd,
    renderSeerTargets, submitDivination,
    renderMediumTargets, submitMedium,
    renderWolfTargets, submitAttack,
    renderKnightTargets, submitKnightGuard,
    renderDummyTargets, submitDummyAnswer,
    killPlayer, kickPlayer,
    changeRoleCount,
    distributeRolesAndStartGame, handlePhaseChange, resetGame,
    advanceTimeline,
    onHideVoteDetailsChange,
    sendWolfChatMessage, submitGmMission,
    clearSession, joinGame,
    submitVoteSkip, changeNightTarget,
    selectGameMode, applyRecommendedRoles, extendPhaseTimer
} from './action.js';

// =============================================
// グローバル公開（インラインハンドラから呼ばれる関数）
// =============================================
window.joinGame = joinGame;
window.clearSession = clearSession;
window.resetGame = resetGame;

window.killPlayer = killPlayer;
window.kickPlayer = kickPlayer;

window.submitVote = submitVote;
window.closeVoting = closeVoting;
window.proceedToNight = proceedToNight;
window.advanceTimeline = advanceTimeline;

window.submitAttack = submitAttack;
window.submitDivination = submitDivination;
window.submitMedium = submitMedium;
window.submitKnightGuard = submitKnightGuard;
window.submitDummyAnswer = submitDummyAnswer;

window.renderSeerTargets = renderSeerTargets;
window.renderMediumTargets = renderMediumTargets;
window.renderWolfTargets = renderWolfTargets;
window.renderKnightTargets = renderKnightTargets;
window.renderDummyTargets = renderDummyTargets;

window.changeRoleCount = changeRoleCount;
window.showRoleInfoModal = showRoleInfoModal;
window.openHelpModal = openHelpModal;
window.closeHelpModal = closeHelpModal;
window.toggleRoleReveal = toggleRoleReveal;
window.toggleMobileMemo = toggleMobileMemo;

window.openWolfChatModal = openWolfChatModal;
window.closeWolfChatModal = closeWolfChatModal;
window.sendWolfChatMessage = sendWolfChatMessage;
window.submitGmMission = submitGmMission;

window.onHideVoteDetailsChange = onHideVoteDetailsChange;
window.switchGhostViewTo = switchGhostViewTo;
window.resetMemos = resetMemos;
window.submitVoteSkip = submitVoteSkip;
window.changeNightTarget = changeNightTarget;
window.switchSideTab = switchSideTab;
window.onSideTabKeydown = onSideTabKeydown;
window.selectGameMode = selectGameMode;
window.applyRecommendedRoles = applyRecommendedRoles;
window.extendPhaseTimer = extendPhaseTimer;

// roleCounts をwindow経由で ui.js の updateTotalInfo から参照できるように
window._roleCounts = roleCounts;

// =============================================
// joinGame のコールバック（state更新→setupGameView）
// =============================================
window._joinGameCallback = function (name, role, playerId) {
    setMyPlayerName(name);
    setMyRoleType(role);
    saveSession(name, role, playerId);
    setupGameView();
};

// =============================================
// リアルタイム同期（Supabase Realtime）
// =============================================
// 取得が重なったとき（再接続など）に、最後に始めた取得の結果だけを使うための連番
let loadSeq = 0;
// 初期取得の最中に Realtime で届いた参加者（取得結果に含まれていなければ足す）
let insertedWhileLoading = null;

/**
 * game_status と players を取得して画面に反映する
 * Realtime の購読が SUBSCRIBED になった後（再接続時も）に呼ぶ。
 * 購読より先に取得すると、その間の参加（INSERT）を取りこぼすため。
 */
async function loadGameState() {
    const seq = ++loadSeq;
    insertedWhileLoading = new Map();
    try {
        const phaseRes = await supabaseClient
            .from('game_status')
            .select('*') // death_log の列が無い環境でも取得自体は失敗しないよう、列を指定しない
            .limit(1)
            .single();
        if (phaseRes.error) throw phaseRes.error;

        // role・vote_target_id を含めて取得
        const playersRes = await supabaseClient
            .from('players')
            .select('id, name, is_alive, role, vote_target_id, night_target_id');
        if (playersRes.error) throw playersRes.error;

        // もっと新しい取得が始まっていたら、この結果は使わない
        if (seq !== loadSeq) return;

        // 取得の最中に届いた参加者が結果に含まれていなければ足す（取得結果で上書きして消さないため）
        const fetchedPlayers = playersRes.data ? [...playersRes.data] : [];
        insertedWhileLoading.forEach((row, id) => {
            if (!fetchedPlayers.some(p => String(p.id) === id)) fetchedPlayers.push(row);
        });
        insertedWhileLoading = null;
        playersRes.data = fetchedPlayers;

        setCurrentPlayers(fetchedPlayers);

        // ── 古いセッション（id を持っていない）の補完 ──
        // 名前で自分の行を探して id を保存する。見つからない・同名が複数いて特定できない場合はログイン画面に戻す
        if (getMyRoleType() === 'player' && !getMyPlayerId()) {
            const matches = (playersRes.data || []).filter(p => p.name === getMyPlayerName());
            if (matches.length === 1) {
                saveSession(getMyPlayerName(), 'player', matches[0].id);
                console.log('[SESSION] 古いセッションの id を補完しました:', matches[0].id);
            } else {
                console.warn(`[SESSION] 自分の行を特定できません（一致 ${matches.length} 件）。ログイン画面に戻します。`);
                clearSessionData();
                alert('参加情報が見つかりませんでした。もう一度参加してください。');
                location.reload();
                return;
            }
        }

        renderPlayerList();
        renderMemoList();

        // ── リロード時の幽霊状態復元 ──
        // 初期データ取得後、自分が死亡状態の場合は幽霊UIを有効化する
        if (getMyRoleType() === 'player') {
            const myPlayerOnLoad = (playersRes.data || []).find(isMyPlayer);
            if (myPlayerOnLoad && !myPlayerOnLoad.is_alive) {
                console.log('👻 [リロード復元] 死亡状態を検出 → 幽霊モードを有効化:', myPlayerOnLoad);
                checkMyAliveStatus();
            }
        }

        if (phaseRes.data.winner) {
            setPendingWinner(phaseRes.data.winner);
        }

        setCurrentTimelineIndex(
            phaseRes.data.timeline_index !== undefined && phaseRes.data.timeline_index !== null
                ? phaseRes.data.timeline_index
                : 0
        );

        // 朝の犠牲者の記録（朝の画面の表示より前にセットする）
        setMorningMessage(phaseRes.data.morning_message ?? null);

        // 死亡ログ（ページを開いた時点で既にある記録は既読扱い）
        setDeathLog(phaseRes.data.death_log);
        renderDeathLog({ markAsSeen: true });

        // 進め方（列が無い・読めない場合は school 扱い）とタイマー（無ければタイマーなし）
        setGameMode(phaseRes.data.game_mode);
        setPhaseEndsAt(phaseRes.data.phase_ends_at ?? null);
        renderGameModeControls();
        updatePhaseTimer();

        // シークレット投票設定を同期
        if (phaseRes.data.hide_vote_details !== undefined) {
            setHideVoteDetails(!!phaseRes.data.hide_vote_details);
            updateHideVoteDetailsUI(getHideVoteDetails());
        }

        await updatePhaseDisplay(phaseRes.data.current_phase);
        renderTimeline();
        updateGmTimelineButtons();

    } catch (error) {
        if (seq === loadSeq) insertedWhileLoading = null;
        console.error('初期データの取得エラー:', error);
        phaseElement.textContent = '接続エラー';
    }
}

async function startGameSync() {
    let loadedOnce = false;

    // Realtime の購読を先に始め、SUBSCRIBED になってから初期データを取得する
    supabaseClient.channel('room_sync_channel')
        // game_status の更新（フェーズ変更）
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_status' },
            async (payload) => {
                // フェーズ・タイムライン・朝の記録・シークレット投票・勝者が変わっていない更新
                // （死亡ログ・タイマーの延長・進め方の切り替えなど）では、画面全体を描き直さない
                // （夜の選択途中の画面や、めくった役職カードが戻ってしまわないように）
                const samePhaseUpdate =
                    payload.new.current_phase === getLastKnownPhase() &&
                    payload.new.timeline_index === getCurrentTimelineIndex() &&
                    (payload.new.morning_message ?? null) === (getMorningMessage() ?? null) &&
                    !!payload.new.hide_vote_details === !!getHideVoteDetails() &&
                    (payload.new.winner ?? null) === (getPendingWinner() ?? null);
                if (samePhaseUpdate) {
                    if (payload.new.death_log !== undefined &&
                        JSON.stringify(payload.new.death_log) !== JSON.stringify(getDeathLog())) {
                        setDeathLog(payload.new.death_log);
                        renderDeathLog();
                    }
                    if (payload.new.phase_ends_at !== undefined) {
                        setPhaseEndsAt(payload.new.phase_ends_at);
                        updatePhaseTimer();
                    }
                    if (payload.new.game_mode !== undefined && (payload.new.game_mode === 'fifty' ? 'fifty' : 'school') !== getGameMode()) {
                        setGameMode(payload.new.game_mode);
                        renderGameModeControls();
                        renderTimeline();
                        updateGmTimelineButtons();
                    }
                    return;
                }

                // 進め方・タイマー（フェーズの表示より前にセットする）
                if (payload.new.game_mode !== undefined) setGameMode(payload.new.game_mode);
                if (payload.new.phase_ends_at !== undefined) setPhaseEndsAt(payload.new.phase_ends_at);

                if (payload.new.winner) {
                    setPendingWinner(payload.new.winner);
                }
                if (payload.new.timeline_index !== undefined && payload.new.timeline_index !== null) {
                    setCurrentTimelineIndex(payload.new.timeline_index);
                }
                // シークレット投票設定をリアルタイム同期
                if (payload.new.hide_vote_details !== undefined) {
                    setHideVoteDetails(!!payload.new.hide_vote_details);
                    updateHideVoteDetailsUI(getHideVoteDetails());
                }
                // 朝の犠牲者の記録（フェーズと同じ更新で届く。朝の画面の表示より前にセットする）
                if (payload.new.morning_message !== undefined) {
                    setMorningMessage(payload.new.morning_message);
                }
                // 死亡ログ
                if (payload.new.death_log !== undefined) {
                    setDeathLog(payload.new.death_log);
                    renderDeathLog();
                }
                await updatePhaseDisplay(payload.new.current_phase);
                renderTimeline();
                updateGmTimelineButtons();
                renderGameModeControls();
                updatePhaseTimer();
            }
        )
        // プレイヤーの入室
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' },
            (payload) => {
                // 初期取得の最中なら覚えておく（取得結果に含まれていなければ後で足す）
                if (insertedWhileLoading) insertedWhileLoading.set(String(payload.new.id), payload.new);

                // 取得と INSERT の両方で同じ人が入らないよう、同じ id がいれば中身だけ更新する
                const players = getCurrentPlayers();
                const idx = players.findIndex(p => String(p.id) === String(payload.new.id));
                if (idx !== -1) {
                    players[idx] = payload.new;
                } else {
                    players.push(payload.new);
                }
                setCurrentPlayers(players);
                renderPlayerList();
                renderMemoList();
            }
        )
        // プレイヤー情報の更新（is_alive / vote_target_id 変更）
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' },
            async (payload) => {
                const players = getCurrentPlayers();
                const idx = players.findIndex(p => String(p.id) === String(payload.new.id));
                // 更新前の状態を保存（vote_target_id変化検知に使用）
                const prevPlayer = idx !== -1 ? players[idx] : null;
                const wasAlive = prevPlayer ? prevPlayer.is_alive : true;
                const justDied = wasAlive && !payload.new.is_alive;

                if (idx !== -1) {
                    players[idx] = payload.new;
                } else {
                    players.push(payload.new);
                }
                setCurrentPlayers(players);
                renderPlayerList();
                renderMemoList();

                // GM用夜フェーズ行動状況インジケーターを更新
                if (getLastKnownPhase() === 'night' && getMyRoleType() === 'gm') {
                    renderNightActionStatus();
                }

                // 朝フェーズ中の場合、犠牲者の表示を更新
                if (getLastKnownPhase() === 'morning') {
                    showMorningVictims();
                }

                // 自分が死亡した場合は霊界モードをチェック
                if (getMyRoleType() === 'player' && isMyPlayer(payload.new)) {
                    console.log('👻 [Realtime] 自プレイヤー更新検知 is_alive=', payload.new.is_alive, payload.new);
                    checkMyAliveStatus();
                    // is_alive が false になった瞬間を明示的に検知して幽霊モードを強制有効化
                    if (!payload.new.is_alive) {
                        console.log('👻 [Realtime] 死亡確定 → enableGhostSpectatorMode() 強制実行');
                        enableGhostSpectatorMode();
                    }
                }

                // 死亡時の処理（勝利判定および投票結果の同期表示）
                if (justDied) {
                    checkWinCondition();

                    // GM以外のプレイヤー画面で、投票フェーズ中に誰かが死亡（＝追放）した場合、投票結果画面を同期表示する
                    if (getLastKnownPhase() === 'voting' && getMyRoleType() !== 'gm') {
                        showVoteResult(payload.new.name, null);
                    }
                }

                // vote_target_id が「実際に変化」した場合のみ→ 投票進捗更新・全員投票チェック
                const oldVoteTargetId = prevPlayer ? prevPlayer.vote_target_id : undefined;
                if (payload.new.vote_target_id !== oldVoteTargetId) {
                    updateVoteProgress();
                    if (getMyRoleType() === 'gm') {
                        checkAllVoted();
                    }
                }

                // 自分の night_result が「実際に変化」した場合→ 朝フェーズ中なら結果を再表示
                if (getMyRoleType() === 'player' && isMyPlayer(payload.new) && getLastKnownPhase() === 'morning') {
                    const prevResult = prevPlayer ? prevPlayer.night_result : undefined;
                    if (payload.new.night_result !== prevResult && payload.new.night_result) {
                        console.log('[MORNING] night_result が到着。結果を再表示します。');
                        await showMyNightResult();
                    }
                }
            }
        )
        // プレイヤーの退出
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' },
            async (payload) => {
                // DELETE の payload.old には既定で主キー（id）しか入らないので、id で判定する
                const isMeKicked = isMyPlayer(payload.old);

                if (isMeKicked && getMyRoleType() === 'player') {
                    sessionStorage.removeItem('werewolf_playerName');
                    sessionStorage.removeItem('werewolf_roleType');
                    sessionStorage.removeItem('werewolf_playerId');
                    alert("GMによって部屋からキックされました。");
                    location.reload();
                    return; // 完全に処理をストップ
                }

                // リアルタイムに最新のプレイヤー一覧をDBから再取得
                try {
                    const { data, error } = await supabaseClient
                        .from('players')
                        .select('id, name, is_alive, role, vote_target_id, night_target_id');
                    if (!error && data) {
                        setCurrentPlayers(data);
                    } else {
                        setCurrentPlayers(getCurrentPlayers().filter(p => String(p.id) !== String(payload.old.id)));
                    }
                } catch (err) {
                    setCurrentPlayers(getCurrentPlayers().filter(p => String(p.id) !== String(payload.old.id)));
                }

                renderPlayerList();
                renderMemoList();
            }
        )
        // 人狼チャットメッセージ追加のリアルタイム同期
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'werewolf_chat' },
            (payload) => {
                if (getMyRoleType() === 'gm' || getMyRoleName() === '人狼') {
                    receiveChatMessage(payload.new);
                }
            }
        )
        // 人狼秘密指令更新のリアルタイム同期
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'werewolf_mission' },
            (payload) => {
                if (getMyRoleType() === 'gm' || getMyRoleName() === '人狼') {
                    receiveMissionUpdate(payload.new.mission_text);
                }
            }
        )
        .subscribe((status) => {
            // 初回の接続時と、通信が切れて再接続したときの両方で取得し直す
            if (status === 'SUBSCRIBED') {
                loadedOnce = true;
                loadGameState();
            } else {
                console.warn('[REALTIME] 購読の状態:', status);
            }
        });

    // 購読がいつまでも SUBSCRIBED にならない場合（Realtime が使えない等）でも、画面が空のままにならないようにする
    setTimeout(() => {
        if (!loadedOnce) {
            console.warn('[REALTIME] 購読の完了を待たずに初期データを取得します');
            loadedOnce = true;
            loadGameState();
        }
    }, 5000);
}

// =============================================
// ゲーム画面セットアップ
// =============================================
function setupGameView() {
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
        loginContainer.classList.add('hidden');
    }
    loginView.classList.add('hidden');
    gameView.classList.remove('hidden');

    // 上のバー右側の「○○ として参加中」（GM・プレイヤー共通）
    gmNameDisplay.textContent = getMyRoleType() === 'gm'
        ? `GM ${getMyPlayerName()} として参加中`
        : `${getMyPlayerName()} として参加中`;
    gmNameDisplay.classList.remove('hidden');

    if (getMyRoleType() === 'gm') {
        gmPanel.classList.remove('hidden');
        initRoleCounters();
    }
    // 人狼チャットボタンの表示制御
    updateWolfChatButtonVisibility();

    startGameSync();
}

// =============================================
// セッション復元
// =============================================
function restoreSession() {
    if (restoreSessionData()) {
        setupGameView();
        return true;
    }
    return false;
}

// =============================================
// 初期化
// =============================================
// 配色（この端末だけの設定）を復元し、配色ボタンを使えるようにする
initPalette();

// 50分モードのタイマー（1秒ごとに残り時間を描き直す。phase_ends_at が無ければ何も出さない）
startPhaseTimer();

window.addEventListener('DOMContentLoaded', () => {
    restoreSession();
});
