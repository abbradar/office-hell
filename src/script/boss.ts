// Shared base class for boss EntityKinds. The only thing it adds over
// EntityKind is a death-animation hand-off: when a hit drops the boss
// below 1 HP we don't call die() right away — we lock the boss out of
// further damage, swap his running script for a flicker-out generator,
// play the boss-death cue, and only call die() once the animation
// finishes. That means any wave script parked on `{ until: boss }`
// resumes at the *visual* end of the encounter rather than the moment
// HP hit zero, which is what gives the boss room to fade.
//
// Time and physics keep ticking through the animation (the death
// script is just another entity script — `stage.update` ticks it like
// any other). Bullets in flight, the player, and other entities all
// keep moving normally.
//
// Mid-bosses that need a richer defeat (final words, music halt for a
// dramatic beat, etc.) compose `bossShudder` + `pauseMusicForDefeat`
// inside their own kind-level `takeDamage` override; BossKind itself
// stays minimal so end-bosses with simple "flicker and disappear"
// behaviour don't pay for the extra config.

import { getMusicTime, playMusicLoop, stopMusicLoop } from '../audio/music/loop';
import { playBossDeath } from '../audio/sfx/events';
import type { Entity } from '../entities/Entity';
import { type DamageClass, EntityKind, type EntityKindOpts, type ScriptYield } from './types';

// Exported so per-boss death scripts can match the timing of the
// standard shudder when sizing pre-shudder beats / bubble lifetimes.
export const FLICKER_TOGGLES = 10;
export const FLICKER_INTERVAL_FRAMES = 5;
export const POST_FLICKER_HOLD_FRAMES = 6;

// The standard boss-death visual: stop motion, disable the body, play
// the death sfx, flicker out, hold. Doesn't call die() — callers do
// that after any post-shudder work (e.g. restarting music for the next
// sub-stage). Use as the visual building block in a per-boss death
// script that prefaces the shudder with a bubble or a real dialogue.
// Idempotent w.r.t. body.setVelocity / body.enable, so it composes
// cleanly with pre-shudder beats that already locked the body down.
export function* bossShudder(self: Entity): Generator<ScriptYield, void, void> {
  playBossDeath();
  self.body.setVelocity(0, 0);
  self.body.enable = false;
  for (let i = 0; i < FLICKER_TOGGLES; i++) {
    self.setVisible(i % 2 === 0);
    yield FLICKER_INTERVAL_FRAMES;
  }
  self.setVisible(false);
  yield POST_FLICKER_HOLD_FRAMES;
}

// Mid-boss helper: stop the active music for a defeat beat, hand back
// a closure that re-starts the loop at `restartKey` from t=0. The
// caller decides exactly when to call `restart()` — typically right
// before `self.die()` so the next sub-stage observes a music clock
// that's already ticking from zero. When no track is playing
// (practice-menu runs that didn't start a stage track), the snapshot
// makes both ops no-ops, so the same death script behaves correctly
// whether it runs from the live stage or a standalone wave drill.
export function pauseMusicForDefeat(restartKey: string): { restart: () => void } {
  const wasPlaying = getMusicTime() !== null;
  if (wasPlaying) stopMusicLoop();
  return {
    restart: () => {
      if (wasPlaying) playMusicLoop(restartKey);
    },
  };
}

// Default death script for end-bosses — bare shudder + die. Mid-bosses
// supply their own death script (composed from `bossShudder` plus
// whatever narrative beat the boss has) and swap it in via `runScript`
// from a `takeDamage` override.
function* bossDeathScript(self: Entity): Generator<ScriptYield, void, void> {
  yield* bossShudder(self);
  self.die();
}

// Bosses always spawn unhittable — the player should never be able to
// chip damage off during the entry slide or pre-fight dialogue. The
// kind's `damagedByClass` is forced to `[]` at construction and the
// requested classes are stashed as `hittableDamagedBy`; the boss script
// opts in by calling `becomeHittable(self)` after the intro. This
// removes the need for every wave spawn site to remember a per-call
// `damagedByClass: []` override and removes the matching foot-gun where
// a script forgets to flip damage on at all (the original Coach bug).
export class BossKind extends EntityKind {
  readonly hittableDamagedBy: DamageClass[];

  constructor(opts: EntityKindOpts) {
    super({ ...opts, damagedByClass: [] });
    this.hittableDamagedBy = opts.damagedByClass;
  }

  override takeDamage(self: Entity, amount: number): void {
    if (self.hp === null) return;
    self.hp -= amount;
    if (self.hp <= 0) {
      // Lock incoming damage out for the flicker window so a stray
      // bullet that lands a frame later can't re-enter takeDamage and
      // double-trigger the death script (runScript would just drop the
      // already-running one and restart it, but the boss-death SFX
      // would play twice).
      self.setDamagedByClasses([]);
      self.stage.runScript(self, bossDeathScript);
      return;
    }
    self.flashDamage();
  }
}

// Flip a boss into its hittable state — i.e. apply the damage classes
// the kind was originally constructed with. Call after the entry +
// dialogue intro is done.
export function becomeHittable(self: Entity): void {
  const kind = self.kind;
  if (!(kind instanceof BossKind)) {
    throw new Error(`becomeHittable called on non-boss kind: ${kind.sprite}`);
  }
  self.setDamagedByClasses(kind.hittableDamagedBy);
}
