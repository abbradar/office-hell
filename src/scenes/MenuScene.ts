import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_MENU, FONT_TITLE } from '../ui/fonts';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    this.add
      .text(GAME_W / 2, GAME_H * 0.28, 'OFFICE HELL', {
        ...FONT_TITLE,
        color: '#ff5577',
      })
      .setOrigin(0.5);

    const startLabel = isTouchDevice ? '▶ TAP TO START' : '▶ PRESS Z';
    const startText = this.add
      .text(GAME_W / 2, GAME_H * 0.5, startLabel, {
        ...FONT_MENU,
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.tweens.add({
      targets: startText,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const practiceLabel = isTouchDevice ? '▷ PRACTICE' : '▷ PRACTICE (T)';
    const practiceText = this.add
      .text(GAME_W / 2, GAME_H * 0.62, practiceLabel, {
        ...FONT_DIALOGUE_LG,
        color: '#ffd96a',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const controlsText = isTouchDevice
      ? 'on-screen buttons: move\nfire is automatic on touch devices\n(no excuses on touch — yet)'
      : '← → arrows: move\nZ: fire\nX: excuse (clears bullets, 3 per run)';
    this.add
      .text(GAME_W / 2, GAME_H * 0.8, controlsText, {
        ...FONT_DEBUG,
        color: '#888888',
        align: 'center',
      })
      .setOrigin(0.5);

    const start = (): void => {
      this.scene.start('CharacterSelect', { next: 'Game' });
    };
    const goPractice = (): void => {
      this.scene.start('TestMenu');
    };

    startText.on('pointerdown', start);
    practiceText.on('pointerdown', goPractice);
    this.input.keyboard?.once('keydown-Z', start);
    this.input.keyboard?.once('keydown-T', goPractice);
  }
}
