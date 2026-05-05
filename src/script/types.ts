import type { Entity } from '../entities/Entity';
import type { DialogueOpts } from '../ui/dialogue';

// Every object-form yield a script can emit. Each carries an optional
// `yieldReason` (added uniformly via the intersection in `ScriptYield`)
// that surfaces in the debug HUD when a script with `debugYieldReasons`
// is parked on this yield. Use `withYieldReason` to stamp every yield
// emitted by a generator.
export type ObjectScriptYield =
  // Wait `frames` script frames. Equivalent to a bare number yield, but
  // can carry a yieldReason — bare numbers have nowhere to hang one.
  | { frames: number }
  | { until: Entity }
  | { dialogue: DialogueOpts }
  // Wait for the currently-playing track's natural completion (one-shot
  // `complete` event). Resolves immediately when no track is playing or
  // the active track has already finished. Loop tracks never complete
  // and should not yield this — use `waitTrackEnded` which routes loops
  // through a polling boundary computation instead.
  | { untilMusicEnds: true }
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

export type EntityKindOpts = {
  sprite: string | null;
  hitboxRadius: number;
  hp: number | null;
  damageClass: DamageClass[];
  damagedByClass: DamageClass[];
  defaultScript?: EntityScript;
};

export class EntityKind {
  readonly sprite: string | null;
  readonly hitboxRadius: number;
  readonly hp: number | null;
  readonly damageClass: DamageClass[];
  readonly damagedByClass: DamageClass[];
  readonly defaultScript?: EntityScript;

  constructor(opts: EntityKindOpts) {
    this.sprite = opts.sprite;
    this.hitboxRadius = opts.hitboxRadius;
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
