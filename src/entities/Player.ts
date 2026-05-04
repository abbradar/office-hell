import Phaser from 'phaser';
import { shoot } from '../audio/sfx/events';
import { GAME_W, PLAYER_SPEED, PLAYER_Y } from '../config';
import { type Action, characterAnimKey, type Direction } from '../content/animations';
import { activateBomb } from '../content/bomb';
import type { CharacterDef } from '../content/characters';
import { playerBullet } from '../content/kinds';
import type { PlayerKind } from '../content/player';
import { isTouchDevice } from '../input/device';
import { isLeftHeld, isRightHeld } from '../input/touch';
import type { DamageClass } from '../script/types';
import { Entity } from './Entity';
import type { EntityPool } from './EntityPool';

const FIRE_INTERVAL_MS = 140;
const PLAYER_BULLET_SPEED = 700;
const FIRE_OFFSET_Y = 24;
// Side streams: two extra bullets fanned outward so the player covers a wider
// horizontal slice and clipping enemies on the way past is more forgiving.
const FIRE_SIDE_OFFSET_X = 6;
const FIRE_SIDE_VX = 40;

export class Player extends Entity {
  // Stage scripts flip this to false during cutscenes (e.g. the intro monologue
  // and the post-boss outro) so the live input/auto-fire loop stops running
  // while the script puppets the player. controlUpdate is invoked late in the
  // frame (after pool.update), so a script that sets this earlier in the same
  // frame is honoured before any input or firing happens.
  controlsEnabled = true;

  // Narrow the inherited Entity.kind: we always construct with a PlayerKind, and
  // scripts can then reach kind-specific config (like character) without a cast.
  declare kind: PlayerKind;

  private leftKey: Phaser.Input.Keyboard.Key;
  private rightKey: Phaser.Input.Keyboard.Key;
  private fireKey: Phaser.Input.Keyboard.Key;
  private bombKey: Phaser.Input.Keyboard.Key;
  private lastFireMs = 0;

  // Counter, not a flag — a second bomb fired during an existing invincibility
  // window must extend it, not corrupt the saved damagedBy classes that the
  // first bomb stashed away.
  private invincibleDepth = 0;
  private savedDamagedBy: DamageClass[] = [];

  private hitboxGfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, pool: EntityPool, kind: PlayerKind) {
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

    // Initial pose so the very first rendered frame has a valid character anim;
    // subsequent frames are driven by updateAnim().
    this.facing = 'up';
    this.updateAnim();

    kind.render(this);

    // Touhou-style hitbox marker: a bright dot the player can centre on dense
    // bullet streams. Sits above the sprite in z-order.
    this.hitboxGfx = scene.add.graphics();
    this.hitboxGfx.fillStyle(0xff3344, 0.9);
    this.hitboxGfx.fillCircle(0, 0, kind.hitboxRadius);
    this.hitboxGfx.lineStyle(1, 0xffffff, 0.9);
    this.hitboxGfx.strokeCircle(0, 0, kind.hitboxRadius);
    this.hitboxGfx.setDepth(this.depth + 1);

    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    this.leftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.fireKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.bombKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.X);
  }

  get character(): CharacterDef {
    return this.kind.character;
  }

  pushInvincible(): void {
    if (this.invincibleDepth === 0) {
      this.savedDamagedBy = this.activeDamagedBy.slice();
      this.setDamagedByClasses([]);
    }
    this.invincibleDepth++;
  }

  popInvincible(): void {
    if (this.invincibleDepth === 0) return;
    this.invincibleDepth--;
    if (this.invincibleDepth === 0 && this.alive) {
      this.setDamagedByClasses(this.savedDamagedBy);
    }
  }

  // Player anim rules: while no enemies are on screen the corridor's still
  // scrolling and the MC reads as running into it (run + up). Once an enemy
  // is up, she stands her ground (idle + up) unless she sidesteps, in which
  // case she runs sideways. damagedBy.enemy is the live enemy roster — bullets
  // sit in damages.player but not here, so a wave's leftover bullets don't
  // freeze her in idle after the enemy has already left.
  override updateAnim(): void {
    const sheet = this.kind.sprite;
    if (sheet === null) return;
    const enemyOnScreen = this.pool.damagedBy.enemy.countActive(true) > 0;
    const vx = this.body.velocity.x;
    let action: Action;
    let dir: Direction;
    if (!enemyOnScreen) {
      action = 'run';
      dir = 'up';
    } else if (vx !== 0) {
      action = 'run';
      dir = vx > 0 ? 'right' : 'left';
    } else {
      action = 'idle';
      dir = 'up';
    }
    this.facing = dir;
    const key = characterAnimKey(sheet, action, dir);
    if (this.anims.currentAnim?.key !== key) this.play(key);
  }

  controlUpdate(): void {
    this.hitboxGfx.setPosition(this.x, this.y);
    this.hitboxGfx.setVisible(this.alive);

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
        const fy = this.y - FIRE_OFFSET_Y;
        this.pool.spawn(playerBullet, this.x, fy, 0, -PLAYER_BULLET_SPEED);
        this.pool.spawn(playerBullet, this.x - FIRE_SIDE_OFFSET_X, fy, -FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        this.pool.spawn(playerBullet, this.x + FIRE_SIDE_OFFSET_X, fy, FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        shoot();
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.bombKey)) {
      if (this.kind.consumeBomb(this)) activateBomb(this, this.pool);
    }
  }
}
