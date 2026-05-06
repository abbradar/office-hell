import type Phaser from 'phaser';
import { GAME_W } from '../config';
import { FONT_DIALOGUE_SM } from './fonts';
import { makePrompt } from './prompt';

const DEPTH = 150;
const TOP_Y = 70;
const BUBBLE_FILL = 0xfff8e0;
const BUBBLE_ALPHA = 0.95;
const STROKE_COLOR = 0xffd96a;
const STROKE_ALPHA = 0.85;
const TEXT_COLOR = '#1a1a2a';
const ICON_TINT = 0x1a1a2a;
const PAD_X = 14;
const PAD_Y = 8;
const CORNER_RADIUS = 8;

// Top-of-screen tutorial bubble — centred horizontally, sits below the
// HUD header. Used during the intro to surface "press X to do Y" prompts
// while the world is frozen for input. The template is a `makePrompt`
// template string, so `<moveHorizontal>` etc. render as platform-correct
// input glyphs; on touch they fall back to bracketed action names — pass
// the already-platform-appropriate template (e.g. "tap ◀ ▶ to dodge").
export function showTutorialBubble(scene: Phaser.Scene, template: string): () => void {
  const prompt = makePrompt(
    scene,
    GAME_W / 2,
    TOP_Y,
    template,
    { ...FONT_DIALOGUE_SM, color: TEXT_COLOR, fontStyle: 'bold' },
    // Tint dark to stay legible against the cream bubble fill — the source
    // SVGs are white, so untinted icons wash out.
    { align: 'center', iconTint: ICON_TINT },
  );
  prompt.setDepth(DEPTH + 1);

  const w = prompt.width + PAD_X * 2;
  const h = prompt.height + PAD_Y * 2;
  const x = GAME_W / 2 - w / 2;
  const y = TOP_Y - h / 2;
  const gfx = scene.add.graphics().setDepth(DEPTH);
  gfx.fillStyle(BUBBLE_FILL, BUBBLE_ALPHA);
  gfx.fillRoundedRect(x, y, w, h, CORNER_RADIUS);
  gfx.lineStyle(2, STROKE_COLOR, STROKE_ALPHA);
  gfx.strokeRoundedRect(x, y, w, h, CORNER_RADIUS);

  return () => {
    prompt.destroy();
    gfx.destroy();
  };
}
