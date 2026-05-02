import { BULLET_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind } from '../script/types';
import { ring } from '../script/patterns';

export const bullet: EntityKind = {
  texture: 'bullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  hostile: true,
};

const DRIVE_SPEED = 80;
const APPROACH_SPEED = 120;
const EXIT_SPEED = 180;

const DRIVE_FRAMES = 70;
const RAMS_BEFORE_EXIT = 3;
const FRAMES_BETWEEN_RAMS = 50;

const RING_COUNT = 14;
const RING_SPEED = 130;

function* driverScript(self: Entity) {
  self.setMotion(Math.PI / 2, DRIVE_SPEED);
  yield DRIVE_FRAMES;

  ring(self, RING_COUNT, bullet, RING_SPEED, Math.random() * Math.PI * 2);

  for (let i = 0; i < RAMS_BEFORE_EXIT; i++) {
    self.setMotion(self.angleToPlayer(), APPROACH_SPEED);
    yield FRAMES_BETWEEN_RAMS;
    ring(self, RING_COUNT, bullet, RING_SPEED, Math.random() * Math.PI * 2);
  }

  self.setMotion(Math.PI / 2, EXIT_SPEED);
}

export const driver: EntityKind = {
  texture: 'enemy',
  hitboxRadius: 10,
  hp: 30,
  hostile: true,
  defaultScript: driverScript,
};
