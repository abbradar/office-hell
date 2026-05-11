// Logical play field. Sprites are fixed pixel sizes (player/enemies are 48px,
// bullets ~6–8px), so shrinking these constants makes everything fill more of
// the screen — characters look ~20% larger relative to the field. Phaser is
// configured with Scale.FIT, so the canvas still scales to fit the page.
export const GAME_W = 400;
export const GAME_H = 660;
// Width of the static side walls; the playable corridor between them is
// `GAME_W - 2 * WALL_W`. Read by Player.ts to clamp horizontal movement
// inside the corridor. Must match the visible wall-column width baked
// into src/assets/bg/walls.png.
export const WALL_W = 18;
// HUD header strip drawn at the top of the canvas (hp / bombs / boss
// name). Exported so Player.ts can clamp vertical movement just below
// it without duplicating the literal.
export const HEADER_H = 28;

export const PLAYER_SPEED = 280;

export const PLAYER_HITBOX_RADIUS = 4;
export const PLAYER_Y = GAME_H - 80;

// Master switch for the Touhou-style hitbox dot. When on, the dot is
// visible only during focus mode on desktop (where Shift opts the
// player into precise dodging) and unconditionally on touch devices
// (no Shift key, and the small dot is the only reliable way to read
// the hurtbox under a finger). Always hidden while physics is paused
// (dialogue / overlays) regardless of platform. Flip to false to kill
// the marker entirely.
export const SHOW_PLAYER_HITBOX: boolean = true;

// Top-of-screen dead zone — entities with `y < DEADZONE_Y` are exempt from
// damage collisions. Stops the player auto-firing through enemies that have
// spawned at `y = -30` and are still drifting into the visible area, which
// would otherwise let off-screen pre-entry kills happen and feel arbitrary.
// Sized just below the HUD's 28px header strip.
export const DEADZONE_Y = 32;

export const BULLET_RADIUS = 3;
export const CULL_MARGIN = 96;

// Both physics and script ticks run at a fixed 60Hz simulation rate (Phaser
// arcade's `fixedStep` accumulator + StageManager's matching one, both fed
// the same scene `delta`). So "frames to traverse D at S" = D / (S /
// SCRIPT_FPS) holds regardless of render rate — a 144Hz monitor renders 2.4
// frames per simulated tick; a slow render frame catches up by firing extra
// ticks for both clocks together.
export const SCRIPT_FPS = 60;

// Developer-mode master switch. Gates: the PRACTICE entry on the title
// screen (TestMenuScene + the `T` keybind), the GameScene debug HUD line
// (track / t / wave / yield reason), and the `debugYieldReasons` stamping
// that feeds the yield label into that line. Bound to Vite's dev flag so
// `npm run dev` ships with all of them on and `npm run build` strips them
// from the prod build. Flip locally if you need the dev affordances on top
// of a prod build.
export const DEVELOPER_MODE: boolean = import.meta.env.DEV;
