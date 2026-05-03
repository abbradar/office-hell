import { BULLET_RADIUS, GAME_H } from '../config';
import type { Entity } from '../entities/Entity';
import { aimed, arc, ring, spread } from '../script/patterns';
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
  hitboxRadius: 3,
  hp: null,
  damageClass: ['enemy'],
  damagedByClass: [],
});

// --- Streamer: drifts down with a sine-wave x, fires aimed shots periodically ---

const STREAMER_FIRE_CUTOFF_Y = GAME_H * 0.75;

function* streamerScript(self: Entity) {
  const baseX = self.x;
  self.setVelocity(0, 90);
  self.say('Got a sec?', 80);
  let frame = 0;
  while (true) {
    self.x = baseX + Math.sin(frame * 0.06) * 50;
    // Stop firing once they've passed three-quarters of the way down — the
    // player needs an unmolested lane to dodge into as the streamer exits.
    if (frame % 50 === 30 && self.y < STREAMER_FIRE_CUTOFF_Y) aimed(self, 1, bullet, 200);
    frame++;
    yield 0;
  }
}

export const streamer = new EntityKind({
  sprite: 'coworker1',
  animKey: 'coworker1_walk',
  hitboxRadius: 10,
  hp: 3,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: streamerScript,
});

// --- Fan shooter: drives in, stops, fires downward spreads, leaves ---

function* fanShooterScript(self: Entity) {
  self.setVelocity(0, 110);
  yield 60;
  self.setVelocity(0, 0);
  self.say('Synergize harder!', 90);
  for (let i = 0; i < 4; i++) {
    spread(self, 5, bullet, 180, Math.PI / 2, Math.PI / 4);
    yield 50;
  }
  self.setVelocity(0, 220);
}

export const fanShooter = new EntityKind({
  sprite: 'coworker1',
  animKey: 'coworker1_walk',
  hitboxRadius: 12,
  hp: 6,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: fanShooterScript,
});

// --- Ring spinner: drives in, stops, fires rotating rings, leaves ---

function* ringSpinnerScript(self: Entity) {
  self.setVelocity(0, 100);
  yield 80;
  self.setVelocity(0, 0);
  self.say("Let's circle back.", 90);
  let baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < 5; i++) {
    ring(self, 14, bullet, 130, baseAngle);
    baseAngle += Math.PI / 14;
    yield 35;
  }
  self.setVelocity(0, 220);
}

export const ringSpinner = new EntityKind({
  sprite: 'coworker2',
  animKey: 'coworker2_walk',
  hitboxRadius: 12,
  hp: 7,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: ringSpinnerScript,
});

// --- Driver (existing): rams toward player while shooting rings ---

const DRIVE_SPEED = 80;
const APPROACH_SPEED = 120;
const EXIT_SPEED = 200;

const DRIVE_FRAMES = 70;
const RAMS_BEFORE_EXIT = 3;
const FRAMES_BETWEEN_RAMS = 50;

const RING_COUNT = 14;
const RING_SPEED = 130;

function* driverScript(self: Entity) {
  self.setMotion(Math.PI / 2, DRIVE_SPEED);
  self.say('Move fast!', 70);
  yield DRIVE_FRAMES;

  ring(self, RING_COUNT, bullet, RING_SPEED, Math.random() * Math.PI * 2);

  for (let i = 0; i < RAMS_BEFORE_EXIT; i++) {
    self.setMotion(self.angleToPlayer(), APPROACH_SPEED);
    yield FRAMES_BETWEEN_RAMS;
    ring(self, RING_COUNT, bullet, RING_SPEED, Math.random() * Math.PI * 2);
  }

  self.setMotion(Math.PI / 2, EXIT_SPEED);
}

export const driver = new EntityKind({
  sprite: 'coworker2',
  animKey: 'coworker2_walk',
  hitboxRadius: 12,
  hp: 9,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: driverScript,
});

// --- Boss: enters from top, anchors, cycles three attack patterns until dead ---

function* bossScript(self: Entity) {
  // Entry — boss flies down from above to his fight position. He's spawned
  // unhittable (damagedByClass: [] override at the spawn site) so player bullets
  // pass through during entrance and dialogue.
  self.setVelocity(0, 110);
  yield 80;
  self.setVelocity(0, 0);
  yield 20;

  // Pre-fight dialogue.
  const ch = self.pool.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss1', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Working hard, I see. Or hardly working?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: 'Home is where the deliverables are aligned.' },
      { speaker: 'left', text: 'That… does not mean anything.' },
      { speaker: 'right', text: "Let's circle back on that — after your performance review." },
    ],
  });

  // Become hittable.
  self.setDamagedByClasses(['enemy']);
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

export const bossOne = new EntityKind({
  sprite: 'boss1',
  animKey: 'boss1_walk',
  hitboxRadius: 18,
  hp: 65,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: bossScript,
});
