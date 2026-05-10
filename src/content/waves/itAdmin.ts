import { shoot } from '../../audio/sfx/events';
import { DEADZONE_Y, GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// IT Admin (the modern stand-in for the old "sysop"): two of them drive in
// from the top, harangue the player about overdue password changes, and
// fire from opposite halves of the screen. The first admin shoots
// consecutive vertical lasers from the top edge in classic Touhou form —
// a thin "starter laser" runs the full path during the telegraph window,
// with a brighter pulsing source at the top so the player can read the
// column to dodge out of, then a thick three-cell-wide white-cored laser
// fires along the same path. The second admin keeps the legacy "arrow"
// pack: twelve bullets laid out as a long pointed triangle aimed at the
// player, all moving in formation so the dodge is read on the shape
// rather than individual bullets.

const ENTRY_SPEED = 100;
const ENTRY_Y = 90;

const SAY_FRAMES = 100;
const ADMIN_STAGGER = 90;
const EXIT_SPEED = 220;

// --- Vertical-beam admin -------------------------------------------------

// Beam timings. A beam (warning + lethal + gap) fits in roughly one
// second; with BEAM_VOLLEYS = 6 that gives the admin ~6s of firing on top
// of their entry / exit. Player speed is 280 px/s ≈ 4.7 px/frame, and
// the lethal beam is 24 px wide so dodging requires the player centre to
// move > 16 px from the beam centre — ~3-4 frames of travel. The
// 22-frame (≈0.37s) warning leaves the rest as reaction headroom.
const WARNING_FRAMES = 22;
const LASER_FRAMES = 14;
const BEAM_VOLLEY_GAP = 16;
const BEAM_VOLLEYS = 6;

// Beam construction. Cells are 8×8 (chartCell sprite) laid centre-to-centre
// at BEAM_CELL_STEP so adjacent cells touch with no gap — a wall of
// hitboxes the player can't graze through. The lethal beam is three rows
// thick (24 px wide) for the chunky Touhou look, with a bright white
// core flanked by tinted outer rows. The starter laser is one row thick
// (8 px wide) at low alpha so the player can read the path without it
// reading as part of the lethal hit.
const BEAM_CELL_STEP = 8;
const BEAM_THICKNESS_ROWS = 3;
const BEAM_OUTER_TINT = 0xff5577;
const BEAM_CORE_TINT = 0xffffff;
const STARTER_TINT = 0xff5577;
const STARTER_ALPHA = 0.4;
const SOURCE_FLASH_TINT = 0xffd96a;

// Non-damaging cell used to telegraph a beam. Same sprite + size as the
// lethal beamLaser so the warning's source flash transitions visually
// into the lethal cell occupying the same pixels.
const beamWarning = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 4,
  hitboxShape: 'square',
  hp: null,
  damageClass: [],
  damagedByClass: [],
});

// Lethal beam segment. damageClass: ['player'] so the player takes a hit
// from any cell they overlap; hp: null so the beam isn't shootable by
// the player's own bullets — it just times out on its own per-bullet script.
const beamLaser = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 4,
  hitboxShape: 'square',
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

// Fire one beam from (sx, sy) to (ex, ey). Phase 1: Touhou-style starter
// laser — a thin faint row of cells along the full path so the player
// can see exactly which lane is about to be lethal — plus a brighter
// pulsing source flash at (sx, sy) drawing the eye to the origin. Phase
// 2: the chunky lethal beam, three rows thick with a bright white core
// flanked by tinted outer rows. Each spawned cell self-destructs on its
// per-bullet script, so a mid-flight admin death (script cancelled by
// the outer race) leaves no orphans on the field.
function* fireBeam(self: Entity, sx: number, sy: number, ex: number, ey: number): Generator<ScriptYield, void, void> {
  const dx = ex - sx;
  const dy = ey - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const ux = dx / dist;
  const uy = dy / dist;
  // Lateral basis = beam direction rotated +90°. Used to offset the outer
  // rows of the thick lethal beam perpendicular to its flight axis.
  const lx = -uy;
  const ly = ux;
  const count = Math.max(2, Math.ceil(dist / BEAM_CELL_STEP) + 1);

  // Phase 1a — starter laser: thin faint row along the full path.
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const px = sx + dx * t;
    const py = sy + dy * t;
    self.spawn(beamWarning, px, py, 0, 0, {
      script: function* (b: Entity): Generator<ScriptYield, void, void> {
        b.setTint(STARTER_TINT);
        b.setAlpha(STARTER_ALPHA);
        yield WARNING_FRAMES;
        if (b.alive) b.die();
      },
    });
  }

  // Phase 1b — pulsing source flash at the beam start. Spawned after the
  // starter row so it draws on top of the dim path-preview cell at the
  // same coords. Scale ramps from 1.5× to 3× over the warning so the
  // cell visibly "charges up", and the alpha pulse adds a flicker the
  // player can read peripherally.
  self.spawn(beamWarning, sx, sy, 0, 0, {
    script: function* (b: Entity): Generator<ScriptYield, void, void> {
      b.setTint(SOURCE_FLASH_TINT);
      for (let t = 0; t < WARNING_FRAMES && b.alive; t++) {
        const phase = t / WARNING_FRAMES;
        b.setScale(1.5 + phase * 1.5);
        b.setAlpha(0.7 + 0.3 * Math.abs(Math.sin(phase * Math.PI * 5)));
        yield 1;
      }
      if (b.alive) b.die();
    },
  });

  yield WARNING_FRAMES;

  // Phase 2 — lethal beam. BEAM_THICKNESS_ROWS parallel rows offset by
  // BEAM_CELL_STEP perpendicular to the flight axis; cells along each
  // row touch edge-to-edge so the slab reads (and hits) as one
  // continuous laser. The middle row is a bright white core; outer rows
  // carry the tinted halo. With BEAM_THICKNESS_ROWS = 3, the beam spans
  // 24 px (one cell either side of the core).
  shoot();
  const halfRows = (BEAM_THICKNESS_ROWS - 1) / 2;
  for (let r = 0; r < BEAM_THICKNESS_ROWS; r++) {
    const off = (r - halfRows) * BEAM_CELL_STEP;
    const ox = lx * off;
    const oy = ly * off;
    const isCore = r === Math.floor(BEAM_THICKNESS_ROWS / 2);
    const tint = isCore ? BEAM_CORE_TINT : BEAM_OUTER_TINT;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const px = sx + dx * t + ox;
      const py = sy + dy * t + oy;
      self.spawn(beamLaser, px, py, 0, 0, {
        script: function* (b: Entity): Generator<ScriptYield, void, void> {
          b.setTint(tint);
          yield LASER_FRAMES;
          if (b.alive) b.die();
        },
      });
    }
  }

  yield LASER_FRAMES;
}

// --- Arrow admin ---------------------------------------------------------

const ARROW_VOLLEYS = 4;
const ARROW_VOLLEY_GAP = 95;
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

// --- Scripts -------------------------------------------------------------

// Per-volley speech schedule. Each entry is the line to speak at that volley
// index, or null to fire silently. Both admins fire on every volley regardless
// of their speech schedule — only the bubbles are gated.
type SpeechSchedule = readonly (string | null)[];

function makeBeamAdminScript(speech: SpeechSchedule): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < BEAM_VOLLEYS; i++) {
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);
      const aimX = self.stage.player.x;
      // Beam spawns at DEADZONE_Y so the source flash + starter laser
      // sit just under the 28-px HUD strip — anything spawned at y = 0
      // is occluded by the panel (depth 99), which is why an earlier
      // version of this telegraph was effectively invisible.
      yield* fireBeam(self, aimX, DEADZONE_Y, aimX, GAME_H);
      yield BEAM_VOLLEY_GAP;
    }

    self.setVelocity(0, EXIT_SPEED);
  };
}

function makeArrowAdminScript(speech: SpeechSchedule): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < ARROW_VOLLEYS; i++) {
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);
      shootArrow(self);
      yield ARROW_VOLLEY_GAP;
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

// Demo wave: two IT admins from opposite halves of the screen, staggered so
// the player is dodging the laser admin a beat before the arrow admin
// piles on. The 0.4 / 0.6 spawn x's pull the sprites in from the side
// walls so neither straddles a door panel during entry, and keep the
// arrow admin's wide base row inside the playfield.
//
// Speech is split across both admins so no single sprite gets bubble-spammed.
// Schedule (relative to the laser admin's first volley):
//   t=0    laser v0 → "Change your email password. Now."
//   t=185  arrow v1 → "Your last reset was 91 days ago."   (90 stagger + 95 arrow gap)
//   t=260  laser v5 → '"Password1!" does not count.'        (5 × 52 beam-period)
// Each bubble lives 100f (SAY_FRAMES); lines 2 and 3 overlap by ~25f near the
// end, which is well past the active reading window.
export function* itAdminsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'it admin');
  yield* suspendRunning(self, function* () {
    const laserSpeech: SpeechSchedule = [
      'Change your email password. Now.',
      null,
      null,
      null,
      null,
      '"Password1!" does not count.',
    ];
    const arrowSpeech: SpeechSchedule = [null, 'Your last reset was 91 days ago.', null, null];

    self.spawn(itAdmin, GAME_W * 0.4, -30, 0, 0, {
      script: makeBeamAdminScript(laserSpeech),
    });
    yield ADMIN_STAGGER;
    self.spawn(itAdmin, GAME_W * 0.6, -30, 0, 0, {
      script: makeArrowAdminScript(arrowSpeech),
    });
  });
}
