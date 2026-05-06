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

while (self.alive) {
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

while (self.alive) {
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
while (self.alive) {
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
while (self.alive) {
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

while (self.alive) {
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

while (self.alive) {
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

while (self.alive) {
  // 9 bullets evenly spread between 30° and 150°, i.e. a 120° fan
  // pointing roughly downward.
  arc(self, 9, blue, 150, Math.PI / 6, (5 * Math.PI) / 6);
  yield* waitSeconds(0.7);
}
```

## 8. Mixed shapes

Mix shapes and sizes for visual hierarchy — small fast bullets for
fill, large slow ones for read-the-room moments.

```js
const fill = bulletStyle({ color: 0xffffff, radius: 2 });
const heavy = bulletStyle({ color: 0xff5577, radius: 6, shape: 'square' });

while (self.alive) {
  ring(self, 24, fill, 180);
  yield* waitSeconds(0.15);
  ring(self, 24, fill, 180, Math.PI / 24);
  yield* waitSeconds(0.15);
  aimed(self, 1, heavy, 80);            // single big aimed bullet
  yield* waitSeconds(0.7);
}
```

---

## Helper reference (cheat sheet)

```ts
ring(self, count, kind, speed, baseAngleRad?)
aimed(self, count, kind, speed, spreadRad?)
spread(self, count, kind, speed, baseAngleRad, spreadRad)
arc(self, count, kind, speed, fromRad, toRad)

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
