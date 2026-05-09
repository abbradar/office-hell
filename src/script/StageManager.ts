import Phaser from 'phaser';
import { onceMusicComplete } from '../audio/music/loop';
import { CULL_MARGIN, ENTITY_POOL_SIZE, GAME_H, GAME_W, SCRIPT_FPS } from '../config';
import { directionFromVelocity } from '../content/animations';
import { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { BubbleManager } from '../ui/bubbles';
import { DialogueManager, type DialogueOpts } from '../ui/dialogue';
import { GameScore } from './score';
import type { DamageClass, EntityKind, EntityScript, ScriptYield, SpawnOpts } from './types';
import { INERT_KIND } from './types';

type ClassGroups = Record<DamageClass, Phaser.Physics.Arcade.Group>;

type ScriptIter = Generator<ScriptYield, void, void>;

// Short label describing the leaf wait `v` represents — used by the
// debug HUD when a script with `debugYieldReasons` yields. A caller-
// supplied `yieldReason` (e.g. via `withYieldReason`) wins over the
// default description so high-level helpers can name themselves.
// Returns null for race / all because each child stamps its own
// description as it ticks; leave the previous reason visible until then.
function describeYield(v: ScriptYield): string | null {
  if (typeof v === 'number') return `wait ${v}f`;
  if ('race' in v) return null;
  if ('all' in v) return null;
  if (v.yieldReason !== undefined) return v.yieldReason;
  if ('physicsFrames' in v) return `wait ${v.physicsFrames}f`;
  if ('scriptFrames' in v) return `wait ${v.scriptFrames}sf`;
  if ('dialogue' in v) return 'dialogue';
  if ('until' in v) return `until ${v.until.kind.sprite ?? 'entity'} dies`;
  if ('untilMusicEnds' in v) return 'music ends';
  if ('realSeconds' in v) return `wait ${v.realSeconds.toFixed(2)}s real`;
  return null;
}

// One running generator instance plus the bookkeeping the engine needs to
// route wakeups, races, and cancellations to the right iter.
//
// Lifecycle:
//   - `generation` is bumped by `callIter` on each advance. Wakeup
//     reasons capture this at registration; on fire, mismatch = "the
//     script moved on" → silent drop.
//   - `generation` is set to `null` by `drop` to permanently disable a
//     script (entity released, replaced via `runScript`, or cancelled
//     as the loser of a race). Null never matches a snapshotted number,
//     so any in-flight wakeup silently expires. That's the universal
//     cancellation channel.
//   - `raceParent` / `raceParentGeneration` are present iff this
//     script is one racer in a `{ race }` set. On natural completion
//     the done-handler cancels the surviving siblings and calls back
//     into `callIter(parent)`; the snapshot guards against the parent
//     having moved on already.
//   - `raceChildren` is present iff this script is parked on a
//     `{ race }` yield. Holds every spawned racer; `drop` walks it to
//     tear down the whole set when the parent is cancelled. The
//     winning child clears it (and cancels its siblings) before
//     waking the parent, so subsequent advances of the parent see no
//     leftover racers to drop.
//   - `waitedBy` / `waitedByGeneration` and `waitingLeft` /
//     `waitingChildren` mirror the same pattern for the `{ all }`
//     join — see field comments below.
export type SceneScript = {
  iter: ScriptIter;
  entity: Entity;
  generation: number | null;
  // Set on each child of a `{ race }` set. On natural completion
  // (callIter r.done) the child cancels its surviving siblings and
  // wakes the parent. Generation snapshot guards against a parent that
  // has moved on (dropped, or already woken via a different path).
  raceParent?: SceneScript;
  raceParentGeneration?: number;
  // Set on the parent that's parked on a `{ race }`. Holds every
  // racer; cleared by the winner before it wakes the parent, or by
  // `drop` when the parent is cancelled.
  raceChildren?: SceneScript[];
  // Present iff this script is a child of an `{ all }` join. When the
  // child finishes naturally (callIter r.done), we look up `waitedBy`,
  // decrement its `waitingLeft`, and wake the parent when the counter
  // hits zero. `waitedByGeneration` snapshots the parent at spawn time
  // — symmetric with `raceParentGeneration`, it guards the wake-up
  // against a parent that has moved on (dropped, or already woken).
  waitedBy?: SceneScript;
  waitedByGeneration?: number;
  // Present iff this script is parked on an `{ all }` yield. Counts
  // children still running; the parent wakes when this reaches zero.
  // Cleared at wake.
  waitingLeft?: number;
  // Children spawned by this script's `{ all }` yield. Tracked so
  // `drop` can recurse into them when this parent is cancelled —
  // otherwise children keep running with stale `waitedBy` pointers
  // that wake nothing. Cleared at wake (children are all done by then)
  // or by drop. Mirrors `raceChildren` for the race form.
  waitingChildren?: SceneScript[];
  // When true, each leaf yield this script makes writes a description to
  // `manager.lastYieldReason` so the HUD can show what the script is
  // parked on. Set on the stage script via SpawnOpts; propagated to
  // race / all children at spawn time so their progress shows up the
  // same way.
  debugYieldReasons?: boolean;
};

// A parked iter scheduled to be advanced when its frame countdown hits
// zero. Carries a `scheduledGeneration` snapshot — at fire time the
// wakeup is dropped silently if the script's generation has moved on
// (advanced, replaced, or set to null via drop).
type Wait = {
  framesLeft: number;
  script: SceneScript;
  scheduledGeneration: number;
};

// The runtime that runs a stage: owns the entity pool, the script
// scheduler (wait queue, races, drops), the dialogue + bubble managers,
// the pause flag, and the stage scratchpad (`globals` + `beat`).
//
// Constructed once per `GameScene`; throwing the manager away is the
// reset for stage-local state. Anything an entity script can yield is
// handled here — `callIter` / `processYield` is the kernel.
export class StageManager {
  readonly scene: Phaser.Scene;
  readonly damages: ClassGroups;
  readonly damagedBy: ClassGroups;
  readonly bubbles: BubbleManager;
  readonly dialogue: DialogueManager;
  // Live reference to the controllable player entity. Assigned by GameScene
  // immediately after the Player is constructed (which can't happen until
  // the manager exists). Manager construction → Player construction →
  // assignment all complete inside GameScene.create, so by the time any
  // script runs (during manager.update from GameScene.update) this is
  // guaranteed to be set.
  player!: Player;
  // True while the script-frame queue is frozen — set by dialogues, the
  // ESC pause overlay, and the death sequence. Gates the scriptWaiting
  // accumulator in update(); the physics-frame queue is ungated and stops
  // independently when arcade physics is paused (no WORLD_STEP fires).
  // GameScene also reads this flag to gate player input. The `freeze()`
  // helper sets this AND pauses arcade physics together so the common
  // "halt everything" case stays one call; the two pauses are otherwise
  // independent — see tutorialPrompt for the physics-only freeze that
  // keeps script polling alive.
  paused = false;
  // Name shown in the HUD header during a boss fight. Set and cleared by
  // the boss's own script — the manager/HUD don't infer it from entity
  // state.
  bossName: string | null = null;
  // Stage-script scratchpad backing `checkStageOnce` / `checkStageCount`.
  // Lives for the manager's lifetime; switching scenes drops this manager
  // and the next GameScene constructs a fresh one with empty globals.
  readonly globals: Record<string, unknown> = {};
  // Current HUD wave label, set by `markWave(self, name)` calls in the
  // stage body. Null until the body's first markWave.
  wave: string | null = null;
  // Most recent leaf-yield description from a script with
  // `debugYieldReasons` set. Updated in `processYield`; rendered after
  // `wave` in the debug HUD line. Null until the first such yield.
  // Yields whose `describeYield` returns null (e.g. the race form) leave
  // this field unchanged — the previous reason stays visible.
  lastYieldReason: string | null = null;
  // Whether the corridor is "between encounters" — the MC runs forward and
  // the floor scrolls past. False during a wave: the MC plants (or moves
  // sideways under input) and the floor holds still. Stage scripts flip
  // this around every wave (false at start, true after the field is
  // clear); the player anim + bg scroll read it directly.
  running = true;
  // Multiplier on the corridor floor scroll speed (relative to the
  // baseline rate in GameScene). Default 1 = full speed when running;
  // 0.5 = the ending's slow-walk-home roll. Read by GameScene's update
  // loop alongside `running`. Independent of `running` for symmetry —
  // a future cutscene could keep `running=false` (player anim doesn't
  // jog) but still scroll at a custom rate, or vice versa.
  scrollSpeedMultiplier = 1;
  // Mirror of GameScene.bgScrollY — accumulated forward corridor scroll,
  // in pixels. Updated by GameScene each frame and read by stage helpers
  // (computeDoorYs, alignDoor) so they can pick spawn / exit y values
  // through the same door panels the player sees.
  bgScrollY = 0;
  // Run-wide tally (bombs used, enemies killed, HP lost). Bosses snapshot
  // a counter at fight start and read the delta on defeat to drive
  // end-of-fight quips; survives the manager's lifetime, resets when
  // GameScene constructs a fresh manager on scene transition.
  readonly score = new GameScore();

  private readonly free: Entity[] = [];
  private readonly active: Entity[] = [];
  // Two waiting queues, one per "clock":
  //
  //   physicsWaiting — drained one tick per Phaser WORLD_STEP. Auto-pauses
  //     when arcade physics is paused (dialog/freeze, tutorial prompt's
  //     direct `physics.pause()`). The default landing zone for a bare
  //     `yield N` and for `{ physicsFrames: N }` — this is what most
  //     game-logic timing wants.
  //
  //   scriptWaiting — drained from a 60Hz accumulator inside update().
  //     Independent of arcade physics' isPaused flag — keeps ticking
  //     during a `physics.pause()`-only freeze. Receives `{ scriptFrames: N }`
  //     yields plus all internal continuations (spawn start, race/all
  //     parent wakes, until/untilMusicEnds wakeups, dialogue dismiss),
  //     since those are engine plumbing and shouldn't be gated by
  //     physics-pause.
  //
  // Both queues are unsorted: each drain walks the whole list, decrements,
  // fires entries that hit zero. An entity may have multiple entries
  // across both queues simultaneously.
  private readonly physicsWaiting: Wait[] = [];
  private readonly scriptWaiting: Wait[] = [];

  // Wall-clock millis pending against the next scriptWaiting tick. Each
  // update() call adds `delta` and drains TICK_MS-sized chunks. Uncapped:
  // Phaser arcade physics' own accumulator is also uncapped, and a cap
  // here would let one queue out-pace the other on sustained slowdown.
  // Catastrophic delta spikes (tab unfocus, GC stop) are filtered upstream
  // by Phaser's TimeStep.smoothDelta before they reach the scene.
  private tickElapsed = 0;
  private static readonly TICK_MS = 1000 / SCRIPT_FPS;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // allowGravity must be set here: the group's createCallback resets
    // body properties to these defaults every time a child is added,
    // including allowGravity and velocity.
    const groupConfig = { runChildUpdate: false, allowGravity: false };
    const makeGroups = (): ClassGroups => ({
      player: scene.physics.add.group(groupConfig),
      enemy: scene.physics.add.group(groupConfig),
    });
    this.damages = makeGroups();
    this.damagedBy = makeGroups();
    this.bubbles = new BubbleManager(scene);
    this.dialogue = new DialogueManager(scene);

    for (let i = 0; i < ENTITY_POOL_SIZE; i++) this.free.push(this.makeEntity());

    // Subscribe to arcade physics' per-step event. Each emit corresponds
    // to exactly one fixed simulation step run by World.update / step,
    // and the emit happens AFTER body integration and collider processing
    // are finished for that step (World.js:999, 1058) — a quiescent point
    // where it's safe to mutate the world (spawn bodies, set velocities,
    // call die()) from a script body. Draining inline keeps script ticks
    // interleaved with physics steps on catch-up frames. The event doesn't
    // fire when world.isPaused or bodies.size === 0 — the latter never
    // trips in practice because the player is a permanent body.
    scene.physics.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this);
    // Freeze sprite anims while arcade physics is paused so a running enemy
    // doesn't keep cycling its run animation against a stilled body. Covers
    // every pause path uniformly — freeze() / dialogue / ESC pause as well as
    // the intro's `physics.pause()`-only tutorial prompts. Spawn handles the
    // mid-pause spawn case directly (see `spawn`).
    scene.physics.world.on(Phaser.Physics.Arcade.Events.PAUSE, this.onPhysicsPause, this);
    scene.physics.world.on(Phaser.Physics.Arcade.Events.RESUME, this.onPhysicsResume, this);
  }

  private onWorldStep(): void {
    this.tickQueue(this.physicsWaiting);
  }

  private onPhysicsPause(): void {
    if (this.player?.anims.isPlaying) this.player.anims.pause();
    for (const e of this.active) {
      if (e.anims.isPlaying) e.anims.pause();
    }
  }

  private onPhysicsResume(): void {
    if (this.player?.anims.isPaused) this.player.anims.resume();
    for (const e of this.active) {
      if (e.anims.isPaused) e.anims.resume();
    }
  }

  private makeEntity(): Entity {
    const e = new Entity(this.scene, 0, 0, 'bullet');
    e.stage = this;
    this.scene.add.existing(e);
    this.scene.physics.add.existing(e);
    e.setActive(false).setVisible(false);
    const body = e.body;
    body.enable = false;
    body.setAllowGravity(false);
    return e;
  }

  spawn(kind: EntityKind, x: number, y: number, vx: number, vy: number, opts: SpawnOpts = {}): Entity {
    const e = this.free.pop() ?? this.makeEntity();

    const prevFresh = e.x === 0 && e.y === 0;
    const prevOnScreen = !prevFresh && e.x >= 0 && e.x <= GAME_W && e.y >= 0 && e.y <= GAME_H;
    if (prevOnScreen || e.visible || e.alive) {
      console.warn(
        `[spawn-suspicious t=${performance.now().toFixed(0)}] kind=${kind.sprite} target=(${x.toFixed(1)},${y.toFixed(1)}) prevKind=${e.kind.sprite} prevPos=(${e.x.toFixed(1)},${e.y.toFixed(1)}) visible=${e.visible} alive=${e.alive}`,
      );
    }

    e.kind = kind;
    e.hp = opts.hp ?? kind.hp;
    e.alive = true;
    e.gen++;
    e.hasEnteredScreen = false;
    e.onDeathQueue = null;
    e.vars = null;
    e.walkAnim = false;
    e.animSuppressed = false;

    if (kind.sprite !== null) {
      e.setTexture(kind.sprite);
      e.setVisible(true);
    } else {
      e.setVisible(false);
    }
    e.anims.stop();
    // Reset scale to (1, 1) so a pooled entity that was last spawned as a
    // setScale-driven beam doesn't render the next bullet kind oversized.
    // The Arcade Body auto-tracks GameObject scale, so this also restores
    // the body's source size for the upcoming hitbox configuration below.
    e.setScale(1);
    e.setActive(true);
    // Bullets sit between floor (-10) and walls (-9) so the wall texture
    // occludes a stray bullet, and the doors' transparent middle still lets
    // it show through an open doorway. Criterion is "deals damage, can't be
    // hurt" — bullet kinds — and it must re-apply every spawn so a pooled
    // entity reused for a different kind doesn't keep the previous depth.
    e.setDepth(kind.hp === null && kind.damageClass.length > 0 ? -9.5 : 0);

    // Group.add() runs a createCallback that overwrites body properties
    // (velocity, drag, gravity, etc.) with the group's defaults, so we
    // must add to groups BEFORE configuring the body.
    for (const c of kind.damageClass) this.damages[c].add(e);
    const damagedBy = opts.damagedByClass ?? kind.damagedByClass;
    e.activeDamagedBy = damagedBy;
    for (const c of damagedBy) this.damagedBy[c].add(e);

    const body = e.body;
    if (kind.hitboxRadius > 0) {
      body.enable = true;
      if (kind.hitboxShape === 'square') {
        const side = kind.hitboxRadius * 2;
        body.setSize(side, side);
        body.setOffset(e.width / 2 - kind.hitboxRadius, e.height / 2 - kind.hitboxRadius);
      } else {
        body.setCircle(kind.hitboxRadius, e.width / 2 - kind.hitboxRadius, e.height / 2 - kind.hitboxRadius);
      }
      body.reset(x, y);
      body.setVelocity(vx, vy);
    } else {
      e.setPosition(x, y);
      body.enable = false;
    }

    // After velocity is committed: seed facing from the entry velocity
    // so an idle (vx=vy=0) spawn picks a direction that matches what the
    // script will move the entity in, rather than the field default.
    // updateAnim itself bails for entities whose sprite isn't a
    // character sheet (bullets, etc.).
    e.facing = directionFromVelocity(vx, vy);
    e.updateAnim();
    // If we spawned during a physics-pause window (script-frame yields keep
    // running through a `physics.pause()`-only freeze, so a script can spawn
    // here), the PAUSE event has already fired and won't re-fire — pause the
    // fresh anim now so it sits still alongside the rest of the world.
    if (this.scene.physics.world.isPaused && e.anims.isPlaying) e.anims.pause();

    // Push to active before running the first body so the script sees
    // the same world state any later tick would (e.g. countActive of its
    // own kind). Mirrors beginAll / beginRace, which run children eagerly
    // inside the parent's processYield.
    this.active.push(e);

    // `??` would treat an explicit `null` as "missing" and fall back to
    // the kind's default; check for undefined so callers can opt out of
    // the default with `script: null`.
    const script = opts.script !== undefined ? opts.script : (kind.defaultScript ?? null);
    if (script) {
      e.script = this.makeScript(script(e), e);
      if (opts.debugYieldReasons) e.script.debugYieldReasons = true;
      this.callIter(e.script);
    }

    return e;
  }

  private makeScript(iter: ScriptIter, entity: Entity): SceneScript {
    return { iter, entity, generation: 0 };
  }

  // Push onto the script-frame queue. Only used for `{ scriptFrames: N }`
  // waits — every other continuation path (death callback, music-ends
  // callback, dialogue dismiss, real-time timer fire, empty race/all
  // short-circuit) calls `callIter` directly. JS is single-threaded, so
  // those callbacks run to completion before any other event; the engine
  // doesn't need a frame round-trip to be safe. Scripts that genuinely
  // want a frame of separation can `yield 1` (or `yield { scriptFrames: 1 }`).
  private scheduleScriptWait(script: SceneScript, framesLeft: number): void {
    // Only live scripts (generation !== null) get scheduled; the call
    // site runs right after a callIter advance, so the snapshot is
    // always a number.
    // biome-ignore lint/style/noNonNullAssertion: invariant — see comment above
    this.scriptWaiting.push({ framesLeft, script, scheduledGeneration: script.generation! });
  }

  // Push onto the physics-frame queue. Used for bare `yield N` and for
  // `{ physicsFrames: N }` waits. Auto-pauses with arcade physics.
  private schedulePhysicsWait(script: SceneScript, framesLeft: number): void {
    // biome-ignore lint/style/noNonNullAssertion: same invariant as scheduleScriptWait
    this.physicsWaiting.push({ framesLeft, script, scheduledGeneration: script.generation! });
  }

  // Wake the script after `seconds` of wall-clock time. Single-shot
  // timer via `scene.time.delayedCall`, which keeps ticking through
  // `freeze()` (we only freeze the script + physics queues, not the
  // scene), so a wait parked across a dialogue still elapses in real
  // time. Music-time alignment (re-checking the music clock after
  // wakeup, looping if the music drifted behind during a pause) is
  // handled in stage helpers — this primitive is a plain wall-clock
  // delay. Non-positive durations advance the script immediately.
  private scheduleRealTimeWait(script: SceneScript, seconds: number): void {
    if (seconds <= 0) {
      this.callIter(script);
      return;
    }
    const scheduledGen = script.generation;
    this.scene.time.delayedCall(seconds * 1000, () => {
      if (script.generation === scheduledGen) this.callIter(script);
    });
  }

  // Start a script on an already-spawned entity. If the entity already
  // has a script running, drop it first so its parked wakeups silently
  // expire — the entity is now driven by the new script. The first body
  // of the new script runs synchronously inside this call.
  runScript(e: Entity, script: EntityScript): void {
    if (e.script !== null) this.drop(e.script);
    e.script = this.makeScript(script(e), e);
    this.callIter(e.script);
  }

  // Permanently disable a script and propagate down its race / all
  // chains. Sets `generation` to null so any in-flight wakeups (frame
  // waits, race winners, death/dialogue/music callbacks, all
  // completions) see a non-matching generation on fire and silently
  // drop. Recurses into `raceChildren` and `waitingChildren` so a
  // nested race / all tree is taken down in one pass.
  //
  // After marking dead, calls `iter.return()` on the generator so any
  // active `try/finally` blocks unwind. The generation flip happens
  // first so a finally that schedules more work (or wakes a parent)
  // sees a null generation and is silently ignored. Race / all children
  // are dropped before the parent's finally runs so their cleanup
  // observes a coherent torn-down tree. A yield emitted from inside a
  // finally is ignored — drop semantics are "this script is gone", no
  // further scheduling.
  private drop(script: SceneScript): void {
    script.generation = null;
    const racers = script.raceChildren;
    if (racers !== undefined) {
      script.raceChildren = undefined;
      for (const c of racers) this.drop(c);
    }
    const allChildren = script.waitingChildren;
    if (allChildren !== undefined) {
      script.waitingChildren = undefined;
      for (const c of allChildren) this.drop(c);
    }
    try {
      const r = script.iter.return();
      // A `yield` from inside a finally during unwinding leaves the
      // generator un-finished — `return()` reports `done: false` with the
      // yielded value. Drop semantics are "this script is gone", so the
      // yield isn't scheduled; log it so the offending finally is visible
      // instead of silently swallowed.
      if (!r.done) {
        console.error('script yielded from finally during drop', r.value);
      }
    } catch (err) {
      // A throw from a finally block is a script bug, but it shouldn't
      // bring down the engine — log and keep going.
      console.error('script finally threw during drop', err);
    }
  }

  // Higher-order generator: run `inner` and, on exit by any path
  // (normal completion, throw, or `iter.return()` from `drop`), restore
  // the canonical inter-wave state. Wrap every wave body with this so
  // a wave cut mid-flight (e.g. lost a `timeWave` race) doesn't leak
  // its temporary "no movement / no controls / no firing / paused"
  // state into the next slot. This is the single source of truth for
  // the reset — individual wave bodies don't (and shouldn't) clean up
  // their own flags at the end.
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

  // The single advance path. Bumps generation, calls into the iter,
  // and routes the result. Cancellation of surviving race siblings is
  // handled in the r.done branch below — when the winner reports back
  // to its parent it tears down the rest of the set there. That keeps
  // this preamble straight (no race-children check needed) and
  // localises the "first finisher wins" rule to one place.
  private callIter(script: SceneScript): void {
    // Callers guarantee the script is still live (generation !== null):
    // wait queue and race / all wake-ups gate on a generation match,
    // and beginRace / beginAll run freshly-made children. So generation
    // is always a number here.
    (script.generation as number)++;
    const r = script.iter.next();
    if (r.done) {
      const parent = script.raceParent;
      if (parent !== undefined) {
        script.raceParent = undefined;
        if (parent.generation === script.raceParentGeneration) {
          // Generation match means the parent is still parked on the
          // same `race` yield that spawned this script — so its
          // `raceChildren` must still be set. We're the winner: cancel
          // every other racer (this script is skipped because its iter
          // is already done — drop would be a no-op but the explicit
          // skip avoids null-stamping a generation we still rely on
          // above) and clear the array before waking the parent.
          if (parent.raceChildren === undefined) {
            throw new Error('race winner reported but parent has no raceChildren');
          }
          const siblings = parent.raceChildren;
          parent.raceChildren = undefined;
          for (const s of siblings) {
            if (s !== script) this.drop(s);
          }
          this.callIter(parent);
        }
      }
      const waiter = script.waitedBy;
      if (waiter !== undefined) {
        script.waitedBy = undefined;
        // Generation match means the parent is still parked on the same
        // `all` yield that spawned this child, so `waitingLeft` must
        // still be set — it's only cleared when the counter hits zero,
        // which itself bumps the parent's generation. Mismatch means
        // the parent has moved on (dropped, or already woken via a
        // different path) and the wake silently expires — symmetric
        // with the wait-queue / race generation guard.
        if (waiter.generation === script.waitedByGeneration) {
          if (waiter.waitingLeft === undefined) {
            throw new Error('all-child completed but parent has no waitingLeft counter');
          }
          waiter.waitingLeft--;
          if (waiter.waitingLeft === 0) {
            waiter.waitingLeft = undefined;
            // Children are all done at this point (each one decrements
            // the counter exactly once on completion), so the array
            // holds finished scripts only — safe to drop without
            // cancelling anything.
            waiter.waitingChildren = undefined;
            this.callIter(waiter);
          }
        }
      }
      return;
    }
    this.processYield(script, r.value);
  }

  private processYield(script: SceneScript, v: ScriptYield): void {
    if (script.debugYieldReasons) {
      const desc = describeYield(v);
      // Null = "no leaf description for this yield" (e.g. the race form,
      // whose trigger writes the description itself when beginRace
      // re-enters processYield). Leave the previous reason visible.
      if (desc !== null) this.lastYieldReason = desc;
    }
    if (typeof v === 'number') {
      if (v <= 0 && !this.scene.physics.world.isPaused) {
        // Non-positive frame count + the relevant queue isn't paused →
        // re-advance the script in this same tick. Used by audio-time
        // waits that round to zero right at the target boundary; saves
        // a frame of round-trip latency. Recursive — a script that
        // yields 0 in a tight loop will grow the JS stack until it
        // crashes, but no real script does that. When the queue *is*
        // paused, fall through and schedule with a possibly-non-positive
        // framesLeft; the queue drain treats `framesLeft <= 0 → fire`
        // so the entry pops on the first tick after resume.
        this.callIter(script);
      } else {
        this.schedulePhysicsWait(script, v | 0);
      }
    } else if ('physicsFrames' in v) {
      if (v.physicsFrames <= 0 && !this.scene.physics.world.isPaused) {
        this.callIter(script);
      } else {
        this.schedulePhysicsWait(script, v.physicsFrames | 0);
      }
    } else if ('scriptFrames' in v) {
      if (v.scriptFrames <= 0 && !this.paused) {
        this.callIter(script);
      } else {
        this.scheduleScriptWait(script, v.scriptFrames | 0);
      }
    } else if ('dialogue' in v) {
      this.beginDialogue(v.dialogue, script);
    } else if ('until' in v) {
      if (v.until.alive) {
        const scheduledGen = script.generation;
        v.until.onDeath(() => {
          if (script.generation === scheduledGen) this.callIter(script);
        });
      } else {
        this.callIter(script);
      }
    } else if ('untilMusicEnds' in v) {
      const scheduledGen = script.generation;
      onceMusicComplete(() => {
        if (script.generation === scheduledGen) this.callIter(script);
      });
    } else if ('realSeconds' in v) {
      this.scheduleRealTimeWait(script, v.realSeconds);
    } else if ('race' in v) {
      this.beginRace(v.race, script);
    } else if ('all' in v) {
      this.beginAll(v.all, script);
    }
  }

  private beginAll(iters: Array<ScriptIter>, parent: SceneScript): void {
    if (iters.length === 0) {
      // Empty join → continue executing the parent immediately. JS is
      // synchronous; if a script wants a frame of separation it can
      // `yield 1` itself.
      this.callIter(parent);
      return;
    }
    // Parent just yielded the all (callIter advanced it), so its
    // generation is a number, not null.
    // biome-ignore lint/style/noNonNullAssertion: invariant — see comment above
    const parentGen = parent.generation!;
    parent.waitingLeft = iters.length;
    const children: SceneScript[] = [];
    parent.waitingChildren = children;
    for (const iter of iters) {
      children.push({
        iter,
        entity: parent.entity,
        generation: 0,
        waitedBy: parent,
        waitedByGeneration: parentGen,
        debugYieldReasons: parent.debugYieldReasons,
      });
    }
    // Run children eagerly, mirroring beginRace's eager-inner step. A
    // child that synchronously completes will decrement waitingLeft via
    // the r.done path; if every child completes synchronously the last
    // one wakes the parent recursively, which clears waitingChildren
    // and bumps the parent's generation. Snapshot the array so a
    // synchronous wake-up that mutates `waitingChildren` doesn't trip
    // the iteration; check the identity each step so we bail out the
    // moment the parent moves on.
    for (const child of children.slice()) {
      if (parent.waitingChildren !== children) return;
      this.callIter(child);
    }
  }

  private beginRace(iters: Array<ScriptIter>, parent: SceneScript): void {
    if (iters.length === 0) {
      // Empty race → continue executing the parent immediately, same
      // as the empty-all path.
      this.callIter(parent);
      return;
    }
    // Parent just yielded the race (callIter advanced it), so its
    // generation is a number, not null.
    // biome-ignore lint/style/noNonNullAssertion: invariant — see comment above
    const parentGen = parent.generation!;
    const racers: SceneScript[] = [];
    parent.raceChildren = racers;
    // Build-and-run each racer one at a time. A racer that synchronously
    // completes will cancel its siblings and wake the parent via the
    // r.done path, which clears `raceChildren` and bumps the parent's
    // generation. Doing the work inline (rather than allocating every
    // SceneScript up front) means an eager winner never costs us the
    // unbuilt remainders — both the SceneScript wrappers and the iter
    // generators sit in `iters` and are simply dropped on return.
    for (const iter of iters) {
      const racer: SceneScript = {
        iter,
        entity: parent.entity,
        generation: 0,
        raceParent: parent,
        raceParentGeneration: parentGen,
        debugYieldReasons: parent.debugYieldReasons,
      };
      racers.push(racer);
      this.callIter(racer);
      // The winner-completion path clears `raceChildren`; once that has
      // happened the race is over and the remaining iters in the input
      // list won't be spawned.
      if (parent.raceChildren !== racers) return;
    }
  }

  // Hard pause: scripts freeze (paused = true short-circuits update) and
  // Phaser physics is paused globally so all bodies — including the player
  // — sit still. GameScene also gates player input on stage.paused so held
  // keys don't accumulate during the cutscene. Use this from any code path
  // that wants the same dialogue/cutscene-style freeze (ESC pause, death
  // sequence, dialogue) so the two flags never drift.
  //
  // Music is intentionally left running through dialogue freezes. Audio-
  // time waits (`waitAudioTimeAtLeast`, `waitTrackEnded`) decompose into
  // `realSeconds` yields, which schedule off the wall-clock via
  // `scene.time.delayedCall` and aren't gated by either pause flag — so
  // the music + the wait both keep advancing through the freeze and
  // arrive at the seam together.
  freeze(): void {
    this.paused = true;
    this.scene.physics.pause();
  }

  unfreeze(): void {
    this.paused = false;
    this.scene.physics.resume();
  }

  private beginDialogue(opts: DialogueOpts, script: SceneScript): void {
    this.freeze();
    const scheduledGen = script.generation;
    this.dialogue.start(opts, () => {
      this.unfreeze();
      if (script.generation === scheduledGen) this.callIter(script);
    });
  }

  private release(e: Entity, indexInActive: number): void {
    // If we're releasing a still-alive entity (e.g. culled off-screen),
    // fire its death callbacks so anything waiting via `{ until: e }`
    // unblocks rather than hanging forever on a target that just
    // silently vanished.
    if (e.alive) e.die();

    const last = this.active.length - 1;
    // biome-ignore lint/style/noNonNullAssertion: bounded by active.length - 1
    if (indexInActive !== last) this.active[indexInActive] = this.active[last]!;
    this.active.pop();

    for (const c of e.kind.damageClass) this.damages[c].remove(e);
    for (const c of e.activeDamagedBy) this.damagedBy[c].remove(e);

    // Disable the entity's script (and any race-child) so any in-flight
    // wakeups — wait-queue entries, dialogue/death/music callbacks,
    // race triggers — see a null generation on fire and silently drop.
    // No need to walk `waiting` ourselves; stale entries are filtered
    // at fire time by the generation check.
    if (e.script !== null) {
      this.drop(e.script);
      e.script = null;
    }

    e.alive = false;
    e.onDeathQueue = null;
    e.kind = INERT_KIND;
    e.hp = null;
    e.setActive(false).setVisible(false);
    const body = e.body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.free.push(e);
  }

  update(time: number, delta: number): void {
    // Render-rate work runs every call: dialog text reveal, bubble layout,
    // sprite anim direction, off-screen culling. None of these advance
    // simulation state — they just reflect what physics + scripts have
    // already produced.
    this.dialogue.update(time);
    if (this.paused) {
      // Drain the script accumulator on pause-entry so unpause doesn't
      // burst-fire a backlog. The physics queue isn't our concern here —
      // it ticks off WORLD_STEP, which the world's own pause flag gates.
      this.tickElapsed = 0;
      return;
    }
    this.bubbles.update();

    // Drive the script-frame queue at a fixed 60Hz against wall-clock
    // delta — same accumulator math as Phaser's physics, so over any
    // window the two queues fire the same number of ticks. The script
    // queue is independent of arcade's isPaused, so a tutorial prompt
    // that calls `physics.pause()` without setting `stage.paused` keeps
    // its input-polling loop ticking. The physics queue drains inline
    // from the WORLD_STEP handler (see onWorldStep above).
    this.tickElapsed += delta;
    while (this.tickElapsed >= StageManager.TICK_MS) {
      this.tickElapsed -= StageManager.TICK_MS;
      this.tickQueue(this.scriptWaiting);
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e) continue;

      if (!e.alive) {
        this.release(e, i);
        continue;
      }

      e.updateAnim();

      const inX = e.x >= -CULL_MARGIN && e.x <= GAME_W + CULL_MARGIN;
      const inY = e.y >= -CULL_MARGIN && e.y <= GAME_H + CULL_MARGIN;
      const onScreen = e.x >= 0 && e.x <= GAME_W && e.y >= 0 && e.y <= GAME_H;
      if (onScreen) e.hasEnteredScreen = true;
      if ((!inX || !inY) && e.hasEnteredScreen) {
        this.release(e, i);
      }
    }
  }

  // Walk a wait queue once: decrement framesLeft, keep entries that aren't
  // due yet, fire those that are. callIter() may push fresh entries onto
  // either queue (yield N → reschedule, {until} → onDeath closure schedules
  // later). Newly pushed entries land at indices >= originalLen, so the
  // read loop won't visit them. After the read loop, compact the appended
  // tail down to fill gaps left by popped entries.
  private tickQueue(queue: Wait[]): void {
    const originalLen = queue.length;
    let write = 0;
    for (let read = 0; read < originalLen; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by originalLen
      const w = queue[read]!;
      w.framesLeft--;
      if (w.framesLeft > 0) {
        queue[write++] = w;
      } else if (w.script.generation === w.scheduledGeneration) {
        // Fire iff the script hasn't been advanced or dropped since we
        // captured the snapshot at scheduling. Stale wakeups silently
        // expire — that's the universal cancellation channel. A dropped
        // script's generation is `null`, which never matches the
        // captured number.
        this.callIter(w.script);
      }
    }
    for (let read = originalLen; read < queue.length; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by queue.length
      queue[write++] = queue[read]!;
    }
    queue.length = write;
  }
}
