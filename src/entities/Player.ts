import Phaser from 'phaser';
import {
  PLAYER_SPEED,
  PLAYER_HITBOX_RADIUS,
  PLAYER_Y,
} from '../config';
import { touchDirection } from '../input/touch';

export class Player extends Phaser.Physics.Arcade.Sprite {
  private leftKey: Phaser.Input.Keyboard.Key;
  private rightKey: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene, x: number) {
    super(scene, x, PLAYER_Y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(
      PLAYER_HITBOX_RADIUS,
      this.width / 2 - PLAYER_HITBOX_RADIUS,
      this.height / 2 - PLAYER_HITBOX_RADIUS,
    );
    body.setAllowGravity(false);

    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    this.leftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
  }

  override update(): void {
    let dir = touchDirection();

    if (this.leftKey.isDown) dir -= 1;
    if (this.rightKey.isDown) dir += 1;

    dir = Phaser.Math.Clamp(dir, -1, 1);
    this.setVelocityX(dir * PLAYER_SPEED);
    this.setVelocityY(0);
    this.y = PLAYER_Y;
  }
}
