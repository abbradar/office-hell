import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind, becomeHittable } from '../../script/boss';
import { aimed, moveTo, ring } from '../../script/patterns';
import { markWave, prepareForBoss, suspendRunning } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { pillBullet } from './pillBullet';
import { reportBullet } from './reportBullet';

// Wellness Coach: shows up unannounced for an "urgent wellness improvement
// session". She cycles three attacks — breathing exercise, "personality
// test" paperwork blizzard, and a vitamin barrage — narrating each one
// because of course she does.
//
// Phase 1 — breathing: bullet rings converge on her from beyond the screen
// edges while she says "slowly breath in...", then the same ring layout
// blows back outward (faster) on "...then out!". "From outside the screen"
// is implemented by spawning the inbound ring at SPAWN_RADIUS around the
// coach with each bullet's velocity pointed back at her. The radius is
// chosen so all spawn points sit past the screen edge from her stand
// position near the top centre — bullets cross into view as they travel
// inward, which sells the inhale.
//
// Phase 2 — personality test: a flurry of report-paper bullets fired from
// the coach in fully random directions. We override `script: null` on
// each spawn so the reports do NOT home (the per-bullet homing script on
// reportBullet would pull every shot back at the player and turn this
// into a death trap); they fly in straight lines, so the player just
// has to read the gaps in the random scatter and weave through.
//
// Phase 3 — vitamins: tight aimed barrages of two-tone capsule bullets.
// Narrow spread + repeating bursts so the player has to keep moving
// laterally between volleys — standing still while the coach restocks
// her clipboard is a hit guarantee.

const ENTRY_SPEED = 110;
const ENTRY_X = GAME_W / 2;
const ENTRY_Y = 110;

// --- Phase 1: breathing -------------------------------------------------

const SPAWN_RADIUS = 360;
const RING_COUNT = 24;
const IN_SPEED = 80;
const OUT_SPEED = 170;

const IN_RINGS = 5;
const IN_RING_GAP = 38;
const IN_TO_OUT_GAP = 28;
const OUT_RINGS = 4;
const OUT_RING_GAP = 14;
const PHASE_GAP = 36;

const IN_SAY = 'Slowly\nbreath in...';
const OUT_SAY = '...then\nout!';
const IN_SAY_FRAMES = IN_RINGS * IN_RING_GAP + IN_TO_OUT_GAP;
const OUT_SAY_FRAMES = OUT_RINGS * OUT_RING_GAP + 4;

// --- Phase 2: personality test -----------------------------------------

const TEST_BURSTS = 5;
const TEST_PER_BURST = 14;
const TEST_BURST_GAP = 26;
const TEST_SPEED = 135;
const TEST_SAY = 'Quick\nPERSONALITY\nTEST!';
const TEST_SAY_FRAMES = TEST_BURSTS * TEST_BURST_GAP + 12;

// --- Phase 3: vitamins --------------------------------------------------

const VIT_BURSTS = 6;
const VIT_PER_BURST = 6;
const VIT_BURST_GAP = 24;
const VIT_SPEED = 200;
const VIT_SPREAD = Math.PI / 20;
const VIT_SAY = 'Have you taken\nyour SUPPLEMENTS?!';
const VIT_SAY_FRAMES = VIT_BURSTS * VIT_BURST_GAP + 12;

// Spawn `count` bullets evenly placed on a circle of radius SPAWN_RADIUS
// around the coach, each headed straight back toward her at `speed`.
function ringFromOutside(self: Entity, count: number, speed: number, baseAngle: number): void {
  shoot();
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i * Math.PI * 2) / count;
    const sx = self.x + Math.cos(angle) * SPAWN_RADIUS;
    const sy = self.y + Math.sin(angle) * SPAWN_RADIUS;
    self.spawn(bullet, sx, sy, -Math.cos(angle) * speed, -Math.sin(angle) * speed);
  }
}

// Fire `count` reports from the coach in fully random directions, each
// in a straight line (script: null disables the default homing script
// on reportBullet). Used by the personality-test phase — the random
// scatter is the readability hook; homing on top of it would erase the
// gaps the player needs to weave through.
function scatterReports(self: Entity, count: number, speed: number): void {
  shoot();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    self.spawn(reportBullet, self.x, self.y, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      script: null,
    });
  }
}

function* coachScript(self: Entity) {
  // BossKind keeps her unhittable on spawn so the player can't melt her
  // before she's said her piece; becomeHittable below opts back into
  // damage after the dialogue.
  yield* moveTo(self, ENTRY_X, ENTRY_Y, ENTRY_SPEED);

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'coach1', frame: 1, name: 'Coach Becky' },
    lines: [
      { speaker: 'right', text: "Hi-i! I'm here for your URGENT wellness improvement session!" },
      { speaker: 'left', text: "I'm fine, honestly. I just want to leave." },
      { speaker: 'right', text: 'Your cortisol is SCREAMING, sweetie. Mindful breathing — together!' },
      { speaker: 'left', text: '…that does not feel optional.' },
    ],
  });

  // Claim the HUD header now that the fight is starting; release it on
  // death so the corridor doesn't keep her name pinned afterwards.
  self.stage.bossName = 'Coach Becky';
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  becomeHittable(self);

  while (self.alive) {
    // Phase 1 — Inhale: rings converge on the coach from beyond the screen.
    self.say(IN_SAY, IN_SAY_FRAMES);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < IN_RINGS; i++) {
      if (!self.alive) return;
      ringFromOutside(self, RING_COUNT, IN_SPEED, baseAngle);
      baseAngle += Math.PI / 24;
      yield IN_RING_GAP;
    }
    yield IN_TO_OUT_GAP;

    // Phase 1 — Exhale: same ring layout, blown back outward, faster.
    self.say(OUT_SAY, OUT_SAY_FRAMES);
    for (let i = 0; i < OUT_RINGS; i++) {
      if (!self.alive) return;
      ring(self, RING_COUNT, bullet, OUT_SPEED, baseAngle);
      baseAngle += Math.PI / 24;
      yield OUT_RING_GAP;
    }
    yield PHASE_GAP;

    // Phase 2 — Personality test: random-direction reports, no homing.
    self.say(TEST_SAY, TEST_SAY_FRAMES);
    for (let i = 0; i < TEST_BURSTS; i++) {
      if (!self.alive) return;
      scatterReports(self, TEST_PER_BURST, TEST_SPEED);
      yield TEST_BURST_GAP;
    }
    yield PHASE_GAP;

    // Phase 3 — Vitamins: aimed pill barrages with a narrow spread.
    self.say(VIT_SAY, VIT_SAY_FRAMES);
    for (let i = 0; i < VIT_BURSTS; i++) {
      if (!self.alive) return;
      aimed(self, VIT_PER_BURST, pillBullet, VIT_SPEED, VIT_SPREAD);
      yield VIT_BURST_GAP;
    }
    yield PHASE_GAP;
  }
}

export const wellnessCoach = new BossKind({
  sprite: 'coach1',
  hitboxRadius: 22,
  hp: 400,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: coachScript,
});

export function* wellnessCoachWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'wellness coach');
  // Field clean + brief beat, then she enters. BossKind keeps her
  // unhittable on spawn; her script calls becomeHittable after the
  // dialogue.
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const coach = self.spawn(wellnessCoach, GAME_W / 2, -30, 0, 0);
    yield { until: coach };
  });
}
