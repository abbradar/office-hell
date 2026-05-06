import Phaser from 'phaser';
import { canvasH, canvasW } from './config';
import { BootScene } from './scenes/BootScene';

new Phaser.Game({
  type: Phaser.WEBGL,
  // Phaser's parent (#viewport) is an inner div; #game is the fullscreen
  // target. Padding on #game:fullscreen shrinks #viewport so the canvas
  // clears the notch/bezels. Outside fullscreen, #viewport sizes to the
  // canvas (no padding in play), so layout is unchanged.
  parent: 'viewport',
  width: canvasW(),
  height: canvasH(),
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
