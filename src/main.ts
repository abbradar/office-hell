import Phaser from 'phaser';
import { computeCanvasH } from './canvasSize';
import { GAME_W } from './config';
import { BootScene } from './scenes/BootScene';

// Boot-time read, before Phaser is constructed. The host page pads the body
// by the top/side safe-area insets (notch, rounded corners), so body
// width/height already excludes those — using it here means Scale.FIT fills
// the safe rectangle edge-to-edge instead of letterboxing inside it. The
// bottom is intentionally not inset, so the control band reaches the
// physical screen bottom (home indicator overlapping a button is fine).
const bodyRect = document.body.getBoundingClientRect();

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  // Phaser's parent (#viewport) is an inner div; #game is the fullscreen
  // target. Padding on #game:fullscreen shrinks #viewport so the canvas
  // clears the notch/bezels. Outside fullscreen, #viewport sizes to the
  // canvas (no padding in play), so layout is unchanged.
  parent: 'viewport',
  width: GAME_W,
  height: computeCanvasH(bodyRect.width, bodyRect.height),
  backgroundColor: '#10101a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Use #game itself as the fullscreen element. Default behaviour creates
    // a wrapper div, moves the canvas into it, and fullscreens the wrapper —
    // which leaves Phaser's `parent` (#game) empty and collapsed to 0×0, so
    // FIT computes against zero bounds and the canvas doesn't resize.
    fullscreenTarget: 'game',
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  // Render runs at the host display rate via RAF; simulation (physics +
  // script ticks) is locked to a fixed 60Hz clock. Phaser arcade physics
  // already does this via its `fixedStep` accumulator (see World.update),
  // and StageManager carries a matching accumulator so `yield N` waits and
  // `velocity * N/60` translations stay in lockstep regardless of render
  // rate. A 144Hz monitor renders 144 frames per second over the same 60
  // simulated ticks; a slow render frame drives both physics and scripts
  // through catch-up ticks together. `target: 60` is a hint for Phaser's
  // own bookkeeping (and physics' `_frameTimeMS`) — it does NOT cap render.
  fps: { target: 60 },
  // Grow the touch-pointer pool past Phaser's default of 1 so two-thumb
  // multi-touch (a finger on a move pad plus another on the bomb pad)
  // is tracked simultaneously.
  input: { activePointers: 8 },
  scene: [BootScene],
});

// Expose the game for in-browser debugging + automated tests (the
// playwright stress test reads `__game.loop.actualFps` and pokes into
// scene state via `__game.scene.getScene(key)`). Tiny convenience; not
// load-bearing — production users won't notice it.
(globalThis as typeof globalThis & { __game?: Phaser.Game }).__game = game;
