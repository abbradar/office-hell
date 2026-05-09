// Live sandbox for tuning bullet patterns. Two interchangeable editors
// over the same Run/Stop/Reset action row:
//
//   Code    — a `<textarea>` overlaying the canvas; user writes the body
//             of an EntityScript directly.
//   Visual  — a Phaser-side block list. Each block is a primitive
//             (ring / aimed / spread / arc / wait*); click a block to
//             expand its parameters with -/+ adjusters; reorder via
//             ↑↓ on each block; "+" buttons append new blocks. The
//             generated source is wrapped in `function* (self) { ... }`
//             at Run time, same as the code tab.
//
// Each tab keeps its own state — the model isn't shared because parsing
// arbitrary user code back into block form isn't reasonable. Switching
// tabs is just a visibility flip; whichever tab is active when Run is
// pressed contributes the source.

import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { bullet } from '../content/kinds';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { bindLogicalCamera } from '../render/cameraBind';
import { displayState } from '../render/displayState';
import { aimed, arc, moveTo, ring, spread, walkOffScreen } from '../script/patterns';
import { StageManager } from '../script/StageManager';
import {
  markWave,
  waitAudioTimeAtLeast,
  waitEnemiesClear,
  waitEntityDead,
  waitScreenClear,
  waitSeconds,
} from '../script/stage';
import { EntityKind, type EntityScript } from '../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import {
  COLOR_ACCENT_GOLD,
  COLOR_ACCENT_GOLD_STR,
  COLOR_ACCENT_GREEN_STR,
  COLOR_ACCENT_RED_STR,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL_STR,
  DOM_TEXTAREA_BG,
  DOM_TEXTAREA_BORDER,
  DOM_TEXTAREA_FG,
} from '../ui/palette';

// --- helpers exposed to user scripts --------------------------------------

// Static helpers — bound at module scope and stable across scene instances.
// `bulletStyle` is added per-scene (it needs the texture cache + scene
// context for makeBullet) so it lives in the scene's `compileHelpers()`.
const STATIC_HELPERS = {
  ring,
  aimed,
  spread,
  arc,
  moveTo,
  walkOffScreen,
  bullet,
  waitSeconds,
  waitAudioTimeAtLeast,
  waitEnemiesClear,
  waitScreenClear,
  waitEntityDead,
  markWave,
} as const;

export type BulletShape = 'circle' | 'square' | 'diamond';
export type BulletStyleOpts = {
  // 24-bit RGB hex (e.g. 0xff5577 for pink).
  color?: number;
  // Hitbox radius in pixels — also drives the rendered glyph size.
  radius?: number;
  shape?: BulletShape;
};

const DEFAULT_CODE = `// Helpers in scope:
//   ring(self, count, kind, speed, baseAngleRad?)
//   aimed(self, count, kind, speed, spreadRad?)
//   spread(self, count, kind, speed, baseAngleRad, spreadRad)
//   arc(self, count, kind, speed, fromRad, toRad)
//   moveTo, walkOffScreen
//   yield* waitSeconds(s)        // audio-aware delay
//   yield N                      // wait N script frames
//
// Bullets:
//   bullet                       // default white circle
//   bulletStyle({ color, radius, shape })  // make a custom kind
//     color:  0xRRGGBB hex        (default 0xffffff)
//     radius: hitbox + glyph px   (default 3)
//     shape:  'circle'|'square'|'diamond'  (default 'circle')

const red = bulletStyle({ color: 0xff5577, radius: 4 });
const blue = bulletStyle({ color: 0x66bbff, radius: 4, shape: 'diamond' });

while (self.alive) {
  ring(self, 12, red, 130);
  yield* waitSeconds(0.25);
  ring(self, 12, blue, 130, Math.PI / 12);
  yield* waitSeconds(0.25);
}
`;

// --- block model -----------------------------------------------------------

type BlockType = 'ring' | 'aimed' | 'spread' | 'arc' | 'waitFrames' | 'waitSeconds';

type ParamSpec = {
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
  // True for angle params: stored in degrees here, converted to radians at
  // emit time.
  angle?: boolean;
};

type BlockSpec = {
  label: string;
  params: ParamSpec[];
  // Translate the block's params object into a single line of source.
  emit: (p: Record<string, number>) => string;
};

const deg2rad = (d: number): string => `${((d * Math.PI) / 180).toFixed(4)}`;

// Lookup with a fallback so `noUncheckedIndexedAccess` doesn't whine.
// Defaulting to 0 is safe because `makeBlock` initialises every param the
// spec lists; if a param is missing here it's a programmer error and 0 is
// as readable a fallback as throwing.
const pn = (p: Record<string, number>, key: string): number => p[key] ?? 0;

const BLOCK_SPECS: Record<BlockType, BlockSpec> = {
  ring: {
    label: 'ring',
    params: [
      { name: 'count', min: 1, max: 36, step: 1, default: 8 },
      { name: 'speed', min: 40, max: 500, step: 10, default: 130 },
      { name: 'angle', min: 0, max: 360, step: 15, default: 0, angle: true },
    ],
    emit: (p) => `ring(self, ${pn(p, 'count')}, bullet, ${pn(p, 'speed')}, ${deg2rad(pn(p, 'angle'))});`,
  },
  aimed: {
    label: 'aimed',
    params: [
      { name: 'count', min: 1, max: 24, step: 1, default: 5 },
      { name: 'speed', min: 40, max: 500, step: 10, default: 200 },
      { name: 'spread', min: 0, max: 180, step: 5, default: 30, angle: true },
    ],
    emit: (p) => `aimed(self, ${pn(p, 'count')}, bullet, ${pn(p, 'speed')}, ${deg2rad(pn(p, 'spread'))});`,
  },
  spread: {
    label: 'spread',
    params: [
      { name: 'count', min: 1, max: 24, step: 1, default: 7 },
      { name: 'speed', min: 40, max: 500, step: 10, default: 150 },
      { name: 'angle', min: 0, max: 360, step: 15, default: 90, angle: true },
      { name: 'spread', min: 0, max: 180, step: 5, default: 60, angle: true },
    ],
    emit: (p) =>
      `spread(self, ${pn(p, 'count')}, bullet, ${pn(p, 'speed')}, ${deg2rad(pn(p, 'angle'))}, ${deg2rad(pn(p, 'spread'))});`,
  },
  arc: {
    label: 'arc',
    params: [
      { name: 'count', min: 1, max: 24, step: 1, default: 9 },
      { name: 'speed', min: 40, max: 500, step: 10, default: 150 },
      { name: 'from', min: 0, max: 360, step: 15, default: 30, angle: true },
      { name: 'to', min: 0, max: 360, step: 15, default: 150, angle: true },
    ],
    emit: (p) =>
      `arc(self, ${pn(p, 'count')}, bullet, ${pn(p, 'speed')}, ${deg2rad(pn(p, 'from'))}, ${deg2rad(pn(p, 'to'))});`,
  },
  waitFrames: {
    label: 'wait (frames)',
    params: [{ name: 'frames', min: 1, max: 600, step: 5, default: 30 }],
    emit: (p) => `yield ${pn(p, 'frames')};`,
  },
  waitSeconds: {
    label: 'wait (seconds)',
    params: [{ name: 'seconds', min: 0.05, max: 10, step: 0.05, default: 0.5 }],
    emit: (p) => `yield* waitSeconds(${pn(p, 'seconds').toFixed(2)});`,
  },
};

const BLOCK_TYPE_ORDER: BlockType[] = ['ring', 'aimed', 'spread', 'arc', 'waitFrames', 'waitSeconds'];

type Block = {
  type: BlockType;
  params: Record<string, number>;
  expanded: boolean;
};

function makeBlock(type: BlockType): Block {
  const spec = BLOCK_SPECS[type];
  const params: Record<string, number> = {};
  for (const p of spec.params) params[p.name] = p.default;
  return { type, params, expanded: false };
}

const DEFAULT_BLOCKS: Block[] = [
  { type: 'ring', params: { count: 16, speed: 130, angle: 0 }, expanded: false },
  { type: 'waitSeconds', params: { seconds: 0.5 }, expanded: false },
];

function generateBlocksCode(blocks: Block[], loopForever: boolean): string {
  const lines: string[] = [];
  const indent = loopForever ? '  ' : '';
  if (loopForever) lines.push('while (self.alive) {');
  for (const b of blocks) lines.push(indent + BLOCK_SPECS[b.type].emit(b.params));
  if (loopForever) lines.push('}');
  return lines.join('\n');
}

// --- inert dummy enemy ----------------------------------------------------

const DUMMY_ENEMY = new EntityKind({
  sprite: 'boss',
  hitboxRadius: 16,
  hp: null,
  damageClass: [],
  damagedByClass: [],
});

// --- layout ---------------------------------------------------------------

const TITLE_Y = 22;
const ENEMY_X = GAME_W / 2;
const ENEMY_Y = 70;
const STUB_PLAYER_X = GAME_W / 2;
const STUB_PLAYER_Y = 200;

// Tab strip + editor area share the same vertical band; the active tab's
// UI lights up, the other's hides.
const TABS_Y = 232;
const EDITOR_TOP = 252;
const EDITOR_HEIGHT = 268;
const EDITOR_LEFT = 12;

// Two action rows so SAVE / LOAD have room without crowding RUN / STOP.
const ACTIONS_Y_1 = 536;
const ACTIONS_Y_2 = 568;
const STATUS_Y = 596;
const BACK_Y = 628;

// localStorage layout: a single key holds a JSON object mapping save name →
// raw source string. We always save the *currently active tab's source* —
// `currentSource()` generates from blocks if visual is active, so loading
// always lands the user on the code tab with a working snippet.
const STORAGE_KEY = 'office-hell:pattern-saves';

type SavedPatterns = Record<string, string>;

function readSavedPatterns(): SavedPatterns {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as SavedPatterns;
    return {};
  } catch {
    return {};
  }
}

function writeSavedPatterns(saves: SavedPatterns): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
    return true;
  } catch {
    return false;
  }
}

// Visual editor specifics.
const VISUAL_LOOP_Y = EDITOR_TOP + 4;
const VISUAL_ADD_ROW_Y = EDITOR_TOP + 26;
const VISUAL_LIST_TOP = EDITOR_TOP + 56;
const VISUAL_LIST_BOTTOM = EDITOR_TOP + EDITOR_HEIGHT - 4;
const BLOCK_HEADER_H = 22;
const BLOCK_PARAM_H = 20;
const BLOCK_GAP = 4;

const COLOR_DIM = COLOR_TEXT_DIM_STR;
const COLOR_RUN = COLOR_ACCENT_GREEN_STR;
const COLOR_DANGER = COLOR_ACCENT_RED_STR;
const COLOR_HIGHLIGHT = COLOR_ACCENT_GOLD_STR;
const COLOR_TEXT = COLOR_TEXT_PRIMARY_STR;
const COLOR_BLOCK_BG = COLOR_PANEL;
const COLOR_BLOCK_BORDER = COLOR_PANEL_BORDER;
const COLOR_BLOCK_BORDER_EXPANDED = COLOR_ACCENT_GOLD;

type Mode = 'code' | 'visual';
type CompileResult = { fn: EntityScript } | { error: string };

// Per-run mutable state. Phaser reuses the scene instance across
// `scene.start('PatternTest')`, so class-field initializers (`= []`,
// `= 'code'`) only fire at construction — without rebuilding on each
// entry, the user's last block edits, scroll position, and an open
// load modal would leak into the next session. Anything reassigned in
// every create() (codeEditor, codeTab, visualTab, visualContainer,
// visualMask, statusText) stays on the scene as `!:` refs.
class RunState {
  enemy: Entity | null = null;
  mode: Mode = 'code';
  // Visual editor model. Each entry is cloned out of DEFAULT_BLOCKS so
  // edits never reach back to the module-level template.
  blocks: Block[] = DEFAULT_BLOCKS.map((b) => ({ ...b, params: { ...b.params } }));
  loopForever = true;
  // Phaser objects for the visual editor — destroyed and rebuilt on each
  // model change. Easier than diffing.
  visualObjects: Phaser.GameObjects.GameObject[] = [];
  visualScrollY = 0;
  visualMaxScroll = 0;
  // Status text has two flavours:
  //   'live'   — auto-appends `  fps: N  active: M` each frame.
  //              Used for steady-state messages (idle / running / stopped)
  //              where ambient stats are useful to watch during stress tests.
  //   'static' — left as-is until the next setStatus call. For error messages,
  //              save/load confirmations, etc. that shouldn't get clobbered
  //              by the per-frame refresh.
  statusKind: 'live' | 'static' = 'live';
  statusPrefix = 'idle';
  // Currently-open load modal (null when closed). Holds backdrop + panel
  // + entry rows in a single Container so dismissing tears the lot down.
  loadModal: Phaser.GameObjects.Container | null = null;
}

export class PatternTestScene extends Phaser.Scene {
  private stage!: StageManager;
  private codeEditor!: HTMLTextAreaElement;
  // Tab buttons — recoloured on switch.
  private codeTab!: Phaser.GameObjects.Text;
  private visualTab!: Phaser.GameObjects.Text;
  private visualContainer!: Phaser.GameObjects.Container;
  private visualMask!: Phaser.Display.Masks.GeometryMask;
  private statusText!: Phaser.GameObjects.Text;
  private state!: RunState;

  constructor() {
    super('PatternTest');
  }

  init(): void {
    this.state = new RunState();
  }

  create(): void {
    bindLogicalCamera(this);
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);
    addMuteButton(this);

    this.add.text(GAME_W / 2, TITLE_Y, 'PATTERN SANDBOX', { ...FONT_TITLE, color: COLOR_HIGHLIGHT }).setOrigin(0.5);

    this.stage = new StageManager(this);
    this.stage.player = { x: STUB_PLAYER_X, y: STUB_PLAYER_Y } as unknown as Player;

    this.add
      .circle(STUB_PLAYER_X, STUB_PLAYER_Y, 6, COLOR_TEXT_PRIMARY, 0)
      .setStrokeStyle(1, COLOR_TEXT_PRIMARY, 0.4)
      .setDepth(50);

    this.spawnIdleEnemy();

    this.buildTabs();
    this.buildCodeEditor();
    this.buildVisualEditor();
    this.buildActions();

    this.applyMode();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.codeEditor.remove();
    });
  }

  override update(time: number, delta: number): void {
    this.stage.update(time, delta);
    if (this.state.mode === 'code') this.repositionCodeEditor();
    this.refreshLiveStats();
  }

  // --- tabs ---------------------------------------------------------------

  private buildTabs(): void {
    this.codeTab = this.add
      .text(GAME_W / 2 - 60, TABS_Y, 'CODE', { ...FONT_MENU })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.codeTab.on('pointerup', () => this.setMode('code'));

    this.visualTab = this.add
      .text(GAME_W / 2 + 60, TABS_Y, 'VISUAL', { ...FONT_MENU })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.visualTab.on('pointerup', () => this.setMode('visual'));
  }

  private setMode(mode: Mode): void {
    this.state.mode = mode;
    this.applyMode();
  }

  private applyMode(): void {
    this.codeTab.setColor(this.state.mode === 'code' ? COLOR_HIGHLIGHT : COLOR_DIM);
    this.visualTab.setColor(this.state.mode === 'visual' ? COLOR_HIGHLIGHT : COLOR_DIM);
    // Code tab uses an HTML overlay; show/hide via display rather than
    // visibility so the textarea doesn't reserve focusable space when
    // hidden.
    this.codeEditor.style.display = this.state.mode === 'code' ? '' : 'none';
    // Visual tab is Phaser objects — toggle the container's visibility.
    this.visualContainer.setVisible(this.state.mode === 'visual');
  }

  // --- code editor (HTML overlay) -----------------------------------------

  private buildCodeEditor(): void {
    const el = document.createElement('textarea');
    el.value = DEFAULT_CODE;
    el.spellcheck = false;
    el.autocapitalize = 'off';
    el.autocomplete = 'off';
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '10',
      fontFamily: 'ui-monospace, "SF Mono", Consolas, Menlo, monospace',
      background: DOM_TEXTAREA_BG,
      color: DOM_TEXTAREA_FG,
      border: `1px solid ${DOM_TEXTAREA_BORDER}`,
      borderRadius: '4px',
      resize: 'none',
      padding: '8px',
      boxSizing: 'border-box',
      whiteSpace: 'pre',
      lineHeight: '1.4',
      tabSize: '2',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.codeEditor = el;
    this.repositionCodeEditor();
  }

  private repositionCodeEditor(): void {
    // Convert logical (EDITOR_LEFT, EDITOR_TOP) to CSS pixels for the
    // DOM textarea overlay. Under the new rendering pipeline the canvas
    // internal is device-pixel-sized; the world is rendered into a
    // centered viewport at displayState.offset/scale (device pixels).
    // CSS-per-device = rect.width / canvas.width handles the browser-
    // side display scaling.
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const cssPerDevice = canvas.width > 0 ? rect.width / canvas.width : 1;
    const cssScale = displayState.scale * cssPerDevice;
    const left = rect.left + displayState.offsetX * cssPerDevice + EDITOR_LEFT * cssScale;
    const top = rect.top + displayState.offsetY * cssPerDevice + EDITOR_TOP * cssScale;
    const width = (GAME_W - EDITOR_LEFT * 2) * cssScale;
    const height = EDITOR_HEIGHT * cssScale;
    const fontPx = Math.max(11, Math.round(13 * cssScale));
    this.codeEditor.style.left = `${left}px`;
    this.codeEditor.style.top = `${top}px`;
    this.codeEditor.style.width = `${width}px`;
    this.codeEditor.style.height = `${height}px`;
    this.codeEditor.style.fontSize = `${fontPx}px`;
  }

  // --- visual editor ------------------------------------------------------

  private buildVisualEditor(): void {
    this.visualContainer = this.add.container(0, 0).setDepth(20);

    // Mask covers the editor band so scrolled blocks clip cleanly at the
    // top/bottom edges.
    const maskG = this.make.graphics({});
    maskG.fillStyle(0xffffff);
    maskG.fillRect(EDITOR_LEFT, EDITOR_TOP, GAME_W - EDITOR_LEFT * 2, EDITOR_HEIGHT);
    this.visualMask = maskG.createGeometryMask();

    // Wheel scrolls the block list when the visual tab is active.
    this.input.on(
      'wheel',
      (p: Phaser.Input.Pointer, _objs: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
        if (this.state.mode !== 'visual') return;
        if (p.y < EDITOR_TOP || p.y > EDITOR_TOP + EDITOR_HEIGHT) return;
        this.state.visualScrollY = Phaser.Math.Clamp(this.state.visualScrollY + dy, 0, this.state.visualMaxScroll);
        this.renderVisual();
      },
    );

    this.renderVisual();
  }

  private renderVisual(): void {
    for (const obj of this.state.visualObjects) obj.destroy();
    this.state.visualObjects = [];

    // Loop-forever toggle (always at top, doesn't scroll).
    const loopText = this.add
      .text(EDITOR_LEFT + 4, VISUAL_LOOP_Y, `${this.state.loopForever ? '☑' : '☐'} loop forever`, {
        ...FONT_DIALOGUE_SM,
        color: this.state.loopForever ? COLOR_HIGHLIGHT : COLOR_DIM,
      })
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    loopText.on('pointerup', () => {
      this.state.loopForever = !this.state.loopForever;
      this.renderVisual();
    });
    this.visualContainer.add(loopText);
    this.state.visualObjects.push(loopText);

    // Add-block buttons (inline labels, "+ ring", "+ aimed", …).
    const addLabel = this.add
      .text(EDITOR_LEFT + 4, VISUAL_ADD_ROW_Y, 'add:', { ...FONT_DEBUG, color: COLOR_DIM })
      .setOrigin(0, 0);
    this.visualContainer.add(addLabel);
    this.state.visualObjects.push(addLabel);

    let addX = EDITOR_LEFT + 36;
    for (const type of BLOCK_TYPE_ORDER) {
      const t = this.add
        .text(addX, VISUAL_ADD_ROW_Y, BLOCK_SPECS[type].label, {
          ...FONT_DEBUG,
          color: COLOR_RUN,
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      t.on('pointerup', () => {
        this.state.blocks.push(makeBlock(type));
        this.renderVisual();
      });
      this.visualContainer.add(t);
      this.state.visualObjects.push(t);
      addX += t.width + 10;
    }

    // Block list (scrollable). Render INTO a sub-container that gets a
    // mask + Y-offset, so the loop toggle and add row above don't clip.
    const listContainer = this.add.container(0, VISUAL_LIST_TOP - this.state.visualScrollY);
    listContainer.setMask(this.visualMask);
    this.visualContainer.add(listContainer);
    this.state.visualObjects.push(listContainer);

    let y = 0;
    for (let i = 0; i < this.state.blocks.length; i++) {
      const block = this.state.blocks[i];
      if (!block) continue;
      const headerH = BLOCK_HEADER_H;
      const expandedH = block.expanded ? BLOCK_SPECS[block.type].params.length * BLOCK_PARAM_H : 0;
      const totalH = headerH + expandedH;

      // Background panel.
      const bg = this.add.graphics();
      bg.fillStyle(COLOR_BLOCK_BG, 0.85);
      bg.fillRoundedRect(EDITOR_LEFT + 2, y, GAME_W - (EDITOR_LEFT + 2) * 2, totalH, 4);
      bg.lineStyle(1, block.expanded ? COLOR_BLOCK_BORDER_EXPANDED : COLOR_BLOCK_BORDER, 1);
      bg.strokeRoundedRect(EDITOR_LEFT + 2, y, GAME_W - (EDITOR_LEFT + 2) * 2, totalH, 4);
      listContainer.add(bg);

      // Header content.
      this.renderBlockHeader(listContainer, block, i, y);

      // Param rows when expanded.
      if (block.expanded) {
        let py = y + headerH;
        for (const ps of BLOCK_SPECS[block.type].params) {
          this.renderParamRow(listContainer, block, ps, py);
          py += BLOCK_PARAM_H;
        }
      }

      y += totalH + BLOCK_GAP;
    }

    const listHeight = VISUAL_LIST_BOTTOM - VISUAL_LIST_TOP;
    this.state.visualMaxScroll = Math.max(0, y - listHeight);
    if (this.state.visualScrollY > this.state.visualMaxScroll) {
      this.state.visualScrollY = this.state.visualMaxScroll;
      listContainer.y = VISUAL_LIST_TOP - this.state.visualScrollY;
    }

    this.visualContainer.setVisible(this.state.mode === 'visual');
  }

  private renderBlockHeader(parent: Phaser.GameObjects.Container, block: Block, index: number, y: number): void {
    const spec = BLOCK_SPECS[block.type];
    const px = EDITOR_LEFT + 8;
    const right = GAME_W - EDITOR_LEFT - 6;
    const created: Phaser.GameObjects.GameObject[] = [];

    const caret = this.add
      .text(px, y + BLOCK_HEADER_H / 2, block.expanded ? '▼' : '▶', { ...FONT_DEBUG, color: COLOR_HIGHLIGHT })
      .setOrigin(0, 0.5);
    created.push(caret);

    const labelX = px + 14;
    const label = this.add
      .text(labelX, y + BLOCK_HEADER_H / 2, spec.label, { ...FONT_DIALOGUE_SM, color: COLOR_TEXT })
      .setOrigin(0, 0.5);
    created.push(label);

    // Compact summary of params on the collapsed row so the user can
    // glance the values without expanding (e.g. "count=16 speed=130 angle=0°").
    if (!block.expanded) {
      const summary = spec.params.map((p) => `${p.name}=${this.formatValue(block.params[p.name] ?? 0, p)}`).join('  ');
      const summaryText = this.add
        .text(labelX + label.width + 8, y + BLOCK_HEADER_H / 2, summary, {
          ...FONT_DEBUG,
          color: COLOR_DIM,
        })
        .setOrigin(0, 0.5);
      created.push(summaryText);
    }

    // Click region — covers caret + label so either toggles expansion.
    // Stops short of the ▲▼× cluster so those don't double-trigger.
    const headerHit = this.add
      .zone(EDITOR_LEFT + 4, y, GAME_W - (EDITOR_LEFT + 4) * 2 - 80, BLOCK_HEADER_H)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    headerHit.on('pointerup', () => {
      block.expanded = !block.expanded;
      this.renderVisual();
    });
    created.push(headerHit);

    // Up / Down / Delete buttons on the right.
    created.push(
      this.makeRowButton(right - 56, y + BLOCK_HEADER_H / 2, '▲', () => {
        if (index === 0) return;
        [this.state.blocks[index - 1], this.state.blocks[index]] = [
          this.state.blocks[index],
          this.state.blocks[index - 1],
        ] as [Block, Block];
        this.renderVisual();
      }),
    );
    created.push(
      this.makeRowButton(right - 32, y + BLOCK_HEADER_H / 2, '▼', () => {
        if (index === this.state.blocks.length - 1) return;
        [this.state.blocks[index], this.state.blocks[index + 1]] = [
          this.state.blocks[index + 1],
          this.state.blocks[index],
        ] as [Block, Block];
        this.renderVisual();
      }),
    );
    created.push(
      this.makeRowButton(right - 8, y + BLOCK_HEADER_H / 2, '×', () => {
        this.state.blocks.splice(index, 1);
        this.renderVisual();
      }),
    );

    parent.add(created);
  }

  private renderParamRow(parent: Phaser.GameObjects.Container, block: Block, ps: ParamSpec, y: number): void {
    const px = EDITOR_LEFT + 24;
    const right = GAME_W - EDITOR_LEFT - 6;
    const value = block.params[ps.name] ?? ps.default;

    const label = this.add
      .text(px, y + BLOCK_PARAM_H / 2, `${ps.name}:`, { ...FONT_DEBUG, color: COLOR_TEXT })
      .setOrigin(0, 0.5);
    const valueText = this.add
      .text(px + 70, y + BLOCK_PARAM_H / 2, this.formatValue(value, ps), {
        ...FONT_DEBUG,
        color: COLOR_HIGHLIGHT,
      })
      .setOrigin(0, 0.5);
    const minus = this.makeRowButton(right - 32, y + BLOCK_PARAM_H / 2, '–', () => {
      this.adjustParam(block, ps, -1);
    });
    const plus = this.makeRowButton(right - 8, y + BLOCK_PARAM_H / 2, '+', () => {
      this.adjustParam(block, ps, 1);
    });

    parent.add([label, valueText, minus, plus]);
  }

  private adjustParam(block: Block, ps: ParamSpec, dir: number): void {
    const next = (block.params[ps.name] ?? ps.default) + dir * ps.step;
    block.params[ps.name] = Phaser.Math.Clamp(roundTo(next, ps.step), ps.min, ps.max);
    this.renderVisual();
  }

  private formatValue(v: number, ps: ParamSpec): string {
    const stepIsInt = Number.isInteger(ps.step);
    const formatted = stepIsInt ? `${v}` : v.toFixed(2);
    return ps.angle ? `${formatted}°` : formatted;
  }

  private makeRowButton(x: number, y: number, glyph: string, onClick: () => void): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, glyph, { ...FONT_DEBUG, color: COLOR_TEXT })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerup', onClick);
    return t;
  }

  // --- actions ------------------------------------------------------------

  private buildActions(): void {
    // Row 1: run / stop / reset.
    const run = this.add
      .text(GAME_W / 2 - 90, ACTIONS_Y_1, '▶ RUN', { ...FONT_MENU, color: COLOR_RUN })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    run.on('pointerup', () => this.runUserScript());

    const stop = this.add
      .text(GAME_W / 2, ACTIONS_Y_1, '■ STOP', { ...FONT_MENU, color: COLOR_DANGER })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    stop.on('pointerup', () => this.stopUserScript());

    const reset = this.add
      .text(GAME_W / 2 + 90, ACTIONS_Y_1, '↻ RESET', { ...FONT_MENU, color: COLOR_DIM })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    reset.on('pointerup', () => {
      if (this.state.mode === 'code') {
        this.codeEditor.value = DEFAULT_CODE;
      } else {
        this.state.blocks = DEFAULT_BLOCKS.map((b) => ({ ...b, params: { ...b.params } }));
        this.state.loopForever = true;
        this.state.visualScrollY = 0;
        this.renderVisual();
      }
      this.setStatus('reset', COLOR_DIM);
    });

    // Row 2: save / load — localStorage-backed.
    const save = this.add
      .text(GAME_W / 2 - 60, ACTIONS_Y_2, '💾 SAVE', { ...FONT_MENU, color: COLOR_HIGHLIGHT })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    save.on('pointerup', () => this.savePrompt());

    const load = this.add
      .text(GAME_W / 2 + 60, ACTIONS_Y_2, '📂 LOAD', { ...FONT_MENU, color: COLOR_HIGHLIGHT })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    load.on('pointerup', () => this.openLoadModal());

    this.statusText = this.add.text(GAME_W / 2, STATUS_Y, 'idle', { ...FONT_DEBUG, color: COLOR_DIM }).setOrigin(0.5);

    const back = this.add
      .text(GAME_W / 2, BACK_Y, '← back', { ...FONT_DIALOGUE_SM, color: COLOR_DIM })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerup', () => this.scene.start('TestMenu'));
  }

  // --- script lifecycle ---------------------------------------------------

  private currentSource(): string {
    return this.state.mode === 'code'
      ? this.codeEditor.value
      : generateBlocksCode(this.state.blocks, this.state.loopForever);
  }

  private spawnIdleEnemy(): void {
    if (this.state.enemy?.alive) this.state.enemy.die();
    this.state.enemy = this.stage.spawn(DUMMY_ENEMY, ENEMY_X, ENEMY_Y, 0, 0);
  }

  private runUserScript(): void {
    const result = this.compile(this.currentSource());
    if ('error' in result) {
      this.setStatus(`error: ${result.error}`, COLOR_DANGER);
      return;
    }
    if (this.state.enemy?.alive) this.state.enemy.die();
    this.clearBullets();
    this.state.enemy = this.stage.spawn(DUMMY_ENEMY, ENEMY_X, ENEMY_Y, 0, 0, { script: result.fn });
    this.setStatus('running', COLOR_RUN, 'live');
  }

  private stopUserScript(): void {
    if (this.state.enemy?.alive) this.state.enemy.die();
    this.clearBullets();
    this.spawnIdleEnemy();
    this.setStatus('stopped', COLOR_DIM, 'live');
  }

  private clearBullets(): void {
    for (const child of this.stage.damages.player.getChildren()) {
      const e = child as Entity;
      if (e.alive) e.die();
    }
  }

  private compile(src: string): CompileResult {
    try {
      // Scene-bound helpers — bulletStyle needs the scene's texture cache
      // and `make.graphics`, so it can't live at module scope alongside
      // the others. Add it here and let the rest of the helper map be
      // static.
      const helpers = {
        ...STATIC_HELPERS,
        bulletStyle: (opts: BulletStyleOpts = {}) => this.makeBullet(opts),
      };
      const keys = Object.keys(helpers);
      const factory = new Function(...keys, `return function* (self) {\n${src}\n};`) as (
        ...args: unknown[]
      ) => EntityScript;
      const args = keys.map((k) => (helpers as Record<string, unknown>)[k]);
      const fn = factory(...args);
      return { fn };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Build (or fetch from cache) a sandbox EntityKind whose sprite is a
  // small filled glyph. Texture key encodes the parameters so repeated
  // calls with the same opts share a single cached texture — Phaser's
  // texture manager keeps the bytes around for the lifetime of the
  // game, so don't churn them.
  private makeBullet(opts: BulletStyleOpts): EntityKind {
    const radius = Math.max(1, Math.round(opts.radius ?? 3));
    const color = (opts.color ?? 0xffffff) & 0xffffff;
    const shape: BulletShape = opts.shape ?? 'circle';
    const key = `sandbox_bullet_${shape}_${color.toString(16).padStart(6, '0')}_r${radius}`;

    if (!this.textures.exists(key)) {
      const size = radius * 2;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(color, 1);
      if (shape === 'circle') {
        g.fillCircle(radius, radius, radius);
      } else if (shape === 'square') {
        g.fillRect(0, 0, size, size);
      } else {
        // diamond — square rotated 45°, drawn as four triangles around the
        // centre to land on integer pixels at typical bullet sizes.
        g.fillPoints(
          [
            { x: radius, y: 0 },
            { x: size, y: radius },
            { x: radius, y: size },
            { x: 0, y: radius },
          ],
          true,
        );
      }
      g.generateTexture(key, size, size);
      g.destroy();
    }

    return new EntityKind({
      sprite: key,
      hitboxRadius: radius,
      hp: null,
      damageClass: ['player'],
      damagedByClass: [],
    });
  }

  private setStatus(message: string, color: string, kind: 'live' | 'static' = 'static'): void {
    this.statusText.setColor(color);
    this.statusText.setText(message);
    this.state.statusPrefix = message;
    this.state.statusKind = kind;
  }

  // Per-frame stats append. Only fires when the status is "live"
  // (idle / running / stopped) — error and save/load messages keep their
  // static text.
  private refreshLiveStats(): void {
    if (this.state.statusKind !== 'live') return;
    const fps = Math.round(this.game.loop.actualFps);
    const active = this.stage.damages.player.countActive(true);
    this.statusText.setText(`${this.state.statusPrefix}  fps: ${fps}  active: ${active}`);
  }

  // --- save / load -------------------------------------------------------

  // Open a quick-and-dirty native prompt for the slot name. Native prompt
  // because we're already mixing DOM (textarea) into the scene; building
  // a Phaser-side text input for a one-shot is overkill.
  private savePrompt(): void {
    const source = this.currentSource();
    const existing = readSavedPatterns();
    const proposed = window.prompt('Save pattern as:', '');
    if (proposed === null) return;
    const name = proposed.trim();
    if (name === '') {
      this.setStatus('save cancelled (empty name)', COLOR_DIM);
      return;
    }
    if (existing[name] !== undefined) {
      const ok = window.confirm(`"${name}" already exists. Overwrite?`);
      if (!ok) return;
    }
    existing[name] = source;
    if (writeSavedPatterns(existing)) {
      this.setStatus(`saved: ${name}`, COLOR_HIGHLIGHT);
    } else {
      this.setStatus('save failed (storage unavailable?)', COLOR_DANGER);
    }
  }

  private openLoadModal(): void {
    if (this.state.loadModal !== null) return;
    const saves = readSavedPatterns();
    const names = Object.keys(saves).sort();

    // The code tab's textarea is a DOM element with z-index 10, sitting on
    // top of the Phaser canvas — a Phaser-side modal renders *under* it
    // and the entries become unclickable. Hide it for the modal's
    // lifetime; restore via applyMode() when the modal closes.
    this.codeEditor.style.display = 'none';

    const modal = this.add.container(0, 0).setDepth(300);

    // Backdrop — click to dismiss. Dim with the dark text color so it
    // reads as a "darken everything below" overlay.
    const backdrop = this.add
      .rectangle(0, 0, GAME_W, GAME_H, COLOR_TEXT_PRIMARY, 0.55)
      .setOrigin(0, 0)
      .setInteractive();
    backdrop.on('pointerup', () => this.closeLoadModal());
    modal.add(backdrop);

    const panelW = 320;
    const headerH = 36;
    const rowH = 28;
    const footerH = 36;
    const visibleRows = Math.max(1, names.length || 1);
    const panelH = Math.min(GAME_H - 80, headerH + visibleRows * rowH + footerH);
    const panelX = (GAME_W - panelW) / 2;
    const panelY = (GAME_H - panelH) / 2;

    const panel = this.add.graphics();
    panel.fillStyle(COLOR_BLOCK_BG, 0.98);
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 6);
    panel.lineStyle(1, COLOR_BLOCK_BORDER_EXPANDED, 1);
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 6);
    modal.add(panel);

    // Block backdrop clicks landing inside the panel from dismissing —
    // only outside-the-panel clicks should close.
    const panelBlocker = this.add.zone(panelX, panelY, panelW, panelH).setOrigin(0, 0).setInteractive();
    modal.add(panelBlocker);

    const title = this.add
      .text(panelX + panelW / 2, panelY + 18, 'load pattern', {
        ...FONT_DIALOGUE_SM,
        color: COLOR_HIGHLIGHT,
      })
      .setOrigin(0.5);
    modal.add(title);

    if (names.length === 0) {
      const empty = this.add
        .text(panelX + panelW / 2, panelY + headerH + 24, '(no saved patterns)', {
          ...FONT_DEBUG,
          color: COLOR_DIM,
        })
        .setOrigin(0.5);
      modal.add(empty);
    } else {
      let rowY = panelY + headerH;
      for (const name of names) {
        const nameText = this.add
          .text(panelX + 14, rowY + rowH / 2, name, { ...FONT_DIALOGUE_SM, color: COLOR_TEXT })
          .setOrigin(0, 0.5);
        const loadBtn = this.add
          .text(panelX + panelW - 56, rowY + rowH / 2, 'load', { ...FONT_DEBUG, color: COLOR_RUN })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        loadBtn.on('pointerup', () => this.loadPattern(name));
        const delBtn = this.add
          .text(panelX + panelW - 20, rowY + rowH / 2, '×', { ...FONT_MENU, color: COLOR_DANGER })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        delBtn.on('pointerup', () => this.deletePattern(name));
        modal.add([nameText, loadBtn, delBtn]);
        rowY += rowH;
      }
    }

    const close = this.add
      .text(panelX + panelW / 2, panelY + panelH - 18, 'close', { ...FONT_DEBUG, color: COLOR_DIM })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closeLoadModal());
    modal.add(close);

    this.state.loadModal = modal;
  }

  private closeLoadModal(): void {
    if (this.state.loadModal === null) return;
    this.state.loadModal.destroy();
    this.state.loadModal = null;
    // Re-show the code editor if the active tab wants it. (applyMode
    // owns the display rule — it also covers the case where loadPattern
    // flipped us to the code tab between open and close.)
    this.applyMode();
  }

  private loadPattern(name: string): void {
    const saves = readSavedPatterns();
    const src = saves[name];
    if (src === undefined) {
      this.setStatus(`load failed: "${name}" not found`, COLOR_DANGER);
      this.closeLoadModal();
      return;
    }
    // Always land on the code tab — the saved source is plain text and
    // doesn't round-trip back into block form, so showing it in the
    // editor where the user can read/edit it is the honest move.
    this.codeEditor.value = src;
    this.setMode('code');
    this.closeLoadModal();
    this.setStatus(`loaded: ${name}`, COLOR_HIGHLIGHT);
  }

  private deletePattern(name: string): void {
    const ok = window.confirm(`Delete "${name}"?`);
    if (!ok) return;
    const saves = readSavedPatterns();
    delete saves[name];
    writeSavedPatterns(saves);
    // Re-open the modal so the list refreshes.
    this.closeLoadModal();
    this.openLoadModal();
    this.setStatus(`deleted: ${name}`, COLOR_DIM);
  }
}

// Round `v` to the nearest multiple of `step`, sized to step's precision so
// 0.05 + 0.05 stays 0.10 instead of drifting via FP error.
function roundTo(v: number, step: number): number {
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  return Number(v.toFixed(decimals));
}
