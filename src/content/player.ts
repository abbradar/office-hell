import type Phaser from 'phaser';
import { hit } from '../audio/sfx/events';
import { PLAYER_HITBOX_RADIUS } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { HPEntityKind, type HPVars } from '../script/types';
import { activateDeathBomb } from './bomb';
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

export class PlayerKind extends HPEntityKind {
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
      const hp = (self.vars as HPVars).hp;
      this.hpText.setText('♥'.repeat(Math.max(0, hp)));
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
    const vars = self.vars as HPVars;
    const before = vars.hp;
    super.takeDamage(self, amount);
    const after = vars.hp;
    self.stage.score.hpLost += Math.max(0, before - after);
    // Non-killing hit safety net: still alive after damage → fire a
    // free death-bomb (clears bullets in a tight radius around the
    // player + DEATH_BOMB_INVINCIBLE_MS of invincibility + sprite
    // blink). Bomb counter isn't decremented; this is an emergency
    // between-states grace, not a paid resource. The killing blow
    // (hp == 0) skips this branch and dies normally.
    if (self.alive && after > 0) {
      const player = self as Player;
      activateDeathBomb(player, player.stage);
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
