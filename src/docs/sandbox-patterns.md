# Pattern sandbox — example scripts

Cookbook of bullet patterns you can paste straight into the **PRACTICE
→ PATTERN SANDBOX** code tab. Each one assumes the helpers exposed by
[src/scenes/PatternTestScene.ts](../scenes/PatternTestScene.ts) — the
default `bullet` kind, the `bulletStyle({color, radius, shape})`
factory, and the `ring` / `aimed` / `spread` / `arc` / `moveTo` /
`waitSeconds` primitives from [src/script/patterns.ts](../script/patterns.ts).

Note: stuff like multi-phase bullets and reverse spirals fall outside
the named primitives — they need raw `self.spawn(kind, x, y, vx, vy,
{script})` calls. Those examples are below.

---

## 1. Two-tone alternating ring

Simplest "color in your pattern" — two rings of different bullet kinds
fired on alternating beats, second ring rotated half a step so the
two colors interleave.

```js
const red = bulletStyle({ color: 0xff5577, radius: 4 });
const blue = bulletStyle({ color: 0x66bbff, radius: 4, shape: 'diamond' });

while (true) {
  ring(self, 12, red, 130);
  yield* waitSeconds(0.25);
  ring(self, 12, blue, 130, Math.PI / 12);  // half a step offset
  yield* waitSeconds(0.25);
}
```

## 2. Aimed burst with sweep

Aim a tight 5-bullet fan at the player, hold, repeat. Vary the spread
angle to taste.

```js
const pink = bulletStyle({ color: 0xff8aa7, radius: 3 });

while (true) {
  aimed(self, 5, pink, 220, Math.PI / 6);  // 30° spread
  yield* waitSeconds(0.6);
}
```

## 3. Spiral

Rings rotated by a constant offset each tick produce a spiral. Smaller
delta + faster cadence → tighter spiral; larger → "petals".

```js
const cyan = bulletStyle({ color: 0x66ffe0, radius: 3 });

let theta = 0;
while (true) {
  ring(self, 8, cyan, 110, theta);
  theta += Math.PI / 24;     // ~7.5° per tick
  yield 6;                    // 10 Hz
}
```

## 4. Reverse spiral (bullets converge inward)

The named primitives all spawn at `self.x, self.y` and fly outward.
For "bullets fly *toward* the spawn point", drop down to raw
`self.spawn(...)` and place each bullet on a ring around the boss with
velocity pointed back at the centre.

```js
const yellow = bulletStyle({ color: 0xffd96a, radius: 3 });
const RADIUS = 80;
const SPEED = 90;

let theta = 0;
while (true) {
  for (let i = 0; i < 12; i++) {
    const a = theta + (i * Math.PI * 2) / 12;
    const x = self.x + Math.cos(a) * RADIUS;
    const y = self.y + Math.sin(a) * RADIUS;
    // Velocity = unit vector from (x,y) → (self.x,self.y), times SPEED.
    self.spawn(yellow, x, y, -Math.cos(a) * SPEED, -Math.sin(a) * SPEED);
  }
  theta += Math.PI / 36;
  yield 8;
}
```

## 5. Multi-phase bullet (fly to corner, then home on player)

Bullet spawns at the boss, moves to the top-right for ~30 frames,
then re-aims at the player and flies straight in. Done by passing a
`{script}` SpawnOpt — the per-entity generator gets advanced just
like any other script.

```js
const orange = bulletStyle({ color: 0xff9944, radius: 4 });

while (true) {
  self.spawn(orange, self.x, self.y, 0, 0, {
    script: function* (b) {
      // Phase 1 — drift toward top-right.
      b.setVelocity(140, -100);
      yield 30;
      // Phase 2 — re-aim at the player and accelerate.
      const a = b.angleToPlayer();
      const SPEED = 220;
      b.setVelocity(Math.cos(a) * SPEED, Math.sin(a) * SPEED);
      // Bullet lives until it crosses the cull margin.
    },
  });
  yield* waitSeconds(0.4);
}
```

You can chain as many phases as you like: each `yield N` waits N
frames, `yield* waitSeconds(s)` falls back to frames in practice mode,
and `yield { until: someEntity }` waits for another entity to die.

## 6. Homing volley

Aimed burst where every bullet keeps re-aiming at the player every
~1/3 second instead of flying straight. Slow speed so the homing is
visible.

```js
const red = bulletStyle({ color: 0xff5577, radius: 3 });

while (true) {
  for (let i = 0; i < 8; i++) {
    const baseAngle = self.angleToPlayer() + (i - 3.5) * 0.06;
    self.spawn(
      red,
      self.x,
      self.y,
      Math.cos(baseAngle) * 120,
      Math.sin(baseAngle) * 120,
      {
        script: function* (b) {
          for (let k = 0; k < 4; k++) {
            yield 20;                    // ~1/3 sec
            const a = b.angleToPlayer();
            b.setVelocity(Math.cos(a) * 140, Math.sin(a) * 140);
          }
          // After 4 corrections, fly straight forever.
        },
      },
    );
  }
  yield* waitSeconds(1.5);
}
```

## 7. Arc fan (cone of bullets)

`arc(...)` lays bullets evenly between two angles. Useful for a "cone
of fire" pointing in a specific direction without aiming at the player.

```js
const blue = bulletStyle({ color: 0x66bbff, radius: 3 });

while (true) {
  // 9 bullets evenly spread between 30° and 150°, i.e. a 120° fan
  // pointing roughly downward.
  arc(self, 9, blue, 150, Math.PI / 6, (5 * Math.PI) / 6);
  yield* waitSeconds(0.7);
}
```

## 8. Turrets

Stationary "emitter" entities spawned at fixed positions, each running
its own firing loop via a per-bullet `{script}` SpawnOpt. The boss
plants them, then idles while they do the work. Staggered starts keep
them from volleying in lockstep.

```js
const turret = bulletStyle({ color: 0x88aaff, radius: 7, shape: 'square' });
const shot = bulletStyle({ color: 0xffd96a, radius: 3 });

const TURRET_Y = 80;
for (let i = 0; i < 3; i++) {
  const tx = 80 + i * 120;        // three across the top of the playfield
  self.spawn(turret, tx, TURRET_Y, 0, 0, {
    script: function* (t) {
      yield i * 24;                // stagger by ~0.4 s per turret
      while (true) {
        aimed(t, 3, shot, 180, Math.PI / 8);   // 3-bullet fan, 22.5° spread
        yield* waitSeconds(1.2);
      }
    },
  });
}

// Boss itself idles while the turrets shoot.
while (true) yield 60;
```

A rotating variant: replace the `aimed` call with `ring(t, 1, shot, 160, theta)`
inside an inner `theta += Math.PI / 18; yield 6;` loop to sweep a single bullet
in a circle. Add multiple bullets per ring for a fan that orbits.

## 9. Wall of 5 enemies

Five enemies enter as a horizontal row, glide left-to-right while each
fires a ring, then accelerate off the right edge after 5 seconds.
Same per-entity `{script}` trick as the turret example, but the
script's first phase is timed and the second swaps velocity for an
exit dash.

```js
const enemy = bulletStyle({ color: 0xcc4466, radius: 10, shape: 'square' });
const shot = bulletStyle({ color: 0xff9944, radius: 3 });

// Five-wide row entering from the left edge. Same vx on every enemy
// keeps them aligned as they drift across.
const Y = 140;
const SPACING = 56;
const DRIFT_VX = 50;
const EXIT_VX = 260;

for (let i = 0; i < 5; i++) {
  self.spawn(enemy, -40 + i * SPACING, Y, DRIFT_VX, 0, {
    script: function* (e) {
      // Phase 1 — fire a ring every 0.5 s for 5 s (10 rings).
      for (let n = 0; n < 10; n++) {
        ring(e, 8, shot, 100);
        yield* waitSeconds(0.5);
      }
      // Phase 2 — dash off-screen right. The entity is auto-released
      // by the cull margin once it crosses GAME_W.
      e.setVelocity(EXIT_VX, 0);
    },
  });
}

// Boss idles while the wall does its thing.
while (true) yield 60;
```

If you want the wall to enter as a single beat (all 5 spawning at the
same moment but visually staggered), keep the loop above. For a
**rolling** entry where each enemy joins the wall a beat later, add
`yield* waitSeconds(0.15);` inside the loop after each `self.spawn`.

## 10. Mixed shapes

Mix shapes and sizes for visual hierarchy — small fast bullets for
fill, large slow ones for read-the-room moments.

```js
const fill = bulletStyle({ color: 0xffffff, radius: 2 });
const heavy = bulletStyle({ color: 0xff5577, radius: 6, shape: 'square' });

while (true) {
  ring(self, 24, fill, 180);
  yield* waitSeconds(0.15);
  ring(self, 24, fill, 180, Math.PI / 24);
  yield* waitSeconds(0.15);
  aimed(self, 1, heavy, 80);            // single big aimed bullet
  yield* waitSeconds(0.7);
}
```

## 11. Hex rain (composition: hexGrid + move + wave)

Three small primitives compose into rain. The grid says **where**, the
mover says **how each bullet moves**, the wave says **when**.

- `hexGrid` — points on a hex lattice; alternate rows shift right by
  `dx/2` so the bullets tessellate.
- `move(angle, speed, accel?)` — mover that gives every bullet the same
  heading + linear acceleration. `Math.PI / 2` is "down".
- `wave` — spawns the grid as a wavefront propagating along `direction`
  at `speed` px/s; loops with `loopDelayFrames` between passes.

For continuous rain, the grid is a single hex row at the top of the
field; the wave loops forever and each loop alternates between the
straight and shifted row by translating `x0` between calls. Each
bullet falls and accelerates via the mover, exiting through the bottom
cull margin on its own (no `lifeFrames` needed).

```js
const blueD = bulletStyle({ color: 0x66bbff, radius: 3, shape: 'diamond' });
const falling = move(Math.PI / 2, 30, 80);   // down, accelerating

let beat = 0;
while (true) {
  // Single-row hex sweep at the top. `x0` shifts by dx/2 every other
  // beat for the tessellation; `speed: Infinity` makes the whole row
  // spawn on the same frame (no horizontal sweep).
  yield* wave(self, {
    grid: hexGrid({
      cols: 6,
      rows: 1,
      x0: 16 + (beat % 2 === 0 ? 0 : 16),
      y0: -8,
      dx: 32,
    }),
    kind: blueD,
    mover: falling,
    speed: Infinity,
    loops: 1,
  });
  beat++;
  yield 32;   // one beat at 113 BPM (60 fps)
}
```

Knobs: `cols` controls density across the field. The outer `yield 32`
sets row cadence (drop for torrential, raise for sparse). `move(π/2,
v0, a)` tunes start-speed vs acceleration — small `v0` and large `a`
gives the "creeps then drowns" feel. Swap the angle for diagonal rain.

For a "wall sweeps in then dissolves" variant: full-field grid + slow
`speed` + short `lifeFrames` + STILL mover.

```js
yield* wave(self, {
  grid: hexGrid({ cols: 6, rows: 12, x0: 16, y0: 0, dx: 32 }),
  kind: blueD,
  mover: STILL,           // bullets don't move, they just blink in/out
  direction: Math.PI / 2, // sweep top-to-bottom
  speed: 200,             // wavefront px/s
  lifeFrames: 60,         // each bullet shows for 1s after the front passes
});
```

Rotate the wave by changing `direction` — `Math.PI / 4` for a diagonal,
`-Math.PI / 2` for bottom-to-top, `0` for left-to-right.

## 12. Scrolling tile

Bullets fill the whole field on a `(dx, dy)` lattice and then drift as
one rigid tile, wrapping around the edges so the field stays uniformly
threatened. `tiledScroll` handles spawn → optional read-the-layout
hold → motion + per-frame wrap → cleanup on exit. Pass `hex: true` for
a triangular lattice (every other row shifted `dx/2`).

```js
const blueD = bulletStyle({ color: 0x66bbff, radius: 3, shape: 'diamond' });

// Spawn the lattice, hold for ~0.5s so the player sees it, then drift
// down-right indefinitely. The tile wraps so the field is always full.
yield* tiledScroll(self, {
  kind: blueD,
  dx: 32,
  dy: 32,
  vx: 30,
  vy: 60,
  hex: true,
  fillHoldFrames: 30,
});
```

Knobs: `dx` / `dy` are density (smaller = denser, harder to weave —
note the field is 200×660 so `dx: 32` gives ~8 columns of bullets at
once). `(vx, vy)` is the drift; orient it for visual variety —
straight-down is rain-like, diagonal feels like a current, mostly-
horizontal feels like a side-scroll. Cap with `durationFrames` to
auto-clear before transitioning to the next phase, or omit it for
"runs until the boss dies".

A pulsing variant: chain a `tiledScroll` with `durationFrames: 240` to
two beats of nothing, then call again with rotated `(vx, vy)` so the
tile changes direction between bars.

## 13. Field-dividing strokes

Stationary red squares laid along a line segment — each lethal for
`lifeFrames` before despawning. Compose multiple calls to slice the
field into regions. Default spacing makes squares touch, so the line
reads as solid. The function is fire-and-forget; the caller controls
when to throw the next stroke.

```js
const redSq = bulletStyle({ color: 0xff5577, radius: 2, shape: 'square' });
const LIFE = 180;   // 3 seconds at 60 fps

while (true) {
  // Three crossing strokes — diagonal, horizontal, vertical — all
  // lethal for 3s. Player has to find the one safe pocket between
  // them before they vanish.
  lineStroke(self, 0, 0, 200, 660, redSq, LIFE);
  lineStroke(self, 0, 200, 200, 200, redSq, LIFE);
  lineStroke(self, 100, 0, 100, 660, redSq, LIFE);
  yield* waitSeconds(3.5);   // slightly longer than LIFE so strokes clear before next set
}
```

For a "telegraph then commit" feel, call `lineStroke` twice with the
same coordinates: first with `damaging: false` to draw an animated
warning (the line grows from start to endpoint, alpha brightening as
it fills, then holds at full opacity for half its life), then `yield`
for the warning's life, then again with the default `damaging: true`
to detonate.

Both modes are fire-and-forget — multiple intersecting strokes can
telegraph in parallel without waiting on each other.

```js
const redSq = bulletStyle({ color: 0xff5577, radius: 2, shape: 'square' });

while (self.alive) {
  const ax = Math.random() * 200;
  const bx = Math.random() * 200;
  const cy = Math.random() * 660;

  // Three crossing telegraphs draw in parallel — vertical, horizontal,
  // diagonal.
  lineStroke(self, ax, 0, ax, 660, redSq, 60, { damaging: false });
  lineStroke(self, 0, cy, 200, cy, redSq, 60, { damaging: false });
  lineStroke(self, 0, 0, bx, 660, redSq, 60, { damaging: false });

  yield 60;   // wait the warnings out

  // Detonate all three with one short lethal stroke each.
  lineStroke(self, ax, 0, ax, 660, redSq, 30);
  lineStroke(self, 0, cy, 200, cy, redSq, 30);
  lineStroke(self, 0, 0, bx, 660, redSq, 30);
  yield* waitSeconds(0.6);
}
```

Knobs: `lifeFrames` is the warning's total visible time (split 50/50
into grow + hold phases). For the lethal hit, `lifeFrames` is the
duration the bullets exist before despawning — short for a blink,
long for a "stay out of this lane" wall.

---

## 14. Line explosion (propagating shockwave)

A line of `blueExplosion` sprite tiles where the wavefront marches
forward and each trailing tile keeps cycling its sprite animation
in place. Every tick the pattern advances the sprite frame on every
active tile; spawns happen every `framesPerSpawn` ticks (default 1):

```
framesPerSpawn = 1 (default — front + tail tightly chained):
  tick 0:  spawn tile 0, frame 0
  tick 1:  tile 0 → frame 1; spawn tile 1, frame 0
  tick 2:  tile 0 → frame 2; tile 1 → frame 1; spawn tile 2, frame 0
  ...

framesPerSpawn = 3 (each tile holds 3 frames in place before the next
                    position joins):
  tick 0:  spawn tile 0, frame 0
  tick 1:  tile 0 → frame 1
  tick 2:  tile 0 → frame 2
  tick 3:  tile 0 → frame 3; spawn tile 1, frame 0
  tick 4:  tile 0 → frame 4; tile 1 → frame 1
  ...
```

Tiles die after they advance past the last animation frame. Every
tile is damaging while alive — the leading edge is the player's
visual telegraph, the trailing tail is the no-fly zone.

```js
// Vertical wave from bottom to top of the field, default speed.
yield* lineExplosion(self, 200, 480, 200, 100);
```

The line is direction-agnostic — pass any two endpoints and the wave
walks from the first to the second.

```js
// Diagonal sweep, slower (250 px/s).
yield* lineExplosion(self, 20, 80, 380, 600, { speedPxPerSec: 250 });

// Horizontal sweep right → left, wider gap between tiles (32 px).
yield* lineExplosion(self, GAME_W - 20, 240, 20, 240, { stepPx: 32 });

// Each tile holds for 3 sprite frames before the next spawn — the
// tail spreads out with 3 frames between adjacent positions.
yield* lineExplosion(self, 200, 480, 200, 100, { framesPerSpawn: 3 });

// Slow, drawn-out wave — wavefront speed is preserved across
// framesPerSpawn, so combining the two parameters tunes the visual
// "thickness" of the tail without changing how fast the front moves.
yield* lineExplosion(self, 40, 320, 360, 320, {
  speedPxPerSec: 200,
  framesPerSpawn: 3,
});

// Pair of crossing waves — first cancels into nothing while the
// second is still walking. Race them in parallel via {all:}.
yield {
  all: [
    lineExplosion(self, 40, 200, 360, 200),
    lineExplosion(self, 360, 320, 40, 320, { speedPxPerSec: 350 }),
  ],
};
```

Knobs:

- `stepPx` — distance between consecutive tile positions. Default =
  sprite width (16) + 6 px padding = **22 px**. Lower for denser
  walls, higher for spaced-out beads.
- `speedPxPerSec` — wavefront propagation speed in pixels per
  second. Convenience over `stepFrames`; internally rewrites
  `stepFrames = round(stepPx · 60 / (speed · framesPerSpawn))` so
  the wavefront speed stays correct regardless of `framesPerSpawn`.
- `stepFrames` — physics frames between sprite-frame ticks
  (overrides `speedPxPerSec` when set). Each tile shows each of its
  sprite frames for exactly `stepFrames` physics frames.
- `framesPerSpawn` — how many sprite-frame ticks each tile holds in
  place before the next position spawns. Default 1. Set higher to
  spread the tail out — at `framesPerSpawn = 3`, adjacent tiles lag
  3 sprite frames behind each other instead of 1.
- `frameCount` — number of sprite frames in the animation. Default
  7 (matches `blueExplosion`). Lower = shorter tail.
- `kind` — alternative spritesheet kind (must have ≥ `frameCount`
  frames). Default is `blueExplosion`.

### Red-explosion variant

`lineRedExplosion(self, x1, y1, x2, y2, opts?)` is a thin wrapper
that pre-bakes the `redExplosion` sprite (8-frame red-orange burst)
with a deliberate slow-march default: `stepPx: 60`, `stepFrames: 9`,
`framesPerSpawn: 5`. Effective wavefront speed ≈ **80 px/s** vs.
the blue variant's ~660 px/s. Tile lifetime is 1.2 s each, so the
trail lingers visibly.

```js
// Slow red sweep bottom → top.
yield* lineRedExplosion(self, 200, 480, 200, 100);

// Override any default — same opts surface as `lineExplosion`.
yield* lineRedExplosion(self, 40, 200, 360, 200, {
  speedPxPerSec: 200,   // bump the front speed
});
```

Total run time: `(positions + frameCount - 1) × stepFrames` physics
frames. For the default 22 px stride and ~480 px/s, a 380-px line
runs in ~1.0 s — a quick wave that leaves the field after the
trailing scatter fades.

The pattern is a generator — `yield*` it. To overlap multiple lines,
wrap them in `{ all: [...] }` (join, see §11) or `{ race: [...] }`
(cancel losers).

## 15. Cluster shot (aimed pack with jittered spawn)

`cluster` fires N bullets all aimed at the player on the same heading,
but each spawns from a random offset inside a small disk around the
firing entity. Reads as one heavy volley to dodge rather than a fan
to thread — useful as a punctuation hit between two slower patterns.

```js
const red = bulletStyle({ color: 0xff5577, radius: 3 });

while (true) {
  // 10 bullets, ~14 px jitter around (self.x, self.y).
  cluster(self, 10, red, 220);
  yield* waitSeconds(0.9);
}
```

The 5th arg is the jitter radius (default 14 px). Pass a larger
value for a looser "cone of fire" feel, smaller for a tight slug.

## 16. Orbiting arc (held + spinning)

`orbitArc` parks N bullets on a circular arc around an entity and
optionally rotates them. Bullets are body-driven (not velocity-
driven), so they hold their orbit exactly. Damage classes stay
normal — touch the bullets and the player dies.

```js
const cyan = bulletStyle({ color: 0x66ffe0, radius: 3 });

// Hovering half-ring above the boss, rotating CW at 1 rad/s.
yield* orbitArc(self, {
  count: 12,
  kind: cyan,
  radius: 60,
  fromRad: 0,
  toRad: Math.PI,         // 180°: top semicircle
  rotateSpeed: 1,         // rad/s; 0 = static; negative = CCW
  durationFrames: 300,    // ~5 s, then all 12 die
});
```

Knobs: `fromRad`/`toRad` shape the arc (full circle = `0, 2*Math.PI*(count-1)/count`).
`rotateSpeed` controls the spin direction and rate. `durationFrames`
caps the lifetime; omit for "runs until cancelled by an outer race".
`centerEntity` lets the arc track a different entity than `self` —
useful when running the pattern from a controller while orbiting the
boss.

## 17. Telegraphed line stroke (warn → detonate)

`lineStrokeTelegraph` is the one-call version of the §13 pattern:
draws a non-damaging warning line immediately, then schedules a
damaging stroke at the same coordinates `offsetMs` milliseconds
later. Multiple calls layer cleanly because the lethal-phase
detonation is scheduled via `scene.time` rather than awaited
inline — useful for boss patterns that fire several telegraphs at
once and let them all detonate together.

```js
const red = bulletStyle({ color: 0xff5577, radius: 2, shape: 'square' });

while (true) {
  // Three crossing telegraphs all warning for 800 ms, then all
  // detonating in lockstep.
  lineStrokeTelegraph(self, 0, 0, 400, 660, 800, { kind: red });
  lineStrokeTelegraph(self, 400, 0, 0, 660, 800, { kind: red });
  lineStrokeTelegraph(self, 0, 330, 400, 330, 800, { kind: red });
  yield* waitSeconds(2.0);
}
```

`offsetMs` is the warning duration in milliseconds; `lethalFrames`
(default 30 ≈ 0.5 s) is how long the damaging stroke stays on the
field after the telegraph ends.

**Pause caveat.** The lethal phase is scheduled via `scene.time`,
which doesn't pause when physics does — a dialog freeze inside the
telegraph window will still let the detonation fire. Fine for boss
patterns where dialogs sit between attacks; reach for the manual
§13 split when you need a pause-safe telegraph.

## 18. Camera punch (directional screen shake)

`cameraPunch` nudges the main camera's scroll by `dx`/`dy` and yoyos
back — a sub-second VFX accent for impact moments. Positive `dx`
punches the world left (camera looks right), reading as "screen
shake right".

```js
// Pair a punch with the same beat as the bullet volley.
while (true) {
  cluster(self, 8, redBig, 200);
  cameraPunch(self, 5);            // shake right, 120ms default
  yield* waitSeconds(0.4);
  cluster(self, 8, redBig, 200);
  cameraPunch(self, -5);           // shake left
  yield* waitSeconds(0.4);
}
```

`durationMs` (default 120 ms) controls how long the round-trip takes.
Stacks via Phaser's tween system, so back-to-back punches don't
fight each other.

---

## Helper reference (cheat sheet)

```ts
ring(self, count, kind, speed, baseAngleRad?)
aimed(self, count, kind, speed, spreadRad?)
spread(self, count, kind, speed, baseAngleRad, spreadRad)
arc(self, count, kind, speed, fromRad, toRad)
cluster(self, count, kind, speed, spreadPx?)         // aimed pack, jittered spawn offsets
orbitArc(self, { count, kind, radius, fromRad,        // generator — yield* it
                  toRad, rotateSpeed?,                 // body-driven orbit; rotate or hold
                  durationFrames?, centerEntity? })
lineStroke(self, x1, y1, x2, y2, kind, lifeFrames,
           { damaging?, spacing?, color?, width? })   // damaging: true → lethal bullets;
                                                     // damaging: false → animated warning
lineStrokeTelegraph(self, x1, y1, x2, y2, offsetMs,   // warn for offsetMs, then detonate
                    { kind?, lethalFrames?,           // sync; multiple calls layer cleanly
                      spacing?, color?, width? })
lineExplosion(self, x1, y1, x2, y2,                  // generator — yield* it
              { stepPx?, speedPxPerSec?, stepFrames?,  // shockwave of animated tiles
                framesPerSpawn?, frameCount?, kind? }) // marching forward; each tile lethal
lineRedExplosion(self, x1, y1, x2, y2, opts?)        // red sprite, slow-march defaults
                                                     // (stepPx 60, stepFrames 9,
                                                     // framesPerSpawn 5; same opts as above)
cameraPunch(self, dx, dy?, durationMs?)              // directional screen shake; yoyos back

// Compositional grid → mover → wave:
squareGrid({ cols, rows, x0, y0, dx, dy })           → Point[]
hexGrid({ cols, rows, x0, y0, dx, dy? })             → Point[]
lineGrid({ x1, y1, x2, y2, spacing? | count? })      → Point[]
move(angle, speed, accel?)                           → Mover
STILL                                                → Mover (no motion)
wave(self, { grid, kind, mover?, direction?, speed,   // generator — yield* it
              lifeFrames?, loops?, loopDelayFrames? })
tiledScroll(self, { kind, dx, dy, vx, vy, hex?,       // generator — yield* it
                    fillHoldFrames?, durationFrames? })

moveTo(self, x, y, speed)              // generator — yield* it
walkOffScreen(self, vx, vy)            // generator — yield* it

bullet                                  // default white circle, radius 3
bulletStyle({ color, radius, shape })   // custom kind; shape: 'circle' | 'square' | 'diamond'

yield N                                 // wait N script frames (~60 / sec)
yield* waitSeconds(s)                   // audio-aware delay
yield { until: someEntity }             // wait until that entity dies
```

Raw spawn for anything the primitives can't express:

```ts
self.spawn(kind, x, y, vx, vy, { script?: function*(b) { ... } })
```

The optional `script` is a generator the spawned bullet will run — same
yield surface as above. Use it for multi-phase, homing, or any per-bullet
behaviour.

## Tips

- **Texture caching is automatic.** `bulletStyle({color, radius, shape})`
  hashes its arguments into a texture key — calling it many times with
  the same opts reuses one texture, so bullets sharing a style batch
  into a single draw call.
- **Slow, dense patterns build up active bullets fast.** See
  [stress-test-results.md](stress-test-results.md) for the engine's
  comfort zone (~5 000 active bullets at 60 fps; ~10 000 starts to
  cost frames).
- **Save with the 💾 button.** Patterns persist to `localStorage` under
  the key `office-hell:pattern-saves`; LOAD reads them back into the
  code tab.
