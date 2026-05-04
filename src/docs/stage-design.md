# Stage design

A "stage" is the script that runs the player through one playthrough — intro
dialogue, waves of enemies, music transitions, bosses, outro. Stages are
declarative **queues of entries**; a runner walks the queue front-to-back and
gates each entry on its filters before firing the action.

This file documents the data model, the runner, the filter library, and the
two stages currently shipped.

---

## Data model

Defined in [`src/script/state.ts`](../script/state.ts).

```ts
type StageEntry = {
  name: string;            // HUD label
  kind: 'spawn' | 'dialog' | 'music' | 'misc';
  filters: StageFilter[];  // all must report ready before action fires
  action: (self: Entity) => void | Generator<ScriptYield, void, void>;
};

type StageFilter = {
  label: string;                                       // shown in HUD's "blocked: ..." segment
  ready: (self: Entity, state: StageState) => boolean; // polled once per frame
};

type StageQueue = StageEntry[];
```

`action` may be a sync function (one-shot — spawn enemies, switch music, end
the scene) or a generator (multi-step — dialogue, boss-entry sequences,
anything that needs its own internal yields).

A stage is wrapped in an `EntityKind` whose `defaultScript` is
`(self) => runStageQueue(self, MY_QUEUE)`. Spawning that kind kicks off the
stage. Same machinery as any other entity script — the queue runner is itself
a generator the pool advances frame by frame.

## Runner

`runStageQueue(self, queue)` iterates entries in order. For each:

1. Stamp `currentEntryActivatedAt = getMusicTime()?.time` (used by
   `trackEnded` to compute the loop-boundary it should snap to).
2. Poll filters once per frame. While any filter reports not-ready, yield 1
   and repeat. The labels of pending filters land in `state.pendingFilters`
   for the HUD.
3. Call `action(self)`. If it returns a generator, `yield*` it (entry stays
   "current" through any internal yields).
4. Stamp `lastFireAudioTime = getMusicTime()?.time` (used by `audioGap`).

While a dialog box is open, `pool.update` early-returns on `pool.paused`, so
the runner generator is paused too. The audio context keeps ticking, so any
audio-time filter automatically catches up the moment the dialog closes.

A `StageState` instance is created per run by `runStageQueue` and parked on
`pool.stage` for the duration. The instance owns `nextEntryOfKind(kind)` as
a method, and `audioTimeFromEntry(entry)` is exported as a free function so
the debug HUD in `GameScene` can introspect the queue via `pool.stage`
without coupling to the runner.

## Filter library

All in [`src/script/state.ts`](../script/state.ts).

| Filter | Ready when | Notes |
|---|---|---|
| `audioTimeAtLeast(t)` | current track time ≥ `t` | Strict null check on music — false until a track is playing. |
| `audioGap(s)` | `s` audio seconds since previous entry's action returned | Replaces frame-counted gaps. False until music is up. |
| `musicReady` | a track is currently playing | Cheap "wait for music to start" gate. |
| `trackEnded` | current track has reached its next loop-boundary | Snaps music switches to the next musical seam. Returns true when no track is playing, so safe on the very first music entry. |
| `enemiesClear` | no live entities in `damagedBy.enemy` | Bullets in flight don't count. |
| `screenClear` | no live entities in `damages.player` | Bullets included — true field-empty. |
| `entityDead(e)` | a specific entity is dead | For "wait until this boss dies before next entry". |

`waitAudioSeconds(seconds)` is a generator helper (not a filter) used inside
wave actions for **internal** pacing. It captures the music time on entry
and yields until that target elapses; falls back to a 60fps frame yield if
no music is playing, so practice-mode runs (single wave, no music) preserve
the original frame counts.

## Music time semantics

Music lives in [`src/audio/music/loop.ts`](../audio/music/loop.ts). Two
playback modes: `playMusicLoop(key)` and `playMusicWithIntro(intro, loop)`.

- The clock is **per-track**. `getMusicTime()` returns
  `{ key, time }` measured from the moment the track's `start()` callback
  fired. A new `playMusicLoop` request resets the clock to `null`
  immediately and re-arms when the new track is up.
- That null window is what makes filters compose well: `audioGap(s)` and
  `audioTimeAtLeast(t)` both block on `null`, so an entry following a
  music-switch entry naturally waits for the new track to start before its
  clock-based gates can fire.
- For the loop-boundary computation in `trackEnded`,
  `getCurrentTrackInfo()` exposes the active track's `introDuration` and
  `loopDuration`. Boundary = `introDuration + N * loopDuration` for the
  smallest `N` where the boundary is at-or-after `currentEntryActivatedAt`.

## Pause semantics

Set by `EntityPool.beginDialogue` ([`src/entities/EntityPool.ts`](../entities/EntityPool.ts)):

- `pool.paused = true` (short-circuits `pool.update` so scripts and entity
  AI freeze)
- `scene.physics.pause()` (Phaser physics frozen — bodies stop integrating)
- `GameScene.update` gates `player.controlUpdate()` on `!pool.paused` so
  player input is also frozen

Hard pause — player cannot move during a dialog. Music keeps playing
through the pause, which is the whole point: time-based filters that fire
once a dialog closes catch up to where the audio clock has advanced.

## Currently shipped stages

### Real stage — [`src/content/stage.ts`](../content/stage.ts)

```
intro                              — dialog, no filters       (pre-music)
music: retro 01                    — music                    (pre-music → starts here)
wave 1               musicReady    — spawn                    (synced to first downbeat)
wave 2               audioGap(2.5) — spawn
wave 3               audioGap(3.0) — spawn
music: retro 02      trackEnded    — music                    (snaps to retro_01 seam)
wave 4               musicReady    — spawn
mr. hodges                         — spawn (script self-gates on field clear)
music: metal         enemiesClear, trackEnded                 (Hodges dead + retro_02 seam)
final boss                         — spawn (bossWave script)
outro                              — dialog (sweep + player exit)
end                                — misc (scene.start('End'))
```

Wave bodies (`wave1..4` in the same file) use `waitAudioSeconds(s)` for
their internal between-spawn pacing.

### Diagnostics test stage — [`src/content/testStage.ts`](../content/testStage.ts)

A short queue with `audioTimeAtLeast` filters at known offsets so the
sync-test debug HUD can be observed against an obvious schedule. Includes
the metal music switch + final boss to exercise the per-track clock reset
and `trackEnded` snapping. Player is pinned invincible
([`GameScene.create`](../scenes/GameScene.ts)) so a stray bullet doesn't
end the test mid-observation.

Launched from the practice menu's "▶ STAGE TEST (sync)" entry.

## Debug HUD

`GameScene` always renders a second HUD line under the main one, fed from
`getMusicTime()` + `pool.stage`:

```
track: stage1Retro01Loop  t: 12.34s  next: wave 2 @28.0s  blocked: t≥20.0s, enemies clear
```

- `track` / `t`: current music track key + seconds since it started.
- `next`: name and (if available) audio-time offset of the next upcoming
  spawn or dialog entry.
- `blocked`: pending filter labels for the **current** entry — non-empty
  whenever the entry is waiting on a gate. Subsumes "INBOUND DIALOG"
  (when current entry is a dialog blocked on `enemies clear`, that's
  exactly what shows).

Coloured grey on the real stage, green on the test stage as a visual
"you're in test mode" cue.

## Adding a new stage

1. Define a `StageQueue` literal — entries with `name`, `kind`, `filters`,
   `action`. Reuse helpers from [`state.ts`](../script/state.ts)
   for filters; reuse spawn helpers from
   [`content/kinds.ts`](../content/kinds.ts) and
   [`content/release/`](../content/release/) for entity definitions.
2. Wrap it in an `EntityKind` whose `defaultScript` calls
   `runStageQueue(self, MY_QUEUE)`.
3. Spawn it from somewhere — typically a scene that constructs an
   `EntityPool`, then `pool.spawn(myStageKind, 0, 0, 0, 0)`.

## Adding a new filter

Append a `StageFilter` constant or factory to
[`state.ts`](../script/state.ts). Two requirements:

- `label` should be short and stable — it shows up verbatim in the debug
  HUD's `blocked: ...` segment and in any tooling that scrapes the queue.
- `ready` must be cheap and side-effect-free; it's polled at 60fps for
  every entry that has it in its filter list.

For filters that need state across polls (e.g. "wait N seconds from now"),
either read it off the `state: StageState` arg `ready` receives (see how
`audioGap` pulls `lastFireAudioTime`) or factor it into a generator helper
like `waitAudioSeconds` and call it from inside an action instead.

## Known limitations / future work

- **Linearity only.** Queues run front-to-back; no branching, no parallel
  tracks, no jumps. Fine today; would need a redesign if narrative
  branching shows up.
- **Loop boundaries, not bar boundaries.** `trackEnded` snaps to the next
  *loop iteration* end, which can be tens of seconds away on a 50s loop.
  For finer-grained beat-aligned switches we'd need bar/beat metadata on
  the loop and a `barBoundary(n)` filter. Out of scope for now.
- **No crossfading on music switch.** Switches are hard cuts (we removed
  the menu-loop self-crossfade earlier because Vorbis is gapless).
  `trackEnded` makes the seam musically clean but doesn't blend.
- **Practice mode debug line is sparse.** Single-wave runs from
  `makeWaveStage` don't go through the queue runner, so the HUD shows
  `track: (none)  t: -`. Could be hidden when both `pool.stage` and
  `getMusicTime()` are null.
