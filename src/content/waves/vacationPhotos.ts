import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { arc, moveTo } from '../../script/patterns';
import { checkStageOnce, markWave, suspendRunning } from '../../script/stage';
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
//
// Exit: all three retreat back the way they came (up off the top).

const ENTRY_SPEED = 100;
const ENTRY_Y = 110;

const BARRAGES = 2;
// 6 bubbles × SAY_FRAMES + entry (84f) + last-fire pre-gap (30f) + exit
// cull (~44f at EXIT_SPEED) all has to fit the wave's 8s timeWave slot
// (480f); that caps SAY_FRAMES at 64. 54 leaves ~0.9s margin and keeps
// each say above 0.9s — fine for the 3–4 word punchlines below.
const SAY_FRAMES = 54;
const PRE_FIRE_GAP = 30;
// Each role talks once per SAY_CYCLE; three roles staggered by SAY_FRAMES means
// the six bubbles play back-to-back with no overlap and no gap.
const SAY_CYCLE = 3 * SAY_FRAMES;
const POST_FIRE_GAP = SAY_CYCLE - PRE_FIRE_GAP;

const PHOTO_COUNT = 11;
const PHOTO_SPEED = 140;
const PHOTO_ARC_FROM = 0;
const PHOTO_ARC_TO = Math.PI;

const EXIT_SPEED = 280;

// Per-role caption arcs: each colleague has her own two lines so the three
// monologues don't echo each other when fans overlap.
const LINES_BY_ROLE = [
  ['Italy was\nAMAZING!', 'And the food!\nLook!'],
  ['Florence —\nso pretty!', 'You HAVE\nto see this!'],
  ['Me at the\nColosseum!', 'Last one —\npromise!'],
] as const;

type Role = 0 | 1 | 2;

function makeVacationScript(role: Role): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    const lines = LINES_BY_ROLE[role];
    for (let i = 0; i < BARRAGES; i++) {
      const intro = checkStageOnce(self, 'vacationPhotos:intro');
      self.say(intro ? 'Look — vacation photos!' : (lines[i] ?? 'Look look!'), SAY_FRAMES);
      yield PRE_FIRE_GAP;
      arc(self, PHOTO_COUNT, reportBullet, PHOTO_SPEED, PHOTO_ARC_FROM, PHOTO_ARC_TO);
      // After the last fan, exit immediately rather than serving out a
      // POST_FIRE_GAP that the wave's killEnemies would just sweep over.
      if (i === BARRAGES - 1) break;
      yield POST_FIRE_GAP;
    }

    // Retreat back the way they came (up off the top); StageManager culls
    // them once they cross the cull margin.
    self.setVelocity(0, -EXIT_SPEED);
  };
}

export const vacationItaly = new EntityKind({
  sprite: 'vacationItaly',
  hitboxRadius: 16,
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
  self.stage.scheduleMultDrop('regular');
  yield* suspendRunning(self, function* () {
    self.spawn(vacationItaly, GAME_W * 0.25, -30, 0, 0, { script: makeVacationScript(0) });
    yield SAY_FRAMES;
    self.spawn(vacationItaly, GAME_W * 0.75, -30, 0, 0, { script: makeVacationScript(1) });
    yield SAY_FRAMES;
    self.spawn(vacationItaly, GAME_W * 0.5, -30, 0, 0, { script: makeVacationScript(2) });
  });
}
