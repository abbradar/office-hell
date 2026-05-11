import { shoot } from '../audio/sfx/events';
import { GAME_H, GAME_W, SCRIPT_FPS } from '../config';
import type { Entity } from '../entities/Entity';
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
