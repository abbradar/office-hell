import Phaser from 'phaser';
import { GAME_W, GAME_H } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
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
  scene: [BootScene, MenuScene, GameScene],
});
