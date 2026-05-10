import { shoot } from '../../audio/sfx/events';
import { DEADZONE_Y, GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { exitThroughSideDoor, markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// IT Admin (the modern stand-in for the old "sysop"): two of them drive in
// from the top, harangue the player about overdue password changes, and
// fire from opposite halves of the screen. The first admin shoots
// consecutive vertical lasers from the top edge in classic Touhou form —
// a thin "starter laser" runs the full path during the telegraph window,
// with a brighter pulsing source at the top so the player can read the
// column to dodge out of, then a thick gradient beam fires straight
// down: a bright white core, a mid-alpha pink halo, and a soft outer
// fade glow on the long edges. The strip extends well past the bottom
// of the screen — only the origin reads, the far end never does. The
// second admin keeps the legacy "arrow" pack: twelve bullets laid out
// as a long pointed triangle aimed at the player, all moving in
// formation so the dodge is read on the shape rather than individual
// bullets.

const ENTRY_SPEED = 100;
const ENTRY_Y = 90;

const SAY_FRAMES = 100;
const ADMIN_STAGGER = 90;
const EXIT_SPEED = 220;

// --- Vertical-beam admin -------------------------------------------------

// Beam timings. A beam (warning + lethal + gap) fits in roughly one
// second; with BEAM_VOLLEYS = 6 that gives the admin ~6s of firing on top
// of their entry / exit. Player speed is 280 px/s ≈ 4.7 px/frame, and
// the lethal beam's hitbox is 24 px wide so dodging requires the player
// centre to move > 16 px from the beam centre — ~3-4 frames of travel.
// The 22-frame (≈0.37s) warning leaves the rest as reaction headroom.
const WARNING_FRAMES = 22;
const LASER_FRAMES = 14;
const BEAM_VOLLEY_GAP = 16;
const BEAM_VOLLEYS = 6;
// Frames the lethal beam takes to expand from a sliver to its full
// width at the start of the lethal phase. Short — the beam reads as
// "energy snapping on" with just enough easing that it doesn't pop in
// instantly.
const BEAM_EXPAND_FRAMES = 4;

// Lethal beam geometry. The hitbox is the same 24-px wall the cell-based
// version had, so dodge timing is unchanged. The visual is drawn as
// three nested layers: a bright white core, a mid-alpha pink halo
// matching the hitbox, and a wider faded glow that provides the soft
// fade at the long edges.
const BEAM_HIT_WIDTH = 24;
const BEAM_CORE_WIDTH = 12;
const BEAM_HALO_WIDTH = 24;
const BEAM_GLOW_WIDTH = 38;

// Beam length: long enough that the far end is always off the bottom
// regardless of source y. Sources spawn at DEADZONE_Y, so 2× GAME_H is
// plenty of headroom for any caller. Anything past GAME_H sits behind
// the touch-control band (depth 50) on touch devices and clips off the
// canvas on desktop, so the beam visually has no end.
const BEAM_LENGTH = GAME_H * 2;

const BEAM_OUTER_TINT = 0xff5577;
const BEAM_CORE_TINT = 0xffffff;
const STARTER_TINT = 0xff5577;
const STARTER_ALPHA = 0.4;
const STARTER_WIDTH = 2;
const SOURCE_FLASH_TINT = 0xffd96a;

// Beam graphics sit between floor (-10) and walls (-9), matching the
// depth bullets / pooled hazards render at — so the side walls and
// closed door panels still occlude a stray beam tail and the open-door
// gaps let it show through.
const BEAM_DEPTH = -9.5;

// Non-damaging entity used for the pulsing source flash at the beam
// origin. The lethal beam itself is no longer cell-based, but the source
// flash stays as a sprite so the engine cleans it up automatically when
// the admin dies mid-warning.
const beamWarning = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 4,
  hitboxShape: 'square',
  hp: null,
  damageClass: [],
  damagedByClass: [],
});

// Lethal beam. The chartCell sprite is just a placeholder we hide on
// spawn — the visible beam is rendered into a Graphics strip by the
// per-bullet script, and the body is resized to a tall rectangle
// covering the full beam path. damageClass: ['player'] so the player
// takes a hit any time they cross the strip; hp: null so it can't be
// shot down by player fire — the script self-destructs on a timer.
// hitboxRadius is a tiny placeholder; the script overrides body size +
// offset on spawn.
const beamLaser = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 1,
  hitboxShape: 'square',
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

// Fire one vertical beam from (sx, sy), extending downward past the
// bottom of the screen. Phase 1: Touhou-style starter laser — a thin
// faint stripe along the full path so the player can see exactly which
// lane is about to be lethal — plus a brighter pulsing source flash at
// (sx, sy) drawing the eye to the origin. Phase 2: a real expanding
// gradient beam, one rectangular collision body plus a layered Graphics
// strip (bright white core, mid-alpha pink halo, soft outer glow) that
// fades on its long edges. The width animates from 0 to full over
// BEAM_EXPAND_FRAMES so the beam reads as snapping on rather than
// popping in. The strip extends past the bottom of the screen so the
// player only sees its origin, never its end.
function* fireBeam(self: Entity, sx: number, sy: number): Generator<ScriptYield, void, void> {
  const scene = self.scene;

  // Phase 1a — starter laser: thin faint stripe down the full path. One
  // Graphics rectangle instead of a row of cells; wrapped in try/finally
  // so a mid-warning admin death (script dropped by the outer race)
  // still tears it down via iter.return().
  const starter = scene.add.graphics().setDepth(BEAM_DEPTH);
  starter.fillStyle(STARTER_TINT, STARTER_ALPHA);
  starter.fillRect(sx - STARTER_WIDTH / 2, sy, STARTER_WIDTH, BEAM_LENGTH);

  try {
    // Phase 1b — pulsing source flash at the beam start. Spawned as an
    // entity so the engine cleans it up on admin death without leaving
    // an orphan sprite. Scale ramps from 1.5× to 3× over the warning
    // so the cell visibly "charges up", and the alpha pulse adds a
    // flicker the player can read peripherally.
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
  } finally {
    starter.destroy();
  }

  // Phase 2 — lethal beam. One pooled entity carries both the
  // rectangular hitbox and the per-frame Graphics that draws the
  // gradient strip. The pair is torn down together when the script
  // finishes (or is cancelled by entity culling); this keeps the beam
  // alive past its parent admin's death without orphaning visuals,
  // matching the cell-based version's "fire-and-forget" semantics.
  shoot();
  self.spawn(beamLaser, sx, sy, 0, 0, {
    script: function* (b: Entity): Generator<ScriptYield, void, void> {
      // Hide the placeholder sprite — the gradient strip below renders
      // the beam itself.
      b.setVisible(false);
      // Override the kind's tiny placeholder hitbox with a tall slab
      // covering the full beam path. setSize(..., false) skips the
      // auto-centring that would otherwise stomp our offset; setOffset
      // is in sprite-local coords (relative to the sprite's top-left),
      // and chartCell is 8×8 with origin (0.5, 0.5) so add 4 to the
      // half-width / put the body's top flush with the sprite centre.
      b.body.setSize(BEAM_HIT_WIDTH, BEAM_LENGTH, false);
      b.body.setOffset(b.width / 2 - BEAM_HIT_WIDTH / 2, b.height / 2);

      const g = scene.add.graphics().setDepth(BEAM_DEPTH);
      try {
        for (let t = 0; t < LASER_FRAMES; t++) {
          // Width grows linearly from 0 → 1 over BEAM_EXPAND_FRAMES,
          // then holds — the "snap-on" feel without an instant pop.
          const grow = Math.min(1, (t + 1) / BEAM_EXPAND_FRAMES);
          g.clear();
          // Outer glow: widest, lowest alpha — the soft fade at the
          // beam's long edges (the "vertical contours").
          const gw = BEAM_GLOW_WIDTH * grow;
          g.fillStyle(BEAM_OUTER_TINT, 0.2);
          g.fillRect(sx - gw / 2, sy, gw, BEAM_LENGTH);
          // Halo: mid alpha, matches the hitbox width — what hits you
          // also reads as fully solid.
          const hw = BEAM_HALO_WIDTH * grow;
          g.fillStyle(BEAM_OUTER_TINT, 0.55);
          g.fillRect(sx - hw / 2, sy, hw, BEAM_LENGTH);
          // Core: narrow, full white, full alpha — drawn last so it
          // sits on top of the halo within the same Graphics.
          const cw = BEAM_CORE_WIDTH * grow;
          g.fillStyle(BEAM_CORE_TINT, 1);
          g.fillRect(sx - cw / 2, sy, cw, BEAM_LENGTH);
          yield 1;
        }
      } finally {
        g.destroy();
      }
      if (b.alive) b.die();
    },
  });

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

function makeBeamAdminScript(speech: SpeechSchedule, exitSide: -1 | 1): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < BEAM_VOLLEYS; i++) {
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);
      const aimX = self.stage.player.x;
      // Beam spawns at DEADZONE_Y so the source flash + starter laser
      // sit just under the 28-px HUD strip — anything spawned at y = 0
      // is occluded by the panel (depth 99), which is why an earlier
      // version of this telegraph was effectively invisible. The beam
      // extends past the bottom of the screen on its own (BEAM_LENGTH).
      yield* fireBeam(self, aimX, DEADZONE_Y);
      yield BEAM_VOLLEY_GAP;
    }

    yield* exitThroughSideDoor(self, exitSide, EXIT_SPEED);
  };
}

function makeArrowAdminScript(speech: SpeechSchedule, exitSide: -1 | 1): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < ARROW_VOLLEYS; i++) {
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);
      shootArrow(self);
      yield ARROW_VOLLEY_GAP;
    }

    yield* exitThroughSideDoor(self, exitSide, EXIT_SPEED);
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

    // Each admin exits through the closest door on their own half — the
    // beam admin sits at x = 0.4·W (left of centre) and walks back out
    // through the left wall, the arrow admin at x = 0.6·W exits right.
    // Vertical leg is whatever door panel happens to be nearest their
    // current y when their script reaches the exit (the corridor is
    // frozen during the wave, so doors sit where they were when it
    // started).
    self.spawn(itAdmin, GAME_W * 0.4, -30, 0, 0, {
      script: makeBeamAdminScript(laserSpeech, -1),
    });
    yield ADMIN_STAGGER;
    self.spawn(itAdmin, GAME_W * 0.6, -30, 0, 0, {
      script: makeArrowAdminScript(arrowSpeech, +1),
    });
  });
}
