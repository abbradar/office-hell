// Game-facing SFX events. Mostly sample-based — `noised_laser.wav` for the
// player/enemy fire and `hit_hurt.wav` for the player getting damaged —
// routed through the voice pool so concurrent calls share a cap and don't
// stack into a roar. The gym-bro phase-2 jump/thump pair are procedural
// (WebAudio oscillators) so we don't have to ship two more LFS samples for
// a single boss fight; both connect to sfxBus directly. Everything no-ops
// silently until initBuses + setSoundManager have been called from BootScene.

import { sfxBus } from '../buses';
import { CLICK_SFX_KEY, HURT_SFX_KEY, SHOOT_SFX_KEY } from '../keys';
import { playPooled } from './pool';

export function shoot(): void {
  // Slight detune per call so rapid-fire trains don't sound like a single
  // metronome — ±60 cents (a touch under a semitone) is enough to break the
  // pattern without losing the laser's identity. Halved volume from the
  // original 0.4 — dense boss volleys + the sandbox both stack a lot of
  // shoots back-to-back, and 0.4 was overpowering the music.
  playPooled(SHOOT_SFX_KEY, {
    volume: 0.2,
    detune: (Math.random() - 0.5) * 120,
  });
}

export function hit(): void {
  playPooled(HURT_SFX_KEY, { volume: 0.7 });
}

// Player-death cue. Two falling pitches of the hurt sample chained ~130ms
// apart so it reads as a Mario/Undertale-style "down-down" finisher instead
// of a regular hit. Reuses HURT_SFX_KEY so no new asset is needed.
export function playerDeath(): void {
  playPooled(HURT_SFX_KEY, { volume: 0.9, detune: -400 });
  setTimeout(() => playPooled(HURT_SFX_KEY, { volume: 0.9, detune: -1000 }), 130);
}

// Boss-death cue. Two triangle oscillators an octave apart sweeping down
// over ~600ms; lower partial louder so it reads as a heavy collapse rather
// than the player's higher-pitched two-blip hurt. Same procedural path as
// the gym-bro thump/jump — direct sfxBus connection, no extra asset.
export function playBossDeath(): void {
  if (!sfxBus) return;
  const ctx = sfxBus.context;
  const now = ctx.currentTime;
  const partials: Array<[number, number, number]> = [
    [320, 60, 0.4],
    [160, 30, 0.55],
  ];
  for (const [base, end, amp] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + 0.55);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(sfxBus);
    osc.start(now);
    osc.stop(now + 0.65);
  }
}

export function playClick(): void {
  playPooled(CLICK_SFX_KEY, { volume: 0.6 });
}

// Heavy landing — sine pitch-drop + fast envelope. Punchy enough to read as
// a body hitting the floor at 60-ish Hz; the short tail keeps four-in-a-row
// thumps from smearing into a drone.
export function playThump(): void {
  if (!sfxBus) return;
  const ctx = sfxBus.context;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.13);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.7, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain);
  gain.connect(sfxBus);
  osc.start(now);
  osc.stop(now + 0.25);
}

// Takeoff — upward sine sweep, lighter envelope than the thump. Pairs with
// playThump on the same jump so the sound silhouette tracks the parabola.
export function playJump(): void {
  if (!sfxBus) return;
  const ctx = sfxBus.context;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(720, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(gain);
  gain.connect(sfxBus);
  osc.start(now);
  osc.stop(now + 0.22);
}
