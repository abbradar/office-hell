import type Phaser from 'phaser';
import { onceMusicComplete } from '../audio/music/loop';
import { CULL_MARGIN, ENTITY_POOL_SIZE, GAME_H, GAME_W } from '../config';
import { directionFromVelocity } from '../content/animations';
import { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { BubbleManager } from '../ui/bubbles';
import { DialogueManager, type DialogueOpts } from '../ui/dialogue';
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
  if ('frames' in v) return `wait ${v.frames}f`;
  if ('dialogue' in v) return 'dialogue';
  if ('until' in v) return `until ${v.until.kind.sprite ?? 'entity'} dies`;
  if ('untilMusicEnds' in v) return 'music ends';
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
  // True while a dialog/cutscene wants scripts to freeze. update consults
  // this to short-circuit script ticks; GameScene gates physics + player
  // input on the same flag. Mutate via `freeze()` / `unfreeze()` so the
  // physics pause stays in lockstep.
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

  private readonly free: Entity[] = [];
  private readonly active: Entity[] = [];
  // Unsorted: each tick we walk the whole list, decrement, fire entries
  // that hit zero. An entity may have multiple entries simultaneously
  // (e.g. a race carries the inner's wait and a separate trigger wait
  // on the outer).
  private readonly waiting: Wait[] = [];

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

    e.kind = kind;
    e.hp = opts.hp ?? kind.hp;
    e.alive = true;
    e.gen++;
    e.hasEnteredScreen = false;
    e.onDeathQueue = null;
    e.vars = null;

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

    // `??` would treat an explicit `null` as "missing" and fall back to
    // the kind's default; check for undefined so callers can opt out of
    // the default with `script: null`.
    const script = opts.script !== undefined ? opts.script : (kind.defaultScript ?? null);
    if (script) {
      e.script = this.makeScript(script(e), e);
      if (opts.debugYieldReasons) e.script.debugYieldReasons = true;
      this.scheduleIter(e.script, 1);
    }

    this.active.push(e);
    return e;
  }

  private makeScript(iter: ScriptIter, entity: Entity): SceneScript {
    return { iter, entity, generation: 0 };
  }

  private scheduleIter(script: SceneScript, framesLeft: number): void {
    // Only live scripts (generation !== null) get scheduled; the few
    // call sites all run right after a callIter advance or a fresh
    // makeScript, so the snapshot is always a number.
    // biome-ignore lint/style/noNonNullAssertion: invariant — see comment above
    this.waiting.push({ framesLeft, script, scheduledGeneration: script.generation! });
  }

  // Start a script on an already-spawned entity. If the entity already
  // has a script running, drop it first so its parked wakeups silently
  // expire — the entity is now driven by the new script.
  runScript(e: Entity, script: EntityScript): void {
    if (e.script !== null) this.drop(e.script);
    e.script = this.makeScript(script(e), e);
    this.scheduleIter(e.script, 1);
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
      script.iter.return();
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
      this.scheduleIter(script, Math.max(0, v | 0) + 1);
    } else if ('frames' in v) {
      this.scheduleIter(script, Math.max(0, v.frames | 0) + 1);
    } else if ('dialogue' in v) {
      this.beginDialogue(v.dialogue, script);
    } else if ('until' in v) {
      if (v.until.alive) {
        const scheduledGen = script.generation;
        v.until.onDeath(() => {
          if (script.generation === scheduledGen) this.scheduleIter(script, 1);
        });
      } else {
        this.scheduleIter(script, 1);
      }
    } else if ('untilMusicEnds' in v) {
      const scheduledGen = script.generation;
      onceMusicComplete(() => {
        if (script.generation === scheduledGen) this.scheduleIter(script, 1);
      });
    } else if ('race' in v) {
      this.beginRace(v.race, script);
    } else if ('all' in v) {
      this.beginAll(v.all, script);
    }
  }

  private beginAll(iters: Array<ScriptIter>, parent: SceneScript): void {
    if (iters.length === 0) {
      // Empty join → resume on the next frame, mirroring the 1-frame
      // round-trip a normal child completion would take.
      this.scheduleIter(parent, 1);
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
      // Empty race → resume on the next frame, mirroring the empty-all
      // behaviour and the 1-frame round-trip a normal child completion
      // would take.
      this.scheduleIter(parent, 1);
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
      if (script.generation === scheduledGen) this.scheduleIter(script, 1);
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

  update(time: number, _delta: number): void {
    this.dialogue.update(time);
    if (this.paused) return;
    this.bubbles.update();

    // Walk waiting once: decrement, keep entries that aren't due yet,
    // fire those that are. callIter() may push fresh entries onto
    // waiting (yield N → reschedule, {until} → onDeath closure
    // schedules later). Newly pushed entries land at indices >=
    // originalLen, so the read loop won't visit them. After the read
    // loop, compact the appended tail down to fill the gaps left by
    // popped entries.
    const originalLen = this.waiting.length;
    let write = 0;
    for (let read = 0; read < originalLen; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by originalLen
      const w = this.waiting[read]!;
      w.framesLeft--;
      if (w.framesLeft > 0) {
        this.waiting[write++] = w;
      } else if (w.script.generation === w.scheduledGeneration) {
        // Fire iff the script hasn't been advanced or dropped since we
        // captured the snapshot at scheduling. Stale wakeups silently
        // expire — that's the universal cancellation channel. A dropped
        // script's generation is `null`, which never matches the
        // captured number.
        this.callIter(w.script);
      }
    }
    for (let read = originalLen; read < this.waiting.length; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by waiting.length
      this.waiting[write++] = this.waiting[read]!;
    }
    this.waiting.length = write;

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
}
