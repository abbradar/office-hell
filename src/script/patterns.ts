import { shoot } from '../audio/sfx';
import { GAME_H, GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind } from './types';

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
