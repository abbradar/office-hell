import { BULLET_RADIUS } from '../config';
import { EnemyBulletEntityKind, EntityKind } from '../script/types';

export const bullet = new EnemyBulletEntityKind({
  sprite: 'bullet',
  hitboxRadius: BULLET_RADIUS,
});

export const playerBullet = new EntityKind({
  sprite: 'playerBullet',
  // Slightly bigger than the visible 6×16 bullet sprite so the player's
  // shots reward minor positioning errors (Bullet Hell Shmup Design 101:
  // "give the player's shots huge hitboxes").
  hitboxRadius: 5,
  damageClass: ['enemy'],
});
