// =============================================
// js/state.js
// ゲームの状態変数管理（getter/setter経由で共有）
// =============================================

// =============================================
// DOM 参照（ゲーム画面以降で使用するもの）
// =============================================
export const loginView = document.getElementById('login-view');
export const gameView = document.getElementById('game-view');
export const gmPanel = document.getElementById('gm-panel');
export const gmNameDisplay = document.getElementById('gm-name-display');
export const phaseElement = document.getElementById('current-phase');
export const nameInput = document.getElementById('player-name');
export const playerListArea = document.getElementById('player-list-area');
export const playerList = document.getElementById('player-list');
export const myRoleArea = document.getElementById('my-role-area');
export const roleSettingsArea = document.getElementById('role-settings-area');
export const gmHint = document.getElementById('gm-hint');

// =============================================
// 状態変数（内部保持）
// =============================================
let _myPlayerName = '';
let _myRoleType = '';   // 'gm' or 'player'
let _myRoleName = '';
let _currentPlayers = [];   // { id, name, is_alive, role, vote_target_id }
let _currentPlayersCount = 0;
let _lastKnownPhase = '';
let _hasActedTonight = false; // 夜の行動済フラグ
let _resultShown = false; // リザルト画面の重複表示防止フラグ
let _hasVotedToday = false; // 昼の投票済フラグ
let _isCountingVotes = false; // 集計中の重複実行防止フラグ
let _voteCountdownTimer = null;  // カウントダウンタイマー ID
let _hideVoteDetails = false;   // シークレット投票フラグ
let _currentTimelineIndex = 0;
let _pendingWinner = null;
export let roleCounts = { wolf: 0, citizen: 0, seer: 0, medium: 0, knight: 0, teruteru: 0 };

// =============================================
// Getter / Setter
// =============================================
export const getMyPlayerName = () => _myPlayerName;
export const setMyPlayerName = (v) => { _myPlayerName = v; };

export const getMyRoleType = () => _myRoleType;
export const setMyRoleType = (v) => { _myRoleType = v; };

export const getMyRoleName = () => _myRoleName;
export const setMyRoleName = (v) => { _myRoleName = v; };

export const getCurrentPlayers = () => _currentPlayers;
export const setCurrentPlayers = (v) => { _currentPlayers = v; };

export const getCurrentPlayersCount = () => _currentPlayersCount;
export const setCurrentPlayersCount = (v) => { _currentPlayersCount = v; };

export const getLastKnownPhase = () => _lastKnownPhase;
export const setLastKnownPhase = (v) => { _lastKnownPhase = v; };

export const getHasActedTonight = () => _hasActedTonight;
export const setHasActedTonight = (v) => { _hasActedTonight = v; };

export const getResultShown = () => _resultShown;
export const setResultShown = (v) => { _resultShown = v; };

export const getHasVotedToday = () => _hasVotedToday;
export const setHasVotedToday = (v) => { _hasVotedToday = v; };

export const getIsCountingVotes = () => _isCountingVotes;
export const setIsCountingVotes = (v) => { _isCountingVotes = v; };

export const getVoteCountdownTimer = () => _voteCountdownTimer;
export const setVoteCountdownTimer = (v) => { _voteCountdownTimer = v; };

export const getHideVoteDetails = () => _hideVoteDetails;
export const setHideVoteDetails = (v) => { _hideVoteDetails = v; };

export const getCurrentTimelineIndex = () => _currentTimelineIndex;
export const setCurrentTimelineIndex = (v) => { _currentTimelineIndex = v; };

export const getPendingWinner = () => _pendingWinner;
export const setPendingWinner = (v) => { _pendingWinner = v; };

// =============================================
// セッション管理
// =============================================
export function saveSession(name, roleType, id = null) {
    sessionStorage.setItem('werewolf_playerName', name);
    sessionStorage.setItem('werewolf_roleType', roleType);
    if (id) {
        sessionStorage.setItem('werewolf_playerId', id);
    }
}

export function restoreSessionData() {
    const savedName = sessionStorage.getItem('werewolf_playerName');
    const savedRole = sessionStorage.getItem('werewolf_roleType');
    if (savedName && savedRole) {
        _myPlayerName = savedName;
        _myRoleType = savedRole;
        return true;
    }
    return false;
}

export function clearSessionData() {
    sessionStorage.removeItem('werewolf_playerName');
    sessionStorage.removeItem('werewolf_roleType');
    sessionStorage.removeItem('werewolf_playerId');
    clearDummyNightState();
}

// =============================================
// 夜のダミー質問（DBには保存せず、この端末の sessionStorage だけで持つ）
// { night: タイムライン番号, name: プレイヤー名, q: 質問番号, answerId, answerName }
// =============================================
const DUMMY_NIGHT_KEY = 'werewolf_dummyNight';

/**
 * 指定した夜（省略時は今のタイムライン番号）・自分の分の保存内容があれば返す（別の夜・別の人のものなら null）
 * @param {number} [night] - 夜のタイムライン番号（朝に「昨晩」の分を見るときは 今の番号 - 1）
 */
export function getDummyNightState(night = _currentTimelineIndex) {
    try {
        const st = JSON.parse(sessionStorage.getItem(DUMMY_NIGHT_KEY));
        if (st && st.night === night && st.name === _myPlayerName) return st;
    } catch (e) {
        // 保存内容が壊れている・ストレージが使えない場合は「なし」扱い
    }
    return null;
}

export function saveDummyNightState(st) {
    try {
        sessionStorage.setItem(DUMMY_NIGHT_KEY, JSON.stringify(st));
    } catch (e) {
        console.warn('[DUMMY] sessionStorage への保存に失敗しました:', e);
    }
}

export function clearDummyNightState() {
    try {
        sessionStorage.removeItem(DUMMY_NIGHT_KEY);
    } catch (e) {
        // 何もしない
    }
}
