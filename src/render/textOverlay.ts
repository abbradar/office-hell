// Renders all `scene.add.text(...)` output onto a sibling DOM canvas at the
// real screen-pixel resolution, layered on top of the (logical-resolution,
// nearest-neighbour-upscaled) Phaser canvas.
//
// Why two canvases: Phaser is configured with pixelArt + Scale.FIT, which
// gives chunky pixels for the game world but turns text — whose stems would
// land on integer logical pixels — into wobbly, unevenly-stemmed glyphs at
// non-integer display ratios. Drawing text on a canvas at the actual CSS-px
// × DPR resolution dodges the upscale entirely.
//
// The Phaser-side hand-off is OverlayText: a Text subclass whose render
// method enqueues a draw record (matrix + alpha + a live `src` reference)
// onto our queue instead of pushing geometry into Phaser's WebGL pipeline.
// The queue is flushed in Phaser's POST_RENDER, after every scene has run
// its render pass, so the overlay always sits on top.
//
// Coordinates: GetCalcMatrix in OverlayText produces a matrix in Phaser
// canvas-internal pixel space (= logical pixels, since the Phaser canvas's
// internal size is GAME_W × GAME_H). The overlay canvas's internal size is
// CSS px × DPR, so we multiply the matrix by `displayScale × DPR` per axis
// to project into overlay coords. Scale.FIT keeps aspect, so the same
// scale applies to both axes.

import Phaser from 'phaser';
import { GAME_W } from '../config';

interface QueuedDraw {
  // The live OverlayText/Text source. We keep a reference (not snapshots
  // of style/text) so that style mutations between render and POST_RENDER
  // — which can't happen in practice, since no game code runs between
  // those — would still produce a coherent image. The matrix is captured
  // because Phaser's GetCalcMatrix recycles a shared temp.
  src: Phaser.GameObjects.Text;
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  alpha: number;
}

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
    const text = src.text;
    if (!text) continue;

    overlayCtx.setTransform(d.a * scale, d.b * scale, d.c * scale, d.d * scale, d.tx * scale, d.ty * scale);
    overlayCtx.globalAlpha = d.alpha;

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

  queue.length = 0;
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.globalAlpha = 1;
}
