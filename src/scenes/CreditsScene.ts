import Phaser from 'phaser';
import { playClick } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import { isTouchDevice } from '../input/device';
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
import { onTap } from '../ui/tap';

// Sections of the credits roll. Layout walks them top-to-bottom; each
// section gets a gold heading + a stack of entries. URLs sit in a small
// muted tier under the entry name (canvas text isn't clickable, but
// printing the URL is the standard "give me credit" courtesy and
// matches the LICENSE-* files in src/assets/icons/).
type Entry = { name: string; url?: string; role?: string };
// Section's content is either a list of `entries` (team / asset
// credits) OR a free-form `body` paragraph (the AI disclosure). Each
// section may set one or the other; both is unused but harmless.
type Section = { heading: string; entries?: Entry[]; body?: string };

const SECTIONS: Section[] = [
  {
    heading: 'TEAM',
    entries: [
      { name: 'abbradar', role: 'code, stage design' },
      { name: 'vuvko', role: 'code, music design, pattern design' },
      { name: 'nclbrt', role: 'art design, character design' },
    ],
  },
  {
    heading: 'MUSIC',
    entries: [
      { name: 'DOS-88 Music Library', url: 'dos88.itch.io/dos-88-music-library' },
      // { name: '42 Monster RPG 2 Music Tracks', url: 'opengameart.org/content/42-monster-rpg-2-music-tracks' },
      {
        name: 'Crack the Underground Base',
        url: 'https://opengameart.org/content/crack-the-underground-base-action-chipmusicrock',
      },
      { name: 'nene', url: 'opengameart.org/users/nene' },
    ],
  },
  {
    heading: 'ART & INPUT ICONS & SFX',
    entries: [
      { name: 'Kenney', url: 'opengameart.org/users/kenney' },
      { name: 'Universal LPC Spritesheet Generator', url: 'github.com/LiberatedPixelCup' },
      { name: 'Animated Elevator', url: 'pixel-assembly.itch.io/animated-elevator' },
    ],
  },
  {
    heading: 'AI USAGE DISCLOSURE',
    body:
      'Claude Code was used as an assisting tool for code and search. ' +
      'Other search engines and platform-specific ' +
      'searches were used that could have AI incorporated. No AI was ' +
      'used to generate any asset or text for the game.',
  },
];

// Layout knobs — match the visual rhythm of TestMenuScene (title at 60,
// subtitle at 98, content from ~130, back-link at GAME_H - 55, hint
// prompt at GAME_H - 25). Heading and entry sizes pulled from the
// existing FONT_* tiers so type hierarchy reads consistent across scenes.
const HEADER_Y = 60;
const SUBTITLE_Y = HEADER_Y;
const CONTENT_TOP = SUBTITLE_Y + 36;
const HEADING_TO_FIRST_ENTRY = 24;
const ENTRY_TO_URL = 14;
const URL_TO_NEXT = 16;
const ENTRY_TO_NEXT = 20;
const SECTION_GAP = 18;

export class CreditsScene extends Phaser.Scene {
  constructor() {
    super('Credits');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);
    addMuteButton(this);

    this.add
      .text(GAME_W / 2, HEADER_Y, 'CREDITS', {
        ...FONT_TITLE,
        color: COLOR_ACCENT_GOLD_STR,
      })
      .setOrigin(0.5);

    // this.add
    //   .text(GAME_W / 2, SUBTITLE_Y, 'thanks to everyone below', {
    //     ...FONT_DIALOGUE_SM,
    //     color: COLOR_TEXT_MUTED_STR,
    //   })
    //   .setOrigin(0.5);

    // Walk each section, render heading then entries; vertical cursor
    // advances per row. Sized so the full roll fits comfortably above
    // the back-link slot at the bottom of the screen.
    let cursorY = CONTENT_TOP;
    for (const section of SECTIONS) {
      this.add
        .text(GAME_W / 2, cursorY, section.heading, {
          ...FONT_MENU,
          color: COLOR_ACCENT_GOLD_STR,
        })
        .setOrigin(0.5);
      cursorY += HEADING_TO_FIRST_ENTRY;

      for (const entry of section.entries ?? []) {
        this.add
          .text(GAME_W / 2, cursorY, entry.name, {
            ...FONT_DIALOGUE_LG,
            color: COLOR_TEXT_PRIMARY_STR,
          })
          .setOrigin(0.5);
        if (entry.url) {
          cursorY += ENTRY_TO_URL;
          this.add
            .text(GAME_W / 2, cursorY, entry.url, {
              ...FONT_DEBUG,
              color: COLOR_TEXT_DIM_STR,
            })
            .setOrigin(0.5);
          cursorY += URL_TO_NEXT;
        } else if (entry.role) {
          cursorY += ENTRY_TO_URL;
          this.add
            .text(GAME_W / 2, cursorY, entry.role, {
              ...FONT_DEBUG,
              color: COLOR_TEXT_DIM_STR,
            })
            .setOrigin(0.5);
          cursorY += URL_TO_NEXT;
        } else {
          cursorY += ENTRY_TO_NEXT;
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
        cursorY += body.height + 4;
      }

      cursorY += SECTION_GAP;
    }

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
    onTap(this, back, goBack);

    const hintTemplate = isTouchDevice ? 'tap "back to menu"' : '<back>: back';
    makePrompt(
      this,
      GAME_W / 2,
      GAME_H - 25,
      hintTemplate,
      { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR, align: 'center' },
      { align: 'center' },
    );

    this.input.keyboard?.on('keydown-ESC', goBack);
    this.input.keyboard?.on('keydown-ENTER', goBack);
    this.input.keyboard?.on('keydown-Z', goBack);
  }
}
