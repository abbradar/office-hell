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
// final_boss takes over for boss 2. Both snap via `waitTrackEnded` so the
// loop-to-loop hand-off lands on a musical seam.

import { MONSTER_BATTLE_KEY, MONSTER_CHASE_KEY, MONSTER_FINAL_BOSS_KEY, MONSTER_INTRO_KEY } from '../audio/keys';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import {
  doorY,
  markWave,
  sideSpawnX,
  startMusicLoop,
  waitEnemiesClear,
  waitScreenClear,
  waitSeconds,
  waitTrackEnded,
} from '../script/stage';
import { EntityKind } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import { bossOne } from './kinds';
import { checkEmailCoworker } from './waves/checkEmail';
import { colleague } from './waves/colleague';
import { JANITOR_DOOR_Y, janitor } from './waves/janitor';
import { oversleeper } from './waves/oversleeper';
import { shrunkOldMan } from './waves/shrunkOldMan';

const PORTRAIT = { sprite: 'mc_female', frame: 0, name: 'TEST' };

const INTRO_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Monster RPG 2 stage — music drives the schedule.' },
    { speaker: 'left', text: 'Intro fanfare plays once, then the battle theme starts.' },
  ],
};

const PRE_BOSS1_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [{ speaker: 'left', text: 'Battle theme finished — chase loop kicks in for boss 1.' }],
};

const PRE_BOSS2_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [{ speaker: 'left', text: 'Boss 1 down — final_boss loop for the closer.' }],
};

function spawnWave1(self: Entity): void {
  self.spawn(checkEmailCoworker, 80, -30, 0, 0);
  self.spawn(checkEmailCoworker, GAME_W - 80, -30, 0, 0);
  self.spawn(checkEmailCoworker, GAME_W * 0.5, -30, 0, 0);
}

function spawnWave2(self: Entity): void {
  self.spawn(oversleeper, GAME_W * 0.3, -30, 0, 0);
  self.spawn(oversleeper, GAME_W * 0.7, -30, 0, 0);
}

function spawnWave3(self: Entity): void {
  const y = doorY(self, JANITOR_DOOR_Y);
  self.spawn(janitor, sideSpawnX(-1), y, 0, 0);
  self.spawn(janitor, sideSpawnX(1), y, 0, 0);
}

function spawnWave4(self: Entity): void {
  self.spawn(colleague, -30, 240, 0, 0);
  self.spawn(colleague, GAME_W + 30, 320, 0, 0);
}

function* monsterRpgBody(self: Entity) {
  // Intro fanfare (12okt, 9.6s) loops while the opening dialog is open
  // so the player isn't reading in silence if they're slow. Battle
  // theme takes over immediately once the dialog closes.
  markWave(self, 'intro music');
  yield* startMusicLoop(MONSTER_INTRO_KEY);
  markWave(self, 'intro dialog');
  yield self.dialogue(INTRO_DIALOG);

  // Battle theme (one-shot, 2:37). Waves run during it; spaced loosely
  // so the 4-wave block fits well inside the runtime.
  markWave(self, 'battle music');
  yield* startMusicLoop(MONSTER_BATTLE_KEY, { loop: false });

  markWave(self, 'wave 1');
  spawnWave1(self);
  yield* waitSeconds(8.0);
  markWave(self, 'wave 2');
  spawnWave2(self);
  yield* waitSeconds(8.0);
  markWave(self, 'wave 3');
  spawnWave3(self);
  yield* waitSeconds(8.0);
  markWave(self, 'wave 4');
  spawnWave4(self);

  // Boss 1: chase loop kicks in when the battle theme runs out and the
  // field is clear. Battle theme being one-shot means `waitTrackEnded`
  // fires on actual completion; then wait for residual enemies.
  markWave(self, 'pre-boss 1 dialog');
  yield* waitTrackEnded();
  yield* waitEnemiesClear(self);
  yield self.dialogue(PRE_BOSS1_DIALOG);

  markWave(self, 'chase music');
  yield* startMusicLoop(MONSTER_CHASE_KEY);

  markWave(self, 'boss 1');
  // Reuse Mr. Hodges as a mid-tier boss (he's in waves/ already).
  const boss1 = self.spawn(shrunkOldMan, GAME_W / 2, -30, 0, 0, {
    damagedByClass: [],
  });
  yield { until: boss1 };

  // Boss 2: final_boss loop.
  markWave(self, 'pre-boss 2 dialog');
  yield* waitEnemiesClear(self);
  yield self.dialogue(PRE_BOSS2_DIALOG);

  markWave(self, 'final_boss music');
  yield* startMusicLoop(MONSTER_FINAL_BOSS_KEY);

  markWave(self, 'boss 2');
  const boss2 = self.spawn(bossOne, GAME_W / 2, -60, 0, 0);
  yield { until: boss2 };

  markWave(self, 'end');
  yield* waitScreenClear(self);
  self.scene.scene.start('End', { won: true });
}

export const stageMonsterRpg = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: monsterRpgBody,
});
