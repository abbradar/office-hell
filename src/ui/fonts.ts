import type Phaser from 'phaser';
import monogramExtendedUrl from '../assets/fonts/monogram-extended.ttf';
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
// monogram (self-hosted .ttf, by Vinícius Menézio / @vmenezio) for the
// small tiers — a 1bpp pixel font that stays legible at sizes where the
// 8px-grid bitmap fonts above start to smear. Falls back to a generic
// monospace stack if the .ttf hasn't loaded yet.
const SMALL_FAMILY = '"monogram", monospace';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

// Resolution (text-texture density) is no longer set per-style. The
// `add.text` factory override in render/textResolution.ts injects
// `resolution: displayState.scale` at creation, and the resize hook
// re-rasterises live Text on viewport changes. Keeping it out of the
// style objects means callers can spread these without a per-style
// `resolution` value silently overriding the scale-tracking default.

// Big dramatic single-line: main menu title, end-screen verdict, scene headers.
// Press Start 2P at 32px — clean 8px multiple, crisp glyph grid.
export const FONT_TITLE: Style = { fontFamily: TITLE_FAMILY, fontSize: '32px' };

// Menu items, HP / bombs in the HUD, the "▶ TAP TO START" prompt, list rows.
// Silkscreen Bold at 16px — its native size, glyph features land on whole pixels.
export const FONT_MENU: Style = {
  fontFamily: BODY_FAMILY,
  fontSize: '16px',
};

// Dialogue body text and speaker names — the "reading" tier.
export const FONT_DIALOGUE_LG: Style = { fontFamily: BODY_FAMILY, fontSize: '16px' };

// Speech bubbles, dialogue advance hints, secondary descriptions. monogram
// is a 1bpp pixel font tuned for compact rows — narrower and more
// utilitarian than Silkscreen, so these tiers recede from the dramatic
// FONT_TITLE / FONT_MENU pair.
export const FONT_DIALOGUE_SM: Style = { fontFamily: SMALL_FAMILY, fontSize: '16px' };

// Smallest tier: debug HUD, control hints, "back" links — usually grayed out.
// Same monogram face for visual continuity with FONT_DIALOGUE_SM.
export const FONT_DEBUG: Style = { fontFamily: SMALL_FAMILY, fontSize: '16px' };

async function registerFont(family: string, url: string, weight: number): Promise<void> {
  // Pass the bare family — do NOT wrap it in quotes. Chromium stores
  // [[family]] verbatim including any literal quote characters in the
  // input, but normalises CSS lookups (so `font-family: "monogram"`
  // resolves to `monogram` without quotes), so a quoted-form registration
  // can never match a canvas font lookup. Firefox normalises both sides,
  // so it tolerated the quoted form. Both browsers accept the bare string
  // for `Press Start 2P` and canonicalise it internally — no special case
  // needed for digit-prefixed tokens.
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
    registerFont('monogram', monogramExtendedUrl, 400),
  ]);
}
