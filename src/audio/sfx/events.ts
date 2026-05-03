// Game-facing SFX events. Procedural ones (shoot, hit) synth into sfxBus;
// sample-based ones (click) go through the voice pool. Everything no-ops
// silently until initBuses + setSoundManager have been called from BootScene.

import { sfxBus } from '../buses';
import { CLICK_SFX_KEY } from '../keys';
import { playPooled } from './pool';

export function shoot(): void {
  if (!sfxBus) return;
  const c = sfxBus.context;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.1);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(gain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + 0.14);
}

export function hit(): void {
  if (!sfxBus) return;
  const c = sfxBus.context;
  const t = c.currentTime;
  const dur = 0.45;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1500, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  noise.connect(filter).connect(gain).connect(sfxBus);
  noise.start(t);
  noise.stop(t + dur + 0.05);
}

export function playClick(): void {
  playPooled(CLICK_SFX_KEY, { volume: 0.6 });
}
