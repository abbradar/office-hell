import Phaser from 'phaser';
import { GAME_W } from '../config';
import { displayState } from './displayState';
import { SHARP_BILINEAR_PIPELINE } from './SharpBilinearPipeline';

// Pin a scene's main camera to logical resolution and route its output
// through the sharp-bilinear post-FX. Each playable scene calls this in
// its create() so its world content renders at the same logical pixel
// grid the gameplay code targets — entities, walls, HUD all live in
// (0..GAME_W, 0..logicalH) regardless of the canvas's screen-pixel size.
//
// On display-resize (window drag, fullscreen toggle, address-bar shift)
// BootScene emits a `display-resize` event after recomputing
// displayState. We re-pin the viewport here so a touch device that grew
// its band on rotation gets the new logical height; the post-FX rebinds
// uniforms from displayState on each draw, so worldScale / offsets are
// always live.
export function bindLogicalCamera(scene: Phaser.Scene): void {
  const apply = (): void => {
    const cam = scene.cameras?.main;
    if (!cam) return;
    cam.setViewport(0, 0, GAME_W, displayState.logicalH);
  };

  apply();
  scene.cameras.main.setPostPipeline(SHARP_BILINEAR_PIPELINE);

  scene.game.events.on('display-resize', apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.game.events.off('display-resize', apply);
  });
}
