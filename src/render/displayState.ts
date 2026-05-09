// Shared state for the world-on-native-canvas display geometry.
//
// The canvas internal is sized at native device pixels (parent CSS × DPR),
// so a canvas-internal pixel == a real device pixel. World content lives
// in logical coords (0..GAME_W × 0..logicalH) and is rendered into a
// centered, scaled-up rect inside the canvas via the main camera's
// viewport + zoom (see cameraBind.ts). Camera zoom = `scale`; with
// pixelArt:true (GL NEAREST filter), this gives nearest-neighbour
// upscaling for sprite textures during the regular draw pass — no second
// canvas, no render target.
//
// `logicalH` matches the existing computeCanvasH formula: GAME_H on
// desktop (portrait window letterboxes), or parent-aspect-fitted on
// touch (canvas fills phone vertically with the touch-button band).
//
// Single writer: BootScene's resize handler. Readers:
// - cameraBind.ts (viewport + zoom)
// - factory override for Text (resolution at creation)
// - on-resize walker that calls setResolution on existing Text
// - any pointer code that converts canvas-internal → logical (use the
//   camera's getWorldPoint or pointer.worldX/worldY in normal cases).
export const displayState = {
  // Canvas-internal pixels per logical pixel. Camera zoom uses this so
  // logical world coords expand to device pixels with pixelArt NEAREST.
  scale: 1,
  // Top-left of the rendered world rect in canvas-internal pixels. Non-
  // zero when the canvas is wider/taller than the world's aspect (then
  // the leftover bands stay at canvas backgroundColor).
  offsetX: 0,
  offsetY: 0,
  // World height in logical pixels. Matches computeCanvasH(parent) so
  // touch devices keep their extended button-band area.
  logicalH: 0,
  // Canvas internal size in device pixels. Mirrors phaser canvas.width/h.
  canvasW: 0,
  canvasH: 0,
};

// Event fired on the Phaser.Game event emitter after displayState has
// been updated. Subscribers (camera bind, text resolution refresher) re-
// read displayState; we don't pass it as an arg so late subscribers
// always see the live value.
export const DISPLAY_RESIZE_EVENT = 'display-resize';
