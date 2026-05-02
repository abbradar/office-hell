import Phaser from 'phaser';
import { EntityKind, INERT_KIND, type SpawnOpts } from '../script/types';
import type { EntityPool } from './EntityPool';

export class Entity extends Phaser.Physics.Arcade.Sprite {
  pool!: EntityPool;
  kind: EntityKind = INERT_KIND;
  hp: number | null = null;
  alive = false;
  scriptIter: Generator<number, void, void> | null = null;
  waitFrames = 0;
  hasEnteredScreen = false;

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

  spawn(
    kind: EntityKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts?: SpawnOpts,
  ): Entity | null {
    return this.pool.spawn(kind, x, y, vx, vy, opts);
  }

  die(): void {
    this.alive = false;
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
  }

  takeDamage(amount: number): void {
    this.kind.takeDamage(this, amount);
  }
}
