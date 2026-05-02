import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    this.add
      .text(GAME_W / 2, GAME_H * 0.28, 'OFFICE HELL', {
        color: '#ff5577',
        fontSize: '48px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const startLabel = isTouchDevice ? '▶ TAP TO START' : '▶ PRESS Z';
    const startText = this.add
      .text(GAME_W / 2, GAME_H * 0.55, startLabel, {
        color: '#ffffff',
        fontSize: '28px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: startText,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const controlsText = isTouchDevice
      ? 'on-screen buttons: move\nfire is automatic on touch devices'
      : '← → arrows: move\nZ: fire';
    this.add
      .text(GAME_W / 2, GAME_H * 0.78, controlsText, {
        color: '#888888',
        fontSize: '14px',
        align: 'center',
      })
      .setOrigin(0.5);

    const start = (): void => {
      this.scene.start('Game');
    };

    this.input.once('pointerdown', start);
    this.input.keyboard?.once('keydown-Z', start);
  }
}
