import Phaser from 'phaser';
import { GAME_H, GAME_W } from './config';
import { BootScene } from './scenes/BootScene';
import { EndScene } from './scenes/EndScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';

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
  scene: [BootScene, MenuScene, GameScene, EndScene],
});
