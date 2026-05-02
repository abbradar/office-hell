import Phaser from 'phaser';
import { BULLET_RADIUS } from '../config';

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

    g.fillStyle(0x4cc9f0, 1);
    g.fillTriangle(8, 0, 0, 16, 16, 16);
    g.fillStyle(0xff5577, 1);
    g.fillCircle(8, 10, 2);
    g.generateTexture('player', 16, 16);
    g.clear();

    g.fillStyle(0xf72585, 1);
    g.fillRect(0, 0, 24, 24);
    g.fillStyle(0x000000, 1);
    g.fillRect(6, 8, 4, 4);
    g.fillRect(14, 8, 4, 4);
    g.generateTexture('enemy', 24, 24);
    g.destroy();
  }

  create(): void {
    this.scene.start('Game');
  }
}
