import { BULLET_RADIUS } from '../config';
import { MultDropKind } from '../script/score';
import { EnemyBulletEntityKind, EntityKind, type EntityTier } from '../script/types';
import {
  BLUE_EXPLOSION_KEY,
  BLUE_LONGER_DROPLET_KEY,
  EMAIL_BORDERED_KEY,
  GREED_DIAMOND_XS_KEY,
  LAVA_DROPLET_HARD_KEY,
  MULT_DROP_KEY,
  RED_CROSS_KEY,
  RED_DIAMOND_MD_KEY,
  RED_DROPLET_HARD_KEY,
  RED_EXPLOSION_KEY,
  SMALL_RED_DROPLET_KEY,
  YELLOW_DIAMOND_SM_KEY,
} from './textures';

export const bullet = new EnemyBulletEntityKind({
  sprite: 'bullet',
  hitboxRadius: BULLET_RADIUS,
});

export const redBullet = new EntityKind({
  sprite: 'redBullet',
  hitboxRadius: BULLET_RADIUS,
  damageClass: ['player'],
  damagedByClass: [],
});

export const yellowBullet = new EntityKind({
  sprite: 'yellowBullet',
  hitboxRadius: BULLET_RADIUS,
  damageClass: ['player'],
  damagedByClass: [],
});

export const orangeBullet = new EntityKind({
  sprite: 'orangeBullet',
  hitboxRadius: BULLET_RADIUS,
  damageClass: ['player'],
  damagedByClass: [],
});

export const playerBullet = new EntityKind({
  sprite: 'playerBullet',
  // Slightly bigger than the visible 6×16 bullet sprite so the player's
  // shots reward minor positioning errors (Bullet Hell Shmup Design 101:
  // "give the player's shots huge hitboxes").
  hitboxRadius: 5,
  damageClass: ['enemy'],
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
  damageClass: ['player'],
  damagedByClass: [],
});

// Small red droplet — 11×8 directional bullet. Sprite art is drawn
// pointing right at rotation 0; `rotateToVelocity: true` makes the
// spawner aim it along its travel vector so a ring of droplets fans
// outward with each droplet "leading" in its direction of motion.
// Hitbox is a circle of radius 3 — the droplet's body sits centered
// in the sprite bounds, so a slightly smaller-than-bbox circle
// matches the visible blob without clipping the tail.
export const redDroplet = new EntityKind({
  sprite: SMALL_RED_DROPLET_KEY,
  hitboxRadius: 3,
  damageClass: ['player'],
  damagedByClass: [],
  rotateToVelocity: true,
});

// Red cross — 13×13 square sprite used as the line-stroke bullet on
// the boss. Square hitbox of half-side 5 covers the cross arms
// without overclaiming the (transparent) corners of the bounding
// box. Non-directional, so no `rotateToVelocity`.
export const redCross = new EntityKind({
  sprite: RED_CROSS_KEY,
  hitboxRadius: 5,
  hitboxShape: 'square',
  damageClass: ['player'],
  damagedByClass: [],
});

// Blue longer droplet — 15×9 directional bullet, same contract as
// `redDroplet` (sprite drawn pointing right at rotation 0). Used
// as the foreground / lead voice on the boss's fan-spiral pattern.
export const blueLongerDroplet = new EntityKind({
  sprite: BLUE_LONGER_DROPLET_KEY,
  hitboxRadius: 3,
  damageClass: ['player'],
  damagedByClass: [],
  rotateToVelocity: true,
});

// Red diamond (medium) — 15×15 square sprite. Square hitbox of
// half-side 5 fits inside the diamond's visible outline (the
// transparent corners of the bbox don't kill).
export const redDiamondMd = new EntityKind({
  sprite: RED_DIAMOND_MD_KEY,
  hitboxRadius: 5,
  hitboxShape: 'square',
  damageClass: ['player'],
  damagedByClass: [],
});

// Yellow diamond (small) — 13×13 square sprite. Slightly smaller
// hitbox than `redDiamondMd` to match its smaller visible blob.
export const yellowDiamondSm = new EntityKind({
  sprite: YELLOW_DIAMOND_SM_KEY,
  hitboxRadius: 4,
  hitboxShape: 'square',
  damageClass: ['player'],
  damagedByClass: [],
});

// Green diamond (extra small) — 7×7 square sprite. Used by the
// top-assistant aimed shots: small, fast-readable bullets that fan
// out in a tight 25° cone. (Filename `greed_diamond_xs` preserved
// as-is to match the source asset.)
export const greedDiamondXs = new EntityKind({
  sprite: GREED_DIAMOND_XS_KEY,
  hitboxRadius: 3,
  hitboxShape: 'square',
  damageClass: ['player'],
  damagedByClass: [],
});

// Bordered email envelope — 14×10 source sprite framed by a 1 px
// #ff5e62 border into a 16×12 texture (generated at boot, see
// `generateEmailBorderedTexture` in content/textures.ts). Used by the
// final boss's email volley as a readable accent over the loose
// `emailBullet` sprite. Square hitbox of half-side 5 covers the
// envelope body without claiming the border pixels.
export const emailBordered = new EntityKind({
  sprite: EMAIL_BORDERED_KEY,
  hitboxRadius: 5,
  hitboxShape: 'square',
  damageClass: ['player'],
  damagedByClass: [],
});

// Hard-edged droplet pair — 13×8 directional sprites, source art
// drawn pointing right at rotation 0. `rotateToVelocity: true` aims
// each bullet along its travel vector so an arc fan reads as
// "droplets leading in their direction of motion". Hitbox is a
// circle of radius 3 to match the visible blob without clipping the
// tail.
export const lavaDropletHard = new EntityKind({
  sprite: LAVA_DROPLET_HARD_KEY,
  hitboxRadius: 3,
  damageClass: ['player'],
  damagedByClass: [],
  rotateToVelocity: true,
});

export const redDropletHard = new EntityKind({
  sprite: RED_DROPLET_HARD_KEY,
  hitboxRadius: 3,
  damageClass: ['player'],
  damagedByClass: [],
  rotateToVelocity: true,
});

// Multiplier-drop pickup, three flavours keyed by the tier of the wave
// that emitted them. Visually identical (16×16 white-square-with-green-
// M tile; replace with tier-distinguished art when the wider pass
// arrives); the per-tier difference is the `multLift` MultDropKind reads
// off `tier`. Damage classes are empty so these route into the dedicated
// `stage.drops` group at spawn, not the damages/damagedBy graph — see
// StageManager.spawn and src/docs/scoring-system.md.
//
// Hitbox radius is intentionally larger than the rendered tile (32-px
// square, 2× the sprite). Pickup needs to feel forgiving — the player's
// own hitbox is Touhou-tiny by design, so collecting drops shouldn't
// demand the same pixel precision as bullet-dodging. The body extends
// past the sprite via the standard center offset.
const multDropOpts = {
  sprite: MULT_DROP_KEY,
  hitboxRadius: 16,
  hitboxShape: 'square' as const,
  damageClass: [] as never[],
  damagedByClass: [] as never[],
};
export const multDropRegular = new MultDropKind({ ...multDropOpts, tier: 'regular' });
export const multDropMiniBoss = new MultDropKind({ ...multDropOpts, tier: 'miniBoss' });
export const multDropBoss = new MultDropKind({ ...multDropOpts, tier: 'boss' });

// Tier → drop kind lookup, used by StageManager.scheduleMultDrop to
// pick the right mult-lift on a wave-end drop.
export const MULT_DROP_BY_TIER: Record<EntityTier, MultDropKind> = {
  regular: multDropRegular,
  miniBoss: multDropMiniBoss,
  boss: multDropBoss,
};
