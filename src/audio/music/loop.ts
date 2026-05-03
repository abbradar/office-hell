// Scene-independent music playback so loops survive scene transitions
// (menu → character select → test menu all share the same menu loop;
// stage music persists across cutscenes inside GameScene).
//
// Two playback modes:
//   - playMusicLoop(key)        — single sound, loop: true
//   - playMusicWithIntro(i, l)  — intro plays once, loop scheduled to start
//                                 sample-accurately at the intro's end
//
// Sample-accurate looping requires Vorbis (.ogg) sources — MP3 prepends
// ~1100 priming samples that would click at the seam. The intro→loop
// hand-off uses Phaser's `delay` config which schedules via Web Audio's
// AudioContext.currentTime, so the seam is also gapless.

import Phaser from 'phaser';
import { musicBus, routeSound } from '../buses';

let _sm: Phaser.Sound.BaseSoundManager | null = null;

export function setMusicManager(sm: Phaser.Sound.BaseSoundManager): void {
  _sm = sm;
}

type LoopState = {
  key: string;
  sound: Phaser.Sound.BaseSound;
  intro: Phaser.Sound.BaseSound | null;
};

let current: LoopState | null = null;
// Set to audioCtx.currentTime the moment the active track's sound.play()
// actually fires. Reset to null at the moment a new track is requested so
// `getMusicTime()` correctly reports "not playing yet" while the new track
// is loading or waiting for context unlock.
let trackStartCtxTime: number | null = null;

const DEFAULT_VOL = 0.5;

export function playMusicLoop(key: string, opts: { volume?: number } = {}): void {
  if (!_sm) return;
  if (current?.key === key) return;
  stopMusicLoop();
  trackStartCtxTime = null;

  const volume = opts.volume ?? DEFAULT_VOL;
  const sound = _sm.add(key, { loop: true, volume });
  if (musicBus) routeSound(sound, musicBus);

  const start = (): void => {
    sound.play();
    trackStartCtxTime = musicBus?.context.currentTime ?? null;
  };
  if (_sm.locked) {
    _sm.once(Phaser.Sound.Events.UNLOCKED, start);
  } else {
    start();
  }

  current = { key, sound, intro: null };
}

export function playMusicWithIntro(
  introKey: string,
  loopKey: string,
  opts: { volume?: number } = {},
): void {
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
    // schedule like `audioTimeAtLeast(8)` fires 8s after the fanfare begins,
    // not 8s after the loop takes over.
    trackStartCtxTime = musicBus?.context.currentTime ?? null;
  };
  if (_sm.locked) {
    _sm.once(Phaser.Sound.Events.UNLOCKED, start);
  } else {
    start();
  }

  current = { key: loopKey, sound: loop, intro };
}

export function stopMusicLoop(): void {
  if (!current) return;
  current.sound.stop();
  current.sound.destroy();
  if (current.intro) {
    current.intro.stop();
    current.intro.destroy();
  }
  current = null;
  trackStartCtxTime = null;
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
// (loop: true, repeats indefinitely). Used by the stage-queue `trackEnded`
// filter to compute the next loop-boundary timestamp so music switches snap
// to a clean musical break instead of cutting mid-bar.
//
// `introDuration` is 0 when the active track was started via playMusicLoop
// (no intro segment). Returns null when no track is active.
export function getCurrentTrackInfo(): { introDuration: number; loopDuration: number } | null {
  if (!current) return null;
  return {
    introDuration: current.intro?.totalDuration ?? 0,
    loopDuration: current.sound.totalDuration,
  };
}
