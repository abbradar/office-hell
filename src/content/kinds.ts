import { BULLET_RADIUS } from '../config';
import { EntityKind } from '../script/types';
import { BLUE_EXPLOSION_KEY, RED_EXPLOSION_KEY } from './textures';

export const bullet = new EntityKind({
  sprite: 'bullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

export const redBullet = new EntityKind({
  sprite: 'redBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

export const yellowBullet = new EntityKind({
  sprite: 'yellowBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

export const orangeBullet = new EntityKind({
  sprite: 'orangeBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

export const playerBullet = new EntityKind({
  sprite: 'playerBullet',
  // Slightly bigger than the visible 6×16 bullet sprite so the player's
  // shots reward minor positioning errors (Bullet Hell Shmup Design 101:
  // "give the player's shots huge hitboxes").
  hitboxRadius: 5,
  hp: null,
  damageClass: ['enemy'],
  damagedByClass: [],
});

// Blue-explosion spritesheet entity — a single sprite that the
// spawning pattern (`lineExplosion`, see script/patterns.ts) drives
// frame-by-frame via `setFrame`. No `defaultScript`: the pattern
// owns frame cycle + lifetime explicitly, so frame advances happen
// at the same tick rate as new spawns and the algorithm reads as
// "all existing tiles step to the next frame in place, one new
// tile appears at the front". Damaging while alive; hitbox sized
// to the visible blue core, not the full sprite bounds.
export const blueExplosion = new EntityKind({
  sprite: BLUE_EXPLOSION_KEY,
  hitboxRadius: 5,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

// Red-explosion variant — same drive model as `blueExplosion` (no
// `defaultScript`; the pattern owns the lifecycle), tuned for the
// slower, sparser sweep variant. 8 frames × 16×14, centroid-aligned
// from the original variable-width export so the bright core sits
// on the same column every frame and the cycle doesn't wobble.
export const redExplosion = new EntityKind({
  sprite: RED_EXPLOSION_KEY,
  hitboxRadius: 5,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});
