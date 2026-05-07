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
  markWave,
  startMusicLoop,
  startMusicWithIntro,
  timeWave,
  waitEnemiesClear,
  waitScreenClear,
  waitTrackEnded,
} from '../script/stage';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne } from './kinds';
import { checkEmailWave } from './waves/checkEmail';
import { colleaguesWave } from './waves/colleague';
import { firstEmailColleagues } from './waves/firstEmailColleagues';
import { fridayPartyWave } from './waves/fridayParty';
import { gymBroWave } from './waves/gymBro';
import { hrTrioWave } from './waves/hrTrio';
import { internsWave } from './waves/intern';
import { introMonologue } from './waves/intro';
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
  markWave(self, 'final boss');
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

// Practice menu order matches the real stage's progression: intro,
// the four retro-01 timeWave slots, first boss, vacation photos,
// stage boss, final boss, outro — then the encounters not currently
// placed in the stage, in roughly difficulty order, as a sandbox of
// cut / not-yet-placed content.
export const WAVES: WaveDef[] = [
  { id: 'intro', name: 'Intro — Monologue', script: introMonologue },
  { id: 'r-first-email-colleagues', name: 'First Email Colleagues', script: firstEmailColleagues },
  { id: 'r-interns', name: 'Interns', script: internsWave },
  { id: 'r-check-email', name: 'Check Email', script: checkEmailWave },
  { id: 'r-colleagues', name: 'Colleagues', script: colleaguesWave },
  { id: 'r-gym-bro', name: 'First Boss — Brad', script: gymBroWave },
  { id: 'r-vacation-photos', name: 'Vacation Photos', script: vacationPhotosWave },
  { id: 'r-shrunk-old-man', name: 'Stage Boss — Mr. Hodges', script: shrunkOldManWave },
  { id: 'boss', name: 'Boss — The Boss', script: bossWave },
  { id: 'outro', name: 'Outro — Player exit', script: playerOutro },
  { id: 'r-janitor', name: 'Janitor', script: janitorsWave },
  { id: 'r-sales-client', name: 'Sales & Client', script: salesClientWave },
  { id: 'r-hr-trio', name: 'HR Trio', script: hrTrioWave },
  { id: 'r-it-admin', name: 'IT Admin', script: itAdminsWave },
  { id: 'r-oversleeper', name: 'Oversleeper', script: oversleeperWave },
  { id: 'r-friday-party', name: 'Friday Party', script: fridayPartyWave },
  { id: 'r-wellness-coach', name: 'Wellness Coach', script: wellnessCoachWave },
];

function* playerOutro(self: Entity): Generator<ScriptYield, void, void> {
  const p = self.stage.player;
  // Take the wheel: stop accepting input and let the player float past the top
  // edge unbothered by the world-bounds clamp the live controls relied on.
  p.lockControls();
  p.body.setCollideWorldBounds(false);

  yield* moveTo(p, p.x, PLAYER_OUTRO_PAUSE_Y, PLAYER_OUTRO_SPEED);
  const ch = p.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [{ speaker: 'left', text: 'I did it. This time, I did it.' }],
  });

  yield* moveTo(p, p.x, PLAYER_OUTRO_EXIT_Y, PLAYER_OUTRO_SPEED);
}

// Top-level stage script. Sequential composition via `yield*`. The first
// loop's waves run on a fixed audio-time schedule (`runFor` slots) so
// each wave starts at a known offset from the loop body's start; later
// stage segments (boss intro, music switches) still gate on world state
// via `waitEnemiesClear`/`waitTrackEnded`. Music switches are explicit
// `yield* startMusicLoop(...)` calls — those yield until the requested
// track is ticking, so the next step can assume music is up. Frame
// yields still appear in the pre/post music beats where audio time
// isn't meaningful.
function* stageBody(self: Entity): Generator<ScriptYield, void, void> {
  // Intro: lock controls, half-second pause, monologue, half-second pause.
  markWave(self, 'intro');
  self.stage.player.lockControls();
  yield 30;
  yield* introMonologue(self);
  yield 30;

  // Retro opening fanfare → retro 01 loop. `startMusicWithIntro` yields
  // until the track is actually ticking, so the wave below sees music up.
  // The first wave starts immediately under the fanfare — silent dead
  // air between the intro monologue and wave 1 felt much too long.
  markWave(self, 'music: retro 01');
  yield* startMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY);

  // Each slot runs its wave for exactly that many audio seconds —
  // timeWave caps long spawn sequences, pads short ones, and sweeps
  // surviving enemies at the slot's end so the schedule doesn't drift
  // with how the player is doing. Bullets in flight carry over so the
  // seam isn't a hard reset. Total ≈59s, sized to fit under the retro
  // 01 loop's 60s body; `waitTrackEnded` below snaps the music switch
  // to the natural loop boundary regardless of where the waves land.
  yield* timeWave(self, 18, firstEmailColleagues(self));
  yield* timeWave(self, 11, internsWave(self));
  yield* timeWave(self, 17, checkEmailWave(self));
  yield* timeWave(self, 13, colleaguesWave(self));

  // Halfway pivot — snap the music switch to the next loop boundary so
  // the cut lands on a musical seam rather than mid-bar.
  markWave(self, 'music: retro 02');
  yield* waitTrackEnded();
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  // First boss — Brad. Drops in right at the music seam so the new
  // track's first measures are his entrance.
  yield* gymBroWave(self);

  yield* vacationPhotosWave(self);

  // Stage boss — internal script waits for field to clear, then plays
  // its own dialogue + attack loop. The metal music switch below gates
  // on his death via waitEnemiesClear.
  yield* shrunkOldManWave(self);

  markWave(self, 'music: metal');
  yield* waitEnemiesClear(self);
  yield* waitTrackEnded();
  yield* startMusicWithIntro(STAGE1_METAL_OPENING_KEY, STAGE1_METAL_LOOP_KEY);

  yield* bossWave(self);

  // Outro: brief pause, sweep stragglers, brief pause, player exits.
  markWave(self, 'outro');
  yield 30;
  clearScreen(self);
  yield 30;
  yield* playerOutro(self);

  markWave(self, 'end');
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
