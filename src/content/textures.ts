import type Phaser from 'phaser';
import floorPatternUrl from '../assets/sprites/floor_pattern.png';
import { BULLET_RADIUS } from '../config';
import {
  COLOR_BULLET_DEFAULT,
  COLOR_DRINK_FOAM,
  COLOR_DRINK_GLASS,
  COLOR_DRINK_LIQUID,
  COLOR_EMAIL_BORDER,
  COLOR_EMAIL_PAPER,
  COLOR_FLOOR_BG,
  COLOR_FLOOR_PATTERN,
  COLOR_MISSED_CALL_INNER,
  COLOR_MISSED_CALL_OUTER,
  COLOR_PLAYER_BULLET,
  COLOR_PLAYER_BULLET_HIGHLIGHT,
  COLOR_QUESTION_STAMP,
  COLOR_QUESTION_TILE,
  COLOR_REPORT_BORDER,
  COLOR_REPORT_PAPER,
} from '../ui/palette';

// Runtime-generated textures. Each function draws into a fresh Graphics,
// registers a single texture by key, and destroys the Graphics. Callers
// should not rely on these textures existing until the corresponding
// function has run — see `generateTextures` for the bulk-register helper
// the boot scene uses.

// Texture keys referenced by GameScene. The "src" is the raw monochrome
// pattern PNG; the recolored copy under FLOOR_PATTERN_KEY is what
// gameplay tiles.
export const FLOOR_PATTERN_SOURCE_KEY = 'floor_pattern_src';
export const FLOOR_PATTERN_KEY = 'corridor_floor';

export function preloadFloorPattern(scene: Phaser.Scene): void {
  scene.load.image(FLOOR_PATTERN_SOURCE_KEY, floorPatternUrl);
}

export function generateBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const r = BULLET_RADIUS;
  const d = r * 2;
  g.fillStyle(COLOR_BULLET_DEFAULT, 1);
  g.fillCircle(r, r, r);
  g.generateTexture('bullet', d, d);
  g.destroy();
}

export function generatePlayerBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(COLOR_PLAYER_BULLET, 1);
  g.fillRect(0, 0, 6, 14);
  g.fillStyle(COLOR_PLAYER_BULLET_HIGHLIGHT, 1);
  g.fillRect(1, 1, 4, 5);
  g.generateTexture('playerBullet', 6, 14);
  g.destroy();
}

// Report bullet placeholder — paper-coloured rectangle with a darker border.
// Will be swapped for an actual paper sprite later.
export function generateReportBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 8;
  const h = 10;
  g.fillStyle(COLOR_REPORT_BORDER, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(COLOR_REPORT_PAPER, 1);
  g.fillRect(1, 1, w - 2, h - 2);
  g.generateTexture('reportBullet', w, h);
  g.destroy();
}

// Missed-call bullet placeholder — red square with a white core, to read as
// "phone notification" at a glance and stand out from the round white bullet.
// Will be swapped for an actual missed-call sprite later.
export function generateMissedCallTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const s = 8;
  g.fillStyle(COLOR_MISSED_CALL_OUTER, 1);
  g.fillRect(0, 0, s, s);
  g.fillStyle(COLOR_MISSED_CALL_INNER, 1);
  g.fillRect(2, 2, s - 4, s - 4);
  g.generateTexture('missedCall', s, s);
  g.destroy();
}

// Email bullet placeholder — chunky envelope: pale paper rectangle with a
// dark border and a V-flap on top, oversized so it reads as a heavy
// hazard next to the round white bullets.
export function generateEmailBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 14;
  const h = 10;
  g.fillStyle(COLOR_EMAIL_BORDER, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(COLOR_EMAIL_PAPER, 1);
  g.fillRect(1, 1, w - 2, h - 2);
  g.lineStyle(1, COLOR_EMAIL_BORDER, 1);
  g.beginPath();
  g.moveTo(1, 1);
  g.lineTo(w / 2, h / 2);
  g.lineTo(w - 1, 1);
  g.strokePath();
  g.generateTexture('emailBullet', w, h);
  g.destroy();
}

// Question bullet placeholder — yellow tile with a dark "?" stamped on it,
// so streams of these read as a fusillade of unanswered questions. Distinct
// from the round default bullet, the red missed-call square and the beige
// report rectangle.
export function generateQuestionBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 8;
  const h = 10;
  g.fillStyle(COLOR_QUESTION_TILE, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(COLOR_QUESTION_STAMP, 1);
  g.fillRect(2, 1, 4, 1); // top of '?'
  g.fillRect(5, 2, 1, 1);
  g.fillRect(4, 3, 1, 1); // curve down
  g.fillRect(3, 4, 1, 2); // body
  g.fillRect(3, 8, 2, 1); // dot
  g.generateTexture('questionBullet', w, h);
  g.destroy();
}

// Drink bullet placeholder — small cocktail glass head-on: dark glass
// outline, pale-blue liquid body, foam highlight on top. Reads as a
// beverage at bullet scale and stays distinct from the default bullet
// and the warm-coloured paper/email/question bullets.
export function generateDrinkBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 8;
  const h = 10;
  g.fillStyle(COLOR_DRINK_GLASS, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(COLOR_DRINK_LIQUID, 1);
  g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle(COLOR_DRINK_FOAM, 1);
  g.fillRect(1, 1, w - 2, 1);
  g.generateTexture('drinkBullet', w, h);
  g.destroy();
}

// Recolor the loaded monochrome floor pattern PNG into a warm two-grey
// version that matches the rest of the palette. Walks every pixel,
// lerps between COLOR_FLOOR_BG (where the source was black) and
// COLOR_FLOOR_PATTERN (where the source was white) — keeping any AA
// edges as smooth gradients between the two colors instead of
// hard-thresholding to one or the other.
//
// Must run AFTER the source PNG has loaded — call this from BootScene's
// loader COMPLETE handler, not from generateTextures (which runs as
// soon as it can, possibly before the asset is in the cache).
export function recolorFloorPattern(scene: Phaser.Scene): void {
  const src = scene.textures.get(FLOOR_PATTERN_SOURCE_KEY).getSourceImage();
  if (!(src instanceof HTMLImageElement) && !(src instanceof HTMLCanvasElement)) {
    throw new Error('floor pattern source not loaded — preloadFloorPattern must run first');
  }
  const w = src.width;
  const h = src.height;
  // CanvasTexture gives us a writable canvas + auto-registers as a Phaser
  // texture under FLOOR_PATTERN_KEY, ready to be used by TileSprite.
  const ct = scene.textures.createCanvas(FLOOR_PATTERN_KEY, w, h);
  if (!ct) throw new Error('failed to create CanvasTexture for floor pattern');
  const ctx = ct.getContext();
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  const bgR = (COLOR_FLOOR_BG >> 16) & 0xff;
  const bgG = (COLOR_FLOOR_BG >> 8) & 0xff;
  const bgB = COLOR_FLOOR_BG & 0xff;
  const ptR = (COLOR_FLOOR_PATTERN >> 16) & 0xff;
  const ptG = (COLOR_FLOOR_PATTERN >> 8) & 0xff;
  const ptB = COLOR_FLOOR_PATTERN & 0xff;

  for (let i = 0; i < data.length; i += 4) {
    // Source is monochrome — R == G == B. Read R as the luma.
    const t = (data[i] ?? 0) / 255;
    data[i] = Math.round(bgR + (ptR - bgR) * t);
    data[i + 1] = Math.round(bgG + (ptG - bgG) * t);
    data[i + 2] = Math.round(bgB + (ptB - bgB) * t);
    data[i + 3] = 255; // force opaque (PNG was already opaque, but be defensive)
  }
  ctx.putImageData(img, 0, 0);
  ct.refresh();
}

// Bulk-register every synchronous runtime texture (bullets only). Boot scene
// calls this from a microtask after queueing the network loads, so canvas
// draws don't block the kick-off of XHRs and dynamic-imports.
//
// NOT called for the floor pattern — that one needs the source PNG loaded
// first, so the boot scene runs `recolorFloorPattern` from its loader
// COMPLETE callback instead.
export function generateTextures(scene: Phaser.Scene): void {
  generateBulletTexture(scene);
  generatePlayerBulletTexture(scene);
  generateReportBulletTexture(scene);
  generateMissedCallTexture(scene);
  generateEmailBulletTexture(scene);
  generateQuestionBulletTexture(scene);
  generateDrinkBulletTexture(scene);
}
