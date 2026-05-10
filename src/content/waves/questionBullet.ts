import { BULLET_RADIUS } from '../../config';
import { EnemyBulletEntityKind } from '../../script/types';

// "Question" bullet — flies straight along its launch velocity. No script;
// the default Arcade body integration carries it. Used by the oversleeper's
// barrage streams.
export const questionBullet = new EnemyBulletEntityKind({
  sprite: 'questionBullet',
  hitboxRadius: BULLET_RADIUS,
});
