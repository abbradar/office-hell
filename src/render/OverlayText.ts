// OverlayText: a Phaser.GameObjects.Text subclass whose render call enqueues
// a draw record onto the high-resolution overlay canvas (see textOverlay.ts)
// instead of pushing geometry into Phaser's own pipeline. The Phaser-side
// Text machinery — internal canvas, measureText-based width/height, font
// metrics, container/tween participation — stays intact; only the final
// pixels go elsewhere.
//
// This module's import side-effect also overrides the global `text` factory
// so every `scene.add.text(...)` call in the codebase produces an
// OverlayText with no per-call-site changes.

import Phaser from 'phaser';
import { enqueueOverlayText } from './textOverlay';

// Reused across every OverlayText render call — Phaser does the same with
// its own GetCalcMatrix temps. Safe because we copy the matrix scalars
// into the queued draw record immediately, before the next render call.
const tempCamMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const tempSpriteMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const tempCalcMatrix = new Phaser.GameObjects.Components.TransformMatrix();

function computeCalcMatrix(
  src: Phaser.GameObjects.Text,
  camera: Phaser.Cameras.Scene2D.Camera,
  parentMatrix: Phaser.GameObjects.Components.TransformMatrix | undefined,
): Phaser.GameObjects.Components.TransformMatrix {
  // Mirrors Phaser's GetCalcMatrix: applyITRS(x, y, rot, sx, sy) for the
  // sprite, copy camera.matrix, fold in the parent matrix when the object
  // lives inside a Container, then multiply (camera × sprite) into calc.
  // Replicated here rather than imported because Phaser's
  // `GetCalcMatrix` isn't part of the published TS surface.
  tempSpriteMatrix.applyITRS(src.x, src.y, src.rotation, src.scaleX, src.scaleY);
  // `camera.matrix` exists on every camera but isn't surfaced in Phaser's
  // public TS types. Cast through the runtime shape we know it has.
  const cameraMatrix = (camera as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix;
  tempCamMatrix.copyFrom(cameraMatrix);

  if (parentMatrix) {
    tempCamMatrix.multiplyWithOffset(
      parentMatrix,
      -camera.scrollX * src.scrollFactorX,
      -camera.scrollY * src.scrollFactorY,
    );
    tempSpriteMatrix.e = src.x;
    tempSpriteMatrix.f = src.y;
  } else {
    tempSpriteMatrix.e -= camera.scrollX * src.scrollFactorX;
    tempSpriteMatrix.f -= camera.scrollY * src.scrollFactorY;
  }

  tempCamMatrix.multiply(tempSpriteMatrix, tempCalcMatrix);
  return tempCalcMatrix;
}

function queueRender(
  src: OverlayText,
  camera: Phaser.Cameras.Scene2D.Camera,
  parentMatrix: Phaser.GameObjects.Components.TransformMatrix | undefined,
): void {
  // Skip empty/zero-sized objects — Phaser's own TextWebGLRenderer does
  // the same to avoid uploading degenerate quads, and our overlay path
  // would just draw nothing anyway.
  if (src.width === 0 || src.height === 0) return;
  if (!src.willRender(camera)) return;

  camera.addToRenderList(src);
  const matrix = computeCalcMatrix(src, camera, parentMatrix);
  enqueueOverlayText(src, matrix, camera.alpha * src.alpha);
}

export class OverlayText extends Phaser.GameObjects.Text {
  // Override the methods the TextRender mixin attached to the Text
  // prototype. Phaser's renderer calls obj.renderWebGL(...) directly, so
  // a same-named method on the subclass shadows the inherited one.
  renderWebGL(
    _renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    src: OverlayText,
    camera: Phaser.Cameras.Scene2D.Camera,
    parentMatrix?: Phaser.GameObjects.Components.TransformMatrix,
  ): void {
    queueRender(src, camera, parentMatrix);
  }

  renderCanvas(
    _renderer: Phaser.Renderer.Canvas.CanvasRenderer,
    src: OverlayText,
    camera: Phaser.Cameras.Scene2D.Camera,
    parentMatrix?: Phaser.GameObjects.Components.TransformMatrix,
  ): void {
    queueRender(src, camera, parentMatrix);
  }
}

// Override the `text` factory at module load. Phaser's
// GameObjectFactory.register is a no-op when the key already exists (and
// Phaser registered its own 'text' during boot), so we assign directly to
// the prototype instead. New scenes still get the factory via Phaser's
// plugin/PluginCache wiring, which adds GameObjectFactory under the name
// `add` — that prototype lookup walks up to our override.
type TextFactoryFn = (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) => Phaser.GameObjects.Text;

(Phaser.GameObjects.GameObjectFactory.prototype as unknown as { text: TextFactoryFn }).text = function (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) {
  // Phaser's TS types pin `style` as required; the runtime accepts
  // undefined (and substitutes its own defaults). Cast to keep the
  // factory signature open while satisfying the constructor type.
  const t = new OverlayText(this.scene, x, y, text, style as Phaser.Types.GameObjects.Text.TextStyle);
  this.displayList.add(t);
  return t;
};
