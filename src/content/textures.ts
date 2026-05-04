import Phaser from 'phaser';
import { BULLET_RADIUS, GAME_W } from '../config';

// Runtime-generated textures. Each function draws into a fresh Graphics,
// registers a single texture by key, and destroys the Graphics. Callers
// should not rely on these textures existing until the corresponding
// function has run — see `generateTextures` for the bulk-register helper
// the boot scene uses.

export function generateBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const d = BULLET_RADIUS * 2;
  g.fillStyle(0xffffff, 1);
  g.fillCircle(BULLET_RADIUS, BULLET_RADIUS, BULLET_RADIUS);
  g.generateTexture('bullet', d, d);
  g.destroy();
}

export function generatePlayerBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(0x6cf0a8, 1);
  g.fillRect(0, 0, 6, 14);
  g.fillStyle(0xffffff, 1);
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
  g.fillStyle(0xc0b890, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(0xf0e8d0, 1);
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
  g.fillStyle(0xff5577, 1);
  g.fillRect(0, 0, s, s);
  g.fillStyle(0xffffff, 1);
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
  g.fillStyle(0x665522, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(0xf0e0a0, 1);
  g.fillRect(1, 1, w - 2, h - 2);
  g.lineStyle(1, 0x665522, 1);
  g.beginPath();
  g.moveTo(1, 1);
  g.lineTo(w / 2, h / 2);
  g.lineTo(w - 1, 1);
  g.strokePath();
  g.generateTexture('emailBullet', w, h);
  g.destroy();
}

// Question bullet placeholder — yellow tile with a rough white "?" stamped
// on it, so streams of these read as a fusillade of unanswered questions.
// Distinct from the round white bullet, the red missed-call square and the
// beige report rectangle.
export function generateQuestionBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 8;
  const h = 10;
  g.fillStyle(0xf0c840, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(0xffffff, 1);
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
// beverage at bullet scale and stays distinct from the round white
// bullets and the warm-coloured paper/email/question bullets.
export function generateDrinkBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 8;
  const h = 10;
  g.fillStyle(0x335588, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(0x60c0e8, 1);
  g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle(0xffffff, 1);
  g.fillRect(1, 1, w - 2, 1);
  g.generateTexture('drinkBullet', w, h);
  g.destroy();
}

// Trash bin placeholder for the bomb effect — flat front-on can with a lid
// overhang and a few vertical ribs. Drawn high enough that the player can
// tell at a glance where their bullets are being yanked toward.
export function generateTrashBinTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = 36;
  const h = 42;
  g.fillStyle(0x222222, 1);
  g.fillRect(4, 8, w - 8, h - 8);
  g.fillStyle(0x666666, 1);
  g.fillRect(2, 8, w - 4, h - 8);
  g.fillStyle(0x888888, 1);
  g.fillRect(0, 0, w, 8);
  g.fillStyle(0x4a4a4a, 1);
  g.fillRect(9, 14, 2, h - 20);
  g.fillRect(17, 14, 2, h - 20);
  g.fillRect(25, 14, 2, h - 20);
  g.generateTexture('trashBin', w, h);
  g.destroy();
}

export function generateCorridorTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = GAME_W;
  const h = 128;
  g.fillStyle(0x1a1a28, 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(0x3a3a55, 1);
  g.fillRect(0, 0, 40, h);
  g.fillRect(w - 40, 0, 40, h);
  g.fillStyle(0x6262a0, 1);
  g.fillRect(38, 0, 2, h);
  g.fillRect(w - 40, 0, 2, h);
  g.fillStyle(0x303048, 1);
  g.fillRect(40, 0, w - 80, 2);
  g.generateTexture('corridor', w, h);
  g.destroy();
}

export function generateCorridorSpecksTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const w = GAME_W;
  const h = 256;
  g.fillStyle(0xa0a8d0, 1);
  for (let i = 0; i < 32; i++) {
    g.fillRect(Phaser.Math.Between(48, w - 48), Phaser.Math.Between(0, h - 1), 2, 2);
  }
  g.fillStyle(0x8090c0, 0.7);
  for (let i = 0; i < 24; i++) {
    g.fillRect(Phaser.Math.Between(48, w - 48), Phaser.Math.Between(0, h - 1), 1, 1);
  }
  g.generateTexture('corridor_specks', w, h);
  g.destroy();
}

// Bulk-register every runtime texture. Boot scene calls this from a
// microtask after queueing the network loads, so canvas draws don't block
// the kick-off of XHRs and dynamic-imports.
export function generateTextures(scene: Phaser.Scene): void {
  generateBulletTexture(scene);
  generatePlayerBulletTexture(scene);
  generateReportBulletTexture(scene);
  generateMissedCallTexture(scene);
  generateEmailBulletTexture(scene);
  generateQuestionBulletTexture(scene);
  generateDrinkBulletTexture(scene);
  generateTrashBinTexture(scene);
  generateCorridorTexture(scene);
  generateCorridorSpecksTexture(scene);
}
