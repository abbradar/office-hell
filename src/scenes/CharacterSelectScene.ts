import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS, type CharacterDef } from '../content/characters';
import { isTouchDevice } from '../input/device';

export type CharacterSelectData = {
  next: string;
  // biome-ignore lint/suspicious/noExplicitAny: scene init data is opaque to this scene
  nextData?: any;
};

const CARD_W = 180;
const CARD_H = 320;
const CARD_GAP = 24;
const CARD_Y = GAME_H * 0.42;
const PORTRAIT_SCALE = 4;
const ACTIVE_BORDER = 0xffd96a;
const INACTIVE_BORDER = 0x444466;
const CARD_FILL = 0x1c1c2e;
const ACTIVE_TINT = 0xffffff;
const INACTIVE_TINT = 0x6a6a8a;

type Card = {
  index: number;
  graphics: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  blurbText: Phaser.GameObjects.Text;
  centerX: number;
};

export class CharacterSelectScene extends Phaser.Scene {
  private cards: Card[] = [];
  private cursor = 0;
  private next!: string;
  // biome-ignore lint/suspicious/noExplicitAny: passthrough init payload
  private nextData: any;

  constructor() {
    super('CharacterSelect');
  }

  init(data: CharacterSelectData): void {
    this.next = data?.next ?? 'Game';
    this.nextData = data?.nextData;
    this.cards = [];
    this.cursor = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    this.add
      .text(GAME_W / 2, 70, 'CHOOSE A SHIFT WORKER', {
        color: '#ffd96a',
        fontSize: '24px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const totalW = CARD_W * CHARACTERS.length + CARD_GAP * (CHARACTERS.length - 1);
    const startX = (GAME_W - totalW) / 2;

    for (let i = 0; i < CHARACTERS.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by CHARACTERS.length
      const ch = CHARACTERS[i]!;
      const cx = startX + CARD_W / 2 + i * (CARD_W + CARD_GAP);
      this.cards.push(this.makeCard(i, ch, cx));
    }

    const hint = isTouchDevice
      ? 'tap a card to select   •   tap "back" to return'
      : '← →: switch   Z/Enter: select   Esc: back';
    this.add
      .text(GAME_W / 2, GAME_H - 96, hint, {
        color: '#888888',
        fontSize: '12px',
        align: 'center',
      })
      .setOrigin(0.5);

    const back = this.add
      .text(GAME_W / 2, GAME_H - 56, '← back', {
        color: '#888888',
        fontSize: '14px',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      this.scene.start('Menu');
    });

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-LEFT', () => {
        this.cursor = (this.cursor - 1 + CHARACTERS.length) % CHARACTERS.length;
        this.refresh();
      });
      kb.on('keydown-RIGHT', () => {
        this.cursor = (this.cursor + 1) % CHARACTERS.length;
        this.refresh();
      });
      kb.on('keydown-Z', () => this.confirm());
      kb.on('keydown-ENTER', () => this.confirm());
      kb.on('keydown-ESC', () => {
        this.scene.start('Menu');
      });
    }

    this.refresh();
  }

  private makeCard(index: number, ch: CharacterDef, cx: number): Card {
    const cy = CARD_Y;
    const graphics = this.add.graphics();

    const sprite = this.add.sprite(cx, cy - 30, ch.sprite, ch.frame).setScale(PORTRAIT_SCALE);

    const nameText = this.add
      .text(cx, cy + CARD_H / 2 - 64, ch.name, {
        color: '#ffffff',
        fontSize: '16px',
        fontStyle: 'bold',
        fontFamily: 'system-ui, sans-serif',
      })
      .setOrigin(0.5);

    const blurbText = this.add
      .text(cx, cy + CARD_H / 2 - 32, ch.blurb, {
        color: '#aaaaaa',
        fontSize: '11px',
        fontFamily: 'system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: CARD_W - 16 },
      })
      .setOrigin(0.5);

    const hitX = cx - CARD_W / 2;
    const hitY = cy - CARD_H / 2;
    const zone = this.add.zone(hitX, hitY, CARD_W, CARD_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.cursor = index;
      this.refresh();
    });
    zone.on('pointerdown', () => {
      this.cursor = index;
      this.confirm();
    });

    return { index, graphics, sprite, nameText, blurbText, centerX: cx };
  }

  private refresh(): void {
    for (const card of this.cards) {
      const selected = card.index === this.cursor;
      const cy = CARD_Y;
      card.graphics.clear();
      card.graphics.fillStyle(CARD_FILL, selected ? 0.95 : 0.7);
      card.graphics.fillRoundedRect(card.centerX - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 10);
      card.graphics.lineStyle(selected ? 3 : 2, selected ? ACTIVE_BORDER : INACTIVE_BORDER, 1);
      card.graphics.strokeRoundedRect(card.centerX - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 10);
      card.sprite.setTint(selected ? ACTIVE_TINT : INACTIVE_TINT);
      card.nameText.setColor(selected ? '#ffd96a' : '#cccccc');
    }
  }

  private confirm(): void {
    const ch = CHARACTERS[this.cursor];
    if (!ch) return;
    this.registry.set(CHARACTER_REGISTRY_KEY, ch);
    this.scene.start(this.next, this.nextData);
  }
}
