import type { Entity } from '../entities/Entity';

export type EntityScript = (self: Entity) => Generator<number, void, void>;

export type EntityKind = {
  texture: string;
  hitboxRadius: number;
  hp: number | null;
  hostile: boolean;
  invisible?: boolean;
  defaultScript?: EntityScript;
};

export type SpawnOpts = {
  vx?: number;
  vy?: number;
  angle?: number;
  speed?: number;
  script?: EntityScript;
};
