import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { alignDoor, checkStageOnce, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { computeDoorYs, DOOR_H, isDoorVisible } from '../doors';
import { emailBullet } from './checkEmail';
import { reportBullet } from './reportBullet';

// All-doors spam: six identikit office bodies step out of every
// visible door panel — three on the left wall, three on the right —
// plant just inside the corridor, and pelt the player with overlapping
// streams of emails and reports. The wave's hook is volume rather than
// any one pattern: a steady aimed cadence from both walls at once. The
// left side fires envelopes (slow, fixed heading), the right fires
// reports (homing at launch), so a player who picks a side to focus
// fire on is also picking which archetype they keep eating from the
// other side. Six low-HP bodies — within reach to clear if the player
// commits.
//
// Door layout: a pre-suspend `alignDoor(self, CENTER_Y)` pins the
// middle slot near the playfield's vertical midpoint, which puts the
// outer two slots near CENTER_Y ± DOOR_SPACING (≈ 83 and 577 with the
// standard 247-spacing). All three slots are then visible at every
// scroll position the default tolerance allows, so the wave reliably
// spawns six bodies rather than four when the corridor's prior
// scrolling left a door half-off the top or bottom.

const ENTRY_SPEED = 110;
// x distance from the side wall to plant at. PLANT_INSET = 60 puts the
// left line at x = 60 (well inside the 18-px wall) and mirrors to x =
// 340 on the right, leaving the corridor's middle ~280 px clear as the
// dodging band.
const PLANT_INSET = 60;
const RETREAT_SPEED = 240;

const STREAM_COUNT = 8;
// Frames between consecutive shots in a stream. At 22f ≈ 0.37s the
// cadence reads as "they're typing fast", and `aimed` re-aims at the
// player on every shot, so a player drifting sideways fans the stream
// into a small spread rather than a tight column.
const STREAM_GAP = 22;
const STREAM_INIT_DELAY = 30;
// Frames between the last stream shot and the retreat. Without this
// pad the side-step happens on the same frame as the final bullet and
// the exit reads as a flinch; 30f gives the stream a visible tail-off.
const POST_STREAM_HOLD = 30;

const EMAIL_SPEED = 110;
const REPORT_SPEED = 170;

// Where the middle door's centre is pinned before the wave suspends.
// The two outer doors fall to roughly CENTER_Y ± 247 with the standard
// three-slot spacing — both inside the playfield, so all six spawn
// points are real door panels.
const CENTER_Y = 330;

// Minimum y for the wave's one speech bubble. A two-line bubble needs
// ~95 px of headroom above its anchor to fit cleanly under the HUD
// header (see docs/stage-design.md → "Speakers must leave room for the
// bubble"). The top door at y ≈ 83 fails that; the middle and bottom
// doors clear it easily.
const SPEAKER_MIN_Y = 130;

function makeCoworkerScript(side: -1 | 1, fires: 'email' | 'report'): EntityScript {
  return function* (self: Entity) {
    const targetX = side < 0 ? PLANT_INSET : GAME_W - PLANT_INSET;
    yield* moveTo(self, targetX, self.y, ENTRY_SPEED);

    // First coworker to reach plant with enough headroom for the
    // bubble claims the line. Short-circuit keeps the flag unclaimed
    // for the top-door pair — they skip `checkStageOnce` entirely, so
    // the mid-row pair (which lands ~14f later) is the one that takes
    // it.
    if (self.y > SPEAKER_MIN_Y && checkStageOnce(self, 'allDoorsSpam:greeted')) {
      self.say('Just looping you in.', 100);
    }

    yield STREAM_INIT_DELAY;
    const kind = fires === 'email' ? emailBullet : reportBullet;
    const speed = fires === 'email' ? EMAIL_SPEED : REPORT_SPEED;
    for (let i = 0; i < STREAM_COUNT; i++) {
      aimed(self, 1, kind, speed);
      yield STREAM_GAP;
    }
    yield POST_STREAM_HOLD;

    // Retreat back out the wall they came in through. Their y hasn't
    // changed since they planted, and `stage.running` is false so the
    // door panel hasn't moved either — the retreat lines them up with
    // the same door slot.
    self.setVelocity(-side * RETREAT_SPEED, 0);
  };
}

const leftEmailScript = makeCoworkerScript(-1, 'email');
const rightReportScript = makeCoworkerScript(1, 'report');

export const spamCoworker = new HPEntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 8,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

export function* allDoorsSpamWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'all-doors spam');
  yield* alignDoor(self, CENTER_Y);
  yield* suspendRunning(self, function* () {
    // 14f between rows so the three pairs roll in top-to-bottom
    // instead of arriving as one six-stream wall. The same-y left /
    // right pair share a beat — the pair is the unit, the rows
    // stagger.
    const ROW_BEAT = 14;

    const doorYs: number[] = [];
    for (const top of computeDoorYs(self.stage.bgScrollY)) {
      if (!isDoorVisible(top)) continue;
      doorYs.push(top + DOOR_H / 2);
    }
    doorYs.sort((a, b) => a - b);

    for (const [i, y] of doorYs.entries()) {
      self.spawn(spamCoworker, sideSpawnX(-1), y, 0, 0, { script: leftEmailScript });
      self.spawn(spamCoworker, sideSpawnX(1), y, 0, 0, { script: rightReportScript });
      if (i < doorYs.length - 1) yield ROW_BEAT;
    }
  });
}
