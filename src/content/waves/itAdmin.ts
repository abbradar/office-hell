import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// IT Admin (the modern stand-in for the old "sysop"): drives in from the top,
// harangues the player about overdue password changes, and fires triangular
// "arrow" packs of bullets aimed at the player. Each arrow is twelve bullets
// laid out as a long pointed triangle, all spawned the same frame with the
// same velocity — they hold formation in flight, so the player reads the
// arrow and dodges the whole shape rather than tracking individual bullets.

const ENTRY_SPEED = 100;
const ENTRY_Y = 90;

// SAY_FRAMES is tuned so the second admin's bubble (line 2) finishes right as
// the first admin's last bubble (line 3) begins — see the schedule in
// itAdminsWave. Bumping it past 100 will reintroduce overlap.
const SAY_FRAMES = 100;
const VOLLEYS = 4;
const VOLLEY_GAP = 95;
const ADMIN_STAGGER = 90;

const ARROW_SPEED = 200;
// Arrow geometry, in the arrow's local frame (forward = aim, lateral = ⊥).
// ROW_STEP: spacing between successive rows along the flight axis.
// ROW_GAP : perpendicular spacing between adjacent bullets within a row.
// GAP=27 puts the 11-bullet base row at 10*27 = 270 px wide — ~2/3 of the
// 400 px playfield. Adjacent bullets in a row leave ~27 - 6 = 21 px of clear
// space, plenty for the player (hitbox r=4) to thread between them. Head-on
// dodging the entire arrow is impractical at this width — the intended play
// is to commit to a lane between two bullets and graze diagonally through.
const ARROW_ROW_STEP = 14;
const ARROW_ROW_GAP = 27;

const EXIT_SPEED = 220;

// Arrow shape: seven rows widening from a 1-bullet tip to an 11-bullet base,
// plus a repeated 11-bullet "fletch" trailing row so the arrow reads as a
// pointed triangle with a heavy tail rather than a thin spike. 47 bullets
// total. Generated rather than hand-listed so the row math stays readable.
const ARROW_ROWS: readonly { step: number; count: number }[] = [
  { step: +3, count: 1 },
  { step: +2, count: 3 },
  { step: +1, count: 5 },
  { step: 0, count: 7 },
  { step: -1, count: 9 },
  { step: -2, count: 11 },
  { step: -3, count: 11 },
];

const ARROW_LAYOUT: readonly [number, number][] = ARROW_ROWS.flatMap(({ step, count }) => {
  const f = step * ARROW_ROW_STEP;
  const half = (count - 1) / 2;
  const row: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    row.push([f, (i - half) * ARROW_ROW_GAP]);
  }
  return row;
});

function shootArrow(self: Entity): void {
  const aim = self.angleToPlayer();
  const cos = Math.cos(aim);
  const sin = Math.sin(aim);
  // Lateral basis = aim rotated +90°. Used to convert the local (f, p) layout
  // into world offsets so the triangle is always oriented along its flight.
  const lx = -sin;
  const ly = cos;
  const vx = cos * ARROW_SPEED;
  const vy = sin * ARROW_SPEED;

  shoot();
  for (const [f, p] of ARROW_LAYOUT) {
    const x = self.x + cos * f + lx * p;
    const y = self.y + sin * f + ly * p;
    self.spawn(bullet, x, y, vx, vy);
  }
}

// Per-volley speech schedule. Each entry is the line to speak at that volley
// index, or null to fire silently. Both admins fire on every volley regardless
// of their speech schedule — only the bubbles are gated.
type SpeechSchedule = readonly (string | null)[];

function makeITAdminScript(speech: SpeechSchedule): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < VOLLEYS; i++) {
      if (!self.alive) return;
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);
      shootArrow(self);
      yield VOLLEY_GAP;
    }

    self.setVelocity(0, EXIT_SPEED);
  };
}

export const itAdmin = new EntityKind({
  sprite: 'sysop',
  hitboxRadius: 16,
  hp: 18,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Demo wave: two IT admins from opposite halves, staggered so a focused player
// can drop one before the second's arrows arrive. Spawn positions are pulled
// in toward centre (0.4 / 0.6 instead of 0.3 / 0.7) because the arrow's base
// spans ~2/3 of the screen — admins any closer to the side walls would spawn
// the outer bullets off-screen.
//
// Speech is split across both admins so no single sprite gets bubble-spammed
// faster than SAY_FRAMES. Schedule (relative to admin1's first volley):
//   t=0    admin1 v0 → "Change your email password. Now."
//   t=185  admin2 v1 → "Your last reset was 91 days ago."   (90 stagger + 95 gap)
//   t=285  admin1 v3 → '"Password1!" does not count.'        (skipped if dead)
// Each bubble lives 100f (SAY_FRAMES), so line 2 ends exactly as line 3 begins.
export function* itAdminsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'it admin');
  yield* suspendRunning(self, function* () {
    const admin1Speech: SpeechSchedule = [
      'Change your email password. Now.',
      null,
      null,
      '"Password1!" does not count.',
    ];
    const admin2Speech: SpeechSchedule = [null, 'Your last reset was 91 days ago.', null, null];

    self.spawn(itAdmin, GAME_W * 0.4, -30, 0, 0, { script: makeITAdminScript(admin1Speech) });
    yield ADMIN_STAGGER;
    self.spawn(itAdmin, GAME_W * 0.6, -30, 0, 0, { script: makeITAdminScript(admin2Speech) });
  });
}
