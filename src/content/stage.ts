import {
  STAGE1_METAL_LOOP_KEY,
  STAGE1_METAL_OPENING_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
} from '../audio/keys';
import { playMusicLoop, playMusicWithIntro } from '../audio/music/loop';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { moveTo } from '../script/patterns';
import {
  audioGap,
  enemiesClear,
  firstLive,
  musicReady,
  runStageQueue,
  type StageQueue,
  trackEnded,
  waitAudioSeconds,
} from '../script/stageQueue';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';
import { colleaguesWave } from './release/colleague';
import { gymBroWave } from './release/gymBro';
import { hrTrioWave } from './release/hrTrio';
import { internsWave } from './release/intern';
import { itAdminsWave } from './release/itAdmin';
import { janitorsWave } from './release/janitor';
import { salesClientWave } from './release/salesClient';
import { shrunkOldManWave } from './release/shrunkOldMan';

const PLAYER_OUTRO_SPEED = 220;
const PLAYER_OUTRO_PAUSE_Y = 110;
const PLAYER_OUTRO_EXIT_Y = -60;

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

// Internal wave pacing is in audio seconds *relative to the wave's own start*.
// `waitAudioSeconds` captures the music time on entry and yields until that
// target elapses; in practice mode (no music) it falls back to a frame yield
// at 60fps, preserving the original frame counts.
function* wave1(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < 3; i++) {
    self.spawn(streamer, 80, -30, 0, 0);
    yield* waitAudioSeconds(0.58); // was: yield 35
    self.spawn(streamer, GAME_W - 80, -30, 0, 0);
    yield* waitAudioSeconds(0.58); // was: yield 35
  }
}

function* wave2(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < 3; i++) {
    self.spawn(fanShooter, GAME_W * (0.3 + (i % 2) * 0.4), -30, 0, 0);
    yield* waitAudioSeconds(1.17); // was: yield 70
  }
}

function* wave3(self: Entity): Generator<ScriptYield, void, void> {
  self.spawn(ringSpinner, GAME_W * 0.3, -30, 0, 0);
  yield* waitAudioSeconds(0.5); // was: yield 30
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
  const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0, {
    damagedByClass: [],
  });
  yield { until: boss };
}

export type WaveDef = {
  id: string;
  name: string;
  script: (self: Entity) => Generator<ScriptYield, void, void>;
};

export const WAVES: WaveDef[] = [
  { id: 'intro', name: 'Intro — Monologue', script: introMonologue },
  { id: 'w1', name: 'Wave 1 — Streamers', script: wave1 },
  { id: 'w2', name: 'Wave 2 — Fan shooters', script: wave2 },
  { id: 'w3', name: 'Wave 3 — Ring spinners', script: wave3 },
  { id: 'w4', name: 'Wave 4 — Drivers', script: wave4 },
  { id: 'r-interns', name: 'Release — Interns', script: internsWave },
  { id: 'r-janitor', name: 'Release — Janitor', script: janitorsWave },
  { id: 'r-colleagues', name: 'Release — Colleagues', script: colleaguesWave },
  { id: 'r-sales-client', name: 'Release — Sales & Client', script: salesClientWave },
  { id: 'r-hr-trio', name: 'Release — HR Trio', script: hrTrioWave },
  { id: 'r-it-admin', name: 'Release — IT Admin', script: itAdminsWave },
  { id: 'r-gym-bro', name: 'Release — Gym Bro', script: gymBroWave },
  { id: 'r-shrunk-old-man', name: 'Stage Boss — Mr. Hodges', script: shrunkOldManWave },
  { id: 'boss', name: 'Boss — The Boss', script: bossWave },
  { id: 'outro', name: 'Outro — Player exit', script: playerOutro },
];

function* playerOutro(self: Entity): Generator<ScriptYield, void, void> {
  const p = self.pool.player;
  // Take the wheel: stop accepting input and let the player float past the top
  // edge unbothered by the world-bounds clamp the live controls relied on.
  p.controlsEnabled = false;
  p.body.setCollideWorldBounds(false);

  yield* moveTo(p, p.x, PLAYER_OUTRO_PAUSE_Y, PLAYER_OUTRO_SPEED);
  const ch = p.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [{ speaker: 'left', text: 'I did it. This time, I did it.' }],
  });

  yield* moveTo(p, p.x, PLAYER_OUTRO_EXIT_Y, PLAYER_OUTRO_SPEED);
}

function* introMonologue(self: Entity): Generator<ScriptYield, void, void> {
  // Lock the player out for the whole intro — the lead-in beat plus dialogue.
  // controlUpdate runs after pool.update, so this disable lands before any
  // input or auto-fire executes this frame. Re-enabled on the way out so the
  // first wave plays normally.
  const p = self.pool.player;
  p.controlsEnabled = false;
  const ch = p.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [
      {
        speaker: 'left',
        text: '8:47 PM. The hum of the lights is starting to feel personal.',
      },
      {
        speaker: 'left',
        text: "Okay. Tonight I'm leaving before midnight. I mean it this time.",
      },
      {
        speaker: 'left',
        text: 'Just clear the floor, dodge a few "quick syncs", and out the door.',
      },
      { speaker: 'left', text: '…how hard can it be.' },
    ],
  });
  p.controlsEnabled = true;
}

// Top-level stage as a declarative queue. Order is the queue's order; gating
// is in `filters`; what happens is in `action`. Inter-wave gaps use
// `audioGap(s)` (audio-time-based) instead of frame counts so the schedule
// is synced to the music. Music switches are themselves entries — the
// per-track audio clock resets, so subsequent gaps are measured against the
// new track's start.
//
// Frame yields still appear inside the actions for the *pre-music* beats
// (intro pause, post-boss pause, etc.) — those run before / outside any
// music context, so audio time isn't meaningful there.
const STAGE_QUEUE: StageQueue = [
  // Intro: lock controls, half-second pause, monologue, half-second pause.
  // No music yet, so frame yields are appropriate.
  {
    name: 'intro',
    kind: 'dialog',
    filters: [],
    action: function* (self) {
      self.pool.player.controlsEnabled = false;
      yield 30; // 0.5s before monologue
      yield* introMonologue(self);
      yield 30; // 0.5s after monologue
    },
  },

  // Music kicks in: retro opening fanfare → loop. Wave 1 waits on musicReady
  // so it spawns in time with the first downbeat of the loop.
  {
    name: 'music: retro 01',
    kind: 'music',
    filters: [],
    action: () => playMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY),
  },

  {
    name: 'wave 1',
    kind: 'spawn',
    filters: [musicReady],
    action: function* (self) {
      yield* wave1(self);
    },
  },
  {
    name: 'wave 2',
    kind: 'spawn',
    filters: [audioGap(2.5)], // was: yield 150 between waves
    action: function* (self) {
      yield* wave2(self);
    },
  },
  {
    name: 'wave 3',
    kind: 'spawn',
    filters: [audioGap(3.0)], // was: yield 180
    action: function* (self) {
      yield* wave3(self);
    },
  },

  // Halfway pivot to retro 02 — gap measured against retro 01's clock,
  // then the new track's clock is what subsequent entries see. `trackEnded`
  // snaps the swap to the next loop iteration end so the cut lands on a
  // musical seam rather than mid-bar.
  {
    name: 'music: retro 02',
    kind: 'music',
    filters: [trackEnded],
    action: () => playMusicLoop(STAGE1_RETRO_02_LOOP_KEY),
  },
  {
    name: 'wave 4',
    kind: 'spawn',
    filters: [musicReady],
    action: function* (self) {
      yield* wave4(self);
    },
  },

  // Mid-stage boss — internal script waits for field to clear, then plays
  // its own dialogue + attack loop. The next entry (boss music) gates on
  // his death via enemiesClear (his death drops him from damagedBy.enemy).
  {
    name: 'mr. hodges',
    kind: 'spawn',
    filters: [],
    action: function* (self) {
      yield* shrunkOldManWave(self);
    },
  },

  {
    name: 'music: metal',
    kind: 'music',
    filters: [enemiesClear, trackEnded],
    action: () => playMusicWithIntro(STAGE1_METAL_OPENING_KEY, STAGE1_METAL_LOOP_KEY),
  },
  {
    name: 'final boss',
    kind: 'spawn',
    filters: [],
    action: function* (self) {
      yield* bossWave(self);
    },
  },

  // Outro: brief pause, sweep stragglers, brief pause, player exits.
  // Frame yields again — by this point music is moot.
  {
    name: 'outro',
    kind: 'dialog',
    filters: [],
    action: function* (self) {
      yield 30; // 0.5s after boss death
      clearScreen(self);
      yield 30; // 0.5s before outro starts
      yield* playerOutro(self);
    },
  },

  {
    name: 'end',
    kind: 'misc',
    filters: [],
    action: (self) => {
      self.scene.scene.start('End', { won: true });
    },
  },
];

export const stage = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: (self) => runStageQueue(self, STAGE_QUEUE),
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
