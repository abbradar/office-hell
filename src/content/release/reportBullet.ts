import { BULLET_RADIUS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { EntityKind } from '../../script/types';

// Initial radians-per-frame the bullet may turn toward the player. Decays
// linearly to zero over HOMING_DECAY_FRAMES so a near-launch report tracks
// hard but a stray one drifts past — once you've sidestepped, you've won.
const HOMING_RATE_START = 0.02;
const HOMING_DECAY_FRAMES = 60;

function* reportBulletScript(self: Entity) {
  // Lock in the launch speed; we steer by re-projecting velocity onto a
  // slightly-rotated heading without ever changing magnitude.
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  let age = 0;
  while (true) {
    yield 0;
    age++;
    const decay = Math.max(0, 1 - age / HOMING_DECAY_FRAMES);
    if (decay <= 0) continue;
    const rate = HOMING_RATE_START * decay;
    const cv = self.body.velocity;
    const cur = Math.atan2(cv.y, cv.x);
    let diff = self.angleToPlayer() - cur;
    // Wrap diff into (-π, π] so we always turn the short way around.
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-rate, Math.min(rate, diff));
    self.setMotion(cur + turn, speed);
  }
}

export const reportBullet = new EntityKind({
  sprite: 'reportBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
  defaultScript: reportBulletScript,
});
