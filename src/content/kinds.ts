import { BULLET_RADIUS } from '../config';
import { EntityKind } from '../script/types';

export const bullet = new EntityKind({
  sprite: 'bullet',
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
