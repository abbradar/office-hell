// Platform-aware input prompt icons.
//
// Each entry in `InputIconSet` maps a *game action* (not a physical key) to
// one or more icons. Code that wants to show "press X to bomb" looks up
// `bomb` and gets back the icon(s) for whatever input scheme the player is
// on — keyboard today, touch later.
//
// Icons are SVG, rasterised by the browser's SVG renderer at the exact
// pixel size the prompt needs. We preload one Phaser texture per (icon,
// size) pair — a 22px texture and a 26px texture, matching the two icon
// sizes prompt.ts requests today (FONT_DEBUG/SM tier and FONT_MENU tier
// respectively). No downscaling means no interpolation artifacts and the
// glyphs stay perfectly symmetric.
//
// Touch icons aren't shipped yet: TOUCH_ICONS is intentionally empty so a
// touch session falls through to "no icon" instead of leaking a keyboard
// glyph onto a phone screen. Adding touch later means populating that map;
// no consumer code needs to change.
//
// Asset source: Kenney "Input Prompts 1.4" (CC0). SVGs live under
// src/assets/icons/keyboard-vector/; raster PNGs (legacy) under
// src/assets/icons/keyboard/. See LICENSE-kenney.txt one level up.

import type Phaser from 'phaser';
// Outline variants — open-frame look reads better on the dark UI.
import keyboardArrowDown from '../assets/icons/keyboard-vector/keyboard_arrow_down_outline.svg';
import keyboardArrowLeft from '../assets/icons/keyboard-vector/keyboard_arrow_left_outline.svg';
import keyboardArrowRight from '../assets/icons/keyboard-vector/keyboard_arrow_right_outline.svg';
import keyboardArrowUp from '../assets/icons/keyboard-vector/keyboard_arrow_up_outline.svg';
// `arrows_all` only ships in filled form (no outline variant in the pack).
import keyboardArrowsAll from '../assets/icons/keyboard-vector/keyboard_arrows_all.svg';
import keyboardArrowsHorizontal from '../assets/icons/keyboard-vector/keyboard_arrows_horizontal_outline.svg';
import keyboardEnter from '../assets/icons/keyboard-vector/keyboard_enter_outline.svg';
// `back` is bound to Escape — the kenney pack ships no SVG variant for
// it, so this is a hand-authored matching keycap with an "ESC" label.
import keyboardEscape from '../assets/icons/keyboard-vector/keyboard_escape_outline.svg';
import keyboardSpace from '../assets/icons/keyboard-vector/keyboard_space_outline.svg';
import keyboardT from '../assets/icons/keyboard-vector/keyboard_t_outline.svg';
import keyboardX from '../assets/icons/keyboard-vector/keyboard_x_outline.svg';
import keyboardZ from '../assets/icons/keyboard-vector/keyboard_z_outline.svg';
import { isTouchDevice } from '../input/device';

// Game-level input actions. Keep this list aligned with what's actually
// bound somewhere in the game; don't preemptively add actions that aren't
// triggered yet — they'd just clutter the map and lookup paths.
export type InputAction =
  | 'fire' // Z (or auto-fire on touch)
  | 'bomb' // X
  | 'moveHorizontal' // ← / →
  | 'menuUp'
  | 'menuDown'
  | 'menuLeft'
  | 'menuRight'
  | 'confirm' // Z / Enter
  | 'back' // Escape
  | 'practice' // T (main-menu shortcut)
  | 'advanceDialogue'; // Z / Space

export type InputIcon = {
  // Short stable identifier — used to construct per-size texture keys
  // (`icon_kb_z@22`, `icon_kb_z@26`). Doesn't change when the binding
  // changes; only the URL it's mapped to does.
  name: string;
  // Vite-fingerprinted SVG asset URL. Passed to scene.load.svg().
  url: string;
};

// `InputIcon[]` for actions that map to multiple icons (e.g. ←→ for
// horizontal movement). Consumers should accept either shape.
export type InputIconRef = InputIcon | InputIcon[];

const kb = (name: string, url: string): InputIcon => ({ name, url });

// Keyboard map. Source of truth for which key represents each action on
// desktop. If a binding changes (say `bomb` moves from X to C), update
// here once and every consumer reflects it.
export const KEYBOARD_ICONS: Record<InputAction, InputIconRef> = {
  fire: kb('z', keyboardZ),
  bomb: kb('x', keyboardX),
  // Two icons rendered side-by-side, or use `keyboardArrowsHorizontal` as a
  // single combined glyph if a one-icon prompt fits the layout better.
  moveHorizontal: [kb('arrow_left', keyboardArrowLeft), kb('arrow_right', keyboardArrowRight)],
  menuUp: kb('arrow_up', keyboardArrowUp),
  menuDown: kb('arrow_down', keyboardArrowDown),
  menuLeft: kb('arrow_left', keyboardArrowLeft),
  menuRight: kb('arrow_right', keyboardArrowRight),
  confirm: kb('z', keyboardZ),
  back: kb('escape', keyboardEscape),
  practice: kb('t', keyboardT),
  advanceDialogue: kb('z', keyboardZ),
};

// Combined glyphs available for layouts that prefer one icon over two.
// Not in the action map (since they don't correspond to a single binding)
// but exposed for ad-hoc use — e.g. the controls hint on the title screen.
export const KEYBOARD_GLYPHS = {
  arrowsAll: kb('arrows_all', keyboardArrowsAll),
  arrowsHorizontal: kb('arrows_horizontal', keyboardArrowsHorizontal),
  enter: kb('enter', keyboardEnter),
  space: kb('space', keyboardSpace),
};

// Touch icons land later. Empty for now — `getInputIcons()` returns this
// on touch devices so consumers see `undefined` lookups and can either
// fall back to text prompts or skip rendering.
export const TOUCH_ICONS: Partial<Record<InputAction, InputIconRef>> = {};

export function getInputIcons(): Partial<Record<InputAction, InputIconRef>> {
  return isTouchDevice ? TOUCH_ICONS : KEYBOARD_ICONS;
}

export function getInputIcon(action: InputAction): InputIconRef | undefined {
  return getInputIcons()[action];
}

// --- texture-key resolution ------------------------------------------------

// Sizes we preload each icon at. Two tiers cover the two `iconHeight` values
// that prompt.ts requests today (18 = FONT_DEBUG/SM floor, 22 = FONT_MENU
// 16px × 1.32). The SVGs were trimmed to their content bbox (no transparent
// padding), so the rendered texture size IS the visible icon size — both
// sizes are 10% larger than the original [16, 20] tier so the keys read
// better in-game without losing pixel-perfect rasterisation.
export const ICON_RENDER_SIZES = [18, 22] as const;
export type IconRenderSize = (typeof ICON_RENDER_SIZES)[number];

// Texture key for a specific (icon, size) combo. Mirror of the construction
// inside preloadInputIcons — both must agree.
export function iconTextureKey(icon: InputIcon, size: IconRenderSize): string {
  return `icon_kb_${icon.name}@${size}`;
}

// Pick the closest preloaded render size for a requested display height.
// Rounds toward the larger of two equidistant options to avoid making
// already-small icons even smaller.
export function nearestIconRenderSize(displayHeight: number): IconRenderSize {
  let best: IconRenderSize = ICON_RENDER_SIZES[0];
  let bestDelta = Math.abs(best - displayHeight);
  for (const s of ICON_RENDER_SIZES) {
    const d = Math.abs(s - displayHeight);
    if (d < bestDelta || (d === bestDelta && s > best)) {
      best = s;
      bestDelta = d;
    }
  }
  return best;
}

// Preload every icon referenced by the active platform's map (and the
// shared glyph set when on keyboard) at every size in ICON_RENDER_SIZES.
// Each (icon, size) becomes its own Phaser texture, rasterised by the
// browser's SVG renderer at the exact pixel size — no downscaling, so
// edges stay sharp and symmetric.
export function preloadInputIcons(scene: Phaser.Scene): void {
  const seen = new Set<string>();
  const queue = (icon: InputIcon): void => {
    for (const size of ICON_RENDER_SIZES) {
      const key = iconTextureKey(icon, size);
      if (seen.has(key)) continue;
      seen.add(key);
      scene.load.svg(key, icon.url, { width: size, height: size });
    }
  };

  for (const ref of Object.values(getInputIcons())) {
    if (!ref) continue;
    if (Array.isArray(ref)) for (const i of ref) queue(i);
    else queue(ref);
  }

  if (!isTouchDevice) {
    for (const i of Object.values(KEYBOARD_GLYPHS)) queue(i);
  }
}
