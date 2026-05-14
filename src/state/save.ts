// Auto-save / continue surface backing the menu's CONTINUE button.
//
// The save snapshot captures: the wave the player most recently entered
// (or died on), the run-wide GameScore counters, and the music position
// at the moment of snapshot. On continue, GameScene rehydrates the
// score into a fresh `StageManager`, builds an entry-point stage script
// from `WAVE_BY_ID[snapshot.waveId]`, and starts music at the saved
// offset with a 500ms fade-in.
//
// One slot — overwritten on every save trigger. The triggers are:
//   1. `markReached(self, id)` in content/stage.ts when a real-stage
//      run enters a new wave.
//   2. GameScene's death paths (continue overlay opens, or the
//      practice-less death sequence kicks off).
// Practice / test runs never save (gated at trigger site).
//
// localStorage may throw in private-mode browsers; every read/write is
// wrapped so the menu and gameplay degrade gracefully (continue button
// just won't appear).

import { getCurrentTrackInfo, getMusicTime } from '../audio/music/loop';
import type { GameScore } from '../script/score';

export const SAVE_KEY = 'office-hell:save:state';

// Schema versioning so a save written by an older build doesn't crash
// a newer one — if `version` doesn't match we treat the slot as empty.
// Bump when the shape of `SavedGameState` changes. v2 changes
// `SavedMusic.time` from absolute music time to a loop-buffer offset;
// reading a v1 save's `time` as a buffer offset would seek a track
// with an intro to the wrong loop position, so we drop the slot
// entirely on the version bump.
const SAVE_VERSION = 2;

export type SavedScore = {
  score: number;
  mult: number;
  kills: number;
  bombs: number;
  hpLost: number;
  continues: number;
  bullets: number;
};

export type SavedMusic = {
  key: string;
  // Position **within the loop buffer**, in seconds, i.e.
  // `(getMusicTime().time - introDuration) mod loopDuration`. Used
  // as the `seek` argument when resuming the loop track on continue.
  //
  // Stored as a buffer offset (not the absolute track clock) so the
  // restore path's `waitTrackEnded` boundary math lines up: the
  // restored loop has `introDuration = 0`, and saving an absolute
  // time would otherwise make wave-end music time cross loop
  // boundaries at totally different points than the live chain,
  // leaving the script parked on a 40+ second wait for a loop
  // boundary while the field sits empty. With a buffer offset, the
  // restored loop boundary computation matches the live chain's
  // (modulo the missing intro segment, which only adds a small
  // constant offset).
  time: number;
};

export type SavedGameState = {
  version: number;
  waveId: string;
  score: SavedScore;
  music: SavedMusic | null;
  savedAt: number;
};

export function hasSave(): boolean {
  return loadSaveState() !== null;
}

export function loadSaveState(): SavedGameState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    // localStorage unavailable (private mode, sandbox, SSR). No save.
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedGameState>;
    if (parsed.version !== SAVE_VERSION) return null;
    if (typeof parsed.waveId !== 'string') return null;
    if (parsed.score === null || typeof parsed.score !== 'object') return null;
    return parsed as SavedGameState;
  } catch {
    // Corrupt JSON — treat as no save and let a future write overwrite it.
    return null;
  }
}

export function saveSnapshot(state: SavedGameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // localStorage write failed (quota, private mode). Continue button
    // won't appear next session — that's the best we can do.
  }
}

export function clearSaveState(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore — see saveSnapshot.
  }
}

// Build a `SavedScore` from a live `GameScore`. Plain field copy; kept
// here so call sites in different modules don't all need to know the
// list of fields (mirrors the comment in `SavedScore`).
export function snapshotScore(score: GameScore): SavedScore {
  return {
    score: score.score,
    mult: score.mult,
    kills: score.kills,
    bombs: score.bombs,
    hpLost: score.hpLost,
    continues: score.continues,
    bullets: score.bullets,
  };
}

// Mutate a live `GameScore` in place from a saved snapshot. Used on
// continue to seed the run before the stage script begins ticking.
export function restoreScore(score: GameScore, snap: SavedScore): void {
  score.score = snap.score;
  score.mult = snap.mult;
  score.kills = snap.kills;
  score.bombs = snap.bombs;
  score.hpLost = snap.hpLost;
  score.continues = snap.continues;
  score.bullets = snap.bullets;
}

// Convenience: build a complete `SavedGameState` from current run
// inputs. The save-trigger sites (`markReached`, GameScene death paths)
// call this rather than constructing the shape inline.
export function makeSnapshot(opts: { waveId: string; score: GameScore; music: SavedMusic | null }): SavedGameState {
  return {
    version: SAVE_VERSION,
    waveId: opts.waveId,
    score: snapshotScore(opts.score),
    music: opts.music,
    savedAt: Date.now(),
  };
}

// Snapshot the live music position as a loop-buffer offset (the form
// `SavedMusic.time` is defined to hold). Reads `getMusicTime()` and
// `getCurrentTrackInfo()` directly so callers don't have to thread
// either through their own state. Returns null when no track is
// playing — the resume path handles that by leaving music to start
// fresh on the wave's own `startMusicLoop` call.
export function snapshotMusic(): SavedMusic | null {
  const mt = getMusicTime();
  if (mt === null) return null;
  const info = getCurrentTrackInfo();
  // No info / zero loop length means we can't normalise — fall back
  // to "no music" rather than write a stale absolute time the restore
  // path will misinterpret. Practically this only fires on one-shot
  // tracks (the kaedalus intro / ending opening), where the right
  // answer is "skip the intro on resume" anyway.
  if (info === null || info.loopDuration <= 0) return null;
  const introDur = info.introDuration;
  const loopDur = info.loopDuration;
  const elapsed = Math.max(0, mt.time - introDur);
  const offset = ((elapsed % loopDur) + loopDur) % loopDur;
  return { key: mt.key, time: offset };
}
