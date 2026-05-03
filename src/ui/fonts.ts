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
const TITLE_FAMILY = '"Press Start 2P", monospace';
const BODY_FAMILY = '"Silkscreen", monospace';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

// Big dramatic single-line: main menu title, end-screen verdict, scene headers.
export const FONT_TITLE: Style = { fontFamily: TITLE_FAMILY, fontSize: '28px' };

// Menu items, HP / bombs in the HUD, the "▶ TAP TO START" prompt, list rows.
export const FONT_MENU: Style = { fontFamily: BODY_FAMILY, fontSize: '18px', fontStyle: 'bold' };

// Dialogue body text and speaker names — the "reading" tier.
export const FONT_DIALOGUE_LG: Style = { fontFamily: BODY_FAMILY, fontSize: '16px' };

// Speech bubbles, dialogue advance hints, secondary descriptions.
export const FONT_DIALOGUE_SM: Style = { fontFamily: BODY_FAMILY, fontSize: '13px' };

// Smallest tier: debug HUD, control hints, "back" links — usually grayed out.
export const FONT_DEBUG: Style = { fontFamily: BODY_FAMILY, fontSize: '11px' };

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
