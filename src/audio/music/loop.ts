// Scene-independent music playback so loops survive scene transitions
// (menu → character select → test menu all share the same menu loop;
// stage music persists across cutscenes inside GameScene).
//
// Three playback modes:
//   - playMusicLoop(key)                       single sound, loop: true
//   - playMusicLoop(key, { crossfadeMs: N })   two ping-ponging sounds with
//                                              N ms overlap on each wrap
//   - playMusicWithIntro(intro, loop)          intro plays once, loop scheduled
//                                              to start sample-accurately at
//                                              the intro's end (loop: true)
//
// Sample-accurate looping requires Vorbis (.ogg) sources — MP3 prepends
// ~1100 priming samples that would click at the seam. The intro→loop
// hand-off uses Phaser's `delay` config which schedules via Web Audio's
// AudioContext.currentTime, so the seam is also gapless.
//
// Why crossfade if Vorbis is gapless? Because the menu loop is (by design)
// listened to for minutes at a stretch, and a perceptible "wrap" — even
// with a clean musical seam — gets noticeable. A 1s crossfade dissolves
// the boundary entirely.

import Phaser from 'phaser';
import { musicBus, routeSound } from '../buses';

// Set to `true` to dump a step-by-step trace of every pause / resume /
// track-swap interaction to the dev console. Each line is prefixed
// `[music]` so it's easy to filter (`tag:music` in DevTools, or `grep`
// over a saved log). Leave off in normal play — emits per-frame data.
const DEBUG_MUSIC = true;
function mlog(...args: unknown[]): void {
  if (!DEBUG_MUSIC) return;
  console.log('[music]', ...args);
}
function nowMs(): number {
  return typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
}
function snapshotSound(sound: Phaser.Sound.BaseSound | null): Record<string, unknown> | null {
  if (!sound) return null;
  const ws = sound as unknown as {
    key?: string;
    isPlaying?: boolean;
    isPaused?: boolean;
    startTime?: number;
    playTime?: number;
    duration?: number;
    totalDuration?: number;
    hasEnded?: boolean;
    hasLooped?: boolean;
    currentConfig?: { seek?: number; loop?: boolean; delay?: number };
  };
  return {
    key: ws.key,
    isPlaying: ws.isPlaying,
    isPaused: ws.isPaused,
    startTime: ws.startTime,
    playTime: ws.playTime,
    duration: ws.duration,
    totalDuration: ws.totalDuration,
    hasEnded: ws.hasEnded,
    hasLooped: ws.hasLooped,
    cfgSeek: ws.currentConfig?.seek,
    cfgLoop: ws.currentConfig?.loop,
    cfgDelay: ws.currentConfig?.delay,
  };
}

let _sm: Phaser.Sound.BaseSoundManager | null = null;

export function setMusicManager(sm: Phaser.Sound.BaseSoundManager): void {
  _sm = sm;
}

type LoopState = {
  key: string;
  // One sound for non-crossfaded loops (loop: true on Phaser side); two
  // sounds for crossfaded loops, ping-ponging via manual scheduling.
  sounds: Phaser.Sound.BaseSound[];
  intro: Phaser.Sound.BaseSound | null;
  // Active timer for the next ping-pong wrap, only set on crossfaded loops.
  scheduled: ReturnType<typeof setTimeout> | null;
  // True for tracks started with `loop: false`. Consumers (`waitTrackEnded`,
  // `onceMusicComplete`) branch on this so they can fire the moment the
  // one-shot finishes rather than chasing a never-arriving loop boundary.
  oneShot: boolean;
  // Set to true by the sound's 'complete' handler when a one-shot finishes.
  // `getMusicTime()` keeps returning post-complete time (so audio-time gates
  // resolve naturally), but `isMusicFinished()` flips true.
  finished: boolean;
  // One-shot completion listeners. Fired exactly once each, at the moment
  // the underlying sound's COMPLETE event lands. Cleared on track swap so a
  // listener registered against the previous track never fires for a later
  // one. Empty for loop-mode tracks — they never complete naturally.
  onComplete: (() => void)[];
};

let current: LoopState | null = null;
// Set to audioCtx.currentTime the moment the active track's first sound
// actually starts playing. Reset to null when a new track is requested so
// `getMusicTime()` correctly reports "not playing yet" while loading or
// waiting for context unlock. Not bumped on subsequent ping-pong wraps —
// the clock keeps advancing across the loop boundary.
let trackStartCtxTime: number | null = null;

// Pause-menu state. `pauseMusic` snapshots the audio-context clock here so
// `resumeMusic` can shift `trackStartCtxTime` forward by the pause duration
// — `getMusicTime()` is computed against the (un-suspendable) AudioContext
// clock, so without the shift it would advance during the pause and waits
// gated on audio time would skip ahead on resume.
let pausedAtCtxTime: number | null = null;

// Two independent reasons we may be paused. The actual `sound.pause()` call
// happens once when either flag flips on with both clear; the actual
// `sound.resume()` call happens once when both flags are clear again. This
// way GameScene's user-pause (manual) and the window-blur auto-pause can
// stack without fighting: blurring during the pause overlay doesn't double-
// pause, and focusing while the overlay is up doesn't accidentally resume.
let manualPaused = false;
let autoPaused = false;

const DEFAULT_VOL = 0.5;

export function playMusicLoop(key: string, opts: { volume?: number; crossfadeMs?: number; loop?: boolean } = {}): void {
  mlog('playMusicLoop: enter', {
    t: nowMs(),
    key,
    opts,
    currentKey: current?.key ?? null,
    manualPaused,
    autoPaused,
  });
  if (!_sm) {
    mlog('playMusicLoop: no sound manager');
    return;
  }
  if (current?.key === key) {
    mlog('playMusicLoop: idempotent, same key already current');
    return;
  }
  stopMusicLoop();
  trackStartCtxTime = null;

  const volume = opts.volume ?? DEFAULT_VOL;
  const crossfadeMs = opts.crossfadeMs ?? 0;
  const loop = opts.loop ?? true;

  if (!loop) {
    // One-shot: play through once and stop. `waitTrackEnded` fires when the
    // sound completes; current.key + getMusicTime() stay live so subsequent
    // entries can still gate against this track's clock if they want.
    playOneShot(key, volume);
  } else if (crossfadeMs <= 0) {
    playLoopSimple(key, volume);
  } else {
    playLoopCrossfaded(key, volume, crossfadeMs);
  }
}

function playLoopSimple(key: string, volume: number): void {
  // biome-ignore lint/style/noNonNullAssertion: caller guarded
  const sm = _sm!;
  const sound = sm.add(key, { loop: true, volume });
  if (musicBus) routeSound(sound, musicBus);

  const start = (): void => {
    sound.play();
    trackStartCtxTime = musicBus?.context.currentTime ?? null;
  };
  if (sm.locked) sm.once(Phaser.Sound.Events.UNLOCKED, start);
  else start();

  current = {
    key,
    sounds: [sound],
    intro: null,
    scheduled: null,
    oneShot: false,
    finished: false,
    onComplete: [],
  };
}

function playOneShot(key: string, volume: number): void {
  // biome-ignore lint/style/noNonNullAssertion: caller guarded
  const sm = _sm!;
  const sound = sm.add(key, { loop: false, volume });
  if (musicBus) routeSound(sound, musicBus);

  const state: LoopState = {
    key,
    sounds: [sound],
    intro: null,
    scheduled: null,
    oneShot: true,
    finished: false,
    onComplete: [],
  };

  // Mark finished on natural end so waiters can fire. We don't tear the
  // state down — getMusicTime() keeps reporting (now-stalled) time so any
  // audio-time wait on a *next* entry resolves cleanly until the next
  // playMusicLoop call replaces this state. Fire and clear listeners.
  sound.once(Phaser.Sound.Events.COMPLETE, () => {
    mlog('one-shot COMPLETE fired', { t: nowMs(), key, isStillCurrent: current === state });
    if (current !== state) return;
    state.finished = true;
    const listeners = state.onComplete;
    state.onComplete = [];
    for (const cb of listeners) cb();
  });

  const start = (): void => {
    sound.play();
    trackStartCtxTime = musicBus?.context.currentTime ?? null;
  };
  if (sm.locked) sm.once(Phaser.Sound.Events.UNLOCKED, start);
  else start();

  current = state;
}

function playLoopCrossfaded(key: string, volume: number, crossfadeMs: number): void {
  // biome-ignore lint/style/noNonNullAssertion: caller guarded
  const sm = _sm!;
  // Two non-looping sound instances of the same buffer. We manually re-play
  // them in alternation, scheduling the next start (crossfadeMs) before the
  // current one ends so the gain ramps overlap.
  const a = sm.add(key, { volume: 0 });
  const b = sm.add(key, { volume: 0 });
  if (musicBus) {
    routeSound(a, musicBus);
    routeSound(b, musicBus);
  }
  const sounds = [a, b];
  let active = 0;

  const state: LoopState = {
    key,
    sounds,
    intro: null,
    scheduled: null,
    oneShot: false,
    finished: false,
    onComplete: [],
  };

  const playPing = (): void => {
    // biome-ignore lint/style/noNonNullAssertion: bounded by sounds.length
    const incoming = sounds[active]!;
    // biome-ignore lint/style/noNonNullAssertion: bounded by sounds.length
    const outgoing = sounds[1 - active]!;

    incoming.play();
    rampGain(incoming, volume, crossfadeMs);
    if (outgoing.isPlaying) {
      rampGain(outgoing, 0, crossfadeMs);
    }

    if (trackStartCtxTime === null) {
      trackStartCtxTime = musicBus?.context.currentTime ?? null;
    }

    active = 1 - active;
    const durMs = incoming.totalDuration * 1000;
    state.scheduled = setTimeout(playPing, Math.max(0, durMs - crossfadeMs));
  };

  if (sm.locked) sm.once(Phaser.Sound.Events.UNLOCKED, playPing);
  else playPing();

  current = state;
}

export function playMusicWithIntro(introKey: string, loopKey: string, opts: { volume?: number } = {}): void {
  mlog('playMusicWithIntro: enter', {
    t: nowMs(),
    introKey,
    loopKey,
    currentKey: current?.key ?? null,
    manualPaused,
    autoPaused,
  });
  if (!_sm) return;
  if (current?.key === loopKey) {
    mlog('playMusicWithIntro: idempotent, already current');
    return;
  }
  stopMusicLoop();
  trackStartCtxTime = null;

  const volume = opts.volume ?? DEFAULT_VOL;
  const intro = _sm.add(introKey, { volume });
  const loop = _sm.add(loopKey, { loop: true, volume });
  if (musicBus) {
    routeSound(intro, musicBus);
    routeSound(loop, musicBus);
  }

  const start = (): void => {
    intro.play();
    // `delay` is in seconds and resolves through Web Audio's currentTime, so
    // the loop's first sample lands at exactly intro.totalDuration after the
    // intro started — gapless given Vorbis sources.
    loop.play({ delay: intro.totalDuration });
    // Clock starts when the user hears music begin (= intro start), so a
    // schedule like `waitAudioTimeAtLeast(8)` fires 8s after the fanfare begins,
    // not 8s after the loop takes over.
    trackStartCtxTime = musicBus?.context.currentTime ?? null;
  };
  if (_sm.locked) {
    _sm.once(Phaser.Sound.Events.UNLOCKED, start);
  } else {
    start();
  }

  current = {
    key: loopKey,
    sounds: [loop],
    intro,
    scheduled: null,
    oneShot: false,
    finished: false,
    onComplete: [],
  };
}

// Register a one-shot listener for the active track's natural completion.
// Fires immediately if no track is playing or the active track has already
// finished. For loop-mode tracks the callback is dropped on the next track
// swap (loops never complete naturally, so consumers should branch via
// `getCurrentTrackInfo().oneShot` before calling this).
export function onceMusicComplete(cb: () => void): void {
  mlog('onceMusicComplete: register', {
    t: nowMs(),
    currentKey: current?.key ?? null,
    finished: current?.finished ?? null,
    pendingListeners: current?.onComplete.length ?? 0,
  });
  if (!current) {
    mlog('onceMusicComplete: fire-immediate (no current)');
    cb();
    return;
  }
  if (current.finished) {
    mlog('onceMusicComplete: fire-immediate (already finished)');
    cb();
    return;
  }
  current.onComplete.push(cb);
}

// Has the active track finished playing? Returns false for looping tracks
// (they never finish), true for one-shots whose 'complete' event has fired,
// null when no track is active. Used by `waitTrackEnded` to short-circuit
// when the one-shot has already wrapped up.
export function isMusicFinished(): boolean | null {
  if (!current) return null;
  return current.finished;
}

// Linearly ramp every live sound on the current track to 0 over
// `durationMs`, then `stopMusicLoop` to release the audio resources.
// Snapshots `current` before scheduling the teardown so a downstream
// `playMusicLoop` mid-fade isn't accidentally torn down by our stale
// timer. Volume is ramped through the underlying `volumeNode` GainNode
// (same path as `rampGain` for crossfades) — Phaser's per-frame
// WebAudioSound.update() is left untouched, so we don't fight its
// reconciliation of `sound.volume`. Returns immediately if no track
// is playing.
export function fadeOutMusic(durationMs: number): void {
  mlog('fadeOutMusic: enter', { t: nowMs(), durationMs, currentKey: current?.key ?? null });
  if (!current) return;
  const target = current;
  for (const s of target.sounds) rampGain(s, 0, durationMs);
  if (target.intro) rampGain(target.intro, 0, durationMs);
  setTimeout(() => {
    mlog('fadeOutMusic: timeout fired', {
      t: nowMs(),
      key: target.key,
      stillCurrent: current === target,
      manualPaused,
      autoPaused,
    });
    if (current === target) stopMusicLoop();
  }, durationMs);
}

export function stopMusicLoop(): void {
  mlog('stopMusicLoop: enter', {
    t: nowMs(),
    currentKey: current?.key ?? null,
    manualPaused,
    autoPaused,
    snaps: pausedSnaps.length,
  });
  if (!current) {
    mlog('stopMusicLoop: no current');
    return;
  }
  if (current.scheduled !== null) clearTimeout(current.scheduled);
  for (const s of current.sounds) {
    s.stop();
    s.destroy();
  }
  if (current.intro) {
    current.intro.stop();
    current.intro.destroy();
  }
  // Drop any unfired completion listeners — they were tied to *this* track.
  // A new track's listeners go on the new state's onComplete; old ones must
  // not fire when the next one-shot's COMPLETE event lands.
  current.onComplete = [];
  current = null;
  trackStartCtxTime = null;
  pausedAtCtxTime = null;
  pausedSnaps = [];
  manualPaused = false;
  autoPaused = false;
  mlog('stopMusicLoop: cleared all state');
}

// Bypass Phaser's per-sound `pause()`/`resume()` entirely — they're driven
// by counters (`playTime`, `loopTime`, `rateUpdates`) that Phaser only
// reconciles in its per-frame `update()`, which means anything happening
// near a loop seam (or while a hidden tab throttles rAF) leaves them in
// an inconsistent state that pause/resume reads back as a bogus seek.
// Two known-bad outcomes: see phaserjs/phaser#6702 (loop restarts at
// offset 0 on refocus) and phaser-ce#323 (an extra copy of the buffer
// plays on top of the loop after resume). Stopping a sound fully tears
// down both the active and pre-scheduled buffer-source nodes; replaying
// from a seek we've computed against the AudioContext clock rebuilds
// clean state without depending on any of Phaser's stale counters.
//
// AudioContext keeps advancing during pause (Phaser's sound-manager
// update calls `context.resume()` every frame, so suspending the context
// wouldn't stick); on resume we shift `trackStartCtxTime` forward by the
// pause duration to keep `getMusicTime()` aligned with the actual music
// position.
type PausedSoundSnap = { sound: Phaser.Sound.BaseSound; offset: number; loop: boolean };
let pausedSnaps: PausedSoundSnap[] = [];

function captureBufferOffset(sound: Phaser.Sound.BaseSound, loop: boolean): number {
  if (!musicBus) return 0;
  const ws = sound as unknown as { playTime: number; totalDuration: number };
  const total = ws.totalDuration;
  if (!total) return 0;
  // `playTime` is `startTime - seek` — the virtual AudioContext time at
  // which the buffer's sample 0 would have started, so `ctx - playTime`
  // gives the in-buffer position directly. We need this instead of
  // `startTime` because our resume path calls `play({ seek: X })`, which
  // Phaser handles by setting `startTime = ctx.currentTime` (the moment
  // play was called, not adjusted for the seek) while baking the seek
  // into `playTime`. Using `startTime` here would read back "time since
  // play call" and silently drop the previous seek on every pause cycle.
  // Modulo recovers the equivalent in-bounds position when Phaser's
  // per-frame `update()` hasn't yet caught up with a natural loop wrap;
  // one-shots clamp to [0, total].
  const elapsed = musicBus.context.currentTime - ws.playTime;
  if (loop) return ((elapsed % total) + total) % total;
  return Math.max(0, Math.min(total, elapsed));
}

function doPauseSounds(): void {
  if (!current || !musicBus) {
    mlog('doPauseSounds: bail (no current or no bus)', { hasCurrent: !!current, hasBus: !!musicBus });
    return;
  }
  if (pausedAtCtxTime !== null) {
    mlog('doPauseSounds: bail (already paused)', { pausedAtCtxTime });
    return;
  }
  pausedAtCtxTime = musicBus.context.currentTime;
  mlog('doPauseSounds: enter', {
    t: nowMs(),
    key: current.key,
    oneShot: current.oneShot,
    finished: current.finished,
    pausedAtCtxTime,
    trackStartCtxTime,
    ctxTime: musicBus.context.currentTime,
  });

  const snaps: PausedSoundSnap[] = [];
  const captureAndStop = (sound: Phaser.Sound.BaseSound, loop: boolean): void => {
    const ws = sound as unknown as { isPlaying: boolean; isPaused: boolean };
    if (!ws.isPlaying && !ws.isPaused) {
      mlog('doPauseSounds: skip (not playing)', snapshotSound(sound), { loopArg: loop });
      return;
    }
    const offset = captureBufferOffset(sound, loop);
    mlog('doPauseSounds: capture+stop', snapshotSound(sound), { loopArg: loop, capturedOffset: offset });
    snaps.push({ sound, offset, loop });
    sound.stop();
  };
  if (current.intro) captureAndStop(current.intro, false);
  for (const s of current.sounds) captureAndStop(s, !current.oneShot);
  pausedSnaps = snaps;

  // Drift check: three derivations of "where the music is" that should
  // agree within a frame at the moment of pause. If they don't, one of
  // the inputs (sound.startTime, trackStartCtxTime, or the delay-scheduled
  // sound trap in #2 of the suspect list) is the source of the desync.
  //   - musicTime: getMusicTime()'s logical track clock
  //   - paused-trackStart: pausedAtCtxTime - trackStartCtxTime, what
  //     getMusicTime() would have returned at the pause instant
  //   - loop snap: captured buffer offset for the loop body; for loops
  //     should equal (musicTime - introDuration) mod loopDuration
  const mt = getMusicTime();
  const introDur = current.intro?.totalDuration ?? 0;
  const loopDur = current.sounds[0]?.totalDuration ?? 0;
  const loopSnap = snaps.find((s) => s.loop && s.sound !== current?.intro);
  const expectedLoopSeek = mt && loopDur > 0 ? (((mt.time - introDur) % loopDur) + loopDur) % loopDur : null;
  mlog('doPauseSounds: drift-check', {
    musicTime: mt?.time ?? null,
    pausedMinusStart: trackStartCtxTime !== null ? pausedAtCtxTime - trackStartCtxTime : null,
    introDur,
    loopDur,
    loopSnapOffset: loopSnap?.offset ?? null,
    expectedLoopSeek,
    delta: loopSnap && expectedLoopSeek !== null ? loopSnap.offset - expectedLoopSeek : null,
  });
  mlog('doPauseSounds: done', { snaps: snaps.length });
}

function doResumeSounds(): void {
  if (!current || !musicBus) {
    mlog('doResumeSounds: bail (no current or no bus)', { hasCurrent: !!current, hasBus: !!musicBus });
    return;
  }
  if (pausedAtCtxTime === null) {
    mlog('doResumeSounds: bail (pausedAtCtxTime is null)');
    return;
  }
  const pauseDuration = musicBus.context.currentTime - pausedAtCtxTime;
  pausedAtCtxTime = null;
  if (trackStartCtxTime !== null) trackStartCtxTime += pauseDuration;
  mlog('doResumeSounds: enter', {
    t: nowMs(),
    key: current.key,
    pauseDuration,
    snapsCount: pausedSnaps.length,
    trackStartCtxTime,
    ctxTime: musicBus.context.currentTime,
  });
  for (const ps of pausedSnaps) {
    mlog('doResumeSounds: play', snapshotSound(ps.sound), { seek: ps.offset, loop: ps.loop });
    ps.sound.play({ seek: ps.offset, loop: ps.loop });
    mlog('doResumeSounds: after play', snapshotSound(ps.sound));
  }
  pausedSnaps = [];

  // Verification: getMusicTime() right after replay should equal what it
  // returned at pause time (we shifted trackStartCtxTime by the full pause
  // duration). If it doesn't, the trackStartCtxTime shift and the actual
  // audible position have diverged — that's exactly the desync the player
  // would hear against the pattern.
  const mt = getMusicTime();
  mlog('doResumeSounds: drift-check', {
    musicTimeAfterResume: mt?.time ?? null,
  });
  mlog('doResumeSounds: done');
}

// Pause the active music in place. Used by the ESC pause menu so the score
// stops while the overlay is up. Idempotent against itself and stacks with
// the window-blur auto-pause — calling it while the window is blurred just
// keeps the music paused after focus returns.
export function pauseMusic(): void {
  mlog('pauseMusic: enter', {
    t: nowMs(),
    currentKey: current?.key ?? null,
    manualPaused,
    autoPaused,
    snaps: pausedSnaps.length,
  });
  if (manualPaused) {
    mlog('pauseMusic: already manualPaused, returning');
    return;
  }
  manualPaused = true;
  doPauseSounds();
}

export function resumeMusic(): void {
  mlog('resumeMusic: enter', {
    t: nowMs(),
    currentKey: current?.key ?? null,
    manualPaused,
    autoPaused,
    snaps: pausedSnaps.length,
  });
  if (!manualPaused) {
    mlog('resumeMusic: not manualPaused, returning');
    return;
  }
  manualPaused = false;
  if (!autoPaused) doResumeSounds();
  else mlog('resumeMusic: autoPaused is true — staying paused');
}

// Wire the active music to the window's blur/focus state so the score
// pauses cleanly when the user tabs away. Without this, Phaser's WebAudio
// loop machinery (which reschedules the next buffer source on every update
// tick at the loop boundary) goes stale while rAF is throttled in a hidden
// tab — on refocus you can hear the loop restart from offset 0, or hear
// two source nodes overlap. Pausing the sounds explicitly tears down the
// scheduled buffer sources so refocus replays cleanly from the same seek.
//
// Coexists with manual `pauseMusic`/`resumeMusic` calls (e.g. GameScene's
// pause overlay) via the two-flag state above: blur-pausing during a manual
// pause is a no-op, and focus-resuming while still manually-paused leaves
// the music paused.
export function installAutoPauseOnBlur(game: Phaser.Game): void {
  const onBlurOrHidden = (): void => {
    mlog('autoPause (blur/hidden): enter', {
      t: nowMs(),
      autoPaused,
      manualPaused,
      currentKey: current?.key ?? null,
    });
    if (autoPaused) return;
    autoPaused = true;
    if (!manualPaused) doPauseSounds();
  };
  const onFocusOrVisible = (): void => {
    mlog('autoResume (focus/visible): enter', {
      t: nowMs(),
      autoPaused,
      manualPaused,
      currentKey: current?.key ?? null,
    });
    if (!autoPaused) return;
    autoPaused = false;
    if (!manualPaused) doResumeSounds();
  };
  // Three independent paths to catch focus loss because no single one is
  // reliable across platforms:
  //  - Phaser BLUR/FOCUS: forwarded from `window.onblur`/`onfocus`. These
  //    are property assignments so any other code (or stale Phaser
  //    instance) that reassigns `window.onblur` silently drops them.
  //  - Direct DOM blur/focus listeners: survive that hazard since
  //    `addEventListener` adds to a list rather than overwriting a slot.
  //  - visibilitychange: catches tab-hide on platforms (notably iOS
  //    Safari) that don't reliably fire window blur for tab switches.
  // The early-return guards on `autoPaused` make duplicate firings no-ops.
  game.events.on(Phaser.Core.Events.BLUR, onBlurOrHidden);
  game.events.on(Phaser.Core.Events.FOCUS, onFocusOrVisible);
  window.addEventListener('blur', onBlurOrHidden);
  window.addEventListener('focus', onFocusOrVisible);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onBlurOrHidden();
    else onFocusOrVisible();
  });
}

// Seconds since the currently-playing track began. Returns null both when no
// track is active and when one was requested but hasn't actually started
// playing yet (e.g. waiting for the first user gesture to unlock the audio
// context). Filters that need "track is up and running" should null-check
// the return rather than coalescing to 0.
export function getMusicTime(): { key: string; time: number } | null {
  if (!current || trackStartCtxTime === null || !musicBus) return null;
  return { key: current.key, time: musicBus.context.currentTime - trackStartCtxTime };
}

// Durations of the active track's intro (one-shot, plays once) and loop body
// (loop: true, repeats indefinitely), plus a `oneShot` flag for tracks
// started via `{ loop: false }`. Used by `waitTrackEnded` to compute the
// next loop-boundary timestamp (loops) or branch to one-shot completion
// (oneShot tracks) so music switches snap to a clean break instead of
// cutting mid-bar.
//
// `introDuration` is 0 when the active track was started via playMusicLoop
// (no intro segment). Returns null when no track is active.
export function getCurrentTrackInfo(): { introDuration: number; loopDuration: number; oneShot: boolean } | null {
  if (!current) return null;
  return {
    introDuration: current.intro?.totalDuration ?? 0,
    loopDuration: current.sounds[0]?.totalDuration ?? 0,
    oneShot: current.oneShot,
  };
}

// Ramp the underlying GainNode directly. We deliberately don't touch
// `sound.volume` so Phaser's per-frame WebAudioSound.update() doesn't snap
// the gain back to the (untouched) volume property and fight our ramp.
// The constructor `volume: 0` keeps Phaser's tracked value at 0 forever;
// gain alone goes 0 → target → 0 → target → ... across the ping-pong.
function rampGain(sound: Phaser.Sound.BaseSound, target: number, durMs: number): void {
  const ws = sound as unknown as { volumeNode?: GainNode };
  if (!ws.volumeNode || !musicBus) return;
  const ctx = musicBus.context;
  const now = ctx.currentTime;
  ws.volumeNode.gain.cancelScheduledValues(now);
  ws.volumeNode.gain.setValueAtTime(ws.volumeNode.gain.value, now);
  ws.volumeNode.gain.linearRampToValueAtTime(target, now + durMs / 1000);
}
