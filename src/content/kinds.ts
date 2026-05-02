import { BULLET_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind } from '../script/types';
import { aimed, ring } from '../script/patterns';

export const bullet: EntityKind = {
  texture: 'bullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  hostile: true,
};

function* fairyScript(self: Entity) {
  self.setMotion(Math.PI / 2, 90);
  yield 50;
  self.setMotion(0, 0);

  for (let i = 0; i < 3; i++) {
    aimed(self, 5, bullet, 180, Math.PI / 4);
    yield 45;
  }
  for (let i = 0; i < 4; i++) {
    ring(self, 12, bullet, 130, Math.random() * Math.PI * 2);
    yield 35;
  }

  self.setMotion(Math.PI / 2, 130);
}

export const fairy: EntityKind = {
  texture: 'enemy',
  hitboxRadius: 10,
  hp: 30,
  hostile: true,
  defaultScript: fairyScript,
};
