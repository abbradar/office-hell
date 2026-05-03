import Phaser from 'phaser';
import { shoot } from '../audio/sfx/events';
import { GAME_W, PLAYER_SPEED, PLAYER_Y } from '../config';
import { playerBullet } from '../content/kinds';
import { isTouchDevice } from '../input/device';
import { isLeftHeld, isRightHeld } from '../input/touch';
import type { EntityKind } from '../script/types';
import { Entity } from './Entity';
import type { EntityPool } from './EntityPool';

const FIRE_INTERVAL_MS = 140;
const PLAYER_BULLET_SPEED = 700;
const FIRE_OFFSET_Y = 24;

export class Player extends Entity {
  // Stage scripts flip this to false during cutscenes (e.g. the intro monologue
  // and the post-boss outro) so the live input/auto-fire loop stops running
  // while the script puppets the player. controlUpdate is invoked late in the
  // frame (after pool.update), so a script that sets this earlier in the same
  // frame is honoured before any input or firing happens.
  controlsEnabled = true;

  private leftKey: Phaser.Input.Keyboard.Key;
  private rightKey: Phaser.Input.Keyboard.Key;
  private fireKey: Phaser.Input.Keyboard.Key;
  private lastFireMs = 0;

  constructor(scene: Phaser.Scene, pool: EntityPool, kind: EntityKind) {
    super(scene, GAME_W / 2, PLAYER_Y, kind.sprite ?? '');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.pool = pool;
    this.kind = kind;
    this.hp = kind.hp;
    this.alive = true;
    this.hasEnteredScreen = true;

    const body = this.body;
    body.enable = true;
    body.setCircle(kind.hitboxRadius, this.width / 2 - kind.hitboxRadius, this.height / 2 - kind.hitboxRadius);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(true);

    for (const c of kind.damageClass) pool.damages[c].add(this);
    for (const c of kind.damagedByClass) pool.damagedBy[c].add(this);

    if (kind.animKey) this.play(kind.animKey);

    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    this.leftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.fireKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
  }

  controlUpdate(): void {
    if (!this.alive || !this.controlsEnabled) return;

    let dir = 0;
    if (this.leftKey.isDown || isLeftHeld()) dir -= 1;
    if (this.rightKey.isDown || isRightHeld()) dir += 1;

    const half = this.width / 2;
    if (dir < 0 && this.x <= half) dir = 0;
    if (dir > 0 && this.x >= GAME_W - half) dir = 0;
    this.setVelocityX(dir * PLAYER_SPEED);

    this.x = Phaser.Math.Clamp(this.x, half, GAME_W - half);

    const firing = isTouchDevice || this.fireKey.isDown;
    if (firing) {
      const now = this.scene.time.now;
      if (now - this.lastFireMs >= FIRE_INTERVAL_MS) {
        this.lastFireMs = now;
        this.pool.spawn(playerBullet, this.x, this.y - FIRE_OFFSET_Y, 0, -PLAYER_BULLET_SPEED);
        shoot();
      }
    }
  }
}
