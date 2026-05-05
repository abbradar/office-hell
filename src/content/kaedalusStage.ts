// Kaedalus music-test stage. The composer ("Crack the Underground Base")
// shipped two arrangements at different lengths; we use the long one as the
// regular stage music (loops while the player clears waves) and the short
// one as the boss-fight loop.
//
// The narrative cue is the music itself: when the long version yields to
// the short, the boss appears. The hand-off is gated by `waitTrackEnded`
// so the swap snaps to the long track's natural loop boundary instead of
// cutting mid-phrase.

import { KAEDALUS_LONG_KEY, KAEDALUS_SHORT_KEY } from '../audio/keys';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import {
  markBeat,
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
import { janitor } from './waves/janitor';
import { oversleeper } from './waves/oversleeper';

const PORTRAIT = { sprite: 'mc_female', frame: 0, name: 'TEST' };

const INTRO_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Kaedalus stage — long arrangement on loop.' },
    { speaker: 'left', text: 'When the music switches to the short version, the boss appears.' },
  ],
};

const PRE_BOSS_DIALOG: DialogueOpts = {
  left: PORTRAIT,
  lines: [
    { speaker: 'left', text: 'Music switching to the short loop now.' },
    { speaker: 'left', text: 'Boss arriving on the next downbeat.' },
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

function* kaedalusBody(self: Entity) {
  // Music kicks in immediately, intro dialog plays over it.
  markBeat(self, 'long music');
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  markBeat(self, 'intro dialog');
  yield self.dialogue(INTRO_DIALOG);

  // A handful of waves while the long track plays — paced so all four
  // can fit comfortably inside one iteration of the long loop (~3:36).
  yield* waitSeconds(2.0);
  markBeat(self, 'wave 1');
  spawnWave1(self);
  yield* waitSeconds(8.0);
  markBeat(self, 'wave 2');
  spawnWave2(self);
  yield* waitSeconds(8.0);
  markBeat(self, 'wave 3');
  spawnWave3(self);
  yield* waitSeconds(8.0);
  markBeat(self, 'wave 4');
  spawnWave4(self);

  // Pre-boss beat: wait for the field to clear, deliver the cue dialog,
  // then snap the music switch to the long loop's next boundary.
  markBeat(self, 'pre-boss dialog');
  yield* waitEnemiesClear(self);
  yield self.dialogue(PRE_BOSS_DIALOG);

  markBeat(self, 'short music');
  yield* waitTrackEnded();
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);

  markBeat(self, 'boss');
  const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0, {
    damagedByClass: [],
  });
  yield { until: boss };

  markBeat(self, 'end');
  yield* waitScreenClear(self);
  self.scene.scene.start('End', { won: true });
}

export const stageKaedalus = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: kaedalusBody,
});
