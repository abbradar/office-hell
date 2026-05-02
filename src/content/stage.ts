import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { EntityKind } from '../script/types';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';

function* stageScript(self: Entity) {
  yield 60;

  // Wave 1: streamers from alternating sides
  for (let i = 0; i < 3; i++) {
    self.spawn(streamer, 80, -30, 0, 0);
    yield 35;
    self.spawn(streamer, GAME_W - 80, -30, 0, 0);
    yield 35;
  }
  yield 150;

  // Wave 2: fan shooters
  for (let i = 0; i < 3; i++) {
    self.spawn(fanShooter, GAME_W * (0.3 + (i % 2) * 0.4), -30, 0, 0);
    yield 70;
  }
  yield 180;

  // Wave 3: ring spinners
  self.spawn(ringSpinner, GAME_W * 0.3, -30, 0, 0);
  yield 30;
  self.spawn(ringSpinner, GAME_W * 0.7, -30, 0, 0);
  yield 240;

  // Wave 4: drivers (rammers)
  self.spawn(driver, GAME_W * 0.25, -30, 0, 0);
  self.spawn(driver, GAME_W * 0.75, -30, 0, 0);
  yield 240;

  // Boss
  const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0);
  yield { until: boss };
  yield 60;

  self.scene.scene.start('End');
}

export const stage = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: stageScript,
});
