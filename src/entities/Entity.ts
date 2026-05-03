import Phaser from 'phaser';
import { type DamageClass, type EntityKind, INERT_KIND, type ScriptYield, type SpawnOpts } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import type { EntityPool } from './EntityPool';

export class Entity extends Phaser.Physics.Arcade.Sprite {
  // Phaser typings flag body as Body | StaticBody | null because GameObject
  // covers every kind of sprite. Every Entity is constructed via
  // physics.add.existing with a dynamic Arcade body and that body is never
  // destroyed for the lifetime of the entity, so we can narrow it here and
  // skip the `as Phaser.Physics.Arcade.Body` cast at every call site.
  declare body: Phaser.Physics.Arcade.Body;

  pool!: EntityPool;
  kind: EntityKind = INERT_KIND;
  hp: number | null = null;
  alive = false;
  // Bumped on every spawn so deferred callbacks (e.g. onDeath) can detect
  // that the entity they captured has since died and been reused for something else.
  gen = 0;
  onDeathQueue: (() => void)[] | null = null;
  hasEnteredScreen = false;
  // Live damagedBy membership — initialised at spawn from kind or SpawnOpts override,
  // mutable at runtime via setDamagedByClasses (e.g. to make a boss hittable post-intro).
  activeDamagedBy: DamageClass[] = [];

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
    const p = this.pool.player;
    return Math.atan2(p.y - this.y, p.x - this.x);
  }

  spawn(kind: EntityKind, x: number, y: number, vx: number, vy: number, opts?: SpawnOpts): Entity {
    return this.pool.spawn(kind, x, y, vx, vy, opts);
  }

  say(text: string, frames: number): void {
    this.pool.bubbles.show(this, text, frames);
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
      if (!classes.includes(c)) this.pool.damagedBy[c].remove(this);
    }
    for (const c of classes) {
      if (!cur.includes(c)) this.pool.damagedBy[c].add(this);
    }
    this.activeDamagedBy = classes.slice();
    this.body.setVelocity(vx, vy);
  }

  die(): void {
    this.alive = false;
    this.body.enable = false;
    // Reset hit-feedback state so the next pool reuse starts clean — no
    // lingering red tint or shifted origin from a mid-flash death.
    this.clearTint();
    this.setOrigin(0.5, 0.5);
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
