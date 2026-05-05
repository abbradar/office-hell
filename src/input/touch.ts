import { BUTTON_BAND_H, CANVAS_H, GAME_H, GAME_W } from '../config';

export const TOUCH_BUTTON_RADIUS = 90;
// On touch devices with a control band, the move button hugs the canvas
// bottom (its lower half clips off-screen, same as before — the corner
// position works well for a thumb at the edge). Without a band (desktop)
// it falls back to the original in-playfield position.
export const TOUCH_BUTTON_Y = BUTTON_BAND_H > 0 ? CANVAS_H - 60 : GAME_H - 60;

// Single bomb button centred horizontally between the two corner-clipped
// move pads. With a band, it sits at the canvas bottom (same y as the move
// pads) — the centre column (x ≈ 90..310) is clear of either move circle
// so the bomb ring is fully visible without overlapping the move pads.
// Without a band (desktop), falls back to the original layout where it
// was tucked above the move pad inside the playfield.
export const BOMB_BUTTON_RADIUS = 50;
export const BOMB_BUTTON_X = GAME_W / 2;
export const BOMB_BUTTON_Y = BUTTON_BAND_H > 0 ? CANVAS_H - 60 : GAME_H - 220;

type Pointer = { x: number; y: number };

const pointers = new Map<number, Pointer>();
let canvasEl: HTMLCanvasElement | null = null;

function getCanvas(): HTMLCanvasElement | null {
  if (!canvasEl) canvasEl = document.querySelector<HTMLCanvasElement>('#game canvas');
  return canvasEl;
}

function toGameCoords(clientX: number, clientY: number): Pointer {
  const c = getCanvas();
  if (!c) return { x: clientX, y: clientY };
  const rect = c.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: clientX, y: clientY };
  return {
    x: (clientX - rect.left) * (GAME_W / rect.width),
    y: (clientY - rect.top) * (CANVAS_H / rect.height),
  };
}

const MOVE_R2 = TOUCH_BUTTON_RADIUS * TOUCH_BUTTON_RADIUS;
const BOMB_R2 = BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS;

function inLeftButton(p: Pointer): boolean {
  const dx = p.x;
  const dy = p.y - TOUCH_BUTTON_Y;
  return dx * dx + dy * dy <= MOVE_R2;
}

function inRightButton(p: Pointer): boolean {
  const dx = p.x - GAME_W;
  const dy = p.y - TOUCH_BUTTON_Y;
  return dx * dx + dy * dy <= MOVE_R2;
}

function inBombButton(p: Pointer): boolean {
  const dx = p.x - BOMB_BUTTON_X;
  const dy = p.y - BOMB_BUTTON_Y;
  return dx * dx + dy * dy <= BOMB_R2;
}

// Edge-triggered bomb input. A fresh pointerdown landing inside the
// bomb circle queues one press, consumed by Player.controlUpdate to
// match keyboard JustDown(X) semantics. Tracking the press at
// pointerdown only (not pointermove) means a finger sliding off the
// move button into the bomb region won't accidentally burn a bomb.
let bombPending = false;

window.addEventListener('pointerdown', (e) => {
  const p = toGameCoords(e.clientX, e.clientY);
  pointers.set(e.pointerId, p);
  if (inBombButton(p)) bombPending = true;
});
window.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, toGameCoords(e.clientX, e.clientY));
});
const release = (e: PointerEvent): void => {
  pointers.delete(e.pointerId);
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

export function isLeftHeld(): boolean {
  for (const p of pointers.values()) if (inLeftButton(p)) return true;
  return false;
}

export function isRightHeld(): boolean {
  for (const p of pointers.values()) if (inRightButton(p)) return true;
  return false;
}

export function consumeBombPress(): boolean {
  if (!bombPending) return false;
  bombPending = false;
  return true;
}

// Drop any queued bomb press without consuming. GameScene calls this
// each paused frame so a tap that advanced a dialogue (which any
// pointerdown does) doesn't also burn a bomb on resume if it happened
// to land inside a bomb circle.
export function clearBombPress(): void {
  bombPending = false;
}
