import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind, becomeHittable, bossShudder } from '../../script/boss';
import { moveTo, ring } from '../../script/patterns';
import { clearBullets, markWave, prepareForBoss, suspendRunning, waitSeconds } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// --- The Boss: enters from top, anchors, cycles three attack patterns until dead ---

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;

// Coach Becky has 400 HP; the final boss is balanced at 1.5× that for
// a longer, more punishing feel.
const BOSS_HP = 600;

function* theBossScript(self: Entity) {
  // Entry — boss flies down from above to his fight position. BossKind
  // forces damagedByClass: [] at construction so all bosses spawn
  // unhittable (player bullets pass through during entrance + dialogue);
  // becomeHittable below opts back into the original damage classes.
  // moveTo computes the travel time from distance + speed so the
  // dialogue can't fire before he's actually arrived (the previous
  // frame-counted entry would land short on displays whose RAF outran
  // 60 Hz).
  yield* moveTo(self, GAME_W / 2, BOSS_ENTRY_Y, BOSS_ENTRY_SPEED);
  yield BOSS_HOLD_BEFORE_TALK;

  // Pre-fight dialogue. The opening track is already looping under us
  // (theBossWave started it before the dialog) and stays in that loop
  // through the fight.
  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Working hard, I see. Or hardly working?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: 'Home is where the deliverables are aligned.' },
      { speaker: 'left', text: 'That… does not mean anything.' },
      { speaker: 'right', text: "Let's circle back on that — after your performance review." },
    ],
  });

  // Claim the HUD header now that the fight is actually starting; release it
  // on death (covers both natural defeat and forced cleanup via release(),
  // which calls die() too).
  self.stage.bossName = 'The Boss';
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  // The opening keeps looping under the fight (started by `fromTheBoss`
  // before the wave) — there's no separate main melody to switch into.
  becomeHittable(self);
  self.say('Shrink the workforce!', 110);

  const BPM_STEP = 60 / 113;
  let spiralAngle = 0;
  const spiralSpeed = 120;

  // Repeating attack cycle. Kicks off on the first beat of the main
  // loop. Loops until the lethal hit lands, at which point takeDamage
  // swaps this script out for the boss death script via runScript.
  while (true) {
    ring(self, 64, bullet, spiralSpeed, spiralAngle);
    spiralAngle += 0.01;
    yield* waitSeconds(BPM_STEP);
  }
}

// Final-boss death: lock motion, run the (placeholder) parting dialogue,
// then sweep in-flight bullets so the ending scene opens on a clean
// field, then the standard shudder.
function* theBossDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [{ speaker: 'right', text: 'TODO: final boss defeat line.' }],
  });

  clearBullets(self);

  yield* bossShudder(self);
  self.die();
}

export const theBoss = new BossKind({
  sprite: 'boss',
  hitboxRadius: 24,
  hp: BOSS_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: theBossScript,
  deathScript: theBossDeath,
});

export function* theBossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  // Music setup (loop the retro-03 opening under the entire encounter,
  // with a leading seam wait) is owned by the chain function
  // (`fromTheBoss`) — both the live chain and the standalone practice
  // entry route through it.
  // Don't open the encounter while leftovers are still on screen. Sweep
  // enemies + in-flight bullets, brief beat, then bring on the boss.
  // BossKind makes all bosses spawn unhittable; theBossScript handles
  // entry, dialogue, and calls becomeHittable() once dialog dismisses.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(theBoss, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });
}
