import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, arc, moveTo, ring } from '../../script/patterns';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
// Circular import: stage.ts also imports shrunkOldManWave from this file. ES
// module live bindings make this safe — these helpers are only invoked at
// runtime, after both modules finish loading.
import { clearScreen, waitForEnemiesCleared } from '../stage';
import { reportBullet } from './reportBullet';

// Stage boss: a sad, retired old man "shrunk" from the company. Security is
// already on his shoulder — he just wants to pass his pile of unfinished
// tasks to someone before he's escorted out. Patterns lean slow and tired —
// drifting paperwork rather than aggressive volleys, but enough of it that
// standing still is not an option.

const ENTRY_SPEED = 60;
const ENTRY_Y = 100;

const PHASE_GAP = 50;

// Phase A — "old reports": tired homing paperwork aimed at the player. Wide
// spread so a single sidestep doesn't dodge the whole cloud, but the homing
// rate is the reportBullet default — drift laterally and they go past.
const PHASE_A_REPEATS = 5;
const PHASE_A_GAP = 32;
const PHASE_A_COUNT = 5;
const PHASE_A_SPEED = 130;
const PHASE_A_SPREAD = Math.PI / 4;

// Phase B — "the filing cabinet": slow rings nudging round a pivot. Bullet
// type, not paper, so the ring reads as office clutter rather than a second
// homing wave on top of phase A's.
const PHASE_B_REPEATS = 5;
const PHASE_B_GAP = 38;
const PHASE_B_RING_COUNT = 16;
const PHASE_B_RING_SPEED = 105;

// Phase C — "the long hand-off": wide downward arcs of paperwork. Slower
// than phase A, no homing (already past the launch window), so this is the
// "safe" phase where the player can mostly drill damage.
const PHASE_C_REPEATS = 5;
const PHASE_C_GAP = 36;
const PHASE_C_COUNT = 9;
const PHASE_C_SPEED = 115;

function* shrunkOldManScript(self: Entity) {
  // Claim the HUD header for this fight; release it on death (covers both
  // natural defeat and forced cleanup via release(), which calls die() too).
  self.pool.bossName = 'Mr. Hodges';
  self.onDeath(() => {
    self.pool.bossName = null;
  });

  // Slow shuffle to anchor — spawned unhittable, so the player can't melt him
  // before he's said his piece. Damage is re-enabled after the dialogue.
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  yield 30;

  const ch = self.pool.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'shrunkOldMan', frame: 1, name: 'Mr. Hodges' },
    lines: [
      { speaker: 'right', text: 'Excuse me… do you have a minute?' },
      { speaker: 'left', text: 'Who are you?' },
      {
        speaker: 'right',
        text: "Hodges. Thirty-one years with the firm. They 'shrunk' my position this morning.",
      },
      {
        speaker: 'right',
        text: 'Security gave me ten minutes to clear my desk. There are still… a few things to hand over.',
      },
      { speaker: 'left', text: "I'm not staying late for someone else's backlog." },
      { speaker: 'right', text: 'Please. I have nowhere else to leave them.' },
    ],
  });

  self.setDamagedByClasses(['enemy']);
  self.say('Just a few old tasks…', 110);
  yield 60;

  while (self.alive) {
    self.say('Could you finish these reports?', 100);
    for (let i = 0; i < PHASE_A_REPEATS; i++) {
      aimed(self, PHASE_A_COUNT, reportBullet, PHASE_A_SPEED, PHASE_A_SPREAD);
      yield PHASE_A_GAP;
    }
    yield PHASE_GAP;

    self.say('And these go in the filing cabinet…', 110);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < PHASE_B_REPEATS; i++) {
      ring(self, PHASE_B_RING_COUNT, bullet, PHASE_B_RING_SPEED, baseAngle);
      baseAngle += Math.PI / PHASE_B_RING_COUNT;
      yield PHASE_B_GAP;
    }
    yield PHASE_GAP;

    self.say('I never did get to these…', 120);
    for (let i = 0; i < PHASE_C_REPEATS; i++) {
      arc(self, PHASE_C_COUNT, reportBullet, PHASE_C_SPEED, Math.PI / 6, (5 * Math.PI) / 6);
      yield PHASE_C_GAP;
    }
    yield PHASE_GAP;
  }
}

export const shrunkOldMan = new EntityKind({
  sprite: 'shrunkOldMan',
  animKey: 'shrunkOldMan_walk',
  hitboxRadius: 16,
  hp: 72,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: shrunkOldManScript,
});

export function* shrunkOldManWave(self: Entity): Generator<ScriptYield, void, void> {
  // Same opening beat as the final-boss wave: don't bring him on while
  // leftover enemies are still drifting around, sweep stragglers, brief
  // pause for funereal tone, then he shuffles in. Spawned unhittable so
  // player bullets pass through during entrance + dialogue; the script
  // re-enables damage after he's done speaking.
  yield* waitForEnemiesCleared(self);
  clearScreen(self);
  yield 30;
  const boss = self.spawn(shrunkOldMan, GAME_W / 2, -30, 0, 0, {
    damagedByClass: [],
  });
  yield { until: boss };
}
