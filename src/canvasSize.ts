import { GAME_H, GAME_W } from './config';
import { isTouchDevice } from './input/device';

// On touch devices we extend the canvas vertically to add a control band
// below the play area so the buttons live outside the playfield. The canvas
// aspect is matched to the viewport so Scale.FIT fills the screen with no
// letterboxing — a typical 9:19.5 phone gives a band of ~210px, plenty for
// the move + bomb buttons. On desktop (or landscape touch) the band is 0
// and the buttons fall back to their original in-playfield positions.
//
// `parentW`/`parentH` is the available rect (document.body at boot, then
// Phaser's `scale.parentSize` after RESIZE — on Android Chrome the document
// bounds lag a frame behind the fullscreen layout, so Phaser's freshly-read
// parent size is the only reliable source for the resize path).
export function computeCanvasH(parentW: number, parentH: number): number {
  if (!isTouchDevice) return GAME_H;
  if (!parentW || !parentH) return GAME_H;
  const aspectH = (GAME_W * parentH) / parentW;
  return Math.max(GAME_H, Math.round(aspectH));
}
