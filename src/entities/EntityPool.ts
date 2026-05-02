import Phaser from 'phaser';
import { GAME_W, GAME_H, ENTITY_POOL_SIZE, CULL_MARGIN } from '../config';
import { Entity } from './Entity';
import type { EntityKind, SpawnOpts } from '../script/types';

export class EntityPool {
  readonly scene: Phaser.Scene;
  readonly hostileGroup: Phaser.Physics.Arcade.Group;
  readonly targetGroup: Phaser.Physics.Arcade.Group;
  readonly player = { x: 0, y: 0 };

  private readonly free: Entity[] = [];
  private readonly active: Entity[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.hostileGroup = scene.physics.add.group({ runChildUpdate: false });
    this.targetGroup = scene.physics.add.group({ runChildUpdate: false });

    for (let i = 0; i < ENTITY_POOL_SIZE; i++) {
      const e = new Entity(scene, 0, 0, 'bullet');
      e.pool = this;
      scene.add.existing(e);
      scene.physics.add.existing(e);
      e.setActive(false).setVisible(false);
      const body = e.body as Phaser.Physics.Arcade.Body;
      body.enable = false;
      body.setAllowGravity(false);
      this.free.push(e);
    }
  }

  spawn(kind: EntityKind, x: number, y: number, opts: SpawnOpts = {}): Entity | null {
    const e = this.free.pop();
    if (!e) return null;

    e.kind = kind;
    e.hp = kind.hp;
    e.alive = true;
    e.hasEnteredScreen = false;
    e.waitFrames = 0;
    e.setTexture(kind.texture);
    e.setPosition(x, y);
    e.setActive(true).setVisible(!kind.invisible);

    const body = e.body as Phaser.Physics.Arcade.Body;
    if (kind.hitboxRadius > 0) {
      body.enable = true;
      body.setCircle(
        kind.hitboxRadius,
        e.width / 2 - kind.hitboxRadius,
        e.height / 2 - kind.hitboxRadius,
      );
      if (opts.vx !== undefined || opts.vy !== undefined) {
        body.setVelocity(opts.vx ?? 0, opts.vy ?? 0);
      } else if (opts.angle !== undefined) {
        const speed = opts.speed ?? 0;
        body.setVelocity(Math.cos(opts.angle) * speed, Math.sin(opts.angle) * speed);
      } else {
        body.setVelocity(0, 0);
      }
    } else {
      body.enable = false;
    }

    if (kind.hostile) this.hostileGroup.add(e);
    if (kind.hp !== null) this.targetGroup.add(e);

    const script = opts.script ?? kind.defaultScript ?? null;
    e.scriptIter = script ? script(e) : null;

    this.active.push(e);
    return e;
  }

  private release(e: Entity, indexInActive: number): void {
    const last = this.active.length - 1;
    if (indexInActive !== last) this.active[indexInActive] = this.active[last]!;
    this.active.pop();

    e.alive = false;
    e.scriptIter = null;
    e.kind = null;
    e.hp = null;
    e.setActive(false).setVisible(false);
    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.hostileGroup.remove(e);
    this.targetGroup.remove(e);
    this.free.push(e);
  }

  update(_time: number, _delta: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e) continue;

      if (!e.alive) {
        this.release(e, i);
        continue;
      }

      if (e.scriptIter) {
        if (e.waitFrames > 0) {
          e.waitFrames--;
        } else {
          const r = e.scriptIter.next();
          if (r.done) {
            e.scriptIter = null;
          } else {
            e.waitFrames = Math.max(0, (r.value as number) | 0);
          }
        }
        if (!e.alive) {
          this.release(e, i);
          continue;
        }
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
}
