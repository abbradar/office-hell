import type { Entity } from '../entities/Entity';
import type { EntityKind } from './types';
import { shoot } from '../audio/sfx';

export function ring(self: Entity, count: number, kind: EntityKind, speed: number, baseAngle = 0): void {
  shoot();
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    self.spawn(kind, self.x, self.y, { angle: baseAngle + i * step, speed });
  }
}

export function aimed(self: Entity, count: number, kind: EntityKind, speed: number, spreadRad = 0): void {
  shoot();
  const aim = self.angleToPlayer();
  if (count <= 1) {
    self.spawn(kind, self.x, self.y, { angle: aim, speed });
    return;
  }
  const step = spreadRad / (count - 1);
  const start = aim - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    self.spawn(kind, self.x, self.y, { angle: start + i * step, speed });
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
  shoot();
  if (count <= 1) {
    self.spawn(kind, self.x, self.y, { angle: baseAngle, speed });
    return;
  }
  const step = spreadRad / (count - 1);
  const start = baseAngle - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    self.spawn(kind, self.x, self.y, { angle: start + i * step, speed });
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
  shoot();
  if (count <= 1) {
    self.spawn(kind, self.x, self.y, { angle: fromAngle, speed });
    return;
  }
  const step = (toAngle - fromAngle) / (count - 1);
  for (let i = 0; i < count; i++) {
    self.spawn(kind, self.x, self.y, { angle: fromAngle + i * step, speed });
  }
}
