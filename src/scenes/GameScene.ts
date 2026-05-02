import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { PlayerKind } from '../content/player';
import { stage } from '../content/stage';
import type { Entity } from '../entities/Entity';
import { EntityPool } from '../entities/EntityPool';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import { TOUCH_BUTTON_RADIUS, TOUCH_BUTTON_Y } from '../input/touch';
import { DAMAGE_CLASSES } from '../script/types';

const CORRIDOR_SCROLL_PX_PER_MS = 0.25;
const SPECKS_SCROLL_PX_PER_MS = 0.55;

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private pool!: EntityPool;
  private hud!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  private specks!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('Game');
  }

  create(): void {
    this.bg = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor').setDepth(-10);
    this.specks = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor_specks').setDepth(-9);

    this.pool = new EntityPool(this);

    this.hpText = this.add
      .text(GAME_W - 8, 8, '', { color: '#ff5577', fontSize: '24px' })
      .setOrigin(1, 0)
      .setDepth(100);

    const playerKind = new PlayerKind(this.hpText);
    this.player = new Player(this, this.pool, playerKind);
    this.pool.player.x = this.player.x;
    this.pool.player.y = this.player.y;

    this.pool.spawn(stage, 0, 0, 0, 0);

    for (const c of DAMAGE_CLASSES) {
      this.physics.add.overlap(this.pool.damages[c], this.pool.damagedBy[c], (a, b) => {
        const attacker = a as Entity;
        const target = b as Entity;
        if (!attacker.alive || !target.alive) return;
        attacker.kind.targetCollision(attacker, target);
      });
    }

    if (isTouchDevice) {
      this.add
        .circle(0, TOUCH_BUTTON_Y, TOUCH_BUTTON_RADIUS, 0xffffff, 0.12)
        .setStrokeStyle(2, 0xffffff, 0.35)
        .setDepth(100);
      this.add
        .circle(GAME_W, TOUCH_BUTTON_Y, TOUCH_BUTTON_RADIUS, 0xffffff, 0.12)
        .setStrokeStyle(2, 0xffffff, 0.35)
        .setDepth(100);
      this.add
        .text(28, TOUCH_BUTTON_Y, '◀', { color: '#ffffff', fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);
      this.add
        .text(GAME_W - 28, TOUCH_BUTTON_Y, '▶', { color: '#ffffff', fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);
    }

    this.hud = this.add.text(8, 8, '', { color: '#aaaaaa', fontSize: '12px' }).setScrollFactor(0).setDepth(100);
  }

  override update(time: number, delta: number): void {
    this.bg.tilePositionY -= delta * CORRIDOR_SCROLL_PX_PER_MS;
    this.specks.tilePositionY -= delta * SPECKS_SCROLL_PX_PER_MS;

    this.player.controlUpdate();
    this.pool.player.x = this.player.x;
    this.pool.player.y = this.player.y;
    this.pool.update(time, delta);

    if (!this.player.alive) {
      this.scene.start('End', { won: false });
      return;
    }

    const hostile = this.pool.damages.player.countActive(true);
    const controls = isTouchDevice ? 'buttons: move   tap: fire' : '← →: move   ctrl: fire';
    this.hud.setText(`${controls}   hostile: ${hostile}   fps: ${Math.round(this.game.loop.actualFps)}`);
  }
}
