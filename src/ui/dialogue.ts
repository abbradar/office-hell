import type Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_LG } from './fonts';

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
const PORTRAIT_Y = GAME_H * 0.42;
const PORTRAIT_INSET = 24;
const TEXT_BOX_H = 150;
const TEXT_BOX_MARGIN = 12;
const TEXT_BOX_Y = GAME_H - TEXT_BOX_H - TEXT_BOX_MARGIN;
const TEXT_BOX_PAD = 14;
const TEXT_BOX_FILL = 0x080820;
const TEXT_BOX_ALPHA = 0.9;
const TEXT_BOX_STROKE = 0xffd96a;
const TEXT_BOX_STROKE_ALPHA = 0.85;
const TEXT_BOX_RADIUS = 10;
const NAME_BG_FILL = 0xffd96a;
const NAME_BG_ALPHA = 0.95;
const NAME_COLOR = '#1a1a2a';
const NAME_PAD_X = 8;
const NAME_PAD_Y = 3;
const TEXT_COLOR = '#f4f4f8';
const TEXT_LINE_SPACING = 4;
const HINT_COLOR = '#ffd96a';
const INACTIVE_TINT = 0x4a4a6a;
const ACTIVE_TINT = 0xffffff;
const TYPE_INTERVAL_MS = 18;
const DIM_ALPHA = 0.4;

type Live = {
  opts: DialogueOpts;
  container: Phaser.GameObjects.Container;
  leftSprite: Phaser.GameObjects.Sprite | null;
  rightSprite: Phaser.GameObjects.Sprite | null;
  nameBg: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  bodyText: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
  index: number;
  typed: number;
  lastTypeMs: number;
  fullyTyped: boolean;
  onDone: () => void;
  onAdvance: () => void;
  onKey: (event: KeyboardEvent) => void;
};

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

    const dim = this.scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, DIM_ALPHA);
    container.add(dim);

    const leftSprite = opts.left ? this.makePortrait(opts.left, 'left') : null;
    const rightSprite = opts.right ? this.makePortrait(opts.right, 'right') : null;
    if (leftSprite) container.add(leftSprite);
    if (rightSprite) container.add(rightSprite);

    const box = this.scene.add.graphics();
    box.fillStyle(TEXT_BOX_FILL, TEXT_BOX_ALPHA);
    box.fillRoundedRect(TEXT_BOX_MARGIN, TEXT_BOX_Y, GAME_W - TEXT_BOX_MARGIN * 2, TEXT_BOX_H, TEXT_BOX_RADIUS);
    box.lineStyle(2, TEXT_BOX_STROKE, TEXT_BOX_STROKE_ALPHA);
    box.strokeRoundedRect(TEXT_BOX_MARGIN, TEXT_BOX_Y, GAME_W - TEXT_BOX_MARGIN * 2, TEXT_BOX_H, TEXT_BOX_RADIUS);
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

    const bodyText = this.scene.add.text(TEXT_BOX_MARGIN + TEXT_BOX_PAD, TEXT_BOX_Y + TEXT_BOX_PAD + 24, '', {
      ...FONT_DIALOGUE_LG,
      color: TEXT_COLOR,
      wordWrap: { width: GAME_W - TEXT_BOX_MARGIN * 2 - TEXT_BOX_PAD * 2 },
    });
    bodyText.setLineSpacing(TEXT_LINE_SPACING);
    container.add(bodyText);

    const hint = this.scene.add
      .text(
        GAME_W - TEXT_BOX_MARGIN - TEXT_BOX_PAD,
        TEXT_BOX_Y + TEXT_BOX_H - TEXT_BOX_PAD,
        isTouchDevice ? '▼ tap' : '▼ Z',
        {
          ...FONT_DEBUG,
          color: HINT_COLOR,
        },
      )
      .setOrigin(1, 1)
      .setVisible(false);
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
      bodyText,
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
    const x = side === 'left' ? PORTRAIT_INSET : GAME_W - PORTRAIT_INSET;
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

    c.bodyText.setText('');
    c.typed = 0;
    c.lastTypeMs = this.scene.time.now;
    c.fullyTyped = line.text.length === 0;
    c.hint.setVisible(c.fullyTyped);
  }

  private advance(): void {
    const c = this.current;
    if (!c) return;
    const line = c.opts.lines[c.index];
    if (!line) return;
    if (!c.fullyTyped) {
      c.typed = line.text.length;
      c.bodyText.setText(line.text);
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
    const line = c.opts.lines[c.index];
    if (!line) return;
    while (c.typed < line.text.length && time - c.lastTypeMs >= TYPE_INTERVAL_MS) {
      c.typed++;
      c.lastTypeMs += TYPE_INTERVAL_MS;
    }
    c.bodyText.setText(line.text.slice(0, c.typed));
    if (c.typed >= line.text.length) {
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
