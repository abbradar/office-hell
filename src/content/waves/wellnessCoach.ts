import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Wellness Coach: shows up unannounced for an "urgent wellness improvement
// session". Her one move is a breathing exercise — bullet rings converge on
// her from beyond the screen edges while she says "slowly breath in...",
// then the same ring layout blows back outward (faster) on "...then out!".
//
// "From outside the screen" is implemented by spawning the inbound ring at
// SPAWN_RADIUS around the coach with each bullet's velocity pointed back at
// her. The radius is chosen so all spawn points sit past the screen edge
// from her stand position near the top centre — bullets cross into view as
// they travel inward, which sells the inhale.

const ENTRY_SPEED = 110;
const ENTRY_X = GAME_W / 2;
const ENTRY_Y = 110;

const SPAWN_RADIUS = 360;
const RING_COUNT = 12;
const IN_SPEED = 80;
const OUT_SPEED = 170;

const IN_RINGS = 5;
const IN_RING_GAP = 38;
const IN_TO_OUT_GAP = 28;
const OUT_RINGS = 4;
const OUT_RING_GAP = 26;
const CYCLE_GAP = 36;

const IN_SAY = 'Slowly\nbreath in...';
const OUT_SAY = '...then\nout!';
const IN_SAY_FRAMES = IN_RINGS * IN_RING_GAP + IN_TO_OUT_GAP;
const OUT_SAY_FRAMES = OUT_RINGS * OUT_RING_GAP + 4;

// Spawn `count` bullets evenly placed on a circle of radius SPAWN_RADIUS
// around the coach, each headed straight back toward her at `speed`.
function ringFromOutside(self: Entity, count: number, speed: number, baseAngle: number): void {
  shoot();
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i * Math.PI * 2) / count;
    const sx = self.x + Math.cos(angle) * SPAWN_RADIUS;
    const sy = self.y + Math.sin(angle) * SPAWN_RADIUS;
    self.spawn(bullet, sx, sy, -Math.cos(angle) * speed, -Math.sin(angle) * speed);
  }
}

function* coachScript(self: Entity) {
  yield* moveTo(self, ENTRY_X, ENTRY_Y, ENTRY_SPEED);

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'coach1', frame: 1, name: 'Coach Becky' },
    lines: [
      { speaker: 'right', text: "Hi-i! I'm here for your URGENT wellness improvement session!" },
      { speaker: 'left', text: "I'm fine, honestly. I just want to leave." },
      { speaker: 'right', text: 'Your cortisol is SCREAMING, sweetie. Mindful breathing — together!' },
      { speaker: 'left', text: '…that does not feel optional.' },
    ],
  });

  while (self.alive) {
    // Inhale: rings converge on the coach from beyond the screen, slowly.
    self.say(IN_SAY, IN_SAY_FRAMES);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < IN_RINGS; i++) {
      if (!self.alive) return;
      ringFromOutside(self, RING_COUNT, IN_SPEED, baseAngle);
      baseAngle += Math.PI / 24;
      yield IN_RING_GAP;
    }
    yield IN_TO_OUT_GAP;

    // Exhale: same ring layout, blown back outward from the coach, faster.
    self.say(OUT_SAY, OUT_SAY_FRAMES);
    for (let i = 0; i < OUT_RINGS; i++) {
      if (!self.alive) return;
      ring(self, RING_COUNT, bullet, OUT_SPEED, baseAngle);
      baseAngle += Math.PI / 24;
      yield OUT_RING_GAP;
    }
    yield CYCLE_GAP;
  }
}

export const wellnessCoach = new EntityKind({
  sprite: 'coach1',
  hitboxRadius: 12,
  hp: 24,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: coachScript,
});

export function* wellnessCoachWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'wellness coach');
  const coach = self.spawn(wellnessCoach, GAME_W / 2, -30, 0, 0);
  yield { until: coach };
}
