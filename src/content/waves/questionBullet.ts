import { BULLET_RADIUS } from '../../config';
import { EntityKind } from '../../script/types';

// "Question" bullet — flies straight along its launch velocity. No script;
// the default Arcade body integration carries it. Used by the oversleeper's
// barrage streams.
export const questionBullet = new EntityKind({
  sprite: 'questionBullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});
