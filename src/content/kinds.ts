import { BULLET_RADIUS, GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import { BossKind, becomeHittable } from '../script/boss';
import { aimed, arc, moveTo, ring } from '../script/patterns';
import { EntityKind } from '../script/types';

export const bullet = new EntityKind({
  sprite: 'bullet',
  hitboxRadius: BULLET_RADIUS,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

export const playerBullet = new EntityKind({
  sprite: 'playerBullet',
  // Slightly bigger than the visible 6×16 bullet sprite so the player's
  // shots reward minor positioning errors (Bullet Hell Shmup Design 101:
  // "give the player's shots huge hitboxes").
  hitboxRadius: 5,
  hp: null,
  damageClass: ['enemy'],
  damagedByClass: [],
});

// --- Boss: enters from top, anchors, cycles three attack patterns until dead ---

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;

function* bossScript(self: Entity) {
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

  // Repeating attack cycle while alive
  while (self.alive) {
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

export const bossOne = new BossKind({
  sprite: 'boss',
  hitboxRadius: 24,
  hp: 65,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: bossScript,
});
