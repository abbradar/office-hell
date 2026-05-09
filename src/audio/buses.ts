// Bus architecture inspired by docs/dead-grid-audio-implementation-guide.md.
// Phaser owns the AudioContext; we insert a compressor + named buses between
// our sounds and Phaser's master chain so that SFX and music have separate
// gain trims and a shared limiter before the master bus.
//
//   sfxBus  ─┐
//            ├─► compressor ─► soundManager.destination ─► (Phaser master) ─► ctx.destination
//   musicBus ┘
//
// `soundManager.destination` is `masterMuteNode`, which is upstream of
// `masterVolumeNode` in Phaser's internal chain — connecting there means
// `scene.sound.mute = true` (which zeroes masterMuteNode.gain) actually
// silences everything we've routed. Hooking into masterVolumeNode directly
// would bypass the mute and leave the toggle inert for every bus-routed
// sound.
//
// Phaser sounds default to routing through that destination too;
// routeSound() pulls a single sound's volumeNode out of that chain and
// re-attaches it to one of our buses.

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
  sfxBus.gain.value = 0.3;

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.8;

  sfxBus.connect(compressor);
  musicBus.connect(compressor);
  compressor.connect(soundManager.destination);
}

export function routeSound(sound: Phaser.Sound.BaseSound, dest: AudioNode): void {
  const ws = sound as { volumeNode?: GainNode };
  if (!ws.volumeNode) return;
  ws.volumeNode.disconnect();
  ws.volumeNode.connect(dest);
}
