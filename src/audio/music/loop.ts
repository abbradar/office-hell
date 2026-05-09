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
  if (!_sm) return;
  if (current?.key === key) return;
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
  if (!_sm) return;
  if (current?.key === loopKey) return;
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
  if (!current) {
    cb();
    return;
  }
  if (current.finished) {
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

export function stopMusicLoop(): void {
  if (!current) return;
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
  manualPaused = false;
  autoPaused = false;
}

// Calls Phaser's per-sound `pause()` on the active intro / loop sounds; the
// AudioContext keeps advancing (Phaser's sound-manager update calls
// `context.resume()` every frame, so suspending the context wouldn't stick),
// so on resume we shift `trackStartCtxTime` forward by the pause duration to
// keep `getMusicTime()` aligned with the actual music position.
function doPauseSounds(): void {
  if (!current || !musicBus) return;
  if (pausedAtCtxTime !== null) return;
  pausedAtCtxTime = musicBus.context.currentTime;
  if (current.intro) current.intro.pause();
  for (const s of current.sounds) s.pause();
}

function doResumeSounds(): void {
  if (!current || !musicBus) return;
  if (pausedAtCtxTime === null) return;
  const pauseDuration = musicBus.context.currentTime - pausedAtCtxTime;
  pausedAtCtxTime = null;
  if (trackStartCtxTime !== null) trackStartCtxTime += pauseDuration;
  if (current.intro) current.intro.resume();
  for (const s of current.sounds) s.resume();
}

// Pause the active music in place. Used by the ESC pause menu so the score
// stops while the overlay is up. Idempotent against itself and stacks with
// the window-blur auto-pause — calling it while the window is blurred just
// keeps the music paused after focus returns.
export function pauseMusic(): void {
  if (manualPaused) return;
  manualPaused = true;
  doPauseSounds();
}

export function resumeMusic(): void {
  if (!manualPaused) return;
  manualPaused = false;
  if (!autoPaused) doResumeSounds();
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
    if (autoPaused) return;
    autoPaused = true;
    if (!manualPaused) doPauseSounds();
  };
  const onFocusOrVisible = (): void => {
    if (!autoPaused) return;
    autoPaused = false;
    if (!manualPaused) doResumeSounds();
  };
  // BLUR/FOCUS for desktop window-focus changes; visibilitychange catches
  // tab-hide on platforms (notably iOS Safari) that don't reliably fire
  // window blur for tab switches.
  game.events.on(Phaser.Core.Events.BLUR, onBlurOrHidden);
  game.events.on(Phaser.Core.Events.FOCUS, onFocusOrVisible);
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
