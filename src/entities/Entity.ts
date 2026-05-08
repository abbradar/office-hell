import Phaser from 'phaser';
import { characterAnimKey, type Direction, directionFromVelocity } from '../content/animations';
import type { GameScene } from '../scenes/GameScene';
import type { SceneScript, StageManager } from '../script/StageManager';
import { type DamageClass, type EntityKind, INERT_KIND, type ScriptYield, type SpawnOpts } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';

// Below this speed (px/sec) we treat the entity as standing still and switch
// to the idle animation. moveTo and the boss script call setVelocity(0, 0)
// exactly, so the threshold mainly guards against floating-point drift.
const ANIM_MOVE_THRESHOLD = 1;

export class Entity extends Phaser.Physics.Arcade.Sprite {
  // Phaser typings flag body as Body | StaticBody | null because GameObject
  // covers every kind of sprite. Every Entity is constructed via
  // physics.add.existing with a dynamic Arcade body and that body is never
  // destroyed for the lifetime of the entity, so we can narrow it here and
  // skip the `as Phaser.Physics.Arcade.Body` cast at every call site.
  declare body: Phaser.Physics.Arcade.Body;
  // Every entity in this codebase is constructed inside GameScene (StageManager
  // is created there and is the only `spawn` caller), so narrow the inherited
  // Phaser.Scene typing to GameScene — call sites can reach scene-specific
  // methods (consumeBombPress) without casts.
  declare scene: GameScene;

  stage!: StageManager;
  kind: EntityKind = INERT_KIND;
  hp: number | null = null;
  alive = false;
  // The script currently driving this entity (top of any race tree).
  // Set by `spawn` / `runScript`, cleared on `release`. Used so the
  // engine can disable the script (set generation to null) when the
  // entity is released or the script is replaced — pending wakeups
  // then silently expire on the generation check.
  script: SceneScript | null = null;
  // Bumped on every spawn so deferred callbacks (e.g. onDeath) can detect
  // that the entity they captured has since died and been reused for something else.
  gen = 0;
  onDeathQueue: (() => void)[] | null = null;
  hasEnteredScreen = false;
  // Live damagedBy membership — initialised at spawn from kind or SpawnOpts override,
  // mutable at runtime via setDamagedByClasses (e.g. to make a boss hittable post-intro).
  activeDamagedBy: DamageClass[] = [];
  // Last direction we picked for this entity. Persists across stop/start so a
  // running enemy that pauses keeps facing the way it was going instead of
  // snapping back to a default. Reset on spawn to match the initial velocity.
  facing: Direction = 'down';
  // Per-entity scratchpad for kind-specific flags (e.g. boss phase markers).
  // Reset to null on spawn so pooled entities don't inherit state from a
  // previous life. Kinds should write to `vars ??= {}` when they need a slot
  // and read with optional chaining. Named `vars` rather than `state` because
  // Phaser's GameObject already owns `state: string | number`.
  vars: Record<string, unknown> | null = null;

  setMotion(angleRad: number, speed: number): void {
    this.setVelocity(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);
  }

  setDirection(angleRad: number): void {
    const body = this.body;
    const cur = Math.hypot(body.velocity.x, body.velocity.y);
    body.setVelocity(Math.cos(angleRad) * cur, Math.sin(angleRad) * cur);
  }

  setSpeed(speed: number): void {
    const v = this.body.velocity;
    const cur = Math.hypot(v.x, v.y);
    if (cur < 1e-6) return;
    this.body.setVelocity((v.x / cur) * speed, (v.y / cur) * speed);
  }

  angleToPlayer(): number {
    const p = this.stage.player;
    return Math.atan2(p.y - this.y, p.x - this.x);
  }

  // Unit vector from self to the player, optionally scaled by `length`
  // (so callers can use it directly as a velocity).
  vectorToPlayer(length = 1): [number, number] {
    const a = this.angleToPlayer();
    return [Math.cos(a) * length, Math.sin(a) * length];
  }

  spawn(kind: EntityKind, x: number, y: number, vx: number, vy: number, opts?: SpawnOpts): Entity {
    return this.stage.spawn(kind, x, y, vx, vy, opts);
  }

  say(text: string, frames: number): void {
    this.stage.bubbles.show(this, text, frames);
  }

  dialogue(opts: DialogueOpts): ScriptYield {
    return { dialogue: opts };
  }

  onDeath(cb: () => void): void {
    this.onDeathQueue ??= [];
    this.onDeathQueue.push(cb);
  }

  setDamagedByClasses(classes: DamageClass[]): void {
    const cur = this.activeDamagedBy;
    // Group.add() runs a createCallback that resets body properties (velocity,
    // gravity, etc.) — snapshot velocity and restore after the membership churn.
    const vx = this.body.velocity.x;
    const vy = this.body.velocity.y;
    for (const c of cur) {
      if (!classes.includes(c)) this.stage.damagedBy[c].remove(this);
    }
    for (const c of classes) {
      if (!cur.includes(c)) this.stage.damagedBy[c].add(this);
    }
    this.activeDamagedBy = classes.slice();
    this.body.setVelocity(vx, vy);
  }

  die(): void {
    this.alive = false;
    this.body.enable = false;
    // Reset transient render state so the next pool reuse starts clean —
    // no lingering red tint, shifted origin from a mid-flash death, or
    // sprite rotation from a previous kind that aimed itself at the player.
    this.clearTint();
    this.setOrigin(0.5, 0.5);
    this.setRotation(0);
    const cbs = this.onDeathQueue;
    if (cbs) for (const cb of cbs) cb();
  }

  takeDamage(amount: number): void {
    this.kind.takeDamage(this, amount);
  }

  // Visual hit feedback: ~250ms red tint + a small horizontal shake. Called
  // from EntityKind.takeDamage on non-killing hits. The shake is rendered
  // via origin offset (origin is render-only, so the body keeps its real
  // position — no physics interaction). Both effects gate on alive + gen
  // so an entity that dies or gets re-spawned mid-flash doesn't stomp the
  // new state.
  // Pick the run/idle animation to play this frame. Default rule: run when
  // moving, idle when stopped, direction inferred from current velocity.
  // Bullets and other static-texture entities have no character anims
  // registered for their sprite key, so the existence probe bails them out.
  // Player overrides this to factor in whether enemies are on screen.
  updateAnim(): void {
    const sheet = this.kind.sprite;
    if (sheet === null) return;
    if (!this.scene.anims.exists(characterAnimKey(sheet, 'idle', 'down'))) return;
    // Anim freeze is driven by StageManager's physics PAUSE/RESUME hooks; bail
    // here so a switch to a new key (run↔idle) during pause doesn't `play()`
    // and unpause the sprite.
    if (this.scene.physics.world.isPaused) return;
    const v = this.body.velocity;
    const moving = Math.hypot(v.x, v.y) > ANIM_MOVE_THRESHOLD;
    if (moving) this.facing = directionFromVelocity(v.x, v.y);
    const key = characterAnimKey(sheet, moving ? 'run' : 'idle', this.facing);
    if (this.anims.currentAnim?.key !== key) this.play(key);
  }

  flashDamage(): void {
    if (!this.alive || this.kind.sprite === null) return;
    const myGen = this.gen;

    this.setTint(0xff5555);
    this.scene.time.delayedCall(250, () => {
      if (this.alive && this.gen === myGen) this.clearTint();
    });

    // Damped horizontal shake — six steps over ~210ms, amplitudes shrinking
    // to 0 so the sprite settles back on centre. Origin is a fraction of
    // width; converting from a target pixel offset keeps the shake size
    // consistent across enemy sprite sizes.
    const stepMs = 35;
    const px = [3, -3, 2, -2, 1, 0];
    for (let i = 0; i < px.length; i++) {
      this.scene.time.delayedCall(i * stepMs, () => {
        if (!this.alive || this.gen !== myGen) return;
        // biome-ignore lint/style/noNonNullAssertion: index bounded by px.length
        this.setOrigin(0.5 + px[i]! / this.width, 0.5);
      });
    }
  }
}
