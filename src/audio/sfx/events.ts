// Game-facing SFX events. All sample-based — `noised_laser.wav` for the
// player/enemy fire and `hit_hurt.wav` for the player getting damaged —
// routed through the voice pool so concurrent calls share a cap and don't
// stack into a roar. Everything no-ops silently until initBuses +
// setSoundManager have been called from BootScene.

import { CLICK_SFX_KEY, HURT_SFX_KEY, SHOOT_SFX_KEY } from '../keys';
import { playPooled } from './pool';

export function shoot(): void {
  // Slight detune per call so rapid-fire trains don't sound like a single
  // metronome — ±60 cents (a touch under a semitone) is enough to break the
  // pattern without losing the laser's identity.
  playPooled(SHOOT_SFX_KEY, {
    volume: 0.4,
    detune: (Math.random() - 0.5) * 120,
  });
}

export function hit(): void {
  playPooled(HURT_SFX_KEY, { volume: 0.7 });
}

export function playClick(): void {
  playPooled(CLICK_SFX_KEY, { volume: 0.6 });
}
