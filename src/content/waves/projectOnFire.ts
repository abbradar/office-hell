import { GAME_W, SCRIPT_FPS, WALL_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { ring } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { nextOrdinaryCoworkerSprite } from '../characters';
import { PIXEL_FIRE_KEY } from '../textures';

// Project On Fire: three panicked coworkers stampede south from the
// upstream edge of the corridor, screaming about the burning project, then
// stop near the upper door band and start drifting around at random while
// continuing to spew rings of fire pellets. The panic doesn't end when
// they stop running — it just gets less directed.
//
// Bullet density is anchored to a literal "step between bullets": the
// per-ring count is back-solved from `2π · RING_REF_RADIUS / BULLET_STEP_PX`
// so adjacent bullets sit ~10 px apart on the formed ring at the chosen
// reference radius. `ring()` itself spawns every bullet at the firer's
// centre and lets them radiate outward, so the step describes the
// visual spacing as the ring expands past the reference radius, not a
// literal spawn-time offset.

const SPAWN_Y = -30;
// Front-door stop band: just inside the playfield, low enough that
// 2-line speech bubbles still fit above the speaker (≥ ~95 px per the
// stage-design "speakers must leave room for the bubble" rule).
const STOP_Y = 130;
const ENTRY_SPEED = 170;
const EXIT_SPEED = 320;

const BULLET_STEP_PX = 16;
const RING_REF_RADIUS = 60;
const RING_COUNT = Math.max(4, Math.round((2 * Math.PI * RING_REF_RADIUS) / BULLET_STEP_PX));
const RING_SPEED = 130;
const FIRE_INTERVAL = Math.round(0.5 * SCRIPT_FPS);

// Wander loop — once a runner reaches its stop band, every WANDER_STEP_*
// frames it picks a fresh random heading and drifts that way at
// WANDER_SPEED. Bounces off the corridor walls + a tight y-band so the
// panic stays in the upper third of the field instead of migrating onto
// the player. The y floor matches STOP_Y so a runner that turns north
// can't drift back through the entry corridor on top of an unspawned
// volley.
const WANDER_SPEED = 95;
const WANDER_STEP_MIN_FRAMES = 30;
const WANDER_STEP_MAX_FRAMES = 80;
const WANDER_X_MARGIN = WALL_W + 28;
const WANDER_Y_MIN = 90;
const WANDER_Y_MAX = 240;

const SCREAM_LINE = 'Our project\nis on fire!';
const SCREAM_FRAMES = 80;
const SCREAM_INTERVAL_MIN = 130;
const SCREAM_INTERVAL_MAX = 220;

const RUNNER_HP = 14;
// Safety bound — every runner exits after this many frames even if the
// player camps and lets them shout indefinitely. Sized to give a focused
// attacker enough headroom to clean the trio at a reasonable damage
// rate before the timer expires.
const FIGHT_DURATION_FRAMES = 60 * 18;

// Pixel-fire bullet — 8×10 flame sprite. No `rotateToVelocity`: flame
// art reads the same at any heading and a rotation would just add
// per-frame jitter the eye can pick up on the spinning ring.
export const fireBullet = new EnemyBulletEntityKind({
  sprite: PIXEL_FIRE_KEY,
  hitboxRadius: 3,
});

function randInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function makeRunnerScript(runnerIndex: number): EntityScript {
  return function* (self: Entity) {
    // Stagger fire + scream offsets so the three runners aren't perfectly
    // in sync — every entity tick fires the same gated check, the
    // staggered initial counters keep them out of lockstep.
    let fireCounter = runnerIndex * Math.floor(FIRE_INTERVAL / 3);
    let screamCounter = 40 + runnerIndex * 28 + randInRange(0, 30);

    const fire = () => {
      if (fireCounter <= 0) {
        // `ring()` no-ops while the firer is off-screen, so the first
        // few entry frames at y < 0 don't drop a stray volley above
        // the playfield. Counter still resets — the rhythm survives.
        ring(self, RING_COUNT, fireBullet, RING_SPEED, Math.random() * Math.PI * 2);
        fireCounter = FIRE_INTERVAL;
      } else {
        fireCounter--;
      }
    };
    const scream = () => {
      if (screamCounter <= 0) {
        self.say(SCREAM_LINE, SCREAM_FRAMES);
        screamCounter = randInRange(SCREAM_INTERVAL_MIN, SCREAM_INTERVAL_MAX);
      } else {
        screamCounter--;
      }
    };

    let elapsed = 0;

    // Phase 1 — sprint south to the upper door band. Drive the velocity
    // directly instead of `moveTo` so the firing + scream counters keep
    // ticking through the run-in; moveTo would park the script for the
    // whole transit.
    self.setVelocity(0, ENTRY_SPEED);
    while (self.y < STOP_Y && elapsed < FIGHT_DURATION_FRAMES) {
      yield 1;
      elapsed++;
      fire();
      scream();
    }
    self.setVelocity(0, 0);

    // Phase 2 — wander loop. Random heading per leg, bouncing off the
    // wander box's sides + caps so the panic stays in the upper third.
    while (elapsed < FIGHT_DURATION_FRAMES) {
      const a = Math.random() * Math.PI * 2;
      let vx = Math.cos(a) * WANDER_SPEED;
      let vy = Math.sin(a) * WANDER_SPEED;
      self.setVelocity(vx, vy);
      const legFrames = randInRange(WANDER_STEP_MIN_FRAMES, WANDER_STEP_MAX_FRAMES);
      for (let i = 0; i < legFrames && elapsed < FIGHT_DURATION_FRAMES; i++) {
        yield 1;
        elapsed++;
        if (self.x < WANDER_X_MARGIN && vx < 0) {
          vx = -vx;
          self.setVelocity(vx, vy);
        } else if (self.x > GAME_W - WANDER_X_MARGIN && vx > 0) {
          vx = -vx;
          self.setVelocity(vx, vy);
        }
        if (self.y < WANDER_Y_MIN && vy < 0) {
          vy = -vy;
          self.setVelocity(vx, vy);
        } else if (self.y > WANDER_Y_MAX && vy > 0) {
          vy = -vy;
          self.setVelocity(vx, vy);
        }
        fire();
        scream();
      }
    }

    // Phase 3 — retreat back up the way they came; the cull margin
    // tears them down once they cross past y = -CULL_MARGIN.
    self.setVelocity(0, -EXIT_SPEED);
  };
}

export const projectOnFireRunner = new HPEntityKind({
  sprite: 'whiteMale1',
  hitboxRadius: 16,
  hp: RUNNER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

export function* projectOnFireWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'project on fire');
  self.stage.scheduleMultDrop('regular');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    const positions = [GAME_W * 0.25, GAME_W * 0.5, GAME_W * 0.75];
    for (let i = 0; i < positions.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by length
      self.spawn(projectOnFireRunner, positions[i]!, SPAWN_Y, 0, 0, {
        script: makeRunnerScript(i),
        sprite: nextOrdinaryCoworkerSprite(self.stage),
      });
    }
  });
}
