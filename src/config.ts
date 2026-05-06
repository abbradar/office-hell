import { isTouchDevice } from './input/device';

// Logical play field. Sprites are fixed pixel sizes (player/enemies are 48px,
// bullets ~6–8px), so shrinking these constants makes everything fill more of
// the screen — characters look ~20% larger relative to the field. Phaser is
// configured with Scale.FIT, so the canvas still scales to fit the page.
//
// All sizes are exported as accessor functions: most are immutable but
// canvasH/buttonBandH change when the viewport aspect shifts (e.g. fullscreen
// toggling on Android Chrome), and a uniform call-style API across all
// dimensions keeps callers from accidentally caching a stale value.
export function gameW(): number {
  return 400;
}
export function gameH(): number {
  return 660;
}

export const PLAYER_SPEED = 280;
export const ENTITY_POOL_SIZE = 1024;

export function playerHitboxRadius(): number {
  return 4;
}
export function playerY(): number {
  return gameH() - 80;
}

export function bulletRadius(): number {
  return 3;
}
export function cullMargin(): number {
  return 96;
}

// On touch devices we extend the canvas vertically to add a control band
// below the play area so the buttons live outside the playfield. The canvas
// aspect is matched to the viewport so Scale.FIT fills the screen with no
// letterboxing — a typical 9:19.5 phone gives a band of ~210px, plenty for
// the move + bomb buttons. On desktop (or landscape touch) the band is 0
// and the buttons fall back to their original in-playfield positions.
export function canvasW(): number {
  return gameW();
}

// Viewport-derived sizes are cached because the initial read forces layout.
// recomputeSizes() refreshes them when the viewport aspect changes — notably,
// entering fullscreen on Android Chrome hides the address bar and grows the
// visible height.
let _canvasH = initialCanvasH();
let _buttonBandH = _canvasH - gameH();

export function canvasH(): number {
  return _canvasH;
}

export function buttonBandH(): number {
  return _buttonBandH;
}

// Recompute against the explicit parent rect supplied by the caller. Use
// Phaser's `scale.parentSize` after a RESIZE event — on Android Chrome the
// document.body bounds lag a frame behind the fullscreen layout, so passing
// Phaser's freshly-read parent size is the only reliable source.
export function recomputeSizes(parentW: number, parentH: number): void {
  _canvasH = canvasHFor(parentW, parentH);
  _buttonBandH = _canvasH - gameH();
}

function canvasHFor(parentW: number, parentH: number): number {
  if (!isTouchDevice) return gameH();
  if (!parentW || !parentH) return gameH();
  const aspectH = (gameW() * parentH) / parentW;
  return Math.max(gameH(), Math.round(aspectH));
}

function initialCanvasH(): number {
  if (!isTouchDevice) return gameH();
  // Boot-time read, before Phaser is constructed. The host page pads the
  // body by the top/side safe-area insets (notch, rounded corners), so body
  // width/height already excludes those — using it here means Scale.FIT
  // fills the safe rectangle edge-to-edge instead of letterboxing inside it.
  // The bottom is intentionally not inset, so the control band reaches the
  // physical screen bottom (home indicator overlapping a button is fine).
  const rect = document.body.getBoundingClientRect();
  return canvasHFor(rect.width, rect.height);
}
