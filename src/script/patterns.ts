import { shoot } from '../audio/sfx/events';
import { GAME_H, GAME_W, SCRIPT_FPS } from '../config';
import type { Entity } from '../entities/Entity';
import { blueExplosion, bullet, redExplosion } from '../content/kinds';
import {
  BLUE_EXPLOSION_FRAME_DURATION_FRAMES,
  BLUE_EXPLOSION_FRAME_W,
  RED_EXPLOSION_FRAMES,
} from '../content/textures';
import { type EntityKind, INERT_KIND, type ScriptYield } from './types';

// True once the entity's center is past any screen edge — i.e. it's at least
// half hidden. Suppress firing in that case so off-screen exits don't keep
// dropping bullets from below the play field.
function offScreen(self: Entity): boolean {
  return self.x < 0 || self.x > GAME_W || self.y < 0 || self.y > GAME_H;
}

function shootAt(self: Entity, kind: EntityKind, angle: number, speed: number): void {
  self.spawn(kind, self.x, self.y, Math.cos(angle) * speed, Math.sin(angle) * speed);
}

export function ring(self: Entity, count: number, kind: EntityKind, speed: number, baseAngle = 0): void {
  if (offScreen(self)) return;
  shoot();
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, baseAngle + i * step, speed);
  }
}

export function aimed(self: Entity, count: number, kind: EntityKind, speed: number, spreadRad = 0): void {
  if (offScreen(self)) return;
  shoot();
  const aim = self.angleToPlayer();
  if (count <= 1) {
    shootAt(self, kind, aim, speed);
    return;
  }
  const step = spreadRad / (count - 1);
  const start = aim - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, start + i * step, speed);
  }
}

// Fire `count` bullets aimed at the player, all sharing the same heading
// but spawned from random offsets within a small disk around the entity.
// They fly as a tight pack rather than fanning out into a line, so the
// volley reads as one heavy clump to dodge instead of a wall to weave
// through.
export function cluster(self: Entity, count: number, kind: EntityKind, speed: number, spreadPx = 14): void {
  if (offScreen(self)) return;
  shoot();
  const aim = self.angleToPlayer();
  const vx = Math.cos(aim) * speed;
  const vy = Math.sin(aim) * speed;
  for (let i = 0; i < count; i++) {
    const r = Math.random() * spreadPx;
    const a = Math.random() * Math.PI * 2;
    self.spawn(kind, self.x + Math.cos(a) * r, self.y + Math.sin(a) * r, vx, vy);
  }
}

export function spread(
  self: Entity,
  count: number,
  kind: EntityKind,
  speed: number,
  baseAngle: number,
  spreadRad: number,
): void {
  if (offScreen(self)) return;
  shoot();
  if (count <= 1) {
    shootAt(self, kind, baseAngle, speed);
    return;
  }
  const step = spreadRad / (count - 1);
  const start = baseAngle - spreadRad / 2;
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, start + i * step, speed);
  }
}

// Push the entity in a direction (raw velocity components) and yield
// until it dies — typically by crossing the cull margin and being
// released by the manager. For "exit stage" moves where the exact
// travel distance doesn't matter, only that the entity has cleared the
// field. Caller must pick a direction that will actually carry the
// entity off-screen, or this never resolves.
export function* walkOffScreen(self: Entity, vx: number, vy: number): Generator<ScriptYield, void, void> {
  self.body.setVelocity(vx, vy);
  yield { until: self };
}

// Wait until `self` reaches the y-coordinate `targetY`, computed once
// from the current velocity rather than polled per frame — works for
// any free-flying entity whose velocity won't change mid-flight (most
// bullets). If the entity is already at-or-past `targetY` along its
// motion vector, or is moving away from it, returns immediately so the
// caller's "after I get there" beat fires now rather than parking
// forever. The wait is in physics frames, so it auto-pauses with the
// simulation; if the entity dies mid-wait the engine drops the script.
export function* waitUntilY(self: Entity, targetY: number): Generator<ScriptYield, void, void> {
  const dy = targetY - self.y;
  const vy = self.body.velocity.y;
  if (dy === 0 || vy === 0 || Math.sign(dy) !== Math.sign(vy)) return;
  const frames = Math.max(1, Math.round((dy / vy) * SCRIPT_FPS));
  yield frames;
}

// Drive the entity from its current position to (tx, ty) at `speed`, then
// stop. Computes heading + travel time for you and yields until it lands.
// Snaps to the exact target on arrival to absorb sub-pixel rounding so the
// next script step starts from a clean coordinate.
//
// `silent`: hold the idle frame for the duration of the move instead of
// updating the anim from velocity. The body still travels normally; only
// the visual animation is suppressed. Used for "carried by the world"
// moments — e.g. the inter-stage water-cooler scene where the floor
// drags the player back to PLAYER_Y while the sprite stays still.
export function* moveTo(
  self: Entity,
  tx: number,
  ty: number,
  speed: number,
  opts?: { silent?: boolean },
): Generator<ScriptYield, void, void> {
  const dx = tx - self.x;
  const dy = ty - self.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6 || speed <= 0) {
    self.setVelocity(0, 0);
    return;
  }
  const silent = opts?.silent ?? false;
  if (silent) self.animSuppressed = true;
  self.setVelocity((dx / dist) * speed, (dy / dist) * speed);
  // Floor at one tick: a tiny-but-positive distance still spends a frame
  // moving rather than snapping via the immediate-restart path. Keeps
  // visual continuity (the body's velocity is observed for at least one
  // physics step) and matches the original semantics of "moveTo waits at
  // least a frame".
  yield Math.max(1, Math.round((dist / speed) * SCRIPT_FPS));
  self.setVelocity(0, 0);
  self.x = tx;
  self.y = ty;
  if (silent) self.animSuppressed = false;
}

export function arc(
  self: Entity,
  count: number,
  kind: EntityKind,
  speed: number,
  fromAngle: number,
  toAngle: number,
): void {
  if (offScreen(self)) return;
  shoot();
  if (count <= 1) {
    shootAt(self, kind, fromAngle, speed);
    return;
  }
  const step = (toAngle - fromAngle) / (count - 1);
  for (let i = 0; i < count; i++) {
    shootAt(self, kind, fromAngle + i * step, speed);
  }
}

// Stationary or rotating arc of bullets at a fixed radius around a
// center point — unlike `arc`, the bullets do NOT propagate outward.
// Each tick the pattern recomputes every bullet's (x, y) from its
// current angular position, so the arc reads as a wall/barrier that
// either sits in place (`rotateSpeed = 0`, default) or sweeps around
// the center at the chosen angular rate. Generator — `yield*` it.
//
// Bullet positions are driven directly by writing `body.x` / `body.y`
// each frame (no physics velocity), so the arc stays exactly on its
// orbit regardless of the engine's arcade-physics integration. Bullets
// are still damaging via their hitbox; only their motion is bypassed.
//
// Lifetime: runs for `durationFrames` physics frames (default Infinity
// — race with `waitSeconds(N)` or another helper to time-box). All
// bullets die at the end. Race-cancellation is honoured: when the
// containing race wins elsewhere, the generator's `finally` (implicit
// in the runtime's drop) runs through and the bullets are cleaned up.
export function* orbitArc(
  self: Entity,
  opts: {
    // Bullets evenly spaced from `fromRad` to `toRad` (inclusive of
    // both endpoints, like `arc`). For an N-th of a full circle ring
    // pass `fromRad: 0, toRad: 2*Math.PI * (count - 1) / count`.
    count: number;
    kind: EntityKind;
    // Distance from the center, in pixels.
    radius: number;
    fromRad: number;
    toRad: number;
    // Angular velocity in radians per second. 0 = static arc;
    // positive = clockwise (Phaser convention); negative = CCW.
    rotateSpeed?: number;
    // Total lifetime in physics frames. Default Infinity — pattern
    // runs until cancelled by an outer `race`. The pattern will not
    // re-spawn bullets after they're killed (e.g. by a player bomb).
    durationFrames?: number;
    // Entity to orbit around. Defaults to `self`. Pass the boss when
    // running the pattern from a controller entity placed elsewhere,
    // so the arc tracks the boss instead of the controller.
    centerEntity?: Entity;
  },
): Generator<ScriptYield, void, void> {
  const { count, kind, radius, fromRad, toRad } = opts;
  if (count <= 0) return;
  const rotateSpeed = opts.rotateSpeed ?? 0;
  const duration = opts.durationFrames ?? Number.POSITIVE_INFINITY;
  const center = opts.centerEntity ?? self;

  if (offScreen(self)) return;
  shoot();

  // Per-bullet base angles. `count === 1` puts the single bullet at
  // `fromRad`; otherwise endpoints are inclusive so the last bullet
  // lands exactly at `toRad`.
  const baseAngles: number[] = [];
  if (count === 1) {
    baseAngles.push(fromRad);
  } else {
    const step = (toRad - fromRad) / (count - 1);
    for (let i = 0; i < count; i++) baseAngles.push(fromRad + i * step);
  }

  // Spawn at initial positions with zero velocity; subsequent frames
  // rewrite x/y directly. Holding a reference to each spawned entity
  // lets us update them per tick + clean them up on exit.
  const bullets: Entity[] = [];
  for (let i = 0; i < count; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by count
    const a = baseAngles[i]!;
    const x = center.x + radius * Math.cos(a);
    const y = center.y + radius * Math.sin(a);
    bullets.push(self.spawn(kind, x, y, 0, 0));
  }

  // Rotation phase accumulates over time; each bullet's effective
  // angle is `baseAngles[i] + phase`.
  let phase = 0;
  const phasePerFrame = rotateSpeed / SCRIPT_FPS;
  let elapsed = 0;
  while (elapsed < duration) {
    yield 1;
    elapsed++;
    if (phasePerFrame !== 0) phase += phasePerFrame;
    const cx = center.x;
    const cy = center.y;
    for (let i = 0; i < count; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by count
      const b = bullets[i]!;
      if (!b.alive) continue;
      // biome-ignore lint/style/noNonNullAssertion: bounded by count
      const a = baseAngles[i]! + phase;
      b.x = cx + radius * Math.cos(a);
      b.y = cy + radius * Math.sin(a);
    }
  }

  // Clean up surviving bullets so a finite-duration arc doesn't
  // leave a stationary "wall" behind on the field.
  for (const b of bullets) {
    if (b.alive) b.die();
  }
}

// --- grid + mover + wave: compositional bullet patterns ------------------
//
// Three primitives that separate concerns that tend to get tangled up in
// monolithic patterns:
//
//   GRID   — *where* bullets appear in field space (point producers).
//   MOVER  — *how* each bullet moves once it appears (per-bullet vx/vy/ax/ay).
//   WAVE   — *when* bullets appear/despawn, propagated as a wavefront across
//            the grid in any direction.
//
// "Rain" is wave({ grid: hexGrid(top row), mover: move(π/2, ...), looped }).
// "Wall that flashes in then out" is wave({ grid: full hexGrid, mover: STILL,
// short lifeFrames, slow speed }). "Diagonal sweep" is the same with
// `direction: π/4`. Compose freely; race the result with `waitSeconds(N)` to
// time-box a phase.

export type Point = { x: number; y: number };

export type Mover = (p: Point, self: Entity) => { vx: number; vy: number; ax: number; ay: number };

// Stationary bullets — useful with `wave` for "appear, hold, vanish" walls.
export const STILL: Mover = () => ({ vx: 0, vy: 0, ax: 0, ay: 0 });

// Constant heading (radians) at `speed` px/s, with optional matching linear
// acceleration along the same axis. Angle convention is screen-space:
// 0 = right, π/2 = down, π = left, -π/2 = up.
export function move(angle: number, speed: number, accel = 0): Mover {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  return () => ({ vx: cx * speed, vy: cy * speed, ax: cx * accel, ay: cy * accel });
}

// `cols × rows` lattice anchored at `(x0, y0)`, spaced `(dx, dy)`. Returns
// flat point array — order is row-major (top-to-bottom, left-to-right).
export function squareGrid(opts: {
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}): Point[] {
  const { cols, rows, x0, y0, dx, dy } = opts;
  const out: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: x0 + c * dx, y: y0 + r * dy });
    }
  }
  return out;
}

// Hex-tessellated lattice — every other row is shifted right by `dx/2` so
// the points sit on a triangular grid. `dy` defaults to `dx × √3/2` for
// equilateral spacing; pass a custom `dy` to stretch vertically.
export function hexGrid(opts: {
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  dx: number;
  dy?: number;
}): Point[] {
  const { cols, rows, x0, y0, dx } = opts;
  const dy = opts.dy ?? dx * (Math.sqrt(3) / 2);
  const out: Point[] = [];
  for (let r = 0; r < rows; r++) {
    const offsetX = (r % 2) * (dx / 2);
    for (let c = 0; c < cols; c++) {
      out.push({ x: x0 + offsetX + c * dx, y: y0 + r * dy });
    }
  }
  return out;
}

// Points evenly spaced along `(x1,y1) → (x2,y2)`. Either pass `count` for
// an exact bullet count, or `spacing` to derive count from segment length
// (default spacing = 8 px). Endpoints are always included.
export function lineGrid(opts: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  spacing?: number;
  count?: number;
}): Point[] {
  const { x1, y1, x2, y2 } = opts;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return [{ x: x1, y: y1 }];
  const count = opts.count ?? Math.max(2, Math.ceil(dist / (opts.spacing ?? 8)) + 1);
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    out.push({ x: x1 + dx * t, y: y1 + dy * t });
  }
  return out;
}

// Spawn the points in `grid` as a wavefront propagating along `direction`
// (radians, default π/2 = top→bottom) at `speed` px/s. Each bullet picks
// its velocity / acceleration from `mover` (default STILL) at spawn time
// and self-destructs after `lifeFrames` frames if specified — omit for
// "lives until cull margin" (right answer for moving bullets that exit
// the screen on their own). `loops` runs the wave more than once with
// `loopDelayFrames` between passes; race with `waitSeconds(N)` to
// time-box.
//
// Mechanic: each point is projected onto the direction axis and ordered
// by projection, so rotating `direction` rotates the sweep across
// whatever shape the grid takes — no per-grid math needed.
export function* wave(
  self: Entity,
  opts: {
    grid: Point[];
    kind: EntityKind;
    mover?: Mover;
    direction?: number;
    speed: number;
    lifeFrames?: number;
    loops?: number;
    loopDelayFrames?: number;
  },
): Generator<ScriptYield, void, void> {
  const { grid, kind, speed } = opts;
  if (grid.length === 0 || speed <= 0) return;
  const mover = opts.mover ?? STILL;
  const direction = opts.direction ?? Math.PI / 2;
  const loops = opts.loops ?? 1;
  const loopDelay = Math.max(0, Math.round(opts.loopDelayFrames ?? 0));
  const life = opts.lifeFrames !== undefined ? Math.max(1, Math.round(opts.lifeFrames)) : null;

  const ux = Math.cos(direction);
  const uy = Math.sin(direction);
  const projected = grid.map((p) => ({ p, proj: p.x * ux + p.y * uy }));
  projected.sort((a, b) => a.proj - b.proj);
  const minProj = projected[0]?.proj ?? 0;

  let lap = 0;
  while (lap < loops) {
    let cursor = 0;
    let elapsed = 0;
    shoot();
    while (cursor < projected.length) {
      while (cursor < projected.length) {
        const item = projected[cursor];
        if (!item) break;
        const arrivalFrames = ((item.proj - minProj) / speed) * SCRIPT_FPS;
        if (arrivalFrames > elapsed + 1e-6) break;
        const m = mover(item.p, self);
        const spawnOpts =
          life !== null
            ? {
                script: function* (b: Entity): Generator<ScriptYield, void, void> {
                  yield life;
                  if (b.alive) b.die();
                },
              }
            : undefined;
        const e = self.spawn(kind, item.p.x, item.p.y, m.vx, m.vy, spawnOpts);
        if (m.ax !== 0 || m.ay !== 0) e.body.setAcceleration(m.ax, m.ay);
        cursor++;
      }
      yield 1;
      elapsed++;
    }
    lap++;
    if (lap < loops && loopDelay > 0) yield loopDelay;
  }
}

// A `(dx, dy)` lattice covering the whole field, drifting as one rigid
// tile at `(vx, vy)` px/s. Each bullet wraps modulo the tile period so
// the field stays uniformly covered indefinitely — visualises as a
// "tiled background that scrolls", uniformly threatening from every
// direction. `hex: true` shifts every other row by `dx/2` for triangular
// tessellation; row count rounds to even so the wrap stays parity-clean.
//
// Phases: spawn the still tile → optional `fillHoldFrames` so the player
// reads the layout → engage motion + per-frame wrap until
// `durationFrames` (default Infinity) elapses → kill survivors.
//
// The wrap math sizes the period as `(ceil(GAME_W / dx) + 2) * dx` so
// thresholds at `-dx` / `GAME_W + dx` swap a bullet from one edge to
// the other while staying inside the cull margin and inside the
// just-wrapped band — no double-wrap risk at reasonable velocities.
export function* tiledScroll(
  self: Entity,
  opts: {
    kind: EntityKind;
    dx: number;
    dy: number;
    vx: number;
    vy: number;
    hex?: boolean;
    fillHoldFrames?: number;
    durationFrames?: number;
  },
): Generator<ScriptYield, void, void> {
  const { kind, dx, dy, vx, vy } = opts;
  if (dx <= 0 || dy <= 0) return;
  const hex = opts.hex ?? false;
  const fillHold = Math.max(0, Math.round(opts.fillHoldFrames ?? 0));
  const duration = opts.durationFrames ?? Infinity;

  const colsCount = Math.ceil(GAME_W / dx) + 2;
  let rowsCount = Math.ceil(GAME_H / dy) + 2;
  if (hex && rowsCount % 2 !== 0) rowsCount++;
  const periodX = colsCount * dx;
  const periodY = rowsCount * dy;
  const x0 = -dx;
  const y0 = -dy;
  // Wrap thresholds — one cell beyond the spawn band on each side.
  const wrapMinX = x0;
  const wrapMaxX = x0 + periodX;
  const wrapMinY = y0;
  const wrapMaxY = y0 + periodY;

  // Phase 1 — spawn the still tile.
  shoot();
  const bullets: Entity[] = [];
  for (let r = 0; r < rowsCount; r++) {
    const offsetX = hex && r % 2 ? dx / 2 : 0;
    for (let c = 0; c < colsCount; c++) {
      const x = x0 + c * dx + offsetX;
      const y = y0 + r * dy;
      bullets.push(self.spawn(kind, x, y, 0, 0));
    }
  }

  // Phase 2 — hold so the threat reads.
  if (fillHold > 0) yield fillHold;

  // Phase 3 — engage motion.
  for (const b of bullets) {
    if (b.alive) b.body.setVelocity(vx, vy);
  }

  // Phase 4 — drive the wrap loop. `body.reset(x, y)` sets position +
  // re-syncs body.prev so velocity stays consistent through the wrap;
  // setVelocity restores the drift since reset zeros it.
  let elapsed = 0;
  while (elapsed < duration) {
    yield 1;
    elapsed++;
    for (const b of bullets) {
      if (!b.alive) continue;
      let nx = b.x;
      let ny = b.y;
      let wrapped = false;
      if (nx < wrapMinX) {
        nx += periodX;
        wrapped = true;
      } else if (nx > wrapMaxX) {
        nx -= periodX;
        wrapped = true;
      }
      if (ny < wrapMinY) {
        ny += periodY;
        wrapped = true;
      } else if (ny > wrapMaxY) {
        ny -= periodY;
        wrapped = true;
      }
      if (wrapped) {
        b.body.reset(nx, ny);
        b.body.setVelocity(vx, vy);
      }
    }
  }

  // Phase 5 — clear the field on exit so the next pattern starts clean.
  for (const b of bullets) if (b.alive) b.die();
}

// A stroke from `(x1,y1) → (x2,y2)` lasting `lifeFrames` frames.
// Two modes, both fire-and-forget so multiple intersecting strokes can
// telegraph in parallel:
//
//   damaging: true (default) — lays a row of stationary bullets along
//     the segment; each lethal for `lifeFrames` before self-destructing.
//     Snaps in instantly. `spacing` defaults to `kind.hitboxRadius × 2`
//     so squares touch and circles barely kiss.
//
//   damaging: false — spawns an inert script entity that draws an
//     animated Phaser line growing from start to endpoint, then holds.
//     Alpha brightens 0.3 → 0.8 as it fills, then stays solid. No
//     bullets spawn, so the warning passes through the player. The
//     entity ticks with the simulation, so dialog / pause freeze the
//     animation cleanly.
//
// Telegraph → detonate: call once with damaging:false for the warning,
// `yield` for the warning's life, then call again with damaging:true:
//
//   lineStroke(self, x1, y1, x2, y2, redSq, 60, { damaging: false });
//   lineStroke(self, ax, ay, bx, by, redSq, 60, { damaging: false });
//   yield 60;                                    // both telegraphs play in parallel
//   lineStroke(self, x1, y1, x2, y2, redSq, 30); // detonate first line
//   lineStroke(self, ax, ay, bx, by, redSq, 30); // detonate second
export function lineStroke(
  self: Entity,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: EntityKind,
  lifeFrames: number,
  opts?: {
    damaging?: boolean;
    spacing?: number;
    color?: number;
    width?: number;
  },
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const life = Math.max(1, Math.round(lifeFrames));
  const damaging = opts?.damaging ?? true;

  if (damaging) {
    shoot();
    const step = opts?.spacing ?? Math.max(2, kind.hitboxRadius * 2);
    const count = Math.max(2, Math.ceil(dist / step) + 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      self.spawn(kind, px, py, 0, 0, {
        script: function* (b) {
          yield life;
          if (b.alive) b.die();
        },
      });
    }
    return;
  }

  // Non-damaging telegraph. Grow over the first half of life, hold at
  // full opacity for the second half — predictable read time without
  // an extra parameter. The animation lives on an INERT_KIND entity's
  // script so it pauses with the rest of the simulation; the graphic
  // is owned by the script and destroyed on exit.
  const color = opts?.color ?? 0xff5577;
  const width = opts?.width ?? 2;
  const grow = Math.max(1, Math.floor(life / 2));
  const hold = life - grow;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  self.spawn(INERT_KIND, mx, my, 0, 0, {
    script: function* (e) {
      // Use the dedicated `Phaser.GameObjects.Line` rather than a
      // Graphics + lineBetween — Graphics path strokes were truncating
      // at the camera-viewport center on the sandbox's non-integer
      // pixelArt zoom. Line is a separate render path (a textured quad)
      // that doesn't go through the path-stroke rasterizer, so the full
      // segment renders cleanly.
      //
      // Phaser.Line's anchor (line.x, line.y) sits at the geometric
      // center of the segment, so we set position to the midpoint and
      // pass the endpoints in local space (relative to that midpoint).
      // setTo redraws the local endpoints each frame; the world
      // position stays at midpoint.
      const scene = e.stage.scene;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const line = scene.add.line(cx, cy, 0, 0, 0, 0, color, 1).setOrigin(0.5, 0.5).setLineWidth(width).setDepth(1);
      for (let i = 1; i <= grow; i++) {
        const t = i / grow;
        const alpha = 0.3 + 0.5 * t;
        // Endpoints in line-local space (midpoint at 0,0).
        line.setTo(x1 - cx, y1 - cy, x1 + dx * t - cx, y1 + dy * t - cy);
        line.setAlpha(alpha);
        yield 1;
      }
      if (hold > 0) yield hold;
      line.destroy();
      e.die();
    },
  });
}

// Propagating shockwave of explosion sprites along a line from
// (x1,y1) to (x2,y2). Each tile is a `blueExplosion` entity placed
// at a fixed position; the pattern drives the *sprite frame* of
// every active tile manually each tick.
//
// Algorithm — every tick advances frames on existing tiles; spawns
// happen every `framesPerSpawn` ticks:
//
//   framesPerSpawn = 1 (default — front + tail tightly chained):
//     tick 0:  spawn tile 0, frame 0
//     tick 1:  tile 0 → frame 1; spawn tile 1, frame 0
//     tick 2:  tile 0 → frame 2; tile 1 → frame 1; spawn tile 2, frame 0
//     …
//
//   framesPerSpawn = 3 (each tile holds 3 frames in place before the
//                       next position joins):
//     tick 0:  spawn tile 0, frame 0
//     tick 1:  tile 0 → frame 1
//     tick 2:  tile 0 → frame 2
//     tick 3:  tile 0 → frame 3; spawn tile 1, frame 0
//     tick 4:  tile 0 → frame 4; tile 1 → frame 1
//     …
//
// A tile dies after it advances past the last animation frame.
// Direction-agnostic — "from down to up" is just
// `lineExplosion(self, x, GAME_H-50, x, 50)`.
//
// All tiles are damaging while alive (each tile's hitbox is the
// entity's `hitboxRadius`). The propagating front is the player's
// telegraph; the trailing tail is the danger zone.
export function* lineExplosion(
  self: Entity,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts?: {
    // Distance between consecutive tile positions, in pixels.
    // Default = sprite width + 6 px so adjacent tiles have a small
    // visible gap between them.
    stepPx?: number;
    // Wavefront propagation speed in pixels per second — i.e. how
    // fast the leading edge advances. Convenience over `stepFrames`:
    // internally rewrites `stepFrames` to hit the requested speed
    // given the chosen `stepPx` + `framesPerSpawn`. Ignored when
    // `stepFrames` is set explicitly.
    speedPxPerSec?: number;
    // Physics frames between sprite-frame ticks. Default = each
    // animation frame's intended duration. Each tile shows each of
    // its sprite frames for exactly `stepFrames` physics frames.
    // Explicit `stepFrames` overrides `speedPxPerSec`.
    stepFrames?: number;
    // How many sprite-frame ticks each tile holds *in place* before
    // the next position spawns. Default 1 (front spawns every tick,
    // every existing tile lags one frame behind its neighbour).
    // Set to 3 to give each tile a 3-frame head-start in place
    // before the next tile joins — the trailing tiles spread out
    // visibly with 3 sprite frames between adjacent positions
    // instead of 1, and the wavefront speed drops proportionally
    // unless `speedPxPerSec` compensates.
    framesPerSpawn?: number;
    // Override the spawned entity kind. Must be a spritesheet kind
    // with at least `frameCount` frames. Default is `blueExplosion`.
    kind?: EntityKind;
    // Number of sprite frames in the kind's spritesheet. Default
    // 7 (matches `blueExplosion` after the uniform-grid re-pack +
    // scatter merge).
    frameCount?: number;
  },
): Generator<ScriptYield, void, void> {
  const stepPx = opts?.stepPx ?? BLUE_EXPLOSION_FRAME_W + 6;
  const framesPerSpawn = Math.max(1, Math.round(opts?.framesPerSpawn ?? 1));
  // Resolution order for tick spacing:
  //   1. explicit `stepFrames`           — exact, integer
  //   2. derived from `speedPxPerSec`    — wavefront moves `stepPx`
  //                                        every `framesPerSpawn`
  //                                        ticks; back out the
  //                                        per-tick frame budget
  //                                        from that
  //   3. animation's per-frame duration  — keeps each sprite frame
  //                                        on screen the intended
  //                                        time
  const stepFrames =
    opts?.stepFrames ??
    (opts?.speedPxPerSec !== undefined
      ? Math.max(1, Math.round((stepPx * SCRIPT_FPS) / (opts.speedPxPerSec * framesPerSpawn)))
      : BLUE_EXPLOSION_FRAME_DURATION_FRAMES);
  const kind = opts?.kind ?? blueExplosion;
  const frameCount = opts?.frameCount ?? 7;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;

  // Fixed stride from (x1,y1); positions land every stepPx along the
  // line. The last position may sit slightly short of (x2,y2) when
  // the distance isn't a clean multiple of stepPx — that's the right
  // trade-off vs interpolating, which would compress the spacing.
  const positions = Math.max(1, Math.floor(dist / stepPx) + 1);
  const ux = dx / dist;
  const uy = dy / dist;

  // Per-position slot: the active entity at that position, and the
  // sprite frame it currently shows. `null` once the tile has died
  // or before it has been spawned.
  type Slot = { entity: Entity; frame: number } | null;
  const slots: Slot[] = new Array(positions).fill(null);

  shoot();
  // Total ticks: last tile spawns at tick (positions-1)*framesPerSpawn
  // and lives for `frameCount` more ticks before dying.
  const totalTicks = (positions - 1) * framesPerSpawn + frameCount;

  for (let tick = 0; tick < totalTicks; tick++) {
    // 1. Advance frame on every active slot. A slot whose new frame
    //    is past the last animation frame is killed and cleared.
    for (let p = 0; p < positions; p++) {
      const slot = slots[p];
      if (!slot) continue;
      slot.frame++;
      if (slot.frame >= frameCount) {
        if (slot.entity.alive) slot.entity.die();
        slots[p] = null;
      } else {
        slot.entity.setFrame(slot.frame);
      }
    }

    // 2. Spawn the next tile every `framesPerSpawn` ticks. The
    //    position index is the tick count divided by the spawn
    //    cadence — only valid when the tick lands on a spawn beat
    //    AND there's still a position to fill.
    if (tick % framesPerSpawn === 0) {
      const i = tick / framesPerSpawn;
      if (i < positions) {
        const px = x1 + ux * i * stepPx;
        const py = y1 + uy * i * stepPx;
        const entity = self.spawn(kind, px, py, 0, 0);
        entity.setFrame(0);
        slots[i] = { entity, frame: 0 };
      }
    }

    yield stepFrames;
  }

  // Cleanup — any tile still alive at the end (shouldn't happen if
  // totalTicks is right) gets killed defensively.
  for (const slot of slots) {
    if (slot && slot.entity.alive) slot.entity.die();
  }
}

// Same algorithm as `lineExplosion`, pre-baked with the
// `redExplosion` sprite + a slower / sparser default profile:
// wide spacing between tiles (60 px), long frame hold (9 phys frames
// per sprite frame), and five frames in place before the next spawn.
// Effective wavefront speed at defaults ≈ 80 px/s — a deliberate,
// ominous march vs. the blue variant's quick snap.
//
// All `lineExplosion` opts are accepted; user-supplied values
// override the wrapper's defaults.
export function* lineRedExplosion(
  self: Entity,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts?: {
    stepPx?: number;
    speedPxPerSec?: number;
    stepFrames?: number;
    framesPerSpawn?: number;
    kind?: EntityKind;
    frameCount?: number;
  },
): Generator<ScriptYield, void, void> {
  yield* lineExplosion(self, x1, y1, x2, y2, {
    kind: redExplosion,
    frameCount: RED_EXPLOSION_FRAMES,
    stepPx: 60,
    stepFrames: 9,
    framesPerSpawn: 5,
    ...opts,
  });
}

// `lineStroke` with a built-in telegraph → detonate cycle. Draws a
// non-damaging warning line immediately (lifetime = `offsetMs`), then
// schedules a damaging lineStroke at the same coordinates `offsetMs`
// later via `scene.time.delayedCall`. Single-call convenience for
// callers that want "warn for N ms, then commit". Cancels the
// lethal phase if the firing entity has died by the time the
// detonation tick comes around.
//
// Side-effect scheduling: the delayedCall uses scene time, which is
// NOT gated by physics pause — a dialog freeze that overlaps the
// telegraph window will still let the detonation fire. Acceptable
// for boss patterns where dialogs happen between attacks; revisit
// if a pattern needs to be pause-safe.
export function lineStrokeTelegraph(
  self: Entity,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  offsetMs: number,
  opts?: {
    // Bullet kind to use for both the warning and the detonation.
    // Default = white `bullet`.
    kind?: EntityKind;
    // Physics frames the lethal line stays on screen. Default 30
    // (~0.5 s) — a brief blink. Bump higher for a "stay out of this
    // lane" wall.
    lethalFrames?: number;
    spacing?: number;
    color?: number;
    width?: number;
  },
): void {
  const kind = opts?.kind ?? bullet;
  const lethalFrames = opts?.lethalFrames ?? 30;
  const telegraphFrames = Math.max(1, Math.round((offsetMs * SCRIPT_FPS) / 1000));
  const lineOpts = {
    spacing: opts?.spacing,
    color: opts?.color,
    width: opts?.width,
  };

  // Warning — non-damaging, fades / draws over its lifetime then
  // disappears just as the lethal version takes over.
  lineStroke(self, x1, y1, x2, y2, kind, telegraphFrames, {
    ...lineOpts,
    damaging: false,
  });

  self.scene.time.delayedCall(offsetMs, () => {
    if (!self.alive) return;
    lineStroke(self, x1, y1, x2, y2, kind, lethalFrames, {
      ...lineOpts,
      damaging: true,
    });
  });
}

// Quick directional camera punch — tweens the main camera's scroll
// by `dx`/`dy` and yoyos back. Used as a sub-second VFX accent on
// boss patterns: a positive `dx` punches the world *left* (camera
// looks right), reading as "screen shake right".
//
// Pure side-effect; safe to call from a sync `fire` callback in a
// beatmap. Multiple overlapping punches stack via Phaser's tween
// system without fighting each other.
export function cameraPunch(self: Entity, dx: number, dy = 0, durationMs = 120): void {
  const cam = self.scene.cameras.main;
  self.scene.tweens.add({
    targets: cam,
    scrollX: cam.scrollX + dx,
    scrollY: cam.scrollY + dy,
    duration: durationMs / 2,
    yoyo: true,
    ease: 'Quad.easeOut',
  });
}
