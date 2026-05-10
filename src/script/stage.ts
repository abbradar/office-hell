// Stage scripts are plain generator functions composed with `yield*`.
// There is no queue, no entries, no filters, no runner wrapper —
// sequential execution comes from the generator runtime, gating from
// `wait*` helpers, and HUD labelling from `markWave`. Stage-local
// state lives on `stage.globals` / `stage.wave`, both reset each time a
// new `StageManager` is constructed (i.e. each GameScene launch).

import type Phaser from 'phaser';
import {
  getCurrentTrackInfo,
  getMusicTime,
  isMusicFinished,
  playMusicLoop,
  playMusicWithIntro,
} from '../audio/music/loop';
import { GAME_W, SCRIPT_FPS } from '../config';
import { computeDoorYs, DOOR_H, isDoorVisible } from '../content/doors';
import type { Entity } from '../entities/Entity';
import { moveTo } from './patterns';
import type { ScriptYield } from './types';

// Set the HUD's current-wave label. Pure side-effect, not a generator —
// callers don't `yield*` it. Writes `stage.wave`; the StageManager
// initialises it to null and resets when the scene constructs a new
// manager.
export function markWave(self: Entity, name: string): void {
  self.stage.wave = name;
}

// --- yield-reason wrapper -------------------------------------------------

// Stamp a `yieldReason` label onto every leaf yield that flows through
// `inner`, so a script with `debugYieldReasons` shows `reason` in the
// debug HUD while parked. Existing `yieldReason` fields are preserved
// (innermost wins) — wrapping an already-labelled helper is a no-op for
// its own yields, which lets high-level helpers compose freely.
//
// Bare `number` yields can't carry a label, so they're rewritten as
// `{ physicsFrames: n, yieldReason: reason }` — matches the bare-number
// default (physics-frame wait), just labelled.
//
// `race` and `all` yields are passed through untouched — each child
// generator already labels its own leaves, so there's no useful place
// for an outer reason to attach. Wrap a child explicitly if you want
// its yields labelled.
export function* withYieldReason(
  reason: string,
  inner: Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  for (const v of inner) yield stampReason(v, reason);
}

function stampReason(v: ScriptYield, reason: string): ScriptYield {
  if (typeof v === 'number') return { physicsFrames: v, yieldReason: reason };
  if ('race' in v) return v;
  if ('all' in v) return v;
  if (v.yieldReason !== undefined) return v;
  return { ...v, yieldReason: reason };
}

// --- music starters -------------------------------------------------------

// Request a track and yield until it's actually ticking. `playMusicLoop`
// returns synchronously but the underlying sound starts asynchronously
// (e.g. when the audio context unlocks on first user gesture); these
// helpers wait out that gap so the next stage step can assume music is
// up. Use these in stage scripts instead of calling the raw
// `playMusicLoop` / `playMusicWithIntro` directly.
export function* startMusicLoop(
  key: string,
  opts?: { volume?: number; crossfadeMs?: number; loop?: boolean },
): Generator<ScriptYield, void, void> {
  playMusicLoop(key, opts);
  yield* withYieldReason(`${key} started`, awaitMusicTicking());
}

export function* startMusicWithIntro(
  introKey: string,
  loopKey: string,
  opts?: { volume?: number },
): Generator<ScriptYield, void, void> {
  playMusicWithIntro(introKey, loopKey, opts);
  yield* withYieldReason(`${introKey} started`, awaitMusicTicking());
}

function* awaitMusicTicking(): Generator<ScriptYield, void, void> {
  // Music load happens on the audio thread, asynchronously to physics —
  // a cutscene that swaps tracks runs this poll while physics is paused
  // by the dialog freeze. Use script-frame ticks so the loop keeps
  // checking through the freeze; physics-frame ticks would hang.
  while (getMusicTime() === null) yield { scriptFrames: 1 };
}

// --- generic generator helpers --------------------------------------------

// Convert a duration in seconds to physics-tick frames. Physics runs at
// SCRIPT_FPS, so one round-trip through Math.round is enough — no need
// to poll, no need for a loop.
function framesForSeconds(seconds: number): number {
  return Math.round(seconds * SCRIPT_FPS);
}

// Wait `seconds` of game time. Frame-based — doesn't poll the music
// clock. Yields a single script-frame wait, so the timer keeps ticking
// through dialogue / freeze (same as the music clock it stands in for).
export function* waitSeconds(seconds: number): Generator<ScriptYield, void, void> {
  if (seconds <= 0) return;
  const frames = framesForSeconds(seconds);
  if (frames <= 0) return;
  yield { scriptFrames: frames, yieldReason: `${seconds}s elapsed` };
}

// --- race / timeout -------------------------------------------------------

// Race the given generators in parallel; the first one to finish wins
// and the rest are cancelled. Pure cancellation — callers infer the
// outcome from world state. An empty array resolves on the next frame
// (matching the runner's empty-race behaviour).
export function* race(...iters: Array<Generator<ScriptYield, void, void>>): Generator<ScriptYield, void, void> {
  yield { race: iters };
}

// Run the given generators in parallel; resume the parent only after
// every one of them has finished. Mirror of `race`, but join semantics.
// An empty array resolves on the next frame (matching the runner's
// empty-all behaviour).
export function* all(...iters: Array<Generator<ScriptYield, void, void>>): Generator<ScriptYield, void, void> {
  yield { all: iters };
}

// Run `inner` with a hard time budget. After `seconds` of game time
// (physics frames), whichever finishes first wins; the other is
// cancelled. The waitSeconds racer holds the timeout — if it wins,
// `inner` is dropped mid-flight.
export function* withTimeout(
  seconds: number,
  inner: Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  yield* race(inner, waitSeconds(seconds));
}

// Run `inner` for exactly `seconds` of game time, then verify the field
// has cleared. Inner is cancelled mid-flight if it would run longer; if
// it finishes earlier, the slot is padded out via `waitAudioTimeAtLeast`
// against the start-of-slot music timestamp so the slot still aligns to
// the music seam if a track is playing.
//
// Stragglers — live enemies still on the field when the slot ends — are
// a timing bug, not something this helper is meant to paper over. Every
// wave is expected to be paced so its enemies have exited the playfield
// by the time the slot expires. To keep that invariant loud without
// breaking the rest of the run, we log a `console.error` listing the
// stragglers and then kill them so the next wave inherits a clean
// field. Bullets in flight are out of scope.
//
// Used by stage scripts to give each wave a fixed time slot independent
// of how fast the player kills enemies; the wave's own scripts must
// drive their enemies off-screen before the slot is up.
export function* timeWave(
  self: Entity,
  seconds: number,
  inner: Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  const start = getMusicTime();
  yield* withTimeout(seconds, inner);
  if (start !== null) yield* waitAudioTimeAtLeast(start.time + seconds);
  sweepStragglers(self, seconds);
}

function sweepStragglers(self: Entity, seconds: number): void {
  const stragglers: Entity[] = [];
  for (const child of self.stage.damagedBy.enemy.getChildren()) {
    const e = child as Entity;
    if (e.alive) stragglers.push(e);
  }
  if (stragglers.length === 0) return;
  const summary = stragglers.map((e) => `${e.kind.sprite ?? '?'}@(${Math.round(e.x)},${Math.round(e.y)})`).join(', ');
  console.error(
    `[timeWave] ${stragglers.length} enemy/enemies still on the field after ${seconds}s in wave "${self.stage.wave ?? '?'}": ${summary}. Tighten the wave's exits or extend the slot.`,
  );
  for (const e of stragglers) e.die();
}

// Bracket a "fight" section inside a wave: plants the MC + stops the
// floor (`stage.running = false`), runs `body`, then waits for the
// field to clear of enemies. Body is a generator factory rather than a
// generator so callers can inline it without an IIFE.
//
// Does *not* reset `running` on the way out — that's `separateWave`'s
// job. Every wave is wrapped with `self.stage.separateWave(...)`,
// whose `finally` is the single source of truth for restoring the
// canonical inter-wave state (running / controls / firing / paused /
// collideWorldBounds). Doing it here too would mean two cleanup paths
// to keep in sync, and the inner one would be skipped on a mid-flight
// cancellation (e.g. losing a `timeWave` race) anyway.
export function* suspendRunning(
  self: Entity,
  body: () => Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  self.stage.running = false;
  yield* body();
  yield* waitEnemiesClear(self);
}

// --- audio-clock waits ----------------------------------------------------

// Yield until the current track's clock reaches `t` (seconds, from the
// track's start). Blocks until music is ticking — a wait following a
// music switch naturally pauses through the load gap. Decomposes into
// `realSeconds` waits: compute the gap to target music time, sleep
// that many wall-clock seconds, then re-check the music clock on
// wakeup. Most calls fire once; the loop only re-runs when the music
// clock drifted behind (e.g. ESC pause moved the track start forward
// mid-wait). Returns immediately if the track stops mid-wait.
export function* waitAudioTimeAtLeast(t: number): Generator<ScriptYield, void, void> {
  yield* awaitMusicTicking();
  yield* waitForMusicTimeReach(t, `audio time ${t}s reached`);
}

// Inner loop shared by `waitAudioTimeAtLeast` and the loop-boundary
// path in `waitTrackEnded`. The `reason` is stamped on every
// `realSeconds` yield so the HUD shows the caller's intent (e.g.
// "audio time 8s reached" vs. "loop ended") rather than a generic
// wall-clock label.
function* waitForMusicTimeReach(t: number, reason: string): Generator<ScriptYield, void, void> {
  while (true) {
    const m = getMusicTime();
    if (m === null) return;
    const gap = t - m.time;
    if (gap <= 0) return;
    yield { realSeconds: gap, yieldReason: reason };
  }
}

// Yield until the active one-shot track's natural completion. Loops
// never fire this — `waitTrackEnded` routes loops through a polling
// boundary computation instead. Resolves immediately if no track is
// playing or the track has already finished.
export function* waitMusicComplete(): Generator<ScriptYield, void, void> {
  yield* withYieldReason('song ended', waitMusicCompleteBody());
}

function* waitMusicCompleteBody(): Generator<ScriptYield, void, void> {
  if (isMusicFinished() !== false) return;
  yield { untilMusicEnds: true };
}

// Yield until the current track is at a clean transition point — its
// next loop boundary (for looping tracks) or natural end-of-buffer
// (for one-shots started with `loop: false`). For loops the boundary
// is computed from the call's "now" (so `waitTrackEnded` after some
// other waits snaps to the next boundary at-or-after the call site,
// not some earlier reference point). Resolves immediately when no
// track is playing — safe before any music has started.
export function* waitTrackEnded(): Generator<ScriptYield, void, void> {
  const m = getMusicTime();
  if (m === null) return;
  if (isMusicFinished() === true) return;
  const info = getCurrentTrackInfo();
  if (info === null) return;
  if (info.oneShot) {
    // Innermost-wins: waitMusicComplete's own "song ended" label sticks
    // through, so the HUD shows the more specific reason.
    yield* waitMusicComplete();
    return;
  }
  if (info.loopDuration <= 0) return;
  const start = m.time;
  let nextBoundary: number;
  if (start < info.introDuration) {
    // Activation landed during the intro — first boundary is the intro end.
    nextBoundary = info.introDuration;
  } else {
    const elapsedInLoop = start - info.introDuration;
    const iterations = Math.floor(elapsedInLoop / info.loopDuration) + 1;
    nextBoundary = info.introDuration + iterations * info.loopDuration;
  }
  yield* waitForMusicTimeReach(nextBoundary, 'loop ended');
}

// --- beatmap-driven patterns ---------------------------------------------

// One entry in a beatmap. `t` is the music timestamp (seconds from
// track start) at which `fire` should run; `fire` is a sync callback
// the runtime invokes against the active boss/enemy. Beatmaps are
// authored as plain arrays so a song's structure stays declarative.
export type BeatmapBeat = {
  t: number;
  fire: (self: Entity, index: number) => void;
};

// Walk a beatmap, firing each beat's callback at its target music
// timestamp. Synchronised to `getMusicTime()` via `waitAudioTimeAtLeast`
// so layers stay locked to the track even across small frame hitches.
//
// Beats whose `t` is already in the past at call time are skipped.
// That's the load-bearing detail when phases re-enter a beatmap mid-
// song: a layer that starts in phase 2 should not instant-fire every
// beat from t=0. Compare each beat to the *current* music clock, not
// the call-site's "now".
//
// When no music is playing (practice mode running a wave standalone
// without its parent stage's track), `runBeatmap` falls back to
// relative `waitSeconds` gaps so the pattern remains tunable. The
// fallback loses absolute sync — it's a sanity pass, not a substitute
// for hearing the track.
export function* runBeatmap(
  self: Entity,
  beats: readonly BeatmapBeat[],
): Generator<ScriptYield, void, void> {
  const musicTicking = getMusicTime() !== null;
  let prev = 0;
  for (let i = 0; i < beats.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by beats.length
    const beat = beats[i]!;
    if (musicTicking) {
      const now = getMusicTime();
      if (now !== null && beat.t < now.time) continue;
      yield* waitAudioTimeAtLeast(beat.t);
    } else {
      const gap = beat.t - prev;
      if (gap > 0) yield* waitSeconds(gap);
      prev = beat.t;
    }
    beat.fire(self, i);
  }
}

// Park the calling generator until `self.hp` drops below `threshold`.
// One physics-frame poll per tick; HP only changes on collision so
// the cost is negligible. Used as a phase-end racer:
//   yield* race(...layers, untilHpBelow(self, max * 0.5));
// the racer wins as soon as the boss crosses the threshold, race()
// cancels every layer cleanly, the next phase's race() starts fresh.
export function* untilHpBelow(self: Entity, threshold: number): Generator<ScriptYield, void, void> {
  while ((self.hp ?? 0) > threshold) yield 1;
}

// HP gate that snaps the resolution to the next bar boundary of the
// active music track. Use for phase transitions that should land on
// a musical downbeat instead of the moment HP crossed the threshold.
// `barSeconds` is the duration of one bar in the track (= 4 * BEAT_S);
// `bars` lets you snap to a wider phrase boundary (1 = next bar, 4 =
// next 4-bar phrase). Returns immediately after `untilHpBelow` if no
// music is playing — the snap is a no-op without a clock.
export function* untilHpBelowQuantisedToBar(
  self: Entity,
  threshold: number,
  barSeconds: number,
  bars = 1,
): Generator<ScriptYield, void, void> {
  yield* untilHpBelow(self, threshold);
  const m = getMusicTime();
  if (m === null) return;
  const stride = barSeconds * bars;
  const targetTime = Math.ceil(m.time / stride) * stride;
  yield* waitAudioTimeAtLeast(targetTime);
}

// HP-OR-music phase termination. Resolves on the earlier of:
//  - HP dropping below `hpThreshold`
//  - music time reaching `maxAudioSeconds`
// Used for phases scheduled against a fixed-length track (no loop
// repeats): the music boundary forces progression even if the player
// can't damage fast enough, mirroring the Touhou spell-card-timer
// model.
export function* untilPhaseEnd(
  self: Entity,
  hpThreshold: number,
  maxAudioSeconds: number,
): Generator<ScriptYield, void, void> {
  yield* race(
    untilHpBelow(self, hpThreshold),
    waitAudioTimeAtLeast(maxAudioSeconds),
  );
}

// --- world-state waits ----------------------------------------------------

// Yield until every enemy has died or left the screen. Bullets in
// flight don't count — the `damagedBy.enemy` group has only enemy
// entities. Uses `{ until: e }` for each live enemy in turn, so the
// resume is event-driven (entity death callback) rather than polled.
export function* waitEnemiesClear(self: Entity): Generator<ScriptYield, void, void> {
  yield* withYieldReason('enemies cleared', waitEnemiesClearBody(self));
}

function* waitEnemiesClearBody(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.stage.damagedBy.enemy);
    if (!e) return;
    yield { until: e };
  }
}

// Yield until every non-player entity (enemies and their bullets) has
// died or left the field — i.e. `damages.player` is empty.
export function* waitScreenClear(self: Entity): Generator<ScriptYield, void, void> {
  yield* withYieldReason('screen cleared', waitScreenClearBody(self));
}

function* waitScreenClearBody(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.stage.damages.player);
    if (!e) return;
    yield { until: e };
  }
}

// Yield until a specific entity is dead.
export function* waitEntityDead(e: Entity): Generator<ScriptYield, void, void> {
  if (e.alive) yield { until: e };
}

// Kill every live enemy on the field. Bullets in flight are untouched —
// only `damagedBy.enemy` (the enemy entities themselves) is swept, so
// the playfield retains its in-flight projectiles. die() flips the
// alive flag and fires onDeath; the pool tears the body down on its
// next sweep.
export function killEnemies(self: Entity): void {
  for (const child of self.stage.damagedBy.enemy.getChildren()) {
    const e = child as Entity;
    if (e.alive) e.die();
  }
}

// Symmetric counterpart to `killEnemies`: sweep every in-flight bullet
// while leaving live enemies (and the boss) untouched. Iterates
// `damages.player` — which holds bullets *and* enemies — and partitions
// by `hp === null`, the same trick `bomb.ts` uses (bullet kinds have no
// HP; enemies always do). Useful at phase transitions where the field
// should reset but the boss should survive.
export function clearBullets(self: Entity): void {
  for (const child of self.stage.damages.player.getChildren()) {
    const e = child as Entity;
    if (e.alive && e.hp === null) e.die();
  }
}

// Hard reset of the corridor: kill every live entity on the player-damage
// group — bullets *and* enemies. Stronger than `killEnemies` + `clearBullets`
// in one pass; used at boss-entry beats so leftover crumbs from the
// preceding wave don't smear over the boss's intro dialogue.
export function clearScreen(self: Entity): void {
  for (const child of self.stage.damages.player.getChildren()) {
    const e = child as Entity;
    if (e.alive) e.die();
  }
}

// Standard pre-boss field-clean beat: drain remaining enemies, sweep
// in-flight bullets too, then a half-second of dead air before the boss
// shuffles in. Both stage bosses and the final boss share this opener,
// so callers can `yield* prepareForBoss(self)` instead of repeating the
// three-step dance.
const PRE_BOSS_PAUSE_FRAMES = 30;
export function* prepareForBoss(self: Entity): Generator<ScriptYield, void, void> {
  yield* waitEnemiesClear(self);
  clearScreen(self);
  yield PRE_BOSS_PAUSE_FRAMES;
}

// --- stage-globals scratchpad accessors ----------------------------------

// Set-on-first-call guard scoped to the StageManager's lifetime. True the
// first time it's called for `key`; false thereafter. The manager resets
// on scene transition, so demo waves and stage runs each get a fresh
// slate.
export function checkStageOnce(self: Entity, key: string): boolean {
  const globals = self.stage.globals;
  if (globals[key]) return false;
  globals[key] = true;
  return true;
}

// Counter variant: true for the first `max` calls under `key`; false
// thereafter.
export function checkStageCount(self: Entity, key: string, max: number): boolean {
  const globals = self.stage.globals;
  const n = (globals[key] as number | undefined) ?? 0;
  if (n >= max) return false;
  globals[key] = n + 1;
  return true;
}

// First live (alive === true) entity in a Phaser physics group, or null.
// Used by the wait helpers and by ad-hoc consumers (e.g. clearScreen).
export function firstLive(group: Phaser.Physics.Arcade.Group): Entity | null {
  for (const child of group.getChildren()) {
    const e = child as Entity;
    if (e.alive) return e;
  }
  return null;
}

// --- door routing --------------------------------------------------------
//
// The corridor's three door slots are the only places enemies should
// enter or leave the playfield via the side walls. Their y values cycle
// with `stage.bgScrollY` (mirrored from GameScene each frame), so a
// script can read them and either snap to whatever's available or, when
// the corridor is still scrolling between waves, wait for one to slide
// into a target band before pinning the corridor for the encounter.

// Pick the centre y of the visible door whose centre is closest to
// `idealY`. Returns null only if every door slot is fully off-canvas at
// the moment — which can't happen with three slots on a 660px field but
// the null path keeps callers honest. Door panels are 80px tall with
// origin (0, 0); the centre is `topY + DOOR_H/2`.
export function pickDoorCenterY(self: Entity, idealY: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const top of computeDoorYs(self.stage.bgScrollY)) {
    if (!isDoorVisible(top)) continue;
    const center = top + DOOR_H / 2;
    const d = Math.abs(center - idealY);
    if (d < bestDist) {
      bestDist = d;
      best = center;
    }
  }
  return best;
}

// Yield until a door's centre is within `tolerance` pixels of `targetY`.
// The corridor must be scrolling for the doors to move, so this is meant
// to be called BEFORE `suspendRunning` — once the wave plants, doors stay
// where they are. Resolves immediately if a door is already in range.
//
// Use when a wave needs an entry door at a specific y; for waves that
// can adapt to whatever doors are visible, just call `doorY` /
// `pickDoorCenterY` directly without aligning first.
//
// Default tolerance of 32 keeps the worst-case wait under ~2s at the
// 100 px/s baseline scroll rate (DOOR_SPACING ≈ 247, window = 2*tol =
// 64 → max gap (247-64)/100 ≈ 1.83s). Tighter tolerances stretch the
// wait quadratically; pass a smaller value only when the wave can
// afford the extra dead air.
export function* alignDoor(self: Entity, targetY: number, tolerance = 32): Generator<ScriptYield, void, void> {
  yield* withYieldReason(`door at y≈${targetY}`, alignDoorBody(self, targetY, tolerance));
}

function* alignDoorBody(self: Entity, targetY: number, tolerance: number): Generator<ScriptYield, void, void> {
  while (true) {
    const y = pickDoorCenterY(self, targetY);
    if (y !== null && Math.abs(y - targetY) <= tolerance) return;
    yield 1;
  }
}

// X coordinate just outside the side wall — the canonical entry / exit
// point for an enemy stepping through a door. `side = -1` is the left
// wall, `side = +1` is the right wall.
export function sideSpawnX(side: -1 | 1): number {
  return side < 0 ? -30 : GAME_W + 30;
}

// Pick the visible door centre closest to `idealY`, falling back to
// `idealY` if no door is currently in range. Use this as the y for a
// side-entry spawn so the enemy reads as walking out through a panel.
// Pair with `alignDoor` before `suspendRunning` if a wave needs the
// fallback to never trigger.
export function doorY(self: Entity, idealY: number): number {
  return pickDoorCenterY(self, idealY) ?? idealY;
}

// Walk to the door y closest to the entity's current y, then drift off
// `side` (-1 left, +1 right) at `speed`. Falls back to a straight
// horizontal exit at the current y if no door is visible — the pool
// still culls the entity off the far edge. Use this for any enemy whose
// final beat is a side-exit, so the visual reads as "they left through a
// door" instead of clipping through the wall.
export function* exitThroughSideDoor(self: Entity, side: -1 | 1, speed: number): Generator<ScriptYield, void, void> {
  const exitY = pickDoorCenterY(self, self.y);
  if (exitY !== null && Math.abs(exitY - self.y) > 1) {
    yield* moveTo(self, self.x, exitY, speed);
  }
  self.setVelocity(side * speed, 0);
}

// Variant of `exitThroughSideDoor` that always routes through the next
// visible door downscreen of the entity (i.e. closer to the player), not
// the closest one in either direction. Use for enemies whose entry
// motion is "marching forward into the playfield" — sending them back
// up through the door they came from would read as a retreat the
// character isn't doing. Falls back to `exitThroughSideDoor` (closest
// door) if no door is currently below the entity.
export function* exitThroughForwardDoor(self: Entity, side: -1 | 1, speed: number): Generator<ScriptYield, void, void> {
  const exitY = pickDoorCenterYForward(self, self.y);
  if (exitY === null) {
    yield* exitThroughSideDoor(self, side, speed);
    return;
  }
  if (Math.abs(exitY - self.y) > 1) {
    yield* moveTo(self, self.x, exitY, speed);
  }
  self.setVelocity(side * speed, 0);
}

// Pick the centre y of the nearest visible door whose centre sits at
// or below `fromY` (i.e. the next door the entity would reach by
// continuing forward into the playfield). Returns null if every visible
// door is above `fromY`.
function pickDoorCenterYForward(self: Entity, fromY: number): number | null {
  let best: number | null = null;
  for (const top of computeDoorYs(self.stage.bgScrollY)) {
    if (!isDoorVisible(top)) continue;
    const center = top + DOOR_H / 2;
    if (center < fromY) continue;
    if (best === null || center < best) best = center;
  }
  return best;
}
