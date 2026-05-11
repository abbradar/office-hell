import type Phaser from 'phaser';
import bgDoorsUrl from '../assets/bg/doors.png';
import bgFloorUrl from '../assets/bg/floor.png';
import bgWallsUrl from '../assets/bg/walls.png';
import blueExplosionUrl from '../assets/bullets/blue_explosion.png';
import blueLongerDropletUrl from '../assets/bullets/blue_longer_droplet.png';
import cameraBulletUrl from '../assets/bullets/camera.png';
import chartCellUrl from '../assets/bullets/chartCell.png';
import drinkBulletUrl from '../assets/bullets/drink.png';
import emailBulletUrl from '../assets/bullets/email.png';
import greedDiamondXsUrl from '../assets/bullets/greed_diamond_xs.png';
import lavaDropletHardUrl from '../assets/bullets/lava_droplet_hard.png';
import missedCallUrl from '../assets/bullets/missedCall.png';
import pillBulletUrl from '../assets/bullets/pill.png';
import playerBulletUrl from '../assets/bullets/player_bullet.png';
import questionBulletUrl from '../assets/bullets/question.png';
import redCrossUrl from '../assets/bullets/red_cross.png';
import redDiamondMdUrl from '../assets/bullets/red_diamond_md.png';
import redDropletHardUrl from '../assets/bullets/red_droplet_hard.png';
import redExplosionUrl from '../assets/bullets/red_explosion.png';
import reportBulletUrl from '../assets/bullets/report.png';
import smallRedDropletUrl from '../assets/bullets/small_red_droplet.png';
import yellowDiamondSmUrl from '../assets/bullets/yellow_diamond_sm.png';
import menuLogoUrl from '../assets/images/office hell text logo2.png';
import bombExplosionUrl from '../assets/misc/bomb_explosion.png';
import waterDispenserUrl from '../assets/misc/water_dispenser.png';
import { BULLET_RADIUS } from '../config';
import { COLOR_ACCENT_RED, COLOR_BULLET_DEFAULT } from '../ui/palette';

const COLOR_BULLET_YELLOW = 0xfddc4a;
const COLOR_BULLET_ORANGE = 0xff8a2a;

// Runtime-generated textures. Each function draws into a fresh Graphics,
// registers a single texture by key, and destroys the Graphics. Callers
// should not rely on these textures existing until the corresponding
// function has run — see `generateTextures` for the bulk-register helper
// the boot scene uses.

// Three-layer office background:
//  - floor (416×112): seamless tile, drawn full-canvas via a TileSprite
//    that scrolls vertically as the corridor advances.
//  - walls (400×1): horizontal strip — opaque on the wall columns,
//    transparent in the middle. Tiled to canvas height into a per-frame
//    RenderTexture so we can erase the wall pixels under each door.
//  - doors (400×80): full-canvas-width strip with door panels at the
//    wall columns and a transparent middle. Three copies are placed
//    evenly down the playfield and scroll in lockstep with the floor,
//    wrapping back to the top as they exit.
export const BG_FLOOR_KEY = 'bg_floor';
export const BG_WALLS_KEY = 'bg_walls';
export const BG_DOORS_KEY = 'bg_doors';

// Solid white rectangle sized to the full doors texture — drawing it
// with origin (0, 0) at the same x/y as a door Image covers the same
// pixels (same native size, no scaling), so the wall cutout matches
// the door panels exactly. Update DOORS_W / DOORS_H here if doors.png
// dimensions ever change.
export const BG_DOORS_BBOX_KEY = 'bg_doors_bbox';
const DOORS_W = 400;
const DOORS_H = 80;

export function preloadBackgrounds(scene: Phaser.Scene): void {
  scene.load.image(BG_FLOOR_KEY, bgFloorUrl);
  scene.load.image(BG_WALLS_KEY, bgWallsUrl);
  scene.load.image(BG_DOORS_KEY, bgDoorsUrl);
}

export function generateDoorsBboxTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, DOORS_W, DOORS_H);
  g.generateTexture(BG_DOORS_BBOX_KEY, DOORS_W, DOORS_H);
  g.destroy();
}

// Player-shot bullet — Kenney pixelshmup green pill (tile_0000_green),
// trimmed to its content bbox (6×16) and pre-baked at 50% alpha so it
// reads as a soft tracer over the floor without per-spawn setAlpha calls.
export function preloadPlayerBullet(scene: Phaser.Scene): void {
  scene.load.image('playerBullet', playerBulletUrl);
}

// Water dispenser prop used in the inter-stage breather. 32×32 sprite
// from the Office-Furniture-Pixel-Art set; placed as a fixture the
// player walks up to mid-corridor.
export const PROP_WATER_DISPENSER_KEY = 'prop_water_dispenser';
export function preloadWaterDispenser(scene: Phaser.Scene): void {
  scene.load.image(PROP_WATER_DISPENSER_KEY, waterDispenserUrl);
}

// Main-menu logo — hand-drawn gothic "OFFICE HELL" text used in place of
// the FONT_TITLE banner the menu used to render. 149×152 PNG with
// transparent corners (content bbox ~120×98 centered in the canvas).
export const MENU_LOGO_KEY = 'menu_logo';
export function preloadMenuLogo(scene: Phaser.Scene): void {
  scene.load.image(MENU_LOGO_KEY, menuLogoUrl);
}

// Bomb explosion spritesheet — 5×2 lattice of 96×91 cells, source
// `explosion1.png` (rows 2 and 3 of the original explosions sheet,
// pre-cropped to keep the dust-scatter band at full height). Frame
// stride matches the source's actual fireball spacing (centers at
// 48, 144, 240, 336, 432 → 96 px apart), so each fireball sits
// centered in its cell and the animation plays without horizontal
// wobble. Frames 0–4 are the expand phase, 5–9 the fade phase.
// Animations are registered post-load via `registerBombAnims`.
export const BOMB_EXPLOSION_KEY = 'bomb_explosion';
export const BOMB_EXPAND_ANIM = 'bomb-expand';
export const BOMB_FADE_ANIM = 'bomb-fade';
const BOMB_FRAME_W = 96;
const BOMB_FRAME_H = 91;
export function preloadBombExplosion(scene: Phaser.Scene): void {
  scene.load.spritesheet(BOMB_EXPLOSION_KEY, bombExplosionUrl, {
    frameWidth: BOMB_FRAME_W,
    frameHeight: BOMB_FRAME_H,
  });
}
// Blue-explosion spritesheet — 112×14 strip of 7 frames at 16×14 each,
// spark → grow → peak → ring → expanded ring → broken ring → scatter.
// The source asset was re-packed into a uniform grid (centered per
// frame) from the original variable-width export, and the two
// scatter frames in the source were composited into a single final
// frame so the wave reads as one tail state, not two near-identical
// twitches. Used by the `lineExplosion` pattern in
// script/patterns.ts.
export const BLUE_EXPLOSION_KEY = 'blue_explosion';
export const BLUE_EXPLOSION_ANIM = 'blue-explosion';
export const BLUE_EXPLOSION_FRAME_W = 16;
export const BLUE_EXPLOSION_FRAME_H = 14;
export const BLUE_EXPLOSION_FRAMES = 7;
// One sprite frame per N physics frames. 2 frames = 30 fps, fast and
// punchy. The `lineExplosion` pattern paces its spawns to the same
// step so the propagation looks like one continuous wavefront.
export const BLUE_EXPLOSION_FRAME_DURATION_FRAMES = 2;

export function preloadBlueExplosion(scene: Phaser.Scene): void {
  scene.load.spritesheet(BLUE_EXPLOSION_KEY, blueExplosionUrl, {
    frameWidth: BLUE_EXPLOSION_FRAME_W,
    frameHeight: BLUE_EXPLOSION_FRAME_H,
  });
}

export function registerBlueExplosionAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists(BLUE_EXPLOSION_ANIM)) return;
  // Phaser animation duration is in ms; convert from physics frames.
  const durationMs = (BLUE_EXPLOSION_FRAMES * BLUE_EXPLOSION_FRAME_DURATION_FRAMES * 1000) / 60;
  scene.anims.create({
    key: BLUE_EXPLOSION_ANIM,
    frames: scene.anims.generateFrameNumbers(BLUE_EXPLOSION_KEY, {
      start: 0,
      end: BLUE_EXPLOSION_FRAMES - 1,
    }),
    duration: durationMs,
    repeat: 0,
  });
}

// Red-explosion spritesheet — 128×14 strip of 8 frames at 16×14
// each, packed from the variable-width-source export with brightness-
// centroid alignment so every frame's bright core lines up on the
// same column. Used by `lineExplosion` with the `redExplosion` kind
// (see content/kinds.ts) — slower, sparser variant of the propagating
// shockwave, suitable for an alternate boss layer.
export const RED_EXPLOSION_KEY = 'red_explosion';
export const RED_EXPLOSION_FRAME_W = 16;
export const RED_EXPLOSION_FRAME_H = 14;
export const RED_EXPLOSION_FRAMES = 8;

export function preloadRedExplosion(scene: Phaser.Scene): void {
  scene.load.spritesheet(RED_EXPLOSION_KEY, redExplosionUrl, {
    frameWidth: RED_EXPLOSION_FRAME_W,
    frameHeight: RED_EXPLOSION_FRAME_H,
  });
}

export function registerBombAnims(scene: Phaser.Scene): void {
  // Durations are wired to the bomb timing in content/bomb.ts —
  // EXPAND matches BOMB_EXPLODE_MS, FADE matches BOMB_LINGER_MS — so
  // the sprite always finishes on the same beat the script does.
  scene.anims.create({
    key: BOMB_EXPAND_ANIM,
    frames: scene.anims.generateFrameNumbers(BOMB_EXPLOSION_KEY, { start: 0, end: 4 }),
    duration: 700,
    repeat: 0,
  });
  scene.anims.create({
    key: BOMB_FADE_ANIM,
    frames: scene.anims.generateFrameNumbers(BOMB_EXPLOSION_KEY, { start: 5, end: 9 }),
    duration: 1100,
    repeat: 0,
  });
}

export function generateBulletTexture(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const r = BULLET_RADIUS;
  const d = r * 2;
  g.fillStyle(COLOR_BULLET_DEFAULT, 1);
  g.fillCircle(r, r, r);
  g.generateTexture('bullet', d, d);
  g.clear();
  g.fillStyle(COLOR_ACCENT_RED, 1);
  g.fillCircle(r, r, r);
  g.generateTexture('redBullet', d, d);
  g.clear();
  g.fillStyle(COLOR_BULLET_YELLOW, 1);
  g.fillCircle(r, r, r);
  g.generateTexture('yellowBullet', d, d);
  g.clear();
  g.fillStyle(COLOR_BULLET_ORANGE, 1);
  g.fillCircle(r, r, r);
  g.generateTexture('orangeBullet', d, d);
  g.clear();
  // Hodges Phase-D aimed-spread bullet — larger (r=6) and pink so the
  // three-shot fan reads as a heavier punctuation against the orbiter
  // spirals running in parallel. Sized independently of BULLET_RADIUS
  // to break out of the standard pellet family.
  const rPink = 6;
  g.fillStyle(0xff1155, 1);
  g.fillCircle(rPink, rPink, rPink);
  g.generateTexture('pinkBullet', rPink * 2, rPink * 2);
  g.destroy();
}

// Keyboard-cap bullets — the IT admin's password spray. Each character
// gets its own 16×16 texture drawn as a beveled grey key-cap with the
// glyph centered on its face. Texture key is `kbd:<char>`; the kind in
// itAdmin.ts looks up by `kbdKey(ch)` so the spawn texture lands on
// frame 0 (no placeholder flash). The cap is always rendered uppercase
// like a real keyboard, even though the password strings stay
// lowercase — caps lock isn't part of the gag.
const KBD_BUTTON_SIZE = 16;
const KBD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789!';

export function kbdKey(ch: string): string {
  return `kbd:${ch}`;
}

export function generateKeyboardButtonTextures(scene: Phaser.Scene): void {
  const size = KBD_BUTTON_SIZE;
  for (const ch of KBD_CHARS) {
    // createCanvas registers the texture under the key directly and
    // gives us a raw 2D context — Graphics can't render text, and a
    // Text+RenderTexture round-trip would mean three temporary game
    // objects per character we then have to tear down.
    const tex = scene.textures.createCanvas(kbdKey(ch), size, size);
    if (tex === null) continue;
    const ctx = tex.getContext();
    // Cap face.
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(0, 0, size, size);
    // Bevel — 1px top/left highlight, 1px bottom/right shadow, so the
    // bullet reads as a key cap rather than a flat tile at any zoom.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, 1);
    ctx.fillRect(0, 0, 1, size);
    ctx.fillStyle = '#666666';
    ctx.fillRect(0, size - 1, size, 1);
    ctx.fillRect(size - 1, 0, 1, size);
    // Glyph. Bold monospace at 11px fits within the 14px inner area
    // with room for the bevel; the +1 baseline nudge centres optically
    // against the descender-less uppercase / digit / `!` set.
    ctx.fillStyle = '#202020';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch.toUpperCase(), size / 2, size / 2 + 1);
    tex.refresh();
  }
}

// Themed bullet sprites — paper, envelope, missed call, etc. The texture
// keys here are the lookup names used by entity kinds; the filenames drop
// the `Bullet` suffix since they all live under `assets/bullets/`.
export const SMALL_RED_DROPLET_KEY = 'smallRedDroplet';
export const BLUE_LONGER_DROPLET_KEY = 'blueLongerDroplet';
export const RED_CROSS_KEY = 'redCross';
export const RED_DIAMOND_MD_KEY = 'redDiamondMd';
export const YELLOW_DIAMOND_SM_KEY = 'yellowDiamondSm';
export const GREED_DIAMOND_XS_KEY = 'greedDiamondXs';
// Hard-edged droplet pair, 13×8 directional sprites — used by the
// final boss's arc-wave (phase 1 climax). Sprite art is drawn
// pointing right at rotation 0, so `rotateToVelocity: true` on the
// kind aims each bullet along its travel vector.
export const LAVA_DROPLET_HARD_KEY = 'lavaDropletHard';
export const RED_DROPLET_HARD_KEY = 'redDropletHard';

// Bordered variant of the 14×10 email bullet sprite — used by the final
// boss's email volley as a visually distinct accent over the loose
// `emailBullet` sprite. 1 px #ff5e62 frame around the bbox; inner 14×10
// region is left transparent and overdrawn with the source image so the
// envelope's own pixels stay unmodified. Built post-load (the source
// image must exist) — see `generateEmailBorderedTexture` below.
export const EMAIL_BORDERED_KEY = 'emailBordered';
const EMAIL_W = 14;
const EMAIL_H = 10;
const EMAIL_BORDERED_W = EMAIL_W + 2;
const EMAIL_BORDERED_H = EMAIL_H + 2;

// Bordered variant of the 8×10 question bullet sprite — used by the
// final boss's phase-2/3 orbital arcs. Same construction as
// `emailBordered`: 1 px red frame around the bbox, source image
// overdrawn into the inner region.
export const QUESTION_BORDERED_KEY = 'questionBordered';
const QUESTION_W = 8;
const QUESTION_H = 10;
const QUESTION_BORDERED_W = QUESTION_W + 2;
const QUESTION_BORDERED_H = QUESTION_H + 2;

export function preloadBullets(scene: Phaser.Scene): void {
  scene.load.image('reportBullet', reportBulletUrl);
  scene.load.image('missedCall', missedCallUrl);
  scene.load.image('emailBullet', emailBulletUrl);
  scene.load.image('chartCell', chartCellUrl);
  scene.load.image('questionBullet', questionBulletUrl);
  scene.load.image('drinkBullet', drinkBulletUrl);
  scene.load.image('pillBullet', pillBulletUrl);
  scene.load.image('cameraBullet', cameraBulletUrl);
  scene.load.image(SMALL_RED_DROPLET_KEY, smallRedDropletUrl);
  scene.load.image(BLUE_LONGER_DROPLET_KEY, blueLongerDropletUrl);
  scene.load.image(RED_CROSS_KEY, redCrossUrl);
  scene.load.image(RED_DIAMOND_MD_KEY, redDiamondMdUrl);
  scene.load.image(YELLOW_DIAMOND_SM_KEY, yellowDiamondSmUrl);
  scene.load.image(GREED_DIAMOND_XS_KEY, greedDiamondXsUrl);
  scene.load.image(LAVA_DROPLET_HARD_KEY, lavaDropletHardUrl);
  scene.load.image(RED_DROPLET_HARD_KEY, redDropletHardUrl);
}

// Multiplier-drop pickup — 16×16 white square with a 1 px green border
// and a green "M" glyph in the middle. Drawn at runtime via Graphics so
// the design lives next to its color tokens (no extra asset to ship);
// pickup hitbox is enlarged separately on the kind (see kinds.ts) so
// the small visual stays readable while the collection radius is
// generous.
export const MULT_DROP_KEY = 'mult_drop';
const MULT_DROP_SIZE = 16;
const COLOR_MULT_DROP_BG = 0xffffff;
const COLOR_MULT_DROP_FG = 0x33aa44; // saturated office-green
export function generateMultDropTexture(scene: Phaser.Scene): void {
  const s = MULT_DROP_SIZE;
  const g = scene.add.graphics();
  // White fill.
  g.fillStyle(COLOR_MULT_DROP_BG, 1);
  g.fillRect(0, 0, s, s);
  // 1 px green border. Inset by 0.5 so the stroke lands on integer
  // pixels rather than straddling the seam.
  g.lineStyle(1, COLOR_MULT_DROP_FG, 1);
  g.strokeRect(0.5, 0.5, s - 1, s - 1);
  // "M" glyph — two verticals + a V-notch in the middle, stroked at
  // 2 px so the legs read at the 16 px tile size.
  g.lineStyle(2, COLOR_MULT_DROP_FG, 1);
  g.beginPath();
  g.moveTo(4, 13);
  g.lineTo(4, 4);
  g.lineTo(8, 8);
  g.lineTo(12, 4);
  g.lineTo(12, 13);
  g.strokePath();
  g.generateTexture(MULT_DROP_KEY, s, s);
  g.destroy();
}

// Bulk-register every synchronous runtime texture (the round default
// bullet + doors-bbox silhouette). Boot scene calls this from a microtask
// after queueing the network loads, so canvas draws don't block the
// kick-off of XHRs and dynamic-imports.
export function generateTextures(scene: Phaser.Scene): void {
  generateDoorsBboxTexture(scene);
  generateBulletTexture(scene);
  generateMultDropTexture(scene);
  generateKeyboardButtonTextures(scene);
}

// Bordered email bullet — draws a 1 px #ff5e62 frame around the 14×10
// email sprite into a 16×12 canvas. Must run AFTER the `emailBullet`
// PNG has loaded (the source image is drawn into the canvas), so this
// is invoked from BootScene's load-complete handler, not from the
// synchronous `generateTextures` microtask.
export function generateEmailBorderedTexture(scene: Phaser.Scene): void {
  const canvas = scene.textures.createCanvas(EMAIL_BORDERED_KEY, EMAIL_BORDERED_W, EMAIL_BORDERED_H);
  if (!canvas) return;
  const ctx = canvas.getContext();
  ctx.fillStyle = '#ff5e62';
  // 4 strips: top + bottom (full width), left + right (between corners).
  // Drawing as strips rather than a 16×12 fill keeps the inner 14×10
  // region transparent so the envelope's transparent pixels don't get
  // colour-bled by the border.
  ctx.fillRect(0, 0, EMAIL_BORDERED_W, 1);
  ctx.fillRect(0, EMAIL_BORDERED_H - 1, EMAIL_BORDERED_W, 1);
  ctx.fillRect(0, 1, 1, EMAIL_H);
  ctx.fillRect(EMAIL_BORDERED_W - 1, 1, 1, EMAIL_H);
  const src = scene.textures.get('emailBullet').getSourceImage();
  ctx.drawImage(src as CanvasImageSource, 1, 1);
  canvas.refresh();
}

// Bordered question bullet — same construction as the email variant
// above, applied to the 8×10 `questionBullet` PNG. The 1 px frame uses
// the same `#ff5e62` red so the final boss's phase-2/3 orbital arcs
// read as a kin to the email volley's accent. Built post-load.
export function generateQuestionBorderedTexture(scene: Phaser.Scene): void {
  const canvas = scene.textures.createCanvas(QUESTION_BORDERED_KEY, QUESTION_BORDERED_W, QUESTION_BORDERED_H);
  if (!canvas) return;
  const ctx = canvas.getContext();
  ctx.fillStyle = '#ff5e62';
  ctx.fillRect(0, 0, QUESTION_BORDERED_W, 1);
  ctx.fillRect(0, QUESTION_BORDERED_H - 1, QUESTION_BORDERED_W, 1);
  ctx.fillRect(0, 1, 1, QUESTION_H);
  ctx.fillRect(QUESTION_BORDERED_W - 1, 1, 1, QUESTION_H);
  const src = scene.textures.get('questionBullet').getSourceImage();
  ctx.drawImage(src as CanvasImageSource, 1, 1);
  canvas.refresh();
}
