import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { drinkBullet } from './drinkBullet';

// Friday Party: a normie middle-manager descends with the rest of the team
// in tow to drag the player off to a "mandatory team-building" night out.
// Everyone in the formation shares the manager sprite — a corporate hive —
// but they fight differently:
//   - manager fires sinusoidal "drink" streams the player has to dance
//     around (graze the crests, do not cross the wave),
//   - the underlings fire wide, slow rings of bullets that fill the floor
//     between the manager's bursts so the player can't park on a safe
//     edge for long.

const ENTRY_SPEED = 100;

const MANAGER_X = GAME_W * 0.5;
const MANAGER_Y = 70;

const MANAGER_HP = 60;
const MEMBER_HP = 10;

// Drink stream geometry. 28 small drink bullets fired down the manager's aim
// at a 3-frame stride; drinkBullet's script overlays a lateral sine, so the
// stream reads as a wavy serpent of glasses descending toward the player.
// Length in flight ≈ 28 * 3 / 60 * 220 ≈ 308 px — a bit under half the field
// height, dense enough to forbid head-on crossing.
const DRINK_STREAM_BULLETS = 28;
const DRINK_STREAM_GAP = 3;
const DRINK_STREAM_SPEED = 220;
// Replay shoot SFX every Nth bullet so the stream sounds like a stream
// without saturating the SFX voice cap.
const DRINK_STREAM_SFX_EVERY = 6;

const STREAMS_PER_BURST = 2;
const BETWEEN_STREAMS = 75;
const BETWEEN_BURSTS = 110;

const MANAGER_INTRO_LINE = "It's Friday — mandatory\nteam-building tonight!";
const MANAGER_INTRO_SAY = 160;
const MANAGER_INTRO_HOLD = 180;
const MANAGER_BURST_LINE = 'Cheers, everyone!';
const MANAGER_BURST_SAY = 130;

// Underlings: small, slow, randomly-rotated rings. RING_GAP is well above
// the manager's burst cycle so the rings don't overlap with the drink
// streams in a way that closes off every escape lane simultaneously.
const RING_COUNT = 8;
const RING_SPEED = 110;
const RING_GAP = 130;

function* drinkStream(self: Entity): Generator<ScriptYield, void, void> {
  // Lock heading at the start of the stream — each bullet's sine motion is
  // overlaid on this same forward direction, so the wave shape forms in
  // space as bullets at successive ages occupy successive sine phases.
  const [vx, vy] = self.vectorToPlayer(DRINK_STREAM_SPEED);
  for (let i = 0; i < DRINK_STREAM_BULLETS; i++) {
    if (!self.alive) return;
    if (i % DRINK_STREAM_SFX_EVERY === 0) shoot();
    self.spawn(drinkBullet, self.x, self.y, vx, vy);
    yield DRINK_STREAM_GAP;
  }
}

function* managerScript(self: Entity) {
  yield* moveTo(self, MANAGER_X, MANAGER_Y, ENTRY_SPEED);
  self.say(MANAGER_INTRO_LINE, MANAGER_INTRO_SAY);
  yield MANAGER_INTRO_HOLD;

  while (self.alive) {
    self.say(MANAGER_BURST_LINE, MANAGER_BURST_SAY);
    for (let i = 0; i < STREAMS_PER_BURST; i++) {
      if (!self.alive) return;
      yield* drinkStream(self);
      yield BETWEEN_STREAMS;
    }
    yield BETWEEN_BURSTS;
  }
}

// Each underling walks in to its assigned y, waits out a per-spawn offset so
// the squad's rings desync into a continuous drift, then cycles rings until
// it dies. Base angle nudges by a bullet-step each cycle so the ring slowly
// rotates and the player can't memorise a fixed safe lane.
function makePartyMemberScript(targetY: number, fireOffset: number): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, targetY, ENTRY_SPEED);
    yield fireOffset;
    let baseAngle = Math.random() * Math.PI * 2;
    while (self.alive) {
      ring(self, RING_COUNT, bullet, RING_SPEED, baseAngle);
      baseAngle += Math.PI / RING_COUNT;
      yield RING_GAP;
    }
  };
}

export const normieManager = new EntityKind({
  sprite: 'partyManager',
  hitboxRadius: 16,
  hp: MANAGER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: managerScript,
});

export const partyMember = new EntityKind({
  sprite: 'partyManager',
  hitboxRadius: 16,
  hp: MEMBER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Squad layout: manager dead-centre, two flanking groups of five built from a
// back row (y=95) and a front row (y=145). fireOffset desyncs each member's
// ring cycle so the floor below the manager is a continuous churn rather than
// a synchronised pulse.
type MemberSpec = { x: number; y: number; fireOffset: number };

const MEMBERS: readonly MemberSpec[] = [
  { x: 60, y: 95, fireOffset: 30 },
  { x: 120, y: 95, fireOffset: 80 },
  { x: 35, y: 145, fireOffset: 0 },
  { x: 95, y: 145, fireOffset: 50 },
  { x: 155, y: 145, fireOffset: 100 },
  { x: GAME_W - 60, y: 95, fireOffset: 60 },
  { x: GAME_W - 120, y: 95, fireOffset: 110 },
  { x: GAME_W - 35, y: 145, fireOffset: 20 },
  { x: GAME_W - 95, y: 145, fireOffset: 70 },
  { x: GAME_W - 155, y: 145, fireOffset: 120 },
];

export function* fridayPartyWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'friday party');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    self.spawn(normieManager, MANAGER_X, -30, 0, 0);
    for (const m of MEMBERS) {
      self.spawn(partyMember, m.x, -30, 0, 0, {
        script: makePartyMemberScript(m.y, m.fireOffset),
      });
    }
  });
}
