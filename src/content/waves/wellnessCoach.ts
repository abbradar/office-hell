import { shoot } from '../../audio/sfx/events';
import { GAME_H, GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { becomeHittable, bossShudder, nextBossPhase, PhasedBossKind, phaseRunning } from '../../script/boss';
import { moveTo, waitUntilY } from '../../script/patterns';
import { clearBullets, markWave, prepareForBoss, suspendRunning } from '../../script/stage';
import type { EntityScript, ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { pillBullet } from './pillBullet';
import { questionBullet } from './questionBullet';
import { reportBullet } from './reportBullet';

// Wellness Coach: shows up unannounced for an "urgent wellness improvement
// session". Four HP-gated phases — each one runs continuously until that
// phase's HP pool is depleted, then a short flash-and-clear transition
// flips her into the next attack:
//
//   1. Anxious chatter — alternating: a volley of bullet bunches (one
//      aimed at the player, the rest in random directions) and a ring
//      bursting somewhere on screen, repeating "Does it bother you?".
//   2. Breathing — inbound ring "inhale", then an outbound "exhale"
//      shaped like a sun: a circle of evenly-spaced rays radiating
//      from Coach, each ray a sine wave standing still in space (the
//      bullets flow outward along a fixed wavy curve rather than the
//      whole stream sloshing sideways). Amplitude and frequency are
//      picked per breath and shared across all rays so the sun keeps
//      its rotational symmetry; only the curvature varies between
//      breaths.
//   3. Personality test — seven question-mark streams radiating from
//      Coach, slowly rotating around her so the player has to ride
//      the sweep between adjacent rays, with a periodic random
//      scatter of reports layered on top.
//   4. Vitamins — nine radial "lines" of pill bunches: each cycle picks
//      a random base angle, then fires a sequence of tight clumps
//      simultaneously along all nine rays with a micro pause between
//      clumps. Same rotational-symmetry idea as the breathing exhale
//      but punchier (clumps instead of streams) and faster.
//
// On the lethal phase-4 hit she runs a custom death dialogue whose
// single line is chosen from the bombs-used delta captured at fight
// start (`self.vars.bombsAtStart` against `stage.score.bombs`). 0
// bombs → "At least you didn't get angry…", 1 → "a single time…", N>1
// → "N times…".

export const COACH_NAME = 'Coach Karen';
export const COACH_SPRITE = 'coach1';

const ENTRY_SPEED = 110;
const ENTRY_X = GAME_W / 2;
const ENTRY_Y = 110;

const PHASE_HP = 100;

// --- Phase 1: anxious chatter -------------------------------------------

const ANXIOUS_BUNCH_COUNT = 6;
const ANXIOUS_BUNCH_SPEED = 200;
const ANXIOUS_BUNCH_SPREAD_PX = 18;
// Flanking bunches fanned around the player-aimed one on each cluster
// tick: one aimed at the player plus a pair angled to either side.
// The aimed bunch keeps pressure honest; the flankers force the
// player to commit to a side instead of just side-stepping the lane.
const ANXIOUS_FLANK_OFFSETS = [-0.6, -0.3, 0.3, 0.6];
const ANXIOUS_RING_COUNT = 12;
const ANXIOUS_RING_SPEED = 95;
const ANXIOUS_GAP = 28;
const ANXIOUS_SAY = 'Does this\nbother you?';
// Refresh the bubble every few ticks so it stays visible across the
// open-ended phase loop.
const ANXIOUS_SAY_REPEAT_TICKS = 6;
const ANXIOUS_SAY_FRAMES = ANXIOUS_SAY_REPEAT_TICKS * ANXIOUS_GAP + 12;
// Keep random rings clear of the player so they read as environmental
// hazards instead of unfair point-blank spawns.
const ANXIOUS_RING_PLAYER_AVOID = 110;
const ANXIOUS_RING_BOSS_AVOID = 70;

// --- Phase 2: breathing -------------------------------------------------

const SPAWN_RADIUS = 360;
const RING_COUNT = 24;
const IN_SPEED = 80;

const IN_RINGS = 5;
const IN_RING_GAP = 38;
const IN_TO_OUT_GAP = 28;

// Exhale: a sun of bullet streams. Each stream fires one bullet per
// tick along a fixed radial; the per-bullet script rides a parametric
// sine path so the *sequence* of bullets in a stream traces a single
// sine curve outward from Coach — successive bullets walk the same
// path, just staggered by launch time. Amplitude and frequency are
// chosen once per exhale and shared across every ray, so the sun has
// rotational symmetry; only the curvature varies from breath to breath.
const EXHALE_STREAMS = 20;
const EXHALE_TICKS = 20;
const EXHALE_TICK_GAP = 7;
const EXHALE_BULLET_SPEED = 160;
// Lateral amplitude in pixels — peak excursion of each ray's sine
// curve from its base radial. With 20 streams the inter-ray spacing
// at d=200 is only ~62px so adjacent rays interleave; the resulting
// woven mesh is the intended look.
const EXHALE_WIGGLE_AMP_MIN = 40;
const EXHALE_WIGGLE_AMP_MAX = 70;
// Random scatter bullets fired from Coach on each exhale tick,
// alongside the sun rays. Speed sits below the rays so they read as
// a separate hazard layer instead of dissolving into the mesh.
const EXHALE_RANDOM_PER_TICK = 2;
const EXHALE_RANDOM_SPEED = 120;
// Radians per script-tick — controls spatial wavelength of the ray
// (wavelength ≈ 2π · BULLET_SPEED / (freq · SCRIPT_FPS)). Tuned so a
// ray displays ~1–1.5 visible waves before leaving the play field.
const EXHALE_WIGGLE_FREQ_MIN = 0.05;
const EXHALE_WIGGLE_FREQ_MAX = 0.07;
const PHASE_GAP = 36;

const IN_SAY = 'Slowly\nbreath in...';
const OUT_SAY = '...then\nOUT!';
const IN_SAY_FRAMES = IN_RINGS * IN_RING_GAP + IN_TO_OUT_GAP;
const OUT_SAY_FRAMES = EXHALE_TICKS * EXHALE_TICK_GAP + 8;

// --- Phase 3: personality test -----------------------------------------

// Seven question-mark streams radiate from Karen and creep around her,
// sweeping the field. Each stream fires one bullet every
// TEST_STREAM_GAP ticks at the stream's *current* angle; because
// successive bullets launch slightly later (and the angle has rotated
// by then), the in-flight bullets in a stream form a curving arm. The
// seven sectors between adjacent rays are the safe "blocks" — the
// player rides the rotation, sliding between the arms to follow the
// sweep instead of getting pinned to a wall. On top of the streams a
// periodic scatter of random-direction reports keeps the player from
// settling into a comfortable groove inside their sector.
const TEST_STREAM_COUNT = 7;
const TEST_STREAM_GAP = 6;
const TEST_STREAM_SPEED = 135;
// Radians per script-tick. ~0.012 rad/tick ≈ 41°/sec — a sector
// (360/7 ≈ 51°) sweeps past the player roughly every 1.25s.
const TEST_ROT_PER_TICK = 0.012;
const TEST_SCATTER_PERIOD = 30;
const TEST_SCATTER_COUNT = 10;
const TEST_SCATTER_SPEED = 240;
// Wide cone around the player-aim direction — keeps the scatter
// directional (player can't just sit on the boss's six o'clock) while
// preserving the random-spray read.
const TEST_SCATTER_SPREAD = Math.PI / 2;
const TEST_SAY = 'Quick\npersonality\ntest!';
const TEST_SAY_REPEAT_TICKS = 60;
const TEST_SAY_FRAMES = TEST_SAY_REPEAT_TICKS + 18;

// --- Phase 4: vitamins --------------------------------------------------

// Twenty-two radial rays around Karen, each ray firing a sequence
// of tight pill clumps with a micro pause between clumps. 22 rays
// at ~16° apart leave narrow safe wedges — the player has to thread
// through them along the rotation rather than parking in a sector.
const VIT_RAYS = 22;
// Short barrages: only 2 bunches per anchored aim before the next
// barrage re-locks on the player. Keeps the pressure aggressive
// instead of letting one long barrage telegraph a single safe arc.
const VIT_BUNCHES = 2;
const VIT_BUNCH_GAP = 5;
const VIT_BULLETS_PER_BUNCH = 4;
const VIT_BUNCH_SPREAD_PX = 14;
const VIT_SPEED = 260;
// Short rest between barrages — just enough breath to read the
// rotation reset, then straight into the next salvo.
const VIT_PHASE_GAP = 10;
const VIT_SAY = 'Have you taken\nyour supplements?!';
const VIT_SAY_FRAMES = VIT_BUNCHES * VIT_BUNCH_GAP + VIT_PHASE_GAP + 12;
// Half-way auto-aim: when a pill crosses the screen midline it re-aims
// at the player once, with the turn capped at this much from its
// current heading. Cap is small enough that a player who's already
// laterally clear of the ray's lane only gets a glancing curve, not a
// hard track — sustained dodging still pays off, but loitering gets
// punished.
const VIT_REAIM_MAX_TURN = (10 * Math.PI) / 180;
const VIT_REAIM_Y = GAME_H / 2;

// --- Helpers ------------------------------------------------------------

// Spawn `count` bullets evenly placed on a circle of radius SPAWN_RADIUS
// around the coach, each headed straight back toward her at `speed`.
function ringFromOutside(self: Entity, count: number, speed: number, baseAngle: number): void {
  shoot();
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i * Math.PI * 2) / count;
    const sx = self.x + Math.cos(angle) * SPAWN_RADIUS;
    const sy = self.y + Math.sin(angle) * SPAWN_RADIUS;
    self.spawn(bullet, sx, sy, -Math.cos(angle) * speed, -Math.sin(angle) * speed);
  }
}

// Per-stream wiggle parameters. Within one exhale, every stream gets
// the same amp/freq so the rays form a rotationally-symmetric sun;
// only baseAngle differs.
type ExhaleStream = {
  baseAngle: number;
  // Lateral amplitude in pixels — peak excursion from the base radial.
  amp: number;
  // Radians per script-tick.
  freq: number;
};

// Build a per-bullet script that traces a sine curve outward from the
// launch point. Phase is driven by time-since-launch only, so every
// bullet in a stream walks the same path — the stream as a whole reads
// as a stationary wavy ray that lengthens as new bullets are fired,
// not as a line of bullets sloshing sideways together. Closure-captured
// rather than vars-driven because the bullet's first body runs
// synchronously inside `spawn`, before the caller could mutate vars.
//
// Trajectory is parametric: forward at EXHALE_BULLET_SPEED along
// `baseAngle`, plus a sinusoidal sideways drift of amplitude `amp`.
// We set velocity = base + perp * amp * ω * cos(ωt) every tick;
// integrating gives lateral position = amp * sin(ωt) — an exact sine
// wave whose peak is `amp` pixels.
function makeExhaleBulletScript(stream: ExhaleStream): EntityScript {
  return function* (self: Entity) {
    const baseVx = Math.cos(stream.baseAngle) * EXHALE_BULLET_SPEED;
    const baseVy = Math.sin(stream.baseAngle) * EXHALE_BULLET_SPEED;
    // Perpendicular unit vector (90° CCW of base).
    const perpX = -Math.sin(stream.baseAngle);
    const perpY = Math.cos(stream.baseAngle);
    // Peak lateral velocity: amp * ω, where ω = freq * SCRIPT_FPS rad/sec.
    const lateralVScale = stream.amp * stream.freq * SCRIPT_FPS;
    let localTick = 0;
    while (true) {
      const phase = localTick * stream.freq;
      const lateralV = lateralVScale * Math.cos(phase);
      self.body.setVelocity(baseVx + perpX * lateralV, baseVy + perpY * lateralV);
      localTick++;
      yield 1;
    }
  };
}

// Spawn a ring of bullets at an arbitrary screen position (not the
// boss's position). Used by phase 1's "random circles" so a burst can
// erupt across the field and force the player to weave around it.
function ringAt(self: Entity, x: number, y: number, count: number, speed: number, baseAngle: number): void {
  shoot();
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    const a = baseAngle + i * step;
    self.spawn(bullet, x, y, Math.cos(a) * speed, Math.sin(a) * speed);
  }
}

// Spawn one anxious "bunch": a tight pack of ANXIOUS_BUNCH_COUNT
// bullets all flying along `angle`, scattered across a small disk
// around the boss so the volley reads as one heavy clump rather than
// a fanned line.
function spawnAnxiousBunch(self: Entity, angle: number): void {
  const vx = Math.cos(angle) * ANXIOUS_BUNCH_SPEED;
  const vy = Math.sin(angle) * ANXIOUS_BUNCH_SPEED;
  for (let i = 0; i < ANXIOUS_BUNCH_COUNT; i++) {
    const r = Math.random() * ANXIOUS_BUNCH_SPREAD_PX;
    const a = Math.random() * Math.PI * 2;
    self.spawn(bullet, self.x + Math.cos(a) * r, self.y + Math.sin(a) * r, vx, vy);
  }
}

// Fire a volley of bunches: one aimed at the player plus a fan of
// flankers offset to either side of the aim. Single shoot() so the
// SFX doesn't stack on top of itself — the visual volume already
// sells the burst.
function anxiousClusterVolley(self: Entity): void {
  shoot();
  const aim = self.angleToPlayer();
  spawnAnxiousBunch(self, aim);
  for (const offset of ANXIOUS_FLANK_OFFSETS) {
    spawnAnxiousBunch(self, aim + offset);
  }
}

// Pick a random spawn position for an anxious-phase ring, biased away
// from the player and the boss so the burst is visible and dodgeable
// rather than a point-blank hit on either. Confined to the upper half
// of the screen so the player's lane stays clear of point-blank ring
// origins. Falls back to a centre-ish position after a few rejected
// attempts.
function pickAnxiousRingPos(self: Entity): { x: number; y: number } {
  const player = self.stage.player;
  for (let i = 0; i < 8; i++) {
    const x = 70 + Math.random() * (GAME_W - 140);
    const y = 100 + Math.random() * (GAME_H / 2 - 100);
    if (Math.hypot(x - player.x, y - player.y) < ANXIOUS_RING_PLAYER_AVOID) continue;
    if (Math.hypot(x - self.x, y - self.y) < ANXIOUS_RING_BOSS_AVOID) continue;
    return { x, y };
  }
  return { x: GAME_W / 2, y: GAME_H * 0.4 };
}

// --- Phase generators ---------------------------------------------------

function* anxiousPhase(self: Entity): Generator<ScriptYield, void, void> {
  let tick = 0;
  while (phaseRunning(self)) {
    if (tick % ANXIOUS_SAY_REPEAT_TICKS === 0) self.say(ANXIOUS_SAY, ANXIOUS_SAY_FRAMES);
    if (tick % 2 === 0) {
      anxiousClusterVolley(self);
    } else {
      const { x, y } = pickAnxiousRingPos(self);
      ringAt(self, x, y, ANXIOUS_RING_COUNT, ANXIOUS_RING_SPEED, Math.random() * Math.PI * 2);
    }
    tick++;
    yield ANXIOUS_GAP;
  }
}

function* breathPhase(self: Entity): Generator<ScriptYield, void, void> {
  while (phaseRunning(self)) {
    // Inhale: rings converge on the coach from beyond the screen.
    self.say(IN_SAY, IN_SAY_FRAMES);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < IN_RINGS; i++) {
      if (!phaseRunning(self)) return;
      ringFromOutside(self, RING_COUNT, IN_SPEED, baseAngle);
      baseAngle += Math.PI / 24;
      yield IN_RING_GAP;
    }
    yield IN_TO_OUT_GAP;

    // Exhale: pick one amp/freq for the whole sun, then fire one bullet
    // per ray every EXHALE_TICK_GAP frames for EXHALE_TICKS ticks. Each
    // bullet's script walks its ray's sine path from time-of-launch, so
    // successive bullets in a ray form a stationary wavy curve emanating
    // from Coach.
    self.say(OUT_SAY, OUT_SAY_FRAMES);
    const baseRot = Math.random() * Math.PI * 2;
    const amp = EXHALE_WIGGLE_AMP_MIN + Math.random() * (EXHALE_WIGGLE_AMP_MAX - EXHALE_WIGGLE_AMP_MIN);
    const freq = EXHALE_WIGGLE_FREQ_MIN + Math.random() * (EXHALE_WIGGLE_FREQ_MAX - EXHALE_WIGGLE_FREQ_MIN);
    const streams: ExhaleStream[] = [];
    for (let s = 0; s < EXHALE_STREAMS; s++) {
      streams.push({
        baseAngle: baseRot + (s * Math.PI * 2) / EXHALE_STREAMS,
        amp,
        freq,
      });
    }
    for (let tick = 0; tick < EXHALE_TICKS; tick++) {
      if (!phaseRunning(self)) return;
      shoot();
      for (const stream of streams) {
        const vx = Math.cos(stream.baseAngle) * EXHALE_BULLET_SPEED;
        const vy = Math.sin(stream.baseAngle) * EXHALE_BULLET_SPEED;
        self.spawn(bullet, self.x, self.y, vx, vy, {
          script: makeExhaleBulletScript(stream),
        });
      }
      for (let r = 0; r < EXHALE_RANDOM_PER_TICK; r++) {
        const a = Math.random() * Math.PI * 2;
        self.spawn(bullet, self.x, self.y, Math.cos(a) * EXHALE_RANDOM_SPEED, Math.sin(a) * EXHALE_RANDOM_SPEED);
      }
      yield EXHALE_TICK_GAP;
    }
    yield PHASE_GAP;
  }
}

function* personalityPhase(self: Entity): Generator<ScriptYield, void, void> {
  // Start with one ray pointing straight down so the player reads the
  // opening fan before the rotation kicks in.
  let baseAngle = Math.PI / 2;
  let tick = 0;
  while (phaseRunning(self)) {
    if (tick % TEST_SAY_REPEAT_TICKS === 0) self.say(TEST_SAY, TEST_SAY_FRAMES);
    if (tick % TEST_STREAM_GAP === 0) {
      shoot();
      for (let s = 0; s < TEST_STREAM_COUNT; s++) {
        const a = baseAngle + (s * Math.PI * 2) / TEST_STREAM_COUNT;
        self.spawn(questionBullet, self.x, self.y, Math.cos(a) * TEST_STREAM_SPEED, Math.sin(a) * TEST_STREAM_SPEED);
      }
    }
    if (tick > 0 && tick % TEST_SCATTER_PERIOD === 0) {
      shoot();
      const aim = self.angleToPlayer();
      for (let i = 0; i < TEST_SCATTER_COUNT; i++) {
        const a = aim + (Math.random() - 0.5) * TEST_SCATTER_SPREAD;
        self.spawn(reportBullet, self.x, self.y, Math.cos(a) * TEST_SCATTER_SPEED, Math.sin(a) * TEST_SCATTER_SPEED, {
          script: null,
        });
      }
    }
    baseAngle += TEST_ROT_PER_TICK;
    tick++;
    yield 1;
  }
}

// Per-pill auto-aim: fly straight on the launched vector until the
// bullet crosses the screen midline, then re-aim once at the player
// with the turn capped at `VIT_REAIM_MAX_TURN`. `waitUntilY` computes
// the time-to-cross from the current velocity once and yields for that
// duration — no per-frame polling. Generator returns after the single
// re-aim — physics then carries the bullet on its new heading until it
// leaves the field. Bullets fired upward or sideways never cross the
// midline and `waitUntilY` returns immediately, so the re-aim still
// fires from their current position; that's fine because the cap means
// the curve is small and the bullet was already off the player's lane
// anyway.
function* vitaminBulletScript(self: Entity): Generator<ScriptYield, void, void> {
  yield* waitUntilY(self, VIT_REAIM_Y);
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  const cur = Math.atan2(v.y, v.x);
  let diff = self.angleToPlayer() - cur;
  // Wrap diff into (-π, π] so we always turn the short way around.
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-VIT_REAIM_MAX_TURN, Math.min(VIT_REAIM_MAX_TURN, diff));
  self.setMotion(cur + turn, speed);
}

// Spawn one tight clump of pill bullets all flying along `angle`,
// scattered across a small disk around the boss so the volley reads
// as a single fat lump moving as one — the same trick as the
// anxious-phase bunch, restyled for pills.
function spawnVitaminBunch(self: Entity, angle: number): void {
  const vx = Math.cos(angle) * VIT_SPEED;
  const vy = Math.sin(angle) * VIT_SPEED;
  for (let i = 0; i < VIT_BULLETS_PER_BUNCH; i++) {
    const r = Math.random() * VIT_BUNCH_SPREAD_PX;
    const a = Math.random() * Math.PI * 2;
    self.spawn(pillBullet, self.x + Math.cos(a) * r, self.y + Math.sin(a) * r, vx, vy, {
      script: vitaminBulletScript,
    });
  }
}

function* vitaminsPhase(self: Entity): Generator<ScriptYield, void, void> {
  // Final phase: loops until the lethal hit lands, at which point
  // takeDamage swaps this script out for coachDeath via runScript.
  // Every barrage anchors ray 0 on the player, so the only way out
  // is to keep moving along the rotation.
  while (true) {
    self.say(VIT_SAY, VIT_SAY_FRAMES);
    const baseRot = self.angleToPlayer();
    for (let b = 0; b < VIT_BUNCHES; b++) {
      shoot();
      for (let s = 0; s < VIT_RAYS; s++) {
        const angle = baseRot + (s * Math.PI * 2) / VIT_RAYS;
        spawnVitaminBunch(self, angle);
      }
      yield VIT_BUNCH_GAP;
    }
    yield VIT_PHASE_GAP;
  }
}

// --- Death --------------------------------------------------------------

// Custom death dialogue. The bomb-count delta is captured at fight start
// (`self.vars.bombsAtStart` set just before `becomeHittable`); the
// difference against the live counter is what determines the line.
function* coachDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: COACH_SPRITE, frame: 1, name: COACH_NAME },
    lines: [{ speaker: 'right', text: 'Uuu, this go-home attitude is performance-toxic...' }],
  });

  clearBullets(self);

  yield* bossShudder(self);
  self.die();
}

// --- Script body --------------------------------------------------------

// One-shot per-fight setup. Live chain reaches this in phase 1; cold-
// start practice entries (phase 2/3/4) reach it on their first phase
// script. `bombsAtStart` snapshots the run-wide counter so the death
// line later reads only the bombs burned in *this* fight slice — a
// phase-4 practice entry counts zero used-during-fight bombs, which is
// the desired read.
function coachSetup(self: Entity): void {
  self.vars ??= {};
  if (self.vars.coachInitDone) return;
  self.vars.coachInitDone = true;
  // Claim the HUD header now that the fight is starting; release it on
  // death so the corridor doesn't keep her name pinned afterwards.
  self.stage.bossName = COACH_NAME;
  self.onDeath(() => {
    self.stage.bossName = null;
  });
  self.vars.bombsAtStart = self.stage.score.bombs;
  becomeHittable(self);
}

// Phase 1 — full intro slide + dialogue + anxious chatter. Chains to
// phase 2 via `nextBossPhase` (visual transition + advance) and yield*.
function* coachPhase1Script(self: Entity): Generator<ScriptYield, void, void> {
  // BossKind keeps her unhittable on spawn so the player can't melt her
  // before she's said her piece; `coachSetup` calls becomeHittable
  // after the dialogue.
  yield* moveTo(self, ENTRY_X, ENTRY_Y, ENTRY_SPEED);

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: COACH_SPRITE, frame: 1, name: COACH_NAME },
    lines: [
      { speaker: 'right', text: `Hi again, I'm ${ch.name}! Welcome to your wellness improvement session!` },
      { speaker: 'left', text: "I'm fine, actually. I just want to leave." },
      { speaker: 'right', text: 'Your cortisol is screaming, sweetie.' },
      { speaker: 'left', text: '…that does not feel optional.' },
    ],
  });

  coachSetup(self);
  yield* anxiousPhase(self);
  yield* nextBossPhase(self);
  yield* coachPhase2Script(self);
}

function* coachPhase2Script(self: Entity): Generator<ScriptYield, void, void> {
  coachSetup(self);
  yield* breathPhase(self);
  yield* nextBossPhase(self);
  yield* coachPhase3Script(self);
}

function* coachPhase3Script(self: Entity): Generator<ScriptYield, void, void> {
  coachSetup(self);
  yield* personalityPhase(self);
  yield* nextBossPhase(self);
  yield* coachPhase4Script(self);
}

function* coachPhase4Script(self: Entity): Generator<ScriptYield, void, void> {
  coachSetup(self);
  yield* vitaminsPhase(self);
}

function makeWellnessCoach(startPhaseIdx = 0): PhasedBossKind {
  return new PhasedBossKind({
    sprite: COACH_SPRITE,
    hitboxRadius: 22,
    phases: [
      { hp: PHASE_HP, script: coachPhase1Script },
      { hp: PHASE_HP * 2, script: coachPhase2Script },
      { hp: PHASE_HP, script: coachPhase3Script },
      { hp: PHASE_HP, script: coachPhase4Script },
    ],
    startPhaseIdx,
    damageClass: ['player'],
    damagedByClass: ['enemy'],
    deathScript: coachDeath,
  });
}

export const wellnessCoach = makeWellnessCoach();
export const wellnessCoachFromPhase2 = makeWellnessCoach(1);
export const wellnessCoachFromPhase3 = makeWellnessCoach(2);
export const wellnessCoachFromPhase4 = makeWellnessCoach(3);

export function* wellnessCoachWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'wellness coach');
  self.stage.scheduleMultDrop('boss');
  // Music setup (switch to retro-03 opening → loop) is owned by the chain
  // function (`fromWellnessCoach`) — both the live chain and the
  // standalone practice entry route through it so the music is correct
  // before the wave body runs.
  // Field clean + brief beat, then she enters. BossKind keeps her
  // unhittable on spawn; her script calls becomeHittable after the
  // dialogue.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const coach = self.spawn(wellnessCoach, GAME_W / 2, -30, 0, 0);
    yield { until: coach };
  });
}

// Practice-only entries: spawn Coach already positioned at the fight
// anchor and skip phase 1's intro+dialog. No `prepareForBoss` — these
// are always entered from the practice menu, so the field is already
// clean; `suspendRunning` is enough to stop the floor and lock the
// wave state.
function* coachWaveFromPhase(self: Entity, kind: PhasedBossKind, label: string): Generator<ScriptYield, void, void> {
  markWave(self, label);
  yield* suspendRunning(self, function* () {
    const coach = self.spawn(kind, ENTRY_X, ENTRY_Y, 0, 0);
    yield { until: coach };
  });
}

export function* wellnessCoachPhase2Wave(self: Entity): Generator<ScriptYield, void, void> {
  yield* coachWaveFromPhase(self, wellnessCoachFromPhase2, 'wellness coach p2');
}

export function* wellnessCoachPhase3Wave(self: Entity): Generator<ScriptYield, void, void> {
  yield* coachWaveFromPhase(self, wellnessCoachFromPhase3, 'wellness coach p3');
}

export function* wellnessCoachPhase4Wave(self: Entity): Generator<ScriptYield, void, void> {
  yield* coachWaveFromPhase(self, wellnessCoachFromPhase4, 'wellness coach p4');
}
