# Stage design

A "stage" is the script that runs the player through one playthrough — intro
dialogue, waves of enemies, music transitions, bosses, outro. Stages are
ordered **queues of entries**; a runner walks the queue front-to-back and
runs each entry's action one after the other. Each action does its own
gating inside the body via `yield* wait*(…)` helpers — there is no separate
declarative filter list.

This file documents the data model, the runner, the wait library, and the
stages currently shipped.

---

## Data model

Defined in [`src/script/state.ts`](../script/state.ts).

```ts
type StageEntry = {
  name: string;            // HUD label
  kind: 'spawn' | 'dialog' | 'music' | 'misc';
  action: (self: Entity) => void | Generator<ScriptYield, void, void>;
};

type StageQueue = StageEntry[];
```

`action` may be a sync function (one-shot — spawn enemies, switch music,
end the scene) or a generator (multi-step — dialogue, boss-entry sequences,
anything that needs internal yields including `yield* wait*(self)` waits).

A stage is wrapped in an `EntityKind` whose `defaultScript` is
`(self) => runStageQueue(self, MY_QUEUE)`. Spawning that kind kicks off the
stage. Same machinery as any other entity script — the queue runner is
itself a generator the pool advances frame by frame.

## Runner

`runStageQueue(self, queue)` iterates entries in order. For each:

1. Stamp `state.currentEntryActivatedAt = getMusicTime()?.time` (used by
   `waitTrackEnded` to compute the loop-boundary it should snap to).
2. Call `action(self)`. If it returns a generator, `yield*` it (entry
   stays "current" through any internal yields, including waits and
   nested generators).
3. Stamp `state.lastFireAudioTime = getMusicTime()?.time` (used by
   `waitAudioGap` on the next entry).

While a dialog box is open, `pool.update` early-returns on `pool.paused`,
so the runner generator is paused too. The audio context keeps ticking, so
any audio-time wait automatically catches up the moment the dialog closes.

A `StageState` instance is created per run by `runStageQueue` and parked on
`pool.stage` for the duration. The instance owns `nextEntryOfKind(kind)`,
`once(key)`, `count(key, max)`, plus the bookkeeping fields the wait
helpers read. The HUD reads `pool.stage` directly to show the next upcoming
entry.

## Wait library

All in [`src/script/state.ts`](../script/state.ts). Each wait is a generator
the action `yield*`s.

| Helper | Resolves when | Notes |
|---|---|---|
| `waitAudioTimeAtLeast(t)` | current track time ≥ `t` | Strict null check on music — never resolves while no track is playing. |
| `waitAudioGap(self, s)` | `s` audio seconds since previous entry's action returned | Replaces frame-counted gaps. Blocks until music is up. |
| `startMusicLoop(key, opts?)` / `startMusicWithIntro(intro, loop, opts?)` | the requested track is actually ticking | Combined play + wait. Use these in `music`-kind stage actions instead of the raw `playMusicLoop` / `playMusicWithIntro` so following entries can assume music is up. |
| `waitTrackEnded(self)` | one-shot completes (event-driven) or loop reaches its next loop-boundary (polled) | Snaps music switches to the next musical seam. Resolves immediately when no track is playing — safe on the very first music entry. |
| `waitMusicComplete()` | one-shot track's natural completion | Yields the `untilMusicEnds` event. Loops never fire this — `waitTrackEnded` routes them through the polling boundary path instead. |
| `waitEnemiesClear(self)` | no live entities in `damagedBy.enemy` | Bullets in flight don't count. Yields `{ until: e }` for each live enemy in turn — event-driven, no polling. |
| `waitScreenClear(self)` | no live entities in `damages.player` | Bullets included — true field-empty. Same `{ until: e }` loop. |
| `waitEntityDead(e)` | a specific entity is dead | Single `{ until: e }` for "wait for this boss to fall". |
| `yield { race, trigger }` | inner generator returns OR `trigger` (a `NonRaceYield`) fires | Race primitive. Inner does its own work; the loser is cancelled via the engine's generation bump. No higher-order wrapper — yield it directly. |

`waitSeconds(seconds)` is a generic generator helper used inside wave
actions for **internal** pacing. It captures the music time on entry and
yields until that target elapses; falls back to a 60fps frame yield if no
music is playing, so practice-mode runs (single wave, no music) preserve
the original frame counts.

## Music time semantics

Music lives in [`src/audio/music/loop.ts`](../audio/music/loop.ts). Two
playback modes: `playMusicLoop(key)` and `playMusicWithIntro(intro, loop)`.

- The clock is **per-track**. `getMusicTime()` returns
  `{ key, time }` measured from the moment the track's `start()` callback
  fired. A new `playMusicLoop` request resets the clock to `null`
  immediately and re-arms when the new track is up.
- That null window is what makes waits compose well: `waitAudioGap(s)`
  and `waitAudioTimeAtLeast(t)` both block on `null`, so a wait following
  a music-switch action naturally blocks until the new track has started.
- For the loop-boundary computation in `waitTrackEnded`,
  `getCurrentTrackInfo()` exposes the active track's `introDuration`,
  `loopDuration`, and a `oneShot` flag. Boundary =
  `introDuration + N * loopDuration` for the smallest `N` where the
  boundary is at-or-after `currentEntryActivatedAt`.
- `onceMusicComplete(cb)` is the underlying engine event for one-shot
  completion. Listeners are per-track — a swap clears them so a callback
  registered against the previous track never fires for a later one.

## Pause semantics

Set by `EntityPool.beginDialogue` ([`src/entities/EntityPool.ts`](../entities/EntityPool.ts)):

- `pool.paused = true` (short-circuits `pool.update` so scripts and entity
  AI freeze)
- `scene.physics.pause()` (Phaser physics frozen — bodies stop integrating)
- `GameScene.update` gates `player.controlUpdate()` on `!pool.paused` so
  player input is also frozen

Hard pause — player cannot move during a dialog. Music keeps playing
through the pause, which is the whole point: time-based waits that resume
once a dialog closes catch up to where the audio clock has advanced.

## Race

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
`outer.racedChild = inner`, and schedules inner. It then runs the
trigger through `processYield(outer, trigger)` — same path a regular
yield would take — installing it as a parallel wait on the outer.

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
wins and infers outcome from world state. Inner's `finally` blocks
don't run on cancellation; if you need cleanup, do it explicitly
before yielding.

## Currently shipped stages

### Real stage — [`src/content/stage.ts`](../content/stage.ts)

```
intro                              — dialog                      (pre-music)
music: retro 01      startMusicWithIntro(...)                    (action yields until ticking)
wave 1                                                           (music already up)
wave 2               waitAudioGap(2.5)
wave 3               waitAudioGap(3.0)
music: retro 02      waitTrackEnded; startMusicLoop(...)         (snap to seam, then play+wait)
wave 4                                                           (music already up)
mr. hodges                                                       (script self-gates on field clear)
music: metal         waitEnemiesClear; waitTrackEnded            (Hodges dead, retro_02 seam)
final boss                                                       (bossWave script)
outro                              — dialog (sweep + player exit)
end                                — misc (scene.start('End'))
```

Wave bodies (`wave1..4` in the same file) use `waitSeconds(s)` for
their internal between-spawn pacing.

### Diagnostics test stage — [`src/content/testStage.ts`](../content/testStage.ts)

A short queue with `waitAudioTimeAtLeast` waits at known offsets so the
sync-test debug HUD can be observed against an obvious schedule. Includes
the metal music switch + final boss to exercise the per-track clock reset
and `waitTrackEnded` snapping. Player is pinned invincible
([`GameScene.create`](../scenes/GameScene.ts)) so a stray bullet doesn't
end the test mid-observation.

Launched from the practice menu's "▶ STAGE TEST (sync)" entry.

## Debug HUD

`GameScene` always renders a second HUD line under the main one, fed from
`getMusicTime()` + `pool.stage`:

```
track: stage1Retro01Loop  t: 12.34s  next: wave 2
```

- `track` / `t`: current music track key + seconds since it started.
- `next`: name of the next upcoming spawn or dialog entry.

Coloured grey on the real stage, green on the test stage as a visual
"you're in test mode" cue.

## Adding a new stage

1. Define a `StageQueue` literal — entries with `name`, `kind`, `action`.
   Reuse `wait*` helpers from [`state.ts`](../script/state.ts) inside
   action bodies; reuse spawn helpers from
   [`content/kinds.ts`](../content/kinds.ts) and `content/waves/` for
   entity definitions.
2. Wrap it in an `EntityKind` whose `defaultScript` calls
   `runStageQueue(self, MY_QUEUE)`.
3. Spawn it from somewhere — typically a scene that constructs an
   `EntityPool`, then `pool.spawn(myStageKind, 0, 0, 0, 0)`.

## Adding a new wait helper

Append a `wait*` generator to [`state.ts`](../script/state.ts). For
deterministic time waits, poll `getMusicTime()` (or frame-yield) per
frame. For event-driven resolution, add a yield variant to
`ScriptYield` in [`script/types.ts`](../script/types.ts) and a handler in
`EntityPool.advance` that registers the appropriate callback (see
`untilMusicEnds` for an example).

## Known limitations / future work

- **Linearity only.** Queues run front-to-back; no branching, no parallel
  tracks, no jumps. Fine today; would need a redesign if narrative
  branching shows up.
- **Sequential, not parallel-AND.** Compound waits run in order
  (`yield* waitEnemiesClear; yield* waitTrackEnded`). The old filter
  array was a parallel AND; sequential is a small semantic shift but
  none of the current stages have conditions that flip back, so it's
  safe. A `waitAll(...gens)` higher-order would restore parallel AND if
  needed.
- **Loop boundaries, not bar boundaries.** `waitTrackEnded` snaps to
  the next *loop iteration* end, which can be tens of seconds away on a
  50s loop. For finer-grained beat-aligned switches we'd need bar/beat
  metadata on the loop. Out of scope for now.
- **No crossfading on music switch.** Switches are hard cuts (we
  removed the menu-loop self-crossfade earlier because Vorbis is
  gapless). `waitTrackEnded` makes the seam musically clean but doesn't
  blend.
- **Practice mode debug line is sparse.** Single-wave runs from
  `makeWaveStage` don't go through the queue runner, so the HUD shows
  `track: (none)  t: -`. Could be hidden when both `pool.stage` and
  `getMusicTime()` are null.
