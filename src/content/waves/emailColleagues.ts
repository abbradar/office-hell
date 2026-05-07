import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';

// Email colleague: drifts in from one side, lobs a few short aimed
// email streams, keeps drifting toward the far edge. No dialogue, low HP,
// generous spacing between volleys so the player can settle into dodging.
//
// The same colleague kind backs all three email-colleague waves below;
// each wave just changes count, spawn sides, and rhythm.

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
function makeEmailColleagueScript(side: -1 | 1): EntityScript {
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

const leftScript = makeEmailColleagueScript(1);
const rightScript = makeEmailColleagueScript(-1);

export const emailColleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 12,
  hp: 4,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: leftScript,
});

// Wave 1 — original opener: two left-side colleagues at staggered heights.
export function* emailColleagues1(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues 1');
  yield* suspendRunning(self, function* () {
    self.spawn(emailColleague, SPAWN_LEFT_X, 210, 0, 0);
    yield 130;
    self.spawn(emailColleague, SPAWN_LEFT_X, 290, 0, 0);
  });
}

// Wave 2 — twice the count: 2 left + 2 right.
export function* emailColleagues2(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues 2');
  yield* suspendRunning(self, function* () {
    const SPACING = 70;
    const SIDE_GAP = 110;
    self.spawn(emailColleague, SPAWN_LEFT_X, 220, 0, 0);
    yield SPACING;
    self.spawn(emailColleague, SPAWN_LEFT_X, 290, 0, 0);
    yield SIDE_GAP;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 220, 0, 0, {
      script: rightScript,
    });
    yield SPACING;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 290, 0, 0, {
      script: rightScript,
    });
  });
}

// Wave 3 — three pinch pairs: each pair has a left and a right spawn arriving
// within a few frames of each other, so the player has to commit to a vertical
// lane between two converging volleys. Pairs are spaced further apart than
// the in-pair beat. Slotted after vacation photos in the stage script.
export function* emailColleagues3(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues 3');
  yield* suspendRunning(self, function* () {
    const PAIR_BEAT = 12;
    const BETWEEN_PAIRS = 90;
    self.spawn(emailColleague, SPAWN_LEFT_X, 200, 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 200, 0, 0, {
      script: rightScript,
    });
    yield BETWEEN_PAIRS;
    self.spawn(emailColleague, SPAWN_LEFT_X, 250, 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 250, 0, 0, {
      script: rightScript,
    });
    yield BETWEEN_PAIRS;
    self.spawn(emailColleague, SPAWN_LEFT_X, 300, 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 300, 0, 0, {
      script: rightScript,
    });
  });
}
