import Phaser from 'phaser';
import { stopMusicLoop } from '../audio/music/loop';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';
import { FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { makePrompt } from '../ui/prompt';

export type EndSceneData = { won: boolean };

export class EndScene extends Phaser.Scene {
  private won = true;

  constructor() {
    super('End');
  }

  init(data: EndSceneData): void {
    this.won = data.won;
  }

  create(): void {
    stopMusicLoop();
    this.cameras.main.setBackgroundColor('#10101a');

    const title = this.won ? 'STAGE CLEAR' : 'GAME OVER';
    const titleColor = this.won ? '#6cf0a8' : '#f06c6c';
    const subtitle = this.won ? 'you survived office hell' : 'office hell consumed you';

    this.add
      .text(GAME_W / 2, GAME_H * 0.32, title, {
        ...FONT_TITLE,
        color: titleColor,
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, GAME_H * 0.32 + 56, subtitle, {
        ...FONT_DIALOGUE_SM,
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    const restartTemplate = isTouchDevice ? '▶ TAP TO RESTART' : '▶ <confirm>  RESTART';
    const restart = makePrompt(this, GAME_W / 2, GAME_H * 0.6, restartTemplate, {
      ...FONT_MENU,
      color: '#ffffff',
    });

    this.tweens.add({
      targets: restart,
      alpha: 0.4,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const back = (): void => {
      this.scene.start('Menu');
    };

    this.input.once('pointerdown', back);
    this.input.keyboard?.once('keydown', back);
  }
}
