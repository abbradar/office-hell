import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { WAVES, type WaveDef } from '../content/stage';
import { isTouchDevice } from '../input/device';
import { PRACTICE_HITS_KEY_PREFIX } from './GameScene';

const ROW_SPACING = 44;
const HEADER_Y = 60;
const LIST_TOP = 150;

export class TestMenuScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor() {
    super('TestMenu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');
    this.rows = [];

    this.add
      .text(GAME_W / 2, HEADER_Y, 'PRACTICE', {
        color: '#ffd96a',
        fontSize: '36px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, HEADER_Y + 38, 'select a wave', {
        color: '#aaaaaa',
        fontSize: '13px',
      })
      .setOrigin(0.5);

    for (let i = 0; i < WAVES.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by WAVES.length
      const wave = WAVES[i]!;
      const row = this.add
        .text(GAME_W / 2, LIST_TOP + i * ROW_SPACING, this.rowText(wave), {
          color: '#ffffff',
          fontSize: '18px',
          fontFamily: 'system-ui, sans-serif',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      row.on('pointerover', () => {
        this.cursor = i;
        this.refresh();
      });
      row.on('pointerdown', () => {
        this.cursor = i;
        this.start();
      });
      this.rows.push(row);
    }

    const backY = LIST_TOP + WAVES.length * ROW_SPACING + 32;
    const back = this.add
      .text(GAME_W / 2, backY, '← back to menu', {
        color: '#888888',
        fontSize: '14px',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('Menu'));

    const hint = isTouchDevice
      ? 'tap a wave to play   •   tap "back" to return'
      : '↑ ↓: select   Z/Enter: play   Esc: back to menu';
    this.add
      .text(GAME_W / 2, GAME_H - 40, hint, {
        color: '#666666',
        fontSize: '12px',
        align: 'center',
      })
      .setOrigin(0.5);

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => {
        this.cursor = (this.cursor - 1 + WAVES.length) % WAVES.length;
        this.refresh();
      });
      kb.on('keydown-DOWN', () => {
        this.cursor = (this.cursor + 1) % WAVES.length;
        this.refresh();
      });
      kb.on('keydown-Z', () => this.start());
      kb.on('keydown-ENTER', () => this.start());
      kb.on('keydown-ESC', () => this.scene.start('Menu'));
    }

    this.refresh();
  }

  private rowText(wave: WaveDef): string {
    const stored = this.registry.get(PRACTICE_HITS_KEY_PREFIX + wave.id);
    const hits = typeof stored === 'number' ? `   hits: ${stored}` : '';
    return `${wave.name}${hits}`;
  }

  private refresh(): void {
    for (let i = 0; i < this.rows.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by WAVES.length
      const wave = WAVES[i]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded by rows.length
      const row = this.rows[i]!;
      const selected = i === this.cursor;
      row.setText(`${selected ? '▶ ' : '  '}${this.rowText(wave)}`);
      row.setColor(selected ? '#ffd96a' : '#ffffff');
    }
  }

  private start(): void {
    const wave = WAVES[this.cursor];
    if (!wave) return;
    this.scene.start('CharacterSelect', { next: 'Game', nextData: { practice: wave } });
  }
}
