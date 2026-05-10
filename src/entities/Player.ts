import Phaser from 'phaser';
import { shoot } from '../audio/sfx/events';
import { GAME_W, PLAYER_SPEED, PLAYER_Y, WALL_W } from '../config';
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
// Touch target deadband, in logical pixels: incoming finger / release
// positions are ignored if they differ from the current touchTargetX by
// less than this. Filters out raw-pointer jitter so the player doesn't
// twitch while the finger is held still.
const TARGET_DEADBAND_PX = 1;
// Touch target smoothing window: the candidate target each frame is the
// mean of this many most-recent samples. Larger = smoother + laggier; a
// release-snap (candidate = player.x) takes this many frames to fully
// drain the buffer, giving an implicit deceleration as the average
// catches up.
const TARGET_SMOOTHING_FRAMES = 10;
// How many frames the sideways run anim "sticks" after horizontal motion
// stops before falling back to the forward 'up' pose. A short tap that
// nudges the player one pixel still gets the full run flourish; a real
// stop only reads as idle once the player has been still this long.
const SIDEWAYS_ANIM_HOLD_FRAMES = 15;
// Speed threshold for the in-stage anim, expressed as a fraction of
// PLAYER_SPEED. Crossing it (in the last RUN_HOLD_FRAMES frames)
// triggers run; any non-zero motion below → walk; exact zero → idle
// (or sticky-hold). Velocity is measured from frame-over-frame
// displacement of this.x, not body.velocity, so the snap branch in
// controlUpdate (which writes x directly with vx=0) still feeds
// through as a non-zero effective velocity.
const RUN_VX_RATIO = 0.5;
// How long the run anim "stays active" after the last frame at run
// speed. Smooths the deceleration tail: a brief drop to walk-speed
// while approaching the touch target doesn't immediately downgrade
// the anim from run to walk.
const RUN_HOLD_FRAMES = 10;

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
  // Cutscene flag — when set together with `walkAnim`, updateAnim plays
  // the walk animation in the current `facing` direction even though
  // velocity is zero. Used by the ending scene where the player walks
  // in place at the corridor edge while the floor scrolls past them.
  walkInPlace = false;

  // Narrow the inherited Entity.kind: we always construct with a PlayerKind, and
  // scripts can then reach kind-specific config (like character) without a cast.
  declare kind: PlayerKind;

  private leftKey: Phaser.Input.Keyboard.Key;
  private rightKey: Phaser.Input.Keyboard.Key;
  private fireKey: Phaser.Input.Keyboard.Key;
  private bombKey: Phaser.Input.Keyboard.Key;
  private lastFireMs = 0;

  // Touch-mode movement target, in logical x. While a finger is down,
  // tracks its x; on release, snaps to the player's current x so the
  // player halts in place instead of coasting to the last tap point.
  // Once set, stays set — the deadband filter above gates updates so
  // sub-pixel jitter doesn't keep re-arming a new target. Only cleared
  // (back to null) when keyboard input takes over or in lockControls,
  // so a cutscene doesn't yank the player toward a stale x on resume.
  private touchTargetX: number | null = null;
  // Rolling buffer of raw target candidates (finger.x or release-snap),
  // averaged each frame to smooth pointer jitter. Bounded length =
  // TARGET_SMOOTHING_FRAMES; the oldest entry is dropped on each push.
  // Cleared whenever touch movement is interrupted (keyboard takeover,
  // lockControls) so a re-engagement isn't dragged toward stale samples.
  private targetSamples: number[] = [];
  // Frames since vx was last non-zero (in-stage mode). Reset to 0 on
  // any horizontal motion; counted up while the player is parked.
  // updateAnim holds the side run anim until this exceeds
  // SIDEWAYS_ANIM_HOLD_FRAMES, then falls back to forward.
  private framesSinceMovement = SIDEWAYS_ANIM_HOLD_FRAMES;
  // Frames since |effVx| was last above RUN_VX_RATIO. Reset on every
  // run-speed frame; counted up otherwise. While ≤ RUN_HOLD_FRAMES the
  // anim stays at 'run' even if the current frame's effVx has dropped
  // into the walk band, so deceleration tails off smoothly.
  private framesSinceRunSpeed = RUN_HOLD_FRAMES + 1;
  // Last frame's this.x, used by updateAnim to compute effective
  // horizontal velocity. Seeded in the constructor so the very first
  // updateAnim call doesn't see a (this.x − 0) jump.
  private prevX = 0;

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
    this.activeDamagedBy = kind.damagedByClass.slice();

    // Initial pose so the very first rendered frame has a valid character anim;
    // subsequent frames are driven by updateAnim().
    this.facing = 'up';
    this.prevX = this.x;
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
    // Drop any pending touch target so a cutscene that ends with the
    // finger long-released doesn't snap the player toward a stale x.
    this.touchTargetX = null;
    this.targetSamples.length = 0;
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

  // Picks the player anim by context:
  //  - physics paused (dialogue / tutorial bubble / ESC pause) → bail. The
  //    actual anim freeze is driven by StageManager's physics PAUSE/RESUME
  //    hooks; we just have to avoid calling `play(key)` while paused, which
  //    would unpause the sprite. Reading the world flag (rather than
  //    `stage.paused`) lines up with what the hooks gate on, so tutorial
  //    prompts in intro.ts that pause physics without flipping `stage.paused`
  //    are covered too.
  //  - `stage.running` true (between encounters, the corridor is scrolling)
  //    → run forward. "Stationary" still reads as running away from the
  //    camera.
  //  - `stage.running` false (in a wave) → mirror movement. The MC plants
  //    when there's something to deal with; running forward would
  //    overshoot the encounter.
  //
  // Direction otherwise comes from horizontal input: stationary → up,
  // holding left/right → sideways.
  override updateAnim(): void {
    const sheet = this.kind.sprite;
    if (sheet === null) return;
    if (this.scene.physics.world.isPaused) return;
    // animSuppressed (set by `moveTo(..., { silent: true })`) zeroes
    // out velocity for the anim decision — body still integrates the
    // real velocity, but the chosen action falls into the stationary
    // branch (idle, or walk under walkInPlace) instead of walk/run.
    const vx = this.animSuppressed ? 0 : this.body.velocity.x;
    const vy = this.animSuppressed ? 0 : this.body.velocity.y;
    // Effective horizontal velocity from frame-over-frame displacement,
    // captured before any branch returns so prevX stays current across
    // walkAnim ↔ in-stage transitions. Only the in-stage branch reads
    // it; the walkAnim path keeps using body.velocity (set explicitly
    // by moveTo and friends).
    const dt = this.scene.game.loop.delta / 1000;
    const effVx = this.animSuppressed || dt <= 0 ? 0 : (this.x - this.prevX) / dt;
    this.prevX = this.x;
    let dir: Direction;
    let action: Action;
    if (this.walkAnim) {
      // Cutscene mode — walking animation, vertical movement is allowed
      // and feeds direction. Falls back to the last `facing` when
      // stationary so a paused frame mid-cutscene doesn't snap to 'up'.
      const movingX = Math.abs(vx) > 0.5;
      const movingY = Math.abs(vy) > 0.5;
      if (movingX) dir = vx > 0 ? 'right' : 'left';
      else if (movingY) dir = vy > 0 ? 'down' : 'up';
      else dir = this.facing;
      // walkInPlace forces walk anim with no velocity — used when the
      // player is "walking" but the world scrolls under them instead.
      action = movingX || movingY || this.walkInPlace ? 'walk' : 'idle';
    } else {
      // Normal in-stage mode. Effective horizontal velocity (from
      // displacement, computed above) drives the threshold pick: above
      // RUN_VX_RATIO → run, any non-zero motion below → walk, exact
      // zero → idle. Reading body.velocity instead of displacement
      // would skip walk entirely because controlUpdate's snap branch
      // writes this.x directly while leaving body.velocity at 0.
      // The side anim is "sticky" — after motion stops it holds
      // whatever sideways anim was last playing for
      // SIDEWAYS_ANIM_HOLD_FRAMES before falling back to forward 'up',
      // so a quick deceleration still gets a visible walk-out instead
      // of flicking straight to idle on the next frame.
      const absRatio = Math.abs(effVx) / PLAYER_SPEED;
      if (absRatio > RUN_VX_RATIO) this.framesSinceRunSpeed = 0;
      else this.framesSinceRunSpeed++;

      if (effVx !== 0) {
        this.framesSinceMovement = 0;
        dir = effVx > 0 ? 'right' : 'left';
        action = this.framesSinceRunSpeed <= RUN_HOLD_FRAMES ? 'run' : 'walk';
      } else {
        this.framesSinceMovement++;
        const sideways = this.facing === 'left' || this.facing === 'right';
        if (sideways && this.framesSinceMovement <= SIDEWAYS_ANIM_HOLD_FRAMES) {
          // Hold the currently-playing sideways anim — don't touch
          // facing or call play, so whatever was last set keeps
          // looping for the rest of the hold window.
          return;
        }
        dir = 'up';
        action = this.stage.running ? 'run' : 'idle';
      }
    }
    this.facing = dir;
    const key = characterAnimKey(sheet, action, dir);
    if (this.anims.currentAnim?.key !== key) this.play(key);
  }

  controlUpdate(): void {
    this.hitboxGfx.setPosition(this.x, this.y);
    this.hitboxGfx.setVisible(this.alive);

    if (!this.alive || !this.controlsEnabled) return;

    const half = this.width / 2;
    const minX = WALL_W + half;
    const maxX = GAME_W - WALL_W - half;

    const kbDir = (this.leftKey.isDown ? -1 : 0) + (this.rightKey.isDown ? 1 : 0);

    let newVx = 0;
    if (kbDir !== 0) {
      // Keyboard takes priority and clears any pending touch target so a
      // cached tap doesn't keep tugging once the player grabs the keys.
      this.touchTargetX = null;
      this.targetSamples.length = 0;
      let dir = kbDir;
      if (dir < 0 && this.x <= minX) dir = 0;
      if (dir > 0 && this.x >= maxX) dir = 0;
      newVx = dir * PLAYER_SPEED;
    } else {
      // Touch: while a finger is down, refresh the target to its x. On
      // release the target snaps to the player's current x so the player
      // halts where they are instead of coasting to the last tap point.
      // Each frame's raw candidate is smoothed by averaging the last
      // TARGET_SMOOTHING_FRAMES samples, then sub-deadband changes are
      // dropped so steady-finger jitter doesn't re-arm a cleared target.
      const finger = this.scene.getTouchTargetX();
      const sample = finger !== null ? Phaser.Math.Clamp(finger, minX, maxX) : this.x;
      this.targetSamples.push(sample);
      if (this.targetSamples.length > TARGET_SMOOTHING_FRAMES) this.targetSamples.shift();
      let sum = 0;
      for (const s of this.targetSamples) sum += s;
      const candidate = sum / this.targetSamples.length;

      if (this.touchTargetX === null || Math.abs(candidate - this.touchTargetX) >= TARGET_DEADBAND_PX) {
        this.touchTargetX = candidate;
      }

      const gap = this.touchTargetX - this.x;
      const dt = this.scene.game.loop.delta / 1000;
      const maxStep = PLAYER_SPEED * dt;
      if (Math.abs(gap) <= maxStep) {
        // Within one frame's max step. Don't try to land via a scaled
        // gap/dt velocity — Phaser's next-frame physics dt isn't
        // necessarily this frame's dt, and the resulting overshoot can
        // exceed any reasonable tolerance and cause the player to
        // ping-pong around the target. Snap this.x directly instead;
        // body.position picks it up in preUpdate before the next
        // integration, and vx=0 keeps physics from drifting back.
        // touchTargetX is intentionally left set so the deadband above
        // continues to filter sub-pixel candidate jitter; nulling it
        // here would bypass the deadband on the very next frame and
        // re-arm a new target from any micro-movement in `candidate`.
        this.x = this.touchTargetX;
      } else {
        newVx = Math.sign(gap) * PLAYER_SPEED;
      }
    }
    this.setVelocityX(newVx);

    this.x = Phaser.Math.Clamp(this.x, minX, maxX);

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
