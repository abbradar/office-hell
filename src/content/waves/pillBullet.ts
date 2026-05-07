import { BULLET_RADIUS } from '../../config';
import { EntityKind } from '../../script/types';

// "Vitamin pill" bullet — flies straight along its launch velocity. No
// script; the default Arcade body integration carries it. Aiming is the
// firer's job (e.g. `aimed(...)` from patterns.ts). Hitbox is the standard
// bullet radius — visually a stretched 10×6 capsule, but the threat circle
// stays small and forgiving.
export const pillBullet = new EntityKind({
  sprite: 'pillBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});
