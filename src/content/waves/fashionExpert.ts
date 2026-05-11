import { shoot } from '../../audio/sfx/events';
import { BULLET_RADIUS, GAME_H, GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { markWave, suspendRunning } from '../../script/stage';
import { EnemyBulletEntityKind, HPEntityKind, type ScriptYield } from '../../script/types';
import { NECKTIE_KEY } from '../textures';

// Fashion Expert: a new face who breezes in to show off his "new look" and
// flings neckties at the player while he waits for a compliment. Sits in
// the encounter stack just before sales+client — the corridor's quiet
// section between the all-doors spam and the important-client double act.
//
// Attack identity: a halo of orbiting neckties around him at all times,
// outward rings of fast homing neckties every 0.5s, and a pulsed RGB
// laser fan splaying out from his position in red / green / blue stripes.
// The orbit forbids point-blank fire; the rings force the player to
// commit to a column of motion every half-second; the laser fan
// telegraphs a wide angular sweep with a long rest tail so the player
// can read the next telegraph and pick a gap.

const ENTRY_SPEED = 110;
const ENTRY_Y = 110;
const EXIT_SPEED = 240;

// Maximum length of the fight before he packs up and leaves. The player
// can (and usually will) kill him faster — this is a safety bound so the
// wave can't deadlock if the player camps and refuses to commit damage.
// Roughly matches the original 3-stream fight (~7s) at the upper end.
const FIGHT_DURATION = 480;

// Per-bullet homing applied to every necktie in flight. Each tie can
// curve its own trajectory toward the player at NECKTIE_HOMING_RATE_START
// rad/frame, decaying linearly to zero over NECKTIE_HOMING_DECAY_FRAMES —
// after that the bullet flies straight. Tuned milder than reportBullet
// (0.04/30) so the ring-pulse spread doesn't collapse into a pure
// aimed cone; some ties still curve, the spread is preserved.
const NECKTIE_HOMING_RATE_START = 0.02;
const NECKTIE_HOMING_DECAY_FRAMES = 22;

// Orbiting halo of neckties around the fashion expert. Spawned once at
// fight start, position driven directly by the orbit loop each frame
// (script: null on each so the kind's necktieFlight doesn't fight the
// position writes — and so the ties don't freeze in place when the
// loop ends, which is what would happen if necktieFlight read their
// zero spawn velocity and locked speed to 0).
const ORBIT_COUNT = 12;
const ORBIT_RADIUS = 55;
const ORBIT_ANGULAR_SPEED = 0.7; // rad/s

// Outward ring pulse — every RING_PULSE_INTERVAL frames a full circle of
// neckties launches outward at RING_BULLET_SPEED. Bullets use the same
// `necktie` kind, so each one homes a little after launch (the spread
// still holds because the homing window is short relative to flight
// time, but enough that a static dodge eats a hit).
const RING_PULSE_INTERVAL = 30; // ~0.5s
const RING_BULLET_COUNT = 12;
const RING_BULLET_SPEED = 300;

// Laser pulse — a fan of `LASER_COUNT` angled gradient beams, each in
// one of three RGB tints (cycled per laser). The fan is anchored at the
// player's position at telegraph time: the middle beam (index
// (count-1)/2) fires exactly at the player, and the rest spread out
// symmetrically by `LASER_SPREAD/(count-1)` rad per slot. LASER_COUNT
// is odd so there's always a single centre slot to anchor — the
// player must commit to one of the two halves of the fan, never just
// "stay still" and hope. Each pulse telegraphs for
// LASER_TELEGRAPH_FRAMES, commits to the glow+halo+white-core beam
// for LASER_LETHAL_FRAMES, then rests for LASER_PULSE_REST so the
// player can read the next telegraph and reposition.
const LASER_COUNT = 11;
const LASER_SPREAD = 2.0;
const LASER_TELEGRAPH_FRAMES = 42;
const LASER_LETHAL_FRAMES = 18;
const LASER_PULSE_REST = 55;

// RGB tint cycle. Picked at saturation but with a little bias toward
// readable values over the dark office floor — pure 0xff0000 reads
// muddy at small line widths, the slightly warmed red below pops.
const LASER_RGB_COLORS = [0xff3a55, 0x44e872, 0x4d7dff] as const;

// Beam visual geometry. Three concentric layers per laser: a wide
// translucent glow, a medium-alpha halo, and a thin opaque white core
// — same recipe as the IT Admin's password beam (chunky and
// telegraphed), the difference here is the angle and the colour cycle.
// Depth -9.5 sits below the bullet/character depth (0) so beams render
// behind sprites the way the admin's do.
const LASER_BEAM_DEPTH = -9.5;
const LASER_GLOW_WIDTH = 30;
const LASER_HALO_WIDTH = 16;
const LASER_CORE_WIDTH = 6;
const LASER_GLOW_ALPHA = 0.22;
const LASER_HALO_ALPHA = 0.55;
const LASER_TELEGRAPH_WIDTH = 2;
const LASER_TELEGRAPH_ALPHA = 0.55;

// Hitbox bullets are spawned (invisible) along each beam's line so an
// arbitrary angle is collidable — Arcade Physics bodies are AABBs and
// can't be rotated, so a chain of small square hitboxes approximates
// the angled segment. Spacing close to 2× radius so the chain has no
// gaps a player could thread without touching at least one cell.
const LASER_HITBOX_RADIUS = 4;
const LASER_HITBOX_SPACING = 9;

// Beam visuals extend far past any screen edge along the angle so the
// line has no visible terminus — the camera viewport clips it cleanly
// at the playfield boundary instead of showing a line cap inside the
// field. The hitbox chain still stops at the playfield edge via
// `rayToBounds`, so we don't burn pool slots on off-screen cells.
// 2× the screen diagonal is comfortably more than the longest visible
// extent from any source position inside the field.
const LASER_VISUAL_LENGTH = Math.hypot(GAME_W, GAME_H) * 2;

const INTRO_LINE = 'I changed my style,\nthoughts?';
const INTRO_SAY_FRAMES = 110;

// Per-tie homing flight. Mirrors reportBullet's shape (decay over a
// fixed window then drop the script) with milder constants — keeps the
// ring-pulse spread from collapsing into a pure aimed cone while still
// pulling stray ties a few degrees toward the player. The orbit ring
// spawns its members with `script: null` and skips this entirely.
function* necktieFlight(self: Entity): Generator<ScriptYield, void, void> {
  const v = self.body.velocity;
  const speed = Math.hypot(v.x, v.y);
  for (let age = 0; age < NECKTIE_HOMING_DECAY_FRAMES; age++) {
    yield 1;
    const rate = NECKTIE_HOMING_RATE_START * (1 - age / NECKTIE_HOMING_DECAY_FRAMES);
    const cv = self.body.velocity;
    const cur = Math.atan2(cv.y, cv.x);
    let diff = self.angleToPlayer() - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-rate, Math.min(rate, diff));
    self.setMotion(cur + turn, speed);
  }
}

// Necktie bullet — small downward-pointing red tie. Sprite stays at
// rotation 0 (ties hang by gravity, so a fixed-down orientation reads
// correctly regardless of travel angle); no `rotateToVelocity` for that
// reason. `defaultScript` handles per-bullet homing — see
// `necktieFlight`.
export const necktie = new EnemyBulletEntityKind({
  sprite: NECKTIE_KEY,
  hitboxRadius: BULLET_RADIUS,
  defaultScript: necktieFlight,
});

// Invisible square hitbox marker used to make the laser beam's angled
// line collidable. Each spawned instance hides itself on its first
// frame (in the spawn-time script) and self-destructs after the
// laser's lethal window. Sprite key is a small existing texture — the
// art never renders.
const laserHitbox = new EnemyBulletEntityKind({
  sprite: 'chartCell',
  hitboxRadius: LASER_HITBOX_RADIUS,
  hitboxShape: 'square',
});

// Spawn the orbiting halo of neckties, then drive their positions each
// frame as a rigid ring rotating around the fashion expert. try/finally
// guarantees the ring is destroyed when the script is cancelled (race
// loss or entity death) — the engine calls `.return()` on the dropped
// generator, which runs `finally` before clearing it.
function* orbitLoop(self: Entity): Generator<ScriptYield, void, void> {
  type Orbiter = { e: Entity; baseAngle: number };
  const phasePerFrame = ORBIT_ANGULAR_SPEED / SCRIPT_FPS;
  const orbiters: Orbiter[] = [];
  for (let i = 0; i < ORBIT_COUNT; i++) {
    const baseAngle = (i / ORBIT_COUNT) * Math.PI * 2;
    const x = self.x + ORBIT_RADIUS * Math.cos(baseAngle);
    const y = self.y + ORBIT_RADIUS * Math.sin(baseAngle);
    const e = self.spawn(necktie, x, y, 0, 0, { script: null });
    orbiters.push({ e, baseAngle });
  }
  let phase = 0;
  try {
    while (true) {
      yield 1;
      phase += phasePerFrame;
      const cx = self.x;
      const cy = self.y;
      for (const o of orbiters) {
        if (!o.e.alive) continue;
        const a = o.baseAngle + phase;
        o.e.x = cx + ORBIT_RADIUS * Math.cos(a);
        o.e.y = cy + ORBIT_RADIUS * Math.sin(a);
      }
    }
  } finally {
    for (const o of orbiters) if (o.e.alive) o.e.die();
  }
}

// Outward necktie ring every 0.5s. `ring(...)` plays its own shoot SFX
// so we don't need to gate one here. Each fired tie homes a little
// after launch via necktieFlight, so the spread reads as "fan that
// bends" rather than a static circle.
function* ringPulseLoop(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    yield RING_PULSE_INTERVAL;
    ring(self, RING_BULLET_COUNT, necktie, RING_BULLET_SPEED, Math.random() * Math.PI * 2);
  }
}

// Project a ray at `angle` from `(fromX, fromY)` to the playfield edge.
// Lasers are drawn out to this endpoint so each line stops cleanly at
// the screen boundary — no off-screen visual / hitbox waste. Same
// algorithm as `extendRayToBounds` in theBoss.ts; kept inline to avoid
// plumbing an exported helper for one caller.
function rayToBounds(fromX: number, fromY: number, angle: number): { x: number; y: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tMax = Number.POSITIVE_INFINITY;
  if (dx > 1e-6) tMax = Math.min(tMax, (GAME_W - fromX) / dx);
  else if (dx < -1e-6) tMax = Math.min(tMax, -fromX / dx);
  if (dy > 1e-6) tMax = Math.min(tMax, (GAME_H - fromY) / dy);
  else if (dy < -1e-6) tMax = Math.min(tMax, -fromY / dy);
  return { x: fromX + tMax * dx, y: fromY + tMax * dy };
}

// Lay a chain of invisible square hitbox bullets along the segment from
// (x1,y1) to (x2,y2). Each hides itself on its first script tick and
// dies after `life` physics frames; the chain collectively makes the
// angled beam collidable.
function placeLaserHitbox(self: Entity, x1: number, y1: number, x2: number, y2: number, life: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const count = Math.max(2, Math.ceil(dist / LASER_HITBOX_SPACING) + 1);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    self.spawn(laserHitbox, x1 + dx * t, y1 + dy * t, 0, 0, {
      script: function* (b: Entity): Generator<ScriptYield, void, void> {
        b.setVisible(false);
        yield life;
        if (b.alive) b.die();
      },
    });
  }
}

// Build a single Phaser line GameObject between (x1,y1) and (x2,y2) at
// the given tint / alpha / width. Anchored at the segment midpoint —
// Phaser's Line uses world-space (x,y) for its origin and renders its
// endpoints in local coords relative to that origin, so the midpoint
// is the natural anchor. Lines are returned for the caller to track +
// destroy in a try/finally so race-cancellation tears them down cleanly.
type BeamLine = ReturnType<Phaser.Scene['add']['line']>;
function makeBeamLine(
  scene: Phaser.Scene,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha: number,
  width: number,
): BeamLine {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return scene.add
    .line(cx, cy, x1 - cx, y1 - cy, x2 - cx, y2 - cy, color, alpha)
    .setOrigin(0.5, 0.5)
    .setLineWidth(width)
    .setDepth(LASER_BEAM_DEPTH);
}

function* laserPulse(self: Entity): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  // Anchor the fan on the player: the middle beam fires straight at
  // angleToPlayer, the rest fan out symmetrically. Player movement
  // between pulses naturally rotates the whole fan — no extra jitter
  // needed.
  const aim = self.angleToPlayer();
  const step = LASER_SPREAD / (LASER_COUNT - 1);
  const centerIdx = Math.floor((LASER_COUNT - 1) / 2);

  // `visEnd` is the off-screen point the visual line draws to (camera
  // clips it at the playfield edge — no visible terminus). `hitEnd` is
  // the in-bounds exit point used to size the hitbox chain.
  type Beam = {
    color: number;
    visEnd: { x: number; y: number };
    hitEnd: { x: number; y: number };
  };
  const beams: Beam[] = [];
  for (let i = 0; i < LASER_COUNT; i++) {
    const a = aim + (i - centerIdx) * step;
    beams.push({
      // biome-ignore lint/style/noNonNullAssertion: i % length is in-bounds
      color: LASER_RGB_COLORS[i % LASER_RGB_COLORS.length]!,
      visEnd: { x: self.x + Math.cos(a) * LASER_VISUAL_LENGTH, y: self.y + Math.sin(a) * LASER_VISUAL_LENGTH },
      hitEnd: rayToBounds(self.x, self.y, a),
    });
  }

  // Telegraph — thin colored line per beam, all destroyed on exit.
  const teleLines: BeamLine[] = beams.map((b) =>
    makeBeamLine(scene, self.x, self.y, b.visEnd.x, b.visEnd.y, b.color, LASER_TELEGRAPH_ALPHA, LASER_TELEGRAPH_WIDTH),
  );
  try {
    yield LASER_TELEGRAPH_FRAMES;
  } finally {
    for (const l of teleLines) l.destroy();
  }

  // Lethal — three-layer beam (glow + halo + white core) per laser,
  // plus the angled hitbox chain. shoot() once for the whole fan so we
  // don't saturate the SFX voice cap with 11 concurrent triggers.
  shoot();
  const lethalLines: BeamLine[] = [];
  for (const b of beams) {
    lethalLines.push(
      makeBeamLine(scene, self.x, self.y, b.visEnd.x, b.visEnd.y, b.color, LASER_GLOW_ALPHA, LASER_GLOW_WIDTH),
      makeBeamLine(scene, self.x, self.y, b.visEnd.x, b.visEnd.y, b.color, LASER_HALO_ALPHA, LASER_HALO_WIDTH),
      makeBeamLine(scene, self.x, self.y, b.visEnd.x, b.visEnd.y, 0xffffff, 1, LASER_CORE_WIDTH),
    );
    placeLaserHitbox(self, self.x, self.y, b.hitEnd.x, b.hitEnd.y, LASER_LETHAL_FRAMES);
  }
  try {
    yield LASER_LETHAL_FRAMES;
  } finally {
    for (const l of lethalLines) l.destroy();
  }
}

// Open-ended laser loop — raced against the fight-window timer; the
// engine drops this generator on race cancellation. `while (true)` is
// the right shape here per the project's no-`self.alive`-guard rule
// (StageManager drops scripts on death).
function* laserPulseLoop(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    yield* laserPulse(self);
    yield LASER_PULSE_REST;
  }
}

// The only finite generator in the race — runs out the fight clock so
// the race naturally completes after FIGHT_DURATION even if the player
// hasn't killed him. Without this, the three attack loops would spin
// forever and the wave could deadlock on a passive player.
function* fightWindow(): Generator<ScriptYield, void, void> {
  yield FIGHT_DURATION;
}

function* fashionExpertScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);

  // `say` is non-blocking — the bubble lives on the bubble manager, so
  // dropping straight into the race fires the first ring + laser while
  // the intro line is still up. He's talking and shooting at once.
  self.say(INTRO_LINE, INTRO_SAY_FRAMES);

  yield {
    race: [fightWindow(), orbitLoop(self), ringPulseLoop(self), laserPulseLoop(self)],
  };

  self.setVelocity(0, EXIT_SPEED);
}

export const fashionExpert = new HPEntityKind({
  sprite: 'fashionExpert',
  hitboxRadius: 16,
  hp: 40,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: fashionExpertScript,
});

// Demo wave: a single fashion expert, mid-column. He's a between-beat
// solo act in the corridor before sales+client, so no co-stars.
export function* fashionExpertWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'fashion expert');
  self.stage.scheduleMultDrop('regular');
  // biome-ignore lint/correctness/useYield: spawn-only body; suspendRunning supplies the yield*
  yield* suspendRunning(self, function* () {
    self.spawn(fashionExpert, GAME_W * 0.5, -30, 0, 0);
  });
}
