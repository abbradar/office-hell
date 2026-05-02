import Phaser from 'phaser';
import { GAME_W, GAME_H } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { EndScene } from './scenes/EndScene';

// itch.io embeds the game in an iframe. A bare <canvas> isn't focusable, so
// clicking it never sets document.activeElement and keyboard events stay on
// the parent page. Make the canvas focusable and focus it on every pointer
// interaction so keydown reaches the iframe window where Phaser listens.
const focusGame = (): void => {
  const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
  if (!canvas) return;
  if (canvas.tabIndex < 0) canvas.tabIndex = -1;
  canvas.focus();
};
window.addEventListener('pointerdown', focusGame, { passive: true });

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
