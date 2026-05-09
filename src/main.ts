import Phaser from 'phaser';
import { GAME_W, SCRIPT_FPS } from './config';
// Side-effect import: overrides the global `text` factory so every
// `scene.add.text(...)` call inherits `resolution: displayState.scale`.
// Combined with cameraBind's zoom, this keeps glyph stems on whole
// device pixels (see render/textResolution.ts).
import './render/textResolution';
import { installTextResolutionRefresher } from './render/textResolution';
import { BootScene } from './scenes/BootScene';

// Boot-time read, before Phaser is constructed. The host page pads the body
// by the top/side safe-area insets (notch, rounded corners), so body
// width/height already excludes those. We size the canvas internal to the
// device-pixel rectangle (parent CSS × DPR) so each canvas pixel = a real
// screen pixel — no browser-side fractional CSS upscale, which is what
// gave the older Scale.FIT path its glyph-stem wobble. The bottom is
// intentionally not inset, so the touch control band reaches the physical
// screen bottom (home indicator overlapping a button is fine).
const bodyRect = document.body.getBoundingClientRect();
const dpr = window.devicePixelRatio || 1;

const initialCssW = Math.max(1, Math.round(bodyRect.width || window.innerWidth));
const initialCssH = Math.max(1, Math.round(bodyRect.height || window.innerHeight));
const initialW = Math.max(GAME_W, Math.round(initialCssW * dpr));
const initialH = Math.max(1, Math.round(initialCssH * dpr));

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  // Phaser's parent (#viewport) is an inner div; #game is the fullscreen
  // target. Padding on #game:fullscreen shrinks #viewport so the canvas
  // clears the notch/bezels.
  parent: 'viewport',
  // Initial canvas internal = device pixels for the parent. BootScene's
  // RESIZE handler maintains this on viewport changes.
  width: initialW,
  height: initialH,
  backgroundColor: '#10101a',
  pixelArt: true,
  scale: {
    // Scale.NONE: Phaser doesn't auto-resize the canvas. BootScene owns
    // the resize path — on Phaser's RESIZE event (which still fires on
    // parent changes regardless of mode), it calls setGameSize(parent
    // CSS × DPR) so the framebuffer is at native device resolution and
    // overrides canvas.style to the parent CSS rect so the on-screen
    // size matches. Camera zoom in each scene (see render/cameraBind.ts)
    // upscales logical world coords into that device-pixel buffer with
    // NEAREST filtering — i.e. game sprites get rendered at game-field
    // size and NN-scaled to the device size. Text crispness comes from
    // Text.resolution = scale at the rasterise step (see
    // render/textResolution.ts).
    //
    // Why not Scale.RESIZE: in that mode, Phaser's per-refresh
    // updateScale resets gameSize → parentSize on every emit, which
    // would undo our DPR multiplier the moment we set it.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    // Use #game itself as the fullscreen element. Default behaviour creates
    // a wrapper div, moves the canvas into it, and fullscreens the wrapper —
    // which leaves Phaser's `parent` (#game) empty and collapsed to 0×0,
    // so the canvas doesn't resize.
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
  fps: { target: SCRIPT_FPS },
  // Grow the touch-pointer pool past Phaser's default of 1 so two-thumb
  // multi-touch (a finger on a move pad plus another on the bomb pad)
  // is tracked simultaneously.
  input: { activePointers: 8 },
  scene: [BootScene],
});

// Hook the resize-aware text refresh once Phaser has booted. Module-load
// side-effects already installed the factory override.
installTextResolutionRefresher(game);

// Expose the game for in-browser debugging + automated tests (the
// playwright stress test reads `__game.loop.actualFps` and pokes into
// scene state via `__game.scene.getScene(key)`). Tiny convenience; not
// load-bearing — production users won't notice it.
(globalThis as typeof globalThis & { __game?: Phaser.Game }).__game = game;
