import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo, ring } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { reportBullet } from './reportBullet';

// Sales + Important Client: a paired ordinary wave with distinct attack
// identities.
//   - Sales fires expanding rings of bullets — the "circle back" archetype.
//   - Client fires aimed clouds of slightly-homing bullets (reportBullet);
//     each bullet curves toward the player on its own, so a static dodge
//     leaks while drifting laterally tends to clear them.
//
// Both scripts share PHASE_A_* and PHASE_B_* timings so the pair pulses on
// the same beat, with the client's intro 50 frames behind to interleave.
// One pass through Phase A → Phase B, then both retreat downward — the
// surrounding waves (IT Admin, Janitor) also exit that way.

const ENTRY_SPEED = 60;
// Bubble manager flips a two-line bubble (h≈50 with padding) below the
// speaker once `target.y < ~92` — keep ENTRY_Y comfortably above that so
// the announcement bubbles render upward into open space, not behind the
// pair on top of their own bullet origins.
const ENTRY_Y = 130;

const SALES_X = GAME_W * 0.3;
const CLIENT_X = GAME_W * 0.7;

const HOLD_AFTER_TALK = 60;

// Shared phase pacing. Phase A: 4 volleys × 26f = 104f. Phase B: 5 volleys ×
// 24f = 120f. PHASE_GAP separates A and B. Same totals on both scripts.
const PHASE_A_REPEATS = 4;
const PHASE_A_GAP = 26;
const PHASE_B_REPEATS = 5;
const PHASE_B_GAP = 24;
const PHASE_GAP = 40;

const EXIT_SPEED = 240;

// Sales: rings.
const RING_COUNT_A = 18;
const RING_SPEED_A = 130;
const RING_COUNT_B = 22;
const RING_SPEED_B = 110;

// Client: aimed clouds of self-homing bullets. Phase A is tight + frequent;
// phase B is wider + sparser to give the homing room to actually steer.
const CLOUD_SPEED = 180;
const CLOUD_COUNT_A = 6;
const CLOUD_SPREAD_A = Math.PI / 6;
const CLOUD_COUNT_B = 4;
const CLOUD_SPREAD_B = Math.PI / 3;

function* salesScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  self.say("Brew her some coffee.\nShe's an important client.", 130);
  yield 130;
  yield HOLD_AFTER_TALK;

  // Phase A: standard rings, slow rotation.
  let baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < PHASE_A_REPEATS; i++) {
    ring(self, RING_COUNT_A, bullet, RING_SPEED_A, baseAngle);
    baseAngle += Math.PI / RING_COUNT_A;
    yield PHASE_A_GAP;
  }
  yield PHASE_GAP;

  // Phase B: denser, slower rings, counter-rotating.
  baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < PHASE_B_REPEATS; i++) {
    ring(self, RING_COUNT_B, bullet, RING_SPEED_B, baseAngle);
    baseAngle -= Math.PI / RING_COUNT_B;
    yield PHASE_B_GAP;
  }

  self.setVelocity(0, EXIT_SPEED);
}

function* clientScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  // Wait through sales's announcement before chiming in.
  yield 130;
  self.say("Yes, I'm important.", 90);
  yield 90;
  yield HOLD_AFTER_TALK - 40;

  // Phase A: tight aimed clouds at the player.
  for (let i = 0; i < PHASE_A_REPEATS; i++) {
    aimed(self, CLOUD_COUNT_A, reportBullet, CLOUD_SPEED, CLOUD_SPREAD_A);
    yield PHASE_A_GAP;
  }
  yield PHASE_GAP;

  // Phase B: wider, sparser clouds — gives the homing more steering room.
  for (let i = 0; i < PHASE_B_REPEATS; i++) {
    aimed(self, CLOUD_COUNT_B, reportBullet, CLOUD_SPEED, CLOUD_SPREAD_B);
    yield PHASE_B_GAP;
  }

  self.setVelocity(0, EXIT_SPEED);
}

export const sales = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 57,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: salesScript,
});

export const importantClient = new EntityKind({
  sprite: 'vip',
  hitboxRadius: 16,
  hp: 57,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: clientScript,
});

// Demo wave: sales drops in first, client follows a beat later from the other
// side of centre — gives sales's "show her around" line a chance to land
// before the client appears to be confirmed.
export function* salesClientWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'sales & client');
  self.stage.scheduleMultDrop('regular');
  yield* suspendRunning(self, function* () {
    self.spawn(sales, SALES_X, -30, 0, 0);
    yield 30;
    self.spawn(importantClient, CLIENT_X, -30, 0, 0);
  });
}
