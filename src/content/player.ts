import type Phaser from 'phaser';
import { hit } from '../audio/sfx';
import { PLAYER_HITBOX_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import { EntityKind } from '../script/types';
import type { CharacterDef } from './characters';

export const PLAYER_HP = 2;
export const PLAYER_BOMBS = 3;

export type PlayerKindOpts = {
  hpText: Phaser.GameObjects.Text;
  practice?: boolean;
  character: CharacterDef;
};

export class PlayerKind extends EntityKind {
  readonly character: CharacterDef;
  private hpText: Phaser.GameObjects.Text;
  private practice: boolean;
  hits = 0;
  bombs = PLAYER_BOMBS;

  constructor(opts: PlayerKindOpts) {
    super({
      sprite: opts.character.sprite,
      animKey: 'player_walk',
      hitboxRadius: PLAYER_HITBOX_RADIUS,
      hp: PLAYER_HP,
      damageClass: [],
      damagedByClass: ['player'],
    });
    this.character = opts.character;
    this.hpText = opts.hpText;
    this.practice = opts.practice ?? false;
  }

  render(self: Entity): void {
    if (this.practice) {
      this.hpText.setText(`hits: ${this.hits}`);
    } else {
      const hearts = '♥'.repeat(Math.max(0, self.hp ?? 0));
      this.hpText.setText(`${hearts}\nexcuses: ${this.bombs}`);
    }
  }

  override takeDamage(self: Entity, amount: number): void {
    hit();
    if (this.practice) {
      this.hits++;
    } else {
      super.takeDamage(self, amount);
    }
    this.render(self);
  }

  // Returns true if a bomb was consumed. The Player asks before triggering so
  // we can both gate the visual effect and update the HUD in one place.
  consumeBomb(self: Entity): boolean {
    if (this.bombs <= 0) return false;
    this.bombs--;
    this.render(self);
    return true;
  }
}
