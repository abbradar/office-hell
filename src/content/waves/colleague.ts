import { gameW } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { markWave } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { missedCallBullet } from './missedCallBullet';

// Colleague: a mid-screen drive-by that slides in from the side, asks for "a
// quick call", fires a ring of missed-call bullets, then slides back out the
// way it came — dropping more rings while in retreat for any player who didn't
// finish them off. Spawn x picks the side: x < gameW()/2 → enters from the left
// and exits left; otherwise mirror.

const ENTER_SPEED = 130;
const ENTER_DX = 195;
const HOLD_FRAMES = 70;
const RING_COUNT = 12;
const BULLET_SPEED = 130;
const BETWEEN_RINGS = 35;
const RETREAT_RINGS = 2;

function* colleagueScript(self: Entity) {
  const fromLeft = self.x < gameW() / 2;
  const dir = fromLeft ? 1 : -1;

  yield* moveTo(self, self.x + dir * ENTER_DX, self.y, ENTER_SPEED);

  self.say('Got a quick call?', HOLD_FRAMES);
  yield HOLD_FRAMES;

  ring(self, RING_COUNT, missedCallBullet, BULLET_SPEED, Math.random() * Math.PI * 2);
  yield BETWEEN_RINGS;

  self.setVelocity(-dir * ENTER_SPEED, 0);
  for (let i = 0; i < RETREAT_RINGS; i++) {
    ring(self, RING_COUNT, missedCallBullet, BULLET_SPEED, Math.random() * Math.PI * 2);
    yield BETWEEN_RINGS;
  }
}

export const colleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 12,
  hp: 12,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: colleagueScript,
});

// Demo wave: alternating sides at varying heights so the player has to track
// them across the screen.
export function* colleaguesWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'colleagues');
  self.spawn(colleague, -30, 220, 0, 0);
  yield 80;
  self.spawn(colleague, gameW() + 30, 280, 0, 0);
  yield 100;
  self.spawn(colleague, -30, 200, 0, 0);
  self.spawn(colleague, gameW() + 30, 340, 0, 0);
  yield 120;
  self.spawn(colleague, -30, 260, 0, 0);
  yield 70;
  self.spawn(colleague, gameW() + 30, 180, 0, 0);
  self.spawn(colleague, -30, 360, 0, 0);
  yield 110;
  self.spawn(colleague, gameW() + 30, 240, 0, 0);
  self.spawn(colleague, -30, 320, 0, 0);
}
