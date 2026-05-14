// Multiplier-drop EntityKind + pickup animation helper.
//
// MultDropKind lives in its own module so `score.ts` doesn't need to
// import `EntityKind` as a value — that was the head of a cycle
// (types.ts imports `recordKill` from score.ts, score.ts imported
// `EntityKind` from types.ts) which tripped a temporal-dead-zone
// error when `class MultDropKind extends EntityKind` ran before
// `EntityKind` finished initialising.
//
// Every pickup is worth a flat +1 mult; the tier on the kind still
// marks the drop's origin (regular vs. miniBoss vs. boss) so the
// scheduler can choose how many copies to spawn and which ones
// auto-pickup. See src/docs/scoring-system.md → "Multiplier drops".

import { HEADER_H } from '../config';
import type { Entity } from '../entities/Entity';
import { playPickup } from '../audio/sfx/events';
import { addMult } from './score';
import { EntityKind } from './types';

export class MultDropKind extends EntityKind {}

// Per-pickup mult lift. Flat +1 regardless of tier — boss / mini-boss
// fights pay out by *count*, not per-orb value.
export const MULT_LIFT_PER_PICKUP = 1;

// Animation target: rough center of the HUD mult readout in
// GameScene. Hardcoded rather than queried off the live HUD text so
// the helper can be called from anywhere without threading scene refs.
// Aligns with `HUD_READOUT_RIGHT = 358`, mult column = 3 digits ≈ 24px.
const PICKUP_TARGET_X = 346;
const PICKUP_TARGET_Y = HEADER_H / 2;
const PICKUP_DURATION_MS = 200;
const PICKUP_END_ALPHA = 0.3;

// Trigger the collect-toward-HUD animation. Idempotent — a drop that's
// already mid-animation skips, so player-overlap + auto-pick zone +
// auto-pickup timer can all call into this without racing.
//
// The animation is a single Tween: position → HUD mult target, alpha
// 1 → 0.3 linearly over PICKUP_DURATION_MS. The mult bump and the
// drop's death fire on tween complete; the SFX fires at the start so
// collection feels immediate.
export function triggerPickup(drop: Entity): void {
  if (drop.getData('picking')) return;
  drop.setData('picking', true);
  // Pull from the drops group + disable the body so the overlap
  // handler can't refire and the off-field cull doesn't release the
  // entity mid-animation as its tweened y crosses GAME_H.
  drop.stage.drops.remove(drop);
  drop.body.enable = false;
  drop.setVelocity(0, 0);
  playPickup();
  drop.scene.tweens.add({
    targets: drop,
    x: PICKUP_TARGET_X,
    y: PICKUP_TARGET_Y,
    alpha: PICKUP_END_ALPHA,
    duration: PICKUP_DURATION_MS,
    ease: 'Linear',
    onComplete: () => {
      if (!drop.alive) return;
      addMult(drop.stage.score, MULT_LIFT_PER_PICKUP);
      drop.die();
    },
  });
}
