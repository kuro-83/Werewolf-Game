// =============================================
// js/config.js
// Supabase初期化・定数・タイムライン・役職情報
// =============================================

// =============================================
// Supabase 初期化
// =============================================
export const SUPABASE_URL = 'https://lncmwzcoxnwonockzmkf.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuY213emNveG53b25vY2t6bWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxOTY1MTgsImV4cCI6MjA5NDc3MjUxOH0.WH9wPObg7tyfE1w8ZLzrDPvjoCicp8ROm6AcegIfqvk';
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// タイムスケジュール（タイムライン）定義
// label は「2日目　朝の生存確認」の形（日付と内容の間は全角スペース）。上のバーの「○日目」もここから読む
// =============================================
export const GAME_TIMELINE = [
    { period: "朝礼", phase: "waiting", label: "ルール説明" },
    { period: "朝礼", phase: "confirm_role", label: "役職の確認" },
    { period: "1限前休み", phase: "night", label: "1日目　夜" },
    { period: "2限前休み", phase: "morning", label: "2日目　朝の生存確認" },
    { period: "2限前休み", phase: "discussion", label: "2日目　昼の議論" },
    { period: "2限前休み", phase: "voting", label: "2日目　投票" },
    { period: "2限前休み", phase: "night", label: "2日目　夜の襲撃" },
    { period: "3限前休み", phase: "morning", label: "3日目　朝の生存確認" },
    { period: "3限前休み", phase: "discussion", label: "3日目　昼の議論" },
    { period: "3限前休み", phase: "voting", label: "3日目　投票" },
    { period: "3限前休み", phase: "night", label: "3日目　夜の襲撃" },
    { period: "昼休み(前半)", phase: "morning", label: "4日目　朝の生存確認" },
    { period: "昼休み(前半)", phase: "discussion", label: "4日目　昼の議論" },
    { period: "昼休み(前半)", phase: "voting", label: "4日目　投票" },
    { period: "昼休み(前半)", phase: "night", label: "4日目　夜の襲撃" },
    { period: "昼休み(中盤)", phase: "morning", label: "5日目　朝の生存確認" },
    { period: "昼休み(中盤)", phase: "discussion", label: "5日目　大議論" },
    { period: "昼休み(後半)", phase: "voting", label: "5日目　投票" },
    { period: "昼休み(後半)", phase: "night", label: "5日目　夜の襲撃" },
    { period: "5限前休み", phase: "morning", label: "6日目　朝の生存確認" },
    { period: "5限前休み", phase: "discussion", label: "6日目　昼の議論" },
    { period: "5限前休み", phase: "voting", label: "6日目　投票" },
    { period: "5限前休み", phase: "night", label: "6日目　夜の襲撃" },
    { period: "6限前休み", phase: "morning", label: "7日目　朝の生存確認" },
    { period: "6限前休み", phase: "discussion", label: "7日目　昼の議論" },
    { period: "6限前休み", phase: "voting", label: "7日目　投票" },
    { period: "6限前休み", phase: "night", label: "7日目　夜の襲撃" },
    { period: "終礼", phase: "result", label: "結果発表・ネタばらし" }
];

/**
 * タイムテーブルの行から「何日目か」を取り出す（label の先頭の「N日目」）
 * @returns {number|null} 取り出せなければ null（ルール説明・結果発表など）
 */
export function dayOfTimelineIndex(index) {
    const step = GAME_TIMELINE[index];
    const match = step ? step.label.match(/^(\d+)日目/) : null;
    return match ? Number(match[1]) : null;
}

// =============================================
// 定数
// =============================================
// 上のバーに大きく出すフェーズ名
export const phaseNames = {
    'waiting': '待機中',
    'confirm_role': '役職確認',
    'morning': '朝',
    'discussion': '昼',
    'voting': '投票',
    'night': '夜',
    'result': '結果発表'
};

export const ROLES_INFO = [
    {
        id: 'wolf',
        name: '人狼',
        faction: '人狼陣営',
        summary: '夜に他プレイヤーを襲撃し、生存人数を減らす。',
        details: '夜フェーズに人狼同士で襲撃するターゲットを選択し、翌朝に死亡させます。占い結果や霊媒結果では「人狼」と判定されます。',
        win_condition: '生存している人狼の人数が、市民陣営（他役職）の生存人数以上になること。'
    },
    {
        id: 'citizen',
        name: '市民',
        faction: '市民陣営',
        summary: '能力を持たない普通の人間。議論を通じて人狼を推測し、追放する。',
        details: '夜フェーズのアクションはありません。昼の議論と投票により、人狼を全員追放することを目指します。占い・霊媒結果は「人間」です。',
        win_condition: '人狼を全員追放すること（市民陣営の勝利）。'
    },
    {
        id: 'seer',
        name: '預言者',
        faction: '市民陣営',
        summary: '毎晩、生存者の中から1人を選び、その正体（人狼か人間か）を知る。',
        details: '夜フェーズに生存者1人を選んで占います。その結果（人狼または人間）は翌朝フェーズに本人のみに開示されます。',
        win_condition: '人狼を全員追放すること（市民陣営の勝利）。'
    },
    {
        id: 'medium',
        name: '霊媒師',
        faction: '市民陣営',
        summary: '毎晩、死亡したプレイヤーの中から1人を選び、その正体を知る。',
        details: '夜フェーズに死亡しているプレイヤーから1人を選び、霊媒します。その結果（人狼または人間）は翌朝フェーズに本人のみに開示されます。',
        win_condition: '人狼を全員追放すること（市民陣営の勝利）。'
    },
    {
        id: 'knight',
        name: '騎士',
        faction: '市民陣営',
        summary: '毎晩、自分以外の生存しているプレイヤーの中から1人を人狼の襲撃から守る。',
        details: '夜フェーズに自分以外の生存しているプレイヤーを1人選択し、守護します（自分自身は守れません）。人狼の襲撃先と一致した場合は、そのプレイヤーの死亡を防ぐことができます。',
        win_condition: '人狼を全員追放すること（市民陣営の勝利）。'
    },
    {
        id: 'teruteru',
        name: 'てるてる',
        faction: '第三陣営',
        summary: '昼の投票で追放（処刑）されると単独で勝利する。',
        details: '夜のアクションはありません。人狼に襲撃されて死亡した場合は敗北となります。昼の投票で追放された場合のみ、その場で単独勝利（teruteru）としてゲームが終了します。',
        win_condition: '昼フェーズの投票によって自分が追放（処刑）されること。'
    }
];

// 役職バッジのCSSクラスマッピング
export const ROLE_BADGE_CLASS = {
    '人狼': 'role-badge-wolf',
    '市民': 'role-badge-citizen',
    '預言者': 'role-badge-seer',
    '霊媒師': 'role-badge-medium',
    '騎士': 'role-badge-knight',
    'てるてる': 'role-badge-teruteru'
};

// 夜フェーズにアクションがある役職（ここにない役職は夜にダミー質問が出る）
export const NIGHT_ACTION_ROLES = ['人狼', '預言者', '霊媒師', '騎士'];

// 夜フェーズのダミー質問（夜アクションがない人が、役職持ちと同じように画面を操作するためのもの）
export const DUMMY_QUESTIONS = [
    'この中で一番朝に弱そうなのは？',
    'この中で一番お菓子を持ち歩いていそうなのは？',
    'この中で一番カラオケで盛り上げてくれそうなのは？',
    'この中で一番テスト前に焦っていそうなのは？',
    'この中で一番方向音痴そうなのは？',
    'この中で一番字がきれいそうなのは？',
    'この中で一番スマホの充電が切れていそうなのは？',
    'この中で一番遅刻ギリギリに来そうなのは？',
    'この中で一番料理が上手そうなのは？',
    'この中で一番ホラー映画が苦手そうなのは？',
    'この中で一番ゲームが強そうなのは？',
    'この中で一番忘れ物が多そうなのは？',
    'この中で一番早寝しそうなのは？',
    'この中で一番無人島で生き残れそうなのは？',
    'この中で一番写真を撮るのがうまそうなのは？',
    'この中で一番秘密を守れそうなのは？',
    'この中で一番辛いものが得意そうなのは？',
    'この中で一番運動会で活躍しそうなのは？',
    'この中で一番動物に好かれそうなのは？',
    'この中で一番人狼っぽい顔をしているのは？'
];
