import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo, ring } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { HPEntityKind, type ScriptYield } from '../../script/types';
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
// the same beat; the 30-frame spawn offset (see salesClientWave) keeps the
// volleys interleaved. Speech bubbles fire non-blocking alongside the
// shooting so the pair banters through the fight instead of holding the
// player up at the front.

const ENTRY_SPEED = 60;
// Bubble manager flips a two-line bubble (h≈50 with padding) below the
// speaker once `target.y < ~92` — keep ENTRY_Y comfortably above that so
// the announcement bubbles render upward into open space, not behind the
// pair on top of their own bullet origins.
const ENTRY_Y = 130;

const SALES_X = GAME_W * 0.3;
const CLIENT_X = GAME_W * 0.7;

// Sales+client spawn timing. Both enter via moveTo at the same speed,
// so the client trails sales by exactly SPAWN_OFFSET in their local
// timelines.
const SPAWN_OFFSET = 30;

// Sales's intro line — duration of both the bubble and the matching
// `yield` inside salesTalk. Pulled out so clientTalk can derive its
// reply delay from it.
const SALES_SAY_FRAMES = 130;

// Client's reply duration.
const CLIENT_SAY_FRAMES = 110;

// Pause after sales finishes before the client chimes in.
const REPLY_BEAT = 15;

// How long clientTalk waits before saying its line. Aligned so the
// reply lands one REPLY_BEAT after sales's bubble disappears: client's
// `all` block starts SPAWN_OFFSET frames later than sales's, sales's
// bubble lives for SALES_SAY_FRAMES, so the wait inside clientTalk is
// SALES_SAY_FRAMES - SPAWN_OFFSET + REPLY_BEAT.
const CLIENT_REPLY_DELAY = SALES_SAY_FRAMES - SPAWN_OFFSET + REPLY_BEAT;

// Shared phase pacing. Phase A: 16 volleys × 26f = 416f. Phase B: 20 volleys ×
// 24f = 480f. PHASE_GAP separates A and B. Same totals on both scripts.
const PHASE_A_REPEATS = 16;
const PHASE_A_GAP = 26;
const PHASE_B_REPEATS = 20;
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

function* salesTalk(self: Entity): Generator<ScriptYield, void, void> {
  self.say("Brew her some coffee.\nShe's an important client.", SALES_SAY_FRAMES);
  yield SALES_SAY_FRAMES;
}

function* salesShoot(self: Entity): Generator<ScriptYield, void, void> {
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
}

function* salesScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  yield { all: [salesTalk(self), salesShoot(self)] };

  self.setVelocity(0, EXIT_SPEED);
}

function* clientTalk(self: Entity): Generator<ScriptYield, void, void> {
  // Hold until sales's bubble has gone away, plus a small beat.
  yield CLIENT_REPLY_DELAY;
  self.say("Yes, I'm important.", CLIENT_SAY_FRAMES);
  yield CLIENT_SAY_FRAMES;
}

function* clientShoot(self: Entity): Generator<ScriptYield, void, void> {
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
}

function* clientScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  yield { all: [clientTalk(self), clientShoot(self)] };

  self.setVelocity(0, EXIT_SPEED);
}

export const sales = new HPEntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 57,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: salesScript,
});

export const importantClient = new HPEntityKind({
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
    yield SPAWN_OFFSET;
    self.spawn(importantClient, CLIENT_X, -30, 0, 0);
  });
}
