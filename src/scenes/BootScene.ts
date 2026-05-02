import Phaser from 'phaser';
import { BULLET_RADIUS, GAME_W } from '../config';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const g = this.add.graphics();

    const bd = BULLET_RADIUS * 2;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(BULLET_RADIUS, BULLET_RADIUS, BULLET_RADIUS);
    g.generateTexture('bullet', bd, bd);
    g.clear();

    g.fillStyle(0xfdd9b4, 1);
    g.fillCircle(16, 8, 7);
    g.fillStyle(0x2c3e6e, 1);
    g.fillRect(8, 14, 16, 18);
    g.fillStyle(0xfdd9b4, 1);
    g.fillRect(4, 16, 4, 12);
    g.fillRect(24, 16, 4, 12);
    g.fillStyle(0x1c1c2a, 1);
    g.fillRect(8, 32, 7, 14);
    g.fillRect(17, 32, 7, 14);
    g.fillStyle(0x000000, 1);
    g.fillRect(8, 46, 7, 2);
    g.fillRect(17, 46, 7, 2);
    g.fillStyle(0xff3070, 1);
    g.fillCircle(16, 24, 6);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(16, 24, 2);
    g.generateTexture('player', 32, 48);
    g.clear();

    g.fillStyle(0xf72585, 1);
    g.fillRect(0, 0, 24, 24);
    g.fillStyle(0x000000, 1);
    g.fillRect(6, 8, 4, 4);
    g.fillRect(14, 8, 4, 4);
    g.generateTexture('enemy', 24, 24);
    g.clear();

    const cw = GAME_W;
    const ch = 128;
    g.fillStyle(0x1a1a28, 1);
    g.fillRect(0, 0, cw, ch);
    g.fillStyle(0x3a3a55, 1);
    g.fillRect(0, 0, 40, ch);
    g.fillRect(cw - 40, 0, 40, ch);
    g.fillStyle(0x6262a0, 1);
    g.fillRect(38, 0, 2, ch);
    g.fillRect(cw - 40, 0, 2, ch);
    g.fillStyle(0x303048, 1);
    g.fillRect(40, 0, cw - 80, 2);
    g.generateTexture('corridor', cw, ch);
    g.clear();

    const sw = GAME_W;
    const sh = 256;
    g.fillStyle(0xa0a8d0, 1);
    for (let i = 0; i < 32; i++) {
      g.fillRect(
        Phaser.Math.Between(48, sw - 48),
        Phaser.Math.Between(0, sh - 1),
        2,
        2,
      );
    }
    g.fillStyle(0x8090c0, 0.7);
    for (let i = 0; i < 24; i++) {
      g.fillRect(
        Phaser.Math.Between(48, sw - 48),
        Phaser.Math.Between(0, sh - 1),
        1,
        1,
      );
    }
    g.generateTexture('corridor_specks', sw, sh);

    g.destroy();
  }

  create(): void {
    this.scene.start('Game');
  }
}
