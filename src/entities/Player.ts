import Phaser from 'phaser';
import { shoot } from '../audio/sfx/events';
import { GAME_W, PLAYER_SPEED, PLAYER_Y } from '../config';
import { type Action, characterAnimKey, type Direction } from '../content/animations';
import { activateBomb } from '../content/bomb';
import type { CharacterDef } from '../content/characters';
import { playerBullet } from '../content/kinds';
import type { PlayerKind } from '../content/player';
import { isTouchDevice } from '../input/device';
import type { StageManager } from '../script/StageManager';
import type { DamageClass } from '../script/types';
import { COLOR_DANGER, COLOR_NO_TINT } from '../ui/palette';
import { Entity } from './Entity';

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
  // frame (after stage.update), so a script that sets this earlier in the same
  // frame is honoured before any input or firing happens. Mutate via
  // `lockControls()` / `unlockControls()` so a held arrow doesn't leak
  // through as a non-zero vx that updateAnim would render as a run.
  controlsEnabled = true;
  // Fine-grained gate for the auto-fire stream: true means firing the bullet
  // stream is allowed (when controls are also on); false suppresses it
  // independently of movement. Used by the intro to let the player dodge
  // without being able to shoot back before the bomb tutorial unlocks them.
  firingEnabled = true;

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

  constructor(scene: Phaser.Scene, stage: StageManager, kind: PlayerKind) {
    super(scene, GAME_W / 2, PLAYER_Y, kind.sprite ?? '');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.stage = stage;
    this.kind = kind;
    this.hp = kind.hp;
    this.alive = true;
    this.hasEnteredScreen = true;

    const body = this.body;
    body.enable = true;
    body.setCircle(kind.hitboxRadius, this.width / 2 - kind.hitboxRadius, this.height / 2 - kind.hitboxRadius);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(true);

    for (const c of kind.damageClass) stage.damages[c].add(this);
    for (const c of kind.damagedByClass) stage.damagedBy[c].add(this);

    // Initial pose so the very first rendered frame has a valid character anim;
    // subsequent frames are driven by updateAnim().
    this.facing = 'up';
    this.updateAnim();

    kind.render(this);

    // Touhou-style hitbox marker: a bright dot the player can centre on dense
    // bullet streams. Sits above the sprite in z-order.
    this.hitboxGfx = scene.add.graphics();
    this.hitboxGfx.fillStyle(COLOR_DANGER, 0.9);
    this.hitboxGfx.fillCircle(0, 0, kind.hitboxRadius);
    this.hitboxGfx.lineStyle(1, COLOR_NO_TINT, 0.9);
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

  // Convenience: refresh the HP / bombs HUD bound to this player. Saves
  // call sites the `kind.render(this)` indirection.
  render(): void {
    this.kind.render(this);
  }

  // Disable input *and* zero horizontal velocity. Zeroing matters because
  // controlUpdate may have set vx from a held arrow on a previous frame
  // — without it, updateAnim keeps rendering the run-direction frame
  // until the player happens to release the key.
  lockControls(): void {
    this.controlsEnabled = false;
    this.setVelocityX(0);
  }

  unlockControls(): void {
    this.controlsEnabled = true;
  }

  override die(): void {
    super.die();
    // Freeze the sprite mid-frame and hide the hitbox dot. controlUpdate is
    // what normally drives the dot's visibility, but the death sequence
    // pauses the stage so controlUpdate never runs again — without this the
    // dot would linger over the flickering corpse.
    this.anims.pause();
    this.hitboxGfx.setVisible(false);
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

  // The corridor scrolls forward continuously, so the MC is always running.
  // Direction comes purely from horizontal input: stationary → up, holding
  // left/right → run sideways. No enemy check, no idle frames — sliding
  // sideways while the sprite faces up reads as a hop, so the rule stays
  // tied to vx alone.
  override updateAnim(): void {
    const sheet = this.kind.sprite;
    if (sheet === null) return;
    const vx = this.body.velocity.x;
    const action: Action = 'run';
    const dir: Direction = vx > 0 ? 'right' : vx < 0 ? 'left' : 'up';
    this.facing = dir;
    const key = characterAnimKey(sheet, action, dir);
    if (this.anims.currentAnim?.key !== key) this.play(key);
  }

  controlUpdate(): void {
    this.hitboxGfx.setPosition(this.x, this.y);
    this.hitboxGfx.setVisible(this.alive);

    if (!this.alive || !this.controlsEnabled) return;

    let dir = 0;
    if (this.leftKey.isDown || this.scene.isLeftHeld()) dir -= 1;
    if (this.rightKey.isDown || this.scene.isRightHeld()) dir += 1;

    const half = this.width / 2;
    if (dir < 0 && this.x <= half) dir = 0;
    if (dir > 0 && this.x >= GAME_W - half) dir = 0;
    this.setVelocityX(dir * PLAYER_SPEED);

    this.x = Phaser.Math.Clamp(this.x, half, GAME_W - half);

    const firing = this.firingEnabled && (isTouchDevice || this.fireKey.isDown);
    if (firing) {
      const now = this.scene.time.now;
      if (now - this.lastFireMs >= FIRE_INTERVAL_MS) {
        this.lastFireMs = now;
        const fy = this.y - FIRE_OFFSET_Y;
        this.stage.spawn(playerBullet, this.x, fy, 0, -PLAYER_BULLET_SPEED);
        this.stage.spawn(playerBullet, this.x - FIRE_SIDE_OFFSET_X, fy, -FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        this.stage.spawn(playerBullet, this.x + FIRE_SIDE_OFFSET_X, fy, FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        shoot();
      }
    }

    // Drain JustDown unconditionally — Phaser leaves the `_justDown`
    // flag set until something reads it, so skipping the read while
    // bombs=0 would queue a press that fires the moment bombs unlock
    // (intro tutorial). The touch tap queue is the opposite: only drain
    // it when a bomb is actually available, otherwise the intro's bomb
    // tutorial poll loses every press to this same consumer (controls
    // run every frame, the script polls every other frame, so half the
    // taps got eaten here before the tutorial saw them).
    const bombJustDown = Phaser.Input.Keyboard.JustDown(this.bombKey);
    if (this.kind.bombs > 0 && (bombJustDown || this.scene.consumeBombPress())) {
      this.kind.consumeBomb(this);
      activateBomb(this, this.stage);
    }
  }
}
