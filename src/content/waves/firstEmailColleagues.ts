import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';

// First-real-enemy colleague: drifts in from one side, lobs a few short aimed
// email streams, keeps drifting toward the far edge. No dialogue, low HP,
// generous spacing between volleys so the player can settle into dodging.

const TRAVEL_SPEED = 80;
const SETTLE_FRAMES = 35;
const VOLLEY_COUNT = 3;
const VOLLEY_GAP = 60;
const EMAILS_PER_VOLLEY = 3;
const EMAIL_SPEED = 110;
const EMAIL_SPREAD = Math.PI / 9;

const SPAWN_LEFT_X = -30;
const SPAWN_RIGHT_X = GAME_W + 30;

// `side` is travel direction: +1 spawns at left edge moving right; -1 spawns
// at right edge moving left. Aimed volleys track the player either way.
function makeFirstEmailColleagueScript(side: -1 | 1): EntityScript {
  return function* (self: Entity) {
    self.setVelocity(side * TRAVEL_SPEED, 0);
    yield SETTLE_FRAMES;
    for (let i = 0; i < VOLLEY_COUNT; i++) {
      aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
      yield VOLLEY_GAP;
    }
    // Keep drifting; pool releases the entity once it's fully off the far edge.
  };
}

const leftScript = makeFirstEmailColleagueScript(1);
const rightScript = makeFirstEmailColleagueScript(-1);

export const firstEmailColleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 12,
  hp: 4,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: leftScript,
});

// Three-act escalation: x1, x2, x3.
// 1. Two left-side colleagues at staggered heights — the original opener.
// 2. Twice the count: 2 left + 2 right.
// 3. Thrice the count: 3 left + 3 right.
export function* firstEmailColleagues(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'first email colleagues');

  const SPACING = 70;
  const SIDE_GAP = 110;
  const ACT_GAP = 200;

  // Act 1 (x1) — original opener: two from the left.
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 210, 0, 0);
  yield 130;
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 290, 0, 0);

  yield ACT_GAP;

  // Act 2 (x2) — two from the left, two from the right.
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 220, 0, 0);
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 290, 0, 0);
  yield SIDE_GAP;
  self.spawn(firstEmailColleague, SPAWN_RIGHT_X, 220, 0, 0, { script: rightScript });
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_RIGHT_X, 290, 0, 0, { script: rightScript });

  yield ACT_GAP;

  // Act 3 (x3) — three from the left, three from the right.
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 200, 0, 0);
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 250, 0, 0);
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_LEFT_X, 300, 0, 0);
  yield SIDE_GAP;
  self.spawn(firstEmailColleague, SPAWN_RIGHT_X, 200, 0, 0, { script: rightScript });
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_RIGHT_X, 250, 0, 0, { script: rightScript });
  yield SPACING;
  self.spawn(firstEmailColleague, SPAWN_RIGHT_X, 300, 0, 0, { script: rightScript });
}
