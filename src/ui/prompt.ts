// Mixed text + input-icon prompts.
//
// Templates use `<action>` placeholders that get swapped for the platform's
// icon for that input action (see ui/inputIcons.ts). Plain text passes
// through to a Phaser Text. Multi-line via `\n`. Returns a Container with
// `setSize` already populated so callers can `setInteractive()` directly.
//
// Examples:
//   makePrompt(scene, x, y, '<confirm>  START', FONT_MENU);
//   makePrompt(scene, x, y, '<moveHorizontal>: move\n<fire>: fire',
//              FONT_DEBUG, { align: 'center' });
//
// Touch fallback: when `getInputIcon(action)` returns undefined (current
// touch state), the placeholder renders as `[action]` text so the prompt
// stays readable. For platform-specific phrasing — touch vs keyboard — use
// the `isTouchDevice ? touchTemplate : keyboardTemplate` pattern at the
// call site rather than overloading the template syntax.

import type Phaser from 'phaser';
import { OverlayImage } from '../render/OverlayImage';
import { getInputIcon, getInputIconImage, type InputAction, type InputIcon } from './inputIcons';
import { COLOR_TEXT_PRIMARY } from './palette';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

const TOKEN_RE = /<([a-zA-Z]+)>/g;

// Lower bound on icon height regardless of text size. Holds every prompt
// across the game — menu, character select, dialogue hint, tutorial bubble
// — to the same-size keys regardless of the prompt's own text tier. The
// overlay rasterises at exact device-pixel size on demand, so there's no
// preload-tier constraint pinning this value any more.
const MIN_ICON_PX = 22;
// Multiplier on text height for icons. Slightly larger than 1.0 so icons
// pop next to text without towering over it. Bumped 10% over the original
// 1.2 (which matched the old transparent-padding footprint) to give the
// keys more presence next to body text.
const DEFAULT_ICON_RATIO = 1.32;

type Segment = { kind: 'text'; text: string } | { kind: 'icons'; icons: InputIcon[] };

function parseLine(line: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const idx = m.index;
    if (idx > last) out.push({ kind: 'text', text: line.slice(last, idx) });
    const action = m[1] as InputAction;
    const ref = getInputIcon(action);
    if (ref) {
      const icons = Array.isArray(ref) ? ref : [ref];
      out.push({ kind: 'icons', icons });
    } else {
      // No icon for this action on the active platform — render the action
      // name in brackets so it's at least obvious to the player.
      out.push({ kind: 'text', text: `[${action}]` });
    }
    last = idx + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

// Parse the template's font size, accepting both '16px' strings and bare
// numbers — Phaser's TextStyle allows either.
function fontSizePx(style: Style): number {
  const v = style.fontSize;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return 16;
}

export type PromptOpts = {
  // Each line is laid out left-to-right with this gap (px) between adjacent
  // children — text and icons alike.
  gap?: number;
  // Pixel height of an icon. Default: max(MIN_ICON_PX, fontSize × 1.6) —
  // see the constants above for the rationale. Used as both width and
  // height; the overlay rasterises the SVG at exact device-pixel size on
  // demand, so any value works and stays crisp.
  iconHeight?: number;
  // Vertical distance between successive lines. Default: 1.4× text size.
  lineHeight?: number;
  // Horizontal alignment of each line within the container. The container
  // itself is positioned at (x, y); alignment shifts each line's content
  // around its own center/edge.
  align?: 'left' | 'center' | 'right';
  // Tint applied to icon images. Source SVGs are white, so the tint
  // multiplies straight through to the target colour. Defaults to the
  // primary text colour so icons read as dark glyphs on the light UI;
  // pass `0xffffff` to opt out (identity tint = white icons unchanged),
  // or any other 24-bit color to force a specific shade.
  iconTint?: number;
};

export function makePrompt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  template: string,
  style: Style,
  opts: PromptOpts = {},
): Phaser.GameObjects.Container {
  const fontPx = fontSizePx(style);
  const iconH = opts.iconHeight ?? Math.max(MIN_ICON_PX, Math.round(fontPx * DEFAULT_ICON_RATIO));
  const gap = opts.gap ?? 4;
  // Line height tracks whichever is taller — text or icon — so adjacent
  // lines don't overlap when icons exceed the font's own line box.
  const lineH = opts.lineHeight ?? Math.max(iconH + 4, Math.round(fontPx * 1.4));
  const align = opts.align ?? 'center';
  const iconTint = opts.iconTint ?? COLOR_TEXT_PRIMARY;

  const container = scene.add.container(Math.round(x), Math.round(y));
  const lines = template.split('\n');
  let totalWidth = 0;

  for (let li = 0; li < lines.length; li++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by lines.length
    const segments = parseLine(lines[li]!);

    // Build children first (we need their measured widths to compute layout).
    type Child = Phaser.GameObjects.Image | Phaser.GameObjects.Text;
    const children: Child[] = [];
    // Per-text vertical nudge. Phaser's font-level ascent/descent come from
    // the testString '|MÃ‰qgy' (includes descenders + accents) so they don't
    // tell us where the *specific* text's ink actually sits inside the bbox.
    // Measure the rendered string's actual bounding box and align its ink
    // midline to icon centers instead.
    const textYOffsets: number[] = [];
    let lineW = 0;

    for (const seg of segments) {
      if (seg.kind === 'text') {
        const t = scene.add.text(0, 0, seg.text, style).setOrigin(0, 0.5);
        const fontMetrics = t.style.getTextMetrics();
        const fontAscent = typeof fontMetrics.ascent === 'number' ? fontMetrics.ascent : fontPx;
        // Phaser draws the baseline at canvas-y `fontAscent`. Measure where
        // ink actually starts/ends for THIS string against THIS font, then
        // compute its midline relative to bbox center (canvas-y h/2).
        const ctx = t.context;
        const im = ctx.measureText(seg.text);
        const inkAscent = im.actualBoundingBoxAscent;
        const inkDescent = im.actualBoundingBoxDescent;
        // Ink top in canvas-y: fontAscent - inkAscent. Ink bottom: fontAscent + inkDescent.
        // Ink midline in canvas-y: fontAscent + (inkDescent - inkAscent) / 2.
        // Bbox center in canvas-y: t.height / 2. Offset to apply at sprite-y:
        // (bbox center) - (ink midline) — sprite shifts down so ink midline
        // lands at the y the bbox center used to occupy.
        const inkMid = fontAscent + (inkDescent - inkAscent) / 2;
        const bboxMid = t.height / 2;
        textYOffsets.push(Math.round(bboxMid - inkMid));
        children.push(t);
        lineW += t.width;
      } else {
        for (let ii = 0; ii < seg.icons.length; ii++) {
          // biome-ignore lint/style/noNonNullAssertion: bounded by seg.icons.length
          const icon = seg.icons[ii]!;
          const svg = getInputIconImage(icon.name);
          if (!svg) throw new Error(`makePrompt: input icon image '${icon.name}' not loaded`);
          // Overlay path: the SVG is rasterised on demand at exact
          // device-pixel size; tint is baked into the scratch canvas, so
          // no Phaser setTint call needed here.
          const img = new OverlayImage(scene, 0, 0, svg, icon.name, iconTint);
          scene.add.existing(img);
          img.setOrigin(0, 0.5);
          img.setDisplaySize(iconH, iconH);
          children.push(img);
          lineW += img.displayWidth;
          if (ii < seg.icons.length - 1) lineW += gap;
        }
      }
    }

    // Apply per-segment gap *between* logical segments so we don't add a gap
    // between two icons in the same group (handled above) but do separate
    // text-from-icon and segment-from-segment.
    const segmentGapsTotal = Math.max(0, segments.length - 1) * gap;
    lineW += segmentGapsTotal;

    let cx: number;
    if (align === 'center') cx = -lineW / 2;
    else if (align === 'right') cx = -lineW;
    else cx = 0;
    // Snap the line's starting cursor to integer pixels so icons don't end up
    // straddling subpixel boundaries (which can produce visible asymmetry
    // even with sharp rasterised textures).
    cx = Math.round(cx);

    const yPos = li * lineH;
    let i = 0;
    let textIdx = 0;
    for (const seg of segments) {
      if (seg.kind === 'text') {
        // biome-ignore lint/style/noNonNullAssertion: index bounded by children.length
        const t = children[i++]! as Phaser.GameObjects.Text;
        // biome-ignore lint/style/noNonNullAssertion: parallel to children
        const dy = textYOffsets[textIdx++]!;
        t.setPosition(cx, yPos + dy);
        cx += t.width;
      } else {
        for (let ii = 0; ii < seg.icons.length; ii++) {
          // biome-ignore lint/style/noNonNullAssertion: index bounded by children.length
          const img = children[i++]! as Phaser.GameObjects.Image;
          // Snap each icon to integer pixels — preceding Text.width is
          // fractional, so accumulating cx leaves icons on subpixel
          // positions otherwise. With pixel-perfect SVG textures this would
          // re-introduce the asymmetric blur we switched off PNG to fix.
          img.setPosition(Math.round(cx), yPos);
          cx += img.displayWidth;
          if (ii < seg.icons.length - 1) cx += gap;
        }
      }
      cx += gap;
    }

    for (const child of children) container.add(child);
    if (lineW > totalWidth) totalWidth = lineW;
  }

  // Centre vertically around y so callers don't have to compensate for
  // multi-line layouts. Origin convention matches `setOrigin(0.5)` text.
  const totalHeight = lines.length * lineH;
  container.setSize(totalWidth, totalHeight);
  container.y -= Math.round((lines.length - 1) * lineH * 0.5);

  return container;
}
