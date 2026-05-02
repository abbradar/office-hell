import type { Entity } from '../entities/Entity';

export type EntityScript = (self: Entity) => Generator<number, void, void>;

export const DAMAGE_CLASSES = ['player', 'enemy'] as const;
export type DamageClass = typeof DAMAGE_CLASSES[number];

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
    if (self.hp <= 0) self.die();
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
};
