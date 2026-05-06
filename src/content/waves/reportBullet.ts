import { bulletRadius } from '../../config';
import type { Entity } from '../../entities/Entity';
import { EntityKind } from '../../script/types';

// Initial radians-per-script-tick the bullet may turn toward the player.
// Decays linearly to zero over HOMING_DECAY_FRAMES so a near-launch report
// tracks hard but a stray one drifts past — once you've sidestepped, you've
// won. Script ticks every other frame (yield 1 → 30Hz), so 30 ticks = 1s.
const HOMING_RATE_START = 0.04;
const HOMING_DECAY_FRAMES = 30;

function* reportBulletScript(self: Entity) {
  // Lock in the launch speed; we steer by re-projecting velocity onto a
  // slightly-rotated heading without ever changing magnitude.
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  for (let age = 0; age < HOMING_DECAY_FRAMES; age++) {
    yield 1;
    const rate = HOMING_RATE_START * (1 - age / HOMING_DECAY_FRAMES);
    const cv = self.body.velocity;
    const cur = Math.atan2(cv.y, cv.x);
    let diff = self.angleToPlayer() - cur;
    // Wrap diff into (-π, π] so we always turn the short way around.
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-rate, Math.min(rate, diff));
    self.setMotion(cur + turn, speed);
  }
  // Past the decay window: drop the script entirely. Velocity is already set,
  // so physics carries the bullet straight until it leaves the screen.
}

export const reportBullet = new EntityKind({
  sprite: 'reportBullet',
  hitboxRadius: bulletRadius(),
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
  defaultScript: reportBulletScript,
});
