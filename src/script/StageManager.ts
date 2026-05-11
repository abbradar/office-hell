import Phaser from 'phaser';
import { onceMusicComplete } from '../audio/music/loop';
import { CULL_MARGIN, GAME_H, GAME_W, SCRIPT_FPS } from '../config';
import { directionFromVelocity } from '../content/animations';
import { MULT_DROP_BY_TIER } from '../content/kinds';
import { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { BubbleManager } from '../ui/bubbles';
import { DialogueManager, type DialogueOpts } from '../ui/dialogue';
import { MultDropKind } from './multDrop';
import { ALIVE_TICK_FRAMES, GameScore, recordAliveTick } from './score';
import type { DamageClass, EntityKind, EntityScript, EntityTier, ScriptYield, SpawnOpts } from './types';
import { HPEntityKind } from './types';

type ClassGroups = Record<DamageClass, Phaser.Physics.Arcade.Group>;

type ScriptIter = Generator<ScriptYield, void, void>;

// Shared frozen sentinel handed to `spawn` when the caller omits its
// `opts` argument — `spawn` is on the hot path (every bullet spawn
// flows through it) so allocating a fresh `{}` per call would churn
// the GC for no benefit. The frozen object guards against accidental
// mutation; reads of optional fields just return undefined.
const EMPTY_SPAWN_OPTS = Object.freeze({}) as SpawnOpts;

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

// Hardcoded seed for the manager's mulberry32 PRNG. Picked once and
// burned in so every playthrough sees the same draws — the practical
// effect is that the same sprite shows up in the same horde slot every
// run, which keeps replays visually stable. Any 32-bit value works;
// chosen to be visually-distinct (not `0` / `1` / `0xDEADBEEF`) so a
// `git blame` makes the source of the seed obvious.
const STAGE_RNG_SEED = 0x4f48656c; // "OHel"

// Multiplier-drop magnet tuning. The threshold is a fraction of GAME_H
// — drops are vacuumed only while the player sits above
// `GAME_H * MAGNET_THRESHOLD_FRAC` (inverted Touhou POC pattern). 0.4
// = top 40% of the field, where the bullets cluster — risk for reward.
// See src/docs/scoring-system.md → "Magnet zone".
const MAGNET_THRESHOLD_FRAC = 0.4;
// px/s the magnet pull retargets a drop's velocity to. Tuned to feel
// snappy without snapping — the overlap handler in GameScene catches
// the collect on first contact, so 400 reaches the player within ~1s
// from anywhere on screen.
const MAGNET_SPEED = 400;
// Initial downward drift for a freshly spawned drop. Slow enough to
// give the player time to come up and claim it; fast enough that an
// uncollected drop exits via the bottom cull margin in a few seconds.
const MULT_DROP_DRIFT_VY = 40;
// Fallback spawn y when scheduleMultDrop can't find a live carrier
// (every enemy in the wave is already dead by the time the wave script
// got around to scheduling). Top of the playfield, just below the
// HUD band — drops in from where wave enemies would have come.
const MULT_DROP_FALLBACK_Y = 40;
// How many script ticks the deferred sampler keeps retrying before
// giving up and spawning the drop at the top-center fallback. 300 =
// 5s @ 60fps — comfortable for a wave that takes a few seconds to
// produce its first live enemy, but bounded so a wave that never
// spawns one (a misconfiguration) doesn't leak the pending entry.
const PENDING_DROP_TIMEOUT_FRAMES = 300;

// The runtime that runs a stage: owns the active entity list, the
// script scheduler (wait queue, races, drops), the dialogue + bubble
// managers, the pause flag, and the stage scratchpad (`globals` +
// `beat`).
//
// Constructed once per `GameScene`; throwing the manager away is the
// reset for stage-local state. Anything an entity script can yield is
// handled here — `callIter` / `processYield` is the kernel.
export class StageManager {
  readonly scene: Phaser.Scene;
  readonly damages: ClassGroups;
  readonly damagedBy: ClassGroups;
  // Pickup group for multiplier drops. Lives outside damages/damagedBy
  // so its overlap with the player is a one-way "collect on touch"
  // rather than a damage exchange. See src/docs/scoring-system.md.
  readonly drops: Phaser.Physics.Arcade.Group;
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
  // Live boss entity reference. Set alongside `bossName` and cleared on
  // boss death. Used by patterns that need to orbit / track the boss's
  // current position from a spawned controller entity (e.g. the
  // final-boss orbital arcs in content/waves/theBoss.ts). Null when no
  // boss is on the field.
  bossEntity: Entity | null = null;
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
  // Score accrual gate. Flipped false at the start of the intro tutorial
  // and back on once the tutorial completes — so kill bonuses, the
  // alive-tick, and wave-end multiplier drops only start counting when
  // the player has real agency over the game. Also flipped off after
  // the final-boss defeat so the outro / ending scene runs with scoring
  // frozen. Practice / test / music modes never run the intro, so this
  // stays at its default `true` for them. See src/docs/scoring-system.md.
  scoringActive = true;
  // Separate gate for the alive-tick alone. Lets inter-stage breathers
  // (e.g. the water-cooler wave) pause survival score accrual without
  // also gating kills / drops, which keep counting under `scoringActive`
  // alone. Default `true`; waves that want to pause survival flip it
  // false under a try/finally so a script cancel restores it.
  survivalActive = true;
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
  // Frames accumulated since the last alive-tick fired. Bumped each
  // 60Hz simulation step; rolls over at ALIVE_TICK_FRAMES so the
  // 0.1s/+1×mult cadence is exact regardless of frame jitter.
  private aliveTickAccum = 0;
  // Seeded RNG state for visual variety draws that should stay stable
  // across replays — the ordinary-coworker sprite picker is the
  // canonical user. A fresh manager (per scene transition) starts at
  // STAGE_RNG_SEED so the same playthrough always produces the same
  // sequence. Don't use this for gameplay-affecting randomness — it's
  // a render-side dial. Mulberry32 internals: cheap 32-bit PRNG with
  // decent uniformity for picking-from-a-small-list.
  private rngState = STAGE_RNG_SEED;
  // Multiplier-drop scheduling queue. A wave's `scheduleMultDrop(tier)`
  // call lands here when no live enemy is available at call time; the
  // per-tick resolver retries until one appears or the timeout fires.
  private pendingDrops: { tier: EntityTier; framesLeft: number }[] = [];

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
    this.drops = scene.physics.add.group(groupConfig);
    this.bubbles = new BubbleManager(scene);
    this.dialogue = new DialogueManager(scene);

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

  spawn<TOpts extends SpawnOpts>(
    kind: EntityKind<TOpts>,
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts: TOpts = EMPTY_SPAWN_OPTS as TOpts,
  ): Entity {
    // Fresh entity per spawn — no pooling. Phaser sprites need a texture
    // even when invisible, so sprite-less kinds (the inert stage
    // controller) get a dummy bullet texture and setVisible(false).
    // Honour the per-spawn `sprite` override only for kinds that actually
    // carry a sheet: passing `sprite` to a sprite=null kind (inert / no
    // character) would otherwise turn it visible mid-render — caller
    // bug, not a knob we want to expose.
    const spriteKey = kind.sprite === null ? 'bullet' : (opts.sprite ?? kind.sprite);
    const e = new Entity(this.scene, x, y, spriteKey);
    e.stage = this;
    this.scene.add.existing(e);
    this.scene.physics.add.existing(e);

    e.kind = kind;
    e.alive = true;

    if (kind.sprite === null) e.setVisible(false);
    // Bullets sit between floor (-10) and walls (-9) so the wall texture
    // occludes a stray bullet, and the doors' transparent middle still lets
    // it show through an open doorway. Criterion is "deals damage, can't be
    // hurt" — no-HP kinds (bullets, beams) with a damageClass.
    e.setDepth(!(kind instanceof HPEntityKind) && kind.damageClass.length > 0 ? -9.5 : 0);

    // Group.add() runs a createCallback that overwrites body properties
    // (velocity, drag, gravity, etc.) with the group's defaults, so we
    // must add to groups BEFORE configuring the body. The group config
    // sets allowGravity=false, so adding to any group gives us the
    // correct gravity setting; for entities that aren't in any group
    // (no damage classes) we set it directly below. Multiplier drops
    // bypass damages/damagedBy entirely — they live in their own
    // `drops` group so the player's overlap handler is one-way collect,
    // not damage exchange.
    if (kind instanceof MultDropKind) {
      this.drops.add(e);
      e.activeDamagedBy = [];
    } else {
      for (const c of kind.damageClass) this.damages[c].add(e);
      const damagedBy = opts.damagedByClass ?? kind.damagedByClass;
      e.activeDamagedBy = damagedBy;
      for (const c of damagedBy) this.damagedBy[c].add(e);
    }

    const body = e.body;
    body.setAllowGravity(false);
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
      body.enable = false;
    }

    // After velocity is committed: seed facing from the entry velocity
    // so an idle (vx=vy=0) spawn picks a direction that matches what the
    // script will move the entity in, rather than the field default.
    // updateAnim itself bails for entities whose sprite isn't a
    // character sheet (bullets, etc.).
    e.facing = directionFromVelocity(vx, vy);
    e.updateAnim();
    // Directional sprite (droplet, dagger, etc.) — point the sprite
    // at its travel direction. Set once at spawn; bullets that change
    // velocity later won't re-rotate. Sprite art is assumed pointed
    // right at rotation 0 (kind.rotateToVelocity contract); fall back
    // to rotation 0 for stationary spawns so a pool-recycled bullet
    // doesn't keep the previous slot's rotation.
    if (kind.rotateToVelocity) {
      e.setRotation(vx === 0 && vy === 0 ? 0 : Math.atan2(vy, vx));
    } else {
      e.setRotation(0);
    }
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

    // Kind-level init hook — runs after per-life state is reset and the
    // entity is on the active list, before its script starts. Empty by
    // default; HP-bearing kinds use it to seed `vars.hp` (honouring the
    // per-spawn `opts.hp` override), phased bosses additionally seed
    // `vars.phaseIdx`.
    kind.init(e, opts);

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

  // Tag a random currently-live enemy from `damages.player` (entities
  // with hp, not bullets) so its eventual death spawns a multiplier
  // drop. Safe to call at any point during the wave — including
  // before the wave has spawned its first enemy. The sampler retries
  // each tick until a tier-eligible enemy is alive; after
  // PENDING_DROP_TIMEOUT_FRAMES with no candidate, the drop falls
  // back to a top-center spawn so a misplaced call still pays out.
  // See src/docs/scoring-system.md → "Multiplier drops".
  scheduleMultDrop(tier: EntityTier): void {
    // Scoring gate covers drops too — wave scripts in the tutorial
    // section call this unconditionally, so the gate is enforced here
    // rather than at every call site.
    if (!this.scoringActive) return;
    if (this.tryAssignDrop(tier)) return;
    this.pendingDrops.push({ tier, framesLeft: PENDING_DROP_TIMEOUT_FRAMES });
  }

  // Sample a live enemy and attach an onDeath callback that spawns
  // the tiered drop at the kill point. Returns false when no
  // candidate exists; the caller (`scheduleMultDrop` or the per-tick
  // resolver) decides whether to retry or fall back.
  private tryAssignDrop(tier: EntityTier): boolean {
    const candidates: Entity[] = [];
    for (const c of this.damages.player.getChildren()) {
      const e = c as Entity;
      // Live enemies only — `kind instanceof HPEntityKind` partitions
      // enemies (which carry HP) from bullets (which don't). `alive`
      // guards entities mid-death-script.
      if (e.alive && e.kind instanceof HPEntityKind) candidates.push(e);
    }
    if (candidates.length === 0) return false;
    const kind = MULT_DROP_BY_TIER[tier];
    const carrier = candidates[Math.floor(Math.random() * candidates.length)] as Entity;
    carrier.onDeath(() => {
      // onDeath fires inside `die()` AFTER alive=false; the entity's
      // position is still valid (Phaser keeps x/y until the next pool
      // reuse), so spawning at (carrier.x, carrier.y) lands at the
      // visual kill point.
      this.spawn(kind, carrier.x, carrier.y, 0, MULT_DROP_DRIFT_VY);
    });
    return true;
  }

  // Per-tick resolver for pending drops queued by `scheduleMultDrop`.
  // Retries the sample every script tick; on timeout, drops the
  // top-center fallback so a wave that never produced a live enemy
  // (shouldn't happen, but a paranoid invariant) still pays out.
  private resolvePendingDrops(): void {
    for (let i = this.pendingDrops.length - 1; i >= 0; i--) {
      const pd = this.pendingDrops[i] as { tier: EntityTier; framesLeft: number };
      pd.framesLeft -= 1;
      if (this.tryAssignDrop(pd.tier)) {
        this.pendingDrops.splice(i, 1);
        continue;
      }
      if (pd.framesLeft <= 0) {
        const kind = MULT_DROP_BY_TIER[pd.tier];
        this.spawn(kind, GAME_W / 2, MULT_DROP_FALLBACK_Y, 0, MULT_DROP_DRIFT_VY);
        this.pendingDrops.splice(i, 1);
      }
    }
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
  // Mulberry32 step — produces a uniform float in [0, 1). Use for
  // visual-only choices that should stay stable across replays
  // (`nextOrdinaryCoworkerSprite` is the only caller today). Not for
  // gameplay randomness: the seed is hardcoded and the state is shared
  // across all draws, so two callers will interfere with each other's
  // sequences. If a second class of draw shows up, add a second
  // stream — don't sample arbitrary visual choices off the same one.
  nextRandom(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

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

    if (e.kind instanceof MultDropKind) {
      this.drops.remove(e);
    } else {
      for (const c of e.kind.damageClass) this.damages[c].remove(e);
      for (const c of e.activeDamagedBy) this.damagedBy[c].remove(e);
    }

    // Disable the entity's script (and any race-child) so any in-flight
    // wakeups — wait-queue entries, dialogue/death/music callbacks,
    // race triggers — see a null generation on fire and silently drop.
    // No need to walk `waiting` ourselves; stale entries are filtered
    // at fire time by the generation check.
    if (e.script !== null) {
      this.drop(e.script);
      e.script = null;
    }

    e.destroy();
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
      // Score side-effects piggyback on the same 60Hz tick so they stay
      // locked to simulation time, not wall-clock. The alive-tick adds
      // 1 × mult every ALIVE_TICK_FRAMES while the run is unpaused.
      // Score side-effects are gated on the post-tutorial flag —
      // nothing accrues while the intro is teaching the player to
      // dodge / bomb / fire. The alive-tick has an extra gate on
      // `survivalActive` so inter-stage breathers can pause survival
      // accrual without freezing kills / drops.
      if (this.scoringActive) {
        if (this.survivalActive) {
          this.aliveTickAccum += 1;
          if (this.aliveTickAccum >= ALIVE_TICK_FRAMES) {
            this.aliveTickAccum = 0;
            recordAliveTick(this.score);
          }
        }
        // Retry-sample the wave-end multiplier drops queued by
        // scheduleMultDrop. Gated by the same paused early-return so a
        // dialogue mid-wave doesn't burn the per-pending-drop timeout.
        this.resolvePendingDrops();
      }
    }

    // Multiplier-drop magnet trigger: player must be in the top 40% of
    // the playfield to vacuum drops. Inverted from the safe-bottom
    // pattern — risk should be where the bullets are. See
    // src/docs/scoring-system.md → "Magnet zone".
    const magnetActive = this.player.y < GAME_H * MAGNET_THRESHOLD_FRAC;
    const playerX = this.player.x;
    const playerY = this.player.y;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e) continue;

      if (!e.alive) {
        this.release(e, i);
        continue;
      }

      e.updateAnim();

      // Magnet pull on drops while the player is in the magnet zone.
      // Vector from drop → player, normalised, scaled by MAGNET_SPEED;
      // overlap handler fires when contact lands so no extra hysteresis
      // is needed.
      if (magnetActive && e.kind instanceof MultDropKind) {
        const dx = playerX - e.x;
        const dy = playerY - e.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) e.body.setVelocity((dx / d) * MAGNET_SPEED, (dy / d) * MAGNET_SPEED);
      }

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
