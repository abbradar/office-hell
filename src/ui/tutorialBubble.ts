import type Phaser from 'phaser';
import { GAME_W } from '../config';
import { FONT_DIALOGUE_SM } from './fonts';
import { COLOR_ACCENT_GOLD, COLOR_BUBBLE, COLOR_TEXT_INVERSE, COLOR_TEXT_INVERSE_STR } from './palette';
import { makePrompt } from './prompt';

const DEPTH = 150;
// Persistent side prompts ride above the dialogue layer (DEPTH = 200) so
// they stay readable while a cutscene dim is over the playfield. The
// transient top-centre prompt sticks at the lower depth — it only ever
// appears during a tutorialPrompt freeze with no dialogue active.
const SIDE_DEPTH = 250;
const TOP_Y = 70;
const SIDE_Y = 70;
const SIDE_RIGHT_PAD = 8;
const BUBBLE_FILL = COLOR_BUBBLE;
const BUBBLE_ALPHA = 0.95;
// Bubble fill stays cream regardless of theme; stroke uses the dark-navy
// accent (formerly gold), text + icons stay dark for readability on cream.
const STROKE_COLOR = COLOR_ACCENT_GOLD;
const STROKE_ALPHA = 0.85;
const TEXT_COLOR = COLOR_TEXT_INVERSE_STR;
const ICON_TINT = COLOR_TEXT_INVERSE;
const PAD_X = 14;
const PAD_Y = 8;
const CORNER_RADIUS = 8;

export type TutorialBubbleOpts = {
  // 'top' (default): centred horizontally, sits below the HUD header.
  // 'right': anchored to the right edge at the same y, designed to coexist
  // with a centred 'top' prompt (the intro's skip hint sits here while
  // the dodge/bomb/fire prompts pop in centre).
  pos?: 'top' | 'right';
};

// Tutorial bubble — used during the intro to surface "press X to do Y"
// prompts while the world is frozen for input. The template is a
// `makePrompt` template string, so `<moveHorizontal>` etc. render as
// platform-correct input glyphs.
export function showTutorialBubble(scene: Phaser.Scene, template: string, opts: TutorialBubbleOpts = {}): () => void {
  const pos = opts.pos ?? 'top';
  const cy = pos === 'top' ? TOP_Y : SIDE_Y;
  const depth = pos === 'top' ? DEPTH : SIDE_DEPTH;

  // Build at the canvas centre first; for 'right' we re-anchor x once
  // the prompt's measured width is known. makePrompt only adjusts y for
  // multi-line vertical centring, so changing x after construction
  // preserves the layout.
  const prompt = makePrompt(
    scene,
    GAME_W / 2,
    cy,
    template,
    { ...FONT_DIALOGUE_SM, color: TEXT_COLOR, fontStyle: 'bold' },
    // Tint dark to stay legible against the cream bubble fill — the source
    // SVGs are white, so untinted icons wash out.
    { align: 'center', iconTint: ICON_TINT },
  );
  prompt.setDepth(depth + 1);

  const w = prompt.width + PAD_X * 2;
  const h = prompt.height + PAD_Y * 2;
  const cx = pos === 'top' ? GAME_W / 2 : GAME_W - SIDE_RIGHT_PAD - w / 2;
  if (pos === 'right') prompt.x = Math.round(cx);

  const x = cx - w / 2;
  const y = cy - h / 2;
  const gfx = scene.add.graphics().setDepth(depth);
  gfx.fillStyle(BUBBLE_FILL, BUBBLE_ALPHA);
  gfx.fillRoundedRect(x, y, w, h, CORNER_RADIUS);
  gfx.lineStyle(2, STROKE_COLOR, STROKE_ALPHA);
  gfx.strokeRoundedRect(x, y, w, h, CORNER_RADIUS);

  return () => {
    prompt.destroy();
    gfx.destroy();
  };
}
