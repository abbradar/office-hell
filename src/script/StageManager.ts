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
// default description so high-level helpers can name themselves. Returns
// null for the race form because beginRace re-enters processYield with
// the trigger, which writes the leaf description itself.
function describeYield(v: ScriptYield): string | null {
  if (typeof v === 'number') return `wait ${v}f`;
  if ('race' in v) return null;
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
//   - `racedParent` / `racedParentGeneration` are present iff this
//     script is the inner of a race. On natural completion the
//     done-handler calls back into `callIter(parent)`; the snapshot
//     guards against the parent having moved on already.
//   - `racedChild` is present iff this script is the outer of a race.
//     On any advance of the outer that is *not* the inner-finishes
//     path, `callIter` drops the child first — that's how a trigger
//     (or any other path that wakes the outer) cancels the inner
//     exactly once.
export type SceneScript = {
  iter: ScriptIter;
  entity: Entity;
  generation: number | null;
  racedParent?: SceneScript;
  racedParentGeneration?: number;
  racedChild?: SceneScript;
  // When true, each leaf yield this script makes writes a description to
  // `manager.lastYieldReason` so the HUD can show what the script is
  // parked on. Set on the stage script via SpawnOpts; propagated to raced
  // children in `beginRace` so the inner's progress shows up the same way.
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
  // input on the same flag.
  paused = false;
  // Name shown in the HUD header during a boss fight. Set and cleared by
  // the boss's own script — the manager/HUD don't infer it from entity
  // state.
  bossName: string | null = null;
  // Stage-script scratchpad backing `checkStageOnce` / `checkStageCount`.
  // Lives for the manager's lifetime; switching scenes drops this manager
  // and the next GameScene constructs a fresh one with empty globals.
  readonly globals: Record<string, unknown> = {};
  // Current HUD beat label, set by `markBeat(self, name)` calls in the
  // stage body. Null until the body's first markBeat.
  beat: string | null = null;
  // Most recent leaf-yield description from a script with
  // `debugYieldReasons` set. Updated in `processYield`; rendered after
  // `beat` in the debug HUD line. Null until the first such yield.
  // Yields whose `describeYield` returns null (e.g. the race form) leave
  // this field unchanged — the previous reason stays visible.
  lastYieldReason: string | null = null;

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

    if (kind.sprite !== null) {
      e.setTexture(kind.sprite);
      e.setVisible(true);
    } else {
      e.setVisible(false);
    }
    e.anims.stop();
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
      body.setCircle(kind.hitboxRadius, e.width / 2 - kind.hitboxRadius, e.height / 2 - kind.hitboxRadius);
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

    const script = opts.script ?? kind.defaultScript ?? null;
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

  // Permanently disable a script and propagate down its race chain.
  // Sets `generation` to null so any in-flight wakeups (frame waits,
  // race triggers, death/dialogue/music callbacks) see a non-matching
  // generation on fire and silently drop. Recurses into `racedChild`
  // so a nested race tree is taken down in one pass.
  private drop(script: SceneScript): void {
    script.generation = null;
    const child = script.racedChild;
    if (child !== undefined) {
      script.racedChild = undefined;
      this.drop(child);
    }
  }

  // The single advance path. Bumps generation, calls into the iter, and
  // routes the result. If the script holds a `racedChild` (i.e. it's
  // the outer of a race) we drop the child first — that's how every
  // wake of the outer except "inner just finished" cancels the inner.
  // The inner-finished path clears `racedChild` *before* calling back
  // into `callIter(parent)`, so this drop step finds nothing and is a
  // noop.
  private callIter(script: SceneScript): void {
    const child = script.racedChild;
    if (child !== undefined) {
      script.racedChild = undefined;
      this.drop(child);
    }
    // Callers guarantee the script is still live (generation !== null):
    // wait queue and race wake-ups gate on a generation match, and
    // beginRace runs the freshly-made inner. So generation is always a
    // number here.
    (script.generation as number)++;
    const r = script.iter.next();
    if (r.done) {
      const parent = script.racedParent;
      if (parent !== undefined) {
        script.racedParent = undefined;
        if (parent.racedChild === script) parent.racedChild = undefined;
        if (parent.generation === script.racedParentGeneration) {
          this.callIter(parent);
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
      this.beginRace(v.race, v.trigger, script);
    }
  }

  private beginRace(innerIter: ScriptIter, trigger: ScriptYield, parent: SceneScript): void {
    const inner: SceneScript = {
      iter: innerIter,
      entity: parent.entity,
      generation: 0,
      racedParent: parent,
      // Parent just yielded the race (callIter advanced it), so its
      // generation is a number, not null.
      // biome-ignore lint/style/noNonNullAssertion: invariant — see comment above
      racedParentGeneration: parent.generation!,
      debugYieldReasons: parent.debugYieldReasons,
    };
    parent.racedChild = inner;
    // Run inner immediately rather than parking it for a frame — saves
    // the round-trip and keeps timing snappy. If inner happens to
    // finish on its first step the inner-done path will have cleared
    // `parent.racedChild` and advanced parent past the race yield; we
    // then skip installing the trigger so we don't open a phantom wait
    // (e.g. a dialog box that nobody's parked on) for a parent that has
    // already moved on.
    this.callIter(inner);
    if (parent.racedChild === inner) {
      this.processYield(parent, trigger);
    }
  }

  private beginDialogue(opts: DialogueOpts, script: SceneScript): void {
    // Hard pause: scripts freeze (paused = true short-circuits update)
    // and Phaser physics is paused globally so all bodies — including
    // the player — sit still. GameScene also gates player input on
    // stage.paused so held keys don't accumulate during the cutscene.
    this.paused = true;
    this.scene.physics.pause();

    const scheduledGen = script.generation;
    this.dialogue.start(opts, () => {
      this.paused = false;
      this.scene.physics.resume();
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
