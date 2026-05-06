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

import { playBossDeath } from '../audio/sfx/events';
import type { Entity } from '../entities/Entity';
import { EntityKind, type ScriptYield } from './types';

const FLICKER_TOGGLES = 10;
const FLICKER_INTERVAL_FRAMES = 5;
const POST_FLICKER_HOLD_FRAMES = 6;

function* bossDeathScript(self: Entity): Generator<ScriptYield, void, void> {
  playBossDeath();
  // Stop motion + take the body out of the collision matrix so the boss
  // can't pour damage into the player during the still-visible portion
  // of the flicker. die() will set body.enable = false again at the end
  // (idempotent) but doing it up front matters because the animation
  // runs across many frames.
  self.body.setVelocity(0, 0);
  self.body.enable = false;
  for (let i = 0; i < FLICKER_TOGGLES; i++) {
    self.setVisible(i % 2 === 0);
    yield FLICKER_INTERVAL_FRAMES;
  }
  self.setVisible(false);
  yield POST_FLICKER_HOLD_FRAMES;
  // die() flips alive=false and fires onDeath callbacks — that's what
  // wakes any `{ until: boss }` parked wave script. Doing it last is the
  // whole point of the helper.
  self.die();
}

export class BossKind extends EntityKind {
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
