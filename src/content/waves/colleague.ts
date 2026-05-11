import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { alignDoor, doorY, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { missedCallBullet } from './missedCallBullet';

// Colleague: a mid-screen drive-by that slides in from the side, asks for "a
// quick call", fires a ring of missed-call bullets, then slides back out the
// way it came — dropping more rings while in retreat for any player who didn't
// finish them off. Spawn x picks the side: x < GAME_W/2 → enters from the left
// and exits left; otherwise mirror.

const ENTER_SPEED = 130;
// Retreat is faster than the entry slide so the colleague's exit clears the
// playfield well before the wave's time-slot expires; without this split the
// retreat re-used ENTER_SPEED and the late spawns ran past the slot.
const RETREAT_SPEED = 280;
const ENTER_DX = 195;
// In-line entry depths for clusters of same-side colleagues that all snap
// to the same door y. The first one in a cluster goes "far" (deepest) so
// it sits past the near posts, the next one fills the middle, the last
// stops nearest the door — the player reads them as a queue. Without
// this, the script's fixed ENTER_DX put every cluster member at the same
// (x, y) and they'd visibly walk through each other.
const ENTER_DX_FAR = 250;
const ENTER_DX_MID = 175;
const ENTER_DX_NEAR = 100;
const HOLD_FRAMES = 50;
const RING_COUNT = 12;
const BULLET_SPEED = 130;
const BETWEEN_RINGS = 35;
const RETREAT_RINGS = 2;
// Pre-retreat hold for cluster members. The numbers are tuned so that
// the deepest member retreats latest and the shallowest first, with all
// three converging close enough in time that they retreat in parallel —
// which keeps the inter-member gap constant during exit instead of the
// far one catching up to the near one's post. Values come from the
// triplet's spawn schedule (50f, 60f gaps): far ready ~41f before near,
// mid ready ~25f before near, so those are the holds that line them up.
const FAR_RETREAT_HOLD = 41;
const MID_RETREAT_HOLD = 25;
// Extra hold tacked onto every colleague before retreat. Pads each enemy's
// time-on-screen by 2s so the wave fills its slot — the slot grew by 2s
// when email-colleagues handed time over, and this is where the slack
// went. Applied uniformly so cluster alignment (FAR/MID/NEAR holds) is
// untouched.
const BEFORE_RETREAT_HOLD = 120;

function makeColleagueScript(depth: number, retreatHold = 0): EntityScript {
  return function* (self: Entity) {
    const fromLeft = self.x < GAME_W / 2;
    const dir = fromLeft ? 1 : -1;

    yield* moveTo(self, self.x + dir * depth, self.y, ENTER_SPEED);

    self.say('Got a quick call?', HOLD_FRAMES);
    yield HOLD_FRAMES;

    ring(self, RING_COUNT, missedCallBullet, BULLET_SPEED, Math.random() * Math.PI * 2);
    yield BETWEEN_RINGS;

    yield BEFORE_RETREAT_HOLD;
    yield retreatHold;
    self.setVelocity(-dir * RETREAT_SPEED, 0);
    for (let i = 0; i < RETREAT_RINGS; i++) {
      ring(self, RING_COUNT, missedCallBullet, BULLET_SPEED, Math.random() * Math.PI * 2);
      yield BETWEEN_RINGS;
    }
  };
}

const colleagueScript = makeColleagueScript(ENTER_DX);
const farColleagueScript = makeColleagueScript(ENTER_DX_FAR, FAR_RETREAT_HOLD);
const midColleagueScript = makeColleagueScript(ENTER_DX_MID, MID_RETREAT_HOLD);
const nearColleagueScript = makeColleagueScript(ENTER_DX_NEAR);

export const colleague = new HPEntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 8,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: colleagueScript,
});

// Demo wave: alternating sides at varying heights so the player has to track
// them across the screen. Each spawn picks the door slot closest to its
// design height — every entry / exit lands at a door panel rather than a
// blank wall. We align a door near the middle of the design range
// (180–360) before suspending so one panel reliably sits in the centre
// band; lower-band spawns then fall to whichever other door slot is
// visible. Without this snap the random pre-wave scroll could put both
// visible panels above or below the design range and the encounter
// would compress into a single y. Tolerance is widened from the default
// 32 to 64 — the wave's spawn ys span ~180 px around the band so a
// looser snap is still readable, and the tighter default would burn up
// to ~1.8s on alignment alone, eating into the time budget needed for
// the late spawns to retreat off-screen before the slot ends.
const COLLEAGUE_BAND_Y = 270;
const COLLEAGUE_BAND_TOLERANCE = 64;
export function* urgentCallWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'urgent call');
  self.stage.scheduleMultDrop('regular');
  yield* alignDoor(self, COLLEAGUE_BAND_Y, COLLEAGUE_BAND_TOLERANCE);
  yield* suspendRunning(self, function* () {
    self.spawn(colleague, sideSpawnX(-1), doorY(self, 220), 0, 0);
    yield 80;
    self.spawn(colleague, sideSpawnX(1), doorY(self, 280), 0, 0);
    yield 100;
    self.spawn(colleague, sideSpawnX(-1), doorY(self, 200), 0, 0);
    self.spawn(colleague, sideSpawnX(1), doorY(self, 340), 0, 0);
    yield 120;
    // From here on the same-side gaps tighten (50f, 60f) and `doorY` snaps
    // every spawn to the aligned door, so the rest of the wave is two
    // clusters that need in-line treatment to read cleanly: a left
    // triplet (far → mid → near) and a right pair (far → near). Without
    // this they all plant on the same x and walk through each other on
    // entry and on retreat.
    self.spawn(colleague, sideSpawnX(-1), doorY(self, 260), 0, 0, { script: farColleagueScript });
    yield 50;
    self.spawn(colleague, sideSpawnX(1), doorY(self, 180), 0, 0, { script: farColleagueScript });
    self.spawn(colleague, sideSpawnX(-1), doorY(self, 360), 0, 0, { script: midColleagueScript });
    yield 60;
    self.spawn(colleague, sideSpawnX(1), doorY(self, 240), 0, 0, { script: nearColleagueScript });
    self.spawn(colleague, sideSpawnX(-1), doorY(self, 320), 0, 0, { script: nearColleagueScript });
  });
}
