import Phaser from 'phaser';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { playClick } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    // Music is owned by the audio module and survives scene transitions, so
    // the loop keeps playing across CharacterSelect / TestMenu / End. The
    // call is idempotent for the same key — calling it again on a return to
    // the menu (e.g. from EndScene) just no-ops while the loop is alive.
    playMusicLoop(MENU_LOOP_KEY);

    this.add
      .text(GAME_W / 2, GAME_H * 0.28, 'OFFICE HELL', {
        color: '#ff5577',
        fontSize: '48px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const startLabel = isTouchDevice ? '▶ TAP TO START' : '▶ PRESS Z';
    const startText = this.add
      .text(GAME_W / 2, GAME_H * 0.5, startLabel, {
        color: '#ffffff',
        fontSize: '28px',
        fontStyle: 'bold',
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
        color: '#ffd96a',
        fontSize: '20px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const controlsText = isTouchDevice
      ? 'on-screen buttons: move\nfire is automatic on touch devices'
      : '← → arrows: move\nZ: fire';
    this.add
      .text(GAME_W / 2, GAME_H * 0.8, controlsText, {
        color: '#888888',
        fontSize: '14px',
        align: 'center',
      })
      .setOrigin(0.5);

    const start = (): void => {
      playClick();
      this.scene.start('CharacterSelect', { next: 'Game' });
    };
    const goPractice = (): void => {
      playClick();
      this.scene.start('TestMenu');
    };

    startText.on('pointerdown', start);
    practiceText.on('pointerdown', goPractice);
    this.input.keyboard?.once('keydown-Z', start);
    this.input.keyboard?.once('keydown-T', goPractice);
  }
}
