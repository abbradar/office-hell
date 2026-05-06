// Persistent mute toggle. Drop one into every scene that wants the
// affordance (Menu, CharacterSelect, TestMenu, Game, End) — the actual
// mute state is global on Phaser's sound manager (`scene.sound.mute`),
// which routes through the masterVolumeNode that every bus feeds into,
// so toggling it kills both music and SFX in one place.
//
// Icons are Kenney "Game Icons" (CC0) — 100×100 PNGs scaled down with
// LINEAR filtering for clean edges (the global pixelArt: true would
// otherwise give us NEAREST + jaggies on a 4× downscale).

import Phaser from 'phaser';
import audioOffUrl from '../assets/icons/ui/audioOff.png';
import audioOnUrl from '../assets/icons/ui/audioOn.png';
import { gameW } from '../config';

export const MUTE_ON_TEXTURE = 'icon_audio_on';
export const MUTE_OFF_TEXTURE = 'icon_audio_off';
// Display height in CSS pixels. Source is 100×100; scaling factor is
// computed from this and the source dimensions at button-create time.
const ICON_DISPLAY_PX = 28;
// Inset from the top-right corner.
const MARGIN_PX = 6;

export function preloadMuteIcons(scene: Phaser.Scene): void {
  scene.load.image(MUTE_ON_TEXTURE, audioOnUrl);
  scene.load.image(MUTE_OFF_TEXTURE, audioOffUrl);
}

// Adds a top-right mute toggle to the given scene. Click flips
// `scene.sound.mute`, which is global to the game — state persists
// across scene transitions for free, and other scenes' buttons reflect
// the current state on creation.
export function addMuteButton(scene: Phaser.Scene): Phaser.GameObjects.Image {
  const muted = scene.sound.mute;
  const btn = scene.add
    .image(gameW() - MARGIN_PX, MARGIN_PX, muted ? MUTE_OFF_TEXTURE : MUTE_ON_TEXTURE)
    .setOrigin(1, 0)
    .setDepth(200)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  // Smooth downscale: source PNG is 100×100, target ~28×28. NEAREST
  // (the global pixelArt: true default) would jag the icon's curves;
  // LINEAR keeps the speaker silhouette clean. Idempotent across calls.
  btn.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  const scale = ICON_DISPLAY_PX / btn.height;
  btn.setScale(scale);

  btn.on('pointerup', () => {
    const next = !scene.sound.mute;
    scene.sound.mute = next;
    btn.setTexture(next ? MUTE_OFF_TEXTURE : MUTE_ON_TEXTURE);
    // Filter is texture-scoped, not image-scoped — re-apply on each swap so
    // the freshly-bound texture also gets the smooth scaling treatment.
    btn.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  });

  return btn;
}
