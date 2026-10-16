// =============================================
// js/main.js
// エントリーポイント：Supabase Realtime購読 & window公開
// =============================================
console.log("【最新版 2026/10/16 v2】夜フェーズのダミー質問追加・夜の画面の見た目と操作手順を全役職で統一");

import { supabaseClient } from './config.js';
import {
    getMyPlayerName, getMyRoleType, getMyRoleName,
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
    setMyPlayerName, setMyRoleType, setMyRoleName,
    roleCounts,
    saveSession, restoreSessionData,
    loginView, gameView, gmPanel, gmNameDisplay, phaseElement
} from './state.js';

import {
    updatePhaseDisplay, renderPlayerList, renderMemoList,
    renderTimeline, updateGmTimelineButtons,
    updateWolfChatButtonVisibility, updateHideVoteDetailsUI,
    receiveChatMessage, receiveMissionUpdate,
    showVoteResult, checkMyAliveStatus, renderNightActionStatus,
    showMorningVictims, showMyNightResult,
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
    submitVoteSkip, changeNightTarget
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
async function startGameSync() {
    try {
        const phaseRes = await supabaseClient
            .from('game_status')
            .select('current_phase, winner, timeline_index, hide_vote_details')
            .limit(1)
            .single();
        if (phaseRes.error) throw phaseRes.error;

        // role・vote_target_id を含めて取得
        const playersRes = await supabaseClient
            .from('players')
            .select('id, name, is_alive, role, vote_target_id, night_target_id');
        if (playersRes.error) throw playersRes.error;

        setCurrentPlayers(playersRes.data ? playersRes.data : []);
        renderPlayerList();
        renderMemoList();

        // ── リロード時の幽霊状態復元 ──
        // 初期データ取得後、自分が死亡状態の場合は幽霊UIを有効化する
        if (getMyRoleType() === 'player') {
            const myPlayerOnLoad = (playersRes.data || []).find(p => p.name === getMyPlayerName());
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

        // シークレット投票設定を同期
        if (phaseRes.data.hide_vote_details !== undefined) {
            setHideVoteDetails(!!phaseRes.data.hide_vote_details);
            updateHideVoteDetailsUI(getHideVoteDetails());
        }

        await updatePhaseDisplay(phaseRes.data.current_phase);
        renderTimeline();
        updateGmTimelineButtons();

    } catch (error) {
        console.error('初期データの取得エラー:', error);
        phaseElement.textContent = '接続エラー';
    }

    // Realtime サブスクリプション
    supabaseClient.channel('room_sync_channel')
        // game_status の更新（フェーズ変更）
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_status' },
            async (payload) => {
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
                await updatePhaseDisplay(payload.new.current_phase);
                renderTimeline();
                updateGmTimelineButtons();
            }
        )
        // プレイヤーの入室
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' },
            (payload) => {
                const players = getCurrentPlayers();
                players.push(payload.new);
                setCurrentPlayers(players);
                renderPlayerList();
                renderMemoList();
            }
        )
        // プレイヤー情報の更新（is_alive / vote_target_id 変更）
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' },
            async (payload) => {
                const players = getCurrentPlayers();
                const idx = players.findIndex(p => p.name === payload.new.name);
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
                if (getMyRoleType() === 'player' && payload.new.name === getMyPlayerName()) {
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
                if (getMyRoleType() === 'player' && payload.new.name === getMyPlayerName() && getLastKnownPhase() === 'morning') {
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
                const myId = sessionStorage.getItem('werewolf_playerId');
                const isMeKicked = (payload.old.id && String(payload.old.id) === String(myId)) || (payload.old.name === getMyPlayerName());

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
                        setCurrentPlayers(getCurrentPlayers().filter(p => p.name !== payload.old.name));
                    }
                } catch (err) {
                    setCurrentPlayers(getCurrentPlayers().filter(p => p.name !== payload.old.name));
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
        .subscribe();
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

    if (getMyRoleType() === 'gm') {
        gmPanel.classList.remove('hidden');
        gmNameDisplay.textContent = `GM: ${getMyPlayerName()} さん`;
        gmNameDisplay.classList.remove('hidden');
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
window.addEventListener('DOMContentLoaded', () => {
    restoreSession();
});
