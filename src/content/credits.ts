// Credits content. Used by:
//  - src/scenes/CreditsScene.ts — full menu page with scrolling.
//  - src/content/waves/ending.ts — fading roll over the post-stage walk.
// Keep the shape (Section / Entry) and the SECTIONS array in sync;
// any change ripples to both surfaces automatically.

export type Entry = { name: string; url?: string; role?: string };
// Section content is either a list of `entries` (team / asset credits)
// or a free-form `body` paragraph (the AI usage disclosure). Both is
// unused but harmless.
export type Section = { heading: string; entries?: Entry[]; body?: string };

export const SECTIONS: Section[] = [
  {
    heading: 'TEAM',
    entries: [
      { name: 'abbradar', role: 'code, stage design, pattern design' },
      { name: 'vuvko', role: 'code, sound design, stage design, pattern design' },
      { name: 'const', role: 'code, pattern design' },
      { name: 'nclbrt', role: 'art design, character design, concept design' },
    ],
  },
  {
    heading: 'MUSIC',
    entries: [
      { name: 'DOS-88 Music Library', url: 'dos88.itch.io/dos-88-music-library' },
      {
        name: 'Crack the Underground Base',
        url: 'opengameart.org/users/kaedalus',
      },
      { name: 'nene', url: 'opengameart.org/users/nene' },
    ],
  },
  {
    heading: 'ART & ICONS & SFX',
    entries: [
      { name: 'Kenney.nl', url: 'opengameart.org/users/kenney' },
      { name: 'Top Down Sprite Maker', url: 'flinkerflitzer.itch.io/tdsm' },
      { name: 'Animated Elevator', url: 'pixel-assembly.itch.io/animated-elevator' },
      { name: 'Furniture Office Set', url: 'stcrbcn.itch.io/furniture-office-set' },
      { name: 'Explosions by helpcomputer', url: 'opengameart.org/content/explosions-2' },
      { name: 'Bullet Collection 1 (M484)', url: 'opengameart.org/content/bullet-collection-1-m484' },
    ],
  },
  {
    heading: 'FONTS',
    entries: [
      { name: 'monogram', url: 'datagoblin.itch.io/monogram' },
      { name: 'Press Start 2P', url: 'fonts.google.com/specimen/Press+Start+2P' },
      { name: 'Silkscreen', url: 'fonts.google.com/specimen/Silkscreen' },
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
  {
    heading: 'CREATED FOR BULLET HELL JAM 7',
    body: 'itch.io/jam/bullet-jam-7',
  },
  {
    heading: 'SOURCE CODE',
    body: 'github.com/abbradar/office-hell',
  },
];
