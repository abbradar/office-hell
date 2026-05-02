import type Phaser from 'phaser';
import { hit } from '../audio/sfx';
import { PLAYER_HITBOX_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import { EntityKind } from '../script/types';

export const PLAYER_HP = 2;

export type PlayerKindOpts = {
  hpText: Phaser.GameObjects.Text;
  practice?: boolean;
};

export class PlayerKind extends EntityKind {
  private hpText: Phaser.GameObjects.Text;
  private practice: boolean;
  hits = 0;

  constructor(opts: PlayerKindOpts) {
    super({
      sprite: 'player',
      animKey: 'player_walk',
      hitboxRadius: PLAYER_HITBOX_RADIUS,
      hp: PLAYER_HP,
      damageClass: [],
      damagedByClass: ['player'],
    });
    this.hpText = opts.hpText;
    this.practice = opts.practice ?? false;
    this.render(PLAYER_HP);
  }

  private render(hp: number): void {
    if (this.practice) {
      this.hpText.setText(`hits: ${this.hits}`);
    } else {
      this.hpText.setText('♥'.repeat(Math.max(0, hp)));
    }
  }

  override takeDamage(self: Entity, amount: number): void {
    hit();
    if (this.practice) {
      this.hits++;
      this.render(self.hp ?? 0);
      return;
    }
    super.takeDamage(self, amount);
    if (self.hp !== null) this.render(self.hp);
  }
}
