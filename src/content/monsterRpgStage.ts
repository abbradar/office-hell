// Monster RPG 2 music-test stage. Four-phase music progression:
//   intro      12okt        9.6s    (loops while the opening dialog is open)
//   stage      battle       2:37    (one-shot — fires the moment dialog closes)
//   boss 1     chase        56s     (loop)
//   boss 2     final_boss   31s     (loop)
//
// `battle` doesn't wait for the intro to finish — the intro is just there
// to fill the dialog window with music, and we hand straight off to battle
// once the player dismisses the dialog. Looping the intro keeps it from
// going silent if the player reads slowly.
//
// Two boss tiers exercise the looping side: chase plays under boss 1, then
// final_boss takes over for boss 2. Both snap on `trackEnded` so the
// loop-to-loop hand-off lands on a musical seam.

import {
  MONSTER_BATTLE_KEY,
  MONSTER_CHASE_KEY,
  MONSTER_FINAL_BOSS_KEY,
  MONSTER_INTRO_KEY,
} from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import {
  audioGap,
  enemiesClear,
  musicReady,
  runStageQueue,
  screenClear,
  type StageQueue,
  trackEnded,
} from '../script/stageQueue';
import { EntityKind } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';
import { shrunkOldMan } from './release/shrunkOldMan';

const PORTRAIT = { sprite: 'player', frame: 0, name: 'TEST' };

const INTRO_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Monster RPG 2 stage — music drives the schedule.' },
    { speaker: 'left', text: 'Intro fanfare plays once, then the battle theme starts.' },
  ],
};

const PRE_BOSS1_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Battle theme finished — chase loop kicks in for boss 1.' },
  ],
};

const PRE_BOSS2_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Boss 1 down — final_boss loop for the closer.' },
  ],
};

function spawnWave1(self: Entity): void {
  self.spawn(streamer, 80, -30, 0, 0);
  self.spawn(streamer, GAME_W - 80, -30, 0, 0);
  self.spawn(streamer, GAME_W * 0.5, -30, 0, 0);
}

function spawnWave2(self: Entity): void {
  self.spawn(fanShooter, GAME_W * 0.3, -30, 0, 0);
  self.spawn(fanShooter, GAME_W * 0.7, -30, 0, 0);
}

function spawnWave3(self: Entity): void {
  self.spawn(ringSpinner, GAME_W * 0.3, -30, 0, 0);
  self.spawn(ringSpinner, GAME_W * 0.7, -30, 0, 0);
}

function spawnWave4(self: Entity): void {
  self.spawn(driver, GAME_W * 0.25, -30, 0, 0);
  self.spawn(driver, GAME_W * 0.75, -30, 0, 0);
}

const MONSTER_QUEUE: StageQueue = [
  // Intro fanfare (12okt, 9.6s) loops while the opening dialog is open so
  // the player isn't reading in silence if they're slow. battle takes over
  // immediately once the dialog closes — no `trackEnded` gate, the runner
  // just unblocks from the dialog yield and fires the next entry.
  {
    name: 'intro music',
    kind: 'music',
    filters: [],
    action: () => playMusicLoop(MONSTER_INTRO_KEY),
  },
  {
    name: 'intro dialog',
    kind: 'dialog',
    filters: [],
    action: function* (self) {
      yield self.dialogue(INTRO_DIALOG);
    },
  },

  // Battle theme (one-shot, 2:37). Waves run during it; spaced loosely so
  // the 4-wave block fits well inside the runtime.
  {
    name: 'battle music',
    kind: 'music',
    filters: [],
    action: () => playMusicLoop(MONSTER_BATTLE_KEY, { loop: false }),
  },
  { name: 'wave 1', kind: 'spawn', filters: [musicReady], action: spawnWave1 },
  { name: 'wave 2', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave2 },
  { name: 'wave 3', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave3 },
  { name: 'wave 4', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave4 },

  // Boss 1: chase loop kicks in when the battle theme runs out (or the
  // field is clear, whichever is later — both filters apply).
  {
    name: 'pre-boss 1 dialog',
    kind: 'dialog',
    filters: [trackEnded, enemiesClear],
    action: function* (self) {
      yield self.dialogue(PRE_BOSS1_DIALOG);
    },
  },
  {
    name: 'chase music',
    kind: 'music',
    filters: [],
    action: () => playMusicLoop(MONSTER_CHASE_KEY),
  },
  {
    name: 'boss 1',
    kind: 'spawn',
    filters: [musicReady],
    action: function* (self) {
      // Reuse Mr. Hodges as a mid-tier boss (he's in release/ already).
      const boss = self.spawn(shrunkOldMan, GAME_W / 2, -30, 0, 0, {
        damagedByClass: [],
      });
      yield { until: boss };
    },
  },

  // Boss 2: final_boss loop. Snap to chase's next boundary on the swap.
  {
    name: 'pre-boss 2 dialog',
    kind: 'dialog',
    filters: [enemiesClear],
    action: function* (self) {
      yield self.dialogue(PRE_BOSS2_DIALOG);
    },
  },
  {
    name: 'final_boss music',
    kind: 'music',
    filters: [],
    action: () => playMusicLoop(MONSTER_FINAL_BOSS_KEY),
  },
  {
    name: 'boss 2',
    kind: 'spawn',
    filters: [musicReady],
    action: function* (self) {
      const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0, {
        damagedByClass: [],
      });
      yield { until: boss };
    },
  },

  {
    name: 'end',
    kind: 'misc',
    filters: [screenClear],
    action: (self) => {
      self.scene.scene.start('End', { won: true });
    },
  },
];

export const stageMonsterRpg = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: (self) => runStageQueue(self, MONSTER_QUEUE),
});
