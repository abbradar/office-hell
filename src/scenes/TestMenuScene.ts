import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { WAVES, type WaveDef } from '../content/stage';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { PRACTICE_HITS_KEY_PREFIX } from './GameScene';

const ROW_SPACING = 44;
const HEADER_Y = 60;
const LIST_VIEW_TOP = 130;
const LIST_VIEW_BOTTOM = GAME_H - 75;
const LIST_VIEW_HEIGHT = LIST_VIEW_BOTTOM - LIST_VIEW_TOP;
// Treat motion under this many game-pixels as a tap rather than a swipe.
const DRAG_THRESHOLD = 6;

export class TestMenuScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.Text[] = [];
  private cursor = 0;
  private listContainer!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private gesture: { downY: number; startScroll: number; moved: boolean } | null = null;

  constructor() {
    super('TestMenu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');
    this.rows = [];
    this.scrollY = 0;
    this.gesture = null;

    this.add
      .text(GAME_W / 2, HEADER_Y, 'PRACTICE', {
        ...FONT_TITLE,
        color: '#ffd96a',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, HEADER_Y + 38, 'select a wave', {
        ...FONT_DIALOGUE_SM,
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    this.listContainer = this.add.container(0, LIST_VIEW_TOP);

    for (let i = 0; i < WAVES.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by WAVES.length
      const wave = WAVES[i]!;
      const row = this.add
        .text(GAME_W / 2, i * ROW_SPACING + ROW_SPACING / 2, this.rowText(wave), {
          ...FONT_MENU,
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      row.on('pointerover', (p: Phaser.Input.Pointer) => {
        // On touch, pointerover fires on tap and would yank the cursor mid-swipe.
        // On desktop, ignore it during a held drag so the cursor doesn't chase the mouse.
        if (isTouchDevice || p.isDown) return;
        this.cursor = i;
        this.refresh();
      });
      row.on('pointerup', () => {
        // Game-object pointerup fires before scene-level pointerup, so .gesture
        // is still set here. If the gesture moved past threshold, treat it as a
        // swipe and skip the tap.
        if (this.gesture?.moved) return;
        this.cursor = i;
        this.start();
      });
      this.listContainer.add(row);
      this.rows.push(row);
    }

    const maskGraphics = this.make.graphics({});
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, LIST_VIEW_TOP, GAME_W, LIST_VIEW_HEIGHT);
    this.listContainer.setMask(maskGraphics.createGeometryMask());

    this.maxScroll = Math.max(0, WAVES.length * ROW_SPACING - LIST_VIEW_HEIGHT);

    const back = this.add
      .text(GAME_W / 2, GAME_H - 55, '← back to menu', {
        ...FONT_DIALOGUE_SM,
        color: '#888888',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerup', () => {
      if (this.gesture?.moved) return;
      this.scene.start('Menu');
    });

    const hint = isTouchDevice
      ? 'tap to play   •   swipe list to scroll'
      : '↑ ↓: select   Z/Enter: play   wheel: scroll   Esc: back';
    this.add
      .text(GAME_W / 2, GAME_H - 25, hint, {
        ...FONT_DEBUG,
        color: '#666666',
        align: 'center',
      })
      .setOrigin(0.5);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < LIST_VIEW_TOP || p.y > LIST_VIEW_BOTTOM) {
        this.gesture = null;
        return;
      }
      this.gesture = { downY: p.y, startScroll: this.scrollY, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.gesture || !p.isDown) return;
      const dy = p.y - this.gesture.downY;
      if (Math.abs(dy) > DRAG_THRESHOLD) this.gesture.moved = true;
      if (this.gesture.moved) this.setScroll(this.gesture.startScroll - dy);
    });
    this.input.on('pointerup', () => {
      this.gesture = null;
    });

    this.input.on(
      'wheel',
      (_p: Phaser.Input.Pointer, _objs: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
        this.setScroll(this.scrollY + dy);
      },
    );

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => {
        this.cursor = (this.cursor - 1 + WAVES.length) % WAVES.length;
        this.refresh();
        this.scrollToCursor();
      });
      kb.on('keydown-DOWN', () => {
        this.cursor = (this.cursor + 1) % WAVES.length;
        this.refresh();
        this.scrollToCursor();
      });
      kb.on('keydown-Z', () => this.start());
      kb.on('keydown-ENTER', () => this.start());
      kb.on('keydown-ESC', () => this.scene.start('Menu'));
    }

    this.refresh();
    this.scrollToCursor();
  }

  private setScroll(target: number): void {
    this.scrollY = Phaser.Math.Clamp(target, 0, this.maxScroll);
    this.listContainer.y = LIST_VIEW_TOP - this.scrollY;
  }

  private scrollToCursor(): void {
    const top = this.cursor * ROW_SPACING;
    const bottom = top + ROW_SPACING;
    if (top < this.scrollY) this.setScroll(top);
    else if (bottom > this.scrollY + LIST_VIEW_HEIGHT) {
      this.setScroll(bottom - LIST_VIEW_HEIGHT);
    }
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
