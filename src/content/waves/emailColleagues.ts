import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';

// Email colleague: appears at one side, lobs a few short aimed email
// streams at the player. Low HP, generous spacing between volleys so
// the player can settle into dodging.
//
// Two flavours of script:
//   - drift: spawns off-screen, drifts in-and-out at constant velocity,
//     firing while moving. Used by emailColleagues3's pinch pairs where
//     the converging motion is the threat.
//   - stationary: slides in to a fixed firing post, fires from a hold,
//     retreats back the way it came. Used by the merged early-stage
//     opener where the threat is the volleys, not the motion.

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

// Distance from the off-screen spawn to the stationary firing post — enough
// to fully clear the bezel and read as "they came on, then stopped".
const STATIONARY_ENTRY_DX = 80;
const STATIONARY_HOLD_FRAMES = 12;

function makeStationaryEmailColleagueScript(side: -1 | 1): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x + side * STATIONARY_ENTRY_DX, self.y, TRAVEL_SPEED);
    yield STATIONARY_HOLD_FRAMES;
    for (let i = 0; i < VOLLEY_COUNT; i++) {
      aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
      yield VOLLEY_GAP;
    }
    // Retreat back the way we came; the pool releases once off-screen.
    self.setVelocity(-side * TRAVEL_SPEED, 0);
  };
}

const leftScript = makeEmailColleagueScript(1);
const rightScript = makeEmailColleagueScript(-1);
const stationaryLeftScript = makeStationaryEmailColleagueScript(1);
const stationaryRightScript = makeStationaryEmailColleagueScript(-1);

export const emailColleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 4,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: leftScript,
});

// Merged opener — runs the original wave 1 (two left-side colleagues at
// staggered heights), a short delay, then the original wave 2's pinch
// content but starting from the opposite side: right pair first, then
// left pair. Colleagues hold position for their volleys instead of
// drifting across so the player reads the spawns as discrete posts.
export function* emailColleaguesWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues');
  yield* suspendRunning(self, function* () {
    const PASS_DELAY = 60;
    const PAIR_SPACING = 70;
    const SIDE_GAP = 110;

    // Pass 1 — two left-side colleagues, staggered heights.
    self.spawn(emailColleague, SPAWN_LEFT_X, 210, 0, 0, { script: stationaryLeftScript });
    yield 130;
    self.spawn(emailColleague, SPAWN_LEFT_X, 290, 0, 0, { script: stationaryLeftScript });
    yield PASS_DELAY;

    // Pass 2 — right pair first (opposite side from pass 1), then left pair.
    self.spawn(emailColleague, SPAWN_RIGHT_X, 220, 0, 0, { script: stationaryRightScript });
    yield PAIR_SPACING;
    self.spawn(emailColleague, SPAWN_RIGHT_X, 290, 0, 0, { script: stationaryRightScript });
    yield SIDE_GAP;
    self.spawn(emailColleague, SPAWN_LEFT_X, 220, 0, 0, { script: stationaryLeftScript });
    yield PAIR_SPACING;
    self.spawn(emailColleague, SPAWN_LEFT_X, 290, 0, 0, { script: stationaryLeftScript });
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
