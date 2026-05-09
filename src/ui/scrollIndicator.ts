import type Phaser from 'phaser';
import { GAME_W } from '../config';
import { COLOR_TEXT_DIM } from './palette';

// Two small triangles above and below a scrollable viewport that toggle
// visibility based on whether content exists past each edge. Used by
// TestMenuScene (the practice list) and CreditsScene (the credits roll)
// so a scene that grows past the visible viewport advertises that with
// a soft pulsing arrow.
//
// Caller is responsible for plumbing scroll state — every time the
// scroll position changes, call `update(scrollY, maxScroll)`. The
// helper itself is stateless across calls.
export type ScrollIndicators = {
  update(scrollY: number, maxScroll: number): void;
};

// Half-base of the equilateral-ish triangle (in px). Small enough to
// recede next to body text but visible at integer canvas zoom.
const SIZE = 7;
// Distance outside the viewport bounds where the triangles sit. Pushes
// them clear of any content that touches the viewport edge.
const POKE = 6;
const PULSE_ALPHA = 0.4;
const PULSE_MS = 700;
const FILL = COLOR_TEXT_DIM;
// Above content sprites (default depth 0) but below HUD overlays
// (typically depth 99-100).
const DEPTH = 95;

export function addScrollIndicators(
  scene: Phaser.Scene,
  viewportTop: number,
  viewportBottom: number,
): ScrollIndicators {
  const cx = GAME_W / 2;
  // Up-pointing triangle above the viewport. Vertex order: bottom-left,
  // bottom-right, apex at top-center. Local coords; the (cx, upY)
  // anchor places the triangle base just outside the viewport.
  const upTri = scene.add
    .triangle(cx, viewportTop - POKE, -SIZE, SIZE, SIZE, SIZE, 0, 0, FILL)
    .setVisible(false)
    .setDepth(DEPTH);
  // Down-pointing triangle below: top-left, top-right, apex at bottom.
  const downTri = scene.add
    .triangle(cx, viewportBottom + POKE, -SIZE, 0, SIZE, 0, 0, SIZE, FILL)
    .setVisible(false)
    .setDepth(DEPTH);
  // Soft pulse so the indicator catches the eye without flashing.
  for (const t of [upTri, downTri]) {
    scene.tweens.add({
      targets: t,
      alpha: PULSE_ALPHA,
      duration: PULSE_MS,
      yoyo: true,
      repeat: -1,
    });
  }
  return {
    update(scrollY, maxScroll) {
      // Half-pixel epsilon so a freshly-clamped scroll doesn't toggle
      // the triangle from rounding noise in the gesture handler.
      upTri.setVisible(scrollY > 0.5);
      downTri.setVisible(scrollY < maxScroll - 0.5);
    },
  };
}
