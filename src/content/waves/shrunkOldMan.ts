import { KAEDALUS_SHORT_KEY } from '../../audio/keys';
import { GAME_W } from '../../config';
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
import type { ScriptYield } from '../../script/types';
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
  }
}

export const shrunkOldMan = new BossKind({
  sprite: 'geezer',
  hitboxRadius: 22,
  hp: 72,
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
