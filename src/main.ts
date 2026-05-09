import Phaser from 'phaser';
import { GAME_W, SCRIPT_FPS } from './config';
// Side-effect import: overrides the global `text` factory so all
// `scene.add.text(...)` calls produce OverlayText instances that draw onto
// the high-resolution overlay canvas (see render/textOverlay.ts).
import './render/OverlayText';
import { installTextOverlay } from './render/textOverlay';
import { BootScene } from './scenes/BootScene';

// Boot-time read, before Phaser is constructed. The host page pads the body
// by the top/side safe-area insets (notch, rounded corners), so body
// width/height already excludes those. We size the visible canvas to that
// rectangle so the WebGL framebuffer matches the screen pixel grid 1:1 —
// the upscale from logical (400×canvasH) to canvas (screen) is done by the
// SharpBilinearPipeline applied to the UIScene's display image, not by CSS
// or Phaser's scale manager. The bottom is intentionally not inset so the
// touch control band reaches the physical screen bottom.
const bodyRect = document.body.getBoundingClientRect();

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  // Phaser's parent (#viewport) is an inner div; #game is the fullscreen
  // target. Padding on #game:fullscreen shrinks #viewport so the canvas
  // clears the notch/bezels.
  parent: 'viewport',
  // Initial canvas size = parent rect = screen-pixel size. BootScene's
  // RESIZE handler maintains this on viewport changes.
  width: Math.max(GAME_W, Math.round(bodyRect.width || window.innerWidth)),
  height: Math.max(1, Math.round(bodyRect.height || window.innerHeight)),
  backgroundColor: '#10101a',
  pixelArt: true,
  scale: {
    // Scale.RESIZE: canvas tracks the parent at 1:1 screen pixels. The
    // logical-to-screen upscale is done inside WebGL by the
    // SharpBilinearPipeline applied to the UIScene's display image. The
    // earlier Scale.FIT path (fractional CSS scaling under pixelArt:true)
    // produced 1-vs-2-screen-pixel stem wobble at non-integer ratios;
    // sharp-bilinear via a render texture sidesteps that.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
    // Use #game itself as the fullscreen element. Default behaviour creates
    // a wrapper div, moves the canvas into it, and fullscreens the wrapper —
    // which leaves Phaser's `parent` (#game) empty and collapsed to 0×0,
    // so the canvas doesn't resize.
    fullscreenTarget: 'game',
  },
  // Register the sharp-bilinear pipeline so any GameObject can attach it
  // via `obj.setPipeline(SHARP_BILINEAR_PIPELINE)`. Used by UIScene to
  // render the world FBO at non-integer scale without wobble.
  pipeline: { [SHARP_BILINEAR_PIPELINE]: SharpBilinearPipeline } as unknown as Phaser.Types.Core.PipelineConfig,
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

// Sibling overlay canvas for crisp text. Phaser appends its canvas during
// async boot, not synchronously from the constructor — wait for READY so
// `game.canvas.parentElement` resolves to the live #viewport, not null.
game.events.once(Phaser.Core.Events.READY, () => installTextOverlay(game));

// Expose the game for in-browser debugging + automated tests (the
// playwright stress test reads `__game.loop.actualFps` and pokes into
// scene state via `__game.scene.getScene(key)`). Tiny convenience; not
// load-bearing — production users won't notice it.
(globalThis as typeof globalThis & { __game?: Phaser.Game }).__game = game;
