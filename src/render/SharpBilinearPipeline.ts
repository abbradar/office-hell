import Phaser from 'phaser';
import { GAME_W } from '../config';
import { displayState } from './displayState';

// Sharp-bilinear post-FX. Applied to each scene's main camera by
// bindLogicalCamera. The camera's viewport is pinned to (0, 0, GAME_W,
// logicalH) so content lives in the upper-left logical-aspect rect of
// the canvas-sized post-FX FBO. `onDraw` runs the default
// `bindAndDraw(target)` which writes to the full canvas viewport;
// per-fragment, the shader decides whether the fragment is inside the
// centered output rect (in which case it samples the content with the
// libretro `sharp-bilinear-simple` formula) or outside (transparent
// alpha so the canvas backgroundColor shows through as side bars).
//
// Sharp-bilinear formula (applied for fragments inside the output rect):
//
//     prescale = max(floor(outputH / contentH), 1)
//     center_dist = fract(uv * contentSize) - 0.5
//     blend = (center_dist - clamp(center_dist, -region, region)) * prescale + 0.5
//     sampleTexel = floor(uv * contentSize) + blend
//     sampleUV    = sampleTexel / fboSize     (X)
//                 = (sampleTexel + (fboH - contentH)) / fboSize  (Y, GL convention)
//
// At any non-integer screen-to-logical ratio, each logical pixel paints
// a clean N-screen-pixel block with one half-blended seam pixel between
// blocks. Reads as pixel-perfect during motion.
//
// Why fragments outside the rect are transparent rather than black:
// `bindAndDraw` clears the FBO before the shader runs (`autoClear=true`
// on the swap target), but our final draw goes to the canvas, not the
// swap target — and the canvas was cleared to game backgroundColor at
// frame start. Writing alpha=0 leaves that color untouched.
//
// pixelArt:true defaults the FBO texture filter to NEAREST. The
// sharp-bilinear seam blend relies on hardware bilinear sampling, so
// onDraw flips the source filter to LINEAR before drawing.

const SHARP_BILINEAR_FRAG = [
  '#define SHADER_NAME SHARP_BILINEAR_FS',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uContentSize;',
  'uniform vec2 uFBOSize;',
  'uniform vec2 uOutputSize;',
  'uniform vec2 uOutputOrigin;', // (offsetX, offsetY) of the output rect on the canvas, GL coords.
  'uniform vec2 uCanvasSize;',
  'varying vec2 outTexCoord;',
  'void main () {',
  // outTexCoord goes 0..1 over the FULL canvas (since bindAndDraw writes
  // to the full canvas viewport). Recover the canvas-pixel position so
  // we can compute UV inside the centered output rect.
  '  vec2 fragPx = outTexCoord * uCanvasSize;',
  // Inside-rect check. Outside the rect: transparent (canvas bg shows).
  '  vec2 rectMin = uOutputOrigin;',
  '  vec2 rectMax = uOutputOrigin + uOutputSize;',
  '  if (fragPx.x < rectMin.x || fragPx.x >= rectMax.x || fragPx.y < rectMin.y || fragPx.y >= rectMax.y) {',
  '    gl_FragColor = vec4(0.0);',
  '    return;',
  '  }',
  // UV inside the output rect, 0..1.
  '  vec2 rectUV = (fragPx - rectMin) / uOutputSize;',
  // Sharp-bilinear math operates on rectUV against content-pixel grid.
  '  float prescale = max(floor(uOutputSize.y / uContentSize.y), 1.0);',
  '  vec2 texelUV = rectUV * uContentSize;',
  '  vec2 c = fract(texelUV) - 0.5;',
  '  vec2 region = vec2(0.5 - 0.5 / prescale);',
  '  vec2 f = (c - clamp(c, -region, region)) * prescale + 0.5;',
  '  vec2 sampleTexel = floor(texelUV) + f;',
  // FBO content lives in the upper image rect (0..contentW, 0..contentH).
  // In GL Y-up that is GL y range (FBO.h - contentH)..FBO.h, so bias .y.
  '  vec2 sampleUV = vec2(sampleTexel.x / uFBOSize.x, (sampleTexel.y + uFBOSize.y - uContentSize.y) / uFBOSize.y);',
  '  gl_FragColor = texture2D(uMainSampler, sampleUV);',
  '}',
].join('\n');

export const SHARP_BILINEAR_PIPELINE = 'SharpBilinear';

type RenderTarget = Phaser.Renderer.WebGL.RenderTarget;

export class SharpBilinearPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: SHARP_BILINEAR_PIPELINE,
      fragShader: SHARP_BILINEAR_FRAG,
    });
  }

  override onDraw(target: RenderTarget): void {
    const gl = this.gl;
    const renderer = this.renderer as Phaser.Renderer.WebGL.WebGLRenderer;

    const contentW = GAME_W;
    const contentH = displayState.logicalH;
    const outputW = Math.round(contentW * displayState.worldScale);
    const outputH = Math.round(contentH * displayState.worldScale);
    const ox = displayState.worldOffsetX;
    // GL Y-up: the visual top of the screen is GL y = canvas.h. Output
    // rect is centered horizontally, top-anchored vertically — top-anchor
    // in image coords means GL y origin = canvas.h - outputH.
    const oyGL = renderer.height - displayState.worldOffsetY - outputH;

    // LINEAR filter on the FBO texture so the sharp-bilinear seam blend
    // gets hardware bilinear sampling. pixelArt:true defaults to NEAREST
    // which would snap the seam to one neighbour and reproduce wobble.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture.webGLTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    this.set2f('uContentSize', contentW, contentH);
    this.set2f('uFBOSize', target.width, target.height);
    this.set2f('uOutputSize', outputW, outputH);
    this.set2f('uOutputOrigin', ox, oyGL);
    this.set2f('uCanvasSize', renderer.width, renderer.height);

    // bindAndDraw with target=null writes to the canvas at the full
    // canvas viewport. Our shader handles centering + sharp-bilinear.
    this.bindAndDraw(target);
  }
}
