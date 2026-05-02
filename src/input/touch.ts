import { GAME_H, GAME_W } from '../config';

export const TOUCH_BUTTON_RADIUS = 90;
export const TOUCH_BUTTON_Y = GAME_H - 60;

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
    y: (clientY - rect.top) * (GAME_H / rect.height),
  };
}

window.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, toGameCoords(e.clientX, e.clientY));
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

const R2 = TOUCH_BUTTON_RADIUS * TOUCH_BUTTON_RADIUS;

function inLeftButton(p: Pointer): boolean {
  const dx = p.x;
  const dy = p.y - TOUCH_BUTTON_Y;
  return dx * dx + dy * dy <= R2;
}

function inRightButton(p: Pointer): boolean {
  const dx = p.x - GAME_W;
  const dy = p.y - TOUCH_BUTTON_Y;
  return dx * dx + dy * dy <= R2;
}

export function isLeftHeld(): boolean {
  for (const p of pointers.values()) if (inLeftButton(p)) return true;
  return false;
}

export function isRightHeld(): boolean {
  for (const p of pointers.values()) if (inRightButton(p)) return true;
  return false;
}

