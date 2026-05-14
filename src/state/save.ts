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

import type { GameScore } from '../script/score';

export const SAVE_KEY = 'office-hell:save:state';

// Schema versioning so a save written by an older build doesn't crash
// a newer one — if `version` doesn't match we treat the slot as empty.
// Bump when the shape of `SavedGameState` changes.
const SAVE_VERSION = 1;

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
  // Seconds since track start, sourced from `getMusicTime()` at save
  // time. Used as `seek` when resuming the loop track on continue.
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
