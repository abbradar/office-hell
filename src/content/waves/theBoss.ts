import { STAGE2_METAL_LOOP_KEY, STAGE2_METAL_OPENING_KEY } from '../../audio/keys';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind, becomeHittable, bossShudder } from '../../script/boss';
import { aimed, arc, moveTo, ring } from '../../script/patterns';
import { clearBullets, markWave, prepareForBoss, startMusicWithIntro, suspendRunning } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// --- The Boss: enters from top, anchors, cycles three attack patterns until dead ---

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;

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

  // Pre-fight dialogue.
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

  // Become hittable.
  becomeHittable(self);
  self.say('Shrink the workforce!', 110);
  yield 110;

  // Repeating attack cycle. Loops until the lethal hit lands, at which
  // point takeDamage swaps this script out for the boss death script
  // via runScript.
  while (true) {
    // Phase 1: aimed shotgun bursts
    self.say('Performance review!', 90);
    for (let i = 0; i < 5; i++) {
      aimed(self, 5, bullet, 200, Math.PI / 6);
      yield 28;
    }
    yield 30;

    // Phase 2: rotating multi-rings
    self.say('Touch base!', 90);
    for (let i = 0; i < 4; i++) {
      ring(self, 16, bullet, 130, i * (Math.PI / 16));
      yield 22;
    }
    yield 30;

    // Phase 3: wide downward arcs
    self.say('Align the deliverables!', 110);
    for (let i = 0; i < 6; i++) {
      arc(self, 11, bullet, 170, Math.PI / 6, (5 * Math.PI) / 6);
      yield 32;
    }
    yield 60;
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
  hp: 65,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: theBossScript,
  deathScript: theBossDeath,
});

export function* theBossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  // Idempotent in live flow (stage2Part2 already switched to stage-2
  // metal at the KAEDALUS_SHORT seam); switches in from menu music when
  // run from the practice menu.
  yield* startMusicWithIntro(STAGE2_METAL_OPENING_KEY, STAGE2_METAL_LOOP_KEY);
  // Don't open the encounter while leftovers are still on screen. Sweep
  // enemies + in-flight bullets, brief beat, then bring on the boss.
  // BossKind makes all bosses spawn unhittable; the boss's own script
  // handles entry, dialogue, and calls becomeHittable() once it's done.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(theBoss, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });
}
