// Platform-aware input prompt icons.
//
// Each entry in `InputIconSet` maps a *game action* (not a physical key) to
// one or more icons. Code that wants to show "press X to bomb" looks up
// `bomb` and gets back the icon(s) for whatever input scheme the player is
// on — keyboard or touch.
//
// Icons are SVG, decoded into HTMLImageElements at boot and cached here.
// Render-time, the high-DPR text overlay (see render/textOverlay.ts +
// render/OverlayImage.ts) rasterises them to a tinted scratch canvas at
// the exact device-pixel size — no Phaser textures, no pixelArt-style
// upscaling. The overlay path is shared with prompt text so icons stay
// crisp alongside the glyphs they annotate.
//
// Asset source: Kenney "Input Prompts 1.4" (CC0). SVGs live under
// src/assets/icons/keyboard-vector/ and src/assets/icons/touch-vector/.
// See LICENSE-kenney.txt one level up.
//
// Icon size: every prompt in the game uses 22px keys (main menu, character
// select, dialogue hint, tutorial bubble). Mixing sizes broke visual
// consistency between scenes, so we standardised on one tier — anything
// that wants smaller "buttons" can just use plain text.

// Outline variants — open-frame look reads better on the dark UI.
import keyboardArrowDown from '../assets/icons/keyboard-vector/keyboard_arrow_down_outline.svg';
import keyboardArrowLeft from '../assets/icons/keyboard-vector/keyboard_arrow_left_outline.svg';
import keyboardArrowRight from '../assets/icons/keyboard-vector/keyboard_arrow_right_outline.svg';
import keyboardArrowUp from '../assets/icons/keyboard-vector/keyboard_arrow_up_outline.svg';
// `arrows_all` only ships in filled form (no outline variant in the pack).
import keyboardArrowsAll from '../assets/icons/keyboard-vector/keyboard_arrows_all.svg';
import keyboardArrowsHorizontal from '../assets/icons/keyboard-vector/keyboard_arrows_horizontal_outline.svg';
import keyboardC from '../assets/icons/keyboard-vector/keyboard_c_outline.svg';
import keyboardEnter from '../assets/icons/keyboard-vector/keyboard_enter_outline.svg';
// `back` is bound to Escape — the kenney pack ships no SVG variant for
// it, so this is a hand-authored matching keycap with an "ESC" label.
import keyboardEscape from '../assets/icons/keyboard-vector/keyboard_escape_outline.svg';
import keyboardSpace from '../assets/icons/keyboard-vector/keyboard_space_outline.svg';
import keyboardT from '../assets/icons/keyboard-vector/keyboard_t_outline.svg';
import keyboardX from '../assets/icons/keyboard-vector/keyboard_x_outline.svg';
import keyboardZ from '../assets/icons/keyboard-vector/keyboard_z_outline.svg';
// Touch glyphs — single-tap for the common "do something" actions, two-finger
// gesture as the visually distinct "back / cancel" cue.
import touchTap from '../assets/icons/touch-vector/touch_tap.svg';
import touchTwo from '../assets/icons/touch-vector/touch_two.svg';
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
  | 'credits' // C (main-menu shortcut)
  | 'advanceDialogue'; // Z / Space

export type InputIcon = {
  // Short stable identifier. Used as the cache key for the decoded
  // HTMLImageElement (one entry per icon, not per-size — the overlay
  // rasterises at device-pixel size on demand). Doesn't change when the
  // binding changes; only the URL it's mapped to does.
  name: string;
  // Vite-fingerprinted SVG asset URL. Loaded into an HTMLImageElement
  // at boot via loadInputIconImages.
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
  credits: kb('c', keyboardC),
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

// Touch glyph mappings. Anything that's a "press button" action on
// keyboard becomes a tap on touch; `back` uses a two-finger glyph so it
// reads as visually distinct from the everyday tap. Movement and menu
// navigation aren't mapped — virtual move pads handle the former and
// menu items are direct-tap interactives, so a touch glyph next to those
// prompts would be redundant.
const tch = (name: string, url: string): InputIcon => ({ name, url });
export const TOUCH_ICONS: Partial<Record<InputAction, InputIconRef>> = {
  bomb: tch('tap', touchTap),
  confirm: tch('tap', touchTap),
  advanceDialogue: tch('tap', touchTap),
  back: tch('two', touchTwo),
};

export function getInputIcons(): Partial<Record<InputAction, InputIconRef>> {
  return isTouchDevice ? TOUCH_ICONS : KEYBOARD_ICONS;
}

export function getInputIcon(action: InputAction): InputIconRef | undefined {
  return getInputIcons()[action];
}

// --- HTMLImageElement preload ---------------------------------------------

// Decoded HTMLImageElement per icon name. Populated by loadInputIconImages()
// at boot, read by the overlay flush (see render/textOverlay.ts) which
// rasterises each SVG to a tinted scratch canvas at exact device-pixel
// size. One entry per icon — no per-size variants since rasterisation
// happens on demand.
const ICON_IMG_CACHE = new Map<string, HTMLImageElement>();

async function decodeOne(icon: InputIcon): Promise<void> {
  if (ICON_IMG_CACHE.has(icon.name)) return;
  const img = new Image();
  img.src = icon.url;
  // decode() resolves once the image is fully parsed and ready for
  // synchronous drawImage. Without this, the first paint risks drawing
  // before the SVG has been laid out, producing a blank icon.
  await img.decode();
  ICON_IMG_CACHE.set(icon.name, img);
}

// Load HTMLImageElements for every icon referenced by the active
// platform's map (plus the keyboard-glyph extras when on desktop).
// Resolves once every SVG is decoded and ready for drawImage.
export async function loadInputIconImages(): Promise<void> {
  const seen = new Set<string>();
  const promises: Promise<void>[] = [];
  const queue = (icon: InputIcon): void => {
    if (seen.has(icon.name)) return;
    seen.add(icon.name);
    promises.push(decodeOne(icon));
  };
  for (const ref of Object.values(getInputIcons())) {
    if (!ref) continue;
    if (Array.isArray(ref)) for (const i of ref) queue(i);
    else queue(ref);
  }
  if (!isTouchDevice) {
    for (const i of Object.values(KEYBOARD_GLYPHS)) queue(i);
  }
  await Promise.all(promises);
}

export function getInputIconImage(name: string): HTMLImageElement | undefined {
  return ICON_IMG_CACHE.get(name);
}
