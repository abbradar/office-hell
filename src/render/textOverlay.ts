// Renders all `scene.add.text(...)` output (and OverlayImage icon sprites)
// onto a sibling DOM canvas at the real screen-pixel resolution, layered
// on top of the (logical-resolution, nearest-neighbour-upscaled) Phaser
// canvas.
//
// Why two canvases: Phaser is configured with pixelArt + Scale.FIT, which
// gives chunky pixels for the game world but turns text — whose stems would
// land on integer logical pixels — into wobbly, unevenly-stemmed glyphs at
// non-integer display ratios. Drawing text on a canvas at the actual CSS-px
// × DPR resolution dodges the upscale entirely. The same path also serves
// SVG icons in keyboard prompts: rasterising the source SVG at exact
// device-pixel size keeps icons as crisp as the text next to them.
//
// The Phaser-side hand-off is OverlayText / OverlayImage: GameObject
// subclasses whose render methods enqueue a draw record (matrix + alpha +
// a live `src` reference) onto our queue instead of pushing geometry into
// Phaser's WebGL pipeline. The queue is flushed in Phaser's POST_RENDER,
// after every scene has run its render pass, so the overlay always sits
// on top.
//
// Coordinates: GetCalcMatrix in OverlayText / OverlayImage produces a
// matrix in Phaser canvas-internal pixel space (= logical pixels, since
// the Phaser canvas's internal size is GAME_W × GAME_H). The overlay
// canvas's internal size is CSS px × DPR, so we multiply the matrix by
// `displayScale × DPR` per axis to project into overlay coords. Scale.FIT
// keeps aspect, so the same scale applies to both axes.

import Phaser from 'phaser';
import { GAME_W } from '../config';

// Live source object for an icon draw. Phaser.GameObjects.Image already
// exposes scene/alpha/displayOriginX/displayOriginY/width/height; the
// other fields are added by OverlayImage and tell us how to rasterise the
// SVG. We keep a structural type rather than importing OverlayImage to
// avoid a cycle (OverlayImage imports this module's enqueueOverlayIcon).
export interface OverlayImageSource {
  scene: Phaser.Scene | null;
  alpha: number;
  displayOriginX: number;
  displayOriginY: number;
  width: number;
  height: number;
  svgImg: HTMLImageElement;
  iconName: string;
  iconTint: number;
}

interface BaseQueued {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  alpha: number;
}

type QueuedDraw =
  | (BaseQueued & { kind: 'text'; src: Phaser.GameObjects.Text })
  | (BaseQueued & { kind: 'icon'; src: OverlayImageSource });

const queue: QueuedDraw[] = [];
let overlayCanvas: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;
let phaserCanvas: HTMLCanvasElement | null = null;
let displayScale = 1;
let dpr = 1;

export function enqueueOverlayText(
  src: Phaser.GameObjects.Text,
  matrix: Phaser.GameObjects.Components.TransformMatrix,
  alpha: number,
): void {
  queue.push({
    kind: 'text',
    src,
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    // Phaser's TransformMatrix exposes the translation as e/f (matching the
    // standard a-f naming); Canvas2D setTransform takes the same six values.
    tx: matrix.e,
    ty: matrix.f,
    alpha,
  });
}

export function enqueueOverlayIcon(
  src: OverlayImageSource,
  matrix: Phaser.GameObjects.Components.TransformMatrix,
  alpha: number,
): void {
  queue.push({
    kind: 'icon',
    src,
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    tx: matrix.e,
    ty: matrix.f,
    alpha,
  });
}

export function installTextOverlay(game: Phaser.Game): void {
  phaserCanvas = game.canvas;
  const parent = phaserCanvas.parentElement;
  if (!parent) {
    throw new Error('text overlay: phaser canvas has no parent at install time');
  }

  // Absolute-positioned children pin to the nearest positioned ancestor;
  // #viewport is statically positioned in index.html, so make it relative
  // here instead of forcing it from CSS (which would also move the Phaser
  // canvas around in some browsers).
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.id = 'text-overlay';
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.pointerEvents = 'none';
  // Ensure the overlay paints above the phaser canvas regardless of
  // source order or nested stacking contexts.
  overlayCanvas.style.zIndex = '1';
  parent.appendChild(overlayCanvas);

  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) throw new Error('text overlay: failed to acquire 2D context');
  overlayCtx = ctx;

  syncOverlay();

  // Re-sync whenever Phaser's canvas changes shape — fullscreen flip,
  // orientation flip, address-bar show/hide, or the BootScene's RESIZE
  // handler calling setGameSize. Listening to RESIZE catches all of those.
  game.scale.on(Phaser.Scale.Events.RESIZE, syncOverlay);

  // Flush right after every scene has rendered. Each OverlayText pushed
  // its draw record during its scene's render pass; POST_RENDER is the
  // single point where we know we have all of them, in render order.
  game.events.on(Phaser.Core.Events.POST_RENDER, flushOverlay);
}

function syncOverlay(): void {
  if (!overlayCanvas || !phaserCanvas) return;
  const parent = phaserCanvas.parentElement;
  if (!parent) return;

  const rect = phaserCanvas.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  dpr = window.devicePixelRatio || 1;

  // Display geometry just changed (DPR/displayScale) — every cached
  // tinted-icon canvas is now at the wrong resolution. Drop them so the
  // next frame rebuilds at the new device-pixel size.
  iconCache.clear();

  // CSS placement matches the phaser canvas exactly so the overlay sits
  // edge-aligned, including any FIT centering offset Phaser applies via
  // margins. clientRect is laid out in viewport space; subtracting the
  // parent rect converts to parent-relative offsets.
  overlayCanvas.style.left = `${rect.left - parentRect.left}px`;
  overlayCanvas.style.top = `${rect.top - parentRect.top}px`;
  overlayCanvas.style.width = `${rect.width}px`;
  overlayCanvas.style.height = `${rect.height}px`;

  // Internal pixel grid: real-screen-pixel resolution, so glyph stems land
  // on whole device pixels rather than getting nearest-sampled by the
  // browser the way the phaser canvas content is.
  const internalW = Math.max(1, Math.round(rect.width * dpr));
  const internalH = Math.max(1, Math.round(rect.height * dpr));
  if (overlayCanvas.width !== internalW) overlayCanvas.width = internalW;
  if (overlayCanvas.height !== internalH) overlayCanvas.height = internalH;

  // Logical → CSS scale. Phaser canvas internal width is the logical width
  // (GAME_W); rect.width is its on-screen CSS size.
  displayScale = rect.width > 0 ? rect.width / GAME_W : 1;
}

function flushOverlay(): void {
  if (!overlayCtx || !overlayCanvas) return;

  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (queue.length === 0) return;

  // Single uniform scale because Scale.FIT preserves aspect — same factor
  // applies to x and y.
  const scale = displayScale * dpr;

  for (const d of queue) {
    const src = d.src;
    // Scene teardown can null out `scene` between render and flush in
    // pathological orderings; skip rather than crash.
    if (!src.scene) continue;

    overlayCtx.globalAlpha = d.alpha;

    if (d.kind === 'text') {
      // Text path uses the matrix-encoded transform: fillText handles
      // sub-pixel positioning via font hinting, so the scaled transform
      // is exactly what we want.
      overlayCtx.setTransform(d.a * scale, d.b * scale, d.c * scale, d.d * scale, d.tx * scale, d.ty * scale);
      drawText(d.src);
    } else {
      // Icon path snaps to integer device pixels (see drawIcon for why);
      // it sets its own identity transform.
      drawIcon(d.src, d.a, d.b, d.c, d.d, d.tx, d.ty, scale);
    }
  }

  queue.length = 0;
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.globalAlpha = 1;
}

function drawText(src: Phaser.GameObjects.Text): void {
  if (!overlayCtx) return;
  const text = src.text;
  if (!text) return;

  // Phaser's TextStyle keeps the assembled CSS font string in `_font`
  // (composed of fontStyle + fontSize + fontFamily) for its own
  // measurement pass. Reusing it directly is faster than re-assembling
  // and guarantees the font matches whatever Phaser measured against.
  const style = src.style;
  overlayCtx.font = (style as unknown as { _font: string })._font;
  overlayCtx.fillStyle = style.color ?? '#fff';
  overlayCtx.textBaseline = 'alphabetic';

  const metrics = style.getTextMetrics();
  const ascent = metrics.ascent ?? 0;
  // Distance between successive baselines: Phaser uses fontSize +
  // strokeThickness for `lineHeight`, and adds `lineSpacing` between
  // lines. Stroke is unused in this codebase, so the simple form is
  // enough; if stroke ever gets added we'll need to mirror it here.
  const lineStep = (metrics.fontSize ?? 0) + (src.lineSpacing ?? 0);

  // Bitmap top-left in the GameObject's local frame is at
  // (-displayOriginX, -displayOriginY); Phaser's first-line baseline
  // sits at `ascent` below that. textBaseline=alphabetic anchors at
  // the baseline, so add `ascent` to the y of each line.
  const baseX = -src.displayOriginX;
  let baseY = -src.displayOriginY + ascent;

  // Re-run Phaser's word-wrap so multi-line wrapping (e.g. the
  // CharacterSelect blurbs) reaches the overlay. `src.text` is the
  // *unwrapped* original string; updateText folds it through
  // runWordWrap(text) into a newline-injected form before measuring +
  // rasterising. We need the same form to draw the same lines.
  // Without wordWrap configured, runWordWrap returns the input as-is.
  const wrapped = src.runWordWrap(text);
  const lines = wrapped.split('\n');
  // Phaser aligns multi-line text within the bitmap's `textWidth`
  // (the max line width) by shifting each line's start x. `src.width`
  // matches that bitmap width when there's no fixedWidth/padding.
  const align = (src.style as unknown as { align?: string }).align ?? 'left';
  const textWidth = src.width;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let lineX = baseX;
    if (align === 'right' || align === 'center') {
      const lineW = overlayCtx.measureText(line).width;
      lineX += align === 'right' ? textWidth - lineW : (textWidth - lineW) / 2;
    }
    overlayCtx.fillText(line, lineX, baseY);
    baseY += lineStep;
  }
}

// Cache of pre-tinted icon canvases. Each entry is rasterised at exactly
// the device-pixel size that drawIcon needs (so the eventual drawImage
// onto the overlay is a 1:1 copy with no interpolation). Keyed by name +
// tint + integer width × height; cleared on syncOverlay (DPR / scale
// change invalidates every entry).
const iconCache = new Map<string, HTMLCanvasElement>();
// Soft cap: aggregate window resizes during a session can churn the cache.
// 256 is generous for the ~14 keyboard glyphs × a couple of tints we use,
// and keeps memory bounded if the cache invalidation logic ever misses.
const ICON_CACHE_LIMIT = 256;

function tintToCss(tint: number): string {
  return `#${(tint & 0xffffff).toString(16).padStart(6, '0')}`;
}

function getTintedIcon(
  svg: HTMLImageElement,
  name: string,
  tint: number,
  pxW: number,
  pxH: number,
): HTMLCanvasElement | null {
  const key = `${name}|${tint}|${pxW}x${pxH}`;
  const hit = iconCache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  // Rasterise the SVG to the scratch at exactly the device-pixel size we
  // need, then paint tint colour through the alpha mask. Source SVGs are
  // pure white, so source-in keeps only the painted pixels and replaces
  // their colour with `tint` — equivalent to Phaser's setTint multiply
  // against a white texture.
  ctx.drawImage(svg, 0, 0, pxW, pxH);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tintToCss(tint);
  ctx.fillRect(0, 0, pxW, pxH);

  if (iconCache.size >= ICON_CACHE_LIMIT) {
    // FIFO eviction is enough; recently-seen icons get re-inserted on
    // their next draw and stay hot.
    const firstKey = iconCache.keys().next().value;
    if (firstKey !== undefined) iconCache.delete(firstKey);
  }
  iconCache.set(key, c);
  return c;
}

function drawIcon(
  src: OverlayImageSource,
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
  scale: number,
): void {
  if (!overlayCtx) return;

  // Local-frame size of the icon. Equal to the (placeholder) texture's
  // frame size; the matrix already encodes the per-axis scale that turns
  // it into the on-screen size.
  const localW = src.width;
  const localH = src.height;
  if (localW <= 0 || localH <= 0) return;

  // Per-axis matrix scale — sqrt(a² + b²) and sqrt(c² + d²) handles
  // rotation (the prompt path doesn't rotate icons today, but the math
  // doesn't cost anything extra). Note: a rotated icon would still need
  // the matrix-transform path below to actually rotate it; today every
  // caller is axis-aligned, so we render at integer device pixels which
  // is much sharper than relying on float arithmetic in setTransform to
  // give back the exact source size.
  const xScale = Math.hypot(a, b);
  const yScale = Math.hypot(c, d);
  // Device-pixel size of the icon as it'll appear on the overlay. Round
  // (not ceil) so the scratch matches the eventual on-screen size to
  // within sub-pixel — drawImage source==dest size is a 1:1 copy with no
  // filtering. min 1 to avoid a zero-sized scratch canvas.
  const pxW = Math.max(1, Math.round(localW * xScale * scale));
  const pxH = Math.max(1, Math.round(localH * yScale * scale));

  const tinted = getTintedIcon(src.svgImg, src.iconName, src.iconTint, pxW, pxH);
  if (!tinted) return;

  // Compute the icon's screen-space top-left in device pixels. For the
  // axis-aligned case (b = c = 0), this reduces to translating the
  // local-frame corner (-displayOriginX, -displayOriginY) by the matrix.
  // We then floor to whole device pixels: integer position + integer
  // size guarantees a 1:1 drawImage copy with zero filtering.
  const localX = -src.displayOriginX;
  const localY = -src.displayOriginY;
  const screenX = (a * localX + c * localY + tx) * scale;
  const screenY = (b * localX + d * localY + ty) * scale;
  const dx = Math.round(screenX);
  const dy = Math.round(screenY);

  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.drawImage(tinted, dx, dy, pxW, pxH);
}
