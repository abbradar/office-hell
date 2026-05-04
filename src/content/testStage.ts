// Diagnostics stage for verifying dialog/physics-pause sync against the
// music clock. Defined as a declarative queue (see script/state.ts) so
// the schedule reads top-to-bottom and each entry's gates are visible inline.
//
// Schedule (all times in seconds, relative to the *current* music track —
// the clock resets when a music entry switches tracks):
//   t=0    music starts (retro_01_opening → retro_01_loop)
//   t=0    intro dialog (no audio gate — overlaps the music opening)
//   t=8    wave 1
//   t=20   dialog (gated on enemies clear: "inbound dialog" pattern)
//   t=28   wave 2
//   t=38   wave 3
//   t=48   dialog (gated on enemies clear)
//   t=55   wave 4
//   wait for screen clear → end stage

import {
  STAGE1_METAL_LOOP_KEY,
  STAGE1_METAL_OPENING_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
} from '../audio/keys';
import { playMusicWithIntro } from '../audio/music/loop';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import {
  audioTimeAtLeast,
  enemiesClear,
  runStageQueue,
  type StageQueue,
  screenClear,
  trackEnded,
} from '../script/state';
import { EntityKind } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import { bossOne } from './kinds';
import { checkEmailCoworker } from './waves/checkEmail';
import { colleague } from './waves/colleague';
import { janitor } from './waves/janitor';
import { oversleeper } from './waves/oversleeper';

const PORTRAIT = { sprite: 'mc_female', frame: 0, name: 'TEST' };

const INTRO_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Sync test stage. Music starts now.' },
    { speaker: 'left', text: 'Physics freezes during dialog; you can still move.' },
    { speaker: 'left', text: 'Watch the HUD: track time keeps advancing while we talk.' },
  ],
};

const DIALOG_1_2: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Pause check 1.' },
    { speaker: 'left', text: 'Stall here — the music clock will pass wave 2 (t=28).' },
    { speaker: 'left', text: 'When you dismiss, wave 2 should spawn the next frame.' },
  ],
};

const DIALOG_3_4: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Pause check 2.' },
    { speaker: 'left', text: 'Same again before the last wave.' },
  ],
};

const PRE_BOSS_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Boss music switch test.' },
    { speaker: 'left', text: 'After this, the metal opening fanfare plays — then the loop kicks in.' },
    { speaker: 'left', text: 'Audio clock resets to the new track. Boss has its own dialogue + attack.' },
  ],
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
  self.spawn(janitor, GAME_W * 0.3, -30, 0, 0);
  self.spawn(janitor, GAME_W * 0.7, -30, 0, 0);
}

function spawnWave4(self: Entity): void {
  self.spawn(colleague, -30, 240, 0, 0);
  self.spawn(colleague, GAME_W + 30, 320, 0, 0);
}

const TEST_STAGE_QUEUE: StageQueue = [
  {
    name: 'music',
    kind: 'music',
    filters: [],
    action: () => playMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY),
  },
  {
    name: 'intro dialog',
    kind: 'dialog',
    filters: [],
    action: function* (self) {
      yield self.dialogue(INTRO_DIALOG);
    },
  },
  {
    name: 'wave 1',
    kind: 'spawn',
    filters: [audioTimeAtLeast(8)],
    action: spawnWave1,
  },
  {
    name: 'dialog 1-2',
    kind: 'dialog',
    filters: [audioTimeAtLeast(20), enemiesClear],
    action: function* (self) {
      yield self.dialogue(DIALOG_1_2);
    },
  },
  {
    name: 'wave 2',
    kind: 'spawn',
    filters: [audioTimeAtLeast(28)],
    action: spawnWave2,
  },
  {
    name: 'wave 3',
    kind: 'spawn',
    filters: [audioTimeAtLeast(38)],
    action: spawnWave3,
  },
  {
    name: 'dialog 3-4',
    kind: 'dialog',
    filters: [audioTimeAtLeast(48), enemiesClear],
    action: function* (self) {
      yield self.dialogue(DIALOG_3_4);
    },
  },
  {
    name: 'wave 4',
    kind: 'spawn',
    filters: [audioTimeAtLeast(55)],
    action: spawnWave4,
  },
  // Boss intro dialog gated on screen clear so the speech doesn't compete with
  // residual driver bullets. Switches music to metal opening + loop next.
  {
    name: 'pre-boss dialog',
    kind: 'dialog',
    filters: [screenClear],
    action: function* (self) {
      yield self.dialogue(PRE_BOSS_DIALOG);
    },
  },
  {
    name: 'metal music',
    kind: 'music',
    filters: [trackEnded],
    action: () => playMusicWithIntro(STAGE1_METAL_OPENING_KEY, STAGE1_METAL_LOOP_KEY),
  },
  // Boss spawn + wait-for-death folded into one entry. The boss's own script
  // (bossScript in kinds.ts) handles entry, dialogue, becoming hittable, and
  // the attack loop. We yield until the boss entity dies.
  {
    name: 'boss',
    kind: 'spawn',
    filters: [],
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

export const stageTest = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: (self) => runStageQueue(self, TEST_STAGE_QUEUE),
});
