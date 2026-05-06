import type Phaser from 'phaser';
import { gameH, gameW } from '../config';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_LG } from './fonts';
import {
  COLOR_ACCENT_GOLD,
  COLOR_ACCENT_GOLD_STR,
  COLOR_NO_TINT,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_INVERSE_STR,
  COLOR_TEXT_PRIMARY_STR,
} from './palette';
import { makePrompt } from './prompt';

export type DialoguePortrait = {
  sprite: string;
  frame?: number;
  name: string;
};

export type DialogueLine = {
  speaker: 'left' | 'right';
  text: string;
};

export type DialogueOpts = {
  left?: DialoguePortrait;
  right?: DialoguePortrait;
  lines: DialogueLine[];
};

const DEPTH = 200;
const PORTRAIT_SCALE = 4;
const PORTRAIT_Y = gameH() * 0.42;
const PORTRAIT_INSET = 24;
const TEXT_BOX_H = 150;
const TEXT_BOX_MARGIN = 12;
const TEXT_BOX_Y = gameH() - TEXT_BOX_H - TEXT_BOX_MARGIN;
const TEXT_BOX_PAD = 14;
const TEXT_BOX_FILL = COLOR_PANEL;
const TEXT_BOX_ALPHA = 0.95;
const TEXT_BOX_STROKE = COLOR_ACCENT_GOLD;
const TEXT_BOX_STROKE_ALPHA = 0.85;
const TEXT_BOX_RADIUS = 10;
const NAME_BG_FILL = COLOR_ACCENT_GOLD;
const NAME_BG_ALPHA = 0.95;
// Name plate is gold; text on top is dark for contrast. INVERSE captures
// "always dark" — independent of the theme's PRIMARY (which flips with bg).
const NAME_COLOR = COLOR_TEXT_INVERSE_STR;
const NAME_PAD_X = 8;
const NAME_PAD_Y = 3;
const TEXT_COLOR = COLOR_TEXT_PRIMARY_STR;
// Emphasis pops against body text via the cool sky-blue accent — body is
// light grey, emphasis shifts to a slightly more saturated cool blue.
const EMPHASIS_COLOR = COLOR_ACCENT_GOLD_STR;
// Body text uses FONT_DIALOGUE_LG (16px) with 4px leading — 20px per
// rendered line. Used for manual wrap when laying out the per-word Text
// atoms (Phaser's wordWrap doesn't apply across separate Text objects).
const BODY_LINE_H = 20;
const HINT_COLOR = COLOR_ACCENT_GOLD_STR;
// Inactive portrait sits at 40% alpha; pick a desaturated panel-border
// shade so it reads as "stepped back" rather than tinted a different
// hue from the active sprite.
const INACTIVE_TINT = COLOR_PANEL_BORDER;
const ACTIVE_TINT = COLOR_NO_TINT;
const TYPE_INTERVAL_MS = 18;
const DIM_ALPHA = 0.4;

// Per-word render unit. Words sit at fixed positions established at line
// layout time; the typewriter reveals them by slicing each word's
// `text` into the active `textObj` based on the current `typed` cursor.
type WordAtom = {
  text: string;
  // Character index of this word's first letter within the line's displayed
  // text (i.e. line text with `/` markers stripped). Used to map the typed
  // cursor onto per-word slice lengths.
  charStart: number;
  charEnd: number;
  textObj: Phaser.GameObjects.Text;
};

type Live = {
  opts: DialogueOpts;
  container: Phaser.GameObjects.Container;
  leftSprite: Phaser.GameObjects.Sprite | null;
  rightSprite: Phaser.GameObjects.Sprite | null;
  nameBg: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  // Per-word Text objects for the current line. Recreated by applyLine on
  // each line change; destroyed in finish (or via container.destroy()).
  bodyAtoms: WordAtom[];
  bodyDisplayedLength: number;
  hint: Phaser.GameObjects.Container;
  index: number;
  typed: number;
  lastTypeMs: number;
  fullyTyped: boolean;
  onDone: () => void;
  onAdvance: () => void;
  onKey: (event: KeyboardEvent) => void;
};

// Run = a contiguous span of plain or emphasised text within a line.
// Emphasised runs are marked with a single-word `*word*` token in the
// source string; nested or whitespace-containing emphasis isn't supported
// (the convention is single words for highlight pop).
type Run = { text: string; emphasised: boolean };

// Match `*word*` where `word` has no `*` or whitespace inside — single
// words only, matching the convention in dialogue lines.
const EMPHASIS_RE = /\*([^*\s]+?)\*/g;

function parseRuns(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPHASIS_RE)) {
    const idx = m.index;
    if (idx > last) runs.push({ text: text.slice(last, idx), emphasised: false });
    // biome-ignore lint/style/noNonNullAssertion: capture group is required by the regex
    runs.push({ text: m[1]!, emphasised: true });
    last = idx + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), emphasised: false });
  return runs;
}

export class DialogueManager {
  private readonly scene: Phaser.Scene;
  private current: Live | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  isActive(): boolean {
    return this.current !== null;
  }

  start(opts: DialogueOpts, onDone: () => void): void {
    if (this.current) this.finish();
    if (opts.lines.length === 0) {
      onDone();
      return;
    }

    const container = this.scene.add.container(0, 0).setDepth(DEPTH);

    const dim = this.scene.add.rectangle(gameW() / 2, gameH() / 2, gameW(), gameH(), 0x000000, DIM_ALPHA);
    container.add(dim);

    const leftSprite = opts.left ? this.makePortrait(opts.left, 'left') : null;
    const rightSprite = opts.right ? this.makePortrait(opts.right, 'right') : null;
    if (leftSprite) container.add(leftSprite);
    if (rightSprite) container.add(rightSprite);

    const box = this.scene.add.graphics();
    box.fillStyle(TEXT_BOX_FILL, TEXT_BOX_ALPHA);
    box.fillRoundedRect(TEXT_BOX_MARGIN, TEXT_BOX_Y, gameW() - TEXT_BOX_MARGIN * 2, TEXT_BOX_H, TEXT_BOX_RADIUS);
    box.lineStyle(2, TEXT_BOX_STROKE, TEXT_BOX_STROKE_ALPHA);
    box.strokeRoundedRect(TEXT_BOX_MARGIN, TEXT_BOX_Y, gameW() - TEXT_BOX_MARGIN * 2, TEXT_BOX_H, TEXT_BOX_RADIUS);
    container.add(box);

    const nameBg = this.scene.add.graphics();
    container.add(nameBg);

    const nameText = this.scene.add
      .text(0, 0, '', {
        ...FONT_DIALOGUE_LG,
        color: NAME_COLOR,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    container.add(nameText);

    // Body text is laid out per-line in applyLine — words live as their
    // own Text objects so we can colour single-word `/highlights/`
    // independently. The container holds them just like the rest of the
    // dialogue chrome, so destroy() cleans them up automatically.

    // Anchored to the box's bottom-right corner. makePrompt centres its
    // content vertically around the y argument, so subtract half a line to
    // get a visual bottom-anchor that matches the old `setOrigin(1, 1)`.
    const hintTemplate = isTouchDevice ? '▼ tap' : '▼ <advanceDialogue>';
    const hintLineH = Math.round(11 * 1.4);
    const hint = makePrompt(
      this.scene,
      gameW() - TEXT_BOX_MARGIN - TEXT_BOX_PAD,
      TEXT_BOX_Y + TEXT_BOX_H - TEXT_BOX_PAD - hintLineH / 2,
      hintTemplate,
      { ...FONT_DEBUG, color: HINT_COLOR },
      { align: 'right' },
    ).setVisible(false);
    container.add(hint);

    this.scene.tweens.add({
      targets: hint,
      alpha: 0.4,
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    const live: Live = {
      opts,
      container,
      leftSprite,
      rightSprite,
      nameBg,
      nameText,
      bodyAtoms: [],
      bodyDisplayedLength: 0,
      hint,
      index: 0,
      typed: 0,
      lastTypeMs: this.scene.time.now,
      fullyTyped: false,
      onDone,
      onAdvance: () => this.advance(),
      onKey: (event: KeyboardEvent) => {
        if (event.repeat) return;
        this.advance();
      },
    };
    this.current = live;

    this.scene.input.on('pointerdown', live.onAdvance);
    this.scene.input.keyboard?.on('keydown-Z', live.onKey);
    this.scene.input.keyboard?.on('keydown-SPACE', live.onKey);

    this.applyLine();
  }

  private makePortrait(p: DialoguePortrait, side: 'left' | 'right'): Phaser.GameObjects.Sprite {
    const x = side === 'left' ? PORTRAIT_INSET : gameW() - PORTRAIT_INSET;
    const sprite = this.scene.add.sprite(x, PORTRAIT_Y, p.sprite, p.frame ?? 1);
    sprite.setOrigin(side === 'left' ? 0 : 1, 0.5);
    sprite.setScale(PORTRAIT_SCALE);
    if (side === 'right') sprite.setFlipX(true);
    return sprite;
  }

  private applyLine(): void {
    const c = this.current;
    if (!c) return;
    const line = c.opts.lines[c.index];
    if (!line) return;

    const portrait = line.speaker === 'left' ? c.opts.left : c.opts.right;
    const name = portrait?.name ?? '';
    c.nameText.setText(name);

    const nameW = name ? Math.ceil(c.nameText.width) + NAME_PAD_X * 2 : 0;
    const nameH = Math.ceil(c.nameText.height) + NAME_PAD_Y * 2;
    const nameX = TEXT_BOX_MARGIN + TEXT_BOX_PAD;
    const nameY = TEXT_BOX_Y - nameH / 2;
    c.nameBg.clear();
    if (name) {
      c.nameBg.fillStyle(NAME_BG_FILL, NAME_BG_ALPHA);
      c.nameBg.fillRoundedRect(nameX, nameY, nameW, nameH, 4);
    }
    c.nameText.setPosition(nameX + NAME_PAD_X, nameY + NAME_PAD_Y);

    if (c.leftSprite) {
      c.leftSprite.setTint(line.speaker === 'left' ? ACTIVE_TINT : INACTIVE_TINT);
    }
    if (c.rightSprite) {
      c.rightSprite.setTint(line.speaker === 'right' ? ACTIVE_TINT : INACTIVE_TINT);
    }

    // Tear down the previous line's word atoms before laying out the new
    // one — destroy() pulls them out of the container automatically.
    for (const a of c.bodyAtoms) a.textObj.destroy();
    c.bodyAtoms = [];

    const runs = parseRuns(line.text);
    const layout = this.layoutRuns(runs);
    for (const a of layout.atoms) c.container.add(a.textObj);
    c.bodyAtoms = layout.atoms;
    c.bodyDisplayedLength = layout.displayedLength;

    c.typed = 0;
    c.lastTypeMs = this.scene.time.now;
    c.fullyTyped = c.bodyDisplayedLength === 0;
    this.renderTyped(c);
    c.hint.setVisible(c.fullyTyped);
  }

  private layoutRuns(runs: Run[]): { atoms: WordAtom[]; displayedLength: number } {
    const originX = TEXT_BOX_MARGIN + TEXT_BOX_PAD;
    const originY = TEXT_BOX_Y + TEXT_BOX_PAD + 24;
    const maxWidth = gameW() - TEXT_BOX_MARGIN * 2 - TEXT_BOX_PAD * 2;
    const plainStyle = { ...FONT_DIALOGUE_LG, color: TEXT_COLOR };
    const emphStyle = { ...FONT_DIALOGUE_LG, color: EMPHASIS_COLOR, fontStyle: 'bold' };

    // Measure the font's space width once via a throwaway Text (canvas
    // measureText preserves whitespace, so Phaser's Text.width does too).
    const probe = this.scene.add.text(0, 0, ' ', plainStyle);
    const spaceW = probe.width;
    probe.destroy();

    const atoms: WordAtom[] = [];
    let cumChar = 0;
    let x = 0;
    let y = 0;

    for (const run of runs) {
      const style = run.emphasised ? emphStyle : plainStyle;
      let i = 0;
      while (i < run.text.length) {
        const ch = run.text[i];
        if (ch === '\n') {
          x = 0;
          y += BODY_LINE_H;
          i++;
          cumChar++;
          continue;
        }
        if (ch === ' ' || ch === '\t') {
          let j = i;
          while (j < run.text.length && (run.text[j] === ' ' || run.text[j] === '\t')) j++;
          x += spaceW * (j - i);
          cumChar += j - i;
          i = j;
          continue;
        }
        let j = i;
        while (j < run.text.length && run.text[j] !== ' ' && run.text[j] !== '\t' && run.text[j] !== '\n') j++;
        const wordText = run.text.slice(i, j);
        const t = this.scene.add.text(0, 0, wordText, style).setOrigin(0, 0);
        // Wrap before placing if the word doesn't fit on the current
        // line. Skipped at x=0 so a single oversized word still renders
        // (overflowing) instead of looping.
        if (x > 0 && x + t.width > maxWidth) {
          x = 0;
          y += BODY_LINE_H;
        }
        t.setPosition(originX + x, originY + y);
        const charStart = cumChar;
        const charEnd = cumChar + wordText.length;
        // Hide the word until the typewriter reveals it.
        t.setText('');
        atoms.push({ text: wordText, charStart, charEnd, textObj: t });
        x += this.measureWidth(wordText, style);
        cumChar += wordText.length;
        i = j;
      }
    }

    return { atoms, displayedLength: cumChar };
  }

  // Phaser's Text.width updates with setText, so once we cleared the text
  // for typewriter staging we lost the measurement. Re-measure via a temp
  // Text — same path Phaser uses internally, just without the side effect
  // of mutating our laid-out atom.
  private measureWidth(text: string, style: Phaser.Types.GameObjects.Text.TextStyle): number {
    const tmp = this.scene.add.text(0, 0, text, style);
    const w = tmp.width;
    tmp.destroy();
    return w;
  }

  private renderTyped(c: Live): void {
    for (const a of c.bodyAtoms) {
      if (c.typed >= a.charEnd) {
        a.textObj.setText(a.text);
      } else if (c.typed <= a.charStart) {
        a.textObj.setText('');
      } else {
        a.textObj.setText(a.text.slice(0, c.typed - a.charStart));
      }
    }
  }

  private advance(): void {
    const c = this.current;
    if (!c) return;
    const line = c.opts.lines[c.index];
    if (!line) return;
    if (!c.fullyTyped) {
      c.typed = c.bodyDisplayedLength;
      this.renderTyped(c);
      c.fullyTyped = true;
      c.hint.setVisible(true);
      return;
    }
    c.index++;
    if (c.index >= c.opts.lines.length) {
      this.finish();
      return;
    }
    this.applyLine();
  }

  update(time: number): void {
    const c = this.current;
    if (!c) return;
    if (c.fullyTyped) return;
    while (c.typed < c.bodyDisplayedLength && time - c.lastTypeMs >= TYPE_INTERVAL_MS) {
      c.typed++;
      c.lastTypeMs += TYPE_INTERVAL_MS;
    }
    this.renderTyped(c);
    if (c.typed >= c.bodyDisplayedLength) {
      c.fullyTyped = true;
      c.hint.setVisible(true);
    }
  }

  private finish(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this.scene.input.off('pointerdown', c.onAdvance);
    this.scene.input.keyboard?.off('keydown-Z', c.onKey);
    this.scene.input.keyboard?.off('keydown-SPACE', c.onKey);
    this.scene.tweens.killTweensOf(c.hint);
    c.container.destroy();
    c.onDone();
  }
}
