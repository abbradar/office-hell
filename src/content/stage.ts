import {
  KAEDALUS_LONG_KEY,
  KAEDALUS_SHORT_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_03_LOOP_KEY,
  STAGE1_RETRO_03_OPENING_KEY,
  STAGE1_RETRO_OPENING_KEY,
  STAGE2_RETRO_03_LOOP_KEY,
  STAGE2_RETRO_03_OPENING_KEY,
} from '../audio/keys';
import { stopMusicLoop } from '../audio/music/loop';
import type { Entity } from '../entities/Entity';
import { moveTo } from '../script/patterns';
import {
  clearScreen,
  markWave,
  startMusicLoop,
  startMusicWithIntro,
  timeWave,
  waitScreenClear,
  waitSeconds,
  waitTrackEnded,
} from '../script/stage';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { checkEmailWave } from './waves/checkEmail';
import { urgentCallWave } from './waves/colleague';
import { emailColleagues3, emailColleaguesWave } from './waves/emailColleagues';
import { endingScene } from './waves/ending';
import { fridayPartyWave } from './waves/fridayParty';
import { gymBroWave } from './waves/gymBro';
import { hrTrioWave } from './waves/hrTrio';
import { internsWave } from './waves/intern';
import { interStageWaterCooler } from './waves/interStage';
import { introMonologue } from './waves/intro';
import { itAdminsWave } from './waves/itAdmin';
import { janitorsWave } from './waves/janitor';
import { meetingInternsWave } from './waves/meetingInterns';
import { moreChartsWave } from './waves/moreCharts';
import { oversleeperWave } from './waves/oversleeper';
import { salesClientWave } from './waves/salesClient';
import { shrunkOldManWave } from './waves/shrunkOldMan';
import { theBossWave } from './waves/theBoss';
import { vacationPhotosWave } from './waves/vacationPhotos';
import { COACH_NAME, wellnessCoachWave } from './waves/wellnessCoach';

const PLAYER_OUTRO_SPEED = 220;
const PLAYER_OUTRO_PAUSE_Y = 110;
const PLAYER_OUTRO_EXIT_Y = -60;

// Audio-time gap after a wave clears before the next one starts. With
// `stage.running` already true between waves, this is the breath where
// the MC actually runs forward through an empty corridor — without it
// the next wave spawns the moment the previous one was swept and the
// "I'm advancing" beat reads as a hard cut.
const INTER_WAVE_GAP = 3;

export type WaveDef = {
  id: string;
  name: string;
  script: (self: Entity) => Generator<ScriptYield, void, void>;
};

// --- chained wave continuations ------------------------------------------
//
// Each `from<Wave>` generator is a self-contained entry point into the
// stage at that wave. It runs the wave, sleeps the inter-wave gap,
// then `yield*`s into the next continuation in stage order — so the
// chain naturally runs from any starting point all the way to the
// outro. The practice menu picks one of these as `WaveDef.script`,
// which makes "practice from a wave" mean "restart from that position
// and play the rest of the stage" rather than "play this single wave".
//
// Each function's responsibilities:
//   1. (At a section boundary) switch music / wait for the previous
//      track's seam. Music starts are written to be idempotent so the
//      live chain (track already running) and standalone practice
//      entry (switching in from menu music) both land in the same
//      musical state.
//   2. Run the wave inside `self.stage.separateWave(...)` so cancel
//      cleanup happens regardless of how the wave exits.
//   3. (Optional) `waitSeconds(INTER_WAVE_GAP)` — the breath before
//      the next wave spawns.
//   4. Chain into the next continuation via `yield*`.
//
// Stage 1 uses `timeWave` slots tuned to the music loops; stage 2
// runs untimed for now (timing pass left for later — see
// docs/stage-design.md → "Stage-part durations").

// === Stage 1 part 1 — retro-01 → retro-02 seam → Brad ===
//
// Wave block = 9+15+12+15 = 51s of timed slots + 3 × 3s gaps = 60s,
// against the 59s part-1 budget (see docs/stage-design.md → "Stage-
// part durations"). The 15s email-colleagues slot absorbs what used
// to be two separate 6s+8s waves with a gap. After the block,
// `waitTrackEnded` snaps the cut to the retro-01 loop boundary so
// the music switch lands on a musical seam rather than mid-bar; then
// gymBroWave's own `startMusicLoop(retro-02)` performs the actual
// switch (idempotent in live, switches in from menu music in
// practice).
function* fromInterns(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: retro 01');
  yield* startMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY);

  yield* timeWave(self, 9, self.stage.separateWave(internsWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromEmailColleagues(self);
}

function* fromEmailColleagues(self: Entity): Generator<ScriptYield, void, void> {
  // Idempotent in the live chain (retro-01 already running from
  // `fromInterns`); switches in from menu music when this is the
  // practice entry point. No intro fanfare — mid-section.
  yield* startMusicLoop(STAGE1_RETRO_01_LOOP_KEY);

  yield* timeWave(self, 15, self.stage.separateWave(emailColleaguesWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromUrgentCall(self);
}

function* fromUrgentCall(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_01_LOOP_KEY);

  yield* timeWave(self, 12, self.stage.separateWave(urgentCallWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromCheckEmail(self);
}

function* fromCheckEmail(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_01_LOOP_KEY);

  yield* timeWave(self, 15, self.stage.separateWave(checkEmailWave(self)));

  // Snap the cut to the retro-01 loop boundary so `fromGymBro`'s music
  // switch lands on a musical seam rather than mid-bar.
  yield* waitTrackEnded();
  yield* fromGymBro(self);
}

function* fromGymBro(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: retro 02');
  // In the live chain this is the actual switch from retro-01 → retro-02
  // (caller waited for the retro-01 seam first); from a standalone
  // practice entry it switches in from menu music.
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* self.stage.separateWave(gymBroWave(self));
  yield* fromMoreCharts(self);
}

// === Stage 1 part 2 — retro-02 → retro-03 → wellness coach ===
//
// Wave block = 11+8+8+11 = 38s + 3 × 3s gaps = 47s, against the 49s
// part-2 budget. Meeting interns ends on a visible retreat motion,
// so the 11s slot is tight on that exit. Vacation photos and the
// email-pinch pass both run at 8s; `timeWave` logs `console.error`
// for any straggler and kills it, but the error is the alarm to
// tighten the wave or extend the slot. After the block,
// `waitTrackEnded` snaps to the next retro-02 loop boundary at-or-
// after the block ends; wellnessCoachWave then does the actual
// `startMusicWithIntro(retro-03)` switch.
//
// The leading `startMusicLoop(retro-02)` is idempotent — no-op in
// live flow (retro-02 is already playing from gymBro) and switches
// into retro-02 when this is the practice entry point. No leading
// `waitSeconds(INTER_WAVE_GAP)`: in practice mode that 3s pad
// delayed the first wave well past the music-start beat (part 1
// spawns its first wave immediately under the music), and in live
// flow Brad's death sequence already supplies the breath.
function* fromMoreCharts(self: Entity): Generator<ScriptYield, void, void> {
  // Idempotent in the live chain (retro-02 already running from
  // `fromGymBro`); switches in from menu music when this is the
  // practice entry point.
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* timeWave(self, 11, self.stage.separateWave(moreChartsWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromVacationPhotos(self);
}

function* fromVacationPhotos(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* timeWave(self, 8, self.stage.separateWave(vacationPhotosWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromEmailColleagues3(self);
}

function* fromEmailColleagues3(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* timeWave(self, 8, self.stage.separateWave(emailColleagues3(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromMeetingInterns(self);
}

function* fromMeetingInterns(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* timeWave(self, 11, self.stage.separateWave(meetingInternsWave(self)));

  // Snap the cut to the retro-02 loop boundary so `fromWellnessCoach`'s
  // music switch lands on a musical seam rather than mid-bar.
  yield* waitTrackEnded();
  yield* fromWellnessCoach(self);
}

function* fromWellnessCoach(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: retro-03');
  // In the live chain this is the actual switch from retro-02 → retro-03
  // (caller waited for the retro-02 seam first); from a standalone
  // practice entry it switches in from menu music.
  yield* startMusicWithIntro(STAGE1_RETRO_03_OPENING_KEY, STAGE1_RETRO_03_LOOP_KEY);

  yield* self.stage.separateWave(wellnessCoachWave(self));
  yield* fromWaterCooler(self);
}

// === Inter-stage water cooler — silent ===
//
// The water-cooler scene plays without music; we cut the stage-1 retro-03
// loop here regardless of how we entered (live chain after the boss
// dies, or standalone practice). The next from<Wave> spins up its own
// music when gameplay resumes.
function* fromWaterCooler(self: Entity): Generator<ScriptYield, void, void> {
  stopMusicLoop();
  yield* self.stage.separateWave(interStageWaterCooler(self));
  yield* fromItAdmin(self);
}

// === Stage 2 part 1 — kaedalus-long → kaedalus-short → Mr. Hodges ===
//
// `startMusicLoop` (no intro fanfare; the stage-1 retro opening
// played at game start and re-firing an opening here would feel like
// a restart) snaps the previous loop — retro-03 from the stage-1 end-
// boss fight — back down to kaedalus-long. Three evening-shift waves
// (IT admin, sales-and-client, janitors), switch to kaedalus-short
// at the music seam, then hand off to Hodges. Untimed for now —
// timing pass comes after the wave content settles.
function* fromItAdmin(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: kaedalus long');
  // No leading seam wait: the live chain enters from the silent water-
  // cooler scene with no music to wait for; the standalone practice
  // entry switches in from menu music with a hard cut. No intro
  // fanfare — kaedalus-long starts mid-stage, not at game start, so
  // the fanfare would read as a restart.
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  yield* self.stage.separateWave(itAdminsWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromSalesClient(self);
}

function* fromSalesClient(self: Entity): Generator<ScriptYield, void, void> {
  // Idempotent in the live chain (kaedalus-long already running from
  // `fromItAdmin`); switches in from menu music when this is the
  // practice entry point.
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  yield* self.stage.separateWave(salesClientWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromJanitor(self);
}

function* fromJanitor(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  yield* self.stage.separateWave(janitorsWave(self));

  // Snap the cut to the kaedalus-long loop boundary so Mr. Hodges
  // enters on a musical seam. The actual switch to KAEDALUS_SHORT
  // happens later, inside Hodges's death script (see
  // shrunkOldMan.ts → pauseMusicForDefeat).
  yield* waitTrackEnded();
  yield* fromShrunkOldMan(self);
}

function* fromShrunkOldMan(self: Entity): Generator<ScriptYield, void, void> {
  // Idempotent in the live chain (kaedalus-long already running);
  // switches in from menu music when this is the practice entry.
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  yield* self.stage.separateWave(shrunkOldManWave(self));
  yield* fromHrTrio(self);
}

// === Stage 2 part 2 — kaedalus-short → retro-03 → The Boss ===
//
// Three remaining late-day waves (HR trio, oversleeper, Friday-
// party) before the retro-03 cut and his entrance. Untimed for now.
// In the live chain, kaedalus-short is already running by the time
// we get here — Hodges's death script switched it in mid-shudder
// (pauseMusicForDefeat in shrunkOldMan.ts). The leading
// `startMusicLoop(kaedalus-short)` is a no-op in that case; from a
// standalone practice entry it switches in from menu music.
function* fromHrTrio(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);
  yield* waitSeconds(INTER_WAVE_GAP);

  yield* self.stage.separateWave(hrTrioWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromOversleeper(self);
}

function* fromOversleeper(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);

  yield* self.stage.separateWave(oversleeperWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromFridayParty(self);
}

function* fromFridayParty(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);

  yield* self.stage.separateWave(fridayPartyWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* fromTheBoss(self);
}

function* fromTheBoss(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: stage-2 retro-03');
  // Wait the previous track to its loop boundary (no-op if none is
  // playing — the live chain enters from kaedalus-short, the
  // standalone practice entry from menu music) so the retro-03 opening
  // lands on a clean seam. The opening plays once, then hands off to
  // the main loop for the rest of the encounter.
  yield* waitTrackEnded();
  yield* startMusicWithIntro(STAGE2_RETRO_03_OPENING_KEY, STAGE2_RETRO_03_LOOP_KEY);

  yield* self.stage.separateWave(theBossWave(self));
  yield* fromOutro(self);
}

// === Intro / outro bookends ===
//
// fromIntro is the live chain head; stageBody just calls it and then
// fires the End-scene transition once the chain unwinds. Practice
// can pick fromIntro to play the whole stage from the monologue, or
// any from<Wave> to skip into the middle.
function* fromIntro(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'intro');
  self.stage.player.lockControls();
  yield 30;
  yield* introMonologue(self);
  yield 30;
  yield* fromInterns(self);
}

// fromOutro is the chain tail — no `yield*` to a successor, control
// returns to whichever runner started the chain. Live (stageBody)
// follows with `scene.start('End')`; practice (makeWaveStage) follows
// with `waitScreenClear` + `scene.start('TestMenu')`. The retro-03 loop
// from the final-boss fight is cut here so the player's exit walk
// plays in silence regardless of how we entered.
function* fromOutro(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'outro');
  stopMusicLoop();
  yield 30;
  clearScreen(self);
  yield 30;
  yield* self.stage.separateWave(playerOutro(self));
}

// Practice menu order matches the chain order: intro at the top,
// every wave in the order it plays in the live stage, ending with
// the outro. Picking any entry runs that continuation, which chains
// through the rest of the stage to the outro (or until the player
// dies). The ending scene is practice-only and doesn't sit in the
// chain, so it's listed last.
export const WAVES: WaveDef[] = [
  { id: 'intro', name: 'Intro — Monologue', script: fromIntro },
  { id: 'r-interns', name: 'Interns', script: fromInterns },
  { id: 'r-email-colleagues', name: 'Email Colleagues', script: fromEmailColleagues },
  { id: 'r-urgent-call', name: 'Urgent Call', script: fromUrgentCall },
  { id: 'r-check-email', name: 'Check Email', script: fromCheckEmail },
  { id: 'r-gym-bro', name: 'Mid-Stage Boss — Brad', script: fromGymBro },
  { id: 'r-more-charts', name: 'More Charts', script: fromMoreCharts },
  {
    id: 'r-vacation-photos',
    name: 'Vacation Photos',
    script: fromVacationPhotos,
  },
  { id: 'r-email-colleagues-3', name: 'Email Colleagues 3', script: fromEmailColleagues3 },
  { id: 'r-meeting-interns', name: 'Meeting Interns', script: fromMeetingInterns },
  {
    id: 'r-wellness-coach',
    name: `Stage 1 Boss — ${COACH_NAME}`,
    script: fromWellnessCoach,
  },
  { id: 'i-water-cooler', name: 'Inter-stage — Water Cooler', script: fromWaterCooler },
  { id: 'r-it-admin', name: 'IT Admin', script: fromItAdmin },
  { id: 'r-sales-client', name: 'Sales & Client', script: fromSalesClient },
  { id: 'r-janitor', name: 'Janitor', script: fromJanitor },
  { id: 'r-shrunk-old-man', name: 'Mid-Stage Boss — Mr. Hodges', script: fromShrunkOldMan },
  { id: 'r-hr-trio', name: 'HR Trio', script: fromHrTrio },
  { id: 'r-oversleeper', name: 'Oversleeper', script: fromOversleeper },
  { id: 'r-friday-party', name: 'Friday Party', script: fromFridayParty },
  { id: 'boss', name: 'Final Boss — The Boss', script: fromTheBoss },
  { id: 'outro', name: 'Outro — Player exit', script: fromOutro },
  { id: 'i-ending', name: 'Ending — Walk Home', script: endingScene },
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

// Top-level stage script. The chain head (`fromIntro`) does all the
// work — everything from the monologue through the boss to the
// outro is reachable from there via `yield*`. After the chain
// returns we just fire the End-scene transition.
function* stageBody(self: Entity): Generator<ScriptYield, void, void> {
  yield* fromIntro(self);

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
    yield* self.stage.separateWave(wave.script(self));
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
