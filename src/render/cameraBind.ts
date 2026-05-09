import Phaser from 'phaser';
import { GAME_W } from '../config';
import { DISPLAY_RESIZE_EVENT, displayState } from './displayState';

// Pin a scene's main camera so that world coords (0..GAME_W × 0..logicalH)
// render into the centered scaled rect inside the device-pixel canvas.
//
// Setup:
//   viewport = (offsetX, offsetY, GAME_W*scale, logicalH*scale)  [device px]
//   origin   = (0, 0)
//   zoom     = scale
//   scroll   = (0, 0)
//
// With origin (0, 0) and scroll (0, 0), Phaser's screenX formula
//   screenX = viewport.x + (worldX - scrollX) * zoom + originX*(1-zoom)*viewport.width
// reduces to `screenX = offsetX + worldX * scale` — i.e. world (0, 0)
// → top-left of viewport, world (GAME_W, logicalH) → bottom-right.
//
// pixelArt:true is the renderer-level setting; this function doesn't
// touch it. The GL NEAREST filter applies to every camera, so the
// camera-zoom-by-`scale` here automatically gives nearest-neighbour
// upscaling for textured sprites. Text crispness is handled separately
// (Text.resolution = scale, see textResolution.ts).
//
// Re-pins on DISPLAY_RESIZE_EVENT so window/orientation/fullscreen
// changes flow through the same single recompute path in BootScene.
export function bindLogicalCamera(scene: Phaser.Scene): void {
  const apply = (): void => {
    const cam = scene.cameras?.main;
    if (!cam) return;
    const w = GAME_W * displayState.scale;
    const h = displayState.logicalH * displayState.scale;
    cam.setViewport(displayState.offsetX, displayState.offsetY, w, h);
    cam.setOrigin(0, 0);
    cam.setZoom(displayState.scale);
    cam.setScroll(0, 0);
  };

  apply();
  scene.game.events.on(DISPLAY_RESIZE_EVENT, apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.game.events.off(DISPLAY_RESIZE_EVENT, apply);
  });
}
