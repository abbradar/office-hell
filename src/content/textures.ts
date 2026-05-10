import type Phaser from 'phaser';
import bgDoorsUrl from '../assets/bg/doors.png';
import bgFloorUrl from '../assets/bg/floor.png';
import bgWallsUrl from '../assets/bg/walls.png';
import cameraBulletUrl from '../assets/bullets/camera.png';
import chartCellUrl from '../assets/bullets/chartCell.png';
import drinkBulletUrl from '../assets/bullets/drink.png';
import emailBulletUrl from '../assets/bullets/email.png';
import missedCallUrl from '../assets/bullets/missedCall.png';
import pillBulletUrl from '../assets/bullets/pill.png';
import questionBulletUrl from '../assets/bullets/question.png';
import reportBulletUrl from '../assets/bullets/report.png';
import bombExplosionUrl from '../assets/sprites/bomb_explosion.png';
import playerBulletUrl from '../assets/sprites/player_bullet.png';
import waterDispenserUrl from '../assets/sprites/water_dispenser.png';
import { BULLET_RADIUS } from '../config';
import { COLOR_BULLET_DEFAULT } from '../ui/palette';

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
  g.destroy();
}

// Themed bullet sprites — paper, envelope, missed call, etc. The texture
// keys here are the lookup names used by entity kinds; the filenames drop
// the `Bullet` suffix since they all live under `assets/bullets/`.
export function preloadBullets(scene: Phaser.Scene): void {
  scene.load.image('reportBullet', reportBulletUrl);
  scene.load.image('missedCall', missedCallUrl);
  scene.load.image('emailBullet', emailBulletUrl);
  scene.load.image('chartCell', chartCellUrl);
  scene.load.image('questionBullet', questionBulletUrl);
  scene.load.image('drinkBullet', drinkBulletUrl);
  scene.load.image('pillBullet', pillBulletUrl);
  scene.load.image('cameraBullet', cameraBulletUrl);
}

// Bulk-register every synchronous runtime texture (the round default
// bullet + doors-bbox silhouette). Boot scene calls this from a microtask
// after queueing the network loads, so canvas draws don't block the
// kick-off of XHRs and dynamic-imports.
export function generateTextures(scene: Phaser.Scene): void {
  generateDoorsBboxTexture(scene);
  generateBulletTexture(scene);
}
