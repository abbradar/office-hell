import { playClick, shoot } from '../../audio/sfx/events';
import { DEADZONE_Y, GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { exitThroughSideDoor, markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, EntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import { kbdKey } from '../textures';

// IT Admin (the modern stand-in for the old "sysop"): a single admin
// drives in from the top, lectures the player about overdue password
// changes, fires consecutive vertical lasers from the top edge in
// classic Touhou form — a thin "starter laser" runs the full path
// during the telegraph window, with a brighter pulsing source at the
// top so the player can read the column to dodge out of, then a thick
// gradient beam fires straight down: a bright white core, a mid-alpha
// pink halo, and a soft outer fade glow on the long edges. The strip
// extends well past the bottom of the screen — only the origin reads,
// the far end never does.
//
// Once the lasers are done, the same admin demonstrates a series of
// bad passwords by typing each one as keyboard-cap bullets that grow
// as they fly. Caps are self-aimed at the player at spawn time, so a
// player who hangs back at the bottom of the corridor eats a fan of
// full-sized hitboxes; crowding the admin during the spray turns the
// caps into a stream of grazeable specks that haven't had time to
// inflate yet. After each password the admin barks the quality
// critique, then moves on; after the final passw0rd! attempt — the
// one good password — the admin exits, lesson taught.

const ENTRY_SPEED = 100;
const ENTRY_Y = 90;

const SAY_FRAMES = 100;
const EXIT_SPEED = 220;

// --- Vertical-beam phase -------------------------------------------------

// Beam timings. A beam (warning + lethal + gap) fits in roughly 1.2s
// now, so the laserLoop drops a fresh beam roughly once a second
// while the password sequence runs on top. Player speed is 280 px/s
// ≈ 4.7 px/frame and the lethal beam's hitbox is 24 px wide, so
// dodging requires the player centre to move > 16 px from the beam
// centre — ~3-4 frames of travel. The 44-frame (≈0.73s) warning is
// twice the original 22: the doubled telegraph window keeps the
// laser fair now that the player also has to track the keyboard-cap
// spray's growing-bullet timing at the same time.
const WARNING_FRAMES = 44;
const LASER_FRAMES = 14;
const BEAM_VOLLEY_GAP = 16;
const BEAM_EXPAND_FRAMES = 4;

const BEAM_HIT_WIDTH = 24;
const BEAM_CORE_WIDTH = 12;
const BEAM_HALO_WIDTH = 24;
const BEAM_GLOW_WIDTH = 38;
const BEAM_LENGTH = GAME_H * 2;

const BEAM_OUTER_TINT = 0xff5577;
const BEAM_CORE_TINT = 0xffffff;
const STARTER_TINT = 0xff5577;
const STARTER_ALPHA = 0.4;
const STARTER_WIDTH = 2;
const SOURCE_FLASH_TINT = 0xffd96a;

const BEAM_DEPTH = -9.5;

const beamWarning = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 4,
  hitboxShape: 'square',
});

const beamLaser = new EnemyBulletEntityKind({
  sprite: 'chartCell',
  hitboxRadius: 1,
  hitboxShape: 'square',
});

function* fireBeam(self: Entity, sx: number, sy: number): Generator<ScriptYield, void, void> {
  const scene = self.scene;

  const starter = scene.add.graphics().setDepth(BEAM_DEPTH);
  starter.fillStyle(STARTER_TINT, STARTER_ALPHA);
  starter.fillRect(sx - STARTER_WIDTH / 2, sy, STARTER_WIDTH, BEAM_LENGTH);

  try {
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

  shoot();
  self.spawn(beamLaser, sx, sy, 0, 0, {
    script: function* (b: Entity): Generator<ScriptYield, void, void> {
      b.setVisible(false);
      b.body.setSize(BEAM_HIT_WIDTH, BEAM_LENGTH, false);
      b.body.setOffset(b.width / 2 - BEAM_HIT_WIDTH / 2, b.height / 2);

      const g = scene.add.graphics().setDepth(BEAM_DEPTH);
      try {
        for (let t = 0; t < LASER_FRAMES; t++) {
          const grow = Math.min(1, (t + 1) / BEAM_EXPAND_FRAMES);
          g.clear();
          const gw = BEAM_GLOW_WIDTH * grow;
          g.fillStyle(BEAM_OUTER_TINT, 0.2);
          g.fillRect(sx - gw / 2, sy, gw, BEAM_LENGTH);
          const hw = BEAM_HALO_WIDTH * grow;
          g.fillStyle(BEAM_OUTER_TINT, 0.55);
          g.fillRect(sx - hw / 2, sy, hw, BEAM_LENGTH);
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

// --- Keyboard-cap password phase -----------------------------------------

// Cap-cap geometry: the texture is 16×16, hitbox is a 14×14 square
// centred on it (`hitboxRadius` = half-extent). Phaser's Arcade body
// auto-tracks GameObject scale, so growing the sprite via setScale
// grows the body in lockstep — no per-frame body.setSize() needed.
const KBD_HITBOX = 7;

// Caps spawn tiny, expand to about 1.5× the sprite's natural size over
// KBD_GROW_FRAMES. At KBD_SPEED travelling from y≈90 to a player camped
// at y≈580 the bullet flight is ~2.5s (150 frames) — comfortably past
// the grow window, so anyone hugging the bottom rail gets the full-fat
// hitbox. A player closing the gap to the admin shaves both flight
// time and grow time, which is the point of the mechanic: crowd the
// source or eat a big square.
const KBD_START_SCALE = 0.3;
const KBD_END_SCALE = 1.6;
const KBD_GROW_FRAMES = 130;
const KBD_SPEED = 200;

// Spacing between successive keystrokes in a password. 7 frames ≈
// 117 ms — fast enough to read as someone typing, slow enough that
// each cap's spawn-time aim picks up the player's latest x.
const KBD_CHAR_GAP = 7;
// Pause after the last cap of a password before the comment lands,
// so the spray and the quality-critique bubble don't collide.
const KBD_PASSWORD_POST_GAP = 26;
// Hold time before moving on to the next password — keeps the comment
// bubble up long enough to read.
const KBD_COMMENT_HOLD = 70;

// Characters the spray ever fires across all five passwords:
//   jane / john   → j a n e o h
//   qwerty        → q w e r t y
//   1234567890    → 1 2 3 4 5 6 7 8 9 0
//   password1     → p a s s w o r d 1
//   passw0rd!     → p a s s w 0 r d !
// Union (deduped): j a n e o h q w r t y 1234567890 p s d !
// One kind per character — the spawn path sets the sprite texture from
// kind.sprite, so a per-char kind lands the right cap on frame 0 with
// no placeholder flash. All caps share the same 16×16 geometry and
// hitbox, so they pool together cleanly.
const KBD_CHARS_USED = 'janehoqwrty1234567890psd!';
const KBD_KINDS: Map<string, EnemyBulletEntityKind> = new Map();
for (const ch of KBD_CHARS_USED) {
  KBD_KINDS.set(
    ch,
    new EnemyBulletEntityKind({
      sprite: kbdKey(ch),
      hitboxRadius: KBD_HITBOX,
      hitboxShape: 'square',
    }),
  );
}

function spawnKeyCap(self: Entity, ch: string): void {
  const kind = KBD_KINDS.get(ch);
  if (kind === undefined) return;
  // Self-aiming: aim at the player at spawn time. Each cap commits to
  // a heading on the frame it leaves the admin's keyboard, so a player
  // who drifts sideways during the spray fans the cap stream out
  // rather than walking into a static column.
  const aim = self.angleToPlayer();
  const vx = Math.cos(aim) * KBD_SPEED;
  const vy = Math.sin(aim) * KBD_SPEED;
  self.spawn(kind, self.x, self.y, vx, vy, {
    script: function* (b: Entity): Generator<ScriptYield, void, void> {
      b.setScale(KBD_START_SCALE);
      for (let t = 0; t < KBD_GROW_FRAMES; t++) {
        const u = (t + 1) / KBD_GROW_FRAMES;
        b.setScale(KBD_START_SCALE + (KBD_END_SCALE - KBD_START_SCALE) * u);
        yield 1;
      }
      // Hold full size until the cull margin reaps it on its way off
      // the field. The while-true is the standard script idiom — the
      // engine drops the script when the entity dies (cull or bomb).
      while (true) yield 60;
    },
  });
}

function* sprayPassword(self: Entity, password: string): Generator<ScriptYield, void, void> {
  // Fire last-char-first: the caps travel from admin to player, so the
  // earliest-fired one is also the furthest along the path. Typing in
  // reverse puts the password's first letter at the front of the
  // stream (closest to the player) and the last letter still at the
  // admin's keyboard — the player reads the word top-to-bottom along
  // its flight path in natural left-to-right / first-to-last order.
  for (const ch of [...password].reverse()) {
    playClick();
    spawnKeyCap(self, ch);
    yield KBD_CHAR_GAP;
  }
}

// --- Script -------------------------------------------------------------

export const itAdmin = new HPEntityKind({
  sprite: 'sysop',
  hitboxRadius: 16,
  hp: 60,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Infinite beam pump — paired with passwordSequence in a `race` so the
// engine drops it the moment the passwords are done. An in-flight
// fireBeam cleans up its starter Graphics via its own try/finally on
// cancellation; in-flight beam entities continue under their own
// scripts and tear down on their own LASER_FRAMES timer.
function* laserLoop(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    const aimX = self.stage.player.x;
    yield* fireBeam(self, aimX, DEADZONE_Y);
    yield BEAM_VOLLEY_GAP;
  }
}

function* passwordSequence(self: Entity): Generator<ScriptYield, void, void> {
  // Player name is lowercased because passwords are conventionally
  // lowercase; the cap textures render uppercase regardless, like a
  // real keyboard. Jane / John are both 4 chars — the "Too short!"
  // critique lands on either.
  const playerName = self.stage.player.character.name.toLowerCase();
  const passwords: readonly { pw: string; comment: string | null }[] = [
    { pw: playerName, comment: 'Too short!' },
    { pw: 'qwerty', comment: 'No!' },
    { pw: '1234567890', comment: 'Also no!' },
    { pw: 'password1', comment: 'Needs a symbol!' },
    { pw: 'passw0rd!', comment: 'Ugh!' },
  ];

  for (const { pw, comment } of passwords) {
    yield* sprayPassword(self, pw);
    yield KBD_PASSWORD_POST_GAP;
    if (comment !== null) {
      self.say(comment, SAY_FRAMES);
      yield KBD_COMMENT_HOLD;
    }
  }
}

function* itAdminScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  // Open with the bark, then race lasers against the password sequence
  // so the player has to read both threats at once — vertical beams
  // from the top while keyboard caps fan out aimed at their current
  // position. The race ends when passwordSequence completes (laserLoop
  // never returns on its own); the admin then walks out the left wall.
  self.say('Change your email password. Now.', SAY_FRAMES);
  yield 60;

  yield { race: [laserLoop(self), passwordSequence(self)] };

  yield* exitThroughSideDoor(self, -1, EXIT_SPEED);
}

// Demo wave: a single IT admin walks down the centre of the corridor,
// runs the laser phase, demos five bad passwords, and exits through
// the left wall. The original wave doubled the admin up with an arrow
// formation from the opposite half; that role is gone — the password
// phase now carries the bullet-pattern weight on the same sprite.
export function* itAdminsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'it admin');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    self.spawn(itAdmin, GAME_W / 2, -30, 0, 0, {
      script: itAdminScript,
    });
  });
}
