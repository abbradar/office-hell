import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { markWave, suspendRunning, waitSeconds } from '../../script/stage';
import { type EntityKind, type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { borderedBullets, redBorderedBullet } from '../kinds';
import { drinkBullet } from './drinkBullet';

// Friday Party: a normie middle-manager descends with the rest of the team
// in tow to drag the player off to a "mandatory team-building" night out.
// His ten underlings each pull a distinct body model + a distinct
// bordered-bullet colour so the squad reads as a varied office crowd
// rather than ten clones in matching jumpsuits. They fight differently:
//   - manager fires sinusoidal "drink" streams the player has to dance
//     around (graze the crests, do not cross the wave),
//   - the underlings fire wide, slow rings of bullets in their personal
//     border colour so the floor between drink-stream bursts is a
//     patchwork of overlapping rings.
// At t = 3 s into the wave a single red-bordered hexagonal-grid barrage
// drops from above — one-shot tax for the player parking too long in
// the upper half of the field while the squad is still arriving.

const ENTRY_SPEED = 100;

const MANAGER_X = GAME_W * 0.5;
const MANAGER_Y = 70;

const MANAGER_HP = 60;
const MEMBER_HP = 10;

// Drink-stream geometry. drinkBullet is 8×10 (sprite_h = 10); the gap
// between successive bullets is `sprite_h + 2 = 12 px` (user spec). At
// DRINK_STREAM_SPEED the center-to-center stride is therefore
// `sprite_h + (sprite_h + 2) = 22 px`, which translates to a 6-physics-
// frame wait between spawns at the 60 fps simulation clock.
//
// Length in flight ≈ 28 bullets × 22 px = 616 px, dense enough to forbid
// head-on crossing.
const DRINK_BULLET_H = 10;
const DRINK_STREAM_GAP_PX = DRINK_BULLET_H + 2;
const DRINK_STREAM_BULLETS = 28;
const DRINK_STREAM_SPEED = 220;
const DRINK_STREAM_GAP = Math.max(1, Math.round(((DRINK_BULLET_H + DRINK_STREAM_GAP_PX) * 60) / DRINK_STREAM_SPEED));
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

// Underlings: small, slow, randomly-rotated rings of their personal
// border-coloured bullet. RING_GAP is well above the manager's burst
// cycle so the rings don't overlap with the drink streams in a way
// that closes off every escape lane simultaneously.
const RING_COUNT = 8;
const RING_SPEED = 110;
const RING_GAP = 130;

// Red-bordered hex-row barrage. Three single-row drops fall in from
// above the playfield at random X positions, 6 s apart, starting at
// t = 3 s. Each row is `HEX_WAVE_COLS` bullets at `HEX_WAVE_STRIDE_X`
// stride — the row spans `HEX_WAVE_WIDTH_PX` between the first and
// last bullet centres (user spec: 48 px). Bullets fall straight down
// at HEX_WAVE_SPEED. The cross-barrage half-stride offset that the
// user's sketch alternates beat-to-beat is dropped here because the
// per-barrage X is already random — there's no tessellation to
// preserve.
const HEX_WAVE_FIRST_DELAY_S = 3;
const HEX_WAVE_INTERVAL_S = 6;
const HEX_WAVE_REPEATS = 3;
const HEX_WAVE_WIDTH_PX = 48;
const HEX_WAVE_COLS = 3;
const HEX_WAVE_STRIDE_X = HEX_WAVE_WIDTH_PX / (HEX_WAVE_COLS - 1);
const HEX_WAVE_SPEED = 90;
const HEX_WAVE_TOP_Y = -8;
// Margin between the row's bounding box and the playfield edges, so a
// random x0 keeps the whole barrage inside the corridor instead of
// clipping a bullet into / behind a wall.
const HEX_WAVE_EDGE_MARGIN = 16;

function spawnRedHexWave(self: Entity): void {
  shoot();
  const stage = self.stage;
  // x0 = leftmost bullet centre. Sample uniformly inside the band
  // that keeps the rightmost centre (x0 + HEX_WAVE_WIDTH_PX) inside
  // the corridor.
  const xMin = HEX_WAVE_EDGE_MARGIN;
  const xMax = GAME_W - HEX_WAVE_WIDTH_PX - HEX_WAVE_EDGE_MARGIN;
  const x0 = xMin + stage.nextRandom() * (xMax - xMin);
  for (let col = 0; col < HEX_WAVE_COLS; col++) {
    const x = x0 + col * HEX_WAVE_STRIDE_X;
    self.spawn(redBorderedBullet, x, HEX_WAVE_TOP_Y, 0, HEX_WAVE_SPEED);
  }
}

function* drinkStream(self: Entity): Generator<ScriptYield, void, void> {
  // Lock heading at the start of the stream — each bullet's sine motion is
  // overlaid on this same forward direction, so the wave shape forms in
  // space as bullets at successive ages occupy successive sine phases.
  const [vx, vy] = self.vectorToPlayer(DRINK_STREAM_SPEED);
  for (let i = 0; i < DRINK_STREAM_BULLETS; i++) {
    if (i % DRINK_STREAM_SFX_EVERY === 0) shoot();
    self.spawn(drinkBullet, self.x, self.y, vx, vy);
    yield DRINK_STREAM_GAP;
  }
}

function* managerScript(self: Entity) {
  yield* moveTo(self, MANAGER_X, MANAGER_Y, ENTRY_SPEED);
  self.say(MANAGER_INTRO_LINE, MANAGER_INTRO_SAY);
  yield MANAGER_INTRO_HOLD;

  while (true) {
    self.say(MANAGER_BURST_LINE, MANAGER_BURST_SAY);
    for (let i = 0; i < STREAMS_PER_BURST; i++) {
      yield* drinkStream(self);
      yield BETWEEN_STREAMS;
    }
    yield BETWEEN_BURSTS;
  }
}

// Each underling walks in to its assigned y, waits out a per-spawn offset so
// the squad's rings desync into a continuous drift, then cycles rings of its
// personal bullet kind until it dies. Base angle nudges by a bullet-step
// each cycle so the ring slowly rotates and the player can't memorise a
// fixed safe lane.
function makePartyMemberScript(targetY: number, fireOffset: number, bulletKind: EntityKind): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, targetY, ENTRY_SPEED);
    yield fireOffset;
    let baseAngle = Math.random() * Math.PI * 2;
    while (true) {
      ring(self, RING_COUNT, bulletKind, RING_SPEED, baseAngle);
      baseAngle += Math.PI / RING_COUNT;
      yield RING_GAP;
    }
  };
}

export const normieManager = new HPEntityKind({
  sprite: 'whiteMale1',
  hitboxRadius: 16,
  hp: MANAGER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: managerScript,
});

export const partyMember = new HPEntityKind({
  sprite: 'whiteMale1',
  hitboxRadius: 16,
  hp: MEMBER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Squad layout: manager dead-centre, two flanking groups of five built from a
// back row (y=95) and a front row (y=145). Each slot pins a unique character
// sheet and a unique bordered-bullet colour so the squad reads as the office
// at large rather than ten clones, and each underling's ring is a different
// hue from its neighbours. fireOffset desyncs each member's ring cycle so
// the floor below the manager is a continuous churn rather than a
// synchronised pulse.
type MemberSpec = {
  x: number;
  y: number;
  fireOffset: number;
  sprite: string;
  // Index into `borderedBullets` for this underling's bullet kind.
  // Range 0..9. Slot 0 is the red one — keep at least one assignment
  // pointing at it so the rings include the hex-wave colour.
  bulletIdx: number;
};

const MEMBERS: readonly MemberSpec[] = [
  { x: 60, y: 95, fireOffset: 30, sprite: 'whiteFemale1', bulletIdx: 1 },
  { x: 120, y: 95, fireOffset: 80, sprite: 'blackMale1', bulletIdx: 2 },
  { x: 35, y: 145, fireOffset: 0, sprite: 'blackFemale1', bulletIdx: 3 },
  { x: 95, y: 145, fireOffset: 50, sprite: 'sales', bulletIdx: 4 },
  { x: 155, y: 145, fireOffset: 100, sprite: 'sysop', bulletIdx: 5 },
  { x: GAME_W - 60, y: 95, fireOffset: 60, sprite: 'hr', bulletIdx: 6 },
  { x: GAME_W - 120, y: 95, fireOffset: 110, sprite: 'overslept', bulletIdx: 7 },
  { x: GAME_W - 35, y: 145, fireOffset: 20, sprite: 'fashionExpert', bulletIdx: 8 },
  { x: GAME_W - 95, y: 145, fireOffset: 70, sprite: 'vacationItaly', bulletIdx: 9 },
  { x: GAME_W - 155, y: 145, fireOffset: 120, sprite: 'whiteMale1', bulletIdx: 0 },
];

export function* fridayPartyWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'friday party');
  self.stage.scheduleMultDrop('regular');
  yield* suspendRunning(self, function* () {
    self.spawn(normieManager, MANAGER_X, -30, 0, 0);
    for (const m of MEMBERS) {
      const kind = borderedBullets[m.bulletIdx] ?? borderedBullets[0];
      if (!kind) continue;
      self.spawn(partyMember, m.x, -30, 0, 0, {
        script: makePartyMemberScript(m.y, m.fireOffset, kind),
        sprite: m.sprite,
      });
    }
    // The squad scripts run autonomously after spawn — we just need
    // to park the wave body long enough to drop the three random-X
    // hex rows on the music-free 6 s cadence (first at t = 3 s, then
    // 9 s, then 15 s). After the last drop we return; the parent
    // `suspendRunning`'s trailing `waitEnemiesClear` drives the rest
    // of the encounter.
    yield* waitSeconds(HEX_WAVE_FIRST_DELAY_S);
    for (let i = 0; i < HEX_WAVE_REPEATS; i++) {
      spawnRedHexWave(self);
      if (i < HEX_WAVE_REPEATS - 1) yield* waitSeconds(HEX_WAVE_INTERVAL_S);
    }
  });
}
