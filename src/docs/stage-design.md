# Stage design

A "stage" is the script that runs the player through one playthrough — intro
dialogue, waves of enemies, music transitions, bosses, outro. Stages are
**plain generator functions**, composed from `wait*` helpers and `start*`
music helpers via `yield*`. There's no queue, no entries, no filters; the
runtime is what JavaScript's generator protocol gives us, plus the engine
plumbing in `StageManager`.

This file documents the small state object, the helpers, and the stages
currently shipped.

---

## Shape of a stage

A stage is just an `EntityScript` — `function* (self: Entity)` — passed
directly as `defaultScript`. There's no wrapper:

```ts
function* myStageBody(self: Entity) {
  markWave(self, 'intro');
  yield* introMonologue(self);

  markWave(self, 'music: track 1');
  yield* startMusicLoop(TRACK_1_KEY);

  yield* waveOne(self); // wave generators call `markWave` themselves
  yield* waitSeconds(2.5);

  yield* waveTwo(self);
  // …
}

export const myStage = new EntityKind({
  sprite: null, hitboxRadius: 0, hp: null,
  damageClass: [], damagedByClass: [],
  defaultScript: myStageBody,
});
```

The body generator is advanced frame-by-frame by the pool — same
machinery as any entity script.

## State

Two pool fields:

```ts
class StageManager {
  globals: Record<string, unknown> = {};
  wave: string | null = null;
  // …
}
```

Both are initialised in `StageManager`'s constructor and persist for the
lifetime of the pool — one GameScene launch. Switching scenes
constructs a new pool, which is the reset.

- `globals` backs `checkStageOnce(self, key)` and
  `checkStageCount(self, key, max)` — guards for "this only runs once
  per scene even if multiple entities of the same kind spawn". Used by
  `oversleeper`, `janitor`, `checkEmail`, `moreCharts` waves.

  Keys share one flat namespace across the whole stage, so prefix them
  with the wave (or owning system) name to avoid collisions:
  `<wave>:<key>` — e.g. `'checkEmail:shown'`, `'oversleeper:introShown'`,
  `'moreCharts:dataForTomorrow'`. The colon is a convention, not a
  requirement; the store is `Record<string, unknown>`, so any key works,
  but unprefixed keys make a future name clash a silent foot-gun.
- `wave` is the human-readable string shown in the GameScene debug HUD.
  Set with `markWave(self, 'wave name')` from inside the wave generator,
  or from the stage body for non-wave segments (intro, music switches).

## Helpers (`src/script/stage.ts`)

### Music starters

Combined "play and yield until ticking" helpers. Use these instead of the
raw `playMusicLoop` / `playMusicWithIntro` so the next step can assume
music is up.

| Helper | Effect |
|---|---|
| `startMusicLoop(key, opts?)` | Request a looped (or `{ loop: false }` one-shot) track; yield until `getMusicTime() !== null`. |
| `startMusicWithIntro(intro, loop, opts?)` | Same but with the intro→loop hand-off. |

### Generic time waits

| Helper | Resolves when |
|---|---|
| `waitSeconds(s)` | `s` seconds of audio time have elapsed since the call. Falls back to a 60fps frame yield when no music is playing. |
| `waitAudioTimeAtLeast(t)` | the active track's clock reaches `t` (seconds, from track start). Strict null check on music — never resolves while no track is playing. |

### Music-state waits

| Helper | Resolves when |
|---|---|
| `waitTrackEnded()` | one-shot completes (event-driven via `untilMusicEnds`) or loop reaches its next loop boundary (polled). Resolves immediately when no track is playing. |
| `waitMusicComplete()` | one-shot track's natural completion. Loops never fire this — `waitTrackEnded` routes loops through the polling boundary path instead. |

### World-state waits

| Helper | Resolves when |
|---|---|
| `waitEnemiesClear(self)` | no live entities in `damagedBy.enemy`. Bullets in flight don't count. Yields `{ until: e }` for each live enemy in turn — event-driven. |
| `waitScreenClear(self)` | no live entities in `damages.player`. Bullets included — true field-empty. |
| `waitEntityDead(e)` | a specific entity is dead. Single `{ until: e }`. |

### Race

| Form | Effect |
|---|---|
| `yield { race, trigger }` | inner generator (`race`) returns OR the parent-side `trigger` (a `NonRaceYield`) fires. Loser is cancelled via the engine's generation bump. No result channel. |

## Music time semantics

Music lives in [`src/audio/music/loop.ts`](../audio/music/loop.ts). Two
playback modes: `playMusicLoop(key)` and `playMusicWithIntro(intro, loop)`.

- The clock is **per-track**. `getMusicTime()` returns
  `{ key, time }` measured from the moment the track's `start()`
  callback fired. A new `playMusicLoop` request resets the clock to
  `null` immediately and re-arms when the new track is up.
- That null window is what makes waits compose well: `waitSeconds` and
  `waitAudioTimeAtLeast` both block on `null`, so a wait following a
  music switch naturally blocks until the new track has started.
- For the loop-boundary computation in `waitTrackEnded`,
  `getCurrentTrackInfo()` exposes the active track's `introDuration`,
  `loopDuration`, and a `oneShot` flag. Boundary =
  `introDuration + N * loopDuration` for the smallest `N` where the
  boundary is at-or-after the call's "now".
- `onceMusicComplete(cb)` is the underlying engine event for one-shot
  completion. Listeners are per-track — a swap clears them so a callback
  registered against the previous track never fires for a later one.

## Pause semantics

`StageManager.freeze()` / `unfreeze()` ([`src/script/StageManager.ts`](../script/StageManager.ts))
bundle the two flags any cutscene-style hard pause needs. Used by
`beginDialogue`, the ESC menu, and the death sequence:

- `stage.paused = true` (short-circuits `stage.update` so scripts and entity
  AI freeze)
- `scene.physics.pause()` (Phaser physics frozen — bodies stop integrating)
- `GameScene.update` gates `player.controlUpdate()` on `!stage.paused` so
  player input is also frozen

Hard pause — player cannot move during a dialog. Music keeps playing
through the pause, which is the whole point: time-based waits that resume
once a dialog closes catch up to where the audio clock has advanced.

## Race / timeout

`yield { race: inner, trigger }` parks the calling script with two
participants: the inner generator (doing its own work, yielding any
ScriptYields) and a parent-side trigger — any `NonRaceYield` (`number`,
`{ until }`, `{ dialogue }`, `{ untilMusicEnds: true }`). Whichever
resolves first wakes the parent; the loser is cancelled via the
engine's generation-bump mechanism.

The trigger generalises the old fixed-frames timer: any leaf wait
that's expressible as a yield can act as the loss condition. A
`number` recovers the original frame timer; `{ until: bossEntity }`
gives "race until the boss dies"; `{ untilMusicEnds: true }` gives
"race until the song ends".

Implementation: when the runner sees a race yield, it wraps the inner
in a fresh `SceneScript` (with `racedParent` = outer,
`racedParentGeneration` = outer's generation snapshot), parks
`outer.racedChild = inner`, and runs the inner immediately. If the
inner doesn't finish synchronously, the runner installs the trigger
via `processYield(outer, trigger)` — same path a regular yield would
take.

Resolution paths:

- *inner finishes first*: inner's done-handler clears
  `outer.racedChild` and calls `callIter(outer)`. That bumps
  `outer.generation`, making the trigger's `scheduledGeneration`
  stale — when the trigger's wait would fire, the staleness check
  drops it.
- *trigger fires first*: it goes through the runner's normal wakeup
  path → `callIter(outer)`. The first step of `callIter` finds
  `outer.racedChild = inner` and `drop(inner)` — bumping inner's
  generation (recursively into any nested race), making all of inner's
  in-flight wakeups stale.

There is no result channel: the parent resumes whenever one branch
wins and infers outcome from world state. The loser is dropped via
`StageManager.drop`, which calls `iter.return()` on the cancelled
generator — so any `try/finally` inside the loser unwinds and runs
its cleanup. The generation flip happens before the `return()` so a
finally that schedules more work (or wakes a parent) sees a null
generation and is silently ignored. Race / all children are dropped
before the parent's own finally runs, so nested cancellation is
inside-out.

## Timed slots — `timeWave`

`timeWave(self, seconds, inner)` runs `inner` (the wave body) inside a
`withTimeout(seconds, …)` race, then pads the slot to the music seam
via `waitAudioTimeAtLeast`. It exists so the stage script can keep its
beats music-aligned even when the player blows through enemies fast or
lets them linger.

**The slot's duration is a hard contract.** Every enemy spawned by the
wave must be off the visible playfield by the time the timer fires —
the wave's own scripts (entry → on-screen activity → exit setVelocity)
have to be paced so the last spawn's exit lands inside the budget,
counting:

- the wave's pre-suspend setup (e.g. `alignDoor`, which can wait up to
  `(DOOR_SPACING - 2*tolerance) / scrollSpeed` ≈ 1.8s with the default
  tolerance);
- the spawn schedule's last `yield` (when the latest enemy actually
  appears);
- per-enemy entry + on-screen beats + exit travel to the off-visible
  edge.

If any enemy is still alive on the field when the slot expires,
`timeWave` logs a `console.error` listing the stragglers and their
positions; it does **not** kill them. The error is the alarm that
something needs tightening — either the wave body (faster exits, fewer
or shorter on-screen beats, earlier last-spawn) or the slot duration.
Live stragglers will continue running their entity scripts and drift
off naturally, but the next slot inherits a busy field, which reads as
visual jank.

Pacing levers, in roughly the order to try them:

1. **Faster exits.** Add a `RETREAT_SPEED` / `EXIT_SPEED` distinct
   from the entry speed; sideways exits through the entry door clear
   the field much faster than vertical drops at slow speed.
2. **Tighter spawn schedule.** Shrink the late `yield N` between
   spawn pairs so the last enemy starts its on-screen beat sooner.
3. **Wider `alignDoor` tolerance.** Default 32 burns up to 1.8s on
   alignment alone; `alignDoor(self, y, 64)` (or wider) cuts that in
   half or better when the wave's spawn ys can tolerate a looser
   snap.
4. **Extend the slot.** Last resort — every extra second eats into the
   stage's music budget (the wave block plus its inter-wave gaps must
   fit inside an integer number of loop iterations, or
   `waitTrackEnded` will hold for the next boundary instead of the
   current one).

## Stage-part durations

A stage is split by its mid-boss into two parts. Each part's **wave
block** — every `timeWave` slot plus the `waitSeconds(INTER_WAVE_GAP)`
gaps between them, ending at the boss music switch — runs to a fixed
budget:

- **Part 1 (intro → mid-boss): 59 seconds.**
- **Part 2 (mid-boss → end-boss): 49 seconds.**

Hold both parts to these budgets so music seams stay predictable
across stages: `waitTrackEnded` lands on the next natural loop
boundary instead of holding for a full extra iteration, and a
practice-menu replay of a part lands on the same beat the live stage
does. If a wave wants more time than the budget allows, push the
pacing levers in [Timed slots — `timeWave`](#timed-slots--timewave)
before extending the slot.

## Wave cleanup — `separateWave`

Waves can leave the world in non-default state: `stage.running =
false`, `player.controlsEnabled = false`, `player.firingEnabled =
false`, physics paused (via `freeze()` or a tutorial bubble's direct
`physics.pause()`), `player.body.setCollideWorldBounds(false)`. If a
wave is *cancelled* mid-flight — most commonly because a `timeWave`
slot's timeout wins the race — those flags would otherwise leak into
the next slot.

`StageManager.separateWave(inner)` is the higher-order generator that
prevents the leak. It runs `inner` and, in a `finally`, restores the
canonical inter-wave state:

```ts
*separateWave(inner: ScriptIter): ScriptIter {
  try {
    yield* inner;
  } finally {
    this.running = true;
    this.player.unlockControls();
    this.player.firingEnabled = true;
    this.player.body.setCollideWorldBounds(true);
    this.unfreeze();
  }
}
```

Combined with the `iter.return()`-on-drop behaviour above, this fires
on every exit path: normal completion, a thrown error, or a
mid-flight drop from losing a race. Wrap **every** wave call with it:

```ts
yield* self.stage.separateWave(gymBroWave(self));
yield* timeWave(self, 8, self.stage.separateWave(emailColleagues2(self)));
```

### Convention: don't clean up inside a wave

When you write a wave body, **do whatever needs to be done, but do
not clean up at the end** — don't reset `stage.running` to `true`,
don't re-enable firing, don't unlock controls. `separateWave`'s
`finally` is the **single source of truth** for restoring the
canonical state, and it's the only path that fires on a mid-flight
cancellation. A second cleanup path inside the wave body would be
silently skipped on cancellation and would have to be kept in sync
with `separateWave` by hand.

This applies to `suspendRunning` too: it sets `running = false` and
waits for the field to clear, but does *not* reset `running` on the
way out — `separateWave` handles that.

The only state mutations a wave should leave behind are *intentional
permanent changes* — e.g. the intro setting `player.kind.bombs =
PLAYER_BOMBS` to unlock bombs, or a boss script setting
`stage.bossName` (which is cleared by the boss's `onDeath` callback
on either natural defeat or forced release).

## Currently shipped stages

### Real stage — [`src/content/stage.ts`](../content/stage.ts)

Plain generator body composing intro monologue → retro 01 + waves 1–3 →
retro 02 + wave 4 → Mr. Hodges → metal music + final boss → outro →
end. Inter-wave pacing via `waitSeconds(s)`; music switches snap to
`waitTrackEnded()`; `waitEnemiesClear`/`waitScreenClear` gate the
bossfight transitions.

### Diagnostics test stage — [`src/content/testStage.ts`](../content/testStage.ts)

A short body with `waitAudioTimeAtLeast` waits at known offsets so the
sync-test debug HUD can be observed against an obvious schedule.
Includes the metal music switch + final boss to exercise the per-track
clock reset and `waitTrackEnded` snapping. Player is pinned invincible
([`GameScene.create`](../scenes/GameScene.ts)) so a stray bullet doesn't
end the test mid-observation.

Launched from the practice menu's "▶ STAGE TEST (sync)" entry.

## Debug HUD

`GameScene` always renders a second HUD line under the main one, fed
from `getMusicTime()` + `stage.wave`:

```
track: stage1Retro01Loop  t: 12.34s  wave: wave 2
```

- `track` / `t`: current music track key + seconds since it started.
- `wave`: the most recent `markWave(self, name)` call's argument.
- `yield`: short label for the leaf wait the stage script is currently
  parked on. Sourced from a yield's optional `yieldReason` field
  (preferred, set by `withYieldReason` and the wrapped wait helpers) or
  a default description otherwise (`wait Nf`, `until <sprite> dies`,
  `dialogue`, `music ends`). Only populated for scripts spawned with
  `debugYieldReasons: true` — currently just the stage script. Yields
  with no leaf description (the race form) leave the previous reason
  visible.

Coloured grey on the real stage, green on the test stage as a visual
"you're in test mode" cue.

## Adding a new stage

1. Write a generator body `function* myStageBody(self: Entity) { … }`
   using the helpers above and any wave generators from
   `content/waves/`.
2. Pass it as the `defaultScript` of a stage `EntityKind`:
   `defaultScript: myStageBody`.
3. Spawn it from somewhere — typically a scene that constructs an
   `StageManager`, then `pool.spawn(myStageKind, 0, 0, 0, 0)`.

## Adding a new wait helper

Append a `wait*` generator to [`stage.ts`](../script/stage.ts). For
deterministic time waits, poll `getMusicTime()` (or frame-yield) per
frame. For event-driven resolution, add a yield variant to
`ScriptYield` in [`script/types.ts`](../script/types.ts) and a handler
in `StageManager.processYield` that registers the appropriate callback
(see `untilMusicEnds` for an example).

## Known limitations / future work

- **Loop boundaries, not bar boundaries.** `waitTrackEnded` snaps to
  the next *loop iteration* end, which can be tens of seconds away on
  a 50s loop. For finer-grained beat-aligned switches we'd need
  bar/beat metadata on the loop. Out of scope for now.
- **No crossfading on music switch.** Switches are hard cuts (we
  removed the menu-loop self-crossfade earlier because Vorbis is
  gapless). `waitTrackEnded` makes the seam musically clean but
  doesn't blend.
- **Practice mode debug line.** Single-wave runs from `makeWaveStage`
  pick up the wave's own `markWave` call, so the HUD shows the wave
  label even outside the full stage.
