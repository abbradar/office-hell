import { shoot } from '../audio/sfx/events';
import { GAME_H, GAME_W, SCRIPT_FPS } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind, ScriptYield } from './types';

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

// Fire `count` bullets aimed at the player, all sharing the same heading
// but spawned from random offsets within a small disk around the entity.
// They fly as a tight pack rather than fanning out into a line, so the
// volley reads as one heavy clump to dodge instead of a wall to weave
// through.
export function cluster(self: Entity, count: number, kind: EntityKind, speed: number, spreadPx = 14): void {
  if (offScreen(self)) return;
  shoot();
  const aim = self.angleToPlayer();
  const vx = Math.cos(aim) * speed;
  const vy = Math.sin(aim) * speed;
  for (let i = 0; i < count; i++) {
    const r = Math.random() * spreadPx;
    const a = Math.random() * Math.PI * 2;
    self.spawn(kind, self.x + Math.cos(a) * r, self.y + Math.sin(a) * r, vx, vy);
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
//
// `silent`: hold the idle frame for the duration of the move instead of
// updating the anim from velocity. The body still travels normally; only
// the visual animation is suppressed. Used for "carried by the world"
// moments — e.g. the inter-stage water-cooler scene where the floor
// drags the player back to PLAYER_Y while the sprite stays still.
export function* moveTo(
  self: Entity,
  tx: number,
  ty: number,
  speed: number,
  opts?: { silent?: boolean },
): Generator<ScriptYield, void, void> {
  const dx = tx - self.x;
  const dy = ty - self.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6 || speed <= 0) {
    self.setVelocity(0, 0);
    return;
  }
  const silent = opts?.silent ?? false;
  if (silent) self.animSuppressed = true;
  self.setVelocity((dx / dist) * speed, (dy / dist) * speed);
  // Floor at one tick: a tiny-but-positive distance still spends a frame
  // moving rather than snapping via the immediate-restart path. Keeps
  // visual continuity (the body's velocity is observed for at least one
  // physics step) and matches the original semantics of "moveTo waits at
  // least a frame".
  yield Math.max(1, Math.round((dist / speed) * SCRIPT_FPS));
  self.setVelocity(0, 0);
  self.x = tx;
  self.y = ty;
  if (silent) self.animSuppressed = false;
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
