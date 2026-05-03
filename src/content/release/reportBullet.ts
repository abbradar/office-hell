import { BULLET_RADIUS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { EntityKind } from '../../script/types';

// How many radians per frame the bullet may turn toward the player.
// Subtle — tracking, not chasing — so a clean dodge still wins.
const HOMING_RATE = 0.01;

function* reportBulletScript(self: Entity) {
  // Lock in the launch speed; we steer by re-projecting velocity onto a
  // slightly-rotated heading without ever changing magnitude.
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  while (true) {
    yield 0;
    const cv = self.body.velocity;
    const cur = Math.atan2(cv.y, cv.x);
    let diff = self.angleToPlayer() - cur;
    // Wrap diff into (-π, π] so we always turn the short way around.
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-HOMING_RATE, Math.min(HOMING_RATE, diff));
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
