// Bus architecture inspired by docs/dead-grid-audio-implementation-guide.md.
// Phaser owns the AudioContext; we insert a compressor + named buses between
// our sounds and Phaser's masterVolumeNode so that SFX and music have separate
// gain trims and a shared limiter before the master bus.
//
//   sfxBus  ─┐
//            ├─► compressor ─► phaserMaster ─► destination
//   musicBus ┘
//
// Phaser sounds default to routing into phaserMaster directly; routeSound()
// re-wires a single sound's volumeNode to one of our buses instead.

import Phaser from 'phaser';

export let sfxBus: GainNode | null = null;
export let musicBus: GainNode | null = null;
export let compressor: DynamicsCompressorNode | null = null;

export function initBuses(soundManager: Phaser.Sound.BaseSoundManager): void {
  if (!(soundManager instanceof Phaser.Sound.WebAudioSoundManager)) return;

  const ctx = soundManager.context;

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.3;

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 1.0;

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.8;

  sfxBus.connect(compressor);
  musicBus.connect(compressor);
  compressor.connect(soundManager.masterVolumeNode);
}

export function routeSound(sound: Phaser.Sound.BaseSound, dest: AudioNode): void {
  const ws = sound as { volumeNode?: GainNode };
  if (!ws.volumeNode) return;
  ws.volumeNode.disconnect();
  ws.volumeNode.connect(dest);
}
