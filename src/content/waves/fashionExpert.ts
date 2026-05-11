import { shoot } from '../../audio/sfx/events';
import { BULLET_RADIUS, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import { NECKTIE_KEY } from '../textures';

// Fashion Expert: a new face who breezes in to show off his "new look" and
// flings neckties at the player while he waits for a compliment. Sits in
// the encounter stack just before sales+client — the corridor's quiet
// section between the all-doors spam and the important-client double act.
//
// Attack identity: long streams of neckties with a slow-tracking aim. The
// firing direction at the start of each stream snaps to the player, then
// drifts toward the player's *current* position only as fast as
// `AIM_TURN_PER_SHOT` per bullet — so the line of ties reads as a snake
// that lags one beat behind the dodge instead of a column that
// instantly relocks. Holding still gets you hit; bolting once leaves
// the tail of the stream in the spot you left.

const ENTRY_SPEED = 110;
const ENTRY_Y = 110;
const EXIT_SPEED = 240;

// Stream geometry. NECKTIE_SPEED + STREAM_GAP space ties ~12 px apart in
// flight so they read as a chain of discrete projectiles, not a solid
// bar. STREAM_BULLETS × STREAM_GAP = ~80 frames per stream (~1.3s).
const STREAM_BULLETS = 26;
const STREAM_GAP = 3;
const NECKTIE_SPEED = 230;
// Replay shoot SFX every Nth bullet so the stream is audible without
// saturating the SFX voice cap.
const STREAM_SFX_EVERY = 6;

// How far the aim heading is allowed to rotate from one bullet to the next.
// Smaller → straighter stream that doesn't track; larger → snappier
// tracking that feels like a pure aimed shot. 0.025 rad/shot at 3 frames
// per shot ≈ 0.5 rad/s rotation, which sweeps slower than a brisk
// horizontal walk across the playfield — the player can outrun it but
// only by committing to motion.
const AIM_TURN_PER_SHOT = 0.025;

const STREAMS = 3;
const BETWEEN_STREAMS = 55;

const INTRO_LINE = 'I changed my style,\nthoughts?';
const INTRO_SAY_FRAMES = 110;
const INTRO_HOLD = 90;

const FOLLOWUP_LINES = ['Honest feedback,\nplease.', 'Killer look,\nright?'] as const;
const FOLLOWUP_SAY_FRAMES = 90;

// Necktie bullet — small downward-pointing red tie. Sprite stays at
// rotation 0 (ties hang by gravity, so a fixed-down orientation reads
// correctly regardless of travel angle); no `rotateToVelocity` for that
// reason. Slightly tighter hitbox than BULLET_RADIUS so off-axis ties
// at the edge of the cone don't punish a clean dodge.
export const necktie = new EnemyBulletEntityKind({
  sprite: NECKTIE_KEY,
  hitboxRadius: BULLET_RADIUS,
});

function* necktieStream(self: Entity): Generator<ScriptYield, void, void> {
  // Snap the first bullet to the player, then drift the aim only as
  // fast as AIM_TURN_PER_SHOT can rotate per shot — the rest of the
  // stream snakes after the player rather than locking on perfectly.
  let aim = self.angleToPlayer();
  for (let i = 0; i < STREAM_BULLETS; i++) {
    const target = self.angleToPlayer();
    let diff = target - aim;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    aim += Math.max(-AIM_TURN_PER_SHOT, Math.min(AIM_TURN_PER_SHOT, diff));
    if (i % STREAM_SFX_EVERY === 0) shoot();
    self.spawn(necktie, self.x, self.y, Math.cos(aim) * NECKTIE_SPEED, Math.sin(aim) * NECKTIE_SPEED);
    yield STREAM_GAP;
  }
}

function* fashionExpertScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  self.say(INTRO_LINE, INTRO_SAY_FRAMES);
  yield INTRO_HOLD;

  for (let i = 0; i < STREAMS; i++) {
    if (i > 0) {
      const line = FOLLOWUP_LINES[(i - 1) % FOLLOWUP_LINES.length];
      if (line) self.say(line, FOLLOWUP_SAY_FRAMES);
    }
    yield* necktieStream(self);
    if (i < STREAMS - 1) yield BETWEEN_STREAMS;
  }

  self.setVelocity(0, EXIT_SPEED);
}

export const fashionExpert = new HPEntityKind({
  sprite: 'fashionExpert',
  hitboxRadius: 16,
  hp: 40,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: fashionExpertScript,
});

// Demo wave: a single fashion expert, mid-column. He's a between-beat
// solo act in the corridor before sales+client, so no co-stars.
export function* fashionExpertWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'fashion expert');
  self.stage.scheduleMultDrop('regular');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    self.spawn(fashionExpert, GAME_W * 0.5, -30, 0, 0);
  });
}
