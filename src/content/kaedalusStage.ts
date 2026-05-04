// Kaedalus music-test stage. The composer ("Crack the Underground Base")
// shipped two arrangements at different lengths; we use the long one as the
// regular stage music (loops while the player clears waves) and the short
// one as the boss-fight loop.
//
// The narrative cue is the music itself: when the long version yields to
// the short, the boss appears. The hand-off is gated on `trackEnded` so
// the swap snaps to the long track's natural loop boundary instead of
// cutting mid-phrase.

import { KAEDALUS_LONG_KEY, KAEDALUS_SHORT_KEY } from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import {
  audioGap,
  enemiesClear,
  musicReady,
  runStageQueue,
  type StageQueue,
  screenClear,
  trackEnded,
} from '../script/stageQueue';
import { EntityKind } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import { bossOne, driver, fanShooter, ringSpinner, streamer } from './kinds';

const PORTRAIT = { sprite: 'player', frame: 0, name: 'TEST' };

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

const KAEDALUS_QUEUE: StageQueue = [
  // Music kicks in immediately, intro dialog plays over it. trackEnded on
  // the music entry returns true (no track yet), so the switch is instant.
  {
    name: 'long music',
    kind: 'music',
    filters: [],
    action: () => playMusicLoop(KAEDALUS_LONG_KEY),
  },
  {
    name: 'intro dialog',
    kind: 'dialog',
    filters: [musicReady],
    action: function* (self) {
      yield self.dialogue(INTRO_DIALOG);
    },
  },

  // A handful of waves while the long track plays — paced so all four can
  // fit comfortably inside one iteration of the long loop (~3:36).
  { name: 'wave 1', kind: 'spawn', filters: [audioGap(2.0)], action: spawnWave1 },
  { name: 'wave 2', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave2 },
  { name: 'wave 3', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave3 },
  { name: 'wave 4', kind: 'spawn', filters: [audioGap(8.0)], action: spawnWave4 },

  // Pre-boss beat: wait for the field to clear, deliver the cue dialog,
  // then snap the music switch to the long loop's next boundary.
  {
    name: 'pre-boss dialog',
    kind: 'dialog',
    filters: [enemiesClear],
    action: function* (self) {
      yield self.dialogue(PRE_BOSS_DIALOG);
    },
  },
  {
    name: 'short music',
    kind: 'music',
    filters: [trackEnded],
    action: () => playMusicLoop(KAEDALUS_SHORT_KEY),
  },
  {
    name: 'boss',
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

export const stageKaedalus = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: (self) => runStageQueue(self, KAEDALUS_QUEUE),
});
