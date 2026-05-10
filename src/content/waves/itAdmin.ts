import { shoot } from '../../audio/sfx/events';
import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';

// IT Admin (the modern stand-in for the old "sysop"): drives in from the top,
// harangues the player about overdue password changes, and fires consecutive
// lethal beams aimed at the player's current position. One admin shoots
// vertical beams that come down from the top of the playfield; the other
// shoots horizontal beams that come in from the left wall. Every beam is
// preceded by a short pulsing flash at the beam's source so the player
// gets a tight window to step out of the way before the laser materialises.

const ENTRY_SPEED = 100;
const ENTRY_Y = 90;

const SAY_FRAMES = 100;
const ADMIN_STAGGER = 90;
const VOLLEYS = 6;
const EXIT_SPEED = 220;

// Beam timings. Tuned so a beam (warning + lethal + gap) fits in roughly one
// second; with VOLLEYS=6 that gives each admin ~6s of firing on top of
// their entry / exit. Player speed is 280 px/s, so the 22-frame (≈0.37s)
// warning gives ~100 px of travel — easily enough to clear an 8 px-wide
// beam, but short enough that an inattentive player gets clipped.
const WARNING_FRAMES = 22;
const LASER_FRAMES = 14;
const VOLLEY_GAP = 16;

// Beam construction. Cells are 8×8 (chartCell sprite) laid centre-to-centre
// at BEAM_CELL_STEP so adjacent cells touch with no gap — a 1D wall of
// hitboxes the player can't graze through. The beam is one cell wide
// (8 px); player hitbox is also 8 px diameter, so dodging means the
// player centre must be ≥ 8 px from the beam centre.
const BEAM_CELL_STEP = 8;
const BEAM_TINT = 0xff5577;
const SOURCE_FLASH_TINT = 0xffd96a;

// Non-damaging cells used to telegraph a beam. Same sprite + size as the
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

// Fire one beam from (sx, sy) to (ex, ey). Phase 1: a pulsing source flash
// at the start point telegraphing the strike — the cell grows + flickers
// so the player's eye is drawn there. Phase 2: a continuous row of lethal
// cells along the full path. Each spawned cell self-destructs on its
// per-bullet script, so a mid-flight admin death (script cancelled by the
// outer race) leaves no orphans on the field.
function* fireBeam(self: Entity, sx: number, sy: number, ex: number, ey: number): Generator<ScriptYield, void, void> {
  const dx = ex - sx;
  const dy = ey - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const count = Math.max(2, Math.ceil(dist / BEAM_CELL_STEP) + 1);

  // Phase 1 — pulsing source flash at the beam start. Scale ramps from 1×
  // to ~2.5× over the warning so the cell visibly "charges up", and the
  // alpha pulse adds a flicker the player can read peripherally.
  self.spawn(beamWarning, sx, sy, 0, 0, {
    script: function* (b: Entity): Generator<ScriptYield, void, void> {
      b.setTint(SOURCE_FLASH_TINT);
      for (let t = 0; t < WARNING_FRAMES && b.alive; t++) {
        const phase = t / WARNING_FRAMES;
        b.setScale(1 + phase * 1.5);
        b.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 5)));
        yield 1;
      }
      if (b.alive) b.die();
    },
  });

  yield WARNING_FRAMES;

  // Phase 2 — lethal beam. Cells touch edge-to-edge so the row reads (and
  // hits) as one continuous laser, not a string of beads.
  shoot();
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const px = sx + dx * t;
    const py = sy + dy * t;
    self.spawn(beamLaser, px, py, 0, 0, {
      script: function* (b: Entity): Generator<ScriptYield, void, void> {
        b.setTint(BEAM_TINT);
        yield LASER_FRAMES;
        if (b.alive) b.die();
      },
    });
  }

  yield LASER_FRAMES;
}

// Per-volley speech schedule. Each entry is the line to speak at that volley
// index, or null to fire silently. Both admins fire on every volley regardless
// of their speech schedule — only the bubbles are gated.
type SpeechSchedule = readonly (string | null)[];

// Vertical admin: top-edge → bottom of playfield, column = player.x at
// warning time. Horizontal admin: left-edge → right of playfield, row =
// player.y at warning time.
type Orientation = 'vertical' | 'horizontal';

function makeITAdminScript(orientation: Orientation, speech: SpeechSchedule): EntityScript {
  return function* (self: Entity) {
    yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

    for (let i = 0; i < VOLLEYS; i++) {
      const line = speech[i];
      if (line) self.say(line, SAY_FRAMES);

      if (orientation === 'vertical') {
        const aimX = self.stage.player.x;
        yield* fireBeam(self, aimX, 0, aimX, GAME_H);
      } else {
        const aimY = self.stage.player.y;
        yield* fireBeam(self, 0, aimY, GAME_W, aimY);
      }
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

// Demo wave: two IT admins from opposite halves, staggered so the player is
// dodging one orientation a beat before the other piles on. The 0.4 / 0.6
// spawn x's keep both sprites clear of the side walls during entry.
//
// Speech is split across both admins so no single sprite gets bubble-spammed.
// One beam takes WARNING + LASER + VOLLEY_GAP ≈ 52 frames, so the schedule
// below leaves the bubble-life (SAY_FRAMES = 100) plenty of room between
// adjacent lines:
//   t=0    vertical v0 → "Change your email password. Now."
//   t=142  horizontal v1 → "Your last reset was 91 days ago."  (90 stagger + 52)
//   t=208  vertical v4 → '"Password1!" does not count.'        (4 × 52)
export function* itAdminsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'it admin');
  yield* suspendRunning(self, function* () {
    const verticalSpeech: SpeechSchedule = [
      'Change your email password. Now.',
      null,
      null,
      null,
      '"Password1!" does not count.',
      null,
    ];
    const horizontalSpeech: SpeechSchedule = [null, 'Your last reset was 91 days ago.', null, null, null, null];

    self.spawn(itAdmin, GAME_W * 0.4, -30, 0, 0, {
      script: makeITAdminScript('vertical', verticalSpeech),
    });
    yield ADMIN_STAGGER;
    self.spawn(itAdmin, GAME_W * 0.6, -30, 0, 0, {
      script: makeITAdminScript('horizontal', horizontalSpeech),
    });
  });
}
