import Phaser from 'phaser';
import { BULLET_POOL_SIZE, BULLET_RADIUS, GAME_W, GAME_H } from '../config';

const CULL_MARGIN = 16;

export class BulletPool {
  readonly group: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene) {
    this.group = scene.physics.add.group({
      defaultKey: 'bullet',
      maxSize: BULLET_POOL_SIZE,
      runChildUpdate: false,
    });

    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      const b = this.group.create(0, 0, 'bullet') as Phaser.Physics.Arcade.Image;
      b.setActive(false).setVisible(false);
      const body = b.body as Phaser.Physics.Arcade.Body;
      body.setCircle(BULLET_RADIUS);
      body.enable = false;
    }
  }

  fire(x: number, y: number, angleRad: number, speed: number): void {
    const b = this.group.getFirstDead(false) as Phaser.Physics.Arcade.Image | null;
    if (!b) return;
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    b.setActive(true).setVisible(true).setPosition(x, y);
    b.setVelocity(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);
  }

  fireRadial(x: number, y: number, count: number, speed: number, baseAngle = 0): void {
    const step = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      this.fire(x, y, baseAngle + i * step, speed);
    }
  }

  cullOffscreen(): void {
    this.group.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Image;
      if (!b.active) return true;
      if (
        b.x < -CULL_MARGIN ||
        b.x > GAME_W + CULL_MARGIN ||
        b.y < -CULL_MARGIN ||
        b.y > GAME_H + CULL_MARGIN
      ) {
        const body = b.body as Phaser.Physics.Arcade.Body;
        body.enable = false;
        b.setActive(false).setVisible(false).setVelocity(0, 0);
      }
      return true;
    });
  }
}
