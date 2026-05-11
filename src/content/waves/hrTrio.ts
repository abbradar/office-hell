import { shoot } from '../../audio/sfx/events';
import { GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { emailBullet } from './checkEmail';
import { reportBullet } from './reportBullet';

// HR Trio: a lead HR coordinator arrives alone with a fresh stack of CVs to
// push, asks the player to review them, then two more HRs flood in. Each
// HR settles into the same attack pattern: 100 frames after delivering its
// first line, it starts a looping "burst → rest" sequence where 50 bullets
// streak out from the HR to random points in a 100 px disk, then fall +
// radial-outward at 40 + 20 px/s. Rest is 5 s between bursts.

const ENTRY_SPEED = 90;
// Pushed lower than the typical wave's ~110 because the lead HR's solo intro
// is three lines tall (LEAD_LINE_1) — at the more usual entry y the bubble
// would either clip the screen top or flip to under the sprite, where the
// follower HRs walking in obscure it. See the "speakers must leave room for
// their bubble" note in src/docs/stage-design.md.
const ENTRY_Y = 130;
const SPAWN_Y = -30;

// Frames moveTo takes to walk an HR from SPAWN_Y to ENTRY_Y at ENTRY_SPEED.
// Used by the wave script to schedule follower spawns relative to HR-0's intro.
const ENTRY_FRAMES = Math.round(((ENTRY_Y - SPAWN_Y) / ENTRY_SPEED) * SCRIPT_FPS);

// Lead HR (role 0): one-line solo intro before the others arrive. Buffed HP
// so the player can't melt them in the gap before followers spawn.
const LEAD_LINE_1 = 'Fresh CVs arrived for\nthe senior janitorial\nmanagement role!';
const LEAD_LINE_1_SAY = 170;
// How long after HR-0 enters before the followers crash the meeting. Sized
// so HR-0 finishes its line and is already mid-burst when HR-1/HR-2 walk in.
const PRE_FOLLOWER_GAP = 200;
const LEAD_HP = 100;

// Follower openers (roles 1, 2): a single line each. Followers spawn on the
// same frame from the wave, then stagger their lines by FOLLOWER_SLOT so
// their bubbles don't overlap.
const FOLLOWER_SAY = 110;
const FOLLOWER_SLOT = 140;

// Per-role first line. Role 0 uses LEAD_LINE_1; followers each get their own
// opener so the trio reads as three distinct voices crashing into the room.
const FIRST_LINE_BY_ROLE = [LEAD_LINE_1, 'Could you do\nmine first?', 'I have the best\ncandidates.'] as const;

// Streak pattern: 50 bullets per burst spawned one-per-frame at the HR,
// each streaking to a uniformly-sampled point in a STREAK_RADIUS disk over
// STREAK_APPROACH_FRAMES frames, then taking on a (radial-outward,
// downward) velocity. Every second bullet is tinted red for visual
// rhythm.
const STREAK_START_DELAY = 100; // frames after the first say before the streak begins
const STREAK_FRAMES_PER_BURST = 50;
const STREAK_REST_FRAMES = 5 * SCRIPT_FPS; // 5 s between bursts
const STREAK_RADIUS = 100;
const STREAK_FALL_SPEED = 40;
const STREAK_RADIAL_SPEED = 20;
const STREAK_APPROACH_FRAMES = 10;
const STREAK_APPROACH_TIME_S = STREAK_APPROACH_FRAMES / SCRIPT_FPS;
const STREAK_TINT_RED = 0xff3344;

type Role = 0 | 1 | 2;

// One burst of the streak pattern: 50 spawns over 50 frames, each on its
// own per-bullet script that runs the streak-out → velocity-swap handoff.
// At a fixed 60 Hz simulation step, approachVx · STREAK_APPROACH_TIME_S
// equals the spawn → target dx exactly, so each bullet's body is at the
// target on the frame the script flips its velocity to the final
// outward-radial + downward vector. The shoot() call per spawn fires the
// laser SFX through the voice pool, which caps concurrent voices so 50
// shoots in 50 frames read as a tight laser train rather than a roar.
function* streakBurst(self: Entity): Generator<ScriptYield, void, void> {
  for (let i = 0; i < STREAK_FRAMES_PER_BURST; i++) {
    const theta = Math.random() * Math.PI * 2;
    // Uniform-in-area disk sampling: r = R · √(u).
    const r = STREAK_RADIUS * Math.sqrt(Math.random());
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const tx = self.x + r * cosT;
    const ty = self.y + r * sinT;
    // Outward unit vector from the HR to the spawn point — zero at the
    // center where there's no defined "outward" direction.
    const radX = r > 1e-6 ? cosT : 0;
    const radY = r > 1e-6 ? sinT : 0;
    const approachVx = (tx - self.x) / STREAK_APPROACH_TIME_S;
    const approachVy = (ty - self.y) / STREAK_APPROACH_TIME_S;

    // Every second bullet is a red-tinted envelope; the rest are paper
    // reports left untinted. Both kinds get the same per-bullet streak
    // script — the explicit `script` option overrides `reportBullet`'s
    // homing default, so the paper bullets fly straight rather than
    // re-aiming at the player.
    shoot();
    const isRed = i % 2 === 1;
    const kind = isRed ? emailBullet : reportBullet;
    const b = self.spawn(kind, self.x, self.y, approachVx, approachVy, {
      script: function* (e: Entity) {
        yield STREAK_APPROACH_FRAMES;
        e.setVelocity(STREAK_RADIAL_SPEED * radX, STREAK_FALL_SPEED + STREAK_RADIAL_SPEED * radY);
      },
    });
    if (isRed) b.setTint(STREAK_TINT_RED);
    else b.clearTint();
    yield 1;
  }
}

function makeHrScript(role: Role): EntityScript {
  return function* (self: Entity) {
    const targetX = GAME_W * (0.2 + role * 0.3);
    yield* moveTo(self, targetX, ENTRY_Y, ENTRY_SPEED);

    // Followers stagger their openers by their order within the pair.
    if (role !== 0) {
      yield (role - 1) * FOLLOWER_SLOT;
    }

    self.say(FIRST_LINE_BY_ROLE[role], role === 0 ? LEAD_LINE_1_SAY : FOLLOWER_SAY);
    yield STREAK_START_DELAY;

    // Burst → rest loop until the HR dies. StageManager drops this script
    // on the next update tick after the entity is released, so there's no
    // explicit terminator here.
    while (true) {
      yield* streakBurst(self);
      yield STREAK_REST_FRAMES;
    }
  };
}

export const hr = new HPEntityKind({
  sprite: 'hr',
  hitboxRadius: 16,
  hp: 22,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

export function* hrTrioWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'hr trio');
  self.stage.scheduleMultDrop('regular');
  yield* suspendRunning(self, function* () {
    // Lead HR enters alone, says their line, and is mid-burst by the time
    // the followers walk in. Buffed HP override via opts.hp so the lead
    // survives the gap.
    self.spawn(hr, GAME_W * 0.2, SPAWN_Y, 0, 0, {
      script: makeHrScript(0),
      hp: LEAD_HP,
    });
    // Wait for HR-0 to walk in, deliver its line, and start streaking
    // before the followers crash the meeting.
    yield ENTRY_FRAMES + PRE_FOLLOWER_GAP;
    // TODO(shmup-design): HR-1 and HR-2 spawn on the same frame here.
    // Per "Bullet Hell Shmup Design 101", multiple high-HP enemies in a
    // single frame force a snap triage decision. Consider staggering by
    // ~0.4s. Skipped now: the trio gimmick may justify the simultaneity,
    // and the existing HP / pattern balance was tuned against the
    // current spawn shape — needs playtest before changing.
    self.spawn(hr, GAME_W * 0.5, SPAWN_Y, 0, 0, { script: makeHrScript(1) });
    self.spawn(hr, GAME_W * 0.8, SPAWN_Y, 0, 0, { script: makeHrScript(2) });
  });
}
