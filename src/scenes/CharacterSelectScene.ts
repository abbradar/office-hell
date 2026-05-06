import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS, type CharacterDef } from '../content/characters';
import { isTouchDevice } from '../input/device';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_DIALOGUE_SM, FONT_MENU } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import { makePrompt } from '../ui/prompt';

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
    addMuteButton(this);

    this.add
      .text(GAME_W / 2, 70, 'CHOOSE A SHIFT WORKER', {
        ...FONT_MENU,
        color: '#ffd96a',
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

    // Keyboard hint: three column-stacked prompts (icon on top, label below)
    // laid out side-by-side. makePrompt is line-based, so a single template
    // can't column-align an icon row above a text row — render each pair as
    // its own prompt, then re-center the group around GAME_W / 2.
    const HINT_Y = GAME_H - 130;
    const HINT_GAP = 60;
    const hintStyle = { ...FONT_DEBUG, color: '#888888', align: 'center' };
    if (isTouchDevice) {
      makePrompt(this, GAME_W / 2, HINT_Y, 'tap a card to select   •   tap "back" to return', hintStyle, {
        align: 'center',
      });
    } else {
      const cols = ['<moveHorizontal>\nswitch', '<confirm>\nselect', '<back>\nback'];
      const prompts = cols.map((t) => makePrompt(this, 0, HINT_Y, t, hintStyle, { align: 'center' }));
      const groupW = prompts.reduce((sum, p) => sum + p.width, 0) + HINT_GAP * (prompts.length - 1);
      let cx = GAME_W / 2 - groupW / 2;
      for (const p of prompts) {
        p.x = Math.round(cx + p.width / 2);
        cx += p.width + HINT_GAP;
      }
    }

    const back = this.add
      .text(GAME_W / 2, GAME_H - 56, '← back', {
        ...FONT_DIALOGUE_SM,
        color: '#888888',
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
      const goBack = (): void => {
        this.scene.start('Menu');
      };
      kb.on('keydown-ESC', goBack);
    }

    this.refresh();
  }

  private makeCard(index: number, ch: CharacterDef, cx: number): Card {
    const cy = CARD_Y;
    const graphics = this.add.graphics();

    const sprite = this.add.sprite(cx, cy - 30, ch.sprite, ch.frame).setScale(PORTRAIT_SCALE);

    const nameText = this.add
      .text(cx, cy + CARD_H / 2 - 64, ch.name, {
        ...FONT_DIALOGUE_LG,
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const blurbText = this.add
      .text(cx, cy + CARD_H / 2 - 32, ch.blurb, {
        ...FONT_DEBUG,
        color: '#aaaaaa',
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
    // `?? {}` is load-bearing: Phaser's Systems.start only assigns
    // settings.data if the new data arg is truthy (`if (data) { settings.data = data; }`),
    // so passing undefined leaves the *previous* start's data in place
    // and the next scene's init() reads stale fields. Concretely: launch
    // STAGE TEST from the practice menu (sets settings.data on Game to
    // `{ test: true }`), come back to the main menu, press Start →
    // CharSelect calls this with nextData=undefined and the test flag
    // sticks. Empty object forces an overwrite.
    this.scene.start(this.next, this.nextData ?? {});
  }
}
