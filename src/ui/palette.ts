// Central palette. Single source of truth for every color in the game.
//
// Two parallel forms exist for each constant:
//   - `0x...` (number) for Phaser graphics: fillStyle, lineStyle, setTint,
//     and `add.rectangle(x, y, w, h, color)`.
//   - `'#...'` (string) for Phaser text style `color`, `setBackgroundColor`,
//     and DOM CSS strings (the pattern sandbox textarea overlay).
//
// Game theme is "office, after-hours" — dark navy walls, dark floor,
// vibrant accent colors over a light-on-dark typography scheme.

// --- Surfaces -------------------------------------------------------------

export const COLOR_WALL = 0x3c4551;
export const COLOR_WALL_STR = '#3c4551';
export const COLOR_WALL_BORDER = 0x6262a0;
export const COLOR_WALL_BORDER_STR = '#6262a0';

// Cards, modals, dialog box, header bar — slightly lighter than walls so
// stacked surfaces visually separate.
export const COLOR_PANEL = 0x1c1c2e;
export const COLOR_PANEL_STR = '#1c1c2e';
export const COLOR_PANEL_BORDER = 0x444466;
export const COLOR_PANEL_BORDER_STR = '#444466';

// Floating speech bubbles. Stays warm cream regardless of theme — they're
// a UI convention (sticky note / paper) sitting separate from the
// environment palette, and the cream pops against the dark walls.
export const COLOR_BUBBLE = 0xfff8e0;
export const COLOR_BUBBLE_STR = '#fff8e0';

// --- Text -----------------------------------------------------------------

// Body, dialog, default text. White on dark surfaces.
export const COLOR_TEXT_PRIMARY = 0xffffff;
export const COLOR_TEXT_PRIMARY_STR = '#ffffff';
export const COLOR_TEXT_MUTED = 0xaaaaaa;
export const COLOR_TEXT_MUTED_STR = '#aaaaaa';
export const COLOR_TEXT_DIM = 0x888888;
export const COLOR_TEXT_DIM_STR = '#888888';

// Dark text — for use on always-light surfaces (gold name plate, cream
// bubbles) regardless of theme. Distinct from `COLOR_NO_TINT` below: this
// is a *text color*, not a sprite tint.
export const COLOR_TEXT_INVERSE = 0x1a1a2a;
export const COLOR_TEXT_INVERSE_STR = '#1a1a2a';

// Pure white. Use for sprite tint identity (`setTint(COLOR_NO_TINT)` =
// "render the sprite untinted"), hitbox outlines that need to read
// against any background. Same hex as `COLOR_TEXT_PRIMARY` in the
// dark theme but semantically distinct — if the theme ever flips,
// PRIMARY follows the bg, NO_TINT stays white.
export const COLOR_NO_TINT = 0xffffff;

// --- Accents (vibrant — kept across theme flips) --------------------------

export const COLOR_ACCENT_GOLD = 0xffd96a;
export const COLOR_ACCENT_GOLD_STR = '#ffd96a';
export const COLOR_ACCENT_RED = 0xf73b29;
export const COLOR_ACCENT_RED_STR = '#f73b29';
export const COLOR_ACCENT_GREEN = 0x6cf0a8;
export const COLOR_ACCENT_GREEN_STR = '#6cf0a8';
// Player hitbox + danger callouts. Slightly hotter than ACCENT_RED.
export const COLOR_DANGER = 0xff3344;
export const COLOR_DANGER_STR = '#ff3344';

// --- Bullets (semantic) ---------------------------------------------------

// Default enemy bullet — pure white for maximum threat readability.
export const COLOR_BULLET_DEFAULT = 0xffffff;
// Player bullets keep their vibrant green identity.
export const COLOR_PLAYER_BULLET = COLOR_ACCENT_GREEN;
export const COLOR_PLAYER_BULLET_HIGHLIGHT = 0xffffff;
// Chart wedge / column palette — six saturated hues that hold up at 6×6 px
// and stay distinct against the dark corridor background. Pie wedges cycle
// through all six; bar columns use the first five. Multiplied into the
// white interior of the chart-cell sprite at spawn time via setTint.
export const CHART_TINTS = [0xff5577, 0xff9944, 0xffd96a, 0x6cf0a8, 0x60c0e8, 0xc080ff] as const;

// --- Bomb / explosion (kept verbatim — fire colors read on any bg) --------

export const COLOR_BOMB_CORE = 0xff3322;
export const COLOR_BOMB_GLOW = 0xffe066;
export const COLOR_BOMB_HOT = 0xfff066;
export const COLOR_BOMB_RING = 0xff9933;
export const COLOR_BOMB_HIGHLIGHT = 0xffffff;

// --- DOM (PatternTest textarea overlay) -----------------------------------

export const DOM_TEXTAREA_BG = 'rgba(8, 8, 32, 0.95)';
export const DOM_TEXTAREA_FG = '#f4f4f8';
export const DOM_TEXTAREA_BORDER = COLOR_PANEL_BORDER_STR;
