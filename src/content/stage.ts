import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { EntityKind } from '../script/types';
import { fairy } from './kinds';

function* stageScript(self: Entity) {
  yield 60;
  for (let wave = 0; wave < 8; wave++) {
    self.spawn(fairy, GAME_W * 0.3, -30);
    self.spawn(fairy, GAME_W * 0.7, -30);
    yield 240;
  }
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
