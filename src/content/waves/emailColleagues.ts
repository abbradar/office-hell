import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { alignDoor, doorY, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';

// Email colleague: appears at one side, lobs a few short aimed email
// streams at the player. Low HP, generous spacing between volleys so
// the player can settle into dodging.
//
// Two flavours of script:
//   - drift: spawns off-screen, drifts in-and-out at constant velocity,
//     firing while moving. Used by emailColleagues2's pinch pairs where
//     the converging motion is the threat.
//   - stationary: slides in to a fixed firing post, fires from a hold,
//     retreats back the way it came. Used by the merged early-stage
//     opener where the threat is the volleys, not the motion.

// Travel speed for both flavours below. For `emailColleagues2`'s pinch
// pairs the drift script walks in for two volleys (~95 frames, ~160 px)
// then turns upward at the same speed for the v2→v3 gap so volley 3
// fires from a point ~100px above the door y. Once that last shot is
// off, EXIT_SPEED takes over and the colleague bolts off the top —
// keeps the wave's tail tight against its 8s slot instead of letting
// a slow drift eat the back half.
const TRAVEL_SPEED = 100;
const EXIT_SPEED = 220;
const SETTLE_FRAMES = 35;
const VOLLEY_COUNT = 3;
const VOLLEY_GAP = 60;
const EMAILS_PER_VOLLEY = 3;
const EMAIL_SPEED = 110;
const EMAIL_SPREAD = Math.PI / 9;

// `side` is travel direction: +1 spawns at left edge moving right; -1 spawns
// at right edge moving left. Aimed volleys track the player either way.
// Pinch pairs (emailColleagues2) spawn at the same y from opposite sides, so
// continuing horizontally would have the two members collide in the middle
// of the corridor. They walk in for two volleys (~1.6s, ~160 px from the
// wall — well clear of centre) then peel upward and fire the last volley
// from the climb. Once turned, both members hold their x: the left member
// exits up the left third, the right exits up the right third, no overlap.
function makeEmailColleagueScript(side: -1 | 1): EntityScript {
  return function* (self: Entity) {
    self.setVelocity(side * TRAVEL_SPEED, 0);
    yield SETTLE_FRAMES;
    aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
    yield VOLLEY_GAP;
    aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
    self.setVelocity(0, -TRAVEL_SPEED);
    yield VOLLEY_GAP;
    aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
    self.setVelocity(0, -EXIT_SPEED);
  };
}

// Distance from the off-screen spawn to the stationary firing post — enough
// to fully clear the bezel and read as "they came on, then stopped". The
// "far" depth is for the first colleague of an in-line pair: it walks
// past the near firing post and stops deeper, leaving the near post free
// for the second colleague to plant at. Reads as a queue from the door
// inward instead of two bodies trying to occupy the same y/x.
const STATIONARY_ENTRY_DX = 80;
const STATIONARY_ENTRY_DX_FAR = 160;
const STATIONARY_HOLD_FRAMES = 12;
// Frames the "far" colleague waits after its last volley before retreating.
// Without this, far retreats while near is still planted at its post and
// crosses the near post on the way out (same y, same speed) — a visible
// pass-through. Only relevant for the horizontal 'back' exit; the 'top'
// variant goes up at distinct x positions so there's nothing to cross.
const STATIONARY_FAR_RETREAT_HOLD = 90;

function makeStationaryEmailColleagueScript(
  side: -1 | 1,
  dx: number = STATIONARY_ENTRY_DX,
  retreatHold = 0,
  exitVia: 'back' | 'top' = 'back',
): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x + side * dx, self.y, TRAVEL_SPEED);
    yield STATIONARY_HOLD_FRAMES;
    for (let i = 0; i < VOLLEY_COUNT; i++) {
      aimed(self, EMAILS_PER_VOLLEY, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
      yield VOLLEY_GAP;
    }
    yield retreatHold;
    // Exit; the pool releases once off-screen.
    if (exitVia === 'top') {
      self.setVelocity(0, -TRAVEL_SPEED);
    } else {
      self.setVelocity(-side * TRAVEL_SPEED, 0);
    }
  };
}

const leftScript = makeEmailColleagueScript(1);
const rightScript = makeEmailColleagueScript(-1);
const stationaryLeftScript = makeStationaryEmailColleagueScript(1);
const stationaryRightScript = makeStationaryEmailColleagueScript(-1);
const stationaryLeftFarScript = makeStationaryEmailColleagueScript(
  1,
  STATIONARY_ENTRY_DX_FAR,
  STATIONARY_FAR_RETREAT_HOLD,
);
const stationaryRightFarScript = makeStationaryEmailColleagueScript(
  -1,
  STATIONARY_ENTRY_DX_FAR,
  STATIONARY_FAR_RETREAT_HOLD,
);
// Pass-1 opener variants exit via the top instead of retreating back across
// the corridor — pass 2 enters from the right at the same y while pass 1 is
// still leaving, and a horizontal retreat puts both groups in the same
// horizontal lane. Going up clears the lane entirely.
const stationaryLeftUpScript = makeStationaryEmailColleagueScript(1, STATIONARY_ENTRY_DX, 0, 'top');
const stationaryLeftFarUpScript = makeStationaryEmailColleagueScript(1, STATIONARY_ENTRY_DX_FAR, 0, 'top');

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
//
// Each pass is two same-side colleagues that route through the same
// door slot — design ys (210, 290 etc.) collapse to the aligned band's
// centre after `doorY` snapping with three doors at 247-spacing. Aligning
// a door near 250 before suspending pins that slot for the wave; the
// other slots end up far enough away that all four design ys map to it.
// The pair enters in line: first uses the "far" script and walks past
// the near firing post, second plants at the standard depth — so they
// queue from the door inward instead of trying to share a post.
const EMAIL_OPENER_UPPER_Y = 250;
export function* emailColleaguesWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues');
  self.stage.scheduleMultDrop('regular');
  yield* alignDoor(self, EMAIL_OPENER_UPPER_Y);
  yield* suspendRunning(self, function* () {
    const PASS_DELAY = 60;
    const PAIR_SPACING = 70;
    const SIDE_GAP = 110;

    // Pass 1 — two left-side colleagues. First walks deeper, second
    // stops at the door-side post; they fire from staggered x at the
    // shared door y. Both exit upward so they don't share a horizontal
    // lane with pass 2's right-side entry, which arrives at the same y
    // before pass 1 has finished retreating across the corridor.
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 250), 0, 0, { script: stationaryLeftFarUpScript });
    yield 130;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 250), 0, 0, { script: stationaryLeftUpScript });
    yield PASS_DELAY;

    // Pass 2 — right pair first (opposite side from pass 1), then left
    // pair. Same in-line treatment within each side.
    self.spawn(emailColleague, sideSpawnX(1), doorY(self, 250), 0, 0, { script: stationaryRightFarScript });
    yield PAIR_SPACING;
    self.spawn(emailColleague, sideSpawnX(1), doorY(self, 250), 0, 0, { script: stationaryRightScript });
    yield SIDE_GAP;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 250), 0, 0, { script: stationaryLeftFarScript });
    yield PAIR_SPACING;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 250), 0, 0, { script: stationaryLeftScript });
  });
}

// Wave 2 — three pinch pairs: each pair has a left and a right spawn arriving
// within a few frames of each other, so the player has to commit to a vertical
// lane between two converging volleys. Pairs are spaced further apart than
// the in-pair beat. Slotted after vacation photos in the stage script.
//
// Drift colleagues fly straight across the corridor at a fixed y, so the
// entry door on one side and the exit door on the other share the same
// panel — both halves of a door slot sit at the same y. Aligning a door
// at the middle of the trio (250) keeps the centre pair on a real door;
// the outer pairs fall to whichever slot is closest.
const EMAIL_PINCH_MID_Y = 250;
export function* emailColleagues2(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'email colleagues 2');
  self.stage.scheduleMultDrop('regular');
  yield* alignDoor(self, EMAIL_PINCH_MID_Y);
  yield* suspendRunning(self, function* () {
    const PAIR_BEAT = 12;
    const BETWEEN_PAIRS = 90;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 200), 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, sideSpawnX(1), doorY(self, 200), 0, 0, {
      script: rightScript,
    });
    yield BETWEEN_PAIRS;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 250), 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, sideSpawnX(1), doorY(self, 250), 0, 0, {
      script: rightScript,
    });
    yield BETWEEN_PAIRS;
    self.spawn(emailColleague, sideSpawnX(-1), doorY(self, 300), 0, 0);
    yield PAIR_BEAT;
    self.spawn(emailColleague, sideSpawnX(1), doorY(self, 300), 0, 0, {
      script: rightScript,
    });
  });
}
