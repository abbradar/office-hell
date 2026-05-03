import Phaser from 'phaser';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { playClick } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { makePrompt } from '../ui/prompt';

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
    playMusicLoop(MENU_LOOP_KEY, { crossfadeMs: 1000 });

    this.add
      .text(GAME_W / 2, GAME_H * 0.28, 'OFFICE HELL', {
        ...FONT_TITLE,
        color: '#ff5577',
      })
      .setOrigin(0.5);

    const startTemplate = isTouchDevice ? '▶ TAP TO START' : '▶ <confirm>  START';
    const startText = makePrompt(this, GAME_W / 2, GAME_H * 0.5, startTemplate, {
      ...FONT_MENU,
      color: '#ffffff',
    }).setInteractive({ useHandCursor: true });

    this.tweens.add({
      targets: startText,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const practiceTemplate = isTouchDevice ? '▷ PRACTICE' : '▷ PRACTICE  <practice>';
    const practiceText = makePrompt(this, GAME_W / 2, GAME_H * 0.62, practiceTemplate, {
      ...FONT_DIALOGUE_LG,
      color: '#ffd96a',
    }).setInteractive({ useHandCursor: true });

    const controlsTemplate = isTouchDevice
      ? 'on-screen buttons: move\nfire is automatic on touch devices\n(no excuses on touch — yet)'
      : '<moveHorizontal>: move\n<fire>: fire\n<bomb>: excuse (clears bullets, 3 per run)';
    makePrompt(
      this,
      GAME_W / 2,
      GAME_H * 0.8,
      controlsTemplate,
      { ...FONT_DEBUG, color: '#888888', align: 'center' },
      { align: 'center' },
    );

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
