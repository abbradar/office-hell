import Phaser from 'phaser';
import { GAME_W, GAME_H, ENTITY_POOL_SIZE, CULL_MARGIN } from '../config';
import { Entity } from './Entity';
import type { EntityKind, SpawnOpts, DamageClass } from '../script/types';
import { DAMAGE_CLASSES, INERT_KIND } from '../script/types';

type ClassGroups = Record<DamageClass, Phaser.Physics.Arcade.Group>;

export class EntityPool {
  readonly scene: Phaser.Scene;
  readonly damages: ClassGroups;
  readonly damagedBy: ClassGroups;
  readonly player = { x: 0, y: 0 };

  private readonly free: Entity[] = [];
  private readonly active: Entity[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const makeGroups = (): ClassGroups => {
      const out = {} as ClassGroups;
      for (const c of DAMAGE_CLASSES) {
        // allowGravity must be set here: the group's createCallback resets
        // body properties to these defaults every time a child is added,
        // including allowGravity and velocity.
        out[c] = scene.physics.add.group({
          runChildUpdate: false,
          allowGravity: false,
        });
      }
      return out;
    };
    this.damages = makeGroups();
    this.damagedBy = makeGroups();

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

  spawn(
    kind: EntityKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts: SpawnOpts = {},
  ): Entity | null {
    const e = this.free.pop();
    if (!e) return null;

    e.kind = kind;
    e.hp = kind.hp;
    e.alive = true;
    e.hasEnteredScreen = false;
    e.waitFrames = 0;

    if (kind.sprite !== null) {
      e.setTexture(kind.sprite);
      e.setVisible(true);
      if (kind.animKey) {
        e.play(kind.animKey);
      } else {
        e.anims.stop();
      }
    } else {
      e.setVisible(false);
      e.anims.stop();
    }
    e.setActive(true);

    // Group.add() runs a createCallback that overwrites body properties
    // (velocity, drag, gravity, etc.) with the group's defaults, so we
    // must add to groups BEFORE configuring the body.
    for (const c of kind.damageClass) this.damages[c].add(e);
    for (const c of kind.damagedByClass) this.damagedBy[c].add(e);

    const body = e.body as Phaser.Physics.Arcade.Body;
    if (kind.hitboxRadius > 0) {
      body.enable = true;
      body.setCircle(
        kind.hitboxRadius,
        e.width / 2 - kind.hitboxRadius,
        e.height / 2 - kind.hitboxRadius,
      );
      body.reset(x, y);
      body.setVelocity(vx, vy);
    } else {
      e.setPosition(x, y);
      body.enable = false;
    }

    const script = opts.script ?? kind.defaultScript ?? null;
    e.scriptIter = script ? script(e) : null;

    this.active.push(e);
    return e;
  }

  private release(e: Entity, indexInActive: number): void {
    const last = this.active.length - 1;
    if (indexInActive !== last) this.active[indexInActive] = this.active[last]!;
    this.active.pop();

    for (const c of e.kind.damageClass) this.damages[c].remove(e);
    for (const c of e.kind.damagedByClass) this.damagedBy[c].remove(e);

    e.alive = false;
    e.scriptIter = null;
    e.kind = INERT_KIND;
    e.hp = null;
    e.setActive(false).setVisible(false);
    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.enable = false;
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
