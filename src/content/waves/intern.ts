import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { doorY, exitThroughForwardDoor, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// Stage-globals key gating the intern report-phrase line. The first intern
// to actually reach the say point claims the flag, so any earlier intern
// that died before getting there leaves the line open for the next one.
const INTERN_REPORT_SAID = 'internReportSaid';

// Intern: a low-stakes opener enemy. Walks in from the top, drifts toward the
// side of the screen, lobs a couple of report bullets, and is one-shot.
//
// `side` is the horizontal exit direction: -1 = left, +1 = right. Exit
// routes through the next visible door panel downscreen (the one the
// intern would reach by continuing forward) rather than back through
// whatever door is closest in either direction — these interns are
// marching *into* the office, so retreating up through the door they
// came in would contradict the entry motion.
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
    yield* exitThroughForwardDoor(self, side, 140);
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
// target column, hold long enough to read as a formed line, fire a few
// report bullets, then retreat back through the entry door — `side` is
// the entry direction (-1 from the left wall, +1 from the right). The
// retreat is slower than the march: they came in eager, they leave at
// a "we're done here" amble. The original vertical drop at the same
// speed contradicted the comment promising the interns step back out
// through the same panel; sideways through the entry door reads
// honestly and the slow pace fills the wave's slot rather than
// emptying it the moment the last shot fires.
const SIDES_MARCH_SPEED = 130;
const SIDES_RETREAT_SPEED = 100;
function makeInternMarchScript(targetX: number, y: number, side: -1 | 1): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, targetX, y, SIDES_MARCH_SPEED);
    yield 30;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    yield 35;
    aimed(self, 1, reportBullet, 170);
    self.setVelocity(side * SIDES_RETREAT_SPEED, 0);
  };
}

// Second sub-wave: three pairs of interns enter from both edges
// simultaneously, marching inward to evenly-spaced columns and stopping at
// the same y to form a horizontal line across the playfield. Within each
// side the deepest target is dispatched first so closer-target interns
// don't have to walk through ones already stopped at their column. The
// shared y is the door slot that the wave aligned to before suspending —
// callers pass it in so all six interns step out through the same panel.
function* internSidesLine(self: Entity, y: number): Generator<ScriptYield, void, void> {
  const leftTargets = [170, 110, 50];
  for (const [i, lx] of leftTargets.entries()) {
    self.spawn(intern, sideSpawnX(-1), y, 0, 0, {
      script: makeInternMarchScript(lx, y, -1),
    });
    self.spawn(intern, sideSpawnX(1), y, 0, 0, {
      script: makeInternMarchScript(GAME_W - lx, y, 1),
    });
    if (i < leftTargets.length - 1) yield 12;
  }
}

// Two sub-waves: a line trickling from the top, then a row entering from
// both sides at once and forming a horizontal line across the playfield.
// The sides-line wants its row near the top of the playfield; it picks
// the closest visible door to that target y at wave start. Because
// interns is the very first wave, the corridor's scroll state when this
// runs is whatever the intro left it at (deterministic per playthrough)
// — no need for an `alignDoor` snap, which would only burn slot budget
// for a worst-case wait that doesn't happen here. The line still lands
// on a real door panel; if its y drifts a little run-to-run that's
// acceptable variety, not a bug.
const INTERN_SIDES_TARGET_Y = 90;
export function* internsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'interns');
  yield* suspendRunning(self, function* () {
    yield* internLine(self, GAME_W * 0.25, 1);
    yield 60;
    yield* internSidesLine(self, doorY(self, INTERN_SIDES_TARGET_Y));
  });
}
