import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';

function* waitForEnemiesCleared(self: Entity): Generator<ScriptYield, void, void> {
  // Each iteration: grab one live enemy and block on its death (or off-screen release).
  // When the loop can't find any, the field is clear.
  while (true) {
    const enemy = firstLiveEnemy(self);
    if (!enemy) return;
    yield { until: enemy };
  }
}

function firstLiveEnemy(self: Entity): Entity | null {
  const group = self.pool.damages.player;
  const children = group.getChildren();
  for (const child of children) {
    const e = child as Entity;
    if (e.alive) return e;
  }
  return null;
}

function* wave1(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < 3; i++) {
    self.spawn(streamer, 80, -30, 0, 0);
    yield 35;
    self.spawn(streamer, GAME_W - 80, -30, 0, 0);
    yield 35;
  }
}

function* wave2(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < 3; i++) {
    self.spawn(fanShooter, GAME_W * (0.3 + (i % 2) * 0.4), -30, 0, 0);
    yield 70;
  }
}

function* wave3(self: Entity): Generator<ScriptYield, void, void> {
  self.spawn(ringSpinner, GAME_W * 0.3, -30, 0, 0);
  yield 30;
  self.spawn(ringSpinner, GAME_W * 0.7, -30, 0, 0);
}

// biome-ignore lint/correctness/useYield: spawn-only wave; yield-less generator is intentional
function* wave4(self: Entity): Generator<ScriptYield, void, void> {
  self.spawn(driver, GAME_W * 0.25, -30, 0, 0);
  self.spawn(driver, GAME_W * 0.75, -30, 0, 0);
}

function* bossDialogue(self: Entity): Generator<ScriptYield, void, void> {
  yield self.dialogue({
    left: { sprite: 'player', frame: 0, name: 'You' },
    right: { sprite: 'boss1', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Working hard, I see. Or hardly working?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: 'Home is where the deliverables are aligned.' },
      { speaker: 'left', text: 'That… does not mean anything.' },
      { speaker: 'right', text: "Let's circle back on that — after your performance review." },
    ],
  });
}

function* bossWave(self: Entity): Generator<ScriptYield, void, void> {
  yield* bossDialogue(self);
  const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0);
  yield { until: boss };
}

export type WaveDef = {
  id: string;
  name: string;
  script: (self: Entity) => Generator<ScriptYield, void, void>;
};

export const WAVES: WaveDef[] = [
  { id: 'w1', name: 'Wave 1 — Streamers', script: wave1 },
  { id: 'w2', name: 'Wave 2 — Fan shooters', script: wave2 },
  { id: 'w3', name: 'Wave 3 — Ring spinners', script: wave3 },
  { id: 'w4', name: 'Wave 4 — Drivers', script: wave4 },
  { id: 'boss', name: 'Boss — The Boss', script: bossWave },
];

function* stageScript(self: Entity) {
  yield 60;

  yield* wave1(self);
  yield 150;

  yield* wave2(self);
  yield 180;

  yield* wave3(self);
  yield 240;

  yield* wave4(self);
  yield 240;

  yield* bossWave(self);
  yield* waitForEnemiesCleared(self);
  yield 60;

  self.scene.scene.start('End', { won: true });
}

export const stage = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: stageScript,
});

export function makeWaveStage(wave: WaveDef): EntityKind {
  function* waveStageScript(self: Entity) {
    yield 30;
    yield* wave.script(self);
    yield* waitForEnemiesCleared(self);
    yield 30;
    self.scene.scene.start('TestMenu');
  }
  return new EntityKind({
    sprite: null,
    hitboxRadius: 0,
    hp: null,
    damageClass: [],
    damagedByClass: [],
    defaultScript: waveStageScript,
  });
}
