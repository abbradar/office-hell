// Voice pool for sample-based SFX. Caps concurrent playback per key so that
// rapid-fire triggers (clicks, ticks) don't pile up into a roar, and routes
// each sound through sfxBus on the way out.

import type Phaser from 'phaser';
import { routeSound, sfxBus } from '../buses';

const voiceCounts: Record<string, number> = {};
const voiceCaps: Record<string, number> = {};

let _sm: Phaser.Sound.BaseSoundManager | null = null;

export function setSoundManager(sm: Phaser.Sound.BaseSoundManager): void {
  _sm = sm;
}

export function setVoiceCap(key: string, cap: number): void {
  voiceCaps[key] = cap;
}

const DEFAULT_CAP = 8;

export function playPooled(key: string, options: Phaser.Types.Sound.SoundConfig = {}): Phaser.Sound.BaseSound | null {
  if (!_sm) return null;
  const cap = voiceCaps[key] ?? DEFAULT_CAP;
  const cur = voiceCounts[key] ?? 0;
  if (cur >= cap) return null;

  voiceCounts[key] = cur + 1;
  const snd = _sm.add(key, options);
  snd.once('complete', () => {
    voiceCounts[key] = Math.max(0, (voiceCounts[key] ?? 1) - 1);
    snd.destroy();
  });

  if (sfxBus) routeSound(snd, sfxBus);
  snd.play();
  return snd;
}
