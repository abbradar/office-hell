import type Phaser from 'phaser';
import { hit } from '../audio/sfx';
import { PLAYER_HITBOX_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import { EntityKind } from '../script/types';

export const PLAYER_HP = 2;

export class PlayerKind extends EntityKind {
  private hpText: Phaser.GameObjects.Text;

  constructor(hpText: Phaser.GameObjects.Text) {
    super({
      sprite: 'player',
      animKey: 'player_walk',
      hitboxRadius: PLAYER_HITBOX_RADIUS,
      hp: PLAYER_HP,
      damageClass: [],
      damagedByClass: ['player'],
    });
    this.hpText = hpText;
    this.renderHp(PLAYER_HP);
  }

  private renderHp(hp: number): void {
    this.hpText.setText('♥'.repeat(Math.max(0, hp)));
  }

  override takeDamage(self: Entity, amount: number): void {
    super.takeDamage(self, amount);
    hit();
    if (self.hp !== null) this.renderHp(self.hp);
  }
}
