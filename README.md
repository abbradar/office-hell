# Office Hell

> *It's Friday evening, and you've already been crunching the whole week.
> Now, how hard can it be to just get up from your desk and go home?*

**Office Hell** is a fast-paced bullet hell, inspired by Touhou Project
games. The balance of the stages is meant to be hard, but you can
always just continue your struggles, if you are not aiming for a high
score.

**▶ Play it on itch.io: [abbradar.itch.io/office-hell](https://abbradar.itch.io/office-hell)**

Created for [Bullet Hell Jam 7](https://itch.io/jam/bullet-hell-jam-7).

## Controls

- **Z** — fire
- **X** — bomb
- **arrows** — move
- **Shift** — focus mode
- **ESC** — pause / back to menu
- **Touch** — drag to move, tap the ✱ button to bomb (on mobile)

## Theme: SHRINK!

Have you ever been to the office? Have you felt like your mind is
SHRINKING with every second you spend there? Have you thought that you
could touch the grass and run around the park, but instead your
muscles are SHRINKING? Have you thought that a significant amount of
your hair is SHRINKING because of constant stress? If the answer is
"yes", there's a chance that you'll like our game.

## Development

Built with [Phaser 3](https://phaser.io/), [TypeScript](https://www.typescriptlang.org/),
and [Vite](https://vite.dev/). Targets WebGL; runs in modern browsers
on desktop and mobile.

Binary assets (`.png`, `.mp3`, `.wav`, `.ogg`, `.woff2`) live behind
[Git LFS](https://git-lfs.com/) — install it before cloning, or the
checkout will land with pointer files instead of the actual media.

```bash
git lfs install
git clone https://github.com/abbradar/office-hell
cd office-hell
npm install
npm run dev        # vite dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build      # tsc + vite build → dist/
npm run preview    # serve the production build
npm run check      # biome check (lint + format dry run)
npm run format     # biome check --fix .
```

Type-check on its own: `npx tsc --noEmit`.

## Project layout

See [CLAUDE.md](CLAUDE.md) for the orientation pass: folder structure,
runtime conventions (generator-based stages, audio model, pause
semantics, per-run scene state pattern), and pointers into the deeper
docs under [`src/docs/`](src/docs/) (stage architecture, pattern
sandbox cookbook, stress-test results, audio implementation guide,
final boss music analysis).

## Credits

**Team**

- [abbradar](https://abbradar.itch.io/) — code, stage design, pattern design
- [vuvko](https://vuvko.itch.io/) — code, sound design, stage design, pattern design
- const — code, pattern design
- [nclbrt](https://www.behance.net/nclbrt) — art direction, character design, concept design

**Music**

- [DOS-88 Music Library](https://dos88.itch.io/dos-88-music-library) — CC BY 4.0. Five tracks from the library are used as the menu loop and the stage 1 / stage 2 / final-boss themes (see [`src/audio/preload.ts`](src/audio/preload.ts) for the per-track mapping).
- **Kaedalus ([kaedalus.com](http://kaedalus.com))** — ["Crack the Underground Base"](https://opengameart.org/content/crack-the-underground-base-action-chipmusicrock) — CC BY-SA 3.0. The track is cut into chunks under [`src/assets/audio/chunks/kaedalus/`](src/assets/audio/chunks/kaedalus/) — see that folder's [`LICENSE.txt`](src/assets/audio/chunks/kaedalus/LICENSE.txt) for the derivative-work declaration.
- [nene](https://opengameart.org/users/nene) — "Boss Battle #8" (retro and metal versions), "Boss Battle #9", "Unchained Destiny" — CC0.

**Art, icons & SFX**

- [Kenney.nl](https://kenney.nl/) — CC0. Input Prompts (keyboard / touch glyphs under [`src/assets/icons/`](src/assets/icons/)), Game Icons (mute / sound icons), Pixel Shmup (the green pill player bullet sprite).
- [Top Down Sprite Maker](https://flinkerflitzer.itch.io/tdsm) by flinkerflitzer — playable + NPC character sheets under [`src/assets/sprites/`](src/assets/sprites/).
- [Animated Elevator](https://pixel-assembly.itch.io/animated-elevator) by Pixel_Assembly — the elevator-doors sprite used as the menu backdrop ([`src/assets/misc/elevator_doors.png`](src/assets/misc/elevator_doors.png)).
- [Furniture Office Set](https://stcrbcn.itch.io/furniture-office-set) by Antea ✮⋆˙ — CC BY 4.0. The water dispenser prop ([`src/assets/misc/water_dispenser.png`](src/assets/misc/water_dispenser.png)).
- [Explosions](https://opengameart.org/content/explosions-2) by helpcomputer — CC BY 3.0. The bomb-explosion spritesheet ([`src/assets/misc/bomb_explosion.png`](src/assets/misc/bomb_explosion.png), extracted rows from the pack's `explosion1.png`) and the blue / red bullet-explosion strips ([`src/assets/bullets/blue_explosion.png`](src/assets/bullets/blue_explosion.png), [`bullets/red_explosion.png`](src/assets/bullets/red_explosion.png)).
- [Bullet Collection 1](https://opengameart.org/content/bullet-collection-1-m484) by Master484 — CC0. Droplet / diamond / pill bullet sprites under [`src/assets/bullets/`](src/assets/bullets/).

**Fonts**

- [monogram](https://datagoblin.itch.io/monogram) by datagoblin
- [Fayte Pixel](https://fonts.adobe.com/fonts/fayte-pixel) by [Harbor Bickmore](https://fonts.adobe.com/designers/harbor-bickmore)
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) — SIL OFL
- [Silkscreen](https://fonts.google.com/specimen/Silkscreen) — SIL OFL

The canonical in-game credits roll lives at
[`src/content/credits.ts`](src/content/credits.ts) — keep it in sync
with this section if you add or replace an asset.

## License

Source code is released under the [MIT License](LICENSE).

Third-party assets ship under their own terms — see the Credits
section above for the per-asset license and the kaedalus chunks
folder's [LICENSE.txt](src/assets/audio/chunks/kaedalus/LICENSE.txt)
for the CC BY-SA 3.0 derivative-work declaration.

## AI usage

Claude Code was used as an assisting tool for code and search. Other
search engines and platform-specific searches were used that could
have AI incorporated. No AI was used to generate any asset or text
for the game.
