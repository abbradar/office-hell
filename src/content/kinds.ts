import { STAGE2_METAL_LOOP_KEY, STAGE2_METAL_OPENING_KEY } from '../audio/keys';
import { getCurrentTrackInfo } from '../audio/music/loop';
import { BULLET_RADIUS, GAME_W, SCRIPT_FPS } from '../config';
import type { Entity } from '../entities/Entity';
import { BossKind, becomeHittable } from '../script/boss';
import { aimed, arc, moveTo, ring } from '../script/patterns';
import { race, startMusicWithIntro, waitAudioTimeAtLeast, waitSeconds } from '../script/stage';
import { EntityKind, type ScriptYield } from '../script/types';

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

// 113 BPM matches the metal track's tempo. One beat at 60 Hz simulation
// = 60 / 113 × SCRIPT_FPS ≈ 31.86 frames; rounded to 32 puts the ring
// spawns on the song's downbeat. The pre-fight ring spam fires once per
// beat for that "the boss is firing on the music" feel.
const RING_FRAMES_PER_BEAT = Math.round((60 / 113) * SCRIPT_FPS);

// Coach Becky has 400 HP; the final boss is balanced at 1.5× that to
// give the metal-loop fight a longer, more punishing feel without
// dragging into the second loop iteration on a perfect run.
const BOSS_HP = 600;

function* bossScript(self: Entity): Generator<ScriptYield, void, void> {
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
  // (stage2Part2 started it before the wave) so the dialog plays under
  // the intro motif on loop — tension without committing to the main
  // melody.
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

  // Switch off the looping intro and into the real intro→loop sequence.
  // The intro plays once more as a pre-roll into the main melody; we
  // race the boss's pre-fight ring spam against the intro duration so
  // the heavy patterns kick in exactly when the loop takes over.
  yield* startMusicWithIntro(STAGE2_METAL_OPENING_KEY, STAGE2_METAL_LOOP_KEY);
  becomeHittable(self);
  self.say('Shrink the workforce!', 110);
  const introDuration = getCurrentTrackInfo()?.introDuration ?? 0;
  // yield* race(simpleRingSpam(self), waitAudioTimeAtLeast(introDuration));

  const BPM_STEP = 60 / 113;
  let spiral_angle1 = 0;
  const speed1 = 120;

  // Repeating attack cycle while alive — kicks off on the first beat
  // of the main loop.
  while (self.alive) {
    ring(self, 64, bullet, speed1, spiral_angle1);
    spiral_angle1 += 0.01
    yield* waitSeconds(BPM_STEP);
  }
}

// Pre-fight ramp-up: a single bullet ring on every 113-BPM beat. Runs
// forever while the boss is alive; the caller races this against the
// intro duration so it's cancelled the moment the main loop hits.
function* simpleRingSpam(self: Entity): Generator<ScriptYield, void, void> {
  while (self.alive) {
    ring(self, 12, bullet, 130);
    yield RING_FRAMES_PER_BEAT;
  }
}

export const bossOne = new BossKind({
  sprite: 'boss',
  hitboxRadius: 24,
  hp: BOSS_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: bossScript,
});
