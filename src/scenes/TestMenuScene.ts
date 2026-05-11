import Phaser from 'phaser';
import { DEVELOPER_MODE, GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS } from '../content/characters';
import { WAVES, type WaveDef } from '../content/stage';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import {
  COLOR_ACCENT_GOLD_STR,
  COLOR_ACCENT_GREEN_STR,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_MUTED_STR,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL_STR,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';
import { addScrollIndicators, type ScrollIndicators } from '../ui/scrollIndicator';
import { onTap } from '../ui/tap';
import { hydrateUnlocksFromStorage, PRACTICE_HITS_KEY_PREFIX, PRACTICE_UNLOCK_KEY_PREFIX } from './GameScene';

const ROW_SPACING = 44;
const HEADER_Y = 60;
const HEADER_BUTTON_SPACING = 32;
// Top of the unified scroll viewport — both header buttons and wave
// rows live inside listContainer so the whole list scrolls as one.
const LIST_VIEW_TOP = 130;
const LIST_VIEW_BOTTOM = GAME_H - 75;
// Vertical gap between the last header button and the first wave row.
const HEADER_WAVE_GAP = 16;
// Treat motion under this many game-pixels as a tap rather than a swipe.
const DRAG_THRESHOLD = 6;

// Header rows = accented green ("diagnostics shortcut"); regular rows = dark
// primary text on cream; selected = gold highlight regardless of row type.
const HEADER_COLOR = COLOR_ACCENT_GREEN_STR;
const ROW_COLOR = COLOR_TEXT_PRIMARY_STR;
const SELECTED_COLOR = COLOR_ACCENT_GOLD_STR;

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
  { label: 'PATTERN SANDBOX', scene: 'PatternTest' },
];

type CursorTarget = { kind: 'header'; index: number } | { kind: 'wave'; index: number };

// Per-run mutable state. Scene instances are reused across `scene.start`,
// so anything declared as a class-field initializer (`= []`, `= 0`) keeps
// last run's value when create() runs again — most visibly, push-mutated
// arrays grow without bound. Keeping it all in one object lets init()
// rebuild it from scratch each entry. Only fields assigned every create()
// (listContainer, indicators) stay on the scene as `!:` refs.
class RunState {
  readonly rows: Phaser.GameObjects.Text[] = [];
  readonly headerTexts: Phaser.GameObjects.Text[] = [];
  // Filtered subsets of HEADERS / WAVES that are actually shown.
  // Production builds restrict headers to the pattern-sandbox shortcut
  // and waves to ones the player has unlocked; DEVELOPER_MODE shows all
  // of them. Cursor / refresh / start all index into these lists, so
  // the production menu's keyboard navigation skips hidden items
  // automatically.
  visibleHeaders: HeaderButton[] = [];
  visibleWaves: WaveDef[] = [];
  // 0..visibleHeaders.length-1 = headers, then visibleHeaders.length..N = waves
  cursor = 0;
  scrollY = 0;
  maxScroll = 0;
  gesture: { downY: number; startScroll: number; moved: boolean } | null = null;
  // Computed at create time from visibleHeaders — wave list starts below the
  // last header button + a small gap.
  listViewTop = 0;
  listViewHeight = 0;
}

export class TestMenuScene extends Phaser.Scene {
  private listContainer!: Phaser.GameObjects.Container;
  private indicators!: ScrollIndicators;
  private state!: RunState;

  constructor() {
    super('TestMenu');
  }

  init(): void {
    this.state = new RunState();
    // Pull persisted per-wave unlock flags into the registry before
    // computeVisibleLists() reads them. Idempotent — a single boot's
    // worth of writes if GameScene already ran first this session.
    hydrateUnlocksFromStorage(this);
  }

  private get itemCount(): number {
    return this.state.visibleHeaders.length + this.state.visibleWaves.length;
  }

  private cursorTarget(c: number): CursorTarget {
    if (c < this.state.visibleHeaders.length) return { kind: 'header', index: c };
    return { kind: 'wave', index: c - this.state.visibleHeaders.length };
  }

  // Production builds expose only the pattern-sandbox header (other
  // diagnostics shortcuts and the full-stage entry are hidden) and
  // wave rows whose id has an unlock entry in the registry (waves
  // the player has reached during a real-stage run, hydrated from
  // localStorage on scene boot). DEVELOPER_MODE shows everything.
  private computeVisibleLists(): void {
    if (DEVELOPER_MODE) {
      this.state.visibleHeaders = HEADERS.slice();
      this.state.visibleWaves = WAVES.slice();
      return;
    }
    this.state.visibleHeaders = HEADERS.filter((h) => h.scene === 'PatternTest');
    this.state.visibleWaves = WAVES.filter((w) => this.registry.get(PRACTICE_UNLOCK_KEY_PREFIX + w.id) === true);
  }

  create(): void {
    bindLogicalCamera(this);
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);
    addMuteButton(this);
    this.computeVisibleLists();
    this.add
      .text(GAME_W / 2, HEADER_Y, 'PRACTICE', {
        ...FONT_TITLE,
        color: COLOR_ACCENT_GOLD_STR,
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, HEADER_Y + 38, 'select a wave', {
        ...FONT_DIALOGUE_SM,
        color: COLOR_TEXT_MUTED_STR,
      })
      .setOrigin(0.5);

    // Single scroll viewport covering both header shortcuts and wave
    // rows. Headers live at the top of listContainer; waves follow
    // after a fixed gap. Everything scrolls together so the headers
    // can disappear off the top to make room for the long wave list.
    this.state.listViewTop = LIST_VIEW_TOP;
    this.state.listViewHeight = LIST_VIEW_BOTTOM - this.state.listViewTop;
    this.listContainer = this.add.container(0, this.state.listViewTop);

    // Header shortcuts — full stage + each diagnostics test stage.
    for (let i = 0; i < this.state.visibleHeaders.length; i++) {
      const y = i * HEADER_BUTTON_SPACING + HEADER_BUTTON_SPACING / 2;
      const text = this.add
        .text(GAME_W / 2, y, '', {
          ...FONT_MENU,
          color: HEADER_COLOR,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      text.on('pointerover', (p: Phaser.Input.Pointer) => {
        if (isTouchDevice || p.isDown) return;
        this.state.cursor = i;
        this.refresh();
      });
      onTap(this, text, () => {
        if (this.state.gesture?.moved) return;
        this.state.cursor = i;
        this.start();
      });
      this.listContainer.add(text);
      this.state.headerTexts.push(text);
    }

    const wavesTop = this.state.visibleHeaders.length * HEADER_BUTTON_SPACING + HEADER_WAVE_GAP;

    for (let i = 0; i < this.state.visibleWaves.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by visibleWaves.length
      const wave = this.state.visibleWaves[i]!;
      const row = this.add
        .text(GAME_W / 2, wavesTop + i * ROW_SPACING + ROW_SPACING / 2, this.rowText(wave), {
          ...FONT_MENU,
          color: ROW_COLOR,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      row.on('pointerover', (p: Phaser.Input.Pointer) => {
        // On touch, pointerover fires on tap and would yank the cursor mid-swipe.
        // On desktop, ignore it during a held drag so the cursor doesn't chase the mouse.
        if (isTouchDevice || p.isDown) return;
        this.state.cursor = this.state.visibleHeaders.length + i;
        this.refresh();
      });
      // onTap registers its scene-level pointerup before the gesture-clearing
      // listener below, so the action sees `gesture` intact and can read
      // `.moved` to distinguish swipes from taps.
      onTap(this, row, () => {
        if (this.state.gesture?.moved) return;
        this.state.cursor = this.state.visibleHeaders.length + i;
        this.start();
      });
      this.listContainer.add(row);
      this.state.rows.push(row);
    }

    const maskGraphics = this.make.graphics({});
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, this.state.listViewTop, GAME_W, this.state.listViewHeight);
    this.listContainer.setMask(maskGraphics.createGeometryMask());

    const totalHeight = wavesTop + this.state.visibleWaves.length * ROW_SPACING;
    this.state.maxScroll = Math.max(0, totalHeight - this.state.listViewHeight);
    this.indicators = addScrollIndicators(this, this.state.listViewTop, LIST_VIEW_BOTTOM);
    this.indicators.update(this.state.scrollY, this.state.maxScroll);

    const back = this.add
      .text(GAME_W / 2, GAME_H - 55, '← back to menu', {
        ...FONT_DIALOGUE_SM,
        color: COLOR_TEXT_MUTED_STR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    onTap(this, back, () => {
      if (this.state.gesture?.moved) return;
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
      { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR, align: 'center' },
      { align: 'center' },
    );

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.state.listViewTop || p.y > LIST_VIEW_BOTTOM) {
        this.state.gesture = null;
        return;
      }
      this.state.gesture = { downY: p.y, startScroll: this.state.scrollY, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.state.gesture || !p.isDown) return;
      const dy = p.y - this.state.gesture.downY;
      if (Math.abs(dy) > DRAG_THRESHOLD) this.state.gesture.moved = true;
      if (this.state.gesture.moved) this.setScroll(this.state.gesture.startScroll - dy);
    });
    this.input.on('pointerup', () => {
      this.state.gesture = null;
    });

    this.input.on(
      'wheel',
      (_p: Phaser.Input.Pointer, _objs: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
        this.setScroll(this.state.scrollY + dy);
      },
    );

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => {
        if (this.itemCount === 0) return;
        this.state.cursor = (this.state.cursor - 1 + this.itemCount) % this.itemCount;
        this.refresh();
        this.scrollToCursor();
      });
      kb.on('keydown-DOWN', () => {
        if (this.itemCount === 0) return;
        this.state.cursor = (this.state.cursor + 1) % this.itemCount;
        this.refresh();
        this.scrollToCursor();
      });
      kb.on('keydown-Z', () => this.start());
      kb.on('keydown-ENTER', () => this.start());
      const goBack = (): void => {
        this.scene.start('Menu');
      };
      kb.on('keydown-ESC', goBack);
    }

    this.refresh();
    this.scrollToCursor();
  }

  private setScroll(target: number): void {
    this.state.scrollY = Phaser.Math.Clamp(target, 0, this.state.maxScroll);
    this.listContainer.y = this.state.listViewTop - this.state.scrollY;
    this.indicators.update(this.state.scrollY, this.state.maxScroll);
  }

  private scrollToCursor(): void {
    if (this.itemCount === 0) return;
    const target = this.cursorTarget(this.state.cursor);
    let top: number;
    let height: number;
    if (target.kind === 'header') {
      top = target.index * HEADER_BUTTON_SPACING;
      height = HEADER_BUTTON_SPACING;
    } else {
      const wavesTop = this.state.visibleHeaders.length * HEADER_BUTTON_SPACING + HEADER_WAVE_GAP;
      top = wavesTop + target.index * ROW_SPACING;
      height = ROW_SPACING;
    }
    const bottom = top + height;
    if (top < this.state.scrollY) this.setScroll(top);
    else if (bottom > this.state.scrollY + this.state.listViewHeight) {
      this.setScroll(bottom - this.state.listViewHeight);
    }
  }

  private rowText(wave: WaveDef): string {
    const stored = this.registry.get(PRACTICE_HITS_KEY_PREFIX + wave.id);
    const hits = typeof stored === 'number' ? `   hits: ${stored}` : '';
    return `${wave.name}${hits}`;
  }

  private refresh(): void {
    if (this.itemCount === 0) return;
    const target = this.cursorTarget(this.state.cursor);

    for (let i = 0; i < this.state.visibleHeaders.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by visibleHeaders.length
      const header = this.state.visibleHeaders[i]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded by headerTexts.length
      const text = this.state.headerTexts[i]!;
      const selected = target.kind === 'header' && target.index === i;
      text.setText(`${selected ? '▶ ' : '  '}${header.label}`);
      text.setColor(selected ? SELECTED_COLOR : HEADER_COLOR);
    }

    for (let i = 0; i < this.state.rows.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by visibleWaves.length
      const wave = this.state.visibleWaves[i]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded by rows.length
      const row = this.state.rows[i]!;
      const selected = target.kind === 'wave' && target.index === i;
      row.setText(`${selected ? '▶ ' : '  '}${this.rowText(wave)}`);
      row.setColor(selected ? SELECTED_COLOR : ROW_COLOR);
    }
  }

  private start(): void {
    if (this.itemCount === 0) return;
    const target = this.cursorTarget(this.state.cursor);
    if (target.kind === 'header') {
      // biome-ignore lint/style/noNonNullAssertion: bounded by visibleHeaders.length
      const header = this.state.visibleHeaders[target.index]!;
      this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
      // `?? {}` for the same reason as CharSelect.confirm — Phaser's
      // Systems.start only overwrites settings.data when the new data is
      // truthy. The `FULL STAGE (real)` header has no data field, so
      // without the fallback it would inherit whichever test/music data
      // was set by a previously-launched header.
      this.scene.start(header.scene ?? 'Game', header.data ?? {});
      return;
    }
    const wave = this.state.visibleWaves[target.index];
    if (!wave) return;
    // Test menu always uses Jane (CHARACTERS[0], mc_female) — there's no
    // mechanical difference between roster entries, so the character-select
    // detour adds no value here.
    this.registry.set(CHARACTER_REGISTRY_KEY, CHARACTERS[0]);
    this.scene.start('Game', { practice: wave });
  }
}
