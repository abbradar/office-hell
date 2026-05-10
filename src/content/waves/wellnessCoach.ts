import { shoot } from '../../audio/sfx/events';
import { GAME_H, GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { bossShudder, nextBossPhase, PhasedBossKind, phaseRunning, startBossPhases } from '../../script/boss';
import { aimed, moveTo } from '../../script/patterns';
import { clearBullets, markWave, prepareForBoss, suspendRunning } from '../../script/stage';
import type { EntityScript, ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { pillBullet } from './pillBullet';
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
//   3. Personality test — random-direction reports, no homing, weave
//      the gaps.
//   4. Vitamins — narrow aimed pill barrages.
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

const TEST_BURSTS = 5;
const TEST_PER_BURST = 14;
const TEST_BURST_GAP = 26;
const TEST_SPEED = 135;
const TEST_SAY = 'Quick\npersonality\ntest!';
const TEST_SAY_FRAMES = TEST_BURSTS * TEST_BURST_GAP + 12;

// --- Phase 4: vitamins --------------------------------------------------

const VIT_BURSTS = 6;
const VIT_PER_BURST = 6;
const VIT_BURST_GAP = 24;
const VIT_SPEED = 200;
const VIT_SPREAD = Math.PI / 20;
const VIT_SAY = 'Have you taken\nyour supplements?!';
const VIT_SAY_FRAMES = VIT_BURSTS * VIT_BURST_GAP + 12;

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

// Fire `count` reports from the coach in fully random directions, each
// in a straight line (script: null disables the default homing script
// on reportBullet). Used by the personality-test phase — the random
// scatter is the readability hook; homing on top of it would erase the
// gaps the player needs to weave through.
function scatterReports(self: Entity, count: number, speed: number): void {
  shoot();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    self.spawn(reportBullet, self.x, self.y, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      script: null,
    });
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
  while (phaseRunning(self)) {
    self.say(TEST_SAY, TEST_SAY_FRAMES);
    for (let i = 0; i < TEST_BURSTS; i++) {
      if (!phaseRunning(self)) return;
      scatterReports(self, TEST_PER_BURST, TEST_SPEED);
      yield TEST_BURST_GAP;
    }
    yield PHASE_GAP;
  }
}

function* vitaminsPhase(self: Entity): Generator<ScriptYield, void, void> {
  // Final phase: loops until the lethal hit lands, at which point
  // takeDamage swaps this script out for coachDeath via runScript.
  while (true) {
    self.say(VIT_SAY, VIT_SAY_FRAMES);
    for (let i = 0; i < VIT_BURSTS; i++) {
      aimed(self, VIT_PER_BURST, pillBullet, VIT_SPEED, VIT_SPREAD);
      yield VIT_BURST_GAP;
    }
    yield PHASE_GAP;
  }
}

// --- Death --------------------------------------------------------------

// Custom death dialogue. The bomb-count delta is captured at fight start
// (`self.vars.bombsAtStart` set just before `becomeHittable`); the
// difference against the live counter is what determines the line.
function* coachDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  const bombsAtStart = (self.vars?.bombsAtStart as number | undefined) ?? 0;
  const used = Math.max(0, self.stage.score.bombs - bombsAtStart);
  let line: string;
  if (used === 0) line = "At least you didn't get angry…";
  else if (used === 1) line = 'You even got angry a single time…';
  else line = `You even got angry ${used} times…`;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: COACH_SPRITE, frame: 1, name: COACH_NAME },
    lines: [{ speaker: 'right', text: line }],
  });

  clearBullets(self);

  yield* bossShudder(self);
  self.die();
}

// --- Script body --------------------------------------------------------

function* coachScript(self: Entity) {
  // BossKind keeps her unhittable on spawn so the player can't melt her
  // before she's said her piece; becomeHittable below opts back into
  // damage after the dialogue.
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

  // Claim the HUD header now that the fight is starting; release it on
  // death so the corridor doesn't keep her name pinned afterwards.
  self.stage.bossName = COACH_NAME;
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  // Snapshot the run-wide bomb counter so the death line later reads
  // *only* the bombs the player burned during this fight, not the ones
  // they spent earlier in the stage.
  self.vars ??= {};
  self.vars.bombsAtStart = self.stage.score.bombs;
  startBossPhases(self);

  // --- Phase 1 ---
  yield* anxiousPhase(self);
  yield* nextBossPhase(self);

  // --- Phase 2 ---
  yield* breathPhase(self);
  yield* nextBossPhase(self);

  // --- Phase 3 ---
  yield* personalityPhase(self);
  yield* nextBossPhase(self);

  // --- Phase 4 ---
  yield* vitaminsPhase(self);
}

export const wellnessCoach = new PhasedBossKind({
  sprite: COACH_SPRITE,
  hitboxRadius: 22,
  phaseHps: [PHASE_HP, PHASE_HP * 2, PHASE_HP, PHASE_HP],
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: coachScript,
  deathScript: coachDeath,
});

export function* wellnessCoachWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'wellness coach');
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
