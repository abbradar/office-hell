import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, arc, ring } from '../../script/patterns';
import { markWave, waitEnemiesClear } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { clearScreen } from '../stage';

// Gym Bro (Brad): a stage boss who's desperate to leave the office early
// because he's convinced his muscles are shrinking. Entrance and dialogue
// follow the same beats as the office boss — flies in unhittable, has a chat,
// then becomes hittable and cycles through gym-themed attacks.

const ENTRY_SPEED = 110;
const ENTRY_FRAMES = 80;
const HOLD_BEFORE_TALK = 20;
const POST_DIALOGUE_HOLD = 110;

function* gymBroScript(self: Entity) {
  self.setVelocity(0, ENTRY_SPEED);
  yield ENTRY_FRAMES;
  self.setVelocity(0, 0);
  yield HOLD_BEFORE_TALK;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'gymBro', frame: 1, name: 'Brad' },
    lines: [
      { speaker: 'right', text: "Bro. Bro. I gotta dip. Feel my arm — it's shrinking." },
      { speaker: 'left', text: "It's eight PM. Your arm is fine." },
      { speaker: 'right', text: "Every minute I'm in this cube is a minute I'm not at the gym. Catabolism is REAL." },
      { speaker: 'left', text: "I don't think that word means what you think it means." },
      { speaker: 'right', text: "Don't make me skip leg day for this, bro. I will not be responsible." },
      { speaker: 'left', text: '…fine. Try and stop me leaving first.' },
    ],
  });

  // Claim the HUD header now that the fight is actually starting; release it
  // on death (covers both natural defeat and forced cleanup via release(),
  // which calls die() too).
  self.stage.bossName = 'Brad';
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  self.setDamagedByClasses(['enemy']);
  self.say('Skip day cancelled!', POST_DIALOGUE_HOLD);
  yield POST_DIALOGUE_HOLD;

  while (self.alive) {
    // Phase 1 — counting reps: short, rhythmic aimed bursts.
    self.say('One! Two! Three!', 90);
    for (let i = 0; i < 6; i++) {
      aimed(self, 4, bullet, 210, Math.PI / 8);
      yield 22;
    }
    yield 30;

    // Phase 2 — protein shake spin: rotating rings that drift open.
    self.say('Bulk season!', 90);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < 5; i++) {
      ring(self, 14, bullet, 120, baseAngle);
      baseAngle += Math.PI / 12;
      yield 24;
    }
    yield 30;

    // Phase 3 — heavy lifts: wide downward arcs, like swinging a barbell.
    self.say('Max bench!', 110);
    for (let i = 0; i < 5; i++) {
      arc(self, 13, bullet, 160, Math.PI / 7, (6 * Math.PI) / 7);
      yield 34;
    }
    yield 60;
  }
}

export const gymBro = new EntityKind({
  sprite: 'gymBro',
  hitboxRadius: 18,
  hp: 60,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: gymBroScript,
});

// Wave wrapper that mirrors the final boss's entrance pattern: clear the
// field, beat, then drop the boss in spawned-unhittable so his own script
// can run entry + dialogue before becoming damageable.
export function* gymBroWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'gym bro');
  yield* waitEnemiesClear(self);
  clearScreen(self);
  yield 30;
  const boss = self.spawn(gymBro, GAME_W / 2, -60, 0, 0, {
    damagedByClass: [],
  });
  yield { until: boss };
}
