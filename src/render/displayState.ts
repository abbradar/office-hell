import type Phaser from 'phaser';

// Shared geometry for the world-to-screen blit. The world is rendered into a
// fixed logical-size buffer (GAME_W × logicalH). The buffer is then drawn to
// the visible canvas at `worldScale` zoom, offset by `worldOffsetX/Y` so the
// blit is centered when the canvas aspect doesn't match logical aspect.
//
// BootScene's RESIZE handler is the single writer. UIScene reads it to size
// the display image; world-side pointer code reads it via screenToLogical()
// to recover logical coordinates from canvas-pixel pointer events.
export const displayState = {
  // canvas height ÷ logicalH. Always > 0; non-integer in the typical case.
  worldScale: 1,
  // Where the logical buffer sits inside the screen-sized canvas, in canvas
  // pixels. Canvas is centered horizontally, top-anchored vertically (the
  // touch band already extends the logical buffer to the device aspect on
  // touch, so vertical centering would double-count).
  worldOffsetX: 0,
  worldOffsetY: 0,
  // The logical buffer's height in logical pixels. Equals GAME_H on desktop;
  // larger on touch devices (see canvasSize.ts). Read by anything that needs
  // to know the logical extent without going through scene.scale.
  logicalH: 0,
};

// Map a canvas-pixel pointer position back to logical world coordinates.
// World-side hit tests (touch buttons in GameScene, world-space click
// targets) call this; UI-side hits (the UIScene's own buttons) read pointer
// coords directly because the UIScene runs at canvas resolution 1:1.
export function screenToLogical(pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const s = displayState.worldScale || 1;
  return {
    x: (pointer.x - displayState.worldOffsetX) / s,
    y: (pointer.y - displayState.worldOffsetY) / s,
  };
}
