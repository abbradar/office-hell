import type { Entity } from '../../entities/Entity';
import { aimed } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';

// First-real-enemy colleague: drifts in from the left, lobs a few short aimed
// email streams, keeps drifting right until offscreen. No dialogue, low HP,
// generous spacing between volleys so the player can settle into dodging.

const TRAVEL_SPEED = 80;
const SETTLE_FRAMES = 35;
const VOLLEY_COUNT = 3;
const VOLLEY_GAP = 60;
const EMAILS_PER_VOLLEY = 3;
const EMAIL_SPEED = 110;
const EMAIL_SPREAD = Math.PI / 9;

function* firstEmailColleagueScript(self: Entity) {
  self.setVelocity(TRAVEL_SPEED, 0);
  yield SETTLE_FRAMES;
  for (let i = 0; i < VOLLEY_COUNT; i++) {
    aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
    yield VOLLEY_GAP;
  }
  // Keep drifting; pool releases the entity once it's fully off the right edge.
}

export const firstEmailColleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 12,
  hp: 4,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: firstEmailColleagueScript,
});

// Two colleagues entering from the left at different heights, spaced so the
// player can clear (or at least pressure) the first before the second's
// volleys arrive.
export function* firstEmailColleagues(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'first email colleagues');
  self.spawn(firstEmailColleague, -30, 210, 0, 0);
  yield 130;
  self.spawn(firstEmailColleague, -30, 290, 0, 0);
}
