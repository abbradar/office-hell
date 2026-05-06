import { gameW } from '../../config';
import type { Entity } from '../../entities/Entity';
import { arc, moveTo } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// Vacation Photos: a clutch of colleagues just back from Italy who corner the
// player to insist on showing the album RIGHT NOW. Each walks down to the top
// band, plants themselves, and fans out a wide downward half-circle of
// "photos" between excited captions. Photos reuse the report-bullet sprite for
// now — swap the import when dedicated art lands.
//
// The half-circle sweeps from 0 (rightward) through π/2 (straight down) to π
// (leftward), so the bulk of the spread covers the column directly below the
// firer; the outermost angles are nearly horizontal and bleed off the sides
// without threatening the player. With three of them stacked across the top,
// the fans overlap into a moving lattice rather than a single sweep the
// player can edge around.

const ENTRY_SPEED = 100;
const ENTRY_Y = 110;

const BARRAGES = 3;
const SAY_FRAMES = 90;
const PRE_FIRE_GAP = 30;
// Each role talks once per SAY_CYCLE; three roles staggered by SAY_FRAMES means
// the nine bubbles play back-to-back with no overlap and no gap.
const SAY_CYCLE = 3 * SAY_FRAMES;
const POST_FIRE_GAP = SAY_CYCLE - PRE_FIRE_GAP;

const PHOTO_COUNT = 11;
const PHOTO_SPEED = 140;
const PHOTO_ARC_FROM = 0;
const PHOTO_ARC_TO = Math.PI;

const EXIT_SPEED = 200;

// Per-role caption arcs: each colleague has her own three lines so the three
// monologues don't echo each other when fans overlap.
const LINES_BY_ROLE = [
  ['Italy was\nAMAZING!', 'Tuscany was\na DREAM!', 'And the food!\nLook!'],
  ['Florence —\nso pretty!', 'Look at this\nbasilica!', 'You HAVE\nto see this!'],
  ['Me at the\nColosseum!', 'Venice canals\nat sunset!', 'Last one —\npromise!'],
] as const;

type Role = 0 | 1 | 2;

function makeVacationScript(role: Role): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    const lines = LINES_BY_ROLE[role];
    for (let i = 0; i < BARRAGES; i++) {
      if (!self.alive) return;
      self.say(lines[i] ?? 'Look look!', SAY_FRAMES);
      yield PRE_FIRE_GAP;
      arc(self, PHOTO_COUNT, reportBullet, PHOTO_SPEED, PHOTO_ARC_FROM, PHOTO_ARC_TO);
      yield POST_FIRE_GAP;
    }

    self.setVelocity(0, EXIT_SPEED);
  };
}

export const vacationItaly = new EntityKind({
  sprite: 'vacationItaly',
  hitboxRadius: 12,
  hp: 16,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Demo wave: three colleagues spread across the top — left, right, then centre.
// Spawn gaps equal SAY_FRAMES so the role offset propagates into the say
// schedule: after the identical entry move each role starts saying SAY_FRAMES
// after the previous one, and their per-role SAY_CYCLE keeps them in lockstep.
export function* vacationPhotosWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'vacation photos');
  self.spawn(vacationItaly, gameW() * 0.25, -30, 0, 0, { script: makeVacationScript(0) });
  yield SAY_FRAMES;
  self.spawn(vacationItaly, gameW() * 0.75, -30, 0, 0, { script: makeVacationScript(1) });
  yield SAY_FRAMES;
  self.spawn(vacationItaly, gameW() * 0.5, -30, 0, 0, { script: makeVacationScript(2) });
}
