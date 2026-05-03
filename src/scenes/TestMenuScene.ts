import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS } from '../content/characters';
import { WAVES, type WaveDef } from '../content/stage';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { PRACTICE_HITS_KEY_PREFIX } from './GameScene';

const ROW_SPACING = 44;
const HEADER_Y = 60;
const FULL_STAGE_Y = 130;
const STAGE_TEST_Y = 165;
const LIST_VIEW_TOP = 210;
const LIST_VIEW_BOTTOM = GAME_H - 75;
const LIST_VIEW_HEIGHT = LIST_VIEW_BOTTOM - LIST_VIEW_TOP;
// Treat motion under this many game-pixels as a tap rather than a swipe.
const DRAG_THRESHOLD = 6;

const HEADER_COLOR = '#6cf0a8';
const ROW_COLOR = '#ffffff';
const SELECTED_COLOR = '#ffd96a';

// Special cursor positions for the two header buttons. Wave entries occupy
// indices 0..WAVES.length-1; headers use these negative sentinels so we can
// keep `wave: WaveDef[]` indexing intact without an off-by-N shift.
type CursorTarget =
  | { kind: 'fullStage' }
  | { kind: 'stageTest' }
  | { kind: 'wave'; index: number };

export class TestMenuScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.Text[] = [];
  private fullStageText!: Phaser.GameObjects.Text;
  private stageTestText!: Phaser.GameObjects.Text;
  // 0 = full stage, 1 = stage test, 2..2+WAVES.length-1 = wave[i]
  private cursor = 0;
  private listContainer!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private gesture: { downY: number; startScroll: number; moved: boolean } | null = null;

  constructor() {
    super('TestMenu');
  }

  private get itemCount(): number {
    return 2 + WAVES.length;
  }

  private cursorTarget(c: number): CursorTarget {
    if (c === 0) return { kind: 'fullStage' };
    if (c === 1) return { kind: 'stageTest' };
    return { kind: 'wave', index: c - 2 };
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');
    this.rows = [];
    this.scrollY = 0;
    this.gesture = null;
    this.cursor = 0;

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

    // Full-stage shortcut — runs the actual stage script (with music) instead
    // of an isolated wave. Skips CharacterSelect to keep the iteration loop
    // tight; uses the first character as the default.
    this.fullStageText = this.add
      .text(GAME_W / 2, FULL_STAGE_Y, '', {
        ...FONT_MENU,
        color: HEADER_COLOR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.fullStageText.on('pointerover', (p: Phaser.Input.Pointer) => {
      if (isTouchDevice || p.isDown) return;
      this.cursor = 0;
      this.refresh();
    });
    this.fullStageText.on('pointerup', () => {
      if (this.gesture?.moved) return;
      this.cursor = 0;
      this.start();
    });

    // Stage-test shortcut — runs the diagnostics queue stage with debug HUD.
    this.stageTestText = this.add
      .text(GAME_W / 2, STAGE_TEST_Y, '', {
        ...FONT_MENU,
        color: HEADER_COLOR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.stageTestText.on('pointerover', (p: Phaser.Input.Pointer) => {
      if (isTouchDevice || p.isDown) return;
      this.cursor = 1;
      this.refresh();
    });
    this.stageTestText.on('pointerup', () => {
      if (this.gesture?.moved) return;
      this.cursor = 1;
      this.start();
    });

    this.listContainer = this.add.container(0, LIST_VIEW_TOP);

    for (let i = 0; i < WAVES.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by WAVES.length
      const wave = WAVES[i]!;
      const row = this.add
        .text(GAME_W / 2, i * ROW_SPACING + ROW_SPACING / 2, this.rowText(wave), {
          ...FONT_MENU,
          color: ROW_COLOR,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      row.on('pointerover', (p: Phaser.Input.Pointer) => {
        // On touch, pointerover fires on tap and would yank the cursor mid-swipe.
        // On desktop, ignore it during a held drag so the cursor doesn't chase the mouse.
        if (isTouchDevice || p.isDown) return;
        this.cursor = 2 + i;
        this.refresh();
      });
      row.on('pointerup', () => {
        // Game-object pointerup fires before scene-level pointerup, so .gesture
        // is still set here. If the gesture moved past threshold, treat it as a
        // swipe and skip the tap.
        if (this.gesture?.moved) return;
        this.cursor = 2 + i;
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
        this.cursor = (this.cursor - 1 + this.itemCount) % this.itemCount;
        this.refresh();
        this.scrollToCursor();
      });
      kb.on('keydown-DOWN', () => {
        this.cursor = (this.cursor + 1) % this.itemCount;
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
    const target = this.cursorTarget(this.cursor);
    if (target.kind !== 'wave') {
      // Header buttons sit above the scroll viewport — bring the list back to
      // the top so the user sees both the highlighted header and the list.
      this.setScroll(0);
      return;
    }
    const top = target.index * ROW_SPACING;
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
    const target = this.cursorTarget(this.cursor);

    this.fullStageText.setText(`${target.kind === 'fullStage' ? '▶ ' : '  '}FULL STAGE (music test)`);
    this.fullStageText.setColor(target.kind === 'fullStage' ? SELECTED_COLOR : HEADER_COLOR);

    this.stageTestText.setText(`${target.kind === 'stageTest' ? '▶ ' : '  '}STAGE TEST (sync)`);
    this.stageTestText.setColor(target.kind === 'stageTest' ? SELECTED_COLOR : HEADER_COLOR);

    for (let i = 0; i < this.rows.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by WAVES.length
      const wave = WAVES[i]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded by rows.length
      const row = this.rows[i]!;
      const selected = target.kind === 'wave' && target.index === i;
      row.setText(`${selected ? '▶ ' : '  '}${this.rowText(wave)}`);
      row.setColor(selected ? SELECTED_COLOR : ROW_COLOR);
    }
  }

  private start(): void {
    const target = this.cursorTarget(this.cursor);
    if (target.kind === 'fullStage') {
      this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
      this.scene.start('Game');
      return;
    }
    if (target.kind === 'stageTest') {
      this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
      this.scene.start('Game', { test: true });
      return;
    }
    const wave = WAVES[target.index];
    if (!wave) return;
    this.scene.start('CharacterSelect', { next: 'Game', nextData: { practice: wave } });
  }
}
