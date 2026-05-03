// Declarative stage definitions: a stage is an ordered queue of entries,
// each gated by a list of filters. The runner walks front-to-back, blocking
// on each entry until all its filters return true, then firing the action.
//
// This is an alternative to the imperative generator-style stage in
// content/stage.ts. The two coexist; new stages (like testStage) prefer the
// queue model for clarity, and the imperative stage can migrate later if it
// makes sense.

import type Phaser from 'phaser';
import { getCurrentTrackInfo, getMusicTime, isMusicFinished } from '../audio/music/loop';
import type { Entity } from '../entities/Entity';
import type { ScriptYield } from './types';

export type StageFilter = {
  // Short, HUD-friendly description of the gate (e.g. "t≥20.0s" or
  // "enemies clear"). Surfaced in the debug HUD's `blocked: ...` segment so
  // the user sees exactly which gates are pending.
  label: string;
  // True when this filter is satisfied right now. Polled once per frame.
  ready: (self: Entity) => boolean;
};

export type StageEntryKind = 'spawn' | 'dialog' | 'music' | 'misc';

export type StageEntry = {
  // For HUD/debug display. The `next: ...` HUD segment shows this name.
  name: string;
  // Discriminator so the HUD can scan ahead for the next entry of a given
  // kind ("next wave" = next 'spawn' entry, etc.).
  kind: StageEntryKind;
  // All must report ready before action fires.
  filters: StageFilter[];
  // Action runs once filters are satisfied. May be a sync function or a
  // generator (for multi-step actions like dialog or boss entry sequences).
  action: (self: Entity) => void | Generator<ScriptYield, void, void>;
};

export type StageQueue = StageEntry[];

// Snapshot read by the debug HUD. Null when no queue is currently running.
export type StageState = {
  queue: StageQueue;
  index: number;
  current: StageEntry | null;
  pendingFilters: string[];
  // Audio time (seconds, from current track start) at which the previous
  // entry's action returned. Null at queue start, becomes null again after
  // a music switch entry until the new track is reported playing. Used by
  // the `audioGap(s)` filter to gate "N seconds since the last entry fired".
  lastFireAudioTime: number | null;
  // Audio time at which the *current* entry became the cursor (i.e. when
  // its filters started polling). Used by `trackEnded` to compute the next
  // loop-boundary >= this point — that boundary is fixed for the entry,
  // not chased forward as the entry waits.
  currentEntryActivatedAt: number | null;
};

let _state: StageState | null = null;

export function getStageState(): StageState | null {
  return _state;
}

// Find the next entry from the current cursor of the given kind, or null if
// none remain. Used by the HUD to surface "next wave" / "next dialog" etc.
export function nextEntryOfKind(kind: StageEntryKind): StageEntry | null {
  if (!_state) return null;
  for (let i = _state.index; i < _state.queue.length; i++) {
    const entry = _state.queue[i];
    if (entry && entry.kind === kind) return entry;
  }
  return null;
}

// First entry of `kind` whose filters include an `audioTimeAtLeast` — used
// for "next wave @28.0s" HUD readout. We pull the audio time off the filter
// label rather than the filter object so the queue stays purely data.
export function audioTimeFromEntry(entry: StageEntry): number | null {
  for (const f of entry.filters) {
    const m = /t≥([\d.]+)s/.exec(f.label);
    if (m) return Number.parseFloat(m[1] ?? '');
  }
  return null;
}

export function* runStageQueue(
  self: Entity,
  queue: StageQueue,
): Generator<ScriptYield, void, void> {
  _state = {
    queue,
    index: 0,
    current: null,
    pendingFilters: [],
    lastFireAudioTime: null,
    currentEntryActivatedAt: null,
  };
  try {
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (!entry) continue;
      _state.index = i;
      _state.current = entry;
      _state.currentEntryActivatedAt = getMusicTime()?.time ?? null;

      // Poll filters once per frame. Cheap, and matches the cadence of
      // existing frame-counted scripts. While a dialog is open, pool.update
      // early-returns so this generator is paused too — music time keeps
      // advancing in the background, so any time-based filter automatically
      // catches up the moment the dialog closes.
      while (true) {
        const pending: string[] = [];
        for (const f of entry.filters) {
          if (!f.ready(self)) pending.push(f.label);
        }
        _state.pendingFilters = pending;
        if (pending.length === 0) break;
        yield 1;
      }

      const result = entry.action(self);
      if (result !== undefined && typeof (result as Generator).next === 'function') {
        yield* result as Generator<ScriptYield, void, void>;
      }
      // Stamp the audio clock for the next entry's audioGap. May be null if
      // music isn't playing (e.g. action was a music switch and the new
      // track hasn't started yet) — audioGap will block until music is up.
      _state.lastFireAudioTime = getMusicTime()?.time ?? null;
    }
  } finally {
    _state = null;
  }
}

// Wait `seconds` of audio time from now. Captures the current music time
// once and yields until that target elapses. Falls back to a frame-based
// yield (60fps) when no track is playing — important for practice mode and
// for the pre-music pause beats in stageScript.
export function* waitAudioSeconds(seconds: number): Generator<ScriptYield, void, void> {
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

// --- filters ---------------------------------------------------------------

export const audioTimeAtLeast = (t: number): StageFilter => ({
  label: `t≥${t.toFixed(1)}s`,
  ready: () => {
    const m = getMusicTime();
    // Strict null check: if no track is playing yet, the filter is NOT
    // satisfied — even for `audioTimeAtLeast(0)`. This is how a wave entry
    // following a music-switch entry naturally waits for the new track to
    // start before the audio clock begins ticking.
    return m !== null && m.time >= t;
  },
});

export const musicReady: StageFilter = {
  label: 'music ready',
  ready: () => getMusicTime() !== null,
};

// Gate: at least `seconds` of audio time have elapsed since the previous
// queue entry's action returned. Replaces frame-counted gaps between waves
// — naturally pauses through dialogs (music keeps playing) and freezes
// during music-switch downtime (lastFireAudioTime is null until the new
// track starts). Don't put on the very first entry — there's no "previous"
// for it to gate against and it would block forever.
export const audioGap = (seconds: number): StageFilter => ({
  label: `+${seconds.toFixed(1)}s`,
  ready: () => {
    const m = getMusicTime();
    const last = _state?.lastFireAudioTime;
    if (last == null || m === null) return false;
    return m.time >= last + seconds;
  },
});

// Gate: wait until the currently-playing track is at a clean transition
// point — either its next loop boundary (for looping tracks) or natural
// end-of-buffer (for one-shot tracks started with `loop: false`). Snapping
// music switches to this filter prevents hard cuts in the middle of a bar
// for loops, and lets a one-shot drive the schedule by simply ending.
//
// For loops: boundary is computed once when the entry first becomes current
// (next iteration end at-or-after that activation point), so combining
// with audioGap behaves as `wait MAX(audioGap, trackEnded)`.
//
// Returns true when no track is playing (nothing to wait for) so this can be
// safely added to the very first music entry of a stage.
export const trackEnded: StageFilter = {
  label: 'track end',
  ready: () => {
    const m = getMusicTime();
    if (m === null) return true;
    // One-shot tracks: ready when the sound's 'complete' event has fired.
    // No need for boundary math — there's no loop to align to.
    if (isMusicFinished() === true) return true;
    const info = getCurrentTrackInfo();
    if (info === null || info.loopDuration <= 0) return true;
    const start = _state?.currentEntryActivatedAt;
    if (start == null) return true;

    let nextBoundary: number;
    if (start < info.introDuration) {
      // Activation landed during the intro — first boundary is the intro end.
      nextBoundary = info.introDuration;
    } else {
      const elapsedInLoop = start - info.introDuration;
      const iterations = Math.floor(elapsedInLoop / info.loopDuration) + 1;
      nextBoundary = info.introDuration + iterations * info.loopDuration;
    }
    return m.time >= nextBoundary;
  },
};

export const enemiesClear: StageFilter = {
  label: 'enemies clear',
  ready: (self) => firstLive(self.pool.damagedBy.enemy) === null,
};

export const screenClear: StageFilter = {
  label: 'screen clear',
  ready: (self) => firstLive(self.pool.damages.player) === null,
};

export const entityDead = (e: Entity): StageFilter => ({
  label: 'entity dead',
  ready: () => !e.alive,
});

// First live (alive === true) entity in a Phaser physics group, or null.
// Mirrors the helper in content/stage.ts; centralising it here lets the
// filter library and stage scripts share a single implementation.
export function firstLive(group: Phaser.Physics.Arcade.Group): Entity | null {
  for (const child of group.getChildren()) {
    const e = child as Entity;
    if (e.alive) return e;
  }
  return null;
}
