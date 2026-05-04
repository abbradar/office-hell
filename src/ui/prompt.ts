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
import { getInputIcon, type InputAction, type InputIcon, iconTextureKey, nearestIconRenderSize } from './inputIcons';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

const TOKEN_RE = /<([a-zA-Z]+)>/g;

// Lower bound on icon height regardless of text size. The smallest
// preloaded SVG raster size is 22px (see ICON_RENDER_SIZES); requesting
// less just snaps to that anyway, so this floor keeps prompt math honest.
const MIN_ICON_PX = 22;
// Multiplier on text height for icons. Larger than 1.0 because icons are
// "iconographic" and should pop next to text, not sit at x-height.
const DEFAULT_ICON_RATIO = 1.6;

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

// Pixel fonts (Press Start 2P, Silkscreen) leave generous descender padding
// even though uppercase prompts ("START", "PRACTICE") use no descenders, so
// Text.height extends well below the visible glyph. With setOrigin(0, 0.5)
// the bbox *center* lands at yPos but the visible glyph center sits below
// it — and a square icon centered at yPos ends up looking too high next to
// the text. To compensate, measure the visible cap-mid for the style and
// shift icons down by the delta. Cached per (family, weight, size).
const capMidOffsetCache = new Map<string, number>();

function capMidOffset(style: Style): number {
  const family = style.fontFamily ?? 'sans-serif';
  const px = fontSizePx(style);
  const weight = style.fontStyle ?? '';
  const sig = `${weight}|${family}|${px}`;
  const cached = capMidOffsetCache.get(sig);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return 0;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  ctx.font = `${weight} ${px}px ${family}`.trim();
  ctx.textBaseline = 'alphabetic';
  // 'M' has no descender and a clean cap-top — its actualBoundingBox gives
  // a tight visual bound on uppercase glyph height.
  const cap = ctx.measureText('M');
  // Phaser's Text uses '|MÉqgy' to size its bbox (covers ascenders + descenders).
  // Match that here so we're comparing against the same height the prompt sees.
  const full = ctx.measureText('|MÉqgy');
  const ascent = full.actualBoundingBoxAscent ?? 0;
  const descent = full.actualBoundingBoxDescent ?? 0;
  const capAscent = cap.actualBoundingBoxAscent ?? ascent;
  // bbox center (baseline-relative, +down): (descent - ascent) / 2
  // cap-mid (baseline-relative, +down):     -capAscent / 2
  // offset (cap-mid relative to bbox center, +down):
  const offset = (ascent - descent - capAscent) / 2;
  capMidOffsetCache.set(sig, offset);
  return offset;
}

export type PromptOpts = {
  // Each line is laid out left-to-right with this gap (px) between adjacent
  // children — text and icons alike.
  gap?: number;
  // Pixel height of an icon. Default: max(MIN_ICON_PX, fontSize × 1.6) — see
  // the constants above for the rationale. Snapped to the nearest preloaded
  // SVG render size so the icon is rasterised at exactly the displayed size.
  iconHeight?: number;
  // Vertical distance between successive lines. Default: 1.4× text size.
  lineHeight?: number;
  // Horizontal alignment of each line within the container. The container
  // itself is positioned at (x, y); alignment shifts each line's content
  // around its own center/edge.
  align?: 'left' | 'center' | 'right';
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
  // Snap requested icon height to the nearest preloaded render size — that
  // way the SVG was already rasterised at exactly this dimension and we
  // can render 1:1, no scaling and no interpolation.
  const requestedH = opts.iconHeight ?? Math.max(MIN_ICON_PX, Math.round(fontPx * DEFAULT_ICON_RATIO));
  const iconH = nearestIconRenderSize(requestedH);
  const gap = opts.gap ?? 4;
  // Line height tracks whichever is taller — text or icon — so adjacent
  // lines don't overlap when icons exceed the font's own line box.
  const lineH = opts.lineHeight ?? Math.max(iconH + 4, Math.round(fontPx * 1.4));
  const align = opts.align ?? 'center';

  const container = scene.add.container(Math.round(x), Math.round(y));
  const lines = template.split('\n');
  let totalWidth = 0;
  // See capMidOffset — pixel fonts need icons nudged onto the visible cap-mid.
  const iconYOffset = Math.round(capMidOffset(style));

  for (let li = 0; li < lines.length; li++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by lines.length
    const segments = parseLine(lines[li]!);

    // Build children first (we need their measured widths to compute layout).
    type Child = Phaser.GameObjects.Image | Phaser.GameObjects.Text;
    const children: Child[] = [];
    let lineW = 0;

    for (const seg of segments) {
      if (seg.kind === 'text') {
        const t = scene.add.text(0, 0, seg.text, style).setOrigin(0, 0.5);
        children.push(t);
        lineW += t.width;
      } else {
        for (let ii = 0; ii < seg.icons.length; ii++) {
          // biome-ignore lint/style/noNonNullAssertion: bounded by seg.icons.length
          const icon = seg.icons[ii]!;
          // Use the texture preloaded at our snapped iconH — rasterised by
          // the browser's SVG renderer at exactly this size, so no scaling
          // or filtering needed; the image renders 1:1.
          const img = scene.add.image(0, 0, iconTextureKey(icon, iconH)).setOrigin(0, 0.5);
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
    for (const seg of segments) {
      if (seg.kind === 'text') {
        // biome-ignore lint/style/noNonNullAssertion: index bounded by children.length
        const t = children[i++]! as Phaser.GameObjects.Text;
        t.setPosition(cx, yPos);
        cx += t.width;
      } else {
        for (let ii = 0; ii < seg.icons.length; ii++) {
          // biome-ignore lint/style/noNonNullAssertion: index bounded by children.length
          const img = children[i++]! as Phaser.GameObjects.Image;
          // Snap each icon to integer pixels — preceding Text.width is
          // fractional, so accumulating cx leaves icons on subpixel
          // positions otherwise. With pixel-perfect SVG textures this would
          // re-introduce the asymmetric blur we switched off PNG to fix.
          img.setPosition(Math.round(cx), yPos + iconYOffset);
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
