import Phaser from 'phaser';

// Tap-on-release semantics for an interactive game object:
//   - `pointerdown` on the target arms the action.
//   - The next *scene-level* `pointerup` (anywhere on screen) commits it
//     and disarms.
//
// More reliable on touch than `target.on('pointerup', ...)`. Phaser keeps
// `pointerout` disabled for touch pointers — by design, see phaserjs/phaser#4146 —
// so a small finger drift between press and release leaves the tracked
// pointer outside the hit rect with no `pointerout` to refresh the
// over-state. The object-level `pointerup` is then skipped entirely and
// the tap is silently missed. Listening at the scene level ignores the
// drift.
//
// Multiple armed targets in the same scene share state: the most-recent
// pointerdown wins, matching `gameobjectup`-style "press, then release
// wherever" semantics. The shared scene listener registers lazily on
// first call and unhooks itself on scene shutdown.
//
// Bonus: because the action runs from the scene-level `pointerup`, by
// the time it calls `scene.start(...)` the originating tap has fully
// released, so the same press can't be re-dispatched into the next
// scene's freshly-registered interactives.
type TapState = { armed: (() => void) | null };
const SCENE_TAP_STATE = new WeakMap<Phaser.Scene, TapState>();

export function onTap(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, action: () => void): void {
  const state = ensureTapState(scene);
  target.on('pointerdown', () => {
    state.armed = action;
  });
}

function ensureTapState(scene: Phaser.Scene): TapState {
  const existing = SCENE_TAP_STATE.get(scene);
  if (existing) return existing;
  const state: TapState = { armed: null };
  SCENE_TAP_STATE.set(scene, state);
  scene.input.on('pointerup', () => {
    const a = state.armed;
    state.armed = null;
    a?.();
  });
  // Scenes are reused across start cycles; the input plugin clears its
  // listeners on shutdown, so drop the cached state too — otherwise the
  // next create would skip listener registration on the stale entry.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    SCENE_TAP_STATE.delete(scene);
  });
  return state;
}
