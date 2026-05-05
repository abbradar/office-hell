import { shoot } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind, ScriptYield } from './types';

// Phaser arcade physics integrates px/sec velocity against wall-clock delta;
// scripts tick once per scene update. We assume the configured 60fps loop so
// "frames to traverse D at S" = D / (S / 60).
const SCRIPT_FPS = 60;

// True once the entity's center is past any screen edge — i.e. it's at least
// half hidden. Suppress firing in that case so off-screen exits don't keep
// dropping bullets from below the play field.
function offScreen(self: Entity): boolean {
  return self.x < 0 || self.x > GAME_W || self.y < 0 || self.y > GAME_H;
}

function shootAt(self: Entity, kind: EntityKind, angle: number, speed: number): void {
  self.spawn(kind, self.x, self.y, Math.cos(angle) * speed, Math.sin(angle) * speed);
}

export function ring(self: Entity, count: number, kind: EntityKind, speed: number, baseAngle = 0): void {
  if (offScreen(self)) return;
  shoot();
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, baseAngle + i * step, speed);
  }
}

export function aimed(self: Entity, count: number, kind: EntityKind, speed: number, spreadRad = 0): void {
  if (offScreen(self)) return;
  shoot();
  const aim = self.angleToPlayer();
  if (count <= 1) {
    shootAt(self, kind, aim, speed);
    return;
  }
  const step = spreadRad / (count - 1);
  const start = aim - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, start + i * step, speed);
  }
}

export function spread(
  self: Entity,
  count: number,
  kind: EntityKind,
  speed: number,
  baseAngle: number,
  spreadRad: number,
): void {
  if (offScreen(self)) return;
  shoot();
  if (count <= 1) {
    shootAt(self, kind, baseAngle, speed);
    return;
  }
  const step = spreadRad / (count - 1);
  const start = baseAngle - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, start + i * step, speed);
  }
}

// Push the entity in a direction (raw velocity components) and yield
// until it dies — typically by crossing the cull margin and being
// released by the manager. For "exit stage" moves where the exact
// travel distance doesn't matter, only that the entity has cleared the
// field. Caller must pick a direction that will actually carry the
// entity off-screen, or this never resolves.
export function* walkOffScreen(self: Entity, vx: number, vy: number): Generator<ScriptYield, void, void> {
  self.body.setVelocity(vx, vy);
  yield { until: self };
}

// Drive the entity from its current position to (tx, ty) at `speed`, then
// stop. Computes heading + travel time for you and yields until it lands.
// Snaps to the exact target on arrival to absorb sub-pixel rounding so the
// next script step starts from a clean coordinate.
export function* moveTo(self: Entity, tx: number, ty: number, speed: number): Generator<ScriptYield, void, void> {
  const dx = tx - self.x;
  const dy = ty - self.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6 || speed <= 0) {
    self.setVelocity(0, 0);
    return;
  }
  self.setVelocity((dx / dist) * speed, (dy / dist) * speed);
  yield Math.max(1, Math.round((dist / speed) * SCRIPT_FPS));
  self.setVelocity(0, 0);
  self.x = tx;
  self.y = ty;
}

export function arc(
  self: Entity,
  count: number,
  kind: EntityKind,
  speed: number,
  fromAngle: number,
  toAngle: number,
): void {
  if (offScreen(self)) return;
  shoot();
  if (count <= 1) {
    shootAt(self, kind, fromAngle, speed);
    return;
  }
  const step = (toAngle - fromAngle) / (count - 1);
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, fromAngle + i * step, speed);
  }
}
