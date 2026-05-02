import Phaser from 'phaser';
import { GAME_W } from '../config';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { BulletPool } from '../entities/BulletPool';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemy!: Enemy;
  private bullets!: BulletPool;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  create(): void {
    this.bullets = new BulletPool(this);
    this.player = new Player(this, GAME_W / 2);
    this.enemy = new Enemy(this, GAME_W / 2, 120, this.bullets);

    this.physics.add.overlap(this.player, this.bullets.group, () => {
      this.scene.restart();
    });

    this.hud = this.add
      .text(8, 8, '', { color: '#aaaaaa', fontSize: '12px' })
      .setScrollFactor(0);
  }

  override update(time: number, delta: number): void {
    this.player.update();
    this.enemy.update(time, delta);
    this.bullets.cullOffscreen();

    const live = this.bullets.group.countActive(true);
    this.hud.setText(
      `tap left/right or arrows  bullets: ${live}  fps: ${Math.round(this.game.loop.actualFps)}`,
    );
  }
}
