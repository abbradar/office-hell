import { GAME_H } from '../config';

// Door layout — single source of truth shared between GameScene (which
// renders the panels and bakes the wall cutouts) and stage scripts (which
// spawn / route enemies through doors). Three door slots, evenly spaced
// down the cycle so 2–3 are visible at any time and the gap between
// consecutive visible doors is constant.
//
// Cycle includes a DOOR_H buffer above and below the playfield so the
// hand-off (door top at GAME_H → door top at -DOOR_H) happens fully
// off-canvas — no pop in the middle of the screen. See GameScene for
// the rendering side; the formula below mirrors what it computes per
// frame.
export const DOOR_H = 80;
export const DOOR_COUNT = 3;
export const DOOR_CYCLE = GAME_H + DOOR_H;
export const DOOR_SPACING = DOOR_CYCLE / DOOR_COUNT;

// Door panel top-y values for the given accumulated corridor scroll, in
// the same order GameScene allocates its slots. Pure — no Phaser
// dependency, so scripts can call it on the script clock.
export function computeDoorYs(scrollY: number): number[] {
  const phase = ((scrollY % DOOR_CYCLE) + DOOR_CYCLE) % DOOR_CYCLE;
  const ys: number[] = [];
  for (let i = 0; i < DOOR_COUNT; i++) {
    ys.push(Math.round(((i * DOOR_SPACING + phase) % DOOR_CYCLE) - DOOR_H));
  }
  return ys;
}

// True if any portion of an 80px-tall panel placed at top-y intersects
// the playfield. Used to filter `computeDoorYs` results down to doors a
// wave can actually route an enemy through.
export function isDoorVisible(topY: number): boolean {
  return topY > -DOOR_H && topY < GAME_H;
}
