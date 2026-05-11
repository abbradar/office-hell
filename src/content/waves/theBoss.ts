import { FINAL_BOSS_METAL_LOOP_KEY, FINAL_BOSS_METAL_OPENING_KEY, NENE_BOSS_DIALOG_KEY } from '../../audio/keys';
import { fadeOutMusic, getMusicTime, stopMusicLoop } from '../../audio/music/loop';
import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { becomeHittable, bossShudder, nextBossPhase, PhasedBossKind, waitPhaseDown } from '../../script/boss';
import { aimed, arc, cameraPunch, lineExplosion, lineStrokeTelegraph, moveTo, ring } from '../../script/patterns';
import {
  type BeatmapBeat,
  type BeatmapSpec,
  markWave,
  prepareForBoss,
  race,
  runBeatmap,
  sideSpawnX,
  startMusicLoop,
  startMusicWithIntro,
  suspendRunning,
  visibleDoorCenters,
  waitAudioTimeAtLeast,
  waitEntityDead,
  waitSeconds,
  waitTrackEnded,
} from '../../script/stage';
import { EntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import {
  blueExplosion,
  blueLongerDroplet,
  bullet,
  emailBordered,
  greedDiamondXs,
  lavaDropletHard,
  questionBordered,
  redCross,
  redDiamondMd,
  redDroplet,
  redDropletHard,
  redExplosion,
  yellowDiamondSm,
} from '../kinds';
import { RED_EXPLOSION_FRAMES } from '../textures';

// --- Final boss: three-phase encounter ---
//
// Phase 1 (650 → 250 hp). Standard layer set, blue vertical-explosion
//                         rain, no arc-wave / no orbital arcs. Force-
//                         advances to phase 2 if the metal track
//                         reaches 35 s without the player breaking the
//                         HP gate.
// Phase 2 (250 → 100 hp). Same layers, red vertical-explosion rain
//                         instead of blue, two new orbital arcs:
//                         48 questions @ 25.487 → 48.850 s (visual
//                         ring) and 64 questions @ 48.850 → 57.345 s
//                         that fire one bullet outward per orbiter
//                         per bar. Force-advances to phase 3 at the
//                         first loop wrap (59.469 s).
// Phase 3 (100 → 0 hp).   Phase-2 layers + arc-wave back in + ring
//                         volley swaps to `blueLongerDroplet`.
//                         Lethal phase — race against entity death.

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;
// Total boss HP across all three phases: 800 = 400 (phase 1, until
// 400 hp remaining) + 200 (phase 2, until 200 hp remaining) + 200
// (phase 3, lethal). PhasedBossKind decrements per-phase, so the
// debug HUD's bossHp readout shows the current phase pool draining.
const PHASE1_HP = 400;
const PHASE2_HP = 200;
const PHASE3_HP = 200;

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
function extendRayToBounds(fromX: number, fromY: number, throughX: number, throughY: number): { x: number; y: number } {
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
        if (m === null) break;
        if (m.time - startT >= durationS) break;
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
      if (m === null) break;
      if (m.time - startT >= COUNTER_PETAL_DURATION_S) break;
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
      if (m === null) break;
      if (m.time - startT >= BOSS_WALK_DURATION_S) break;
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

// Blue / red runner variants — same vertical line-explosion body
// shape, different sprite kind. Phase 1 uses the blue variant; phases
// 2-3 swap to red. `frameCount` matches the kind's spritesheet (blue
// = 7 frames, red = 8 per RED_EXPLOSION_FRAMES) so the per-tile
// `setFrame` loop in `lineExplosion` doesn't run off the end.
function makeVertExplosionRunner(kind: EntityKind, frameCount: number): EntityKind {
  function* script(self: Entity): Generator<ScriptYield, void, void> {
    yield* lineExplosion(self, self.x, 0, self.x, GAME_H, {
      stepPx: 20,
      stepFrames: 10,
      framesPerSpawn: 5,
      kind,
      frameCount,
    });
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

const vertExplosionRunnerBlue = makeVertExplosionRunner(blueExplosion, 7);
const vertExplosionRunnerRed = makeVertExplosionRunner(redExplosion, RED_EXPLOSION_FRAMES);

function makeVertExplosionDirector(
  runner: EntityKind,
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
        if (m === null) break;
        if (m.time - startT >= durationS) break;
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

      self.spawn(runner, x, 0, 0, 0);

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

// Per-segment durations, identical to phase 1's prototype values:
// 12.743 s (first pass, music 4.248 → 16.991); 8.496 s (second pass,
// music 31.858 → 40.354); 8.496 s (third pass, sparser cadence).
// Each phase gets its own director triplet because the runner kind
// differs — phase 1 blue, phases 2-3 red.
const vertExplosionDirectorBlue = makeVertExplosionDirector(vertExplosionRunnerBlue, 12.743);
const vertExplosionDirectorBlue2 = makeVertExplosionDirector(vertExplosionRunnerBlue, 8.496);
const vertExplosionDirectorBlue3 = makeVertExplosionDirector(
  vertExplosionRunnerBlue,
  8.496,
  VERT_EXPLOSION_INTERVAL_S * 2,
);
const vertExplosionDirectorRed = makeVertExplosionDirector(vertExplosionRunnerRed, 12.743);
const vertExplosionDirectorRed2 = makeVertExplosionDirector(vertExplosionRunnerRed, 8.496);
const vertExplosionDirectorRed3 = makeVertExplosionDirector(
  vertExplosionRunnerRed,
  8.496,
  VERT_EXPLOSION_INTERVAL_S * 2,
);

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
      if (m === null) break;
      if (m.time - startT >= EMAIL_VOLLEY_DURATION_S) break;
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
const ARC_WAVE_DURATION_S = 1.4;
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
        if (m === null) break;
        if (m.time - startT >= ARC_WAVE_DURATION_S) break;
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
      baseAngle -= 0.35 * side;
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

// --- Orbital arcs (phase 2-3) ---
//
// A controller spawns N `questionBordered` entities arranged evenly
// around a circle centred on the live boss. Each tick the controller
// rewrites every child's position to keep them on the orbit; rotation
// is `ORBIT_ANGULAR_VELOCITY` rad/s applied to the base angle. The
// controller dies after `durationS` of music time and takes the
// children with it.
//
// Two flavours:
//   - 48-question / no firing  → music 25.487 → 48.850 s (23.363 s)
//   - 64-question / one bullet outward per orbiter every 2.124 s
//     → music 48.850 → 57.345 s (8.495 s)
// Times above are absolute (intro + loop); loop-relative offsets are
// the same minus INTRO_DUR_S (16.991 s).
const ORBIT_RADIUS = 60;
// Full revolution per 8 s — slow enough to read as "rotating wall of
// questions" rather than a blur, fast enough to force the player to
// keep moving instead of camping a gap.
const ORBIT_ANGULAR_VELOCITY = Math.PI / 4;
// Outward bullet speed for the firing-orbit variant. Same magnitude as
// the boss's ring volleys so the spawned bullets cross the player's
// dodge lane on the same beat grid.
const ORBIT_FIRE_SPEED = 130;

function makeOrbitController(opts: {
  count: number;
  radius: number;
  durationS: number;
  angularVelocity: number;
  // Null = no outward fire (visual ring only). Number = seconds
  // between outward bullet volleys (one bullet per orbiter per fire).
  fireIntervalS: number | null;
}): EntityKind {
  function* script(self: Entity): Generator<ScriptYield, void, void> {
    const stage = self.stage;
    // Orbital centre — tracks the live boss so the ring follows when
    // the boss walks. Falls back to the controller's own position if
    // no boss is registered (e.g. a standalone reuser).
    const centerOf = (): Entity => stage.bossEntity ?? self;

    const children: Entity[] = [];
    const baseAngles: number[] = [];
    const c0 = centerOf();
    for (let i = 0; i < opts.count; i++) {
      const angle = (Math.PI * 2 * i) / opts.count;
      const x = c0.x + Math.cos(angle) * opts.radius;
      const y = c0.y + Math.sin(angle) * opts.radius;
      const e = self.spawn(questionBordered, x, y, 0, 0);
      children.push(e);
      baseAngles.push(angle);
    }

    const segmentStartMs = self.scene.time.now;
    const startT = getMusicTime()?.time ?? null;
    let nextFireMs =
      opts.fireIntervalS === null ? Number.POSITIVE_INFINITY : segmentStartMs + opts.fireIntervalS * 1000;

    // Two exit paths:
    //   - duration cap reached → kill the orbiter children as part of
    //     normal cleanup (so the next loop iteration's controller
    //     spawn starts fresh).
    //   - boss gone (death script cleared `stage.bossEntity`) →
    //     leave the children alive so the boss-death bullet sweep can
    //     fling them along with the rest of the cluster.
    let bossLost = false;
    while (self.alive) {
      if (stage.bossEntity === null) {
        bossLost = true;
        break;
      }
      // Music-time duration gate — same shape as the other
      // controllers, so each loop iteration re-runs the full segment.
      if (startT !== null) {
        const m = getMusicTime();
        if (m === null) break;
        if (m.time - startT >= opts.durationS) break;
      }

      const c = centerOf();
      const elapsedS = (self.scene.time.now - segmentStartMs) / 1000;
      const angleOffset = elapsedS * opts.angularVelocity;

      // Re-position every alive orbiter. Disabled bodies + manual
      // setPosition would skip collision; the body.reset() call moves
      // the arcade body to match so contact with the player still
      // registers.
      for (let i = 0; i < children.length; i++) {
        const e = children[i];
        if (!e?.alive) continue;
        const base = baseAngles[i] ?? 0;
        const a = base + angleOffset;
        const x = c.x + Math.cos(a) * opts.radius;
        const y = c.y + Math.sin(a) * opts.radius;
        e.setPosition(x, y);
        e.body.reset(x, y);
      }

      // Outward firing — only if fireIntervalS is set. Fires
      // `count` bullets per beat, one per orbiter, radially outward
      // from the orbit centre.
      while (self.scene.time.now >= nextFireMs) {
        const fireElapsedS = (nextFireMs - segmentStartMs) / 1000;
        const fireAngleOffset = fireElapsedS * opts.angularVelocity;
        for (let i = 0; i < children.length; i++) {
          const e = children[i];
          if (!e?.alive) continue;
          const base = baseAngles[i] ?? 0;
          const a = base + fireAngleOffset;
          const vx = Math.cos(a) * ORBIT_FIRE_SPEED;
          const vy = Math.sin(a) * ORBIT_FIRE_SPEED;
          self.spawn(bullet, e.x, e.y, vx, vy);
        }
        if (opts.fireIntervalS === null) break;
        nextFireMs += opts.fireIntervalS * 1000;
      }

      yield 1;
    }

    // Normal duration exit cleans up the orbiter children; the
    // boss-lost path leaves them so the death sweep can fling them.
    if (!bossLost) {
      for (const e of children) {
        if (e.alive) e.die();
      }
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

const orbitArc1Controller = makeOrbitController({
  count: 48,
  radius: ORBIT_RADIUS,
  durationS: 23.363,
  angularVelocity: ORBIT_ANGULAR_VELOCITY,
  fireIntervalS: null,
});

const orbitArc2Controller = makeOrbitController({
  count: 64,
  radius: ORBIT_RADIUS,
  durationS: 8.495,
  angularVelocity: ORBIT_ANGULAR_VELOCITY,
  fireIntervalS: BAR_S,
});

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

  const line = TOP_ASSISTANT_LINES[Math.floor(Math.random() * TOP_ASSISTANT_LINES.length)] ?? '';
  self.say(line, TOP_ASSISTANT_BUBBLE_FRAMES);
  yield* waitSeconds(TOP_ASSISTANT_PAUSE_S);

  aimed(self, TOP_ASSISTANT_AIMED_COUNT, greedDiamondXs, TOP_ASSISTANT_AIMED_SPEED, TOP_ASSISTANT_AIMED_SPREAD_RAD);

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
      if (m === null) break;
      if (m.time - startT >= TOP_ASSISTANT_DURATION_S) break;
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

// Per-phase deltas to the shared boss beatmap. Phase 1 uses blue
// explosions, red-droplet rings, and no arc-wave / no orbital arcs.
// Phase 2 swaps in red explosions and inserts the two orbital arcs.
// Phase 3 keeps phase-2's red explosions + orbitals, adds the
// arc-wave back, and swaps the ring bullet to `blueLongerDroplet`.
type BossSpecOpts = {
  // Sprite for the per-bar 48-bullet ring volley.
  ringKind: EntityKind;
  // Vertical-explosion directors for the three rain segments.
  vert1: EntityKind;
  vert2: EntityKind;
  vert3: EntityKind;
  // Re-add the lower-corner arc-wave at loop t = 33.982 (phase 3 only).
  includeArcWave: boolean;
  // Spawn the two orbital arcs at loop t = 8.496 / 31.859 (phase 2+).
  includeOrbitArcs: boolean;
};

function buildBossSpec(opts: BossSpecOpts): BeatmapSpec {
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
      fire: (self) => ring(self, RING_COUNT, opts.ringKind, RING_SPEED, i * 0.13),
    });
  }
  const LOOP_RINGS = Math.floor(LOOP_DUR_S / BAR_S);
  for (let i = 0; i < LOOP_RINGS; i++) {
    loop.push({
      t: i * BAR_S,
      fire: (self) => ring(self, RING_COUNT, opts.ringKind, RING_SPEED, i * 0.13),
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
      fire: (self) => lineStrokeTelegraph(self, 0, 300, 400, 300, LINE_TELEGRAPH_MS, LINE_STROKE_OPTS),
    },

    // Vertical-explosion rain — music 4.248 → 16.991 s (12.743 s).
    {
      t: 4.248,
      fire: (self) => {
        self.spawn(opts.vert1, self.x, self.y, 0, 0);
      },
    },

    // Fan-spiral — music 8.496 → 14.867 s (6.371 s).
    {
      t: 8.496,
      fire: (self) => {
        self.spawn(fanSpiralController, self.x, self.y, 0, 0);
      },
    },

    // Top-assistant — music 15.9 → 25.487 s (9.587 s). The segment
    // straddles the intro→loop seam, but the director is spawn-
    // anchored so its duration carries cleanly past the seam.
    {
      t: 15.9,
      fire: (self) => {
        self.spawn(topAssistantDirector, self.x, self.y, 0, 0);
      },
    },
  );

  // --- loop section (t relative to loop start = music INTRO_DUR_S) ---
  //
  // Absolute → loop-relative shift: subtract INTRO_DUR_S (16.991 s).
  //   25.487 → 8.496   (counter-petal + orbitArc1 start)
  //   31.858 → 14.867  (vert pass 2 + boss-walk segment start)
  //   33.982 → 16.991  (email volley start)
  //   40.354 → 23.363  (vert pass 3)
  //   42.478 → 25.487  (fan-spiral encore)
  //   48.850 → 31.859  (orbitArc2 start, orbitArc1 end)
  //   50.973 → 33.982  (arc-wave; phase 3 only)
  //   57.345 → 40.354  (orbitArc2 end)
  loop.push(
    // Counter-rotating petals — duration 8.495 s.
    {
      t: 8.496,
      fire: (self) => {
        self.spawn(counterPetalController, self.x, self.y, 0, 0);
      },
    },
    // Vertical-explosion rain pass 2 — duration 8.496 s.
    {
      t: 14.867,
      fire: (self) => {
        self.spawn(opts.vert2, self.x, self.y, 0, 0);
      },
    },
    // Vertical-explosion rain pass 3 — sparser cadence, duration 8.496 s.
    {
      t: 23.363,
      fire: (self) => {
        self.spawn(opts.vert3, self.x, self.y, 0, 0);
      },
    },
    // Fan-spiral encore — duration 12.743 s.
    {
      t: 25.487,
      fire: (self) => {
        self.spawn(fanSpiralController2, self.x, self.y, 0, 0);
      },
    },
  );

  if (opts.includeOrbitArcs) {
    loop.push(
      // 48-question orbital — 25.487 → 48.850 s (23.363 s).
      {
        t: 8.496,
        fire: (self) => {
          self.spawn(orbitArc1Controller, self.x, self.y, 0, 0);
        },
      },
      // 64-question orbital with outward bullet fire every bar
      // (2.124 s) — 48.850 → 57.345 s (8.495 s).
      {
        t: 31.859,
        fire: (self) => {
          self.spawn(orbitArc2Controller, self.x, self.y, 0, 0);
        },
      },
    );
  }

  if (opts.includeArcWave) {
    loop.push({
      t: 33.982,
      fire: (self) => {
        self.spawn(arcWaveLeftController, ARC_WAVE_LEFT_X, ARC_WAVE_Y, 0, 0);
        self.spawn(arcWaveRightController, ARC_WAVE_RIGHT_X, ARC_WAVE_Y, 0, 0);
      },
    });
  }

  // runBeatmap walks each section in order — sort by t.
  intro.sort((a, b) => a.t - b.t);
  loop.sort((a, b) => a.t - b.t);
  return { intro, loop, loopDur: LOOP_DUR_S };
}

export const phase1Spec: BeatmapSpec = buildBossSpec({
  ringKind: redDroplet,
  vert1: vertExplosionDirectorBlue,
  vert2: vertExplosionDirectorBlue2,
  vert3: vertExplosionDirectorBlue3,
  includeArcWave: false,
  includeOrbitArcs: false,
});

export const phase2Spec: BeatmapSpec = buildBossSpec({
  ringKind: redDroplet,
  vert1: vertExplosionDirectorRed,
  vert2: vertExplosionDirectorRed2,
  vert3: vertExplosionDirectorRed3,
  includeArcWave: false,
  includeOrbitArcs: true,
});

export const phase3Spec: BeatmapSpec = buildBossSpec({
  ringKind: blueLongerDroplet,
  vert1: vertExplosionDirectorRed,
  vert2: vertExplosionDirectorRed2,
  vert3: vertExplosionDirectorRed3,
  includeArcWave: true,
  includeOrbitArcs: true,
});

// --- Boss script ---

// Force-advance time caps. Phase 1 force-advances to phase 2 if the
// metal track reaches 35 s and the player hasn't broken the HP gate
// yet; phase 2 force-advances to phase 3 at the first loop wrap
// (INTRO_DUR_S + LOOP_DUR_S = 59.469 s, "the track starts looping").
// Caps are only honoured while the metal loop is the live track so
// practice runs that spawn a later phase directly without starting
// the metal music fall through to HP-only termination.
const PHASE1_TIME_CAP_S = 35;
const PHASE2_TIME_CAP_S = INTRO_DUR_S + LOOP_DUR_S;

// Race the phase's HP gate (PhasedBossKind raises `phaseDown` when
// the per-phase pool empties) against a music-time cap.
function* untilPhaseEndOrTime(self: Entity, audioTimeS: number): Generator<ScriptYield, void, void> {
  const onMetal = getMusicTime()?.key === FINAL_BOSS_METAL_LOOP_KEY;
  if (onMetal) {
    yield* race(waitPhaseDown(self), waitAudioTimeAtLeast(audioTimeS));
  } else {
    yield* waitPhaseDown(self);
  }
}

// Idempotent boss-claim helper. The first phase that runs claims the
// HUD header + bossEntity reference; subsequent phases (transition
// or practice entry on a later phase) see the slot already taken and
// no-op. The onDeath cleanup runs once because we only register it
// the first time around.
function claimBoss(self: Entity): void {
  if (self.stage.bossEntity === self) return;
  self.stage.bossName = 'The Boss';
  self.stage.bossEntity = self;
  self.onDeath(() => {
    self.stage.bossName = null;
    self.stage.bossEntity = null;
  });
}

function* theBossPhase1Script(self: Entity): Generator<ScriptYield, void, void> {
  // Entry — boss flies down from above to his fight position. The
  // wave already cut the kaedalus-short loop and queued the nene
  // battle-9 loop (with a 1 s silence beat) before spawning the
  // boss, so the boss walks in under the looping layer1_1 track
  // without any extra music wrangling in here.
  yield* moveTo(self, GAME_W / 2, BOSS_ENTRY_Y, BOSS_ENTRY_SPEED);
  yield BOSS_HOLD_BEFORE_TALK;

  // Opening dialog.
  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Why are you not at your desk?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: "No, today you won't." },
      { speaker: 'right', text: "It's a pivotal moment in our company's history." },
      { speaker: 'left', text: "Isn't every our day the deadline-is-tomorrow day?" },
      { speaker: 'right', text: 'Too much talking, you get back now!' },
    ],
  });

  claimBoss(self);
  becomeHittable(self);

  // Wait for the nene battle-9 loop's next seam, then hard-cut to the
  // metal intro. `t0 = 0` is the first sample of the intro; the
  // beatmap timestamps are anchored to it, so we don't want the swap
  // to land mid-phrase of the nene loop. Gated on the nene loop being
  // live (set up by the wave) so a future reuser spawning the boss
  // with different music isn't trampled.
  const inKaedalusChain = getMusicTime()?.key === NENE_BOSS_DIALOG_KEY;
  if (inKaedalusChain) {
    yield* waitTrackEnded();
    yield* startMusicWithIntro(FINAL_BOSS_METAL_OPENING_KEY, FINAL_BOSS_METAL_LOOP_KEY);
  }

  self.say('Performance review.', 90);

  yield* race(runBeatmap(self, phase1Spec), bossLoopRacers(self), untilPhaseEndOrTime(self, PHASE1_TIME_CAP_S));
  if (!self.alive) return;
  yield* nextBossPhase(self);
  yield* theBossPhase2Script(self);
}

// How long each phase-entry bubble stays up (frames @ 60fps). 90 = 1.5 s.
// The second bubble's `yield 90` is the wait *before* it appears so
// the first line has time to read; we let the second one fall off
// naturally as the patterns ramp up.
const PHASE_ENTRY_BUBBLE_FRAMES = 90;

function* theBossPhase2Script(self: Entity): Generator<ScriptYield, void, void> {
  // For practice entries jumping straight to phase 2: claim the boss
  // slot + flip damage on. In the live chain phase 1 already did this;
  // claimBoss + becomeHittable are both idempotent.
  claimBoss(self);
  becomeHittable(self);
  self.say('How are talking to your BOSS?!', PHASE_ENTRY_BUBBLE_FRAMES);
  yield PHASE_ENTRY_BUBBLE_FRAMES;
  self.say('I will SHRINK the whole DEPARTMENT!', PHASE_ENTRY_BUBBLE_FRAMES);

  yield* race(runBeatmap(self, phase2Spec), bossLoopRacers(self), untilPhaseEndOrTime(self, PHASE2_TIME_CAP_S));
  if (!self.alive) return;
  yield* nextBossPhase(self);
  yield* theBossPhase3Script(self);
}

function* theBossPhase3Script(self: Entity): Generator<ScriptYield, void, void> {
  claimBoss(self);
  becomeHittable(self);
  self.say('No EEXCUSES!', PHASE_ENTRY_BUBBLE_FRAMES);
  yield PHASE_ENTRY_BUBBLE_FRAMES;
  self.say('Your work worth NOTHING!', PHASE_ENTRY_BUBBLE_FRAMES);

  // Lethal phase — no time cap; race the patterns against entity
  // death (PhasedBossKind.takeDamage routes the killing blow through
  // the deathScript on the last phase).
  yield* race(runBeatmap(self, phase3Spec), bossLoopRacers(self), waitEntityDead(self));
  yield* waitEntityDead(self);
}

// Re-runs the loop-relative walk + email segments forever. Each
// iteration races the two segments against `waitSeconds(LOOP_DUR_S)`
// so the pair always completes in exactly one loop cycle; the next
// iteration starts at the next loop-section boundary in lockstep
// with `runBeatmap`'s own iteration counter.
function* bossLoopRacers(self: Entity): Generator<ScriptYield, void, void> {
  // Wait the intro out so the racers' iter-anchored offsets land at
  // the same loop boundary `runBeatmap` does. `loopStartT` reads the
  // track's intro duration from the music engine; fallback 0 when
  // music isn't playing.
  const iterStartT0 = (getMusicTime()?.time ?? 0) + INTRO_DUR_S;
  yield* waitAudioTimeAtLeast(iterStartT0);
  while (self.alive) {
    yield* race(bossWalkSegment(self), emailVolleySegment(self), waitSeconds(LOOP_DUR_S));
  }
}

// --- Death ---

// Two-stage post-death bullet defusal. Stage 1 (50 ms): retexture
// every live enemy bullet as the default round `bullet` sprite and
// pin its velocity to 0 — visually "the bullets all become harmless
// dots". Stage 2 (250 ms): point each bullet's velocity away from
// the player and accelerate from `START_SPEED` to `END_SPEED`, so
// the cluster fans out and clears the field. Whatever's still on
// screen at the 250 ms mark is `die()`'d so the wave's hand-off to
// the ending scene starts on a clean slate.
const BULLET_DEFUSE_FREEZE_S = 0.05;
const BULLET_DEFUSE_LAUNCH_S = 0.25;
const BULLET_DEFUSE_START_SPEED = 200;
const BULLET_DEFUSE_END_SPEED = 1600;

function* bossBulletDeathSweep(self: Entity): Generator<ScriptYield, void, void> {
  const stage = self.stage;
  const player = stage.player;

  // Snapshot every live projectile currently on the field. The boss's
  // bullets are a mix of EntityKind variants (`redDroplet`,
  // `redDiamondMd`, `redCross`, `emailBordered`, etc.) — using
  // `EnemyBulletEntityKind` as the filter only catches the basic
  // round `bullet` and misses everything else, so we partition by
  // "lives in damages.player AND isn't HP-bearing AND has no
  // defaultScript". That keeps the boss (HP) and side-door
  // assistants (have a defaultScript) out of the cluster while
  // pulling in every projectile + orbiter + explosion tile.
  const bullets: Entity[] = [];
  for (const child of stage.damages.player.getChildren()) {
    const e = child as Entity;
    if (!e.alive) continue;
    if (e.kind instanceof HPEntityKind) continue;
    if (e.kind.defaultScript !== undefined) continue;
    bullets.push(e);
  }
  if (bullets.length === 0) return;

  // Stage 1 — freeze + reskin to the default bullet so the cluster
  // reads as a single tidy thing rather than the chaotic mix it was
  // mid-fight.
  for (const e of bullets) {
    if (!e.alive) continue;
    e.setTexture('bullet');
    e.body.setVelocity(0, 0);
  }
  // The player can't take damage during the defuse — the fight's
  // over, and bullets flying *through* the player on their way out
  // shouldn't undo the win.
  player.pushInvincible();

  yield* waitSeconds(BULLET_DEFUSE_FREEZE_S);

  // Stage 2 — radial outward from the player, accelerating.
  const trajectories: { entity: Entity; ux: number; uy: number }[] = [];
  for (const e of bullets) {
    if (!e.alive) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) {
      // Bullet sitting on the player — pick a random direction so it
      // still leaves the field instead of stalling on the origin.
      const a = Math.random() * Math.PI * 2;
      trajectories.push({ entity: e, ux: Math.cos(a), uy: Math.sin(a) });
    } else {
      trajectories.push({ entity: e, ux: dx / dist, uy: dy / dist });
    }
  }

  const startMs = self.scene.time.now;
  while (true) {
    const elapsedS = (self.scene.time.now - startMs) / 1000;
    if (elapsedS >= BULLET_DEFUSE_LAUNCH_S) break;
    const k = elapsedS / BULLET_DEFUSE_LAUNCH_S;
    const speed = BULLET_DEFUSE_START_SPEED + (BULLET_DEFUSE_END_SPEED - BULLET_DEFUSE_START_SPEED) * k;
    for (const t of trajectories) {
      if (!t.entity.alive) continue;
      t.entity.body.setVelocity(t.ux * speed, t.uy * speed);
    }
    yield 1;
  }

  // Anything still on the field after the launch window — kill it.
  for (const t of trajectories) {
    if (t.entity.alive) t.entity.die();
  }

  // Belt-and-braces purge: kill every active entity that isn't the
  // player or the boss. The directors all bailed when the music
  // stopped (see the `m === null` checks in each controller loop),
  // but anything they had in flight at that moment — line-explosion
  // runners mid-sweep, top-assistant entities mid-walk-back, etc. —
  // is still happily ticking out its own timeline and would keep
  // spawning fresh tiles / pose threats into the ending walk-home.
  // One pass over `stage.active` after the visible flourish gives
  // the scene a clean handoff.
  for (const e of stage.active) {
    if (e === self) continue;
    if (e === player) continue;
    // The chain script lives on `stage.stageEntity` — killing it
    // here would terminate the wave hand-off into endingScene and
    // the game would just sit there with a frozen `wave: ending`
    // label.
    if (e === stage.stageEntity) continue;
    if (e.alive) e.die();
  }

  player.popInvincible();
}

// Music phase-out window, in ms, kicked off the moment the boss takes
// the lethal hit (= the death script starts). User-spec: "phase out
// the track 0.2 s after boss defeat" — the metal loop ramps to zero
// over 200 ms so the dialog/shudder beat plays out under silence.
const BOSS_DEATH_MUSIC_FADE_MS = 500;

function* theBossDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  // Phase out the metal track immediately so the death sequence
  // (dialog → shudder → bullet sweep → die) plays out under silence.
  // Fired off the audio context's clock — runs in parallel with the
  // dialog freeze, no `yield` needed.
  fadeOutMusic(BOSS_DEATH_MUSIC_FADE_MS);

  // Signal any live orbit controllers to bail out (and leave their
  // orbiter children alive for the upcoming bullet sweep). claimBoss's
  // `onDeath` would clear this later from `self.die()`, but the
  // controllers need the signal NOW — they re-position orbiters every
  // physics frame, and once the dialog dismisses and physics resumes
  // their `setPosition`/`body.reset` calls would overwrite the
  // sweep's velocity changes.
  self.stage.bossEntity = null;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'I-I! Ne.. Breath!.' },
      { speaker: 'right', text: 'Light... shrinking...' },
    ],
  });

  yield* bossShudder(self);
  // Bullet sweep replaces the old `clearBullets(self)` snap-removal:
  // bullets first morph into default rounds (50 ms), then radially
  // accelerate away from the player (250 ms) until they leave the
  // field. Runs after the shudder so the boss is already visually
  // gone and the screen-clear flourish reads as the aftermath.
  yield* bossBulletDeathSweep(self);
  self.die();
}

// --- PhasedBossKind variants + wave entries ---

function makeTheBoss(startPhaseIdx = 0): PhasedBossKind {
  return new PhasedBossKind({
    sprite: 'boss',
    // Wider hitbox than non-boss enemies so the player's two side
    // bullets actually land — see firing-math discussion: side
    // bullets fan ±36 px by the time they reach the boss row, so
    // radius < ~36 means only the centre barrel hits.
    hitboxRadius: 36,
    phases: [
      { hp: PHASE1_HP, script: theBossPhase1Script },
      { hp: PHASE2_HP, script: theBossPhase2Script },
      { hp: PHASE3_HP, script: theBossPhase3Script },
    ],
    startPhaseIdx,
    damageClass: ['player'],
    damagedByClass: ['enemy'],
    deathScript: theBossDeath,
  });
}

export const theBoss = makeTheBoss();
export const theBossFromPhase2 = makeTheBoss(1);
export const theBossFromPhase3 = makeTheBoss(2);

export function* theBossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  yield* prepareForBoss(self);

  // Pre-entry beat: cut whatever's playing (crack_short in the live
  // chain, menu loop in a practice run), hold 1 s of silence as the
  // boss starts walking, then bring the nene battle-9 layer1 loop up
  // under the entry + dialog.
  stopMusicLoop();
  yield* waitSeconds(1);
  yield* startMusicLoop(NENE_BOSS_DIALOG_KEY);

  yield* suspendRunning(self, function* () {
    const boss = self.spawn(theBoss, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });

  // Final boss is down — freeze the scoreboard for everything that
  // follows (outro, endingScene). The score the player banked through
  // the fight is the final number; idle alive-ticks and stray drops
  // during the slow-walk-home ending shouldn't bump it any further.
  self.stage.scoringActive = false;
}

// Practice-only entries — spawn the boss directly at the fight anchor
// at the requested start phase, no entry walk / dialog / silence beat
// / music swap. The phase script claims the boss slot + enables damage
// and the patterns run against whatever (or no) music is currently
// playing. Mirrors `wellnessCoach`'s practice variant pattern.
function* theBossWaveFromPhase(self: Entity, kind: PhasedBossKind, label: string): Generator<ScriptYield, void, void> {
  markWave(self, label);
  // Start the metal track before spawning so the phase script's
  // patterns + music-time force-advance gate (`untilPhaseEndOrTime`)
  // have a live clock to lock onto. Without this the practice
  // entries played silent and the patterns fell back to wall-clock
  // gaps. Same intro+loop shape as the live chain — the practice run
  // gets the boss music straight from t=0.
  yield* startMusicWithIntro(FINAL_BOSS_METAL_OPENING_KEY, FINAL_BOSS_METAL_LOOP_KEY);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(kind, GAME_W / 2, BOSS_ENTRY_Y, 0, 0);
    yield { until: boss };
  });
  self.stage.scoringActive = false;
}

export function* theBossPhase2Wave(self: Entity): Generator<ScriptYield, void, void> {
  yield* theBossWaveFromPhase(self, theBossFromPhase2, 'final boss p2');
}

export function* theBossPhase3Wave(self: Entity): Generator<ScriptYield, void, void> {
  yield* theBossWaveFromPhase(self, theBossFromPhase3, 'final boss p3');
}
