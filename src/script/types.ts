import type { Entity } from '../entities/Entity';
import type { DialogueOpts } from '../ui/dialogue';

// Every object-form yield a script can emit. Each carries an optional
// `yieldReason` (added uniformly via the intersection in `ScriptYield`)
// that surfaces in the debug HUD when a script with `debugYieldReasons`
// is parked on this yield. Use `withYieldReason` to stamp every yield
// emitted by a generator.
export type ObjectScriptYield =
  // Wait `physicsFrames` simulated physics ticks. Driven by Phaser's
  // WORLD_STEP event, so it auto-pauses when arcade physics is paused —
  // dialogue freezes, ESC pause, the intro tutorial's `physics.pause()`.
  // This is the default for bare-number yields (`yield N`) because most
  // game-logic timing — bullet cadence, enemy entry, hit-pause beats —
  // wants to halt with the simulation. Carries an optional yieldReason
  // that bare numbers can't.
  | { physicsFrames: number }
  // Wait `scriptFrames` scene-update ticks. Driven by StageManager's own
  // 60Hz accumulator, independent of physics pause — use this when the
  // wait is polling external state that keeps changing while physics is
  // frozen. Two such cases today: tutorial prompts polling input keys
  // during a `physics.pause()`-only freeze, and `awaitMusicTicking`
  // polling the music loop's start time while a dialogue cutscene is
  // up. Default yields should NOT use this — pick it deliberately.
  | { scriptFrames: number }
  | { until: Entity }
  | { dialogue: DialogueOpts }
  // Wait for the currently-playing track's natural completion (one-shot
  // `complete` event). Resolves immediately when no track is playing or
  // the active track has already finished. Loop tracks never complete
  // and should not yield this — use `waitTrackEnded` which routes loops
  // through a polling boundary computation instead.
  | { untilMusicEnds: true }
  // Wait until the active track's clock reaches `untilMusicTime` (seconds,
  // measured from the track's start). Scheduled via
  // `scene.time.delayedCall` against the current music-clock delta — the
  // wakeup is wall-clock based, not gated by either pause flag, so it
  // stays in step with the music through dialogue / freeze (music keeps
  // playing through those). The fire callback re-reads the music clock
  // and reschedules if the music drifted behind (e.g. ESC pause shifted
  // its clock backwards mid-wait); typical case fires once. Resolves
  // immediately when no track is playing — callers that need to wait for
  // music to come up should gate on `awaitMusicTicking` first.
  | { untilMusicTime: number }
  // Race several sub-generators in parallel; the first one to finish
  // wins, the rest are cancelled via the engine's drop mechanism, and
  // the parent resumes. An empty array resolves on the next frame.
  // Pure cancellation — no result channel; callers infer the outcome
  // from world state. Children can yield any `ScriptYield` (nested
  // race / all included).
  | { race: Array<Generator<ScriptYield, void, void>> }
  // Run several sub-generators in parallel; resume the parent only
  // after every one of them has finished. Each child can yield any
  // `ScriptYield` (including nested race / all), and an empty array
  // resolves on the next frame. Pure join — no result channel;
  // children share the parent's entity and communicate via world state.
  | { all: Array<Generator<ScriptYield, void, void>> };

export type ScriptYield = number | (ObjectScriptYield & { yieldReason?: string });

export type EntityScript = (self: Entity) => Generator<ScriptYield, void, void>;

export const DAMAGE_CLASSES = ['player', 'enemy'] as const;
export type DamageClass = (typeof DAMAGE_CLASSES)[number];

// Hitbox shape — circles are the default and what every legacy kind uses;
// squares are for chunky letter-shaped bullets where a circle would either
// underclaim the corners or stick out past flat edges. In both cases the
// `hitboxRadius` is the half-extent: a circle's radius, or half the square's
// side length.
export type HitboxShape = 'circle' | 'square';

export type EntityKindOpts = {
  sprite: string | null;
  hitboxRadius: number;
  hitboxShape?: HitboxShape;
  hp: number | null;
  damageClass: DamageClass[];
  damagedByClass: DamageClass[];
  defaultScript?: EntityScript;
};

export class EntityKind {
  readonly sprite: string | null;
  readonly hitboxRadius: number;
  readonly hitboxShape: HitboxShape;
  readonly hp: number | null;
  readonly damageClass: DamageClass[];
  readonly damagedByClass: DamageClass[];
  readonly defaultScript?: EntityScript;

  constructor(opts: EntityKindOpts) {
    this.sprite = opts.sprite;
    this.hitboxRadius = opts.hitboxRadius;
    this.hitboxShape = opts.hitboxShape ?? 'circle';
    this.hp = opts.hp;
    this.damageClass = opts.damageClass;
    this.damagedByClass = opts.damagedByClass;
    this.defaultScript = opts.defaultScript;
  }

  targetCollision(self: Entity, target: Entity): void {
    target.takeDamage(1);
    if (self.hp === null) self.die();
  }

  takeDamage(self: Entity, amount: number): void {
    if (self.hp === null) return;
    self.hp -= amount;
    if (self.hp <= 0) {
      self.die();
    } else {
      // Non-killing hit: pop a quick red flash + shake so the player sees
      // the damage register. Skipped on the killing blow because the
      // entity is removed from the active list within the same frame and
      // any flash would never paint.
      self.flashDamage();
    }
  }
}

export const INERT_KIND = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  hp: null,
  damageClass: [],
  damagedByClass: [],
});

export type SpawnOpts = {
  // Override the kind's `defaultScript`. Pass a generator to run that
  // instead, or `null` to spawn the entity with no script at all (useful
  // when the outer script wants to drive the entity itself). Omit to
  // accept the kind's default.
  script?: EntityScript | null;
  // Override the kind's damagedByClass for this individual spawn — e.g. to make
  // a boss unhittable during its intro and then re-enable damage after dialogue.
  damagedByClass?: DamageClass[];
  // Override the kind's starting HP for this individual spawn — useful when one
  // of a kind needs to outlast its peers (e.g. a "lead" enemy that has to
  // survive long enough to deliver its solo intro).
  hp?: number;
  // When true, each leaf yield of this script (and any raced child) writes
  // a description to `manager.lastYieldReason` so the HUD can show what
  // the script is currently parked on. Used by the stage script.
  debugYieldReasons?: boolean;
};
