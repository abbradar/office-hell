import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { EntityKind, type ScriptYield } from '../../script/types';
import { questionBullet } from './questionBullet';

// Oversleeper: a colleague who slept in and now wants you to recap the entire
// morning. Drives down to mid-screen, asks a question, then fires a long
// straight-line stream of "question" bullets. Each barrage re-aims at the
// player at the moment it starts — so the player has to step out of the
// stream's column once it begins, rather than parking and tanking.

const ENTRY_SPEED = 110;
const ENTRY_Y = 110;
const EXIT_SPEED = 220;

// One barrage = STREAM_BULLETS bullets fired one every STREAM_GAP frames, all
// along the same heading. STREAM_GAP=3 at STREAM_SPEED=240 spaces bullets
// ~12px apart in flight — they read as a discrete stream rather than a solid
// bar. 35 * 3 = 105 frames per barrage (~1.75s).
const STREAM_BULLETS = 35;
const STREAM_GAP = 3;
const STREAM_SPEED = 240;
// Replay the shoot SFX every Nth bullet so the stream sounds like a stream
// without overdriving the SFX voice cap.
const STREAM_SFX_EVERY = 6;

const BARRAGES = 3;
const BETWEEN_BARRAGES = 55;

const SAY_FRAMES = 90;

const QUESTIONS = ['Wait — what did I miss?', 'Any updates from the standup?', 'Just a quick recap?'] as const;

function* barrage(self: Entity): Generator<ScriptYield, void, void> {
  // Lock heading at the start of the barrage. Each bullet then travels along
  // that fixed line; the player dodges by stepping out of the column.
  const aim = self.angleToPlayer();
  const vx = Math.cos(aim) * STREAM_SPEED;
  const vy = Math.sin(aim) * STREAM_SPEED;
  for (let i = 0; i < STREAM_BULLETS; i++) {
    if (!self.alive) return;
    if (i % STREAM_SFX_EVERY === 0) shoot();
    self.spawn(questionBullet, self.x, self.y, vx, vy);
    yield STREAM_GAP;
  }
}

function* oversleeperScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  for (let i = 0; i < BARRAGES; i++) {
    if (!self.alive) return;
    self.say(QUESTIONS[i] ?? 'And then?', SAY_FRAMES);
    yield 35;
    yield* barrage(self);
    yield BETWEEN_BARRAGES;
  }

  self.setVelocity(0, EXIT_SPEED);
}

export const oversleeper = new EntityKind({
  sprite: 'overslept',
  animKey: 'overslept_run_down',
  hitboxRadius: 12,
  hp: 22,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: oversleeperScript,
});

// Demo wave: a single oversleeper, mid-column, so the test exercises the
// barrage-stream cleanly without other enemies interfering.
// biome-ignore lint/correctness/useYield: spawn-only wave; yield-less generator is intentional
export function* oversleeperWave(self: Entity): Generator<ScriptYield, void, void> {
  self.spawn(oversleeper, GAME_W * 0.5, -30, 0, 0);
}
