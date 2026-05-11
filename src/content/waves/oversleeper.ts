import { shoot } from '../../audio/sfx/events';
import { BULLET_RADIUS, GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { checkStageOnce, markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Oversleeper: a colleague who slept in and now wants you to recap the entire
// morning. Drives down to mid-screen, asks a question, then fires a single
// continuous stream of 16 spiral rings on a 20-frame cadence. Rings
// alternate per index between white circles (expanding clockwise) and
// neckties (expanding counterclockwise); each is an Archimedean spiral
// expanding at EXPAND_SPEED while sweeping through TURN_F frames per
// full revolution. After the 16th ring, the coworker drops straight
// down off-screen.

const ENTRY_SPEED = 110;
const ENTRY_Y = 110;
const EXIT_SPEED = 220;

// Spiral ring tuning. RING_GAP_F is the cadence between rings; the spiral
// itself unfolds analytically via per-bullet position assignment, so its
// motion is independent of RING_GAP_F (rings overlap freely at this
// cadence — the alternating CW/CCW direction keeps consecutive rings
// from spawning bullets at identical positions, even at the smallest
// gaps).
const RING_GAP_F = 20;
const BULLETS_PER_RING = 20;
const EXPAND_SPEED = 200; // px/s radial
const TURN_F = 20 * SCRIPT_FPS; // 20 s for a full pivot revolution
const OMEGA = (Math.PI * 2) / TURN_F; // rad/frame
const ANGLE_STEP = (Math.PI * 2) / BULLETS_PER_RING;
const EXPAND_PX_PER_F = EXPAND_SPEED / SCRIPT_FPS;
// One uninterrupted run of 16 rings — no barrage breaks. ringIndex sweeps
// 0 → 15 so the white/necktie alternation runs the full cycle.
const TOTAL_RINGS = 16;

const SAY_FRAMES = 90;
const BEFORE_FIRE_GAP = 35;

// Scriptless necktie variant — the canonical `necktie` kind (declared in
// fashionExpert.ts) ships a homing default script that would yank each
// bullet off the spiral. Declaring our own non-homing kind keeps the
// analytic-spiral driver in `fireSpiralRing` the sole controller of
// motion. Cross-wave imports avoided; only the texture key (`'necktie'`)
// is shared.
const spiralNecktie = new EnemyBulletEntityKind({
  sprite: 'necktie',
  hitboxRadius: BULLET_RADIUS,
});

// One spiral ring of BULLETS_PER_RING bullets. Even-indexed rings expand
// clockwise as plain white circles; odd-indexed rings expand
// counterclockwise as neckties. Each bullet's per-frame script drives
// position via body.reset(), so velocity stays at 0 and the cull-margin
// check still releases the entity once it sweeps off the field.
function fireSpiralRing(self: Entity, ringIndex: number): void {
  const dir = ringIndex % 2 === 0 ? +1 : -1;
  const kind = ringIndex % 2 === 0 ? bullet : spiralNecktie;
  const cx = self.x;
  const cy = self.y;
  for (let i = 0; i < BULLETS_PER_RING; i++) {
    const theta0 = i * ANGLE_STEP;
    self.spawn(kind, cx, cy, 0, 0, {
      script: function* (e: Entity) {
        let t = 0;
        while (e.alive) {
          const r = EXPAND_PX_PER_F * t;
          const theta = theta0 + dir * OMEGA * t;
          e.body.reset(cx + r * Math.cos(theta), cy + r * Math.sin(theta));
          // Necktie sprite is authored facing down (π/2); rotate so the
          // tie tip points along the outward radial direction. No-op
          // visual on the circular `bullet`; keeps the script symmetric.
          e.setRotation(theta - Math.PI / 2);
          yield 1;
          t++;
        }
      },
    });
  }
}

function* oversleeperScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  if (checkStageOnce(self, 'oversleeper:introShown')) {
    const ch = self.stage.player.character;
    yield self.dialogue({
      left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
      right: { sprite: 'overslept', frame: 1, name: 'Coworker' },
      lines: [
        { speaker: 'right', text: 'Damn, overslept a bit.' },
        { speaker: 'left', text: "It's 9 PM." },
      ],
    });
  }

  self.say('Any updates from the standup?', SAY_FRAMES);
  yield BEFORE_FIRE_GAP;
  for (let ringIndex = 0; ringIndex < TOTAL_RINGS; ringIndex++) {
    shoot();
    fireSpiralRing(self, ringIndex);
    yield RING_GAP_F;
  }

  self.setVelocity(0, EXIT_SPEED);
}

export const oversleeper = new HPEntityKind({
  sprite: 'overslept',
  hitboxRadius: 16,
  hp: 22,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: oversleeperScript,
});

// Demo wave: a single oversleeper, mid-column, so the test exercises the
// spiral barrage cleanly without other enemies interfering.
export function* oversleeperWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'oversleeper');
  self.stage.scheduleMultDrop('regular');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    self.spawn(oversleeper, GAME_W * 0.5, -30, 0, 0);
  });
}
