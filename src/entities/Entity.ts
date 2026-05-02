import Phaser from 'phaser';
import { type DamageClass, type EntityKind, INERT_KIND, type ScriptYield, type SpawnOpts } from '../script/types';
import type { DialogueOpts } from '../ui/dialogue';
import type { EntityPool } from './EntityPool';

export class Entity extends Phaser.Physics.Arcade.Sprite {
  pool!: EntityPool;
  kind: EntityKind = INERT_KIND;
  hp: number | null = null;
  alive = false;
  // Bumped on every spawn so deferred callbacks (e.g. onDeath) can detect
  // that the entity they captured has since died and been reused for something else.
  gen = 0;
  onDeath: (() => void)[] | null = null;
  hasEnteredScreen = false;
  // Live damagedBy membership — initialised at spawn from kind or SpawnOpts override,
  // mutable at runtime via setDamagedByClasses (e.g. to make a boss hittable post-intro).
  activeDamagedBy: DamageClass[] = [];

  setMotion(angleRad: number, speed: number): void {
    this.setVelocity(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);
  }

  setDirection(angleRad: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const cur = Math.hypot(body.velocity.x, body.velocity.y);
    body.setVelocity(Math.cos(angleRad) * cur, Math.sin(angleRad) * cur);
  }

  setSpeed(speed: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const v = body.velocity;
    const cur = Math.hypot(v.x, v.y);
    if (cur < 1e-6) return;
    body.setVelocity((v.x / cur) * speed, (v.y / cur) * speed);
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

  setDamagedByClasses(classes: DamageClass[]): void {
    const cur = this.activeDamagedBy;
    // Group.add() runs a createCallback that resets body properties (velocity,
    // gravity, etc.) — snapshot velocity and restore after the membership churn.
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    const vx = body?.velocity.x ?? 0;
    const vy = body?.velocity.y ?? 0;
    for (const c of cur) {
      if (!classes.includes(c)) this.pool.damagedBy[c].remove(this);
    }
    for (const c of classes) {
      if (!cur.includes(c)) this.pool.damagedBy[c].add(this);
    }
    this.activeDamagedBy = classes.slice();
    if (body) body.setVelocity(vx, vy);
  }

  die(): void {
    this.alive = false;
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
    const cbs = this.onDeath;
    this.onDeath = null;
    if (cbs) for (const cb of cbs) cb();
  }

  takeDamage(amount: number): void {
    this.kind.takeDamage(this, amount);
  }
}
