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
// =============================================
export const GAME_TIMELINE = [
    { period: "朝礼", phase: "waiting", label: "ルール説明" },
    { period: "朝礼", phase: "confirm_role", label: "役職の確認" }, // ★これを追加
    { period: "1限前休み", phase: "night", label: "【1日目】1日目夜！" },
    { period: "2限前休み", phase: "morning", label: "【2日目】朝の生存確認" },
    { period: "2限前休み", phase: "discussion", label: "【2日目】昼の議論" },
    { period: "2限前休み", phase: "voting", label: "【2日目】投票" },
    { period: "2限前休み", phase: "night", label: "【2日目】夜の襲撃" },
    { period: "3限前休み", phase: "morning", label: "【3日目】朝の生存確認" },
    { period: "3限前休み", phase: "discussion", label: "【3日目】昼の議論" },
    { period: "3限前休み", phase: "voting", label: "【3日目】投票" },
    { period: "3限前休み", phase: "night", label: "【3日目】夜の襲撃" },
    { period: "昼休み(前半)", phase: "morning", label: "【4日目】朝の生存確認" },
    { period: "昼休み(前半)", phase: "discussion", label: "【4日目】昼の議論" },
    { period: "昼休み(前半)", phase: "voting", label: "【4日目】投票" },
    { period: "昼休み(前半)", phase: "night", label: "【4日目】夜の襲撃" },
    { period: "昼休み(中盤)", phase: "morning", label: "【5日目】朝の生存確認" },
    { period: "昼休み(中盤)", phase: "discussion", label: "【5日目】大議論フェーズ！！" },
    { period: "昼休み(後半)", phase: "voting", label: "【5日目】投票" },
    { period: "昼休み(後半)", phase: "night", label: "【5日目】夜の襲撃" },
    { period: "5限前休み", phase: "morning", label: "【6日目】朝の生存確認" },
    { period: "5限前休み", phase: "discussion", label: "【6日目】昼の議論" },
    { period: "5限前休み", phase: "voting", label: "【6日目】投票" },
    { period: "5限前休み", phase: "night", label: "【6日目】夜の襲撃" },
    { period: "6限前休み", phase: "morning", label: "【7日目】朝の生存確認" },
    { period: "6限前休み", phase: "discussion", label: "【7日目】昼の議論" },
    { period: "6限前休み", phase: "voting", label: "【7日目】投票" },
    { period: "6限前休み", phase: "night", label: "【7日目】夜の襲撃" },
    { period: "終礼", phase: "result", label: "結果発表・ネタばらし！" }
];

// =============================================
// 定数
// =============================================
export const phaseNames = {
    'waiting': '待機中',
    'confirm_role': '役職確認',
    'morning': '朝フェーズ',
    'discussion': '議論中',
    'voting': '投票中',
    'night': '夜フェーズ',
    'result': '終了'
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
        summary: '毎晩、生存しているプレイヤーの中から1人を人狼の襲撃から守る。',
        details: '夜フェーズに生存しているプレイヤー（自分自身を含む）を1人選択し、守護します。人狼の襲撃先と一致した場合は、そのプレイヤーの死亡を防ぐことができます。',
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
