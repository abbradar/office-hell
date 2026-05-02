import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { EntityKind } from '../script/types';
import { driver } from './kinds';

function* stageScript(self: Entity) {
  yield 60;
  self.spawn(driver, GAME_W * 0.25, -30, 0, 0);
  self.spawn(driver, GAME_W * 0.75, -30, 0, 0);
  self.die();
}

export const stage = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: stageScript,
});
