import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind } from '../script/types';
import { driver } from './kinds';

function* stageScript(self: Entity) {
  yield 60;
  self.spawn(driver, GAME_W * 0.25, -30);
  self.spawn(driver, GAME_W * 0.75, -30);
  self.die();
}

export const stage: EntityKind = {
  texture: 'bullet',
  hitboxRadius: 0,
  hp: null,
  hostile: false,
  invisible: true,
  defaultScript: stageScript,
};
