import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Meeting-call intern — heartier than the opener intern. Drifts in,
// plants in the upper field, then bowls arrowhead-shaped formations of
// video cameras at the player (Zoom call, but make it surveillance)
// before dropping off the bottom. Each barrage stamps a 4-3-2-1
// bowling-pin triangle with the single-pin tip at the front; all
// bullets share one velocity vector aimed at the player so the arrow
// holds its shape and rolls in as a unit.

export const cameraBullet = new EntityKind({
  sprite: 'cameraBullet',
  hitboxRadius: 5,
  hitboxShape: 'square',
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

const ENTRY_SPEED = 110;
const HOLD_FRAMES = 80;

const BARRAGES = 5;
const BARRAGE_GAP = 95;
// Stagger each intern's first barrage by `phase * BARRAGE_PHASE_STEP`
// frames so the four arrows don't fire in unison; the player gets a
// rolling drumbeat of incoming formations instead of one mass volley.
const BARRAGE_PHASE_STEP = 24;

// Bowling-pin triangle: 4 rows of 1-2-3-4 cameras, tip-forward. Row 0
// is the single-pin tip (most forward); row 3 is the four-pin back row.
const ARROW_ROWS = 4;
const ROW_GAP = 18; // depth between adjacent rows (forward axis)
const PIN_GAP = 22; // horizontal spacing between pins within a row
// Push the formation a little ahead of the source along the aim
// direction so the back row doesn't spawn on top of the sprite.
const ARROW_LEAD = 30;
const ARROW_SPEED = 105;

// Some interns sprinkle a couple of plain aimed bullets between camera
// barrages with a touch of angular jitter, so the formation rolls in
// over a steady rain of round bullets.
const RANDOM_SHOTS_PER_GAP = 2;
const RANDOM_JITTER = Math.PI / 8;
const RANDOM_SPEED = 150;

const EXIT_SPEED = 200;

// Roll one bowling-pin arrow at the player: 1+2+3+4 = 10 cameras laid
// out in the forward/sideways frame relative to the aim direction, all
// sharing one velocity. Each camera is rotated to face along the aim
// vector so the lenses point at the player.
function fireBowlingArrow(self: Entity): void {
  if (!self.alive) return;
  shoot();
  const aim = self.angleToPlayer();
  // Forward unit vector (direction of travel) and the perpendicular
  // sideways vector (90° CCW from forward).
  const fx = Math.cos(aim);
  const fy = Math.sin(aim);
  const sx = -fy;
  const sy = fx;
  const vx = fx * ARROW_SPEED;
  const vy = fy * ARROW_SPEED;
  // Center the formation `ARROW_LEAD` ahead of the source. Front row
  // (tip) sits half the formation depth further forward; back row sits
  // half the formation depth behind centre.
  const halfDepth = ((ARROW_ROWS - 1) * ROW_GAP) / 2;
  for (let row = 0; row < ARROW_ROWS; row++) {
    const forward = ARROW_LEAD + halfDepth - row * ROW_GAP;
    const count = row + 1;
    for (let i = 0; i < count; i++) {
      // Centre each row's pins around s = 0: row k has k+1 pins at
      // s = (i - k/2) * PIN_GAP for i = 0..k.
      const sideways = (i - row / 2) * PIN_GAP;
      const wx = self.x + fx * forward + sx * sideways;
      const wy = self.y + fy * forward + sy * sideways;
      const cam = self.spawn(cameraBullet, wx, wy, vx, vy);
      cam.setRotation(aim);
    }
  }
}

function fireRandomShot(self: Entity): void {
  if (!self.alive) return;
  shoot();
  const aim = self.angleToPlayer() + (Math.random() - 0.5) * 2 * RANDOM_JITTER;
  self.spawn(bullet, self.x, self.y, Math.cos(aim) * RANDOM_SPEED, Math.sin(aim) * RANDOM_SPEED);
}

function makeMeetingInternScript(targetX: number, targetY: number, phase: number, shootsRandom: boolean): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, targetX, targetY, ENTRY_SPEED);
    if (phase === 0) self.say("You're on camera!", HOLD_FRAMES);
    yield HOLD_FRAMES + phase * BARRAGE_PHASE_STEP;

    // Slice each gap into RANDOM_SHOTS_PER_GAP + 1 sub-waits so random
    // shots land at evenly spaced moments inside the lull between camera
    // formations rather than all at once.
    const subWait = Math.floor(BARRAGE_GAP / (RANDOM_SHOTS_PER_GAP + 1));
    for (let i = 0; i < BARRAGES; i++) {
      if (!self.alive) return;
      fireBowlingArrow(self);
      let consumed = 0;
      for (let r = 0; r < RANDOM_SHOTS_PER_GAP; r++) {
        yield subWait;
        consumed += subWait;
        if (shootsRandom) fireRandomShot(self);
      }
      yield BARRAGE_GAP - consumed;
    }

    self.setVelocity(0, EXIT_SPEED);
  };
}

export const meetingIntern = new EntityKind({
  sprite: 'checkEmail',
  hitboxRadius: 12,
  hp: 30,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Four interns converge: two from the top, one from each side, planting
// at the corners of an upper-band rectangle so their arrows roll in down
// overlapping lanes. Phase rotates around the four so each arrow lands
// on its own beat instead of arriving simultaneously.
export function* meetingInternsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'meeting interns');
  yield* suspendRunning(self, function* () {
    const TOP_Y = 110;
    const SIDE_Y = 220;
    const SIDE_INSET = 80;
    // Phases 1 and 3 (one top, one side) sprinkle plain aimed bullets
    // between their camera barrages so the encounter isn't a pure
    // formation-dodge — there's always a stray round to track.
    // TODO(shmup-design): each pair below currently spawns on the same
    // frame. Per "Bullet Hell Shmup Design 101", two high-HP enemies
    // appearing simultaneously force a snap triage decision the player
    // can't reason about. Consider staggering each pair by ~0.4s so one
    // enters, then the other — keeping the formation but making it
    // readable. Skipped for now: balance / playtest implications.
    self.spawn(meetingIntern, GAME_W * 0.3, -30, 0, 0, {
      script: makeMeetingInternScript(GAME_W * 0.3, TOP_Y, 0, false),
    });
    self.spawn(meetingIntern, GAME_W * 0.7, -30, 0, 0, {
      script: makeMeetingInternScript(GAME_W * 0.7, TOP_Y, 1, true),
    });
    yield 30;
    self.spawn(meetingIntern, -30, SIDE_Y, 0, 0, {
      script: makeMeetingInternScript(SIDE_INSET, SIDE_Y, 2, false),
    });
    self.spawn(meetingIntern, GAME_W + 30, SIDE_Y, 0, 0, {
      script: makeMeetingInternScript(GAME_W - SIDE_INSET, SIDE_Y, 3, true),
    });
  });
}
