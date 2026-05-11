import { KAEDALUS_SHORT_KEY } from '../../audio/keys';
import { BULLET_RADIUS, GAME_W } from '../../config';
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
import { aimed, arc, moveTo, ring } from '../../script/patterns';
import { markWave, prepareForBoss, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { reportBullet } from './reportBullet';

// Stage boss: a sad, retired old man "shrunk" from the company. Security is
// already on his shoulder — he just wants to pass his pile of unfinished
// tasks to someone before he's escorted out. Patterns lean slow and tired —
// drifting paperwork rather than aggressive volleys, but enough of it that
// standing still is not an option.

const ENTRY_SPEED = 60;
const ENTRY_Y = 100;

const PHASE_GAP = 50;

// Phase A — "old reports": tired homing paperwork aimed at the player. Wide
// spread so a single sidestep doesn't dodge the whole cloud, but the homing
// rate is the reportBullet default — drift laterally and they go past.
const PHASE_A_REPEATS = 5;
const PHASE_A_GAP = 32;
const PHASE_A_COUNT = 5;
const PHASE_A_SPEED = 130;
const PHASE_A_SPREAD = Math.PI / 4;

// Phase B — "the filing cabinet": slow rings nudging round a pivot. Bullet
// type, not paper, so the ring reads as office clutter rather than a second
// homing wave on top of phase A's.
const PHASE_B_REPEATS = 5;
const PHASE_B_GAP = 38;
const PHASE_B_RING_COUNT = 16;
const PHASE_B_RING_SPEED = 105;

// Phase C — "the long hand-off": wide downward arcs of paperwork. Slower
// than phase A, no homing (already past the launch window), so this is the
// "safe" phase where the player can mostly drill damage.
const PHASE_C_REPEATS = 5;
const PHASE_C_GAP = 36;
const PHASE_C_COUNT = 9;
const PHASE_C_SPEED = 115;

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

// Scriptless variant of reportBullet for the orbiter spirals — the
// canonical reportBullet kind has a homing default script, which would
// re-aim every spawned bullet at the player and erase the spiral. We
// want the carried tangent velocity to define each bullet's trajectory,
// so we use the sprite without the homing behaviour.
const orbiterShot = new EnemyBulletEntityKind({
  sprite: 'reportBullet',
  hitboxRadius: BULLET_RADIUS,
});

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
    for (let i = 0; i < PHASE_A_REPEATS; i++) {
      aimed(self, PHASE_A_COUNT, reportBullet, PHASE_A_SPEED, PHASE_A_SPREAD);
      yield PHASE_A_GAP;
    }
    yield PHASE_GAP;

    self.say('And these go in the filing cabinet…', 110);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < PHASE_B_REPEATS; i++) {
      ring(self, PHASE_B_RING_COUNT, bullet, PHASE_B_RING_SPEED, baseAngle);
      baseAngle += Math.PI / PHASE_B_RING_COUNT;
      yield PHASE_B_GAP;
    }
    yield PHASE_GAP;

    self.say('I never did get to these…', 120);
    for (let i = 0; i < PHASE_C_REPEATS; i++) {
      arc(self, PHASE_C_COUNT, reportBullet, PHASE_C_SPEED, Math.PI / 6, (5 * Math.PI) / 6);
      yield PHASE_C_GAP;
    }
    yield PHASE_GAP;

    self.say('They keep coming back to me…', 110);
    const orbiters: Entity[] = [];
    for (let i = 0; i < 2; i++) {
      const phase = i * Math.PI;
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
                const a = aim + k * step;
                const vx = Math.cos(a) * PHASE_D_SHOT_SPEED + ovx;
                const vy = Math.sin(a) * PHASE_D_SHOT_SPEED + ovy;
                const b = e.spawn(orbiterShot, e.x, e.y, vx, vy);
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
      aimed(self, PHASE_D_SPREAD_COUNT, bullet, PHASE_D_SPREAD_SPEED, PHASE_D_SPREAD_RAD);
      yield PHASE_D_GAP;
    }
    // Tear the orbiters down before yielding back to phase A so the next
    // cycle starts from a clean field.
    for (const o of orbiters) if (o.alive) o.die();
    yield PHASE_GAP;
  }
}

export const shrunkOldMan = new BossKind({
  sprite: 'geezer',
  hitboxRadius: 22,
  hp: 200,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: shrunkOldManScript,
  deathScript: shrunkOldManDeath,
});

export function* shrunkOldManWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'mr. hodges');
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
