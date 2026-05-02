type Webkit = { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as unknown as Webkit).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  // iOS Safari fully unlocks WebAudio only after at least one buffer
  // source has been started during a user gesture. A 1-sample silent
  // buffer is the standard trick.
  const buf = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0);
  unlocked = true;
}

window.addEventListener('pointerdown', unlock);
window.addEventListener('touchstart', unlock);
window.addEventListener('keydown', unlock);

export function shoot(): void {
  const c = getCtx();
  if (!c || !unlocked) return;
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
  const c = getCtx();
  if (!c || !unlocked) return;
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
