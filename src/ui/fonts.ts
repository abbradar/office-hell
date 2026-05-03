import type Phaser from 'phaser';
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
// Sans-serif for tiers that need to be small. system-ui is hinted/AA'd by the
// platform so it stays crisp at 11–13px, where pixel fonts fall apart.
const SMALL_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

// Phaser caches each Text into a texture and `pixelArt: true` (in main.ts)
// disables anti-aliasing on it. With Scale.FIT scaling the canvas at fractional
// ratios + retina display, low-res text textures upscale to mush. Setting
// `resolution` rasterises text at devicePixelRatio× higher density so the
// browser downsamples instead of upsamples — sharp at any scale.
//
// Use globalThis to keep this module SSR-safe; falls back to 1 in non-browser
// environments (tests, SSR previews).
const TEXT_RESOLUTION = Math.max(1, Math.ceil(globalThis.devicePixelRatio ?? 1));

// Big dramatic single-line: main menu title, end-screen verdict, scene headers.
// Press Start 2P at 32px — clean 8px multiple, crisp glyph grid.
export const FONT_TITLE: Style = { fontFamily: TITLE_FAMILY, fontSize: '32px', resolution: TEXT_RESOLUTION };

// Menu items, HP / bombs in the HUD, the "▶ TAP TO START" prompt, list rows.
// Silkscreen Bold at 16px — its native size, glyph features land on whole pixels.
export const FONT_MENU: Style = {
  fontFamily: BODY_FAMILY,
  fontSize: '16px',
  fontStyle: 'bold',
  resolution: TEXT_RESOLUTION,
};

// Dialogue body text and speaker names — the "reading" tier.
export const FONT_DIALOGUE_LG: Style = { fontFamily: BODY_FAMILY, fontSize: '16px', resolution: TEXT_RESOLUTION };

// Speech bubbles, dialogue advance hints, secondary descriptions. Sans-serif
// because pixel fonts get noisy below 16px and these tiers want to *recede*.
export const FONT_DIALOGUE_SM: Style = { fontFamily: SMALL_FAMILY, fontSize: '13px', resolution: TEXT_RESOLUTION };

// Smallest tier: debug HUD, control hints, "back" links — usually grayed out.
// Sans-serif for the same reason as FONT_DIALOGUE_SM, plus the shapes need to
// stay readable at 11px which Silkscreen genuinely can't do.
export const FONT_DEBUG: Style = { fontFamily: SMALL_FAMILY, fontSize: '11px', resolution: TEXT_RESOLUTION };

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
  ]);
}
