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

// Floor "cell" (the darker shade behind the diamonds in the recolored
// pattern PNG) and the diamond shape itself (a slightly lighter shade
// on top of the cells). Two close shades — pattern is subtle, not loud.
export const COLOR_FLOOR_BG = 0x1a1a28;
export const COLOR_FLOOR_BG_STR = '#1a1a28';
export const COLOR_FLOOR_PATTERN = 0x303048;
export const COLOR_FLOOR_PATTERN_STR = '#303048';
export const COLOR_FLOOR_BORDER = 0x303048;
export const COLOR_FLOOR_BORDER_STR = '#303048';

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
export const COLOR_ACCENT_RED = 0xff5577;
export const COLOR_ACCENT_RED_STR = '#ff5577';
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
// Missed-call notification.
export const COLOR_MISSED_CALL_OUTER = COLOR_ACCENT_RED;
export const COLOR_MISSED_CALL_INNER = 0xffffff;
// Email envelope.
export const COLOR_EMAIL_BORDER = 0x665522;
export const COLOR_EMAIL_PAPER = 0xf0e0a0;
// Question card.
export const COLOR_QUESTION_TILE = 0xf0c840;
export const COLOR_QUESTION_STAMP = 0xffffff;
// Drink glass.
export const COLOR_DRINK_GLASS = 0x335588;
export const COLOR_DRINK_LIQUID = 0x60c0e8;
export const COLOR_DRINK_FOAM = 0xffffff;
// Report paper.
export const COLOR_REPORT_BORDER = 0xc0b890;
export const COLOR_REPORT_PAPER = 0xf0e8d0;
// Pill / vitamin capsule — two-tone stadium shape with a dark outline.
// Warm orange + cream so it reads as a vitamin (not a prescription drug)
// and stays distinct from the cooler drink/email/report bullets.
export const COLOR_PILL_BORDER = 0x33334a;
export const COLOR_PILL_LEFT = 0xff9944;
export const COLOR_PILL_RIGHT = 0xfff8e0;
// Video-camera bullet — side-view camcorder painted in Google Meet
// brand colors. Google green body, Google blue lens pupil ("live" /
// pointed-at-you), Google red REC pixel. Dark outline holds the
// silhouette against the corridor.
export const COLOR_CAMERA_BORDER = 0x14141e;
export const COLOR_CAMERA_BODY = 0x34a853;
export const COLOR_CAMERA_LENS_DARK = 0x05050a;
export const COLOR_CAMERA_LENS_BRIGHT = 0x4285f4;
export const COLOR_CAMERA_REC = 0xea4335;
// Chart-cell bullet — neutral 8×8 tile recolored at spawn via setTint to
// flag pie wedges and bar columns. Border stays dark under the multiplicative
// tint; the white fill picks up the tint as the wedge / column color.
export const COLOR_CHART_CELL_BORDER = 0x202032;
export const COLOR_CHART_CELL_FILL = 0xffffff;
// Chart wedge / column palette — six saturated hues that hold up at 6×6 px
// and stay distinct against the dark corridor background. Pie wedges cycle
// through all six; bar columns use the first five.
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
