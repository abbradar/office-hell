import { shoot } from '../../audio/sfx/events';
import { BULLET_RADIUS, GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { lineStroke, moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import { redCross } from '../kinds';
import { NECKTIE_KEY } from '../textures';

// Fashion Expert: a new face who breezes in to show off his "new look" and
// flings neckties at the player while he waits for a compliment. Sits in
// the encounter stack just before sales+client — the corridor's quiet
// section between the all-doors spam and the important-client double act.
//
// Attack identity: self-homing necktie streams overlaid on a pulsed fan
// of angled lasers. The streams snake (firing aim + per-bullet homing)
// so a static dodge leaks; between stream beats, a wide fan of
// telegraphed laser-cross lines snaps on, forcing the player to
// commit to one of the angular gaps. Each laser pulse has a long
// rest tail so the player has time to read the next telegraph and
// reposition.

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
// tracking that feels like a pure aimed shot. 0.05 rad/shot at 3 frames
// per shot ≈ 1.0 rad/s rotation: faster than the player can comfortably
// strafe across mid-field, so a static dodge eats bullets and you have
// to keep moving to outrun the tail.
const AIM_TURN_PER_SHOT = 0.05;

// Per-bullet homing applied on top of the firing-aim sweep. Each tie can
// curve its own trajectory toward the player at NECKTIE_HOMING_RATE_START
// rad/frame, decaying linearly to zero over NECKTIE_HOMING_DECAY_FRAMES —
// after that the bullet flies straight. Tuned milder than reportBullet
// (0.04/30) because the streams already track at the firing layer;
// stacking full reportBullet homing on top steers each tie too hard to
// dodge.
const NECKTIE_HOMING_RATE_START = 0.02;
const NECKTIE_HOMING_DECAY_FRAMES = 22;

const STREAMS = 3;
const BETWEEN_STREAMS = 55;

// Laser pulse — a fan of `LASER_COUNT` angled lines extended to the
// playfield bounds from the fashion expert's position. Each pulse
// telegraphs (non-damaging warning lines) for LASER_TELEGRAPH_FRAMES,
// then commits to LASER_LETHAL_FRAMES of damaging crosses, then rests
// for LASER_PULSE_REST so the player can read the next telegraph and
// pick a gap. LASER_SPREAD covers a downward fan; the per-pulse jitter
// in `laserPulse` rotates the whole fan a little each time so the
// angular gaps don't sit in the same lanes every pulse.
const LASER_COUNT = 11;
const LASER_SPREAD = 2.0;
const LASER_TELEGRAPH_FRAMES = 42;
const LASER_LETHAL_FRAMES = 18;
const LASER_PULSE_REST = 55;
const LASER_LINE_SPACING = 13;

const INTRO_LINE = 'I changed my style,\nthoughts?';
const INTRO_SAY_FRAMES = 110;

const FOLLOWUP_LINES = ['Honest feedback,\nplease.', 'Killer look,\nright?'] as const;
const FOLLOWUP_SAY_FRAMES = 90;

// Per-tie homing flight. Mirrors reportBullet's shape (decay over a
// fixed window then drop the script) with milder constants — the
// stream's firing-aim layer already does most of the tracking work,
// this just bends the trail a few extra degrees toward the player.
function* necktieFlight(self: Entity): Generator<ScriptYield, void, void> {
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  for (let age = 0; age < NECKTIE_HOMING_DECAY_FRAMES; age++) {
    yield 1;
    const rate = NECKTIE_HOMING_RATE_START * (1 - age / NECKTIE_HOMING_DECAY_FRAMES);
    const cv = self.body.velocity;
    const cur = Math.atan2(cv.y, cv.x);
    let diff = self.angleToPlayer() - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-rate, Math.min(rate, diff));
    self.setMotion(cur + turn, speed);
  }
}

// Necktie bullet — small downward-pointing red tie. Sprite stays at
// rotation 0 (ties hang by gravity, so a fixed-down orientation reads
// correctly regardless of travel angle); no `rotateToVelocity` for that
// reason. `defaultScript` handles per-bullet homing — see
// `necktieFlight`.
export const necktie = new EnemyBulletEntityKind({
  sprite: NECKTIE_KEY,
  hitboxRadius: BULLET_RADIUS,
  defaultScript: necktieFlight,
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

function* streamCycle(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < STREAMS; i++) {
    if (i > 0) {
      const line = FOLLOWUP_LINES[(i - 1) % FOLLOWUP_LINES.length];
      if (line) self.say(line, FOLLOWUP_SAY_FRAMES);
    }
    yield* necktieStream(self);
    if (i < STREAMS - 1) yield BETWEEN_STREAMS;
  }
}

// Project a ray at `angle` from `(fromX, fromY)` to the playfield edge.
// Lasers are drawn out to this endpoint so each line stops cleanly at
// the screen boundary instead of wasting pooled bullets off-screen.
// Same algorithm as `extendRayToBounds` in theBoss.ts — kept inline to
// avoid plumbing an exported helper for one caller.
function rayToBounds(fromX: number, fromY: number, angle: number): { x: number; y: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tMax = Number.POSITIVE_INFINITY;
  if (dx > 1e-6) tMax = Math.min(tMax, (GAME_W - fromX) / dx);
  else if (dx < -1e-6) tMax = Math.min(tMax, -fromX / dx);
  if (dy > 1e-6) tMax = Math.min(tMax, (GAME_H - fromY) / dy);
  else if (dy < -1e-6) tMax = Math.min(tMax, -fromY / dy);
  return { x: fromX + tMax * dx, y: fromY + tMax * dy };
}

function* laserPulse(self: Entity): Generator<ScriptYield, void, void> {
  // Fan centred at π/2 (straight down) so all lasers sweep the half of
  // the field below the fashion expert. Per-pulse jitter rotates the
  // whole fan by up to ±half-step so successive pulses don't reuse the
  // same lanes.
  const baseAngle = Math.PI / 2;
  const step = LASER_SPREAD / (LASER_COUNT - 1);
  const jitter = (Math.random() - 0.5) * step;
  const startAngle = baseAngle - LASER_SPREAD / 2 + jitter;
  const endpoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < LASER_COUNT; i++) {
    const a = startAngle + i * step;
    endpoints.push(rayToBounds(self.x, self.y, a));
  }
  for (const end of endpoints) {
    lineStroke(self, self.x, self.y, end.x, end.y, redCross, LASER_TELEGRAPH_FRAMES, {
      damaging: false,
    });
  }
  yield LASER_TELEGRAPH_FRAMES;
  for (const end of endpoints) {
    lineStroke(self, self.x, self.y, end.x, end.y, redCross, LASER_LETHAL_FRAMES, {
      spacing: LASER_LINE_SPACING,
    });
  }
  yield LASER_LETHAL_FRAMES;
}

// Open-ended laser loop — raced against `streamCycle` so the bounded
// stream phase ends the fight; the engine drops this generator on race
// cancellation. `while (true)` is the right shape here per the project's
// no-`self.alive`-guard rule (StageManager drops scripts on death).
function* laserPulseLoop(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    yield* laserPulse(self);
    yield LASER_PULSE_REST;
  }
}

function* fashionExpertScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  // `say` is non-blocking — the bubble lives on the bubble manager, so
  // dropping straight into the race fires the first stream + laser while
  // the intro line is still up. He's talking and shooting at once.
  self.say(INTRO_LINE, INTRO_SAY_FRAMES);

  yield { race: [streamCycle(self), laserPulseLoop(self)] };

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
