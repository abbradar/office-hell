import { isTouchDevice } from './input/device';

// Logical play field. Sprites are fixed pixel sizes (player/enemies are 48px,
// bullets ~6–8px), so shrinking these constants makes everything fill more of
// the screen — characters look ~20% larger relative to the field. Phaser is
// configured with Scale.FIT, so the canvas still scales to fit the page.
export const GAME_W = 400;
export const GAME_H = 660;

export const PLAYER_SPEED = 280;
export const PLAYER_HITBOX_RADIUS = 4;
export const PLAYER_Y = GAME_H - 80;

export const BULLET_RADIUS = 3;
export const ENTITY_POOL_SIZE = 1024;
export const CULL_MARGIN = 96;

// On touch devices we extend the canvas vertically to add a control band
// below the play area so the buttons live outside the playfield. The canvas
// aspect is matched to the viewport so Scale.FIT fills the screen with no
// letterboxing — a typical 9:19.5 phone gives a band of ~210px, plenty for
// the move + bomb buttons. On desktop (or landscape touch) the band is 0
// and the buttons fall back to their original in-playfield positions.
export const CANVAS_W = GAME_W;
export const CANVAS_H = computeCanvasH();
export const BUTTON_BAND_H = CANVAS_H - GAME_H;

function computeCanvasH(): number {
  if (!isTouchDevice) return GAME_H;
  // Match the canvas aspect to the body's content box. The host page pads
  // the body by the top/side safe-area insets (notch, rounded corners), so
  // body width/height already excludes those — using it here means Scale.FIT
  // fills the safe rectangle edge-to-edge instead of letterboxing inside it.
  // The bottom is intentionally not inset, so the control band reaches the
  // physical screen bottom (home indicator overlapping a button is fine).
  const rect = document.body.getBoundingClientRect();
  const usableW = rect.width;
  const usableH = rect.height;
  if (!usableW || !usableH) return GAME_H;
  const aspectH = (GAME_W * usableH) / usableW;
  return Math.max(GAME_H, Math.round(aspectH));
}
