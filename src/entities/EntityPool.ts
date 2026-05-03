import type Phaser from 'phaser';
import { CULL_MARGIN, ENTITY_POOL_SIZE, GAME_H, GAME_W } from '../config';
import type { DamageClass, EntityKind, ScriptYield, SpawnOpts } from '../script/types';
import { INERT_KIND } from '../script/types';
import { BubbleManager } from '../ui/bubbles';
import { DialogueManager, type DialogueOpts } from '../ui/dialogue';
import { Entity } from './Entity';
import type { Player } from './Player';

type ClassGroups = Record<DamageClass, Phaser.Physics.Arcade.Group>;

type ScriptIter = Generator<ScriptYield, void, void>;
type Wait = { framesLeft: number; entity: Entity; iter: ScriptIter };

export class EntityPool {
  readonly scene: Phaser.Scene;
  readonly damages: ClassGroups;
  readonly damagedBy: ClassGroups;
  readonly bubbles: BubbleManager;
  readonly dialogue: DialogueManager;
  // Live reference to the controllable player entity. Assigned by GameScene
  // immediately after the Player is constructed (which can't happen until the
  // pool exists). Pool construction → Player construction → assignment all
  // complete inside GameScene.create, so by the time any script runs (during
  // pool.update from GameScene.update) this is guaranteed to be set.
  player!: Player;
  paused = false;

  private readonly free: Entity[] = [];
  private readonly active: Entity[] = [];
  // Unsorted: each tick we walk the whole list, decrement, fire entries that hit zero.
  // At most one entry per entity (a script's only suspended on one thing at a time).
  private readonly waiting: Wait[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // allowGravity must be set here: the group's createCallback resets body
    // properties to these defaults every time a child is added, including
    // allowGravity and velocity.
    const groupConfig = { runChildUpdate: false, allowGravity: false };
    const makeGroups = (): ClassGroups => ({
      player: scene.physics.add.group(groupConfig),
      enemy: scene.physics.add.group(groupConfig),
    });
    this.damages = makeGroups();
    this.damagedBy = makeGroups();
    this.bubbles = new BubbleManager(scene);
    this.dialogue = new DialogueManager(scene);

    for (let i = 0; i < ENTITY_POOL_SIZE; i++) this.free.push(this.makeEntity());
  }

  private makeEntity(): Entity {
    const e = new Entity(this.scene, 0, 0, 'bullet');
    e.pool = this;
    this.scene.add.existing(e);
    this.scene.physics.add.existing(e);
    e.setActive(false).setVisible(false);
    const body = e.body;
    body.enable = false;
    body.setAllowGravity(false);
    return e;
  }

  spawn(kind: EntityKind, x: number, y: number, vx: number, vy: number, opts: SpawnOpts = {}): Entity {
    const e = this.free.pop() ?? this.makeEntity();

    e.kind = kind;
    e.hp = kind.hp;
    e.alive = true;
    e.gen++;
    e.hasEnteredScreen = false;
    e.onDeath = null;

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
    const damagedBy = opts.damagedByClass ?? kind.damagedByClass;
    e.activeDamagedBy = damagedBy;
    for (const c of damagedBy) this.damagedBy[c].add(e);

    const body = e.body;
    if (kind.hitboxRadius > 0) {
      body.enable = true;
      body.setCircle(kind.hitboxRadius, e.width / 2 - kind.hitboxRadius, e.height / 2 - kind.hitboxRadius);
      body.reset(x, y);
      body.setVelocity(vx, vy);
    } else {
      e.setPosition(x, y);
      body.enable = false;
    }

    const script = opts.script ?? kind.defaultScript ?? null;
    if (script) this.schedule(e, script(e), 1);

    this.active.push(e);
    return e;
  }

  private schedule(e: Entity, iter: ScriptIter, framesLeft: number): void {
    this.waiting.push({ framesLeft, entity: e, iter });
  }

  private advance(e: Entity, iter: ScriptIter): void {
    const r = iter.next();
    if (r.done) return;
    if (typeof r.value === 'number') {
      this.schedule(e, iter, Math.max(0, r.value | 0) + 1);
    } else if ('dialogue' in r.value) {
      this.beginDialogue(r.value.dialogue, e, iter);
    } else if (r.value.until.alive) {
      const gen = e.gen;
      r.value.until.onDeath ??= [];
      r.value.until.onDeath.push(() => {
        if (e.alive && e.gen === gen) this.schedule(e, iter, 1);
      });
    } else {
      this.schedule(e, iter, 1);
    }
  }

  private beginDialogue(opts: DialogueOpts, e: Entity, iter: ScriptIter): void {
    this.paused = true;
    this.scene.physics.pause();
    const gen = e.gen;
    this.dialogue.start(opts, () => {
      this.paused = false;
      this.scene.physics.resume();
      if (e.alive && e.gen === gen) this.schedule(e, iter, 1);
    });
  }

  private release(e: Entity, indexInActive: number): void {
    // If we're releasing a still-alive entity (e.g. culled off-screen), fire its
    // death callbacks so anything waiting via { until: e } unblocks rather than
    // hanging forever on a target that just silently vanished.
    if (e.alive) e.die();

    const last = this.active.length - 1;
    // biome-ignore lint/style/noNonNullAssertion: bounded by active.length - 1
    if (indexInActive !== last) this.active[indexInActive] = this.active[last]!;
    this.active.pop();

    for (const c of e.kind.damageClass) this.damages[c].remove(e);
    for (const c of e.activeDamagedBy) this.damagedBy[c].remove(e);

    // Drop a pending wait entry for this entity, so a stale iter can't fire on a reborn entity.
    for (let i = 0; i < this.waiting.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by waiting.length
      if (this.waiting[i]!.entity === e) {
        const lastW = this.waiting.length - 1;
        // biome-ignore lint/style/noNonNullAssertion: lastW is waiting.length - 1
        if (i !== lastW) this.waiting[i] = this.waiting[lastW]!;
        this.waiting.pop();
        break;
      }
    }

    e.alive = false;
    e.onDeath = null;
    e.kind = INERT_KIND;
    e.hp = null;
    e.setActive(false).setVisible(false);
    const body = e.body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.free.push(e);
  }

  update(time: number, _delta: number): void {
    this.dialogue.update(time);
    if (this.paused) return;
    this.bubbles.update();

    // Walk waiting once: decrement, keep entries that aren't due yet, fire those that are.
    // advance() may push fresh entries onto waiting (yield N → reschedule, {until} → onDeath
    // closure schedules later). Newly pushed entries land at indices >= originalLen, so the
    // read loop won't visit them. After the read loop, compact the appended tail down to fill
    // the gaps left by popped entries.
    const originalLen = this.waiting.length;
    let write = 0;
    for (let read = 0; read < originalLen; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by originalLen
      const w = this.waiting[read]!;
      w.framesLeft--;
      if (w.framesLeft > 0) {
        this.waiting[write++] = w;
      } else if (w.entity.alive) {
        this.advance(w.entity, w.iter);
      }
    }
    for (let read = originalLen; read < this.waiting.length; read++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by waiting.length
      this.waiting[write++] = this.waiting[read]!;
    }
    this.waiting.length = write;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e) continue;

      if (!e.alive) {
        this.release(e, i);
        continue;
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
