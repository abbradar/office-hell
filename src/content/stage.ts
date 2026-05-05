import {
  STAGE1_METAL_LOOP_KEY,
  STAGE1_METAL_OPENING_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
} from '../audio/keys';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { moveTo } from '../script/patterns';
import {
  markBeat,
  startMusicLoop,
  startMusicWithIntro,
  waitEnemiesClear,
  waitScreenClear,
  waitSeconds,
  waitTrackEnded,
} from '../script/stage';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne } from './kinds';
import { checkEmailWave } from './waves/checkEmail';
import { colleaguesWave } from './waves/colleague';
import { fridayPartyWave } from './waves/fridayParty';
import { gymBroWave } from './waves/gymBro';
import { hrTrioWave } from './waves/hrTrio';
import { internsWave } from './waves/intern';
import { itAdminsWave } from './waves/itAdmin';
import { janitorsWave } from './waves/janitor';
import { oversleeperWave } from './waves/oversleeper';
import { salesClientWave } from './waves/salesClient';
import { shrunkOldManWave } from './waves/shrunkOldMan';
import { vacationPhotosWave } from './waves/vacationPhotos';
import { wellnessCoachWave } from './waves/wellnessCoach';

const PLAYER_OUTRO_SPEED = 220;
const PLAYER_OUTRO_PAUSE_Y = 110;
const PLAYER_OUTRO_EXIT_Y = -60;

// Kill every non-player entity outright. die() only flips the alive flag and
// fires onDeath; group cleanup happens later in stage.update, so we can iterate
// the live children list directly.
export function clearScreen(self: Entity): void {
  for (const child of self.stage.damages.player.getChildren()) {
    const e = child as Entity;
    if (e.alive) e.die();
  }
}

function* bossWave(self: Entity): Generator<ScriptYield, void, void> {
  // Don't open the encounter while wave-4 leftovers are still on screen.
  // Wait for enemies to clear, sweep in-flight bullets, brief beat, then bring on
  // the boss. He spawns unhittable (damagedByClass override) — his own script
  // handles entry, dialogue, and re-enabling damage after the dialogue ends.
  yield* waitEnemiesClear(self);
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
  { id: 'r-interns', name: 'Interns', script: internsWave },
  { id: 'r-janitor', name: 'Janitor', script: janitorsWave },
  { id: 'r-colleagues', name: 'Colleagues', script: colleaguesWave },
  { id: 'r-sales-client', name: 'Sales & Client', script: salesClientWave },
  { id: 'r-hr-trio', name: 'HR Trio', script: hrTrioWave },
  { id: 'r-it-admin', name: 'IT Admin', script: itAdminsWave },
  { id: 'r-check-email', name: 'Check Email', script: checkEmailWave },
  { id: 'r-oversleeper', name: 'Oversleeper', script: oversleeperWave },
  { id: 'r-vacation-photos', name: 'Vacation Photos', script: vacationPhotosWave },
  { id: 'r-gym-bro', name: 'Gym Bro', script: gymBroWave },
  { id: 'r-friday-party', name: 'Friday Party', script: fridayPartyWave },
  { id: 'r-wellness-coach', name: 'Wellness Coach', script: wellnessCoachWave },
  { id: 'r-shrunk-old-man', name: 'Stage Boss — Mr. Hodges', script: shrunkOldManWave },
  { id: 'boss', name: 'Boss — The Boss', script: bossWave },
  { id: 'outro', name: 'Outro — Player exit', script: playerOutro },
];

function* playerOutro(self: Entity): Generator<ScriptYield, void, void> {
  const p = self.stage.player;
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
  // controlUpdate runs after stage.update, so this disable lands before any
  // input or auto-fire executes this frame. Re-enabled on the way out so the
  // first wave plays normally.
  const p = self.stage.player;
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

// Top-level stage script. Sequential composition via `yield*`. Inter-wave
// gaps use `waitSeconds(s)` (audio-time-based) so the schedule is
// synced to music. Music switches are explicit `yield* startMusicLoop(...)`
// calls — those yield until the requested track is ticking, so the next
// step can assume music is up. Frame yields still appear in the pre/post
// music beats where audio time isn't meaningful.
function* stageBody(self: Entity): Generator<ScriptYield, void, void> {
  // Intro: lock controls, half-second pause, monologue, half-second pause.
  markBeat(self, 'intro');
  self.stage.player.controlsEnabled = false;
  yield 30;
  yield* introMonologue(self);
  yield 30;

  // Retro opening fanfare → retro 01 loop. `startMusicWithIntro` yields
  // until the track is actually ticking, so the wave below sees music up.
  markBeat(self, 'music: retro 01');
  yield* startMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY);

  markBeat(self, 'wave 1');
  yield* internsWave(self);
  yield* waitSeconds(2.5);
  markBeat(self, 'wave 2');
  yield* checkEmailWave(self);
  yield* waitSeconds(3.0);
  markBeat(self, 'wave 3');
  yield* colleaguesWave(self);

  // Halfway pivot — snap the music switch to the next loop boundary so
  // the cut lands on a musical seam rather than mid-bar.
  markBeat(self, 'music: retro 02');
  yield* waitTrackEnded();
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  markBeat(self, 'wave 4');
  yield* vacationPhotosWave(self);

  // Mid-stage boss — internal script waits for field to clear, then plays
  // its own dialogue + attack loop. The metal music switch below gates on
  // his death via waitEnemiesClear.
  markBeat(self, 'mr. hodges');
  yield* shrunkOldManWave(self);

  markBeat(self, 'music: metal');
  yield* waitEnemiesClear(self);
  yield* waitTrackEnded();
  yield* startMusicWithIntro(STAGE1_METAL_OPENING_KEY, STAGE1_METAL_LOOP_KEY);

  markBeat(self, 'final boss');
  yield* bossWave(self);

  // Outro: brief pause, sweep stragglers, brief pause, player exits.
  markBeat(self, 'outro');
  yield 30;
  clearScreen(self);
  yield 30;
  yield* playerOutro(self);

  markBeat(self, 'end');
  self.scene.scene.start('End', { won: true });
}

export const stage = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
  defaultScript: stageBody,
});

export function makeWaveStage(wave: WaveDef): EntityKind {
  function* waveStageScript(self: Entity) {
    yield 30;
    yield* wave.script(self);
    // Wait until everything non-player has cleared the field naturally before
    // handing back to the menu.
    yield* waitScreenClear(self);
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
