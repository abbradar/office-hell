import Phaser from 'phaser';
import { BulletPool } from './BulletPool';

const FIRE_INTERVAL_MS = 800;
const BULLET_SPEED = 140;
const BULLETS_PER_VOLLEY = 16;

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  private pool: BulletPool;
  private fireTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, pool: BulletPool) {
    super(scene, x, y, 'enemy');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.pool = pool;
  }

  override update(_time: number, deltaMs: number): void {
    this.fireTimer += deltaMs;
    if (this.fireTimer >= FIRE_INTERVAL_MS) {
      this.fireTimer = 0;
      this.pool.fireRadial(
        this.x,
        this.y,
        BULLETS_PER_VOLLEY,
        BULLET_SPEED,
        Math.random() * Math.PI * 2,
      );
    }
  }
}
