import Phaser from 'phaser';
import { computeCanvasH } from './canvasSize';
import { GAME_W } from './config';
import { initTouch } from './input/touch';
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
  scene: [BootScene],
});

initTouch(game);

// Expose the game for in-browser debugging + automated tests (the
// playwright stress test reads `__game.loop.actualFps` and pokes into
// scene state via `__game.scene.getScene(key)`). Tiny convenience; not
// load-bearing — production users won't notice it.
(globalThis as typeof globalThis & { __game?: Phaser.Game }).__game = game;
