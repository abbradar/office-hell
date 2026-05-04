# CLAUDE.md — project notes for Claude Code

Office Hell — a browser bullet-hell shmup built on Phaser 3 + TypeScript +
Vite. This file is the orientation pass: where things live, conventions
that aren't enforced by the type system, and links into deeper docs when
they exist.

## Stack

- **Phaser 3** for rendering, input, physics (Arcade), sound. WebGL canvas
  scaled with `Scale.FIT` and `pixelArt: true`.
- **Vite 6** for dev server + production build. ES modules; assets imported
  by URL (`import url from '../assets/foo.png'`).
- **TypeScript 5.6** strict-mode (see [tsconfig.json](tsconfig.json)).
- **Biome** for format + lint (`npm run check` runs both).
- **Git LFS** for binary assets — `.png`, `.mp3`, `.wav`, `.ogg`,
  `.woff2`. See [.gitattributes](.gitattributes).

## Commands

```
npm run dev        # vite dev server
npm run build      # tsc + vite build
npm run preview    # serve the production build
npm run check      # biome check (lint + format dry run)
npm run format     # biome format --write
npm run lint       # biome lint
```

Type-check on its own: `npx tsc --noEmit`.

## Layout

```
src/
├── assets/           Binary assets (LFS): audio/, fonts/, sprites/.
├── audio/            Audio runtime — buses, voice pool, music loop player.
│                     Asset *files* live under src/assets/audio/.
├── config.ts         GAME_W/H, player constants, pool sizes.
├── content/          Game content. Stages, characters, enemy "kinds",
│                     bombs, releases (per-encounter wave definitions).
├── docs/             Internal docs. See "Where to read more" below.
├── entities/         Entity, Player, EntityPool. Pool owns all entities,
│                     groups, dialogue, bubbles, paused flag.
├── input/            Touch + device detection helpers.
├── main.ts           Phaser.Game construction.
├── scenes/           Boot, Menu, CharacterSelect, Game, End, TestMenu.
├── script/           Stage queue runner + filter library; entity-script
│                     types and movement/firing patterns.
└── ui/               Dialogue + bubble managers, font tier definitions.
```

### Where to read more

| Topic | Doc |
|---|---|
| **Stage architecture** — declarative queue, filters, music-time gates, runner, debug HUD, how the real stage and test stage are wired | [src/docs/stage-design.md](src/docs/stage-design.md) |
| Audio system reference (external, aspirational) | [src/docs/dead-grid-audio-implementation-guide.md](src/docs/dead-grid-audio-implementation-guide.md) |

## Conventions worth knowing

### Stages are declarative queues

Stages are arrays of `{ name, kind, filters, action }` entries; a runner
walks the queue and gates each entry on its filters. **Read
[src/docs/stage-design.md](src/docs/stage-design.md) before editing
content/stage.ts or adding new stages.** Both the real stage and the
sync-test stage use the same runner, so changes to
[src/script/state.ts](src/script/state.ts) affect both.

### Audio model

- `Phaser` owns the AudioContext; we never call `new AudioContext()`.
- Bus graph in [src/audio/buses.ts](src/audio/buses.ts):
  `sfxBus + musicBus → DynamicsCompressor → Phaser master → destination`.
- Music: [src/audio/music/loop.ts](src/audio/music/loop.ts) exposes
  `playMusicLoop(key)`, `playMusicWithIntro(intro, loop)`,
  `getMusicTime()`, `getCurrentTrackInfo()`. The intro→loop hand-off is
  scheduled via Phaser's `delay` config (sample-accurate via Web Audio
  currentTime, requires Vorbis sources for gapless seams).
- SFX: [src/audio/sfx/pool.ts](src/audio/sfx/pool.ts) does voice
  capping; [src/audio/sfx/events.ts](src/audio/sfx/events.ts) exposes
  procedural (`shoot`, `hit`) and sample-based (`playClick`) sounds.
- Asset keys live in [src/audio/keys.ts](src/audio/keys.ts); URLs imported
  in [src/scenes/BootScene.ts](src/scenes/BootScene.ts).

Vorbis (.ogg) is the canonical music format — required for gapless looping
because LAME-style MP3 priming samples click at the seam. The browser
support gap (Safari) is acknowledged; a fallback path can be added later.

### Pause is hard

`EntityPool.beginDialogue` sets `pool.paused = true` AND
`scene.physics.pause()`. While paused: no script ticks, no body
integration, no player input (`GameScene.update` gates `controlUpdate`
on `!pool.paused`). Music is **not** paused. A previous Touhou-style
soft-pause experiment (player could move during dialogs) was reverted.

### Fonts

Defined in [src/ui/fonts.ts](src/ui/fonts.ts) as five tiers
(`FONT_TITLE`, `FONT_MENU`, `FONT_DIALOGUE_LG`, `FONT_DIALOGUE_SM`,
`FONT_DEBUG`). Pixel fonts (Press Start 2P, Silkscreen) are used for the
dramatic tiers at sizes that are clean multiples of 8px; the small/debug
tier is `system-ui` because pixel fonts can't render legibly below 16px.
All tiers use `resolution: devicePixelRatio` to stay crisp under
`Scale.FIT`.

### Entity scripts

`function* (self: Entity): Generator<ScriptYield>` where `ScriptYield`
is `number | { until: Entity } | { dialogue: DialogueOpts }`:

- `yield N` — wait N script frames
- `yield { until: e }` — wait for entity death
- `yield self.dialogue(opts)` — open a dialog, pause physics, resume on dismiss

Stage queue actions can be either a sync function or one of these
generators. For audio-time waits inside an action, prefer
`yield* waitAudioSeconds(s)` from
[src/script/state.ts](src/script/state.ts) over `yield N` —
it falls back to frame yields in practice mode where music isn't playing.

### Debug HUD

`GameScene` always renders a second HUD line (track / t / next entry /
blocked filters) sourced from `getMusicTime()` + `pool.stage`. Grey
during normal play, green during the sync-test stage. Useful any time
you're working on stage timing.

## Things to be careful with

- **Phaser frame order.** Arcade physics integration + overlap callbacks
  fire in `SceneEvents.UPDATE`, *before* `scene.update()`. So in
  `GameScene.update` the player may already be `alive === false` from a
  same-frame collision. The early-return at the top of update is load-
  bearing — see the comment block there.
- **Group `createCallback` resets bodies.** `Group.add()` overwrites body
  velocity / gravity / drag with the group defaults. Pool's `spawn`
  configures bodies *after* group membership for this reason; if you add
  body config that needs to persist across `add()`, do it in the same
  order.
- **Imports of audio/sprite URLs are URL strings via Vite**, not module
  exports. Always use the asset-relative path: `'../assets/audio/.../foo.ogg'`.
- **No direct push to main.** The repo enforces this; use a feature
  branch + PR. See git history for the existing flow.
