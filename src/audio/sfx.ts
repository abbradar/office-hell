// Procedural SFX layered on top of Phaser's audio context. Phaser's
// WebAudioSoundManager handles creating the AudioContext (with the legacy
// webkit fallback baked in) and resuming it on the first user gesture, so all
// we have to do is grab the context once at boot and use it for raw oscillator
// / noise synthesis. If Phaser falls back to NoAudioSoundManager (no audio
// support detected), setAudioContext is never called and these functions just
// no-op.

let ctx: AudioContext | null = null;

export function setAudioContext(audioContext: AudioContext): void {
  ctx = audioContext;
}

function ready(): AudioContext | null {
  if (!ctx || ctx.state !== 'running') return null;
  return ctx;
}

export function shoot(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.1);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.14);
}

export function hit(): void {
  const c = ready();
  if (!c) return;
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
  noise.connect(filter).connect(gain).connect(c.destination);
  noise.start(t);
  noise.stop(t + dur + 0.05);
}
