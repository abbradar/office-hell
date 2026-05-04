import type Phaser from 'phaser';

// Shared layout map for character sprite sheets. Every character sheet in
// this project (player + coworkers) is a 288×576 PNG laid out as a 6 col ×
// 12 row grid of 48×48 frames:
//
//   rows 0–3 : IDLE  — 4 frames per direction (right two columns empty)
//   rows 4–7 : WALK  — 6 frames per direction
//   rows 8–11: RUN   — 6 frames per direction
//
// Direction order is RPG-Maker convention: down, left, right, up.

export const CHARACTER_FRAME_W = 48;
export const CHARACTER_FRAME_H = 48;
export const CHARACTER_SHEET_COLS = 6;

export type Direction = 'down' | 'left' | 'right' | 'up';
export type Action = 'idle' | 'walk' | 'run';

export const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];

type ActionLayout = {
  rowStart: number;
  frameCount: number;
  frameRate: number;
};

const ACTION_LAYOUT: Record<Action, ActionLayout> = {
  idle: { rowStart: 0, frameCount: 4, frameRate: 4 },
  walk: { rowStart: 4, frameCount: 6, frameRate: 8 },
  run: { rowStart: 8, frameCount: 6, frameRate: 12 },
};

export function characterAnimKey(sheetKey: string, action: Action, dir: Direction): string {
  return `${sheetKey}_${action}_${dir}`;
}

// Frame indices for a given (action, direction). Exposed so callers can lay
// out static portraits, debug overlays, or one-off animations without
// re-deriving the math.
export function characterFrames(action: Action, dir: Direction): number[] {
  const { rowStart, frameCount } = ACTION_LAYOUT[action];
  const dirRow = rowStart + DIRECTIONS.indexOf(dir);
  const base = dirRow * CHARACTER_SHEET_COLS;
  return Array.from({ length: frameCount }, (_, i) => base + i);
}

// Pick the cardinal direction that best matches a 2D velocity. Dominant axis
// wins; ties (and a degenerate zero vector) fall through to 'down', which
// matches how new enemies enter — a sensible default direction for an entity
// that hasn't started moving yet.
export function directionFromVelocity(vx: number, vy: number): Direction {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax > ay) return vx >= 0 ? 'right' : 'left';
  return vy >= 0 ? 'down' : 'up';
}

// Register every (action × direction) animation for a single sheet. Looped,
// since the player and any future NPC reuses these as continuous states.
export function registerCharacterAnims(scene: Phaser.Scene, sheetKey: string): void {
  for (const action of ['idle', 'walk', 'run'] as const) {
    const { frameRate } = ACTION_LAYOUT[action];
    for (const dir of DIRECTIONS) {
      scene.anims.create({
        key: characterAnimKey(sheetKey, action, dir),
        frames: scene.anims.generateFrameNumbers(sheetKey, { frames: characterFrames(action, dir) }),
        frameRate,
        repeat: -1,
      });
    }
  }
}
