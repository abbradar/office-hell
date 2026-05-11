import Phaser from 'phaser';
import { playClick } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import { breakLongUrl, SECTIONS } from '../content/credits';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import {
  COLOR_ACCENT_GOLD_STR,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_MUTED_STR,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL_STR,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';
import { addScrollIndicators, type ScrollIndicators } from '../ui/scrollIndicator';
import { onTap } from '../ui/tap';

// Layout knobs — title at 60, content viewport from ~98 down to
// GAME_H - 75 (back-link sits at GAME_H - 55, hint at GAME_H - 25).
const HEADER_Y = 60;
const LIST_VIEW_TOP = 88;
const LIST_VIEW_BOTTOM = GAME_H - 75;
const HEADING_TO_FIRST_ENTRY = 14;
const NAME_TO_SUB = 4;
const ENTRY_GAP_BELOW = 14;
const SOLO_ENTRY_GAP_BELOW = 10;
const SECTION_GAP = 18;
// Wrap text to most of the viewport with a small inset from each wall.
// Mirrors the ending-scene approach: long names ("nene — Boss Battle…")
// and long URLs split into multiple lines, with cursor advancement
// driven by `text.height` so the layout naturally grows.
const TEXT_WRAP = GAME_W - 32;
// Character budget for the pre-break in `breakLongUrl`. Wider than the
// ending panel's budget because the credits viewport has more room.
const URL_BREAK_CHARS = 44;
// Treat motion under this many game-pixels as a tap rather than a swipe
// (matches TestMenuScene so both lists feel the same on mobile).
const DRAG_THRESHOLD = 6;
// Per keypress scroll step for keyboard arrows.
const KEY_SCROLL_STEP = 32;

// Per-run mutable state. Phaser reuses the scene instance across
// `scene.start('Credits')`, so a class-field `scrollY = 0` keeps the
// last run's scroll position when create() runs again. Bundling it into
// one object lets init() rebuild from scratch each entry.
class RunState {
  scrollY = 0;
  maxScroll = 0;
  gesture: { downY: number; startScroll: number; moved: boolean } | null = null;
}

export class CreditsScene extends Phaser.Scene {
  private listContainer!: Phaser.GameObjects.Container;
  private indicators!: ScrollIndicators;
  private state!: RunState;

  constructor() {
    super('Credits');
  }

  init(): void {
    this.state = new RunState();
  }

  create(): void {
    bindLogicalCamera(this);
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);
    addMuteButton(this);

    this.add
      .text(GAME_W / 2, HEADER_Y, 'CREDITS', {
        ...FONT_TITLE,
        color: COLOR_ACCENT_GOLD_STR,
      })
      .setOrigin(0.5);

    // Single scrollable viewport. Section content is positioned in
    // container-local coords (cursorY starts at 0 = top of viewport)
    // so scrolling just translates the container; nothing else moves.
    const listViewHeight = LIST_VIEW_BOTTOM - LIST_VIEW_TOP;
    this.listContainer = this.add.container(0, LIST_VIEW_TOP);

    let cursorY = 0;
    for (const section of SECTIONS) {
      const heading = this.add
        .text(GAME_W / 2, cursorY, section.heading, {
          ...FONT_MENU,
          color: COLOR_ACCENT_GOLD_STR,
        })
        .setOrigin(0.5, 0);
      this.listContainer.add(heading);
      cursorY += heading.height + HEADING_TO_FIRST_ENTRY;

      for (const entry of section.entries ?? []) {
        // Names wrap so a long entry like "nene — Boss Battle #8 / #9,
        // Unchained Destiny — CC0" breaks across lines instead of
        // running off the side of the viewport.
        const name = this.add
          .text(GAME_W / 2, cursorY, entry.name, {
            ...FONT_DIALOGUE_LG,
            color: COLOR_TEXT_PRIMARY_STR,
            align: 'center',
            wordWrap: { width: TEXT_WRAP },
          })
          .setOrigin(0.5, 0);
        this.listContainer.add(name);
        cursorY += name.height;

        // URLs have no whitespace; pre-break at the last slash within
        // URL_BREAK_CHARS so Phaser's word-wrap has somewhere to split.
        const subText = entry.url ? breakLongUrl(entry.url, URL_BREAK_CHARS) : entry.role;
        if (subText) {
          cursorY += NAME_TO_SUB;
          const sub = this.add
            .text(GAME_W / 2, cursorY, subText, {
              ...FONT_DEBUG,
              color: COLOR_TEXT_DIM_STR,
              align: 'center',
              wordWrap: { width: TEXT_WRAP },
            })
            .setOrigin(0.5, 0);
          this.listContainer.add(sub);
          cursorY += sub.height + ENTRY_GAP_BELOW;
        } else {
          cursorY += SOLO_ENTRY_GAP_BELOW;
        }
      }

      if (section.body) {
        // Word-wrapped paragraph for free-form section text (the AI
        // disclosure). FONT_DEBUG so the disclosure recedes relative to
        // the credit names above it; wrap width leaves a small inset
        // from each wall so lines don't kiss the edge.
        const body = this.add
          .text(GAME_W / 2, cursorY, section.body, {
            ...FONT_DEBUG,
            color: COLOR_TEXT_MUTED_STR,
            align: 'center',
            wordWrap: { width: GAME_W - 48 },
          })
          .setOrigin(0.5, 0);
        this.listContainer.add(body);
        cursorY += body.height + 4;
      }

      cursorY += SECTION_GAP;
    }

    // Mask the container so content scrolling past the top/bottom of
    // the viewport gets clipped instead of bleeding over the title or
    // the back-link slot.
    const maskGraphics = this.make.graphics({});
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, LIST_VIEW_TOP, GAME_W, listViewHeight);
    this.listContainer.setMask(maskGraphics.createGeometryMask());

    const totalHeight = cursorY;
    this.state.maxScroll = Math.max(0, totalHeight - listViewHeight);
    this.indicators = addScrollIndicators(this, LIST_VIEW_TOP, LIST_VIEW_BOTTOM);
    this.indicators.update(this.state.scrollY, this.state.maxScroll);

    const back = this.add
      .text(GAME_W / 2, GAME_H - 55, '← back to menu', {
        ...FONT_DIALOGUE_SM,
        color: COLOR_TEXT_MUTED_STR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const goBack = (): void => {
      playClick();
      this.scene.start('Menu');
    };
    onTap(this, back, () => {
      if (this.state.gesture?.moved) return;
      goBack();
    });

    const hintTemplate = isTouchDevice
      ? 'tap "back to menu"   •   swipe to scroll'
      : '<back>: back   •   <menuUp> <menuDown> / wheel: scroll';
    makePrompt(
      this,
      GAME_W / 2,
      GAME_H - 25,
      hintTemplate,
      { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR, align: 'center' },
      { align: 'center' },
    );

    // Drag-to-scroll inside the viewport. Mirrors TestMenuScene's
    // gesture handling — pointerdown/up own the gesture object,
    // pointermove updates scrollY past the drag threshold so a tap on
    // the back link still goes through `onTap`.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < LIST_VIEW_TOP || p.y > LIST_VIEW_BOTTOM) {
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
      kb.on('keydown-UP', () => this.setScroll(this.state.scrollY - KEY_SCROLL_STEP));
      kb.on('keydown-DOWN', () => this.setScroll(this.state.scrollY + KEY_SCROLL_STEP));
      kb.on('keydown-PAGE_UP', () => this.setScroll(this.state.scrollY - listViewHeight));
      kb.on('keydown-PAGE_DOWN', () => this.setScroll(this.state.scrollY + listViewHeight));
      kb.on('keydown-ESC', goBack);
      kb.on('keydown-ENTER', goBack);
      kb.on('keydown-Z', goBack);
    }
  }

  private setScroll(target: number): void {
    this.state.scrollY = Phaser.Math.Clamp(target, 0, this.state.maxScroll);
    this.listContainer.y = LIST_VIEW_TOP - this.state.scrollY;
    this.indicators.update(this.state.scrollY, this.state.maxScroll);
  }
}
