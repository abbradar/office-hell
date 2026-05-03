// Self-crossfading music loop, scene-independent so it can survive scene
// transitions (e.g. menu → character select → test menu all share the same
// menu loop). Uses raw Web Audio gain ramps via the sound's volumeNode for
// fades and setTimeout for the per-loop schedule, so it doesn't need a
// scene's tween manager or time event queue.
//
// Two Phaser sounds are kept around per active loop and ping-pong: while one
// is playing and approaching its tail, the other starts and the gains
// crossfade over `crossfadeMs`. Both are routed through musicBus.

import Phaser from 'phaser';
import { musicBus, routeSound } from '../buses';

let _sm: Phaser.Sound.BaseSoundManager | null = null;

export function setMusicManager(sm: Phaser.Sound.BaseSoundManager): void {
  _sm = sm;
}

type LoopState = {
  key: string;
  tracks: Phaser.Sound.BaseSound[];
  idx: number;
  scheduled: ReturnType<typeof setTimeout> | null;
  fadeTimers: ReturnType<typeof setTimeout>[];
  stopped: boolean;
};

let current: LoopState | null = null;

const DEFAULT_VOL = 0.5;
const DEFAULT_CROSSFADE_MS = 1000;

export function playMusicLoop(
  key: string,
  opts: { volume?: number; crossfadeMs?: number } = {},
): void {
  if (!_sm) return;
  if (current && !current.stopped && current.key === key) return;
  stopMusicLoop();

  const targetVol = opts.volume ?? DEFAULT_VOL;
  const crossfadeMs = opts.crossfadeMs ?? DEFAULT_CROSSFADE_MS;

  const state: LoopState = {
    key,
    tracks: [_sm.add(key, { volume: 0 }), _sm.add(key, { volume: 0 })],
    idx: 0,
    scheduled: null,
    fadeTimers: [],
    stopped: false,
  };
  for (const t of state.tracks) {
    if (musicBus) routeSound(t, musicBus);
  }
  current = state;

  const playNext = (): void => {
    if (state.stopped) return;
    // biome-ignore lint/style/noNonNullAssertion: tracks has length 2
    const incoming = state.tracks[state.idx]!;
    // biome-ignore lint/style/noNonNullAssertion: tracks has length 2
    const outgoing = state.tracks[1 - state.idx]!;

    incoming.play();
    rampGain(incoming, targetVol, crossfadeMs);
    if (outgoing.isPlaying) {
      rampGain(outgoing, 0, crossfadeMs);
      const t = setTimeout(() => outgoing.stop(), crossfadeMs);
      state.fadeTimers.push(t);
    }

    state.idx = 1 - state.idx;
    const durMs = incoming.duration * 1000;
    state.scheduled = setTimeout(playNext, Math.max(0, durMs - crossfadeMs));
  };

  if (_sm.locked) {
    _sm.once(Phaser.Sound.Events.UNLOCKED, playNext);
  } else {
    playNext();
  }
}

export function stopMusicLoop(): void {
  if (!current) return;
  current.stopped = true;
  if (current.scheduled !== null) clearTimeout(current.scheduled);
  for (const t of current.fadeTimers) clearTimeout(t);
  for (const t of current.tracks) {
    t.stop();
    t.destroy();
  }
  current = null;
}

// Ramp the underlying GainNode directly. We deliberately don't touch
// `sound.volume` so Phaser's per-frame WebAudioSound.update() doesn't snap the
// gain back to the (untouched) volume property and fight our ramp.
function rampGain(sound: Phaser.Sound.BaseSound, target: number, durMs: number): void {
  const ws = sound as unknown as { volumeNode?: GainNode; volume: number };
  if (!ws.volumeNode) {
    ws.volume = target;
    return;
  }
  const ctx = ws.volumeNode.context;
  const now = ctx.currentTime;
  ws.volumeNode.gain.cancelScheduledValues(now);
  ws.volumeNode.gain.setValueAtTime(ws.volumeNode.gain.value, now);
  ws.volumeNode.gain.linearRampToValueAtTime(target, now + durMs / 1000);
}
