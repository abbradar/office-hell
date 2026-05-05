import Phaser from 'phaser';
import { CANVAS_H, CANVAS_W } from './config';
import { BootScene } from './scenes/BootScene';

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#10101a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene],
});
