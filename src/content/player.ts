import type Phaser from 'phaser';
import { hit } from '../audio/sfx/events';
import { PLAYER_HITBOX_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { EntityKind } from '../script/types';
import { activateBomb, BOMB_DURATION_MS } from './bomb';
import type { CharacterDef } from './characters';

export const PLAYER_HP = 2;
export const PLAYER_BOMBS = 3;

export type PlayerKindOpts = {
  hpText: Phaser.GameObjects.Text;
  bombsText: Phaser.GameObjects.Text;
  practice?: boolean;
  character: CharacterDef;
  // Initial bomb count for this run. Defaults to PLAYER_BOMBS; the real
  // stage passes 0 so the HUD slot is empty until the intro tutorial
  // unlocks bombs (avoids a single-frame "✱✱✱" flash on stage start).
  bombs?: number;
};

export class PlayerKind extends EntityKind {
  readonly character: CharacterDef;
  private hpText: Phaser.GameObjects.Text;
  private bombsText: Phaser.GameObjects.Text;
  private practice: boolean;
  hits = 0;
  bombs: number;

  constructor(opts: PlayerKindOpts) {
    super({
      sprite: opts.character.sprite,
      hitboxRadius: PLAYER_HITBOX_RADIUS,
      hp: PLAYER_HP,
      damageClass: [],
      damagedByClass: ['player'],
    });
    this.character = opts.character;
    this.hpText = opts.hpText;
    this.bombsText = opts.bombsText;
    this.practice = opts.practice ?? false;
    this.bombs = opts.bombs ?? PLAYER_BOMBS;
  }

  render(self: Entity): void {
    if (this.practice) {
      this.hpText.setText(`hits: ${this.hits}`);
      this.bombsText.setText('');
    } else {
      this.hpText.setText('♥'.repeat(Math.max(0, self.hp ?? 0)));
      this.bombsText.setText('✱'.repeat(this.bombs));
    }
  }

  override takeDamage(self: Entity, amount: number): void {
    hit();
    if (this.practice) {
      this.hits++;
      this.render(self);
      return;
    }
    // Apply damage normally. super.takeDamage decrements hp and calls
    // die() if it hits zero — at which point self.alive flips false and
    // the death sequence takes over.
    super.takeDamage(self, amount);
    // Non-killing hit safety net: still alive after damage → fire a
    // free auto-bomb (clears bullets in radius + BOMB_DURATION_MS of
    // invincibility + sprite blink). Bomb counter isn't decremented;
    // this is an emergency between-states grace, not a paid resource.
    // The killing blow (hp == 0) skips this branch and dies normally.
    if (self.alive && self.hp !== null && self.hp > 0) {
      const player = self as Player;
      activateBomb(player, player.stage);
      // Sprite alpha pulses at ~10 Hz across the invincibility window
      // so the rescue reads visually as "you got saved", separate from
      // the bomb's own field VFX. Auto-bomb only — manual bombs leave
      // the sprite alpha alone.
      player.scene.tweens.add({
        targets: player,
        alpha: 0.3,
        duration: 100,
        yoyo: true,
        repeat: Math.floor(BOMB_DURATION_MS / 200) - 1,
        onComplete: () => {
          player.setAlpha(1);
        },
        onStop: () => {
          player.setAlpha(1);
        },
      });
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
