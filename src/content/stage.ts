import {
  KAEDALUS_LONG_KEY,
  KAEDALUS_SHORT_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
  STAGE2_METAL_LOOP_KEY,
  STAGE2_METAL_OPENING_KEY,
} from '../audio/keys';
import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { moveTo } from '../script/patterns';
import {
  clearScreen,
  markWave,
  prepareForBoss,
  startMusicLoop,
  startMusicWithIntro,
  suspendRunning,
  timeWave,
  waitEnemiesClear,
  waitScreenClear,
  waitSeconds,
  waitTrackEnded,
} from '../script/stage';
import type { ScriptYield } from '../script/types';
import { EntityKind } from '../script/types';
import { bossOne } from './kinds';
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
import { vacationPhotosWave } from './waves/vacationPhotos';
import { wellnessCoachWave } from './waves/wellnessCoach';

const PLAYER_OUTRO_SPEED = 220;
const PLAYER_OUTRO_PAUSE_Y = 110;
const PLAYER_OUTRO_EXIT_Y = -60;

// Audio-time gap after a wave clears before the next one starts. With
// `stage.running` already true between waves, this is the breath where
// the MC actually runs forward through an empty corridor — without it
// the next wave spawns the moment the previous one was swept and the
// "I'm advancing" beat reads as a hard cut.
const INTER_WAVE_GAP = 3;

function* bossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  // Idempotent in live flow (stage2Part2 already switched to stage-2
  // metal at the KAEDALUS_SHORT seam); switches in from menu music when
  // run from the practice menu.
  yield* startMusicWithIntro(STAGE2_METAL_OPENING_KEY, STAGE2_METAL_LOOP_KEY);
  // Don't open the encounter while leftovers are still on screen. Sweep
  // enemies + in-flight bullets, brief beat, then bring on the boss.
  // BossKind makes all bosses spawn unhittable; the boss's own script
  // handles entry, dialogue, and calls becomeHittable() once it's done.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(bossOne, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });
}

export type WaveDef = {
  id: string;
  name: string;
  script: (self: Entity) => Generator<ScriptYield, void, void>;
};

// --- substage subgenerators ----------------------------------------------
//
// Each part is a self-contained chunk of stage progression that ends
// with its boss/mid-boss. Pattern, top to bottom:
//   1. (optional) music switch — done inside the part that opens a
//      new music section. Parts continuing a previous section's music
//      don't switch; a leading `waitSeconds(INTER_WAVE_GAP)` covers
//      the breath after the previous part's boss.
//   2. The wave block — `timeWave(...)` slots in stage 1 (timing
//      tuned to the music loops) and untimed `separateWave(...)`
//      calls in stage 2 (timing left for later); every gap is a
//      `waitSeconds(INTER_WAVE_GAP)`.
//   3. The closing boss — `self.stage.separateWave(<boss>Wave(self))`
//      with no per-call setup; each boss wave function internally
//      runs `prepareForBoss(self)` so screen-clear + pause happen
//      whether the boss is run from a part or directly from the
//      practice menu.
//
// Each part is exported so the practice menu can run it standalone;
// the `WAVES` list below threads them in at the top of the practice
// menu in stage progression order.

// Stage 1, part 1 — retro-01 → retro-02 across the music seam, ending
// with Brad. Four timed openers under the upbeat theme then a music
// switch into Brad's entrance: 9+15+12+15 = 51s of waves + 3 × 3s
// gaps = 60s, against the 59s part-1 budget (see
// docs/stage-design.md → "Stage-part durations"). After the block,
// `waitTrackEnded` snaps the cut to the retro-01 loop boundary so it
// lands on a musical seam rather than mid-bar, then Brad enters. The
// 15s email-colleagues slot absorbs what used to be two separate
// 6s+8s waves with a gap — now a single merged opener that runs both
// passes back-to-back. Each slot is sized so the wave's last enemy
// walks off-screen near the slot end, not so much earlier that the
// timeWave pad+inter-wave-gap reads as a long lull.
export function* stage1Part1(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: retro 01');
  yield* startMusicWithIntro(STAGE1_RETRO_OPENING_KEY, STAGE1_RETRO_01_LOOP_KEY);

  yield* timeWave(self, 9, self.stage.separateWave(internsWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 15, self.stage.separateWave(emailColleaguesWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 12, self.stage.separateWave(urgentCallWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 15, self.stage.separateWave(checkEmailWave(self)));

  markWave(self, 'music: retro 02');
  yield* waitTrackEnded();
  // gymBroWave does the actual `startMusicLoop(retro-02)` itself
  // (idempotent in live flow, switches in from menu music in practice);
  // the seam wait above keeps the live switch on a clean musical seam.

  yield* self.stage.separateWave(gymBroWave(self));
}

// Stage 1, part 2 — retro-02 continues from part 1's mid-boss seam,
// then switches to metal for Coach Becky as the stage-1 end boss.
// Four timed waves (more charts, vacation photos, the harder
// email-pinch pass, meeting interns) before the metal cut and her
// entrance. Wave block = 11+8+8+11 = 38s plus 3 × 3s gaps = 47s,
// against the 49s part-2 budget (see docs/stage-design.md →
// "Stage-part durations"). After the block, `waitTrackEnded` snaps
// to the next retro-02 loop boundary at-or-after the block ends.
// Meeting interns ends on a visible retreat motion (the interns
// push down past the player), so the 11s slot is tight on that
// exit. Vacation photos and the email-pinch pass both run at 8s:
// vacation photos drops to two barrages and exits at EXIT_SPEED for
// a ~7.1s natural length, and the email pinch's three pairs likewise
// clear in ~7.3s. `timeWave` logs a `console.error` listing any
// stragglers and then kills them so the next wave isn't poisoned,
// but the error is the signal to tighten the wave or extend the
// slot — don't rely on the sweep. More charts is strictly sequential
// (pie-chart colleague then bar-chart colleague); timeWave truncates
// the tail if the player drags.
//
// The leading `startMusicLoop` is idempotent — no-op in live flow
// (retro-02 is already playing from part 1) and switches into
// retro-02 when the part is run from the practice menu under menu
// music. No leading `waitSeconds(INTER_WAVE_GAP)`: in practice mode
// that 3s pad delayed the first wave well past the music-start beat
// (part 1 spawns its first wave immediately under the music), and in
// live flow Brad's death sequence (bossShudder + retro-02 restart)
// already supplies the breath.
export function* stage1Part2(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(STAGE1_RETRO_02_LOOP_KEY);

  yield* timeWave(self, 11, self.stage.separateWave(moreChartsWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 8, self.stage.separateWave(vacationPhotosWave(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 8, self.stage.separateWave(emailColleagues3(self)));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* timeWave(self, 11, self.stage.separateWave(meetingInternsWave(self)));

  markWave(self, 'music: metal');
  yield* waitTrackEnded();
  // wellnessCoachWave does the actual `startMusicWithIntro(metal)`
  // itself (idempotent in live flow, switches in from menu music in
  // practice); the seam wait above keeps the live switch on a clean
  // musical seam.

  yield* self.stage.separateWave(wellnessCoachWave(self));
}

// Stage 2, part 1 — retro-01 takes over for the early stage-2 beats,
// then switches to retro-02 for Mr. Hodges as the stage-2 mid-boss.
// `startMusicLoop` (no intro fanfare; it played at game start in
// stage 1 part 1 and re-firing here would feel like a restart) snaps
// the previous loop — metal from the stage-1 end-boss fight — back
// down to retro-01. Run three evening-shift waves (IT admin,
// sales-and-client, janitors), switch to retro-02 at the music seam,
// then hand off to Hodges. Untimed for now — timing pass comes after
// the wave content settles.
export function* stage2Part1(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'music: retro 01');
  yield* waitEnemiesClear(self);
  yield* waitTrackEnded();
  yield* startMusicLoop(KAEDALUS_LONG_KEY);

  yield* self.stage.separateWave(itAdminsWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* self.stage.separateWave(salesClientWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* self.stage.separateWave(janitorsWave(self));

  markWave(self, 'music: retro 02');
  yield* waitTrackEnded();

  yield* self.stage.separateWave(shrunkOldManWave(self));
}

// Stage 2, part 2 — retro-02 continues from part 1's mid-boss seam,
// then switches to metal for The Boss as the final-boss bookend.
// Three remaining late-day waves (HR trio, oversleeper,
// Friday-party) before the metal cut and his entrance. Untimed for
// now — same as part 1, timing pass is a later concern. Idempotent
// leading `startMusicLoop(retro-02)` mirrors part 2 of stage 1: no-op
// in live flow, switch in from menu music in practice.
export function* stage2Part2(self: Entity): Generator<ScriptYield, void, void> {
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);
  yield* waitSeconds(INTER_WAVE_GAP);

  yield* self.stage.separateWave(hrTrioWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* self.stage.separateWave(oversleeperWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);
  yield* self.stage.separateWave(fridayPartyWave(self));
  yield* waitSeconds(INTER_WAVE_GAP);

  markWave(self, 'music: metal (stage 2)');
  yield* waitTrackEnded();
  // bossWave does the actual `startMusicWithIntro(stage-2 metal)` itself
  // (idempotent in live flow, switches in from menu music in practice);
  // the seam wait above keeps the live switch on a clean musical seam.

  yield* self.stage.separateWave(bossWave(self));
}

// Practice menu order matches the real stage's progression: intro,
// the four substage subgenerators, then every individually-runnable
// wave in the order it plays in the live stage, ending with the
// outro. Substage entries up top let you practice a whole part
// end-to-end with its music; the per-wave entries below let you
// drill any single beat in isolation.
export const WAVES: WaveDef[] = [
  { id: 'intro', name: 'Intro — Monologue', script: introMonologue },
  { id: 's-stage-1-part-1', name: 'Stage 1 — Part 1', script: stage1Part1 },
  { id: 's-stage-1-part-2', name: 'Stage 1 — Part 2', script: stage1Part2 },
  { id: 'i-water-cooler', name: 'Inter-stage — Water Cooler', script: interStageWaterCooler },
  { id: 's-stage-2-part-1', name: 'Stage 2 — Part 1', script: stage2Part1 },
  { id: 's-stage-2-part-2', name: 'Stage 2 — Part 2', script: stage2Part2 },
  { id: 'i-ending', name: 'Ending — Walk Home', script: endingScene },
  { id: 'r-interns', name: 'Interns', script: internsWave },
  { id: 'r-email-colleagues', name: 'Email Colleagues', script: emailColleaguesWave },
  { id: 'r-urgent-call', name: 'Urgent Call', script: urgentCallWave },
  { id: 'r-check-email', name: 'Check Email', script: checkEmailWave },
  { id: 'r-gym-bro', name: 'Mid-Stage Boss — Brad', script: gymBroWave },
  { id: 'r-more-charts', name: 'More Charts', script: moreChartsWave },
  {
    id: 'r-vacation-photos',
    name: 'Vacation Photos',
    script: vacationPhotosWave,
  },
  { id: 'r-email-colleagues-3', name: 'Email Colleagues 3', script: emailColleagues3 },
  { id: 'r-meeting-interns', name: 'Meeting Interns', script: meetingInternsWave },
  {
    id: 'r-wellness-coach',
    name: 'Stage 1 Boss — Coach Becky',
    script: wellnessCoachWave,
  },
  { id: 'r-it-admin', name: 'IT Admin', script: itAdminsWave },
  { id: 'r-sales-client', name: 'Sales & Client', script: salesClientWave },
  { id: 'r-janitor', name: 'Janitor', script: janitorsWave },
  { id: 'r-shrunk-old-man', name: 'Mid-Stage Boss — Mr. Hodges', script: shrunkOldManWave },
  { id: 'r-hr-trio', name: 'HR Trio', script: hrTrioWave },
  { id: 'r-oversleeper', name: 'Oversleeper', script: oversleeperWave },
  { id: 'r-friday-party', name: 'Friday Party', script: fridayPartyWave },
  { id: 'boss', name: 'Final Boss — The Boss', script: bossWave },
  { id: 'outro', name: 'Outro — Player exit', script: playerOutro },
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

// Top-level stage script. Just sequences the four substages around
// the intro and outro; each part owns its own music + wave schedule.
function* stageBody(self: Entity): Generator<ScriptYield, void, void> {
  // Intro: lock controls, half-second pause, monologue, half-second pause.
  markWave(self, 'intro');
  self.stage.player.lockControls();
  yield 30;
  yield* introMonologue(self);
  yield 30;

  yield* stage1Part1(self);
  yield* stage1Part2(self);
  yield* stage2Part1(self);
  yield* stage2Part2(self);

  // Outro: brief pause, sweep stragglers, brief pause, player exits.
  markWave(self, 'outro');
  yield 30;
  clearScreen(self);
  yield 30;
  yield* self.stage.separateWave(playerOutro(self));

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
