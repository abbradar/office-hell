import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';

// Wait until every non-player entity (enemies and their bullets) has died or
// left the play field — i.e. damages.player is empty of live entries.
export function* waitForScreenCleared(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.pool.damages.player);
    if (!e) return;
    yield { until: e };
  }
}

// Wait until every enemy has died or left the screen. Bullets in flight are
// not considered — the dedicated damagedBy.enemy group has only enemy entities.
export function* waitForEnemiesCleared(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.pool.damagedBy.enemy);
    if (!e) return;
    yield { until: e };
  }
}

// Kill every non-player entity outright. die() only flips the alive flag and
// fires onDeath; group cleanup happens later in pool.update, so we can iterate
// the live children list directly.
export function clearScreen(self: Entity): void {
  for (const child of self.pool.damages.player.getChildren()) {
    const e = child as Entity;
    if (e.alive) e.die();
  }
}

function firstLive(group: Phaser.Physics.Arcade.Group): Entity | null {
  for (const child of group.getChildren()) {
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

function* bossWave(self: Entity): Generator<ScriptYield, void, void> {
  // Don't open the encounter while wave-4 leftovers are still on screen.
  // Wait for enemies to clear, sweep in-flight bullets, brief beat, then bring on
  // the boss. He spawns unhittable (damagedByClass override) — his own script
  // handles entry, dialogue, and re-enabling damage after the dialogue ends.
  yield* waitForEnemiesCleared(self);
  clearScreen(self);
  yield 30;
  const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0, { damagedByClass: [] });
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
  // bossWave waits for the field to clear before opening dialogue, so no fixed delay here.

  yield* bossWave(self);
  // Boss is dead. Don't wait for in-flight bullets to drain (racy with the yield
  // trick) — give the field a brief beat for visual closure, then nuke everything.
  yield 30;
  clearScreen(self);
  yield 30;

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
    // Wait until everything non-player has cleared the field naturally before
    // handing back to the menu.
    yield* waitForScreenCleared(self);
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
