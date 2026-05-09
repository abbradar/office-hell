// OverlayImage: a Phaser.GameObjects.Image subclass whose render call
// enqueues a draw record onto the high-resolution overlay canvas (see
// textOverlay.ts) instead of pushing geometry into Phaser's own pipeline.
// Used for keyboard input-prompt icons, which need to sit visually crisp
// next to overlay-rendered text.
//
// We attach a 1×1 transparent placeholder texture so Phaser's Image
// machinery (size component, transform, container participation) has
// something to work with. The placeholder is never sampled — our render
// methods enqueue a record carrying the original SVG HTMLImageElement,
// and the overlay flush rasterises that to a tinted scratch canvas at
// the exact device-pixel size before drawing.

import Phaser from 'phaser';
import { enqueueOverlayIcon } from './textOverlay';

const PLACEHOLDER_TEXTURE = '__OVERLAY_IMAGE_PLACEHOLDER__';

function ensurePlaceholderTexture(scene: Phaser.Scene): void {
  const tm = scene.textures;
  if (tm.exists(PLACEHOLDER_TEXTURE)) return;
  // 1×1 fully transparent canvas. Frame size = 1×1 means displayWidth
  // tracks scaleX directly, so setDisplaySize(w, h) leaves us with
  // matrix.a = w (and matching .d = h) — the overlay flush reads those
  // off the calc matrix to size the rasterised SVG.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  tm.addCanvas(PLACEHOLDER_TEXTURE, canvas);
}

const tempCamMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const tempSpriteMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const tempCalcMatrix = new Phaser.GameObjects.Components.TransformMatrix();

function computeCalcMatrix(
  src: OverlayImage,
  camera: Phaser.Cameras.Scene2D.Camera,
  parentMatrix: Phaser.GameObjects.Components.TransformMatrix | undefined,
): Phaser.GameObjects.Components.TransformMatrix {
  // Mirrors Phaser's GetCalcMatrix — same logic as in OverlayText.
  tempSpriteMatrix.applyITRS(src.x, src.y, src.rotation, src.scaleX, src.scaleY);
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
  src: OverlayImage,
  camera: Phaser.Cameras.Scene2D.Camera,
  parentMatrix: Phaser.GameObjects.Components.TransformMatrix | undefined,
): void {
  if (!src.willRender(camera)) return;
  camera.addToRenderList(src);
  const matrix = computeCalcMatrix(src, camera, parentMatrix);
  enqueueOverlayIcon(src, matrix, camera.alpha * src.alpha);
}

export class OverlayImage extends Phaser.GameObjects.Image {
  // Set by the overlay flush — kept on the instance so the source
  // structurally matches OverlayImageSource without an extra wrapper.
  svgImg: HTMLImageElement;
  iconName: string;
  iconTint: number;

  constructor(scene: Phaser.Scene, x: number, y: number, svgImg: HTMLImageElement, iconName: string, iconTint: number) {
    ensurePlaceholderTexture(scene);
    super(scene, x, y, PLACEHOLDER_TEXTURE);
    this.svgImg = svgImg;
    this.iconName = iconName;
    this.iconTint = iconTint;
  }

  // Phaser's renderer dispatches via obj.renderWebGL(...) — defining a
  // same-named method on the subclass shadows the inherited TextureRender
  // mixin so our enqueue path runs instead of WebGL geometry upload.
  renderWebGL(
    _renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    src: OverlayImage,
    camera: Phaser.Cameras.Scene2D.Camera,
    parentMatrix?: Phaser.GameObjects.Components.TransformMatrix,
  ): void {
    queueRender(src, camera, parentMatrix);
  }

  renderCanvas(
    _renderer: Phaser.Renderer.Canvas.CanvasRenderer,
    src: OverlayImage,
    camera: Phaser.Cameras.Scene2D.Camera,
    parentMatrix?: Phaser.GameObjects.Components.TransformMatrix,
  ): void {
    queueRender(src, camera, parentMatrix);
  }
}
