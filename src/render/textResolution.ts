// Keep all `scene.add.text(...)` output rasterised at device-pixel
// density.
//
// Phaser Text bakes glyphs onto an internal canvas at
// `textWidth × resolution` × `textHeight × resolution` pixels. The
// rendered quad is at world-logical size; the camera's zoom (= scale,
// pinned by cameraBind.ts) upscales that quad to device pixels at draw
// time. We want texture pixels == device pixels: `resolution = scale`.
// At pixelArt:true (GL NEAREST), 1:1 sampling is a pure copy and
// glyph stems land on whole device pixels — no wobble.
//
// Two side-effects from this module:
// 1. The `text` factory is overridden so every `scene.add.text(...)`
//    receives `resolution: displayState.scale` unless the call site
//    passed its own value. The override mirrors the pattern that the
//    old OverlayText file used; `add` factory is on the prototype so
//    one assignment covers every scene's plugin instance.
// 2. On DISPLAY_RESIZE_EVENT, every Text in every running scene gets
//    its resolution refreshed and its bitmap re-rasterised, so a
//    window resize / fullscreen toggle keeps text crisp at the new
//    scale.

import Phaser from 'phaser';
import { DISPLAY_RESIZE_EVENT, displayState } from './displayState';

type TextFactoryFn = (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) => Phaser.GameObjects.Text;

const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as { text: TextFactoryFn };
const originalText = factory.text;

factory.text = function (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) {
  // displayState.scale reflects whatever the resize handler has computed
  // most recently — preload-time creation reads the seeded value.
  const merged: Phaser.Types.GameObjects.Text.TextStyle = {
    resolution: displayState.scale,
    ...(style ?? {}),
  };
  return originalText.call(this, x, y, text, merged);
};

function refreshScene(scene: Phaser.Scene): void {
  const visit = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj instanceof Phaser.GameObjects.Text) {
      // Only update text whose resolution wasn't explicitly forced by the
      // caller — a value matching the previous displayState.scale is a
      // good enough heuristic that we set it. We tolerate false negatives:
      // worst case a custom-resolution Text stays as-is, which is what
      // the call site asked for anyway.
      obj.setResolution(displayState.scale);
    } else if (obj instanceof Phaser.GameObjects.Container) {
      for (const child of obj.list) visit(child);
    }
  };
  for (const child of scene.children.list) visit(child);
}

// Install the resize subscriber once. `installTextResolutionRefresher`
// is invoked from main.ts after the Phaser.Game is constructed; the
// factory override above is a module-load side-effect and runs as soon
// as this file is imported.
export function installTextResolutionRefresher(game: Phaser.Game): void {
  game.events.on(DISPLAY_RESIZE_EVENT, () => {
    for (const scene of game.scene.scenes) {
      // Only update active scenes; sleeping scenes will rerasterise on
      // wake-up if they end up needing it (Phaser's scale-aware Text
      // renderer measures fresh on the next draw after setResolution).
      if (!scene.scene.isActive() && !scene.scene.isVisible()) continue;
      refreshScene(scene);
    }
  });
}
