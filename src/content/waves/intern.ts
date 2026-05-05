import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// Stage-globals key gating the intern email-phrase line. Once set, no
// further intern in this stage's lifetime will say it.
const INTERN_EMAIL_SAID = 'internEmailSaid';

// Intern: a low-stakes opener enemy. Walks in from the top, drifts toward the
// side of the screen, lobs a couple of report bullets, and is one-shot.
//
// `side` is the horizontal exit direction: -1 = left, +1 = right.
// `sayEmail` opts the intern in to the "Could you check this email?" line —
// the spawner gates this so only the first intern in each group speaks.
function makeInternScript(side: -1 | 1, sayEmail: boolean): EntityScript {
  return function* (self: Entity) {
    self.setVelocity(0, 110);
    if (sayEmail) {
      self.say('Could you check\nthis email?', 90);
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
  hitboxRadius: 11,
  hp: 2,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// A line of interns trickling in from the top, all aimed at the same exit side.
// The first intern in each line speaks the email phrase, until the
// stage-globals flag is set — flipping that flag mutes every future line.
export function* internLine(
  self: Entity,
  startX: number,
  side: -1 | 1,
  count = 5,
  spacingFrames = 28,
): Generator<ScriptYield, void, void> {
  const allowEmail = !self.stage.globals[INTERN_EMAIL_SAID];
  for (let i = 0; i < count; i++) {
    const sayEmail = allowEmail && i === 0;
    self.spawn(intern, startX, -30, 0, 0, {
      script: makeInternScript(side, sayEmail),
    });
    if (i < count - 1) yield spacingFrames;
  }
}

// Demo wave: two lines, one drifting to each side, staggered so the player
// has to pick a lane to clear first.
export function* internsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'interns');
  yield* internLine(self, GAME_W * 0.25, 1);
  yield 60;
  yield* internLine(self, GAME_W * 0.75, -1);
  // Both lines have had their first speak the email line — silence any
  // future intern lines this stage.
  self.stage.globals[INTERN_EMAIL_SAID] = true;
}
