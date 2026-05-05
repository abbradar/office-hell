import type { Entity } from '../entities/Entity';
import type { DialogueOpts } from '../ui/dialogue';

// Yield kinds that don't open a sub-race. Used as the return type of a
// racing generator — a race's loss/wakeup trigger is computed by the
// inner and must itself be a leaf wait (no nested race) so the runner
// has a finite, recursion-free trigger to install on the parent.
export type NonRaceYield =
  | number
  | { until: Entity }
  | { dialogue: DialogueOpts }
  // Wait for the currently-playing track's natural completion (one-shot
  // `complete` event). Resolves immediately when no track is playing or
  // the active track has already finished. Loop tracks never complete
  // and should not yield this — use `waitTrackEnded` which routes loops
  // through a polling boundary computation instead.
  | { untilMusicEnds: true };

export type ScriptYield =
  | NonRaceYield
  // Race a sub-generator against a parent-side wait. `race` is the inner
  // generator (does its own work, yielding any ScriptYield); `trigger`
  // is a leaf wait installed on the parent in parallel. Whichever
  // resolves first wakes the parent; the loser is cancelled via the
  // engine's generation-bump mechanism. Pure cancellation — no result
  // channel; callers infer outcome from world state.
  | { race: Generator<ScriptYield, void, void>; trigger: NonRaceYield };

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
  script?: EntityScript;
  // Override the kind's damagedByClass for this individual spawn — e.g. to make
  // a boss unhittable during its intro and then re-enable damage after dialogue.
  damagedByClass?: DamageClass[];
  // Override the kind's starting HP for this individual spawn — useful when one
  // of a kind needs to outlast its peers (e.g. a "lead" enemy that has to
  // survive long enough to deliver its solo intro).
  hp?: number;
  // When true, each leaf yield of this script (and any raced child) writes
  // a description to `manager.lockDebug` so the HUD can show what the
  // script is currently parked on. Used by the stage script.
  debugLocks?: boolean;
};
