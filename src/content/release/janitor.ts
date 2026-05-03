import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { spread } from '../../script/patterns';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Janitor: drives in, plants, and fires a long horizontal sweep — a "mop
// swipe" that fans bullets across the screen. After the first swipe they
// shuffle a bit further down and swipe again, so the player has to dodge
// twice from a fresh angle.

const SWEEP_STEPS = 28;
const SWEEP_STEP_FRAMES = 2;
const SWEEP_FROM = Math.PI / 8; // ~22.5° — almost horizontal-right (down-right)
const SWEEP_TO = (7 * Math.PI) / 8; // ~157.5° — almost horizontal-left
const SWEEP_BULLETS_PER_STEP = 3;
const SWEEP_SPREAD = Math.PI / 22;
const SWEEP_SPEED = 160;

const ADVANCE_SPEED = 70;
const ADVANCE_FRAMES = 50;
const REST_FRAMES = 40;

function* sweep(self: Entity, leftToRight: boolean): Generator<ScriptYield, void, void> {
  const from = leftToRight ? SWEEP_FROM : SWEEP_TO;
  const to = leftToRight ? SWEEP_TO : SWEEP_FROM;
  for (let i = 0; i < SWEEP_STEPS; i++) {
    const t = i / (SWEEP_STEPS - 1);
    const angle = from + (to - from) * t;
    spread(self, SWEEP_BULLETS_PER_STEP, bullet, SWEEP_SPEED, angle, SWEEP_SPREAD);
    yield SWEEP_STEP_FRAMES;
  }
}

function* janitorScript(self: Entity) {
  self.setVelocity(0, 110);
  yield 60;
  self.setVelocity(0, 0);
  self.say('Watch the wet floor!', 110);
  yield 80;

  // Pin the sweep direction once — both passes go the same way, like a real
  // mop stroke pair, instead of randomly flipping mid-encounter.
  const leftToRight = self.x < GAME_W / 2;

  yield* sweep(self, leftToRight);

  // Shuffle forward a touch, rest, then second swipe from the new position.
  self.setVelocity(0, ADVANCE_SPEED);
  yield ADVANCE_FRAMES;
  self.setVelocity(0, 0);
  yield REST_FRAMES;

  yield* sweep(self, leftToRight);

  yield 30;
  self.setVelocity(0, 220);
}

export const janitor = new EntityKind({
  sprite: 'coworker2',
  animKey: 'coworker2_walk',
  hitboxRadius: 12,
  hp: 5,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: janitorScript,
});

// Demo wave: one janitor planted slightly off-centre so the sweep angles
// across the whole play field rather than dumping bullets straight down.
// biome-ignore lint/correctness/useYield: spawn-only wave; yield-less generator is intentional
export function* janitorsWave(self: Entity): Generator<ScriptYield, void, void> {
  self.spawn(janitor, GAME_W * 0.3, -30, 0, 0);
}
