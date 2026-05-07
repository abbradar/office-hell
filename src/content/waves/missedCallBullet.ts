import { BULLET_RADIUS } from '../../config';
import { EntityKind } from '../../script/types';

// "Missed call" bullet — flies straight along its launch velocity. No script;
// the default Arcade body integration carries it.
export const missedCallBullet = new EntityKind({
  sprite: 'missedCall',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});
