import { BULLET_RADIUS } from '../../config';
import { EnemyBulletEntityKind } from '../../script/types';

// "Missed call" bullet — flies straight along its launch velocity. No script;
// the default Arcade body integration carries it.
export const missedCallBullet = new EnemyBulletEntityKind({
  sprite: 'missedCall',
  hitboxRadius: BULLET_RADIUS,
});
