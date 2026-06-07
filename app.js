/* =============================================
   人狼ゲーム管理 - アプリケーションロジック (app.js)
   Supabase Realtime 連携 + 勝利判定 + リザルト画面 + 投票システム
   ============================================= */

// =============================================
// Supabase 初期化
// =============================================
const SUPABASE_URL = 'https://lncmwzcoxnwonockzmkf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuY213emNveG53b25vY2t6bWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxOTY1MTgsImV4cCI6MjA5NDc3MjUxOH0.WH9wPObg7tyfE1w8ZLzrDPvjoCicp8ROm6AcegIfqvk';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// DOM 参照
// =============================================
const loginView = document.getElementById('login-view');
const gameView = document.getElementById('game-view');
const gmPanel = document.getElementById('gm-panel');
const gmNameDisplay = document.getElementById('gm-name-display');
const phaseElement = document.getElementById('current-phase');
const nameInput = document.getElementById('player-name');
const playerListArea = document.getElementById('player-list-area');
const playerList = document.getElementById('player-list');
const myRoleArea = document.getElementById('my-role-area');
const roleSettingsArea = document.getElementById('role-settings-area');
const gmHint = document.getElementById('gm-hint');

// =============================================
// 状態変数
// =============================================
let myPlayerName = '';
let myRoleType = '';   // 'gm' or 'player'
let myRoleName = '';
let currentPlayers = [];   // { id, name, is_alive, role, vote_target_id }
let currentPlayersCount = 0;
let lastKnownPhase = '';
let hasActedTonight = false; // 夜の行動済フラグ
let resultShown = false; // リザルト画面の重複表示防止フラグ
let hasVotedToday = false; // 昼の投票済フラグ
let isCountingVotes = false; // 集計中の重複実行防止フラグ
let voteCountdownTimer = null;  // カウントダウンタイマー ID

// =============================================
// 定数
// =============================================
const phaseNames = {
    'waiting': '待機中',
    'morning': '朝フェーズ',
    'discussion': '議論中',
    'voting': '投票中',
    'night': '夜フェーズ',
    'result': '終了'
};

const ROLES_INFO = [
    { id: 'wolf', name: '人狼' },
    { id: 'citizen', name: '市民' },
    { id: 'seer', name: '預言者' },
    { id: 'medium', name: '霊媒師' },
    { id: 'knight', name: '騎士' },
    { id: 'teruteru', name: 'てるてる' }
];

let roleCounts = { wolf: 0, citizen: 0, seer: 0, medium: 0, knight: 0, teruteru: 0 };

// 役職バッジのCSSクラスマッピング
const ROLE_BADGE_CLASS = {
    '人狼': 'role-badge-wolf',
    '市民': 'role-badge-citizen',
    '預言者': 'role-badge-seer',
    '霊媒師': 'role-badge-medium',
    '騎士': 'role-badge-knight',
    'てるてる': 'role-badge-teruteru'
};


// =============================================
// UI と状態の更新
// =============================================
async function updatePhaseDisplay(phase) {
    lastKnownPhase = phase;
    const displayName = phaseNames[phase] || phase;

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
    resultShown = false;

    document.body.className = `theme-${phase}`;

    // GMヒント（夜フェーズに行動待ちを表示）
    if (myRoleType === 'gm' && phase === 'night') {
        gmHint.classList.remove('hidden');
    } else {
        gmHint.classList.add('hidden');
    }

    if (phase === 'waiting') {
        playerListArea.classList.remove('hidden');
        myRoleArea.classList.add('hidden');
        document.getElementById('ghost-mode-overlay').classList.add('hidden');
        document.getElementById('night-action-overlay').classList.add('hidden');
        document.getElementById('morning-overlay').classList.add('hidden');
        document.getElementById('vote-overlay').classList.add('hidden');
        document.getElementById('vote-progress-area').classList.add('hidden');
        document.getElementById('vote-result-overlay').classList.add('hidden');
        document.getElementById('medium-result-area').classList.add('hidden');
        hasActedTonight = false;
        hasVotedToday = false;
        isCountingVotes = false;
        if (voteCountdownTimer) { clearInterval(voteCountdownTimer); voteCountdownTimer = null; }

        if (myRoleType === 'gm') {
            roleSettingsArea.classList.remove('hidden');
            document.getElementById('btn-waiting').classList.add('hidden');
            document.getElementById('reset-area').classList.add('hidden');
            document.getElementById('vote-close-area').classList.add('hidden');
            document.getElementById('morning-start-area').classList.add('hidden');
            document.getElementById('morning-end-area').classList.add('hidden');
        }

    } else {
        roleSettingsArea.classList.add('hidden');

        // ── 夕フェーズ: 投票進捗バーはGM・プレイヤー共通で表示（投票フェーズのみ） ──
        if (phase === 'voting') {
            document.getElementById('vote-progress-area').classList.remove('hidden');
            const pArea = document.getElementById('vote-progress-area-player');
            if (pArea) pArea.classList.remove('hidden');
            updateVoteProgress();
        } else {
            document.getElementById('vote-progress-area').classList.add('hidden');
            const pArea = document.getElementById('vote-progress-area-player');
            if (pArea) pArea.classList.add('hidden');
        }

        if (myRoleType === 'gm') {
            playerListArea.classList.remove('hidden');
            document.getElementById('btn-waiting').classList.add('hidden');
            document.getElementById('reset-area').classList.remove('hidden');
            // 夢フェーズ中のみ「朝フェーズへ進む」ボタンを表示
            if (phase === 'night') {
                document.getElementById('morning-start-area').classList.remove('hidden');
            } else {
                document.getElementById('morning-start-area').classList.add('hidden');
            }
            // 朝フェーズ中のみ「朝を終了して議論開始」ボタンを表示
            if (phase === 'morning') {
                document.getElementById('morning-end-area').classList.remove('hidden');
            } else {
                document.getElementById('morning-end-area').classList.add('hidden');
            }
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

        if (myRoleType === 'player') {
            myRoleArea.classList.remove('hidden');
            await fetchMyRole();
            checkMyAliveStatus();

            const me = currentPlayers.find(p => p.name === myPlayerName);
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

                // 占い師の場合、占い結果を表示
                if (myRoleName === '預言者') {
                    await showSeerResult();
                } else {
                    document.getElementById('seer-result-area').classList.add('hidden');
                }
                // 霊媒師の場合、霊媒結果を表示
                if (myRoleName === '霊媒師') {
                    await showMediumResult();
                } else {
                    document.getElementById('medium-result-area').classList.add('hidden');
                }

            } else if (phase === 'discussion') {
                // ── 議論フェーズ（明るい昼）──
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                // 議論フェーズでは占い・霊媒結果は表示しない
                document.getElementById('seer-result-area').classList.add('hidden');
                document.getElementById('medium-result-area').classList.add('hidden');

            } else if (phase === 'night') {
                // ── 夜フェーズ ──
                // 「投票日のフラグ」を全クライアントでリセット（2回目以降の投票対策）
                hasVotedToday = false;
                // 夜の行動済フラグをリセット（占い師・霊媒師が2ターン目以降も操作できるようにする）
                hasActedTonight = false;
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('vote-result-overlay').classList.add('hidden');
                // 占い結果エリアを隠す（夜フェーズ開始時）
                document.getElementById('seer-result-area').classList.add('hidden');
                document.getElementById('medium-result-area').classList.add('hidden');

                if (isMeAlive) {
                    document.getElementById('night-action-overlay').classList.remove('hidden');

                    if (myRoleName === '人狼' && !hasActedTonight) {
                        document.getElementById('night-wolf').classList.remove('hidden');
                        document.getElementById('night-seer').classList.add('hidden');
                        document.getElementById('night-medium').classList.add('hidden');
                        document.getElementById('night-knight').classList.add('hidden');
                        document.getElementById('night-waiting').classList.add('hidden');
                        renderWolfTargets();
                    } else if (myRoleName === '預言者' && !hasActedTonight) {
                        // ── 占い師の夜アクション ──
                        document.getElementById('night-wolf').classList.add('hidden');
                        document.getElementById('night-medium').classList.add('hidden');
                        document.getElementById('night-knight').classList.add('hidden');
                        document.getElementById('night-waiting').classList.add('hidden');
                        document.getElementById('night-seer').classList.remove('hidden');
                        renderSeerTargets();
                    } else if (myRoleName === '霊媒師' && !hasActedTonight) {
                        // ── 霊媒師の夜アクション ──
                        document.getElementById('night-wolf').classList.add('hidden');
                        document.getElementById('night-seer').classList.add('hidden');
                        document.getElementById('night-knight').classList.add('hidden');
                        document.getElementById('night-waiting').classList.add('hidden');
                        document.getElementById('night-medium').classList.remove('hidden');
                        renderMediumTargets();
                    } else if (myRoleName === '騎士' && !hasActedTonight) {
                        // ── 騎士の夜アクション ──
                        document.getElementById('night-wolf').classList.add('hidden');
                        document.getElementById('night-seer').classList.add('hidden');
                        document.getElementById('night-medium').classList.add('hidden');
                        document.getElementById('night-waiting').classList.add('hidden');
                        document.getElementById('night-knight').classList.remove('hidden');
                        renderKnightTargets();
                    } else {
                        document.getElementById('night-wolf').classList.add('hidden');
                        document.getElementById('night-seer').classList.add('hidden');
                        document.getElementById('night-medium').classList.add('hidden');
                        document.getElementById('night-knight').classList.add('hidden');
                        document.getElementById('night-waiting').classList.remove('hidden');
                        if (hasActedTonight) {
                            if (myRoleName === '人狼') {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>襲撃完了</h2><p style="color:#c0caf5;">今夜の任務を終えました。<br>静かに朝を待ちましょう…</p>
                                `;
                            } else if (myRoleName === '預言者') {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>🔮 占い完了</h2><p style="color:#c0caf5;">占い完了。朝を待っています...</p>
                                `;
                            } else if (myRoleName === '霊媒師') {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>🔮 霊媒完了</h2><p style="color:#c0caf5;">霊媒完了。朝を待っています...</p>
                                `;
                            } else if (myRoleName === '騎士') {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>🛡️ 守護完了</h2><p style="color:#c0caf5;">守護完了。朝を待っています...</p>
                                `;
                            } else {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>夜が訪れました</h2><p style="color:#c0caf5;">人狼が暗躍しています。<br>静かに朝を待ちましょう…</p>
                                `;
                            }
                        } else {
                            if (myRoleName === 'てるてる') {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>夜が訪れました</h2>
                                    <p style="color:#c0caf5;">あなたは <span style="color:#ffc777; font-weight:bold;">てるてる</span> です。夜のアクションはありません。<br>昼の投票で追放されるよう、静かに朝を待ちましょう…</p>
                                `;
                            } else {
                                document.getElementById('night-waiting').innerHTML = `
                                    <h2>夜が訪れました</h2><p style="color:#c0caf5;">人狼が暗躍しています。<br>静かに朝を待ちましょう…</p>
                                `;
                            }
                        }
                    }
                } else {
                    document.getElementById('night-action-overlay').classList.add('hidden');
                }

            } else {
                // その他のフェーズ
                document.getElementById('vote-overlay').classList.add('hidden');
                document.getElementById('night-action-overlay').classList.add('hidden');
                document.getElementById('morning-overlay').classList.add('hidden');
                document.getElementById('seer-result-area').classList.add('hidden');
                document.getElementById('medium-result-area').classList.add('hidden');
                hasActedTonight = false;
            }
        }
    }
}

async function fetchMyRole() {
    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('role')
            .eq('name', myPlayerName)
            .single();

        if (error) throw error;
        if (data && data.role) {
            myRoleName = data.role;
            document.getElementById('my-role-name').textContent = myRoleName;
        } else {
            myRoleName = '役職なし';
            document.getElementById('my-role-name').textContent = myRoleName;
        }
    } catch (err) {
        console.error('役職取得エラー:', err);
        document.getElementById('my-role-name').textContent = '取得エラー';
    }
}

function checkMyAliveStatus() {
    const me = currentPlayers.find(p => p.name === myPlayerName);
    if (me && !me.is_alive) {
        document.getElementById('ghost-mode-overlay').classList.remove('hidden');
        document.getElementById('night-action-overlay').classList.add('hidden');
    } else {
        document.getElementById('ghost-mode-overlay').classList.add('hidden');
    }
}

function renderPlayerList() {
    playerList.innerHTML = '';
    currentPlayers.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-item ${p.is_alive ? '' : 'dead'}`;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        div.appendChild(nameSpan);

        if (myRoleType === 'gm') {
            if (p.is_alive) {
                const btn = document.createElement('button');
                btn.className = 'btn-kill';
                btn.textContent = '追放';
                btn.onclick = () => killPlayer(p.name);
                div.appendChild(btn);
            } else {
                const badge = document.createElement('span');
                badge.className = 'badge-dead';
                badge.textContent = '死亡';
                div.appendChild(badge);
            }
        }
        playerList.appendChild(div);
    });

    currentPlayersCount = currentPlayers.length;
    updateTotalInfo();
}


// =============================================
// 勝利判定ロジック（GMクライアントのみ実行）
// =============================================
function checkWinCondition() {
    if (myRoleType !== 'gm') return;
    if (lastKnownPhase === 'waiting' || lastKnownPhase === 'result' || resultShown) return;

    const playersWithRole = currentPlayers.filter(p => p.role);
    if (playersWithRole.length === 0) return;

    const alivePlayers = currentPlayers.filter(p => p.is_alive);
    const aliveWolves = alivePlayers.filter(p => p.role === '人狼');
    const aliveOthers = alivePlayers.filter(p => p.role !== '人狼');

    if (aliveWolves.length === 0) {
        triggerGameEnd('citizen');
    } else if (aliveWolves.length >= aliveOthers.length) {
        triggerGameEnd('wolf');
    }
}

async function triggerGameEnd(winner) {
    if (resultShown) return;
    resultShown = true;

    console.log(`[WIN] ${winner} wins!`);

    try {
        const { error } = await supabaseClient
            .from('game_status')
            .update({ current_phase: 'result', winner: winner })
            .eq('id', 1);

        if (error) {
            console.warn('winner フィールドの更新に失敗。current_phase のみ更新します:', error);
            await supabaseClient
                .from('game_status')
                .update({ current_phase: 'result' })
                .eq('id', 1);
            _pendingWinner = winner;
        }
    } catch (err) {
        console.error('ゲーム終了処理エラー:', err);
    }
}

let _pendingWinner = null;


// =============================================
// リザルト画面の表示
// =============================================
async function showResultScreen() {
    if (voteCountdownTimer) { clearInterval(voteCountdownTimer); voteCountdownTimer = null; }

    // 最優先：GM画面などで投票結果オーバーレイが被さったままになるバグを防ぐため、強制的に非表示にする
    document.getElementById('vote-result-overlay').classList.add('hidden');

    if (resultShown) return;
    resultShown = true;

    const overlay = document.getElementById('result-overlay');
    overlay.classList.remove('hidden');

    let winner = _pendingWinner;
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
        const aliveWolves = currentPlayers.filter(p => p.is_alive && p.role === '人狼');
        winner = aliveWolves.length === 0 ? 'citizen' : 'wolf';
    }

    const isCitizen = winner === 'citizen';
    const isWolf = winner === 'wolf';
    const isTeruteru = winner === 'teruteru' || winner === 'てるてる';

    if (isTeruteru) {
        document.body.className = 'theme-result-teruteru';
        overlay.classList.add('teruteru-win');
        overlay.classList.remove('citizen-win', 'wolf-win');
    } else if (isCitizen) {
        document.body.className = 'theme-result-citizen';
        overlay.classList.add('citizen-win');
        overlay.classList.remove('wolf-win', 'teruteru-win');
    } else {
        document.body.className = 'theme-result-wolf';
        overlay.classList.add('wolf-win');
        overlay.classList.remove('citizen-win', 'teruteru-win');
    }

    if (isTeruteru) {
        document.getElementById('result-icon').textContent = '🎈';
    } else {
        document.getElementById('result-icon').textContent = isCitizen ? '☀️' : '🐺';
    }

    const titleEl = document.getElementById('result-title');
    if (isTeruteru) {
        titleEl.className = 'result-title teruteru';
        titleEl.textContent = 'てるてるの単独勝利！';
    } else {
        titleEl.className = `result-title ${isCitizen ? 'citizen' : 'wolf'}`;
        titleEl.textContent = isCitizen ? '市民チームの勝利！' : '人狼チームの勝利！';
    }

    if (isTeruteru) {
        document.getElementById('result-subtitle').textContent = '見事に追放（処刑）されました！';
    } else {
        document.getElementById('result-subtitle').textContent = isCitizen
            ? '平和が訪れた！'
            : '村は滅び去った…';
    }

    await renderResultPlayerList();

    const btnReturn = document.getElementById('btn-return-lobby');
    if (myRoleType === 'gm') {
        btnReturn.classList.remove('hidden');
    } else {
        btnReturn.classList.add('hidden');
    }
}

async function renderResultPlayerList() {
    const listEl = document.getElementById('result-player-list');
    listEl.innerHTML = '<p style="color:rgba(255,255,255,0.4); text-align:center;">読み込み中...</p>';

    try {
        const { data: players, error } = await supabaseClient
            .from('players')
            .select('name, is_alive, role')
            .order('name', { ascending: true });

        if (error) throw error;

        listEl.innerHTML = '';

        if (!players || players.length === 0) {
            listEl.innerHTML = '<p style="color:rgba(255,255,255,0.4);">プレイヤー情報が見つかりません</p>';
            return;
        }

        players.forEach((p, i) => {
            const item = document.createElement('div');
            const isWolf = p.role === '人狼';
            item.className = `result-player-item${isWolf ? ' is-wolf' : ''}`;
            item.style.animationDelay = `${i * 0.08}s`;

            const nameDiv = document.createElement('div');
            nameDiv.className = 'result-player-name';
            nameDiv.appendChild(document.createTextNode(p.name));

            if (!p.is_alive) {
                const deadMark = document.createElement('span');
                deadMark.className = 'dead-mark';
                deadMark.textContent = '（死亡）';
                nameDiv.appendChild(deadMark);
            }

            const roleBadge = document.createElement('span');
            const badgeClass = ROLE_BADGE_CLASS[p.role] || 'role-badge-unknown';
            roleBadge.className = `result-role-badge ${badgeClass}`;
            roleBadge.textContent = p.role || '役職なし';

            item.appendChild(nameDiv);
            item.appendChild(roleBadge);
            listEl.appendChild(item);
        });

    } catch (err) {
        console.error('リザルトプレイヤー一覧取得エラー:', err);
        listEl.innerHTML = '<p style="color:#f7768e;">プレイヤー情報の取得に失敗しました</p>';
    }
}


// =============================================
// 投票システム
// =============================================

/**
 * 投票オーバーレイの表示切り替え
 */
function renderVoteUI() {
    const overlay = document.getElementById('vote-overlay');
    const selectPanel = document.getElementById('vote-select');
    const donePanel = document.getElementById('vote-done');
    const ghostPanel = document.getElementById('vote-ghost');

    overlay.classList.remove('hidden');
    selectPanel.classList.add('hidden');
    donePanel.classList.add('hidden');
    ghostPanel.classList.add('hidden');

    const me = currentPlayers.find(p => p.name === myPlayerName);
    if (!me || !me.is_alive) {
        ghostPanel.classList.remove('hidden');
        return;
    }

    if (hasVotedToday || me.vote_target_id) {
        hasVotedToday = true;
        donePanel.classList.remove('hidden');
    } else {
        selectPanel.classList.remove('hidden');
        renderVoteTargets();
    }
}

/**
 * 投票ターゲットボタン一覧を描画
 */
function renderVoteTargets() {
    const list = document.getElementById('vote-target-list');
    list.innerHTML = '';

    const targets = currentPlayers.filter(p => p.is_alive && p.name !== myPlayerName);

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">投票できるプレイヤーがいません</p>';
        return;
    }

    targets.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.textContent = t.name;
        btn.onclick = () => submitVote(t.name, t.id);
        list.appendChild(btn);
    });
}

/**
 * 投票を実行する
 */
async function submitVote(targetName, targetId) {
    if (lastKnownPhase !== 'voting') return;

    if (!confirm(`${targetName} さんに投票しますか？`)) return;
    if (hasVotedToday) return;

    hasVotedToday = true;

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
            .eq('name', myPlayerName);

        if (error) throw error;

        hasVotedToday = true;
        document.getElementById('vote-select').classList.add('hidden');
        document.getElementById('vote-done').classList.remove('hidden');
    } catch (err) {
        console.error('投票エラー:', err);
        alert('投票に失敗しました。もう一度お試しください。');
    }
}

/**
 * 投票進捗カウンターとプログレスバーを更新
 */
function updateVoteProgress() {
    const alivePlayers = currentPlayers.filter(p => p.is_alive);
    const votedPlayers = alivePlayers.filter(p => p.vote_target_id);
    const total = alivePlayers.length;
    const voted = votedPlayers.length;

    const textEl = document.getElementById('vote-progress-text');
    const fillEl = document.getElementById('vote-progress-fill');
    if (textEl) textEl.textContent = `投票完了：${voted} / ${total}人`;
    if (fillEl) fillEl.style.width = total > 0 ? `${(voted / total) * 100}%` : '0%';

    const pTextEl = document.getElementById('vote-progress-text-player');
    const pFillEl = document.getElementById('vote-progress-fill-player');
    if (pTextEl) pTextEl.textContent = `投票完了：${voted} / ${total}人`;
    if (pFillEl) pFillEl.style.width = total > 0 ? `${(voted / total) * 100}%` : '0%';
}

/**
 * 全員投票済みかチェック（GMのみ実行）
 */
function checkAllVoted() {
    if (lastKnownPhase !== 'voting') return;
    if (isCountingVotes) return;

    const alivePlayers = currentPlayers.filter(p => p.is_alive);
    const votedPlayers = alivePlayers.filter(p => p.vote_target_id);

    if (alivePlayers.length > 0 && votedPlayers.length >= alivePlayers.length) {
        console.log('[VOTE] 全員投票完了。集計開始。');
        countAndExile();
    }
}

/**
 * GM手動締め切り
 */
async function closeVoting() {
    if (!confirm('投票を締め切り、その時点の票で集計しますか？（未投票は棄権扱い）')) return;
    // 即座に投票ボタンを無効化（未投票プレイヤーの後入り投票を防ぐ）
    disableVoteButtons();
    countAndExile();
}

/**
 * 集計と追放処理（GMのみ実行）
 */
/**
 * 投票UIを即座に無効化（締め切り後の後入り投票防止）
 */
function disableVoteButtons() {
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

async function countAndExile() {
    if (isCountingVotes) return;
    isCountingVotes = true;
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
        currentPlayers = freshPlayers;
    } catch (err) {
        console.error('投票情報の取得エラー:', err);
        isCountingVotes = false;
        return;
    }

    const alivePlayers = freshPlayers.filter(p => p.is_alive);

    // id → name のマップ
    const idToName = {};
    freshPlayers.forEach(p => { idToName[p.id] = p.name; });

    // 票数集計（生存者への投票のみ有効）
    const aliveIds = new Set(alivePlayers.map(p => p.id));
    const voteCounts = {};
    alivePlayers.forEach(p => {
        const tid = p.vote_target_id;
        if (tid && aliveIds.has(tid)) {
            voteCounts[tid] = (voteCounts[tid] || 0) + 1;
        }
    });

    // 投票ログ作成（答え合わせ用）
    const voteLog = alivePlayers.map(p => ({
        voter: p.name,
        target: p.vote_target_id ? idToName[p.vote_target_id] : null
    }));

    // 最多票を特定（票なし・同数はランダム）
    let exiledId, exiledName;

    if (Object.keys(voteCounts).length === 0) {
        const randomIdx = Math.floor(Math.random() * alivePlayers.length);
        exiledId = alivePlayers[randomIdx].id;
        exiledName = alivePlayers[randomIdx].name;
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
        isCountingVotes = false;
        return;
    }

    // てるてるが追放された場合、即座にてるてるの単独勝利としてゲーム終了
    if (isTeruteruExiled) {
        console.log('[VOTE] てるてるが追放されたため、てるてる単独勝利！');
        await triggerGameEnd('teruteru');
        // GMは直接リザルトを表示（他クライアントは is_alive の Realtime イベントから呼ばれる）
        showVoteResult(exiledName, voteLog);
        return;
    }

    // GMは直接リザルトを表示（他クライアントは is_alive の Realtime イベントから呼ばれる）
    showVoteResult(exiledName, voteLog);
}

/**
 * 投票結果画面を表示（全クライアント共通）
 * @param {string} exiledName - 追放されたプレイヤー名
 * @param {Array|null} voteLog - [{voter, target}] の配列（GMのみ持つ）
 */
async function showVoteResult(exiledName, voteLog) {
    const overlay = document.getElementById('vote-result-overlay');
    overlay.classList.remove('hidden');

    // 追放者の表示
    const exileEl = document.getElementById('vote-result-exile');
    exileEl.innerHTML = `🗳️ 「${exiledName}」が<br>追放されました`;

    // 投票ログの描画
    const listEl = document.getElementById('vote-result-list');
    listEl.innerHTML = '';

    // GM以外が呼び出した場合（Realtime経由）、自前で currentPlayers から voteLog を生成して全公開する
    let finalVoteLog = voteLog;
    if (!finalVoteLog) {
        const idToName = {};
        currentPlayers.forEach(p => { idToName[p.id] = p.name; });
        finalVoteLog = currentPlayers
            .filter(p => p.vote_target_id)
            .map(p => ({
                voter: p.name,
                target: idToName[p.vote_target_id] || '不明'
            }));
    }

    if (finalVoteLog && finalVoteLog.length > 0) {
        finalVoteLog.forEach((entry, i) => {
            const item = document.createElement('div');
            item.className = 'vote-log-item';
            item.style.animationDelay = `${i * 0.07}s`;

            const voterSpan = document.createElement('span');
            voterSpan.className = 'voter';
            voterSpan.textContent = entry.voter;

            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'arrow';
            arrowSpan.textContent = '➡️';

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
        listEl.innerHTML = `<div style="color:rgba(255,255,255,0.4); font-size:0.85rem; text-align:center; padding:0.5rem;">投票記録がありません</div>`;
    }

    // GMのみ「夜フェーズへ」ボタンを表示
    const btnNight = document.getElementById('btn-next-night');
    if (myRoleType === 'gm') {
        btnNight.classList.remove('hidden');
    } else {
        btnNight.classList.add('hidden');
    }

    // 全員：7秒カウントダウン後に自動で夜フェーズへ遷移（GMは手動ボタンでも可）
    const countdownEl = document.getElementById('vote-countdown');
    countdownEl.classList.remove('hidden');
    let sec = 7;
    countdownEl.textContent = `${sec}秒後に夜フェーズへ自動遷移...`;

    if (voteCountdownTimer) clearInterval(voteCountdownTimer);
    voteCountdownTimer = setInterval(() => {
        sec--;
        if (sec <= 0) {
            clearInterval(voteCountdownTimer);
            voteCountdownTimer = null;
            proceedToNight();
        } else {
            countdownEl.textContent = `${sec}秒後に夜フェーズへ自動遷移...`;
        }
    }, 1000);
}

/**
 * 投票結果から夜フェーズへ遷移（GMのみ Supabase を更新）
 */
async function proceedToNight() {
    if (voteCountdownTimer) {
        clearInterval(voteCountdownTimer);
        voteCountdownTimer = null;
    }

    // 投票結果オーバーレイを閉じる（全クライアント）
    document.getElementById('vote-result-overlay').classList.add('hidden');
    document.getElementById('vote-overlay').classList.add('hidden');

    // 全クライアント共通：投票日のフラグをリセット（2回目以降の投票対策）
    hasVotedToday = false;

    if (myRoleType !== 'gm') return; // GMのみ Supabase を更新

    try {
        // ── 占い師の集計（フェーズ移行前に実行）──
        // 占い師のnight_target_idを取得して、ターゲットの役職を確認し night_result を保存
        try {
            const { data: seerData, error: seerErr } = await supabaseClient
                .from('players')
                .select('id, name, night_target_id')
                .eq('role', '預言者')
                .eq('is_alive', true)
                .maybeSingle();

            if (!seerErr && seerData && seerData.night_target_id) {
                // ターゲットの役職を確認
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
                    console.log(`[SEER] 占い結果: ${result} (target_id: ${seerData.night_target_id})`);
                }
            }
        } catch (seerCalcErr) {
            console.warn('[SEER] 占い集計に失敗しましたが、フェーズ移行は続行します:', seerCalcErr);
        }

        // ── 霊媒師の集計（フェーズ移行前に実行）──
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
                    console.log(`[MEDIUM] 霊媒結果: ${result} (target_id: ${mediumData.night_target_id})`);
                }
            }
        } catch (mediumCalcErr) {
            console.warn('[MEDIUM] 霊媒集計に失敗しましたが、フェーズ移行は続行します:', mediumCalcErr);
        }

        // 全員の vote_target_id を NULL にリセット
        const { error: resetError } = await supabaseClient
            .from('players')
            .update({ vote_target_id: null })
            .neq('name', 'dummy_string_for_reset_12345');
        if (resetError) throw resetError;

        // 全員の night_target_id ・ night_result を NULL にリセット
        // （占い師・霊媒師が2ターン目以降に再度アクションできるようにする）
        const { error: nightResetError } = await supabaseClient
            .from('players')
            .update({ night_target_id: null, night_result: null })
            .neq('name', 'dummy_string_for_reset_12345');
        if (nightResetError) throw nightResetError;
        console.log('[NIGHT] night_target_id / night_result をリセットしました');

        // フェーズを night に
        const { error: phaseError } = await supabaseClient
            .from('game_status')
            .update({ current_phase: 'night' })
            .eq('id', 1);
        if (phaseError) throw phaseError;

        isCountingVotes = false;

    } catch (err) {
        console.error('夜フェーズ遷移エラー:', err);
        alert('夜フェーズへの遷移に失敗しました。');
    }
}


// =============================================
// 占い師（預言者）専用処理
// =============================================

/**
 * 占いターゲット選択ボタンを描画（ラジオ式）
 */
let selectedSeerTargetId = null;
let selectedSeerTargetName = null;

function renderSeerTargets() {
    const list = document.getElementById('seer-target-list');
    list.innerHTML = '';
    selectedSeerTargetId = null;
    selectedSeerTargetName = null;
    const btn = document.getElementById('btn-seer-divinate');
    btn.style.display = 'none';
    btn.disabled = false;

    const targets = currentPlayers.filter(p => p.is_alive && p.name !== myPlayerName);

    if (targets.length === 0) {
        list.innerHTML = '<p style="color:#888;">占えるプレイヤーがいません</p>';
        return;
    }

    targets.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button'; // フォーム送信防止（デフォルトはsubmit）
        b.className = 'target-btn';
        b.textContent = t.name;
        b.dataset.id = t.id;
        b.onclick = () => {
            // 選択状態の切り替え
            document.querySelectorAll('#seer-target-list .target-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedSeerTargetId = t.id;
            selectedSeerTargetName = t.name;
            btn.style.display = '';
        };
        list.appendChild(b);
    });
}

/**
 * 占い送信
 */
async function submitDivination() {
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
            .eq('name', myPlayerName);

        if (error) throw error;

        hasActedTonight = true;
        document.getElementById('night-seer').classList.add('hidden');
        document.getElementById('night-waiting').classList.remove('hidden');
        document.getElementById('night-waiting').innerHTML = `
            <h2>🔮 占い完了</h2><p style="color:#c0caf5;">占い完了。朝を待っています...</p>
        `;
    } catch (err) {
        console.error('占いエラー:', err);
        alert('占いの送信に失敗しました。');
        btn.disabled = false;
    }
}

/**
 * 朝フェーズ：占い師自身の night_result を取得して表示
 */
async function showSeerResult() {
    const resultArea = document.getElementById('seer-result-area');
    const resultText = document.getElementById('seer-result-text');

    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('night_result, night_target_id')
            .eq('name', myPlayerName)
            .maybeSingle();

        if (error) throw error;

        if (data && data.night_result && data.night_target_id) {
            // ターゲット名を currentPlayers から引く
            const target = currentPlayers.find(p => p.id === data.night_target_id);
            const targetName = target ? target.name : '不明';
            const resultLabel = data.night_result === '人狼'
                ? '<span style="color:#f7768e; font-weight:bold;">【人狼】</span>'
                : '<span style="color:#9ece6a; font-weight:bold;">【人間】</span>';
            resultText.innerHTML = `「${targetName}」さんは ${resultLabel} でした`;
            resultArea.classList.remove('hidden');
            // morning-overlay 内に表示されるので morning-overlay を表示状態にする
            document.getElementById('morning-overlay').classList.remove('hidden');
        } else {
            // 占い結果がまだない場合（初日など）は非表示のまま
            resultArea.classList.add('hidden');
        }
    } catch (err) {
        console.warn('[SEER] 占い結果取得エラー:', err);
        resultArea.classList.add('hidden');
    }
}


// =============================================
// 霊媒師専用処理
// =============================================

/**
 * 霊媒ターゲット選択ボタンを描画（死者のみ対象）
 */
let selectedMediumTargetId = null;
let selectedMediumTargetName = null;

function renderMediumTargets() {
    const list = document.getElementById('medium-target-list');
    list.innerHTML = '';
    selectedMediumTargetId = null;
    selectedMediumTargetName = null;
    const btn = document.getElementById('btn-medium-action');
    btn.style.display = 'none';
    btn.disabled = false;

    // 死亡しているプレイヤーのみを対象にする
    const targets = currentPlayers.filter(p => !p.is_alive);

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

/**
 * 霊媒送信
 */
async function submitMedium() {
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
            .eq('name', myPlayerName);

        if (error) throw error;

        hasActedTonight = true;
        document.getElementById('night-medium').classList.add('hidden');
        document.getElementById('night-waiting').classList.remove('hidden');
        document.getElementById('night-waiting').innerHTML = `
            <h2>🔮 霊媒完了</h2><p style="color:#c0caf5;">霊媒完了。朝を待っています...</p>
        `;
    } catch (err) {
        console.error('霊媒エラー:', err);
        alert('霊媒の送信に失敗しました。');
        btn.disabled = false;
    }
}

/**
 * 朝フェーズ：霊媒師自身の night_result を取得して表示
 */
async function showMediumResult() {
    const resultArea = document.getElementById('medium-result-area');
    const resultText = document.getElementById('medium-result-text');

    try {
        const { data, error } = await supabaseClient
            .from('players')
            .select('night_result, night_target_id')
            .eq('name', myPlayerName)
            .maybeSingle();

        if (error) throw error;

        if (data && data.night_result && data.night_target_id) {
            // ターゲット名を currentPlayers から引く（死者も含む）
            const target = currentPlayers.find(p => p.id === data.night_target_id);
            const targetName = target ? target.name : '不明';
            const resultLabel = data.night_result === '人狼'
                ? '<span style="color:#f7768e; font-weight:bold;">【人狼】</span>'
                : '<span style="color:#9ece6a; font-weight:bold;">【人間】</span>';
            resultText.innerHTML = `🔮 霊媒結果: 「${targetName}」さんは ${resultLabel} でした`;
            resultArea.classList.remove('hidden');
            // morning-overlay 内に表示されるので morning-overlay を表示状態にする
            document.getElementById('morning-overlay').classList.remove('hidden');
        } else {
            // 霊媒結果がまだない場合は非表示
            resultArea.classList.add('hidden');
        }
    } catch (err) {
        console.warn('[MEDIUM] 霊媒結果取得エラー:', err);
        resultArea.classList.add('hidden');
    }
}

/**
 * 朝フェーズ：昨晩人狼に襲撃された犠牲者を発表
 */
function showMorningVictims() {
    const textEl = document.getElementById('victim-result-text');
    if (!textEl) return;

    // 生存している人狼の night_target_id を集計
    // （朝フェーズ中はまだ night_target_id がリセットされずに残っている）
    const wolfTargetIds = currentPlayers
        .filter(p => p.role === '人狼' && p.night_target_id)
        .map(p => p.night_target_id);

    // 重複を排除
    const uniqueVictimIds = [...new Set(wolfTargetIds)];

    if (uniqueVictimIds.length > 0) {
        // ターゲットになったプレイヤーの中で、実際死亡している人（＝騎士に守られなかった人）の名前を取得
        const victims = currentPlayers.filter(p => uniqueVictimIds.includes(p.id) && !p.is_alive);
        if (victims.length > 0) {
            const victimNames = victims.map(v => v.name).join(' さん、');
            textEl.innerHTML = `昨晩の犠牲者は <span style="color:#f7768e; font-weight:bold;">${victimNames} さん</span> でした。`;
        } else {
            textEl.innerHTML = '昨晩は誰も死にませんでした。';
        }
    } else {
        textEl.innerHTML = '昨晩は誰も死にませんでした。';
    }
}


// =============================================
// 夜の襲撃処理（人狼専用）
// =============================================
let selectedWolfTargetId = null;
let selectedWolfTargetName = null;

function renderWolfTargets() {
    const list = document.getElementById('wolf-target-list');
    list.innerHTML = '';
    selectedWolfTargetId = null;
    selectedWolfTargetName = null;

    const btn = document.getElementById('btn-wolf-attack');
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
    }

    const targets = currentPlayers.filter(p => p.is_alive && p.name !== myPlayerName);

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

async function submitAttack() {
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
            .eq('name', myPlayerName);

        if (error) throw error;

        hasActedTonight = true;
        document.getElementById('night-wolf').classList.add('hidden');
        document.getElementById('night-waiting').classList.remove('hidden');
        document.getElementById('night-waiting').innerHTML = `
            <h2>襲撃完了</h2>
            <p style="color:#c0caf5;">今夜の任務を終えました。<br>静かに朝を待ちましょう…</p>
        `;
    } catch (err) {
        console.error('襲撃送信エラー:', err);
        alert('襲撃の送信に失敗しました。');
        if (btn) btn.disabled = false;
    }
}


// =============================================
// 守護処理（騎士専用）
// =============================================
let selectedKnightTargetId = null;
let selectedKnightTargetName = null;

function renderKnightTargets() {
    const list = document.getElementById('knight-target-list');
    list.innerHTML = '';
    selectedKnightTargetId = null;
    selectedKnightTargetName = null;

    const btn = document.getElementById('btn-knight-action');
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
    }

    // 生存しているプレイヤー全員（自分自身も守護対象に含める）
    const targets = currentPlayers.filter(p => p.is_alive);

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

async function submitKnightGuard() {
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
            .eq('name', myPlayerName);

        if (error) throw error;

        hasActedTonight = true;
        document.getElementById('night-knight').classList.add('hidden');
        document.getElementById('night-waiting').classList.remove('hidden');
        document.getElementById('night-waiting').innerHTML = `
            <h2>🛡️ 守護完了</h2>
            <p style="color:#c0caf5;">今夜の守護先を設定しました。<br>静かに朝を待ちましょう…</p>
        `;
    } catch (err) {
        console.error('守護送信エラー:', err);
        alert('守護の送信に失敗しました。');
        if (btn) btn.disabled = false;
    }
}


// =============================================
// 追放処理（GM専用）
// =============================================
async function killPlayer(name) {
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


// =============================================
// 役職カスタマイズ（GM専用）
// =============================================
function initRoleCounters() {
    const container = document.getElementById('role-counters');
    container.innerHTML = '';
    ROLES_INFO.forEach(role => {
        const row = document.createElement('div');
        row.className = 'role-row';
        row.innerHTML = `
            <div class="role-name">${role.name}</div>
            <div class="counter-group">
                <button class="counter-btn" onclick="changeRoleCount('${role.id}', -1)">-</button>
                <div id="count-${role.id}" class="role-count-display">0</div>
                <button class="counter-btn" onclick="changeRoleCount('${role.id}', 1)">+</button>
            </div>
        `;
        container.appendChild(row);
    });
    updateTotalInfo();
}

function changeRoleCount(id, delta) {
    if (roleCounts[id] + delta < 0) return;
    roleCounts[id] += delta;
    document.getElementById(`count-${id}`).textContent = roleCounts[id];
    updateTotalInfo();
}

function updateTotalInfo() {
    const totalRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    const totalInfoEl = document.getElementById('total-info');

    document.getElementById('total-role-count').textContent = totalRoles;
    document.getElementById('total-player-count').textContent = currentPlayersCount;

    if (totalRoles === currentPlayersCount && currentPlayersCount > 0) {
        totalInfoEl.className = 'total-info total-ok';
    } else {
        totalInfoEl.className = 'total-info total-error';
    }
}


// =============================================
// ゲーム開始・ランダム役職配布（GM専用）
// =============================================
async function distributeRolesAndStartGame() {
    const totalRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    if (totalRoles === 0) {
        alert('役職が設定されていません。少なくとも1つ設定してください。');
        return false;
    }
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

async function handlePhaseChange(newPhase) {
    if (lastKnownPhase === 'waiting' && newPhase !== 'waiting') {
        const isSuccess = await distributeRolesAndStartGame();
        if (!isSuccess) return;
    }
    // フェーズ変更時に投票フラグをリセット
    if (newPhase !== 'voting') {
        hasVotedToday = false;
        isCountingVotes = false;
    }
    // 夜フェーズから朝フェーズ（morning）へ移行する場合：占い師・霊媒師の結果を集計、および人狼の襲撃集計
    if (lastKnownPhase === 'night' && newPhase === 'morning') {
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
    // 夢フェーズへ直接移行する場合（GMが「夢フェーズ」ボタンを押した場合など）もリセットする
    if (newPhase === 'night') {
        try {
            const { error: nightResetError } = await supabaseClient
                .from('players')
                .update({ night_target_id: null, night_result: null })
                .neq('name', 'dummy_string_for_reset_12345');
            if (nightResetError) throw nightResetError;
            console.log('[NIGHT] handlePhaseChange: night_target_id / night_result をリセットしました');
        } catch (nightResetErr) {
            console.warn('[NIGHT] night リセットに失敗しましたが、フェーズ移行は続行します:', nightResetErr);
        }
    }
    try {
        const { error } = await supabaseClient
            .from('game_status')
            .update({ current_phase: newPhase })
            .eq('id', 1);
        if (error) throw error;
    } catch (error) {
        console.error('フェーズ更新エラー:', error);
        alert('フェーズの更新に失敗しました。');
    }
}


// =============================================
// リセット処理（GM専用）：ロビーに戻る
// =============================================
async function resetGame() {
    const confirmMsg = lastKnownPhase === 'result'
        ? 'ゲームを終了してロビーに戻りますか？'
        : 'ゲームを強制終了して、全プレイヤーの役職をリセットしロビーに戻りますか？';

    if (!confirm(confirmMsg)) return;

    if (voteCountdownTimer) { clearInterval(voteCountdownTimer); voteCountdownTimer = null; }

    try {
        // 全プレイヤーの role・is_alive・vote_target_id をリセット
        const { error: resetError } = await supabaseClient
            .from('players')
            .update({ role: null, is_alive: true, vote_target_id: null, night_target_id: null, night_result: null })
            .neq('name', 'dummy_string_for_reset_12345');
        if (resetError) throw resetError;

        // game_status を waiting に戻す
        const { error: phaseError } = await supabaseClient
            .from('game_status')
            .update({ current_phase: 'waiting', winner: null })
            .eq('id', 1);

        if (phaseError) {
            const { error: fallbackError } = await supabaseClient
                .from('game_status')
                .update({ current_phase: 'waiting' })
                .eq('id', 1);
            if (fallbackError) throw fallbackError;
        }

        Object.keys(roleCounts).forEach(k => roleCounts[k] = 0);
        hasVotedToday = false;
        isCountingVotes = false;

    } catch (err) {
        console.error('リセットエラー:', err);
        alert('リセット処理中にエラーが発生しました。');
    }
}


// =============================================
// ログイン・セッション管理
// =============================================
function saveSession(name, roleType) {
    sessionStorage.setItem('werewolf_playerName', name);
    sessionStorage.setItem('werewolf_roleType', roleType);
}

function restoreSession() {
    const savedName = sessionStorage.getItem('werewolf_playerName');
    const savedRole = sessionStorage.getItem('werewolf_roleType');
    if (savedName && savedRole) {
        myPlayerName = savedName;
        myRoleType = savedRole;
        setupGameView();
        return true;
    }
    return false;
}

function clearSession() {
    sessionStorage.removeItem('werewolf_playerName');
    sessionStorage.removeItem('werewolf_roleType');
    alert('ログイン情報をリセットしました。');
    location.reload();
}

async function joinGame(role) {
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
        } else if (role === 'player') {
            const { error } = await supabaseClient
                .from('players')
                .insert([{ name: name }]);
            if (error) {
                alert('参加に失敗しました。名前が被っているか、テーブル設定を確認してください。');
                event.currentTarget.innerHTML = originalText;
                btns.forEach(btn => btn.disabled = false);
                return;
            }
        }
        myPlayerName = name;
        myRoleType = role;
        saveSession(name, role);
        setupGameView();
    } catch (err) {
        console.error(err);
        alert('予期せぬエラーが発生しました。');
        event.currentTarget.innerHTML = originalText;
        btns.forEach(btn => btn.disabled = false);
    }
}

function setupGameView() {
    loginView.classList.add('hidden');
    gameView.classList.remove('hidden');

    if (myRoleType === 'gm') {
        gmPanel.classList.remove('hidden');
        gmNameDisplay.textContent = `GM: ${myPlayerName} さん`;
        gmNameDisplay.classList.remove('hidden');
        initRoleCounters();
    }
    startGameSync();
}


// =============================================
// リアルタイム同期（Supabase Realtime）
// =============================================
async function startGameSync() {
    try {
        const phaseRes = await supabaseClient
            .from('game_status')
            .select('current_phase, winner')
            .limit(1)
            .single();
        if (phaseRes.error) throw phaseRes.error;

        // role・vote_target_id を含めて取得
        const playersRes = await supabaseClient
            .from('players')
            .select('id, name, is_alive, role, vote_target_id');
        if (playersRes.error) throw playersRes.error;

        currentPlayers = playersRes.data ? playersRes.data : [];
        renderPlayerList();

        if (phaseRes.data.winner) {
            _pendingWinner = phaseRes.data.winner;
        }

        await updatePhaseDisplay(phaseRes.data.current_phase);

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
                    _pendingWinner = payload.new.winner;
                }
                await updatePhaseDisplay(payload.new.current_phase);
            }
        )
        // プレイヤーの入室
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players' },
            (payload) => {
                currentPlayers.push(payload.new);
                renderPlayerList();
            }
        )
        // プレイヤー情報の更新（is_alive / vote_target_id 変更）
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' },
            async (payload) => {
                const idx = currentPlayers.findIndex(p => p.name === payload.new.name);
                // 更新前の法態を保存（vote_target_id変化検知に使用）
                const prevPlayer = idx !== -1 ? currentPlayers[idx] : null;
                const wasAlive = prevPlayer ? prevPlayer.is_alive : true;
                const justDied = wasAlive && !payload.new.is_alive;

                if (idx !== -1) {
                    currentPlayers[idx] = payload.new;
                } else {
                    currentPlayers.push(payload.new);
                }
                renderPlayerList();

                // 朝フェーズ中の場合、犠牲者の表示を更新
                if (lastKnownPhase === 'morning') {
                    showMorningVictims();
                }

                // 自分が死亡した場合は霊界モードをチェック
                if (myRoleType === 'player' && payload.new.name === myPlayerName) {
                    checkMyAliveStatus();
                }

                // 死亡時の処理（勝利判定および投票結果の同期表示）
                if (justDied) {
                    checkWinCondition();

                    // GM以外のプレイヤー画面で、投票フェーズ中に誰かが死亡（＝追放）した場合、投票結果画面を同期表示する
                    if (lastKnownPhase === 'voting' && myRoleType !== 'gm') {
                        showVoteResult(payload.new.name, null);
                    }
                }

                // vote_target_id が「実際に変化」した場合のみ→ 投票進捗更新・全員投票チェック
                // (以前は 'vote_target_id' in payload.new だったが、payload.newは常に全カラムを含むため常にtrueになるバグがあった)
                const oldVoteTargetId = prevPlayer ? prevPlayer.vote_target_id : undefined;
                if (payload.new.vote_target_id !== oldVoteTargetId) {
                    updateVoteProgress();
                    if (myRoleType === 'gm') {
                        checkAllVoted();
                    }
                }

                // 自分の night_result が「実際に変化」した場合→ 朝フェーズ中なら結果を再表示
                // （フェーズ変更イベントと night_result 更新イベントの到着順穏で結果が見えない場合のフォールバック）
                if (myRoleType === 'player' && payload.new.name === myPlayerName && lastKnownPhase === 'morning') {
                    const prevResult = prevPlayer ? prevPlayer.night_result : undefined;
                    if (payload.new.night_result !== prevResult && payload.new.night_result) {
                        console.log('[MORNING] night_result が到着。結果を再表示します。');
                        if (myRoleName === '預言者') {
                            await showSeerResult();
                        } else if (myRoleName === '霊媒師') {
                            await showMediumResult();
                        }
                    }
                }
            }
        )
        // プレイヤーの退出
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' },
            (payload) => {
                currentPlayers = currentPlayers.filter(p => p.name !== payload.old.name);
                renderPlayerList();
            }
        )
        .subscribe();
}


// =============================================
// 初期化
// =============================================
window.addEventListener('DOMContentLoaded', () => {
    restoreSession();
});
