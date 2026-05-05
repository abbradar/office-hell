import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS } from '../content/characters';
import { WAVES, type WaveDef } from '../content/stage';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import { makePrompt } from '../ui/prompt';
import { PRACTICE_HITS_KEY_PREFIX } from './GameScene';

const ROW_SPACING = 44;
const HEADER_Y = 60;
const HEADER_BUTTONS_TOP = 130;
const HEADER_BUTTON_SPACING = 32;
const LIST_VIEW_BOTTOM = GAME_H - 75;
// Treat motion under this many game-pixels as a tap rather than a swipe.
const DRAG_THRESHOLD = 6;

const HEADER_COLOR = '#6cf0a8';
const ROW_COLOR = '#ffffff';
const SELECTED_COLOR = '#ffd96a';

// Each header button is a "shortcut" that bypasses CharacterSelect (uses the
// first CHARACTERS entry as the default) and starts a target scene with
// whatever init data the entry specifies. Most go to GameScene; the pattern
// sandbox lives in its own scene. Adding a new diagnostic stage = adding
// a row here. Order matches cursor index: 0..HEADERS.length - 1.
type HeaderButton = {
  label: string;
  // Target scene key. Defaults to 'Game' since most headers run a stage.
  scene?: string;
  // biome-ignore lint/suspicious/noExplicitAny: scene init data is opaque
  data?: any;
};
const HEADERS: HeaderButton[] = [
  { label: 'FULL STAGE (real)' },
  { label: 'STAGE TEST (sync)', data: { test: true } },
  { label: 'KAEDALUS (music test)', data: { music: 'kaedalus' } },
  { label: 'MONSTER RPG (music test)', data: { music: 'monster-rpg' } },
  { label: 'PATTERN SANDBOX', scene: 'PatternTest' },
];

type CursorTarget = { kind: 'header'; index: number } | { kind: 'wave'; index: number };

export class TestMenuScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.Text[] = [];
  private headerTexts: Phaser.GameObjects.Text[] = [];
  // 0..HEADERS.length-1 = headers, then HEADERS.length..HEADERS.length+WAVES.length-1 = waves
  private cursor = 0;
  private listContainer!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private gesture: { downY: number; startScroll: number; moved: boolean } | null = null;
  // Computed at create time from HEADERS — wave list starts below the
  // last header button + a small gap.
  private listViewTop = 0;
  private listViewHeight = 0;

  constructor() {
    super('TestMenu');
  }

  private get itemCount(): number {
    return HEADERS.length + WAVES.length;
  }

  private cursorTarget(c: number): CursorTarget {
    if (c < HEADERS.length) return { kind: 'header', index: c };
    return { kind: 'wave', index: c - HEADERS.length };
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');
    addMuteButton(this);
    this.rows = [];
    this.headerTexts = [];
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

    // Header shortcuts — full stage + each diagnostics test stage.
    for (let i = 0; i < HEADERS.length; i++) {
      const y = HEADER_BUTTONS_TOP + i * HEADER_BUTTON_SPACING;
      const text = this.add
        .text(GAME_W / 2, y, '', {
          ...FONT_MENU,
          color: HEADER_COLOR,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      text.on('pointerover', (p: Phaser.Input.Pointer) => {
        if (isTouchDevice || p.isDown) return;
        this.cursor = i;
        this.refresh();
      });
      text.on('pointerup', () => {
        if (this.gesture?.moved) return;
        this.cursor = i;
        this.start();
      });
      this.headerTexts.push(text);
    }

    // Wave list sits below the last header button.
    this.listViewTop = HEADER_BUTTONS_TOP + HEADERS.length * HEADER_BUTTON_SPACING + 16;
    this.listViewHeight = LIST_VIEW_BOTTOM - this.listViewTop;
    this.listContainer = this.add.container(0, this.listViewTop);

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
        this.cursor = HEADERS.length + i;
        this.refresh();
      });
      row.on('pointerup', () => {
        // Game-object pointerup fires before scene-level pointerup, so .gesture
        // is still set here. If the gesture moved past threshold, treat it as a
        // swipe and skip the tap.
        if (this.gesture?.moved) return;
        this.cursor = HEADERS.length + i;
        this.start();
      });
      this.listContainer.add(row);
      this.rows.push(row);
    }

    const maskGraphics = this.make.graphics({});
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, this.listViewTop, GAME_W, this.listViewHeight);
    this.listContainer.setMask(maskGraphics.createGeometryMask());

    this.maxScroll = Math.max(0, WAVES.length * ROW_SPACING - this.listViewHeight);

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

    const hintTemplate = isTouchDevice
      ? 'tap to play   •   swipe list to scroll'
      : '<menuUp> <menuDown>: select   <confirm>: play   wheel: scroll   <back>: back';
    makePrompt(
      this,
      GAME_W / 2,
      GAME_H - 25,
      hintTemplate,
      { ...FONT_DEBUG, color: '#666666', align: 'center' },
      { align: 'center' },
    );

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.listViewTop || p.y > LIST_VIEW_BOTTOM) {
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
      const goBack = (): void => {
        this.scene.start('Menu');
      };
      kb.on('keydown-BACKSPACE', goBack);
      kb.on('keydown-ESC', goBack);
    }

    this.refresh();
    this.scrollToCursor();
  }

  private setScroll(target: number): void {
    this.scrollY = Phaser.Math.Clamp(target, 0, this.maxScroll);
    this.listContainer.y = this.listViewTop - this.scrollY;
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
    else if (bottom > this.scrollY + this.listViewHeight) {
      this.setScroll(bottom - this.listViewHeight);
    }
  }

  private rowText(wave: WaveDef): string {
    const stored = this.registry.get(PRACTICE_HITS_KEY_PREFIX + wave.id);
    const hits = typeof stored === 'number' ? `   hits: ${stored}` : '';
    return `${wave.name}${hits}`;
  }

  private refresh(): void {
    const target = this.cursorTarget(this.cursor);

    for (let i = 0; i < HEADERS.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by HEADERS.length
      const header = HEADERS[i]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded by headerTexts.length
      const text = this.headerTexts[i]!;
      const selected = target.kind === 'header' && target.index === i;
      text.setText(`${selected ? '▶ ' : '  '}${header.label}`);
      text.setColor(selected ? SELECTED_COLOR : HEADER_COLOR);
    }

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
    if (target.kind === 'header') {
      // biome-ignore lint/style/noNonNullAssertion: bounded by HEADERS.length
      const header = HEADERS[target.index]!;
      this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
      this.scene.start(header.scene ?? 'Game', header.data);
      return;
    }
    const wave = WAVES[target.index];
    if (!wave) return;
    // Test menu always uses Jane (CHARACTERS[0], mc_female) — there's no
    // mechanical difference between roster entries, so the character-select
    // detour adds no value here.
    this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
    this.scene.start('Game', { practice: wave });
  }
}
