import { KAEDALUS_SHORT_KEY } from '../../audio/keys';
import { BULLET_RADIUS, GAME_H, GAME_W, SCRIPT_FPS, WALL_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import {
  BossKind,
  becomeHittable,
  bossShudder,
  FLICKER_INTERVAL_FRAMES,
  FLICKER_TOGGLES,
  POST_FLICKER_HOLD_FRAMES,
  pauseMusicForDefeat,
} from '../../script/boss';
import { aimed, moveTo } from '../../script/patterns';
import { markWave, prepareForBoss, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { emailBullet } from './checkEmail';

// Stage boss: a sad, retired old man "shrunk" from the company. Security is
// already on his shoulder — he just wants to pass his pile of unfinished
// tasks to someone before he's escorted out. Patterns lean slow and tired —
// drifting paperwork rather than aggressive volleys, but enough of it that
// standing still is not an option.

const ENTRY_SPEED = 60;
const ENTRY_Y = 100;

const PHASE_GAP = 50;

// Phase A — "all my unfinished reports": two interleaved radial rings. Each
// ring fires on a 30-frame cadence; the second is offset 5 frames from the
// first. A ring is 8 evenly-spaced spokes × 8 paper bullets at linearly-
// distributed speeds (100 → 120 px/s); the 8 bullets of one spoke spawn
// co-located on the boss and stretch into a radial trail as the faster
// bullets pull ahead. Within each spoke, bullets fan slightly (~7.9° from
// first to last) — fanSign mirrors the fan between the two rings so the
// CCW (untinted) and CW (red-tinted) patterns read as reflections. The
// pivot completes one revolution per 12 s; the phase runs for one
// revolution.
const PHASE_A_RING_LINES = 8;
const PHASE_A_BULLETS_PER_LINE = 8;
const PHASE_A_SPEED_FIRST = 100;
const PHASE_A_SPEED_LAST = 120;
const PHASE_A_RING_GAP_F = 30; // 0.5 s between rings of the same color
const PHASE_A_TURN_F = 720; // 12 s per pivot revolution
const PHASE_A_PIVOT_STEP_CCW = -(Math.PI * 2 * PHASE_A_RING_GAP_F) / PHASE_A_TURN_F;
const PHASE_A_PIVOT_STEP_CW = (Math.PI * 2 * PHASE_A_RING_GAP_F) / PHASE_A_TURN_F;
const PHASE_A_PIVOT_START = 0;
const PHASE_A_LINE_STEP = (Math.PI * 2) / PHASE_A_RING_LINES;
const PHASE_A_SPEED_INC = (PHASE_A_SPEED_LAST - PHASE_A_SPEED_FIRST) / (PHASE_A_BULLETS_PER_LINE - 1);
const PHASE_A_BULLET_ANGLE_STEP = Math.PI / 160; // per-bullet fan offset within a spoke
const PHASE_A_OFFSET_F = 5; // CW ring fires this many frames after the CCW ring
const PHASE_A_TINT_RED = 0xff3344;
const PHASE_A_DURATION_F = PHASE_A_TURN_F; // exactly one pivot revolution

// Phase B — "filing the whole desk at once": 40 red rings sweep from
// vertically down clockwise, 1-second break, then 40 blue rings sweep
// counterclockwise from the same starting angle. Rings are 12 red/blue-
// tinted paper bullets fired radially at 300 px/s; the pivot bullet
// rotates through 2π over 12 s (so each 40-ring sweep covers 120°).
// Concurrent wall fill: a vertical-up shot from the bottom every 30
// frames and a pair of side-cross shots from the inner walls every 15
// frames, all at 70 px/s — a baseline density the player weaves through
// while the rings sweep overhead. Total duration ~10 s.
const PHASE_B_RINGS = 20;
const PHASE_B_SUB_F = 240; // 4 s per color sub-phase
const PHASE_B_RING_GAP_F = PHASE_B_SUB_F / PHASE_B_RINGS; // 6 frames between rings
const PHASE_B_BREAK_F = 60; // 1 s break between colors
const PHASE_B_RED_END = PHASE_B_SUB_F;
const PHASE_B_BLUE_START = PHASE_B_RED_END + PHASE_B_BREAK_F;
const PHASE_B_BLUE_END = PHASE_B_BLUE_START + PHASE_B_SUB_F;
const PHASE_B_CYCLE_F = PHASE_B_BLUE_END + PHASE_B_BREAK_F; // 600
const PHASE_B_CYCLES = 2; // full red-break-blue-break cycles before transition
const PHASE_B_TURN_F = 1440; // 24 s for a full pivot revolution
const PHASE_B_PIVOT_STEP = (Math.PI * 2 * PHASE_B_RING_GAP_F) / PHASE_B_TURN_F;
const PHASE_B_PIVOT_START = Math.PI / 2; // vertically down (screen y-down)
const PHASE_B_BULLETS_PER_RING = 12;
const PHASE_B_RING_SPEED = 300;
const PHASE_B_TINT_RED = 0xff3344;
const PHASE_B_TINT_BLUE = 0xdddd33;
const PHASE_B_WALL_VERT_CADENCE = 90;
const PHASE_B_WALL_SIDE_CADENCE = 45;
const PHASE_B_WALL_SPEED = 70;

// Phase C — "sorting the mail": Hodges glides horizontally along his y line
// in five segments (center → left → right → left → right → center), raining
// email-bullets at random 1–10 frame intervals as he moves. Bullet tint
// flips by direction of motion (yellow when moving leftward, red when
// moving rightward). Each mail inherits a slow fraction of his horizontal
// velocity at spawn and accelerates straight down at PHASE_C_GRAVITY, so the
// drops trace parabolas tilted in the boss's direction of travel.
const PHASE_C_REPEATS = 4;
const PHASE_C_BOSS_SPEED = 400;
const PHASE_C_GRAVITY = 100;
const PHASE_C_LEFT_X = 50;
const PHASE_C_RIGHT_X = GAME_W - 50; // 350
const PHASE_C_CENTER_X = GAME_W / 2; // 200
const PHASE_C_TINT_YELLOW = 0xffff55;
const PHASE_C_TINT_RED = 0xff3344;
// Bullets inherit this fraction of the boss's horizontal velocity at spawn —
// keeps the parabola mostly vertical with a subtle lean in the travel
// direction rather than scattering bullets ahead of the boss.
const PHASE_C_VEL_INHERIT = 1 / 20;
// Spawn y is jittered by ±50 px around the boss's y so the trail reads as a
// band of drops rather than a single horizontal line.
const PHASE_C_SPAWN_Y_JITTER = 100;

// Phase D — "they keep coming back": two satellites orbit Hodges at radius
// R, each spawning a 5-bullet ring whose lead bullet points along 5·θ —
// so the rings precess five times per orbital revolution and rake the
// field as twin spirals. The orbiter's tangent velocity is folded into
// each spawned bullet (vx/vy include ±sin/cos · R·ω), so the spirals
// lean with the rotation instead of firing as a clean star, and rotation
// is baked from the resulting velocity vector. Meanwhile Hodges himself
// lays a tight 3-shot aimed fan straight at the player on a 40-frame
// cadence. One orbiter's shots are tinted yellow so the two spirals read
// as separate sources. R = 100 puts the orbiters at the field edges on a
// 200-wide stage — intentional; the orbital ring sweeps the entire field
// width.
const PHASE_D_REPEATS = 12;
const PHASE_D_CYCLES = 2; // re-spawn orbiters + spread loop this many times
const PHASE_D_GAP = 40;
const PHASE_D_R = 100;
const PHASE_D_PERIOD_F = 700;
const PHASE_D_OMEGA = (Math.PI * 2) / (PHASE_D_PERIOD_F / 60);
const PHASE_D_FIRE_EVERY = 5;
const PHASE_D_SHOT_SPEED = 100;
const PHASE_D_SPREAD_COUNT = 3;
const PHASE_D_SPREAD_SPEED = 200;
const PHASE_D_SPREAD_RAD = (40 * Math.PI) / 180;
const PHASE_D_TINTS: (number | null)[] = [null, 0xffff55];

// Scriptless variant of reportBullet for radial spreads — the canonical
// reportBullet kind has a homing default script that would re-aim every
// spawned bullet at the player and erase any precise geometric pattern.
// Shared by Phase B's red/blue rotating rings and Phase D's orbiter
// spirals — both need straight-line trajectories.
const straightReport = new EnemyBulletEntityKind({
  sprite: 'reportBullet',
  hitboxRadius: BULLET_RADIUS,
});

// Phase A helper: spawn one 8-spoke × 8-bullet radial ring. Each spoke
// spawns its 8 bullets co-located at the boss, with speeds distributed
// linearly from PHASE_A_SPEED_FIRST to PHASE_A_SPEED_LAST (so the slowest
// stays near the boss while the fastest pulls ahead and the spoke
// stretches into a radial trail). The per-bullet fan offset rotates each
// successive bullet slightly off the spoke axis; `fanSign` picks the fan
// direction so the CCW and CW rings can be mirrored. Rotation is locked
// to the spoke base (not the per-bullet `d`) so all 8 bullets in a spoke
// share visual orientation.
function firePhaseARing(self: Entity, pivot: number, fanSign: number, tint: number | null): void {
  for (let line = 0; line < PHASE_A_RING_LINES; line++) {
    const direction = pivot + line * PHASE_A_LINE_STEP;
    const rotation = Math.PI / 2 + direction;
    for (let k = 0; k < PHASE_A_BULLETS_PER_LINE; k++) {
      const speed = PHASE_A_SPEED_FIRST + k * PHASE_A_SPEED_INC;
      const d = direction + fanSign * k * PHASE_A_BULLET_ANGLE_STEP;
      const b = self.spawn(straightReport, self.x, self.y, Math.cos(d) * speed, Math.sin(d) * speed);
      b.setRotation(rotation);
      if (tint !== null) b.setTint(tint);
      else b.clearTint();
    }
  }
}

// Phase B helper: spawn one 12-bullet ring of tinted paper, radial at
// PHASE_B_RING_SPEED with the pivot bullet pointing along `pivotAngle`.
// Tint is set per-spawn (pool reuse would otherwise carry stale colors);
// rotation aligns the report sprite (authored facing up) with the
// outbound velocity by adding π/2 to atan2.
function firePhaseBRing(self: Entity, tint: number, pivotAngle: number): void {
  const step = (Math.PI * 2) / PHASE_B_BULLETS_PER_RING;
  for (let k = 0; k < PHASE_B_BULLETS_PER_RING; k++) {
    const a = pivotAngle + k * step;
    const vx = Math.cos(a) * PHASE_B_RING_SPEED;
    const vy = Math.sin(a) * PHASE_B_RING_SPEED;
    const b = self.spawn(straightReport, self.x, self.y, vx, vy);
    b.setTint(tint);
    b.setRotation(Math.PI / 2 + Math.atan2(vy, vx));
  }
}

// Hodges's Phase-D three-shot aimed spread. Larger and pink so the
// punctuation reads cleanly over the orbiter spirals — see the texture
// generator in content/textures.ts for the matching 12×12 sprite.
const hodgesSpreadBullet = new EnemyBulletEntityKind({
  sprite: 'pinkBullet',
  hitboxRadius: 6,
});

// Phase C helper: drive the boss horizontally from its current x to `targetX`
// at PHASE_C_BOSS_SPEED, dropping a tinted email bullet at every random
// 1–10-frame interval. Tint follows direction of motion (yellow leftward,
// red rightward). Snaps to target on arrival to absorb sub-pixel drift so
// successive sweeps stay aligned.
function* mailSweep(self: Entity, targetX: number): Generator<ScriptYield, void, void> {
  const dx = targetX - self.x;
  const dist = Math.abs(dx);
  if (dist < 1) return;
  const totalFrames = Math.max(1, Math.round((dist / PHASE_C_BOSS_SPEED) * SCRIPT_FPS));
  const dir = Math.sign(dx);
  const tint = dir < 0 ? PHASE_C_TINT_YELLOW : PHASE_C_TINT_RED;

  self.setVelocity(dir * PHASE_C_BOSS_SPEED, 0);
  let nextDrop = 1 + Math.floor(Math.random() * 10);

  for (let t = 0; t < totalFrames; t++) {
    if (t === nextDrop) {
      const shift = Math.floor(PHASE_C_SPAWN_Y_JITTER * Math.random()) - PHASE_C_SPAWN_Y_JITTER / 2;
      const b = self.spawn(emailBullet, self.x, self.y + shift, self.body.velocity.x * PHASE_C_VEL_INHERIT, 0);
      b.body.setAcceleration(0, PHASE_C_GRAVITY);
      b.setTint(tint);
      nextDrop = t + 1 + Math.floor(Math.random() * 10);
    }
    yield 1;
  }
  self.setVelocity(0, 0);
  self.x = targetX;
}

// Beat between Hodges's bubble going up and the shudder starting, so
// the line has time to read before he begins juddering.
const DEFEAT_PRE_SHUDDER_FRAMES = 24;
const DEFEAT_BUBBLE_FRAMES =
  DEFEAT_PRE_SHUDDER_FRAMES + FLICKER_TOGGLES * FLICKER_INTERVAL_FRAMES + POST_FLICKER_HOLD_FRAMES + 14;

// Hodges's lethal-hit script. Stage-2 part 1's KAEDALUS_LONG halts for
// the dramatic beat; the bubble goes up, then the standard shudder
// runs and KAEDALUS_SHORT — the next sub-stage's loop — is restarted
// from t=0 just before die(), so part 2 can be timed against a known
// music clock. The next chain function's idempotent `startMusicLoop`
// observes KAEDALUS_SHORT already running and is a no-op.
function* shrunkOldManDeath(self: Entity): Generator<ScriptYield, void, void> {
  const m = pauseMusicForDefeat(KAEDALUS_SHORT_KEY);
  self.body.setVelocity(0, 0);
  self.body.enable = false;
  self.say('Thirty-one years… all gone…', DEFEAT_BUBBLE_FRAMES);
  yield DEFEAT_PRE_SHUDDER_FRAMES;
  yield* bossShudder(self);
  m.restart();
  self.die();
}

function* shrunkOldManScript(self: Entity) {
  // Slow shuffle to anchor. BossKind makes him unhittable on spawn so
  // the player can't melt him before he's said his piece; becomeHittable
  // below opts back into damage after the dialogue.
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  yield 30;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'geezer', frame: 1, name: 'Mr. Hodges' },
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

  // Claim the HUD header now that the fight is actually starting; release it
  // on death (covers both natural defeat and forced cleanup via release(),
  // which calls die() too).
  self.stage.bossName = 'Mr. Hodges';
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  becomeHittable(self);
  self.say('Just a few old tasks…', 110);
  yield 60;

  // Loops until the lethal hit lands, at which point takeDamage swaps
  // this script out for shrunkOldManDeath via runScript.
  while (true) {
    self.say('Could you finish these reports?', 100);
    {
      let pivotCcw = PHASE_A_PIVOT_START;
      let pivotCw = PHASE_A_PIVOT_START;
      for (let t = 0; t < PHASE_A_DURATION_F; t++) {
        if (t % PHASE_A_RING_GAP_F === 0) {
          firePhaseARing(self, pivotCcw, +1, null); // CCW, untinted
          pivotCcw += PHASE_A_PIVOT_STEP_CCW;
        }
        if (t % PHASE_A_RING_GAP_F === PHASE_A_OFFSET_F) {
          firePhaseARing(self, pivotCw, -1, PHASE_A_TINT_RED); // CW, red, mirrored fan
          pivotCw += PHASE_A_PIVOT_STEP_CW;
        }
        yield 1;
      }
    }
    // 2-second beat between phases A and B — Hodges drops his hands and the
    // dual rings clear the field before the filing-cabinet sweep begins.
    yield 2 * SCRIPT_FPS;

    self.say('And these go in the filing cabinet…', 110);
    for (let rep = 0; rep < PHASE_B_CYCLES; rep++) {
      for (let t = 0; t < PHASE_B_CYCLE_F; t++) {
        // Wall fill: vertical-up bullet from a random x on the bottom edge,
        // plus a pair of side-cross bullets from random y on each inner wall.
        // White `bullet` to contrast with the red/blue paper rings.
        if (t % PHASE_B_WALL_VERT_CADENCE === 0) {
          self.spawn(bullet, WALL_W + Math.random() * (GAME_W - 2 * WALL_W), GAME_H, 0, -PHASE_B_WALL_SPEED);
        }
        if (t % PHASE_B_WALL_SIDE_CADENCE === 0) {
          self.spawn(bullet, WALL_W, Math.random() * GAME_H, PHASE_B_WALL_SPEED, 0);
          self.spawn(bullet, GAME_W - WALL_W, Math.random() * GAME_H, -PHASE_B_WALL_SPEED, 0);
        }
        // Red sub-phase: pivot starts pointing down, walks clockwise.
        if (t < PHASE_B_RED_END && t % PHASE_B_RING_GAP_F === 0) {
          const i = t / PHASE_B_RING_GAP_F;
          firePhaseBRing(self, PHASE_B_TINT_RED, PHASE_B_PIVOT_START + i * PHASE_B_PIVOT_STEP);
        } else if (
          t >= PHASE_B_BLUE_START &&
          t < PHASE_B_BLUE_END &&
          (t - PHASE_B_BLUE_START) % PHASE_B_RING_GAP_F === 0
        ) {
          // Blue sub-phase: same starting pivot, walks counterclockwise.
          const i = (t - PHASE_B_BLUE_START) / PHASE_B_RING_GAP_F;
          firePhaseBRing(self, PHASE_B_TINT_BLUE, PHASE_B_PIVOT_START - i * PHASE_B_PIVOT_STEP);
        }
        yield 1;
      }
    }
    yield PHASE_GAP;

    self.say('I never did get to these…', 120);
    for (let rep = 0; rep < PHASE_C_REPEATS; rep++) {
      yield* mailSweep(self, PHASE_C_LEFT_X); //   center → left   (yellow)
      yield* mailSweep(self, PHASE_C_RIGHT_X); //  sweep 1         (red)
      yield* mailSweep(self, PHASE_C_LEFT_X); //   sweep 2         (yellow)
      yield* mailSweep(self, PHASE_C_RIGHT_X); //  sweep 3         (red)
      yield* mailSweep(self, PHASE_C_CENTER_X); // return → left   (yellow)
    }
    yield PHASE_GAP;

    self.say('They keep coming back to me…', 110);
    for (let rep = 0; rep < PHASE_D_CYCLES; rep++) {
      const orbiters: Entity[] = [];
      for (let i = 0; i < 2; i++) {
        const phase = i * Math.PI;
        const sign = 2 * i - 1;
        const tint = PHASE_D_TINTS[i] ?? null;
        const x0 = self.x + Math.cos(phase) * PHASE_D_R;
        const y0 = self.y + Math.sin(phase) * PHASE_D_R;
        const o = self.spawn(bullet, x0, y0, 0, 0, {
          script: function* (e) {
            let t = 0;
            while (e.alive) {
              const theta = phase + (t / PHASE_D_PERIOD_F) * Math.PI * 2;
              e.body.reset(self.x + Math.cos(theta) * PHASE_D_R, self.y + Math.sin(theta) * PHASE_D_R);
              if (t % PHASE_D_FIRE_EVERY === 0) {
                const ovx = -Math.sin(theta) * PHASE_D_R * PHASE_D_OMEGA;
                const ovy = Math.cos(theta) * PHASE_D_R * PHASE_D_OMEGA;
                const aim = 5 * theta;
                const step = (Math.PI * 2) / 5;
                for (let k = 0; k < 5; k++) {
                  const a = sign * (aim + k * step);
                  const vx = Math.cos(a) * PHASE_D_SHOT_SPEED + ovx;
                  const vy = Math.sin(a) * PHASE_D_SHOT_SPEED + ovy;
                  const b = e.spawn(straightReport, e.x, e.y, vx, vy);
                  // reportBullet sprite faces up; +π/2 rotates it to align
                  // with the actual velocity vector after the tangent carry.
                  b.setRotation(Math.PI / 2 + Math.atan2(vy, vx));
                  if (tint !== null) b.setTint(tint);
                  else b.clearTint();
                }
              }
              yield 1;
              t++;
            }
          },
        });
        orbiters.push(o);
        // If Hodges takes lethal damage mid-phase, runScript swaps the boss
        // script for shrunkOldManDeath and the post-phase cleanup loop below
        // never runs — without this hook the orbiters would survive into the
        // next wave, still orbiting a dead boss.
        self.onDeath(() => {
          if (o.alive) o.die();
        });
      }
      for (let i = 0; i < PHASE_D_REPEATS; i++) {
        aimed(self, PHASE_D_SPREAD_COUNT, hodgesSpreadBullet, PHASE_D_SPREAD_SPEED, PHASE_D_SPREAD_RAD);
        yield PHASE_D_GAP;
      }
      // Tear the orbiters down before the next cycle (or before yielding
      // back to phase A) so the field starts clean.
      for (const o of orbiters) if (o.alive) o.die();
    }
    yield PHASE_GAP;
  }
}

export const shrunkOldMan = new BossKind({
  sprite: 'geezer',
  hitboxRadius: 22,
  hp: 450,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: shrunkOldManScript,
  deathScript: shrunkOldManDeath,
});

export function* shrunkOldManWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'mr. hodges');
  self.stage.scheduleMultDrop('boss');
  // Music setup (KAEDALUS_LONG) is owned by the chain function
  // (`fromShrunkOldMan`) — both the live chain and the standalone
  // practice entry route through it. The lethal-hit script below
  // performs the mid-stage hand-off to KAEDALUS_SHORT.
  // Same opening beat as the final-boss wave: don't bring him on while
  // leftover enemies are still drifting around, sweep stragglers, brief
  // pause for funereal tone, then he shuffles in. BossKind keeps him
  // unhittable on spawn; his script calls becomeHittable after the
  // dialogue.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(shrunkOldMan, GAME_W / 2, -30, 0, 0);
    yield { until: boss };
  });
}
