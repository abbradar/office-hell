import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// Stage-globals key gating the intern report-phrase line. The first intern
// to actually reach the say point claims the flag, so any earlier intern
// that died before getting there leaves the line open for the next one.
const INTERN_REPORT_SAID = 'internReportSaid';

// Intern: a low-stakes opener enemy. Walks in from the top, drifts toward the
// side of the screen, lobs a couple of report bullets, and is one-shot.
//
// `side` is the horizontal exit direction: -1 = left, +1 = right.
function makeInternScript(side: -1 | 1): EntityScript {
  return function* (self: Entity) {
    self.setVelocity(0, 110);
    if (!self.stage.globals[INTERN_REPORT_SAID]) {
      self.stage.globals[INTERN_REPORT_SAID] = true;
      self.say('Can you help\nwith this report?', 90);
    }
    yield 50;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    self.setVelocity(side * 140, 40);
    aimed(self, 1, reportBullet, 170);
    yield 55;
    aimed(self, 1, reportBullet, 170);
  };
}

export const intern = new EntityKind({
  sprite: 'checkEmail',
  hitboxRadius: 16,
  hp: 2,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// A line of interns trickling in from the top, all aimed at the same exit
// side. The script itself gates the report-phrase line via stage globals,
// so the first intern that survives to speak claims it.
export function* internLine(
  self: Entity,
  startX: number,
  side: -1 | 1,
  count = 5,
  spacingFrames = 28,
): Generator<ScriptYield, void, void> {
  for (let i = 0; i < count; i++) {
    self.spawn(intern, startX, -30, 0, 0, {
      script: makeInternScript(side),
    });
    if (i < count - 1) yield spacingFrames;
  }
}

// Per-intern script for the second sub-wave: march straight across to a
// target column, hold long enough to read as a formed line, fire a couple
// of report bullets, then drop off the bottom.
function makeInternMarchScript(targetX: number, y: number): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, targetX, y, 130);
    yield 30;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    yield 30;
    self.setVelocity(0, 100);
  };
}

// Second sub-wave: three pairs of interns enter from both edges
// simultaneously, marching inward to evenly-spaced columns and stopping at
// the same y to form a horizontal line across the playfield. Within each
// side the deepest target is dispatched first so closer-target interns
// don't have to walk through ones already stopped at their column.
function* internSidesLine(self: Entity): Generator<ScriptYield, void, void> {
  const y = 90;
  const leftTargets = [170, 110, 50];
  for (const [i, lx] of leftTargets.entries()) {
    self.spawn(intern, -30, y, 0, 0, {
      script: makeInternMarchScript(lx, y),
    });
    self.spawn(intern, GAME_W + 30, y, 0, 0, {
      script: makeInternMarchScript(GAME_W - lx, y),
    });
    if (i < leftTargets.length - 1) yield 12;
  }
}

// Two sub-waves: a line trickling from the top, then a row entering from
// both sides at once and forming a horizontal line across the playfield.
export function* internsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'interns');
  yield* suspendRunning(self, function* () {
    yield* internLine(self, GAME_W * 0.25, 1);
    yield 60;
    yield* internSidesLine(self);
  });
}
