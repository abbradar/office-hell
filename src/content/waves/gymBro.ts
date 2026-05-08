import { playJump, playThump, shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind } from '../../script/boss';
import { aimed, moveTo, ring } from '../../script/patterns';
import { clearBullets, markWave, prepareForBoss, race, suspendRunning } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Gym Bro (Brad): two-phase mid-boss. Phase 1 is the "current barrage" cycle
// — short rhythmic shouts and aimed/ring/arc volleys. When his first HP pool
// empties he shudders, the field clears, and he switches to a leg-day
// routine: parabolic jumps left↔right with a thump-on-landing aimed cone, and
// a winded circle barrage between rep sets.

// --- Phase 1 ---

const PHASE_ONE_HP = 100;
const ENTRY_SPEED = 110;
// Spawn lands at y = -60 (off-screen above); ENTRY_Y is where he plants
// for the dialogue. moveTo computes the travel time from this y + speed,
// so the dialogue can't fire before he's actually arrived — the previous
// frame-counted entry gave the wrong duration on high-refresh displays
// and the dialogue bubbles popped while Brad was still off-screen.
const ENTRY_Y = 87;
const HOLD_BEFORE_TALK = 20;
const POST_DIALOGUE_HOLD = 110;
// Sprite is 48px wide; ±22px reads as a shoulder firing point without the
// muzzle bullet visibly clipping past his silhouette.
const SHOULDER_OFFSET = 22;

// --- Phase 2 ---

// Second pool starts here. Phase-2 attacks aren't continuous — they only fire
// at the four landings + the rest beat — so this is sized smaller than phase 1
// to keep the leg-day routine from outstaying its welcome.
const PHASE_TWO_HP = 40;
const JUMPS_PER_CYCLE = 4;
const JUMP_FRAMES = 36;
const JUMP_PEAK_OFFSET = -110;
// Boss is 48px wide; an ~80px inset keeps him fully on screen at the apex
// even with the parabolic overshoot the easing produces near the edges.
const JUMP_LEFT_X = 80;
const JUMP_RIGHT_X = GAME_W - 80;
const JUMP_HOME_X = GAME_W / 2;
// Far enough below the HUD (28px header) that the sprite's apex (home Y +
// peak offset = 60) plus its 24px half-height still clears the bar. Phase 1
// has him idling higher up at the entry stop; phase 2 slides him down to
// this line so the jumps stay fully on-screen.
const JUMP_HOME_Y = 170;
const PHASE_TWO_SLIDE_SPEED = 90;
const LANDING_HOLD = 18;
const CONE_BULLETS = 10;
const CONE_SPREAD = Math.PI / 4;
const CONE_SPEED = 190;
// Slow on purpose — the rest beat between rep sets is the player's window to
// unload damage on a stationary, panting boss.
const REST_RING_BULLETS = 22;
const REST_RING_SPEED = 90;

// Boss-death flicker is FLICKER_TOGGLES * FLICKER_INTERVAL_FRAMES +
// POST_FLICKER_HOLD_FRAMES = 56 frames; pad the bubble a touch beyond that so
// the line stays readable right up until die() flips alive=false and the
// bubble manager auto-clears it.
const DEFEAT_LINE_FRAMES = 70;

// Custom kind override so phase-1 damage gets pinned at zero instead of
// killing the boss. The phase-1 race below polls `self.vars.phaseOneDown`
// for the transition; phase-2 takeDamage falls through to BossKind, which
// routes the lethal hit through the shared boss-death animation.
class GymBroKind extends BossKind {
  override takeDamage(self: Entity, amount: number): void {
    if (self.hp === null) return;
    if (self.vars?.phaseTwo === true) {
      if (self.hp - amount <= 0) {
        self.say('My muscles will soon shrink like a balloon...', DEFEAT_LINE_FRAMES);
      }
      super.takeDamage(self, amount);
      return;
    }
    self.hp -= amount;
    if (self.hp <= 0) {
      self.hp = 0;
      self.vars ??= {};
      self.vars.phaseOneDown = true;
      return;
    }
    self.flashDamage();
  }
}

// Small spread fired from one of Brad's shoulders rather than dead centre.
// Inlined here because none of the patterns.ts helpers take an origin offset
// and this is the only caller that needs one.
function sideSweep(self: Entity, side: -1 | 1, count: number, speed: number, aim: number, spreadRad: number): void {
  shoot();
  const ox = self.x + side * SHOULDER_OFFSET;
  const oy = self.y;
  const step = count > 1 ? spreadRad / (count - 1) : 0;
  const start = aim - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    const a = start + i * step;
    self.spawn(bullet, ox, oy, Math.cos(a) * speed, Math.sin(a) * speed);
  }
}

// Alternating dumbbell curls — small aimed sweeps from one shoulder, then
// the other. Each volley re-rolls bullet count and cone width; the aim is
// computed from the firing shoulder (not the boss centre) so both sides
// converge on the player's actual position instead of crossing past it.
function* shoulderCurls(self: Entity): Generator<ScriptYield, void, void> {
  const reps = 7 + Math.floor(Math.random() * 4);
  let side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
  for (let i = 0; i < reps; i++) {
    const count = 3 + Math.floor(Math.random() * 2);
    const ox = self.x + side * SHOULDER_OFFSET;
    const player = self.stage.player;
    const aim = Math.atan2(player.y - self.y, player.x - ox);
    sideSweep(self, side, count, 230, aim, Math.PI / 9 + Math.random() * (Math.PI / 12));
    side = -side as -1 | 1;
    yield 12 + Math.floor(Math.random() * 6);
  }
}

// Counter-rotating hula — two ring trains layered on top of each other,
// going opposite directions at different angular rates and bullet speeds.
// Reads as two circles spinning past each other rather than one clean
// expanding spiral. Bullet counts and rotation rates are tuned to leave
// gaps too narrow to stand in: the slow shell traps the player against the
// fast one, so dodging requires lateral motion rather than a static safe
// column.
function* hulaSpin(self: Entity): Generator<ScriptYield, void, void> {
  const reps = 7 + Math.floor(Math.random() * 3);
  let angleA = Math.random() * Math.PI * 2;
  let angleB = Math.random() * Math.PI * 2;
  const dirA: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  const dirB: 1 | -1 = -dirA as 1 | -1;
  // Asymmetric step ranges — one ring crawls, the other sweeps fast — so
  // even a randomly-aligned safe wedge between the two shells closes within
  // a couple of waves.
  const stepA = Math.PI / 20 + Math.random() * (Math.PI / 12);
  const stepB = Math.PI / 12 + Math.random() * (Math.PI / 8);
  const speedA = 95 + Math.random() * 35;
  const speedB = 165 + Math.random() * 55;
  const countA = 15 + Math.floor(Math.random() * 3);
  const countB = 15 + Math.floor(Math.random() * 3);
  for (let i = 0; i < reps; i++) {
    ring(self, countA, bullet, speedA, angleA);
    ring(self, countB, bullet, speedB, angleB);
    angleA += dirA * stepA;
    angleB += dirB * stepB;
    yield 18 + Math.floor(Math.random() * 6);
  }
}

const PHASE_ONE_PATTERNS = [shoulderCurls, hulaSpin];

function* phaseOneBarrage(self: Entity): Generator<ScriptYield, void, void> {
  // Single shout ("Make me sweat!") fires from the outer script before this
  // loop runs. Sub-patterns are picked at random per cycle and each one
  // re-rolls its own parameters internally, so two adjacent runs of the same
  // pick still play differently.
  while (self.alive) {
    const idx = Math.floor(Math.random() * PHASE_ONE_PATTERNS.length);
    // biome-ignore lint/style/noNonNullAssertion: bounded by PHASE_ONE_PATTERNS.length
    yield* PHASE_ONE_PATTERNS[idx]!(self);
    yield 28 + Math.floor(Math.random() * 24);
  }
}

// Polls each frame for the transition signal the kind override sets when
// phase-1 HP runs out. Lives as the loser's race partner — when this resolves,
// the barrage above gets dropped mid-volley.
function* waitPhaseOneDown(self: Entity): Generator<ScriptYield, void, void> {
  while (self.alive && self.vars?.phaseOneDown !== true) yield 1;
}

// 4 * (1-t) * t parabola; peak at t=0.5 lands at fromY + JUMP_PEAK_OFFSET.
// Velocity is forced to zero each frame so the body doesn't drift between
// position assignments.
function* parabolicJump(
  self: Entity,
  fromX: number,
  fromY: number,
  toX: number,
  frames: number,
): Generator<ScriptYield, void, void> {
  for (let f = 1; f <= frames; f++) {
    const t = f / frames;
    self.body.setVelocity(0, 0);
    self.x = fromX + (toX - fromX) * t;
    self.y = fromY + JUMP_PEAK_OFFSET * 4 * t * (1 - t);
    yield 1;
  }
  self.body.setVelocity(0, 0);
  self.x = toX;
  self.y = fromY;
}

function* phaseTwoCycle(self: Entity): Generator<ScriptYield, void, void> {
  while (self.alive) {
    let landX = JUMP_HOME_X;
    let landY = JUMP_HOME_Y;
    for (let i = 0; i < JUMPS_PER_CYCLE; i++) {
      // Alternate sides; the home-position jump-off lands left first, then
      // ping-pongs.
      const targetX = i % 2 === 0 ? JUMP_LEFT_X : JUMP_RIGHT_X;
      playJump();
      yield* parabolicJump(self, landX, landY, targetX, JUMP_FRAMES);
      playThump();
      landX = targetX;
      landY = JUMP_HOME_Y;
      // "One!" / "Two!" alternates per rep — caller asked for these two
      // shouts specifically, so we cycle them rather than counting all four.
      self.say(i % 2 === 0 ? 'One!' : 'Two!', LANDING_HOLD + 30);
      // Aimed cone fires immediately on landing (aim is captured at call
      // time, not tracked) — give the player a beat to read it before the
      // next jump.
      aimed(self, CONE_BULLETS, bullet, CONE_SPEED, CONE_SPREAD);
      yield LANDING_HOLD;
    }

    // Return to centre, pant, slow circle.
    playJump();
    yield* parabolicJump(self, landX, landY, JUMP_HOME_X, JUMP_FRAMES);
    playThump();
    self.say('Pant... pant...', 120);
    yield 20;
    ring(self, REST_RING_BULLETS, bullet, REST_RING_SPEED, Math.random() * Math.PI * 2);
    yield 90;
  }
}

function* gymBroScript(self: Entity) {
  yield* moveTo(self, JUMP_HOME_X, ENTRY_Y, ENTRY_SPEED);
  yield HOLD_BEFORE_TALK;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'gymBro', frame: 1, name: 'Brad' },
    lines: [
      {
        speaker: 'right',
        text: `Hey. ${ch.name}, wait! Can you do a little favor for me?`,
      },
      { speaker: 'left', text: "What's it, Brad? I'm kinda busy here." },
      {
        speaker: 'right',
        text: 'I really need to go to the gym now, can you finish the slides?',
      },
      {
        speaker: 'left',
        text: 'WHAT? You were supposed to have them ready two days ago!',
      },
      {
        speaker: 'right',
        text: 'Sorry, but I need you to deal with that. Leg day is a must, metabolism is real.',
      },
      {
        speaker: 'left',
        text: "…I don't think this word means what you think it means.",
      },
    ],
  });

  // Claim the HUD header now that the fight is actually starting; release it
  // on death (covers both natural defeat and forced cleanup via release(),
  // which calls die() too).
  self.stage.bossName = 'Brad';
  self.onDeath(() => {
    self.stage.bossName = null;
  });

  // --- Phase 1 ---
  self.setDamagedByClasses(['enemy']);
  self.say('Make me sweat!', POST_DIALOGUE_HOLD);
  yield POST_DIALOGUE_HOLD;

  yield* race(phaseOneBarrage(self), waitPhaseOneDown(self));
  if (!self.alive) return;

  // --- Transition: shudder, clear field, leg-day declaration ---
  self.setDamagedByClasses([]);
  self.body.setVelocity(0, 0);
  // Five quick flashes spread over ~50 frames so the silhouette visibly
  // judders before the screen goes quiet.
  for (let i = 0; i < 5; i++) {
    self.flashDamage();
    yield 10;
  }
  // clearScreen would sweep the boss too — he sits in damages.player
  // alongside the bullets — so use the bullet-only variant.
  clearBullets(self);
  yield 20;

  self.say('Leg day!', 80);
  // Slide down to the jump baseline so the parabola's apex stays clear of
  // the HUD; runs concurrently with the "Leg day!" bubble so the beat reads
  // as him squaring up rather than dead air. moveTo finishes well before
  // the say's 80-frame window expires; the trailing yield pads the slot.
  yield* moveTo(self, JUMP_HOME_X, JUMP_HOME_Y, PHASE_TWO_SLIDE_SPEED);
  yield 30;

  // --- Phase 2 ---
  self.vars ??= {};
  self.vars.phaseTwo = true;
  self.hp = PHASE_TWO_HP;
  self.setDamagedByClasses(['enemy']);

  yield* phaseTwoCycle(self);
}

export const gymBro = new GymBroKind({
  sprite: 'gymBro',
  hitboxRadius: 18,
  hp: PHASE_ONE_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: gymBroScript,
});

// Wave wrapper that mirrors the final boss's entrance pattern: clear the
// field, beat, then drop the boss in spawned-unhittable so his own script
// can run entry + dialogue before becoming damageable.
export function* gymBroWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'gym bro');
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(gymBro, GAME_W / 2, -60, 0, 0, {
      damagedByClass: [],
    });
    yield { until: boss };
  });
}
