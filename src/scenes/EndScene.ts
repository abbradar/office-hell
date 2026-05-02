import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';

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
    this.cameras.main.setBackgroundColor('#10101a');

    const title = this.won ? 'STAGE CLEAR' : 'GAME OVER';
    const titleColor = this.won ? '#6cf0a8' : '#f06c6c';
    const subtitle = this.won ? 'you survived office hell' : 'office hell consumed you';

    this.add
      .text(GAME_W / 2, GAME_H * 0.32, title, {
        color: titleColor,
        fontSize: '44px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, GAME_H * 0.32 + 56, subtitle, {
        color: '#aaaaaa',
        fontSize: '14px',
      })
      .setOrigin(0.5);

    const restart = this.add
      .text(GAME_W / 2, GAME_H * 0.6, '▶ TAP TO RESTART', {
        color: '#ffffff',
        fontSize: '24px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

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
