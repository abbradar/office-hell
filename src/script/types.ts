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
  // Wait `realSeconds` of wall-clock time. Scheduled via
  // `scene.time.delayedCall`; not gated by either pause flag, so it
  // keeps ticking through dialogue / freeze (which freeze the script
  // and physics queues but leave the scene clock alone). One-shot —
  // music-time alignment is handled in stage helpers
  // (`waitAudioTimeAtLeast`, `waitTrackEnded`), which compute the gap
  // to a target music timestamp, yield this primitive for the
  // wall-clock portion, and loop on wakeup if the music clock drifted
  // behind (e.g. ESC pause shifted it).
  | { realSeconds: number }
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
  // Damage classes the entity *deals* to anything in `damages[c]`. Both
  // sides default to `[]` so bullet definitions can omit `damagedByClass`
  // and inert stage controllers can omit both. Subclasses with stricter
  // requirements (e.g. `EnemyBulletEntityKind`) validate at construction.
  damageClass?: DamageClass[];
  damagedByClass?: DamageClass[];
  defaultScript?: EntityScript;
  // Optional generator that runs in place of `die()` when HP hits 0. The
  // default `takeDamage` (on `HPEntityKind`) locks incoming damage off
  // (so a stray hit a frame later can't re-fire the script) and hands
  // the entity to `runScript`. The script itself is responsible for
  // eventually calling `self.die()` — typically after a flicker /
  // dialogue / shudder beat. Used by every boss for its own defeat
  // sequence; null on plain entities that just disappear on death.
  // Ignored on bare `EntityKind` (no HP → never reaches the death path).
  deathScript?: EntityScript;
};

// Base per-spawn options, supported by every kind. Concrete kinds widen
// this via the generic `TOpts` parameter on `EntityKind` to advertise
// extra fields they honour at spawn time (e.g. `HPEntityKind` adds
// `hp`). `StageManager.spawn` is generic over the kind so the opts
// argument is typed against the actual kind's `TOpts` — passing a
// kind-specific field to a kind that doesn't accept it is a type error
// at the call site rather than silently ignored.
export type SpawnOpts = {
  // Override the kind's `defaultScript`. Pass a generator to run that
  // instead, or `null` to spawn the entity with no script at all (useful
  // when the outer script wants to drive the entity itself). Omit to
  // accept the kind's default.
  script?: EntityScript | null;
  // Override the kind's damagedByClass for this individual spawn — e.g. to make
  // a boss unhittable during its intro and then re-enable damage after dialogue.
  damagedByClass?: DamageClass[];
  // When true, each leaf yield of this script (and any raced child) writes
  // a description to `manager.lastYieldReason` so the HUD can show what
  // the script is currently parked on. Used by the stage script.
  debugYieldReasons?: boolean;
};

// Base entity kind — no HP, can't be damaged. The default `takeDamage`
// throws, so anything in a `damagedBy` group must be an `HPEntityKind`
// (the engine routes damage through `takeDamage`). `targetCollision`
// damages the target and dies — the bullet behaviour, since bullets
// and other one-shot projectiles are the canonical no-HP kind.
//
// Use this directly for inert kinds (the stage controller, ambient
// props) and for bullets / beams that should consume on impact.
//
// `TOpts` is the per-spawn options shape this kind accepts. Subclasses
// fix it to a wider type by extending the parameterised base directly
// (e.g. `class HPEntityKind extends EntityKind<HPSpawnOpts>`); call
// sites of `StageManager.spawn` are typed against the kind's TOpts so
// passing a kind-specific field to a kind that doesn't accept it is a
// type error at the call site rather than silently ignored.
export class EntityKind<TOpts = SpawnOpts> {
  readonly sprite: string | null;
  readonly hitboxRadius: number;
  readonly hitboxShape: HitboxShape;
  readonly damageClass: DamageClass[];
  readonly damagedByClass: DamageClass[];
  readonly defaultScript?: EntityScript;
  readonly deathScript: EntityScript | null;

  constructor(opts: EntityKindOpts) {
    this.sprite = opts.sprite;
    this.hitboxRadius = opts.hitboxRadius;
    this.hitboxShape = opts.hitboxShape ?? 'circle';
    this.damageClass = opts.damageClass ?? [];
    this.damagedByClass = opts.damagedByClass ?? [];
    this.defaultScript = opts.defaultScript;
    this.deathScript = opts.deathScript ?? null;
  }

  // Per-kind initialisation hook. Runs once per spawn, after the
  // engine has reset the entity's per-life state (vars, body) but
  // before its defaultScript starts. `opts` is the (typed) spawn
  // options the caller passed, so a kind can honour per-spawn
  // overrides — e.g. `HPEntityKind` reads `opts.hp ?? this.hp` to let
  // one kind spawn at varying HPs (the lead HR in `hrTrio`). Default
  // is empty; subclasses override to seed kind-specific state
  // (`HPEntityKind` primes `vars.hp`, `PhasedBossKind` adds
  // `vars.phaseIdx`). Called regardless of whether a script will
  // actually run — `spawn` does not skip init when `opts.script: null`
  // is passed, so initialiser side-effects are stable for callers that
  // drive an entity manually.
  init(_self: Entity, _opts: TOpts): void {}

  // Bullet behaviour — damage the target and die. HP-bearing kinds
  // override to stay alive after the hit.
  targetCollision(self: Entity, target: Entity): void {
    target.takeDamage(1);
    self.die();
  }

  takeDamage(_self: Entity, _amount: number): void {
    throw new Error(
      `takeDamage called on no-HP kind (sprite=${this.sprite}); use HPEntityKind for damageable entities`,
    );
  }
}

// Shape of the per-entity vars slot owned by `HPEntityKind`. Cast
// `self.vars` to this when reading/writing hp on an entity whose kind
// is known to be `HPEntityKind` (or a subclass). Subclasses with more
// vars (e.g. PhasedBossKind's `phaseIdx`/`phaseDown`) intersect with
// this shape rather than redefine it.
export type HPVars = { hp: number };

// Spawn opts for HP-bearing kinds. Adds an optional per-spawn HP
// override; without it, the entity starts at the kind's declared `hp`.
// One kind can therefore back instances at varying HPs (the lead HR in
// `hrTrio` reuses the regular `hr` kind and just spawns with `opts.hp =
// LEAD_HP`) without needing a parallel kind definition.
export type HPSpawnOpts = SpawnOpts & { hp?: number };

// Entity kind with an HP pool. HP is stored on the spawned entity at
// `self.vars.hp` (typed as `HPVars`) — `init` seeds it from the kind's
// `hp` value (or the per-spawn `opts.hp` override), and `takeDamage`
// decrements it, flashing on non-killing hits and routing to
// `deathScript` (or `die`) when the pool hits zero.
export type HPEntityKindOpts = EntityKindOpts & { hp: number };

export class HPEntityKind extends EntityKind<HPSpawnOpts> {
  readonly hp: number;

  constructor(opts: HPEntityKindOpts) {
    super(opts);
    this.hp = opts.hp;
  }

  override init(self: Entity, opts: HPSpawnOpts): void {
    super.init(self, opts);
    self.vars = { ...(self.vars ?? {}), hp: opts.hp ?? this.hp } as HPVars;
  }

  // Don't die on dealing damage — HP-bearing kinds survive contact.
  override targetCollision(_self: Entity, target: Entity): void {
    target.takeDamage(1);
  }

  override takeDamage(self: Entity, amount: number): void {
    if (self.vars === null) {
      throw new Error(`HPEntityKind.takeDamage: vars not seeded for sprite=${this.sprite}`);
    }
    const vars = self.vars as HPVars;
    const next = vars.hp - amount;
    if (next <= 0) {
      vars.hp = 0;
      // Count enemy kills for the run-wide score. Guarded against the player
      // (PlayerKind.takeDamage routes through super) — counting the player's
      // own death would overlap with `hpLost` and skew the inter-stage quips.
      if (self !== self.stage.player) self.stage.score.kills++;
      if (this.deathScript !== null) {
        // Lock incoming damage off so a stray bullet that lands a frame
        // later can't re-enter takeDamage and double-fire the death
        // script (runScript would just drop the already-running one and
        // restart it, but any side-effects in the script's first body —
        // SFX, music halt — would play twice).
        self.setDamagedByClasses([]);
        self.stage.runScript(self, this.deathScript);
      } else {
        self.die();
      }
    } else {
      vars.hp = next;
      // Non-killing hit: pop a quick red flash + shake so the player sees
      // the damage register. Skipped on the killing blow because the
      // entity is removed from the active list within the same frame and
      // any flash would never paint.
      self.flashDamage();
    }
  }
}

// Marker subclass for projectile kinds that damage the player —
// bullets, reports, question marks, pills, beam cells, etc. Behaves
// identically to `EntityKind` (no HP, dies on impact via the inherited
// `targetCollision`); the only purpose of the subclass is to make
// "find every enemy bullet in flight" a single `instanceof` check for
// bombs and `clearBullets`. Forces `damageClass = ['player']` (callers
// don't repeat it) and inherits the default empty `damagedByClass`
// (bullets are never themselves damageable).
export class EnemyBulletEntityKind extends EntityKind {
  constructor(opts: Omit<EntityKindOpts, 'damageClass'>) {
    super({ ...opts, damageClass: ['player'] });
  }
}

export const INERT_KIND = new EntityKind({
  sprite: null,
  hitboxRadius: 0,
  damageClass: [],
  damagedByClass: [],
});
