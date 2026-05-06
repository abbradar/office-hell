# Engine stress test — bullet rendering headroom

How many bullets can the engine sustain at 60 fps? This is a record of one
measurement; rerun whenever the entity pool, physics setup, or batching
strategy changes materially.

## Setup

- **Driver**: Playwright + headless Chromium 1148 at 480×800 viewport
  (game is 400×660 logical, scaled 1.20× by Phaser's `Scale.FIT`).
- **Source**: dev build via `npm run dev` (Vite 6, no minification).
- **Stage**: `PatternTest` sandbox — single inert dummy enemy at
  `(GAME_W/2, 70)` running a user-supplied `EntityScript`. No player
  bullets, no collisions hitting anything (the player stub at
  `STUB_PLAYER_Y = 200` has no body, so bullets fly past forever and
  only get released when they cross the cull margin).
- **Sampling**: every 500 ms, read `game.loop.actualFps` and
  `stage.damages.player.countActive(true)`. Drop the first ~20 % of
  samples as warm-up.
- **Test script**: `/tmp/stress-test.mjs` (not committed — ad-hoc tool;
  recreate if needed using the snippet at the bottom of this file).

The pool starts at `ENTITY_POOL_SIZE = 1024` and grows on demand
(`free.pop() ?? makeEntity()`), so the high-end scenarios pay one-time
allocation costs that should hide inside the warm-up window.

## Scenarios

| Scenario | Pattern | Cadence |
|---|---|---|
| baseline | `ring(self, 16, bullet, 130)` | 1× per second |
| medium   | `ring(self, 24, bullet, 60)`  | every 15 frames (~4 Hz) |
| heavy    | `ring(self, 60, bullet, 50)`  | every 4 frames (~15 Hz) |
| extreme  | `ring(self, 120, bullet, 40)` | every 2 frames (~30 Hz) |

All bullets share the default `bullet` kind (white circle, single
texture) so WebGL batches them into one draw call.

## Results

| Scenario | FPS avg | FPS min | FPS max | Active avg | Active min | Active max |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 58.7 | 56.8 | 59.9 | 40    | 27    | 54    |
| medium   | 60.5 | 60.3 | 60.6 | 419   | 144   | 538   |
| heavy    | 60.5 | 60.4 | 60.8 | 3 884 | 1 140 | 5 177 |
| extreme  | 44.0 | 28.7 | 60.6 | 9 546 | 3 720 | 11 369 |

## Interpretation

- **Comfortable budget at 60 fps: ~5 000 simultaneous active bullets.**
  The "heavy" scenario sustains 60.5 fps avg with peaks past 5k active
  bullets — the engine has clear headroom there.
- **Falloff begins around ~10k.** "extreme" averages 44 fps with dips
  to 28 once the active count clears 10k.
- **Baseline FPS is suspiciously low (58.7).** Likely a Chromium/vsync
  artefact at low-load — the game has nothing demanding to do, so the
  loop slips a frame here and there. The other scenarios all sit above
  60.0, suggesting Phaser's scheduler runs hot enough to recover when
  there's actual work.
- **Bottleneck at the extreme tier is most likely Arcade physics**
  (broad-phase pairs each bullet against its damage targets — only the
  player's group here, but every active body still gets integrated).
  Render cost is bounded by the single shared texture: one draw call
  whether there's 100 or 10 000 bullets on screen.

## Caveats

- Headless Chromium tends to run faster than headed Chromium on the
  same machine; expect production play to be slightly worse.
- Numbers are from one machine, one run. Treat them as orders of
  magnitude, not promises. Rerun on a target device if you care about
  shipping a specific bullet count.
- The stress patterns use *very slow* bullet speeds (40–60 px/s) so
  bullets accumulate before clearing the field. Real game patterns
  fire faster bullets that exit promptly — sustained on-screen
  counts in real play are far below the "active" numbers here.

## Reproducing

The test script lives in `/tmp` (transient) and uses Playwright to
drive the dev server:

```js
// /tmp/stress-test.mjs
import { chromium } from '/path/to/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
const page = await (await browser.newContext({ viewport: { width: 480, height: 800 } })).newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

// Boot gesture (audio unlock) + navigate Boot → Menu → TestMenu → PatternTest
await page.click('canvas', { position: { x: 240, y: 400 } });
await page.keyboard.press('T');
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Z');

// Fill the textarea, click RUN at game-coords (110, 536) scaled 1.20×.
await page.locator('textarea').first().fill(USER_SCRIPT);
await page.mouse.click(110 * 1.20, 536 * 1.20 + 4);

// Sample every 500 ms.
const snap = await page.evaluate(() => ({
  fps: window.__game.loop.actualFps,
  active: window.__game.scene.getScene('PatternTest').stage.damages.player.countActive(true),
}));
```

`window.__game` is exposed by [src/main.ts](../main.ts) for exactly this
kind of probing. Production users never touch it.
