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
import type { Entity } from '../entities/Entity';
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
// `{ frames: n, yieldReason: reason }` — same scheduling, just labelled.
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
  if (typeof v === 'number') return { frames: v, yieldReason: reason };
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
  while (getMusicTime() === null) yield 1;
}

// --- generic generator helpers --------------------------------------------

// Adaptive polling step toward an absolute audio-time `target`. Returns
// the number of frames to yield before re-checking: coarsely sleeps the
// bulk of the remaining duration, then refines to 1-frame polling on
// the final approach. The 2-frame safety margin keeps a slow frame from
// overshooting; rAF is locked at 60Hz so frames-per-second never
// exceeds the 60 we scale by, only undershoots.
function framesUntilAudioTime(curTime: number, target: number): number {
  const remaining = target - curTime;
  if (remaining <= 0.05) return 1;
  return Math.max(1, Math.round(remaining * 60) - 2);
}

// Wait `seconds` of audio time from now. Captures the current music
// time once and yields until that target elapses. Falls back to a
// frame-based yield (60fps) when no track is playing — important for
// practice mode and for the pre-music pause beats.
export function* waitSeconds(seconds: number): Generator<ScriptYield, void, void> {
  yield* withYieldReason(`${seconds}s elapsed`, waitSecondsBody(seconds));
}

function* waitSecondsBody(seconds: number): Generator<ScriptYield, void, void> {
  if (seconds <= 0) return;
  const m = getMusicTime();
  if (m === null) {
    yield Math.max(1, Math.round(seconds * 60));
    return;
  }
  const target = m.time + seconds;
  while (true) {
    const cur = getMusicTime();
    // If music stops/changes mid-wait, bail rather than block forever.
    if (cur === null || cur.time >= target) return;
    yield framesUntilAudioTime(cur.time, target);
  }
}

// --- race / timeout -------------------------------------------------------

// Race the given generators in parallel; the first one to finish wins
// and the rest are cancelled. Pure cancellation — callers infer the
// outcome from world state. An empty array resolves on the next frame
// (matching the runner's empty-race behaviour).
export function* race(...iters: Array<Generator<ScriptYield, void, void>>): Generator<ScriptYield, void, void> {
  yield { race: iters };
}

// Run `inner` with a hard time budget. After `seconds` of audio time
// (frame-fallback when no music is playing), whichever finishes first
// wins; the other is cancelled. The waitSeconds racer holds the timeout
// — if it wins, `inner` is dropped mid-flight.
export function* withTimeout(
  seconds: number,
  inner: Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  yield* race(inner, waitSeconds(seconds));
}

// Run `inner` for exactly `seconds` of audio time, then sweep any
// surviving enemies off the field. Inner is cancelled mid-flight if it
// would run longer; if it finishes earlier, the slot is padded out via
// `waitAudioTimeAtLeast` against the start-of-slot timestamp. Bullets
// in flight are left alone — only `damagedBy.enemy` (the enemy entities
// themselves) is cleared, so the next slot inherits a half-busy field
// rather than a hard reset.
//
// Used by stage scripts to give each wave a fixed audio-time slot
// independent of how fast the player kills enemies or whether spawned
// enemies linger off-screen — completion gates only on the timer.
export function* timeWave(
  self: Entity,
  seconds: number,
  inner: Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  const start = getMusicTime();
  yield* withTimeout(seconds, inner);
  if (start !== null) yield* waitAudioTimeAtLeast(start.time + seconds);
  killEnemies(self);
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
// track's start). Strict null check on music — never resolves while
// `getMusicTime()` is null, even for `waitAudioTimeAtLeast(0)`. That's
// how a wait following a music switch naturally blocks until the new
// track has started ticking.
export function* waitAudioTimeAtLeast(t: number): Generator<ScriptYield, void, void> {
  yield* withYieldReason(`audio time ${t}s reached`, waitAudioTimeAtLeastBody(t));
}

function* waitAudioTimeAtLeastBody(t: number): Generator<ScriptYield, void, void> {
  while (true) {
    const m = getMusicTime();
    if (m === null) {
      yield 1;
      continue;
    }
    if (m.time >= t) return;
    yield framesUntilAudioTime(m.time, t);
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
  yield* withYieldReason('loop ended', waitTrackEndedBody());
}

function* waitTrackEndedBody(): Generator<ScriptYield, void, void> {
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
  while (true) {
    const cur = getMusicTime();
    if (cur === null || cur.time >= nextBoundary) return;
    yield framesUntilAudioTime(cur.time, nextBoundary);
  }
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
