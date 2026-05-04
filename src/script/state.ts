// Stage scripts are plain generator functions composed with `yield*`.
// There is no queue, no entries, no filters — sequential execution comes
// from the generator runtime, gating from `wait*` helpers, and HUD
// labelling from `markBeat`. State is a small per-run scratchpad parked
// on `pool.stage` for entity scripts spawned mid-stage to reach.

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

// Per-run state attached to `pool.stage` while a stage runs. `globals`
// is the scratchpad used by `checkStageOnce` / `checkStageCount`. `beat`
// is the human-readable label the GameScene HUD shows; updated by
// `markBeat(self, name)`.
export type StageState = {
  globals: Record<string, unknown>;
  beat: string | null;
};

// Higher-order entry point. Park a fresh `StageState` on `pool.stage`,
// run `body`, then clear `pool.stage` in `finally`. Use this in the
// `defaultScript` of a stage `EntityKind`:
//
//   defaultScript: (self) => runStage(self, function* (self) {
//     markBeat(self, 'intro');
//     yield* introMonologue(self);
//     ...
//   })
export function* runStage(
  self: Entity,
  body: (self: Entity) => Generator<ScriptYield, void, void>,
): Generator<ScriptYield, void, void> {
  self.pool.stage = { globals: {}, beat: null };
  try {
    yield* body(self);
  } finally {
    self.pool.stage = null;
  }
}

// Set the HUD's current-beat label. Pure side-effect, not a generator —
// callers don't `yield*` it.
export function markBeat(self: Entity, name: string): void {
  const state = self.pool.stage;
  if (state) state.beat = name;
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
  while (getMusicTime() === null) yield 1;
}

export function* startMusicWithIntro(
  introKey: string,
  loopKey: string,
  opts?: { volume?: number },
): Generator<ScriptYield, void, void> {
  playMusicWithIntro(introKey, loopKey, opts);
  while (getMusicTime() === null) yield 1;
}

// --- generic generator helpers --------------------------------------------

// Wait `seconds` of audio time from now. Captures the current music
// time once and yields until that target elapses. Falls back to a
// frame-based yield (60fps) when no track is playing — important for
// practice mode and for the pre-music pause beats.
export function* waitSeconds(seconds: number): Generator<ScriptYield, void, void> {
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
    yield 1;
  }
}

// --- audio-clock waits ----------------------------------------------------

// Yield until the current track's clock reaches `t` (seconds, from the
// track's start). Strict null check on music — never resolves while
// `getMusicTime()` is null, even for `waitAudioTimeAtLeast(0)`. That's
// how a wait following a music switch naturally blocks until the new
// track has started ticking.
export function* waitAudioTimeAtLeast(t: number): Generator<ScriptYield, void, void> {
  while (true) {
    const m = getMusicTime();
    if (m !== null && m.time >= t) return;
    yield 1;
  }
}

// Yield until the active one-shot track's natural completion. Loops
// never fire this — `waitTrackEnded` routes loops through a polling
// boundary computation instead. Resolves immediately if no track is
// playing or the track has already finished.
export function* waitMusicComplete(): Generator<ScriptYield, void, void> {
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
    yield 1;
  }
}

// --- world-state waits ----------------------------------------------------

// Yield until every enemy has died or left the screen. Bullets in
// flight don't count — the `damagedBy.enemy` group has only enemy
// entities. Uses `{ until: e }` for each live enemy in turn, so the
// resume is event-driven (entity death callback) rather than polled.
export function* waitEnemiesClear(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.pool.damagedBy.enemy);
    if (!e) return;
    yield { until: e };
  }
}

// Yield until every non-player entity (enemies and their bullets) has
// died or left the field — i.e. `damages.player` is empty.
export function* waitScreenClear(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const e = firstLive(self.pool.damages.player);
    if (!e) return;
    yield { until: e };
  }
}

// Yield until a specific entity is dead.
export function* waitEntityDead(e: Entity): Generator<ScriptYield, void, void> {
  if (e.alive) yield { until: e };
}

// --- per-stage scratchpad accessors --------------------------------------

// Helpers for entity scripts spawned mid-stage that aren't directly
// given state — they fish it off the pool. Returns true when no stage
// is running (demo waves spawn a single wave with no surrounding
// stage), so the demo path still gets the full single-shot behaviour.
export function checkStageOnce(self: Entity, key: string): boolean {
  const state = self.pool.stage;
  if (state === null) return true;
  if (state.globals[key]) return false;
  state.globals[key] = true;
  return true;
}

export function checkStageCount(self: Entity, key: string, max: number): boolean {
  const state = self.pool.stage;
  if (state === null) return true;
  const n = (state.globals[key] as number | undefined) ?? 0;
  if (n >= max) return false;
  state.globals[key] = n + 1;
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
