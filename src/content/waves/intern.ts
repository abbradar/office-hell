import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed } from '../../script/patterns';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// Intern: a low-stakes opener enemy. Walks in from the top, drifts toward the
// side of the screen, lobs a couple of report bullets, and is one-shot.
//
// `side` is the horizontal exit direction: -1 = left, +1 = right.
// `talks` is set on the lead of a line so only the first one asks the question.
function makeInternScript(side: -1 | 1, talks: boolean): EntityScript {
  return function* (self: Entity) {
    self.setVelocity(0, 110);
    if (talks) self.say('Help me with a report?', 90);
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
  hitboxRadius: 11,
  hp: 2,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// A line of interns trickling in from the top, all aimed at the same exit side.
// Only the lead intern asks the question — the rest are silent followers.
export function* internLine(
  self: Entity,
  startX: number,
  side: -1 | 1,
  count = 5,
  spacingFrames = 28,
): Generator<ScriptYield, void, void> {
  for (let i = 0; i < count; i++) {
    self.spawn(intern, startX, -30, 0, 0, {
      script: makeInternScript(side, i === 0),
    });
    if (i < count - 1) yield spacingFrames;
  }
}

// Demo wave: two lines, one drifting to each side, staggered so the player
// has to pick a lane to clear first.
export function* internsWave(self: Entity): Generator<ScriptYield, void, void> {
  yield* internLine(self, GAME_W * 0.25, 1);
  yield 60;
  yield* internLine(self, GAME_W * 0.75, -1);
}
