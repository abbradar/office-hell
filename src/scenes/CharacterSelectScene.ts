import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { CHARACTER_REGISTRY_KEY, CHARACTERS, type CharacterDef } from '../content/characters';
import {
  addElevatorBackdrop,
  ELEVATOR_BACKDROP_TINT,
  ELEVATOR_CLOSE_ANIM,
  ELEVATOR_FRAME_OPEN,
} from '../content/elevator';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_DIALOGUE_SM, FONT_MENU } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import {
  COLOR_ACCENT_GOLD,
  COLOR_ACCENT_GOLD_STR,
  COLOR_NO_TINT,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_MUTED_STR,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL_STR,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';
import { onTap } from '../ui/tap';

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
const ACTIVE_BORDER = COLOR_ACCENT_GOLD;
const INACTIVE_BORDER = COLOR_PANEL_BORDER;
const CARD_FILL = COLOR_PANEL;
const ACTIVE_TINT = COLOR_NO_TINT;
const INACTIVE_TINT = 0x9a9080;

type Card = {
  index: number;
  graphics: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  blurbText: Phaser.GameObjects.Text;
  centerX: number;
};

// Per-run mutable state. Phaser reuses the scene instance across
// `scene.start('CharacterSelect')`, so a class-field `cards: Card[] = []`
// would grow across re-entries (the create() loop pushes a fresh row of
// cards each time on top of the previous run's destroyed objects).
// Bundling it into one object lets init() rebuild from scratch each time.
class RunState {
  readonly next: string;
  // biome-ignore lint/suspicious/noExplicitAny: passthrough init payload
  readonly nextData: any;
  readonly cards: Card[] = [];
  cursor = 0;
  // True once the back handler has fired — prevents the close animation
  // from being retriggered (and the destination scene started twice) by
  // a stray pointerdown / keydown while the doors are sliding shut.
  closing = false;

  constructor(data: CharacterSelectData | undefined) {
    this.next = data?.next ?? 'Game';
    this.nextData = data?.nextData;
  }
}

export class CharacterSelectScene extends Phaser.Scene {
  private state!: RunState;

  constructor() {
    super('CharacterSelect');
  }

  init(data: CharacterSelectData): void {
    this.state = new RunState(data);
  }

  create(): void {
    bindLogicalCamera(this);
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);
    addMuteButton(this);

    // Drop scene input for the first frame so the pointerdown that
    // brought us here (Menu's start button sits at the same Y as the
    // cards on touch) can't be dispatched into our freshly-registered
    // interactives. By POST_UPDATE, the in-flight event has been fully
    // walked past our zones.
    this.input.enabled = false;
    this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.input.enabled = true;
    });

    // Carry the open elevator across from MenuScene's open animation as a
    // full-screen backdrop. Sits behind the title + cards so the dark
    // interior of the open frame doubles as the scene background. Same
    // tint as MenuScene so the brightness doesn't pop at the transition.
    const elevator = addElevatorBackdrop(this, ELEVATOR_FRAME_OPEN);
    elevator.setTint(ELEVATOR_BACKDROP_TINT);

    const goBack = (): void => {
      if (this.state.closing) return;
      this.state.closing = true;
      elevator.play(ELEVATOR_CLOSE_ANIM);
      elevator.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.scene.start('Menu');
      });
    };

    this.add
      .text(GAME_W / 2, 70, "WHO'S CRUNCHING?", {
        ...FONT_MENU,
        color: COLOR_ACCENT_GOLD_STR,
      })
      .setOrigin(0.5);

    const totalW = CARD_W * CHARACTERS.length + CARD_GAP * (CHARACTERS.length - 1);
    const startX = (GAME_W - totalW) / 2;

    for (let i = 0; i < CHARACTERS.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by CHARACTERS.length
      const ch = CHARACTERS[i]!;
      const cx = startX + CARD_W / 2 + i * (CARD_W + CARD_GAP);
      this.state.cards.push(this.makeCard(i, ch, cx));
    }

    // Keyboard hint: three column-stacked prompts (icon on top, label below)
    // laid out side-by-side. makePrompt is line-based, so a single template
    // can't column-align an icon row above a text row — render each pair as
    // its own prompt, then re-center the group around GAME_W / 2.
    const HINT_Y = GAME_H - 130;
    const HINT_GAP = 60;
    const hintStyle = { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR, align: 'center' };
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
        color: COLOR_TEXT_MUTED_STR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    onTap(this, back, goBack);

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-LEFT', () => {
        this.state.cursor = (this.state.cursor - 1 + CHARACTERS.length) % CHARACTERS.length;
        this.refresh();
      });
      kb.on('keydown-RIGHT', () => {
        this.state.cursor = (this.state.cursor + 1) % CHARACTERS.length;
        this.refresh();
      });
      kb.on('keydown-Z', () => this.confirm());
      kb.on('keydown-ENTER', () => this.confirm());
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
        color: COLOR_TEXT_PRIMARY_STR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const blurbText = this.add
      .text(cx, cy + CARD_H / 2 - 32, ch.blurb, {
        ...FONT_DEBUG,
        color: COLOR_TEXT_MUTED_STR,
        align: 'center',
        wordWrap: { width: CARD_W - 16 },
      })
      .setOrigin(0.5);

    const hitX = cx - CARD_W / 2;
    const hitY = cy - CARD_H / 2;
    const zone = this.add.zone(hitX, hitY, CARD_W, CARD_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.state.cursor = index;
      this.refresh();
    });
    onTap(this, zone, () => {
      this.state.cursor = index;
      this.confirm();
    });

    return { index, graphics, sprite, nameText, blurbText, centerX: cx };
  }

  private refresh(): void {
    for (const card of this.state.cards) {
      const selected = card.index === this.state.cursor;
      const cy = CARD_Y;
      card.graphics.clear();
      card.graphics.fillStyle(CARD_FILL, selected ? 0.95 : 0.7);
      card.graphics.fillRoundedRect(card.centerX - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 10);
      card.graphics.lineStyle(selected ? 3 : 2, selected ? ACTIVE_BORDER : INACTIVE_BORDER, 1);
      card.graphics.strokeRoundedRect(card.centerX - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 10);
      card.sprite.setTint(selected ? ACTIVE_TINT : INACTIVE_TINT);
      card.nameText.setColor(selected ? COLOR_ACCENT_GOLD_STR : COLOR_TEXT_PRIMARY_STR);
    }
  }

  private confirm(): void {
    const ch = CHARACTERS[this.state.cursor];
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
    this.scene.start(this.state.next, this.state.nextData ?? {});
  }
}
