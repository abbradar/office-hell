import type Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';

export const TOUCH_BUTTON_RADIUS = 90;
export const BOMB_BUTTON_RADIUS = 50;
export const BOMB_BUTTON_X = GAME_W / 2;

// On touch devices with a control band, the move button hugs the canvas
// bottom (its lower half clips off-screen, same as before — the corner
// position works well for a thumb at the edge). Without a band (desktop)
// it falls back to the original in-playfield position.
export function touchButtonY(game: Phaser.Game): number {
  const h = game.scale.height;
  return h > GAME_H ? h - 60 : GAME_H - 60;
}

// Single bomb button centred horizontally between the two corner-clipped
// move pads. With a band, it sits at the canvas bottom (same y as the move
// pads) — the centre column (x ≈ 90..310) is clear of either move circle
// so the bomb ring is fully visible without overlapping the move pads.
// Without a band (desktop), falls back to the original layout where it
// was tucked above the move pad inside the playfield.
export function bombButtonY(game: Phaser.Game): number {
  const h = game.scale.height;
  return h > GAME_H ? h - 60 : GAME_H - 220;
}

type Pointer = { x: number; y: number };

const pointers = new Map<number, Pointer>();
// Edge-triggered bomb input. A fresh pointerdown landing inside the
// bomb circle queues one press, consumed by Player.controlUpdate to
// match keyboard JustDown(X) semantics. Tracking the press at
// pointerdown only (not pointermove) means a finger sliding off the
// move button into the bomb region won't accidentally burn a bomb.
let bombPending = false;

// Wires up the window-level pointer listeners with the Phaser.Game in
// closure scope. Called once from main.ts after game construction so
// every coordinate conversion + bomb-zone hit-test reads live scale
// values without going through a global.
export function initTouch(game: Phaser.Game): void {
  const canvas = game.canvas;

  const toGameCoords = (clientX: number, clientY: number): Pointer => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: clientX, y: clientY };
    return {
      x: (clientX - rect.left) * (game.scale.width / rect.width),
      y: (clientY - rect.top) * (game.scale.height / rect.height),
    };
  };

  const inBombButton = (p: Pointer): boolean => {
    const dx = p.x - BOMB_BUTTON_X;
    const dy = p.y - bombButtonY(game);
    return dx * dx + dy * dy <= BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS;
  };

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
}

export function isLeftHeld(game: Phaser.Game): boolean {
  const yc = touchButtonY(game);
  for (const p of pointers.values()) {
    const dx = p.x;
    const dy = p.y - yc;
    if (dx * dx + dy * dy <= TOUCH_BUTTON_RADIUS * TOUCH_BUTTON_RADIUS) return true;
  }
  return false;
}

export function isRightHeld(game: Phaser.Game): boolean {
  const yc = touchButtonY(game);
  for (const p of pointers.values()) {
    const dx = p.x - GAME_W;
    const dy = p.y - yc;
    if (dx * dx + dy * dy <= TOUCH_BUTTON_RADIUS * TOUCH_BUTTON_RADIUS) return true;
  }
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
