import type Phaser from 'phaser';
import eazygoinRegularUrl from '../assets/fonts/Eazygoin-Regular.ttf';
import pressStart2PRegularUrl from '../assets/fonts/PressStart2P-Regular.woff2';
import silkscreenBoldUrl from '../assets/fonts/Silkscreen-Bold.woff2';
import silkscreenRegularUrl from '../assets/fonts/Silkscreen-Regular.woff2';

// Self-hosted pixel fonts. Vite fingerprints the imported URLs and the
// FontFace API registers them with the document so Phaser's canvas Text can
// reference them by family name.
//
// Spread one of these into a Phaser Text style and override only `color`,
// `align`, `wordWrap`, etc. — never the font family or size.
//
// Important: Press Start 2P and Silkscreen are *bitmap-style* fonts — their
// glyphs are pixel grids designed for a specific render size. Press Start 2P
// is built for 8px multiples; Silkscreen for 8px multiples too. Render them
// at any other size (say 11px or 18px) and Phaser's canvas anti-aliasing
// smears the single-pixel glyph features into mush. Stick to the multiples
// listed above each FONT_* below, or the small-text helper that uses a
// regular sans-serif.
const TITLE_FAMILY = '"Press Start 2P", monospace';
const BODY_FAMILY = '"Silkscreen", monospace';
// Eazygoin (self-hosted .ttf) for the small tiers — a hand-drawn-style
// face that reads better than a pixel font at 11px, where the bitmap
// fonts above smear under the canvas pixel grid.
const SMALL_FAMILY = '"Eazygoin", sans-serif';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

// Phaser caches each Text into a texture and `pixelArt: true` (in main.ts)
// disables anti-aliasing on it. Under Scale.FIT the canvas scales by
// fractional ratios to fill the viewport, so rasterising text at canvas
// resolution and then NEAREST-sampling up to screen pixels gives uneven
// glyph stems. devicePixelRatio rasterises text at the device-pixel grid
// instead, so the eventual NEAREST sample is closer to integer-aligned
// per glyph row.
const TEXT_RESOLUTION = window.devicePixelRatio;

// Big dramatic single-line: main menu title, end-screen verdict, scene headers.
// Press Start 2P at 32px — clean 8px multiple, crisp glyph grid.
export const FONT_TITLE: Style = { fontFamily: TITLE_FAMILY, fontSize: '32px', resolution: TEXT_RESOLUTION };

// Menu items, HP / bombs in the HUD, the "▶ TAP TO START" prompt, list rows.
// Silkscreen Bold at 16px — its native size, glyph features land on whole pixels.
export const FONT_MENU: Style = {
  fontFamily: BODY_FAMILY,
  fontSize: '16px',
  // fontStyle: 'bold',
  resolution: TEXT_RESOLUTION,
};

// Dialogue body text and speaker names — the "reading" tier.
export const FONT_DIALOGUE_LG: Style = { fontFamily: BODY_FAMILY, fontSize: '16px', resolution: TEXT_RESOLUTION };

// Speech bubbles, dialogue advance hints, secondary descriptions. Sans-serif
// because pixel fonts get noisy below 16px and these tiers want to *recede*.
export const FONT_DIALOGUE_SM: Style = { fontFamily: SMALL_FAMILY, fontSize: '16px', resolution: TEXT_RESOLUTION };

// Smallest tier: debug HUD, control hints, "back" links — usually grayed out.
// Sans-serif for the same reason as FONT_DIALOGUE_SM. Bumped up from the
// previous 11px because input-prompt rows (text + icon) at that size were
// hard to read on actual displays, even with `resolution: dpr` boosting.
export const FONT_DEBUG: Style = { fontFamily: SMALL_FAMILY, fontSize: '16px', resolution: TEXT_RESOLUTION };

async function registerFont(family: string, url: string, weight: number): Promise<void> {
  const face = new FontFace(family, `url(${url})`, { weight: String(weight), display: 'block' });
  await face.load();
  document.fonts.add(face);
}

// Trigger font loading before Phaser's first text draw so the canvas measures
// glyphs against the real font instead of the system fallback (which would
// leave the wrong widths cached).
export async function preloadFonts(): Promise<void> {
  await Promise.all([
    registerFont('Silkscreen', silkscreenRegularUrl, 400),
    registerFont('Silkscreen', silkscreenBoldUrl, 700),
    registerFont('Press Start 2P', pressStart2PRegularUrl, 400),
    registerFont('Eazygoin', eazygoinRegularUrl, 400),
  ]);
}
