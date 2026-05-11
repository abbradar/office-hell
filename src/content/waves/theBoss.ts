import { FINAL_BOSS_METAL_LOOP_KEY, FINAL_BOSS_METAL_OPENING_KEY } from '../../audio/keys';
import { getMusicTime } from '../../audio/music/loop';
import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind, becomeHittable, bossShudder } from '../../script/boss';
import {
  aimed,
  arc,
  cameraPunch,
  lineExplosion,
  lineStrokeTelegraph,
  moveTo,
  ring,
} from '../../script/patterns';
import {
  type BeatmapBeat,
  type BeatmapSpec,
  clearBullets,
  markWave,
  prepareForBoss,
  race,
  runBeatmap,
  sideSpawnX,
  startMusicWithIntro,
  suspendRunning,
  visibleDoorCenters,
  waitAudioTimeAtLeast,
  waitEntityDead,
  waitSeconds,
} from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import {
  blueLongerDroplet,
  emailBordered,
  greedDiamondXs,
  lavaDropletHard,
  redCross,
  redDiamondMd,
  redDroplet,
  redDropletHard,
  yellowDiamondSm,
} from '../kinds';

// --- Final boss: phase 1 prototype ---
//
// Single-phase encounter for now — beatmap is the events sketched
// in conversation. More phases get added as we iterate.

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;
const BOSS_HP = 2000;

// Beat math — 113 BPM, beat = 0.531 s, bar = 2.124 s. Intro is
// exactly 32 beats / 8 bars; loop body is 80 beats / 20 bars. See
// src/docs/final-boss-music.md for the full analysis.
export const BPM = 113;
export const BEAT_S = 60 / BPM;
export const HALF_BEAT_S = BEAT_S / 2;
export const BAR_S = 4 * BEAT_S;
export const INTRO_BEATS = 32;
export const LOOP_BEATS = 80;
export const loopBarBeat = (loopBar: number, beatInBar: 1 | 2 | 3 | 4): number =>
  INTRO_BEATS + loopBar * 4 + (beatInBar - 1);

// --- Phase 1 ---
//
// Phase 1 layer schedule — each row ≈ 1 bar (2.124 s) of music time
// flowing top-to-bottom. `▓` = layer active during that bar; `●` =
// single-shot fire at the bar start. Layers with multiple segments
// (verts ×3, fan ×2) reuse the same column; gaps in the column show
// the breaks between segments.
//
//   t (s)    ring l1   l2   l3   vrt  fan  ast  pet  wlk  eml  arL  arR
//   ──────   ────────────────────────────────────────────────────────
//    0.000   ▓    ●
//    2.124   ▓         ●
//    4.248   ▓              ●    ▓
//    6.372   ▓                   ▓
//    8.496   ▓                   ▓    ▓
//   10.620   ▓                   ▓    ▓
//   12.744   ▓                   ▓    ▓
//   14.867   ▓                   ▓         ▓
//   16.991   ▓                             ▓
//   19.115   ▓                             ▓
//   21.239   ▓                             ▓
//   23.363   ▓                             ▓
//   25.487   ▓                                  ▓
//   27.611   ▓                                  ▓
//   29.735   ▓                                  ▓
//   31.858   ▓                   ▓              ▓    ▓
//   33.982   ▓                   ▓                   ▓    ▓
//   36.106   ▓                   ▓                   ▓    ▓
//   38.230   ▓                   ▓                   ▓    ▓
//   40.354   ▓                   ▓                   ▓    ▓
//   42.478   ▓                   ▓    ▓
//   44.602   ▓                   ▓    ▓
//   46.726   ▓                   ▓    ▓
//   48.850   ▓                        ▓
//   50.973   ▓                        ▓                        ▓    ▓
//   53.097   ▓                        ▓                        ▓    ▓
//   55.221   ▓                                                 ▓    ▓
//   57.345   ▓
//
// Layer reference:
//
//   ring   48-bullet redDroplet, every 2.124 s (one per bar)
//   line   top-left → through-player at t=0 (+ camera shake right at 0.1 s);
//          top-right at 2.124 (+ shake left at 2.224); horizontal at y=300
//          at 4.248. All three with a 1.41 s telegraph.
//   verts  vertical blue-explosion rain, 0.708 s interval (1.416 s on
//          the verts3 tail segment, 40.354 → 48.85)
//   fan    blue-droplet spine + red/yellow diamond fans (0.265 s micro-loop)
//   asst   invulnerable HR rep from random side door, every 1.062 s
//   pet    counter-rotating diamond petals, π/5 drift per 0.36 s
//   walk   boss saunters to a new top-5% point every 0.531 s (50 px/s)
//   email  3-bullet aimed bordered envelopes, every 0.531 s
//   arc    3-bullet lava+red droplet fan from a bottom corner; arc-R
//          is the horizontal mirror of arc-L with 0.2124 s lag


const RING_COUNT = 48;
const RING_SPEED = 130;
const LINE_TELEGRAPH_MS = 1410;
// Camera-punch displacement in pixels. Positive dx punches the world
// left → reads as "shake right".
const SHAKE_DX = 4;
// Line-stroke bullets: red-cross sprite (13×13). Spacing equal to
// the sprite size so adjacent crosses just touch along the line.
const LINE_STROKE_KIND = redCross;
const LINE_STROKE_SPACING_PX = 13;
const LINE_STROKE_OPTS = { kind: LINE_STROKE_KIND, spacing: LINE_STROKE_SPACING_PX };

// Project a ray from `(fromX, fromY)` through `(throughX, throughY)`
// and return the point where it exits the playfield bounds. The
// resulting point lies on the screen edge, beyond the through-point,
// so a line from origin to this exit point passes THROUGH the
// through-point rather than ending at it.
//
// `t` is the parametric distance along the ray. We pick the smallest
// positive `tMax` such that the point at `(fromX + t·dx, fromY + t·dy)`
// is on a screen boundary; that's the exit. Guard against a degenerate
// zero-length ray (caller standing exactly on the origin) by falling
// back to the through-point itself.
function extendRayToBounds(
  fromX: number,
  fromY: number,
  throughX: number,
  throughY: number,
): { x: number; y: number } {
  const dx = throughX - fromX;
  const dy = throughY - fromY;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: throughX, y: throughY };
  let tMax = Number.POSITIVE_INFINITY;
  if (dx > 0) tMax = Math.min(tMax, (GAME_W - fromX) / dx);
  else if (dx < 0) tMax = Math.min(tMax, -fromX / dx);
  if (dy > 0) tMax = Math.min(tMax, (GAME_H - fromY) / dy);
  else if (dy < 0) tMax = Math.min(tMax, -fromY / dy);
  return { x: fromX + tMax * dx, y: fromY + tMax * dy };
}

// Aim a `lineStrokeTelegraph` from a fixed source point THROUGH the
// player's *current* position at fire time. The line is extended
// past the player to the screen edge so the danger zone passes
// through the player rather than terminating at their feet — a
// player who stands still gets clipped; a player who moves
// perpendicular to the line is safe.
const lineToPlayer =
  (fromX: number, fromY: number) =>
  (self: Entity): void => {
    const px = self.stage.player.x;
    const py = self.stage.player.y;
    const end = extendRayToBounds(fromX, fromY, px, py);
    lineStrokeTelegraph(self, fromX, fromY, end.x, end.y, LINE_TELEGRAPH_MS, LINE_STROKE_OPTS);
  };

// --- Fan-spiral pattern ---
//
// The pattern is a sequence of ring volleys with `waitSeconds`
// gaps between them, so it can't fit in a single sync `fire`
// callback. Instead, a beat spawns this controller entity at the
// boss's position; the controller's `defaultScript` runs the loop,
// firing rings from its own (boss-relative) x/y, and self-terminates
// when music time crosses the segment's end.
//
// Controller is invisible + non-collidable (`sprite: null`,
// `hitboxRadius: 0`) — it exists only to host the script.
//
// Phase 1 spawns this twice with different end times:
//   - 8.496 → 14.867 s   (intro-loop bridge)
//   - 42.478 → 55.221 s  (back-half encore over the fan/arc climax)
// `makeFanSpiralController(durationS)` returns a fresh EntityKind
// per segment; the closure captures the duration so each instance
// self-terminates after `durationS` from spawn. Spawn-anchored
// duration (rather than an absolute music time) is what makes the
// controller re-runnable across loop iterations.
const FAN_SPIRAL_SPEED1 = 90;

function makeFanSpiralController(durationS: number): EntityKind {
  function* script(self: Entity): Generator<ScriptYield, void, void> {
    // Anchor to spawn music time so each loop iteration runs for the
    // full segment length, independent of which loop iteration the
    // music clock is on. Falls back to "run until killed externally"
    // when music isn't ticking (practice mode without a track).
    const startT = getMusicTime()?.time ?? null;
    let angle = 0;
    while (self.alive) {
      if (startT !== null) {
        const m = getMusicTime();
        if (m !== null && m.time - startT >= durationS) break;
      }

      ring(self, 5, blueLongerDroplet, 110, angle);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1, angle - 0.04);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1, angle + 0.04);
      yield* waitSeconds(0.05);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1, angle - 0.12);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1, angle + 0.12);
      yield* waitSeconds(0.05);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1 + 1, angle - 0.2);
      ring(self, 5, redDiamondMd, FAN_SPIRAL_SPEED1 + 1, angle + 0.2);
      yield* waitSeconds(0.05);
      ring(self, 5, yellowDiamondSm, FAN_SPIRAL_SPEED1 + 2, angle - 0.25);
      ring(self, 5, yellowDiamondSm, FAN_SPIRAL_SPEED1 + 2, angle + 0.25);
      yield* waitSeconds(0.115);
      angle += 0.5;
    }
    self.die();
  }
  return new EntityKind({
    sprite: null,
    hitboxRadius: 0,
    damageClass: [],
    damagedByClass: [],
    defaultScript: script,
  });
}

// Durations: 14.867 − 8.496 = 6.371 s (intro-loop bridge);
// 55.221 − 42.478 = 12.743 s (back-half encore).
const fanSpiralController = makeFanSpiralController(6.371);
const fanSpiralController2 = makeFanSpiralController(12.743);

// --- Counter-rotating petals (music time 25.487 s → 33.982 s) ---
//
// Two opposing angular cursors that drift apart π/5 per iteration,
// each firing a paired triple of 2-bullet rings at small offsets to
// form a "petal" sweep. Same controller-entity pattern as the fan-
// spiral — script can't fit in a sync beat callback because of the
// per-step waits.
// Duration: 33.982 − 25.487 = 8.495 s. Spawn-anchored so each loop
// iteration of phase 1 re-runs the full segment from a fresh start
// rather than checking against a hardcoded absolute time.
const COUNTER_PETAL_DURATION_S = 8.495;
const COUNTER_PETAL_SPEED1 = 90;

function* counterPetalScript(self: Entity): Generator<ScriptYield, void, void> {
  const startT = getMusicTime()?.time ?? null;
  let angle1 = 0;
  let angle2 = Math.PI / 10;
  while (self.alive) {
    if (startT !== null) {
      const m = getMusicTime();
      if (m !== null && m.time - startT >= COUNTER_PETAL_DURATION_S) break;
    }

    ring(self, 2, redDiamondMd, COUNTER_PETAL_SPEED1, angle1 - 0.08);
    ring(self, 2, redDiamondMd, COUNTER_PETAL_SPEED1, angle2 + 0.08);
    yield* waitSeconds(0.03);
    ring(self, 2, redDiamondMd, COUNTER_PETAL_SPEED1, angle1 - 0.1);
    ring(self, 2, redDiamondMd, COUNTER_PETAL_SPEED1, angle2 + 0.1);
    yield* waitSeconds(0.03);
    ring(self, 2, yellowDiamondSm, COUNTER_PETAL_SPEED1, angle1 - 0.14);
    ring(self, 2, yellowDiamondSm, COUNTER_PETAL_SPEED1, angle2 + 0.14);
    yield* waitSeconds(0.3);
    angle1 += Math.PI / 5;
    angle2 -= Math.PI / 5;
  }
  self.die();
}

const counterPetalController = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  damageClass: [],
  damagedByClass: [],
  defaultScript: counterPetalScript,
});

// --- Boss walk loop (music time 31.858 s → 42.478 s) ---
//
// Every 0.531 s (one beat at 113 BPM) the boss picks a new random
// point in the top 15 % of the screen, at least 10 px from its
// current position, and walks toward it at a slow saunter (50 px/s).
// Each step is bounded to a single beat: if the boss reaches the
// target early the loop iterates immediately; if it hasn't arrived
// by the beat's end, the race cancels `moveTo` mid-flight and the
// next iteration picks a new target. The boss's velocity carries
// over across iterations so the motion reads as continuous walking
// rather than start-stop steps.
//
// Runs as a *parallel racer* on the boss itself (not via a
// controller entity) so it can read / write `self.x`, `self.y`, and
// `self.body.velocity` directly. The trailing `waitEntityDead`
// keeps this branch open after the walk segment ends so it doesn't
// terminate the outer race.
//
// Loop-relative timing: the walk segment used to run music
// 31.858 → 41.478 (absolute). With phase 1 looping, the offset
// inside one loop iteration is 31.858 − INTRO_DUR_S = 14.867 s,
// duration = 41.478 − 31.858 = 9.62 s. The segment captures its
// iteration's start time at call and offsets/durations from there.
const BOSS_WALK_OFFSET_S = 14.867;
const BOSS_WALK_DURATION_S = 9.62;
const BOSS_WALK_INTERVAL_S = 0.531;
const BOSS_WALK_SPEED = 50;
const BOSS_WALK_X_MIN = 100;
const BOSS_WALK_X_MAX = GAME_W - 100;
const BOSS_WALK_Y_MIN = GAME_H * 0.2;
const BOSS_WALK_Y_MAX = GAME_H * 0.1;
const BOSS_WALK_MIN_DIST_PX = 10;
const BOSS_WALK_SAMPLE_RETRIES = 10;

function* bossWalkSegment(self: Entity): Generator<ScriptYield, void, void> {
  // Wait the loop-relative offset out before walking. iterStartT is
  // captured at call time so each loop iteration's segment lands at
  // the right musical beat without needing absolute targets.
  const iterStartT = getMusicTime()?.time ?? null;
  if (iterStartT !== null) {
    yield* waitAudioTimeAtLeast(iterStartT + BOSS_WALK_OFFSET_S);
  } else {
    yield* waitSeconds(BOSS_WALK_OFFSET_S);
  }
  // Flip the boss into walk-anim mode for the duration of the
  // segment so `updateAnim` picks the slower walk cycle instead of
  // the run cycle. Reset on exit.
  self.walkAnim = true;
  const startT = getMusicTime()?.time ?? null;
  while (self.alive) {
    if (startT !== null) {
      const m = getMusicTime();
      if (m !== null && m.time - startT >= BOSS_WALK_DURATION_S) break;
    }

    // Reject-sample a target ≥ MIN_DIST from current position. After
    // SAMPLE_RETRIES tries, accept the last sample (or skip if we
    // never escaped the dead-zone — boss just doesn't move this beat).
    let tx = self.x;
    let ty = self.y;
    for (let i = 0; i < BOSS_WALK_SAMPLE_RETRIES; i++) {
      const cx = BOSS_WALK_X_MIN + Math.random() * (BOSS_WALK_X_MAX - BOSS_WALK_X_MIN);
      const cy = BOSS_WALK_Y_MIN + Math.random() * (BOSS_WALK_Y_MAX - BOSS_WALK_Y_MIN);
      if (Math.hypot(cx - self.x, cy - self.y) >= BOSS_WALK_MIN_DIST_PX) {
        tx = cx;
        ty = cy;
        break;
      }
    }

    yield* race(moveTo(self, tx, ty, BOSS_WALK_SPEED), waitSeconds(BOSS_WALK_INTERVAL_S));
  }
  if (self.alive) {
    self.setVelocity(0, 0);
    self.walkAnim = false;
  }
  // Hold so this racer doesn't terminate the outer race when its
  // own segment finishes — death is the canonical exit.
  yield* waitEntityDead(self);
}

// --- Vertical line-explosion rain ---
//
// A "director" entity samples a new x on every iteration and hands it
// off to a child "runner" entity that plays one vertical
// `lineExplosion` from (x, 0) to (x, GAME_H). The runner needs its
// own entity because `lineExplosion` is a generator (yield*'d) — to
// fire successive explosions concurrently faster than one completes,
// each one runs on its own scripted entity in parallel.
//
// Two-entity split keeps the director's loop responsive: the
// director just spawns and waits; the runner manages the explosion
// timeline and dies when finished.
//
// Phase 1 runs the director three times with different boundaries:
//   - 4.248  → 16.991 s   default interval (0.708 s)
//   - 31.858 → 40.354 s   default interval
//   - 40.354 → 48.850 s   doubled interval (1.416 s) — sparser tail
// `makeVertExplosionDirector(endS, intervalS?)` returns a fresh
// EntityKind per segment; the closure captures both the end music
// time and the per-spawn interval so each instance self-terminates
// at its own boundary with its own cadence.
const VERT_EXPLOSION_INTERVAL_S = 0.708;
const VERT_EXPLOSION_MIN_SEPARATION_PX = 60;
const VERT_EXPLOSION_X_INSET_PX = 20;
const VERT_EXPLOSION_SAMPLE_RETRIES = 20;

function* vertExplosionRunnerScript(self: Entity): Generator<ScriptYield, void, void> {
  // Line goes straight down from this entity's spawn position to
  // the bottom of the playfield. `lineExplosion` runs at default
  // parameters (blue, 22 px tile spacing, 30-fps anim).
  yield* lineExplosion(self, self.x, 0, self.x, GAME_H, {
    stepPx: 20,
    stepFrames: 10,
    framesPerSpawn: 5,
  });
  self.die();
}

const vertExplosionRunner = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  damageClass: [],
  damagedByClass: [],
  defaultScript: vertExplosionRunnerScript,
});

function makeVertExplosionDirector(
  durationS: number,
  intervalS: number = VERT_EXPLOSION_INTERVAL_S,
): EntityKind {
  function* script(self: Entity): Generator<ScriptYield, void, void> {
    // Spawn-anchored — see `makeFanSpiralController` rationale.
    const startT = getMusicTime()?.time ?? null;
    let prevX: number | null = null;
    const xMin = VERT_EXPLOSION_X_INSET_PX;
    const xMax = GAME_W - VERT_EXPLOSION_X_INSET_PX;
    while (self.alive) {
      if (startT !== null) {
        const m = getMusicTime();
        if (m !== null && m.time - startT >= durationS) break;
      }

      // Reject-sample an x that's at least MIN_SEPARATION_PX from
      // the previous one. After RETRIES tries, accept whatever we
      // last sampled — a hard cap keeps us from looping forever if
      // (somehow) no valid sample exists.
      let x = xMin + Math.random() * (xMax - xMin);
      for (let i = 0; i < VERT_EXPLOSION_SAMPLE_RETRIES; i++) {
        if (prevX === null || Math.abs(x - prevX) >= VERT_EXPLOSION_MIN_SEPARATION_PX) break;
        x = xMin + Math.random() * (xMax - xMin);
      }
      prevX = x;

      self.spawn(vertExplosionRunner, x, 0, 0, 0);

      yield* waitSeconds(intervalS);
    }
    self.die();
  }
  return new EntityKind({
    sprite: null,
    hitboxRadius: 0,
    damageClass: [],
    damagedByClass: [],
    defaultScript: script,
  });
}

// Durations: 16.991 − 4.248 = 12.743 s (first pass, music 4.248 →
// 16.991); 40.354 − 31.858 = 8.496 s (second pass, music 31.858 →
// 40.354); 48.85 − 40.354 = 8.496 s (third pass, sparser cadence).
const vertExplosionDirector = makeVertExplosionDirector(12.743);
const vertExplosionDirector2 = makeVertExplosionDirector(8.496);
const vertExplosionDirector3 = makeVertExplosionDirector(8.496, VERT_EXPLOSION_INTERVAL_S * 2);

// --- Email volley ---
//
// Every beat (0.531 s) the boss fires a 3-bullet aimed spread of
// bordered email envelopes at the player. Runs as a *parallel racer*
// on the boss itself (like `bossWalkSegment`) rather than via a
// controller entity so the shots originate from the boss's actual
// position as it saunters around the top of the playfield — the
// walk segment fully contains this one. The trailing
// `waitEntityDead` keeps the racer alive past its segment end so
// the outer race doesn't terminate prematurely.
//
// Loop-relative timing: the volley used to fire from music 33.982 →
// 42.478 (absolute). Loop-relative offset is 33.982 − INTRO_DUR_S =
// 16.991 s; duration = 42.478 − 33.982 = 8.496 s.
const EMAIL_VOLLEY_OFFSET_S = 16.991;
const EMAIL_VOLLEY_DURATION_S = 8.496;
const EMAIL_VOLLEY_INTERVAL_S = 0.531;
const EMAIL_VOLLEY_COUNT = 3;
// Mirrors the fan-spiral's reference `speed1` + 3 — same readable
// speed range as the diamond fans so the back-half pace stays inside
// the established envelope.
const EMAIL_VOLLEY_SPEED = FAN_SPIRAL_SPEED1 + 3;
const EMAIL_VOLLEY_SPREAD_RAD = 0.1;

function* emailVolleySegment(self: Entity): Generator<ScriptYield, void, void> {
  // Wait the loop-relative offset out, then fire for the segment
  // duration. Same iteration-anchored pattern as `bossWalkSegment`.
  const iterStartT = getMusicTime()?.time ?? null;
  if (iterStartT !== null) {
    yield* waitAudioTimeAtLeast(iterStartT + EMAIL_VOLLEY_OFFSET_S);
  } else {
    yield* waitSeconds(EMAIL_VOLLEY_OFFSET_S);
  }
  const startT = getMusicTime()?.time ?? null;
  while (self.alive) {
    if (startT !== null) {
      const m = getMusicTime();
      if (m !== null && m.time - startT >= EMAIL_VOLLEY_DURATION_S) break;
    }
    aimed(self, EMAIL_VOLLEY_COUNT, emailBordered, EMAIL_VOLLEY_SPEED, EMAIL_VOLLEY_SPREAD_RAD);
    yield* waitSeconds(EMAIL_VOLLEY_INTERVAL_S);
  }
  // Pad until the boss dies so this racer doesn't terminate the
  // outer iteration race early.
  yield* waitEntityDead(self);
}

// --- Arc-wave from the corners (music time 50.973 s → 57.345 s) ---
//
// Two mirrored controllers anchored at (48, GAME_H-56) and
// (GAME_W-48, GAME_H-56) fan a triple of narrow arcs upward — base
// direction starts pointing straight down (`Math.PI / 2`) and drifts
// by 0.14 rad per micro-iteration, so the sweep walks across the
// lower half of the playfield. Each iteration fires:
//   1. one lava-droplet arc at speed1   (lead)
//   2. one lava-droplet arc at speed1+5 (chase, +30 ms later)
//   3. two red-droplet arcs at speed1+5, slightly tighter and wider
// then waits ~0.18 s before stepping the base angle.
//
// The right controller is the horizontal mirror of the left: its
// per-iteration angle offsets are negated (so `+0.1` becomes `-0.1`)
// and its base-angle step is positive instead of negative, so it
// sweeps CW from the bottom-right instead of CCW from the bottom-left.
// It also starts 0.2124 s after the left one (0.1 of a bar at 113 BPM)
// to interleave the two fans into one alternating wave.
// Duration: 57.345 − 50.973 = 6.372 s. Spawn-anchored — the
// controller runs for the segment length from its own spawn moment,
// so phase 1's loop iterations re-trigger cleanly.
const ARC_WAVE_DURATION_S = 6.372;
const ARC_WAVE_SPEED1 = 90;
const ARC_WAVE_LEFT_X = 56;
const ARC_WAVE_RIGHT_X = GAME_W - 56;
const ARC_WAVE_Y = 130;
const ARC_WAVE_RIGHT_DELAY_S = 0.2124;

function makeArcWaveController(side: 1 | -1, startDelayS: number): EntityKind {
  function* script(self: Entity): Generator<ScriptYield, void, void> {
    if (startDelayS > 0) yield* waitSeconds(startDelayS);
    // Anchor after the start-delay so both halves of the pair get
    // the same effective duration despite the right side's 0.2124s
    // lag — duration counts from the actual pattern-start beat.
    const startT = getMusicTime()?.time ?? null;
    let baseAngle = Math.PI / 2;
    while (self.alive) {
      if (startT !== null) {
        const m = getMusicTime();
        if (m !== null && m.time - startT >= ARC_WAVE_DURATION_S) break;
      }

      // Lead arc — slower lava-droplet pair on the inner cone.
      arc(self, 3, lavaDropletHard, ARC_WAVE_SPEED1, baseAngle + 0.1 * side, baseAngle + 0.2 * side);
      yield* waitSeconds(0.03);
      // Chase arc — faster lava-droplet on the same inner cone, plus
      // two red-droplet arcs straddling it (tighter at 0.11/0.19, wider
      // at 0.09/0.21) for the "leading + bracket" silhouette.
      arc(self, 3, lavaDropletHard, ARC_WAVE_SPEED1 + 5, baseAngle + 0.1 * side, baseAngle + 0.2 * side);
      arc(self, 3, redDropletHard, ARC_WAVE_SPEED1 + 5, baseAngle + 0.11 * side, baseAngle + 0.19 * side);
      arc(self, 3, redDropletHard, ARC_WAVE_SPEED1 + 5, baseAngle + 0.09 * side, baseAngle + 0.21 * side);
      yield* waitSeconds(0.1823);
      baseAngle -= 0.14 * side;
    }
    self.die();
  }
  return new EntityKind({
    sprite: null,
    hitboxRadius: 0,
    damageClass: [],
    damagedByClass: [],
    defaultScript: script,
  });
}

const arcWaveLeftController = makeArcWaveController(1, 0);
const arcWaveRightController = makeArcWaveController(-1, ARC_WAVE_RIGHT_DELAY_S);

// --- Side-door assistant interlopers (music time 15.9 s → 25.487 s) ---
//
// Every 1.062 s a coworker enters through a random side-wall door
// opening — chosen from the currently-visible door centres via
// `visibleDoorCenters` — pops a random speech bubble, waits 0.2 s,
// fires a 7-bullet aimed spread at the player, then walks back out
// the same way. Assistants are `damagedByClass: []` — invulnerable.
//
// The director self-terminates after TOP_ASSISTANT_DURATION_S from
// spawn; in-flight assistants finish their own script. Duration:
// 25.487 − 15.9 = 9.587 s (one segment in the intro layer).
const TOP_ASSISTANT_DURATION_S = 9.587;
const TOP_ASSISTANT_INTERVAL_S = 1.062;
// Distance the assistant travels into the playfield from its
// off-screen spawn point. With sideSpawnX = ±30 (just outside the
// wall), 36 px of travel lands the assistant ~6 px inside the
// screen edge — visibly "in the doorway" but not deep on field.
const TOP_ASSISTANT_TRAVEL_PX = 36;
const TOP_ASSISTANT_ENTER_SPEED = 140;
const TOP_ASSISTANT_EXIT_SPEED = 230;
const TOP_ASSISTANT_BUBBLE_FRAMES = 60;
const TOP_ASSISTANT_PAUSE_S = 0.5;
const TOP_ASSISTANT_AIMED_COUNT = 7;
const TOP_ASSISTANT_AIMED_SPEED = 70;
const TOP_ASSISTANT_AIMED_SPREAD_RAD = (18 * Math.PI) / 180;
// Doors below this y are excluded from the spawn pool — they'd put
// the assistant right at the player's typical perch (PLAYER_Y ≈ 580)
// which reads as an unfair point-blank aimed shot. Mid-screen and
// above stays well clear of the player.
const TOP_ASSISTANT_DOOR_Y_MAX = GAME_H / 2;

const TOP_ASSISTANT_LINES = [
  'Do you have a moment?',
  "I'm just asking",
  "I'll be back later",
  "I see you're busy",
  "Your 10 o'clock is here",
  'Your coffee is ready',
  'Someone here to see you',
  'A delivery is on the line',
];

function* topAssistantScript(self: Entity): Generator<ScriptYield, void, void> {
  // Side derives from the spawn x — `sideSpawnX(-1)` is negative
  // (left wall), `sideSpawnX(+1)` is past `GAME_W` (right wall).
  const side: -1 | 1 = self.x < 0 ? -1 : 1;
  // Enter direction is the opposite of side (left wall → move right).
  const enterDir = -side;
  const enterX = self.x + enterDir * TOP_ASSISTANT_TRAVEL_PX;
  const exitX = self.x;

  yield* moveTo(self, enterX, self.y, TOP_ASSISTANT_ENTER_SPEED);

  const line =
    TOP_ASSISTANT_LINES[Math.floor(Math.random() * TOP_ASSISTANT_LINES.length)] ?? '';
  self.say(line, TOP_ASSISTANT_BUBBLE_FRAMES);
  yield* waitSeconds(TOP_ASSISTANT_PAUSE_S);

  aimed(
    self,
    TOP_ASSISTANT_AIMED_COUNT,
    greedDiamondXs,
    TOP_ASSISTANT_AIMED_SPEED,
    TOP_ASSISTANT_AIMED_SPREAD_RAD,
  );

  // Walk back out the same side they came in.
  yield* moveTo(self, exitX, self.y, TOP_ASSISTANT_EXIT_SPEED);
  self.die();
}

const topAssistant = new EntityKind({
  sprite: 'hr',
  hitboxRadius: 16,
  damageClass: ['player'],
  damagedByClass: [], // invulnerable — player bullets pass through
  defaultScript: topAssistantScript,
});

function* topAssistantDirectorScript(self: Entity): Generator<ScriptYield, void, void> {
  // Spawn-anchored — see `makeFanSpiralController` rationale.
  const startT = getMusicTime()?.time ?? null;
  while (self.alive) {
    if (startT !== null) {
      const m = getMusicTime();
      if (m !== null && m.time - startT >= TOP_ASSISTANT_DURATION_S) break;
    }

    // Pick a random visible door + a random wall side. Filter out
    // doors in the bottom half (y >= TOP_ASSISTANT_DOOR_Y_MAX) so
    // an assistant doesn't materialise at point-blank to the
    // player. Skip the iteration if no eligible door is in frame.
    const doors = visibleDoorCenters(self).filter((y) => y < TOP_ASSISTANT_DOOR_Y_MAX);
    if (doors.length > 0) {
      const y = doors[Math.floor(Math.random() * doors.length)] ?? 0;
      const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
      self.spawn(topAssistant, sideSpawnX(side), y, 0, 0);
    }

    yield* waitSeconds(TOP_ASSISTANT_INTERVAL_S);
  }
  self.die();
}

const topAssistantDirector = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  damageClass: [],
  damagedByClass: [],
  defaultScript: topAssistantDirectorScript,
});

// Intro section runs once over the song's intro (music 0 → INTRO_DUR_S
// = 16.991 s); `loop` runs every loop iteration. Loop-section `t`
// values are loop-relative (0..LOOP_DUR_S) — runBeatmap shifts them by
// `loopStartT + iter * loopDur` per iteration. See
// src/docs/final-boss-music.md and src/script/stage.ts → BeatmapSpec.
const INTRO_DUR_S = INTRO_BEATS * BEAT_S;
const LOOP_DUR_S = LOOP_BEATS * BEAT_S;

function buildPhase1Spec(): BeatmapSpec {
  const intro: BeatmapBeat[] = [];
  const loop: BeatmapBeat[] = [];

  // 48-bullet ring every bar. The intro covers 8 bars (i=0..7); the
  // loop section covers 20 bars per iteration (i=0..19). Spiral
  // angle (`i * 0.13`) restarts every loop iteration so iterations
  // look identical — anchoring patterns to the loop start is the
  // whole point of the split.
  const INTRO_RINGS = Math.floor(INTRO_DUR_S / BAR_S);
  for (let i = 0; i < INTRO_RINGS; i++) {
    intro.push({
      t: i * BAR_S,
      fire: (self) => ring(self, RING_COUNT, redDroplet, RING_SPEED, i * 0.13),
    });
  }
  const LOOP_RINGS = Math.floor(LOOP_DUR_S / BAR_S);
  for (let i = 0; i < LOOP_RINGS; i++) {
    loop.push({
      t: i * BAR_S,
      fire: (self) => ring(self, RING_COUNT, redDroplet, RING_SPEED, i * 0.13),
    });
  }

  // --- intro one-shots (absolute t, t < INTRO_DUR_S = 16.991) ---
  intro.push(
    // Two telegraphed line strokes through the player with directional
    // camera punches 100 ms later, plus a horizontal stroke at bar 2.
    { t: 0, fire: lineToPlayer(0, 0) },
    { t: 0.1, fire: (self) => cameraPunch(self, SHAKE_DX) },
    { t: BAR_S, fire: lineToPlayer(GAME_W, 0) },
    { t: BAR_S + 0.1, fire: (self) => cameraPunch(self, -SHAKE_DX) },
    {
      t: 2 * BAR_S,
      fire: (self) =>
        lineStrokeTelegraph(self, 0, 300, 400, 300, LINE_TELEGRAPH_MS, LINE_STROKE_OPTS),
    },

    // Vertical-explosion rain — was music 4.248 → 16.991 s (12.743 s).
    { t: 4.248, fire: (self) => { self.spawn(vertExplosionDirector, self.x, self.y, 0, 0); } },

    // Fan-spiral — was music 8.496 → 14.867 s (6.371 s).
    { t: 8.496, fire: (self) => { self.spawn(fanSpiralController, self.x, self.y, 0, 0); } },

    // Top-assistant — was music 15.9 → 25.487 s (9.587 s). The
    // segment straddles the intro→loop seam, but the director is
    // spawn-anchored so its duration carries cleanly past the seam.
    { t: 15.9, fire: (self) => { self.spawn(topAssistantDirector, self.x, self.y, 0, 0); } },
  );

  // --- loop section (t relative to loop start = music INTRO_DUR_S) ---
  //
  // Original absolute → loop-relative shift: subtract INTRO_DUR_S.
  //   25.487 → 8.496   (counter-petal)
  //   31.858 → 14.867  (vert pass 2 + boss-walk segment start)
  //   33.982 → 16.991  (email volley start)
  //   40.354 → 23.363  (vert pass 3)
  //   42.478 → 25.487  (fan-spiral encore)
  //   50.973 → 33.982  (arc-wave)
  loop.push(
    // Counter-rotating petals — duration 8.495 s, spawn-anchored.
    { t: 8.496, fire: (self) => { self.spawn(counterPetalController, self.x, self.y, 0, 0); } },

    // Vertical-explosion rain pass 2 — duration 8.496 s.
    { t: 14.867, fire: (self) => { self.spawn(vertExplosionDirector2, self.x, self.y, 0, 0); } },

    // Vertical-explosion rain pass 3 — sparser cadence, duration 8.496 s.
    { t: 23.363, fire: (self) => { self.spawn(vertExplosionDirector3, self.x, self.y, 0, 0); } },

    // Fan-spiral encore — duration 12.743 s.
    { t: 25.487, fire: (self) => { self.spawn(fanSpiralController2, self.x, self.y, 0, 0); } },

    // Arc-wave from the bottom corners — duration 6.372 s.
    {
      t: 33.982,
      fire: (self) => {
        self.spawn(arcWaveLeftController, ARC_WAVE_LEFT_X, ARC_WAVE_Y, 0, 0);
        self.spawn(arcWaveRightController, ARC_WAVE_RIGHT_X, ARC_WAVE_Y, 0, 0);
      },
    },
  );

  // runBeatmap walks each section in order — sort by t.
  intro.sort((a, b) => a.t - b.t);
  loop.sort((a, b) => a.t - b.t);
  return { intro, loop, loopDur: LOOP_DUR_S };
}

export const phase1Spec: BeatmapSpec = buildPhase1Spec();

// --- Boss script ---

function* theBossScript(self: Entity) {
  // Entry — boss flies down from above to his fight position.
  yield* moveTo(self, GAME_W / 2, BOSS_ENTRY_Y, BOSS_ENTRY_SPEED);
  yield BOSS_HOLD_BEFORE_TALK;

  // Opening dialog.
  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Working hard, I see. Or hardly working?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: "Let's circle back on that — after your performance review." },
    ],
  });

  self.stage.bossName = 'The Boss';
  self.onDeath(() => {
    self.stage.bossName = null;
  });
  becomeHittable(self);

  // Hard-cut to the metal track. `t0 = 0` is the first sample of
  // the intro; the beatmap timestamps are anchored to it.
  yield* startMusicWithIntro(FINAL_BOSS_METAL_OPENING_KEY, FINAL_BOSS_METAL_LOOP_KEY);

  self.say('Performance review.', 90);

  // Phase 1: intro fires once, then the loop section iterates against
  // the song's loop until the boss dies. `runBeatmap(spec)` handles
  // the iteration math internally — every iteration's beats shift by
  // `loopStartT + iter * loopDur` so spawning beats hit the correct
  // music timestamps even across many loops.
  //
  // The walk + email racers also need to re-fire each loop iteration.
  // Since `runBeatmap` is a single generator that runs forever, we
  // race it against an outer iteration loop that re-spawns the
  // segment racers as each one's `waitEntityDead` pad finishes —
  // simplest: race the beatmap against a self-restarting segment
  // pair via `race(...).then(loop)`. Implemented inline below.
  yield* race(
    runBeatmap(self, phase1Spec),
    phase1LoopRacers(self),
    waitEntityDead(self),
  );
  yield* waitEntityDead(self);
}

// Re-runs the loop-relative walk + email segments forever. Each
// iteration races the two segments against `waitSeconds(LOOP_DUR_S)`
// so the pair always completes in exactly one loop cycle; the next
// iteration starts at the next loop-section boundary in lockstep
// with `runBeatmap`'s own iteration counter.
function* phase1LoopRacers(self: Entity): Generator<ScriptYield, void, void> {
  // Wait the intro out so the racers' iter-anchored offsets land at
  // the same loop boundary `runBeatmap` does. `loopStartT` reads the
  // track's intro duration from the music engine; fallback 0 when
  // music isn't playing.
  const iterStartT0 = (getMusicTime()?.time ?? 0) + INTRO_DUR_S;
  yield* waitAudioTimeAtLeast(iterStartT0);
  while (self.alive) {
    yield* race(
      bossWalkSegment(self),
      emailVolleySegment(self),
      waitSeconds(LOOP_DUR_S),
    );
  }
}

// --- Death ---

function* theBossDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [{ speaker: 'right', text: 'TODO: final boss defeat line.' }],
  });

  clearBullets(self);
  yield* bossShudder(self);
  self.die();
}

// --- BossKind + wave entry ---

export const theBoss = new BossKind({
  sprite: 'boss',
  // Wider hitbox than non-boss enemies so the player's two side
  // bullets actually land — see firing-math discussion: side
  // bullets fan ±36 px by the time they reach the boss row, so
  // radius < ~36 means only the centre barrel hits.
  hitboxRadius: 36,
  hp: BOSS_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: theBossScript,
  deathScript: theBossDeath,
});

export function* theBossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  self.stage.scheduleMultDrop('boss');
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(theBoss, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });
}
