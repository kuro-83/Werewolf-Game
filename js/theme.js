// =============================================
// js/theme.js
// テーブルの配色（自分の画面だけ）と、フェーズに合わせた照明の切り替え
// =============================================

const PALETTES = ['wine', 'felt', 'navy', 'ember'];
const DEFAULT_PALETTE = 'wine';
const PALETTE_KEY = 'werewolf_palette';

// フェーズ → テーブルの照明
const LIGHT_BY_PHASE = {
    waiting: 'night',
    confirm_role: 'night',
    night: 'night',
    morning: 'morning',
    discussion: 'day',
    voting: 'day',
    result: 'day'
};

/** 保存されている配色（読めない・不正な値なら wine） */
function loadPalette() {
    try {
        const saved = localStorage.getItem(PALETTE_KEY);
        return PALETTES.includes(saved) ? saved : DEFAULT_PALETTE;
    } catch (e) {
        return DEFAULT_PALETTE;
    }
}

/** 配色を切り替える（DB には保存しない。この端末の localStorage だけ） */
export function setPalette(key) {
    const palette = PALETTES.includes(key) ? key : DEFAULT_PALETTE;
    document.documentElement.dataset.palette = palette;
    try {
        localStorage.setItem(PALETTE_KEY, palette);
    } catch (e) {
        // 保存できなくても、今の画面の配色は変わる
    }
    document.querySelectorAll('.palette-option').forEach(opt => {
        opt.setAttribute('aria-checked', String(opt.dataset.paletteKey === palette));
    });
}

/** フェーズに合わせてテーブルの照明（夜・朝・昼）を切り替える */
export function setLightForPhase(phase) {
    document.documentElement.dataset.light = LIGHT_BY_PHASE[phase] || 'night';
}

// ---- 配色パネル ----
let openedBy = null;

function placePanel(panel, button) {
    const rect = button.getBoundingClientRect();
    const gutter = 16;
    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
    panel.style.right = `${Math.max(gutter, Math.round(window.innerWidth - rect.right))}px`;
}

function openPanel(button) {
    const panel = document.getElementById('palette-panel');
    if (!panel) return;
    placePanel(panel, button);
    panel.classList.remove('hidden');
    openedBy = button;
    document.querySelectorAll('[data-palette-toggle]').forEach(b => b.setAttribute('aria-expanded', String(b === button)));
    const current = panel.querySelector('.palette-option[aria-checked="true"]') || panel.querySelector('.palette-option');
    if (current) current.focus();
}

function closePanel({ returnFocus = false } = {}) {
    const panel = document.getElementById('palette-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    document.querySelectorAll('[data-palette-toggle]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (returnFocus && openedBy) openedBy.focus();
    openedBy = null;
}

/** ページを開いたときに配色を復元し、配色ボタン・パネルを使えるようにする */
export function initPalette() {
    setPalette(loadPalette());

    document.querySelectorAll('[data-palette-toggle]').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (openedBy === button) {
                closePanel();
            } else {
                openPanel(button);
            }
        });
    });

    const options = [...document.querySelectorAll('.palette-option')];
    options.forEach((opt, i) => {
        opt.addEventListener('click', () => {
            setPalette(opt.dataset.paletteKey);
        });
        // 上下キーで選択肢を移動
        opt.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const next = options[(i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length];
            next.focus();
        });
    });

    // パネルの外をクリック／Esc で閉じる
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('palette-panel');
        if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target)) {
            closePanel();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePanel({ returnFocus: true });
    });
    window.addEventListener('resize', () => closePanel());
}
