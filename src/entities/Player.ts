import Phaser from 'phaser';
import { shoot } from '../audio/sfx/events';
import { GAME_H, GAME_W, HEADER_H, PLAYER_SPEED, PLAYER_Y, WALL_W } from '../config';
import { type Action, characterAnimKey, type Direction } from '../content/animations';
import { activateBomb } from '../content/bomb';
import type { CharacterDef } from '../content/characters';
import { playerBullet } from '../content/kinds';
import type { PlayerKind } from '../content/player';
import { onPlayerDeath } from '../script/score';
import type { StageManager } from '../script/StageManager';
import type { DamageClass, HPVars } from '../script/types';
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
// positions are ignored if they differ from the current touchTarget by
// less than this (Euclidean). Filters out raw-pointer jitter so the
// player doesn't twitch while the finger is held still.
const TARGET_DEADBAND_PX = 1;
// Touch target smoothing window: the candidate target each frame is the
// mean of this many most-recent samples. Larger = smoother + laggier.
// Only active while a finger is down; on release the buffer is cleared
// so the player stops cleanly in place (see controlUpdate's release
// branch for why feeding this.x back in here causes overshoot).
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
// Focus mode (Shift held + keyboard movement): scales PLAYER_SPEED
// down for fine positioning into dense bullet streams. The factor is
// below RUN_VX_RATIO so the displacement-based anim picker would
// already land on walk; updateAnim still forces walk explicitly so
// the RUN_HOLD_FRAMES tail doesn't flash a few frames of run on the
// transition from full-speed into focus.
const FOCUS_SPEED_RATIO = 0.4;
// Touch target sits this many pixels above the finger so the player
// sprite (and hitbox dot) isn't hidden under the user's fingertip.
// 1/15 of the playfield height ≈ 44px — about one player-sprite
// height of clearance, which keeps the dot framed just above the
// fingernail on a typical thumb hold.
const TOUCH_Y_OFFSET = GAME_H / 15;

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
  // Same idea, for focus mode: while false, controlUpdate refuses to flip
  // `focused` on regardless of Shift state, so the player can't stumble
  // into focus-walking before the intro's focus tutorial introduces it.
  // Defaults true so practice / test / music modes (which skip the intro)
  // get focus from the menu — only the real-stage intro flips it off.
  focusEnabled = true;
  // Cutscene flag — when set together with `walkAnim`, updateAnim plays
  // the walk animation in the current `facing` direction even though
  // velocity is zero. Used by the ending scene where the player walks
  // in place at the corridor edge while the floor scrolls past them.
  walkInPlace = false;

  // Narrow the inherited Entity.kind: we always construct with a PlayerKind, and
  // scripts can then reach kind-specific config (like character) without a cast.
  declare kind: PlayerKind;

  private lastFireMs = 0;
  // True while the player is moving via keyboard with Shift held — speed
  // scales by FOCUS_SPEED_RATIO and updateAnim forces 'walk'. Set in
  // controlUpdate (which runs before updateAnim each frame) and cleared
  // when controls are locked or no horizontal key is active, so a held
  // Shift outside of movement (or during a cutscene) doesn't pin the
  // anim choice on stale state. Public so the intro's focus tutorial
  // can poll it as the prompt's completion signal.
  focused = false;

  // Touch-mode movement target, in logical (x, y). While a finger is
  // down, tracks its position; on release, snaps to the player's
  // current position so the player halts in place instead of coasting
  // to the last tap point. Once set, stays set — the deadband filter
  // above gates updates so sub-pixel jitter doesn't keep re-arming a
  // new target. Only cleared (back to null) when keyboard input takes
  // over or in lockControls, so a cutscene doesn't yank the player
  // toward a stale target on resume.
  private touchTarget: { x: number; y: number } | null = null;
  // Rolling buffer of raw target candidates (finger position or
  // release-snap), averaged each frame to smooth pointer jitter.
  // Bounded length = TARGET_SMOOTHING_FRAMES; the oldest entry is
  // dropped on each push. Cleared whenever touch movement is
  // interrupted (keyboard takeover, lockControls) so a re-engagement
  // isn't dragged toward stale samples.
  private targetSamples: { x: number; y: number }[] = [];
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
  // Last frame's (this.x, this.y), used by updateAnim to compute
  // effective velocity. Seeded in the constructor so the very first
  // updateAnim call doesn't see a (this.* − 0) jump.
  private prevX = 0;
  private prevY = 0;

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
    this.vars = { hp: kind.hp } satisfies HPVars;
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
    this.prevY = this.y;
    this.updateAnim();

    kind.render(this);

    // Touhou-style hitbox marker: a bright dot the player can centre on dense
    // bullet streams. Sits at the highest in-game z so nothing covers it
    // except dialogue / pause overlays (depth 200) — bombs, bullets, the
    // HUD, and speech bubbles all render below, so the player can always
    // track their hurtbox.
    this.hitboxGfx = scene.add.graphics();
    this.hitboxGfx.fillStyle(COLOR_DANGER, 0.9);
    this.hitboxGfx.fillCircle(0, 0, kind.hitboxRadius);
    this.hitboxGfx.lineStyle(1, COLOR_NO_TINT, 0.9);
    this.hitboxGfx.strokeCircle(0, 0, kind.hitboxRadius);
    this.hitboxGfx.setDepth(199);

    // Bomb input flows in via the scene's `bombInput` event — touch bomb
    // button + keyboard X both emit it (see GameScene). The Player owns
    // the eligibility checks (alive, controlsEnabled, bombs > 0) so the
    // dispatcher in GameScene stays a one-line emit. The listener is
    // tied to the scene's lifetime, which matches Player's own lifetime
    // (Player is destroyed when the scene tears down), so no manual
    // off() is needed.
    scene.events.on('bombInput', this.tryFireBomb, this);
  }

  // Fire a bomb if conditions allow — entry point from the `bombInput`
  // event. Gates on stage.paused so a tap on the visible bomb button
  // during a dialogue / pause overlay / continue overlay can't burn a
  // bomb (the event still fires for the intro skip / bomb tutorial poll
  // to catch — they listen to the same event).
  private tryFireBomb(): void {
    if (this.stage.paused) return;
    if (!this.alive || !this.controlsEnabled) return;
    if (this.kind.bombs <= 0) return;
    this.kind.consumeBomb(this);
    activateBomb(this, this.stage);
  }

  get character(): CharacterDef {
    return this.kind.character;
  }

  // Convenience: refresh the HP / bombs HUD bound to this player. Saves
  // call sites the `kind.render(this)` indirection.
  render(): void {
    this.kind.render(this);
  }

  // Disable input *and* zero velocity. Zeroing matters because
  // controlUpdate may have set v from a held arrow on a previous frame
  // — without it, updateAnim keeps rendering the run-direction frame
  // until the player happens to release the key.
  lockControls(): void {
    this.controlsEnabled = false;
    this.setVelocity(0, 0);
    // Drop any pending touch target so a cutscene that ends with the
    // finger long-released doesn't snap the player toward a stale spot.
    this.touchTarget = null;
    this.targetSamples.length = 0;
    this.focused = false;
  }

  unlockControls(): void {
    this.controlsEnabled = true;
  }

  override die(): void {
    super.die();
    // Death collapses the live chain back to 1 — the scoreboard total
    // survives, but any climb the player had banked is gone for the
    // next continue. See src/docs/scoring-system.md.
    onPlayerDeath(this.stage.score);
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
    // Effective velocity from frame-over-frame displacement, captured
    // before any branch returns so prevX/prevY stay current across
    // walkAnim ↔ in-stage transitions. Only the in-stage branch reads
    // it; the walkAnim path keeps using body.velocity (set explicitly
    // by moveTo and friends).
    const dt = this.scene.game.loop.delta / 1000;
    const effVx = this.animSuppressed || dt <= 0 ? 0 : (this.x - this.prevX) / dt;
    const effVy = this.animSuppressed || dt <= 0 ? 0 : (this.y - this.prevY) / dt;
    this.prevX = this.x;
    this.prevY = this.y;
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
      // Normal in-stage mode. Effective speed (from frame-over-frame
      // displacement, computed above) drives the threshold pick: above
      // RUN_VX_RATIO of PLAYER_SPEED → run, any non-zero motion below
      // → walk, exact zero → idle. Reading body.velocity instead of
      // displacement would skip walk entirely because controlUpdate's
      // snap branch writes this.x/y directly while leaving
      // body.velocity at 0. The side anim is "sticky" — after motion
      // stops it holds whatever sideways anim was last playing for
      // SIDEWAYS_ANIM_HOLD_FRAMES before falling back to forward 'up',
      // so a quick deceleration still gets a visible walk-out instead
      // of flicking straight to idle on the next frame.
      const speed = Math.hypot(effVx, effVy);
      const absRatio = speed / PLAYER_SPEED;
      if (absRatio > RUN_VX_RATIO) this.framesSinceRunSpeed = 0;
      else this.framesSinceRunSpeed++;

      if (effVx !== 0 || effVy !== 0) {
        this.framesSinceMovement = 0;
        // Diagonal motion favours horizontal direction — the sprite
        // sheet has dedicated left/right walk/run frames, and the
        // sideways pose reads as the "moving" pose for the player. We
        // only pick down/up when motion is purely (or mostly) vertical.
        if (Math.abs(effVx) >= Math.abs(effVy) && effVx !== 0) {
          dir = effVx > 0 ? 'right' : 'left';
        } else {
          dir = effVy > 0 ? 'down' : 'up';
        }
        // Focus mode forces walk — bypasses the RUN_HOLD_FRAMES tail
        // so pressing Shift mid-run drops to walk on the same frame.
        if (this.focused) action = 'walk';
        else action = this.framesSinceRunSpeed <= RUN_HOLD_FRAMES ? 'run' : 'walk';
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

  controlUpdate(input: PlayerControlInput): void {
    this.hitboxGfx.setPosition(this.x, this.y);
    this.hitboxGfx.setVisible(this.alive);

    if (!this.alive || !this.controlsEnabled) return;

    const half = this.width / 2;
    const halfH = this.height / 2;
    const minX = WALL_W + half;
    const maxX = GAME_W - WALL_W - half;
    // Vertical bounds: top edge sits just below the HUD header strip;
    // bottom edge keeps the sprite inside the playfield (above the
    // touch control band on mobile, above the bottom of GAME_H on
    // desktop). The hitbox is much smaller than the sprite, so a
    // half-sprite gap below the header keeps the sprite from
    // overlapping the HUD even when the player parks at the top.
    const minY = HEADER_H + halfH;
    const maxY = GAME_H - halfH;

    const kbActive = input.kbDirX !== 0 || input.kbDirY !== 0;
    this.focused = kbActive && input.focusHeld && this.focusEnabled;

    let newVx = 0;
    let newVy = 0;
    if (kbActive) {
      // Keyboard takes priority and clears any pending touch target so a
      // cached tap doesn't keep tugging once the player grabs the keys.
      this.touchTarget = null;
      this.targetSamples.length = 0;
      // Zero the component(s) pressed *into* a wall before normalising
      // so a diagonal press against a single wall keeps full speed
      // along the unblocked axis instead of dropping to sqrt(2)/2.
      let dx = input.kbDirX;
      let dy = input.kbDirY;
      if (dx < 0 && this.x <= minX) dx = 0;
      if (dx > 0 && this.x >= maxX) dx = 0;
      if (dy < 0 && this.y <= minY) dy = 0;
      if (dy > 0 && this.y >= maxY) dy = 0;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        const speed = this.focused ? PLAYER_SPEED * FOCUS_SPEED_RATIO : PLAYER_SPEED;
        newVx = (dx / len) * speed;
        newVy = (dy / len) * speed;
      }
    } else {
      // Touch: while a finger is down, refresh the target to its (x, y),
      // smoothed by averaging TARGET_SMOOTHING_FRAMES recent samples and
      // gated by a sub-deadband filter so steady-finger pointer jitter
      // doesn't re-arm a cleared target. On release, halt in place: pin
      // the target to the current position and drop the buffer. Feeding
      // this.x/this.y back into the buffer instead would let it drain
      // over the next TARGET_SMOOTHING_FRAMES frames while the player
      // is *still moving* at PLAYER_SPEED, so the average ends up
      // behind the player and gap flips sign — the player overshoots,
      // reverses, and bounces around the eventual target. That
      // bouncing reads as a visible twitch on every finger-up.
      const finger = input.touchTarget;
      if (finger === null) {
        this.targetSamples.length = 0;
        this.touchTarget = { x: this.x, y: this.y };
      } else {
        const sample = {
          x: Phaser.Math.Clamp(finger.x, minX, maxX),
          y: Phaser.Math.Clamp(finger.y - TOUCH_Y_OFFSET, minY, maxY),
        };
        this.targetSamples.push(sample);
        if (this.targetSamples.length > TARGET_SMOOTHING_FRAMES) this.targetSamples.shift();
        let sumX = 0;
        let sumY = 0;
        for (const s of this.targetSamples) {
          sumX += s.x;
          sumY += s.y;
        }
        const candidate = { x: sumX / this.targetSamples.length, y: sumY / this.targetSamples.length };

        if (
          this.touchTarget === null ||
          Math.hypot(candidate.x - this.touchTarget.x, candidate.y - this.touchTarget.y) >= TARGET_DEADBAND_PX
        ) {
          this.touchTarget = candidate;
        }
      }

      const gapX = this.touchTarget.x - this.x;
      const gapY = this.touchTarget.y - this.y;
      const dist = Math.hypot(gapX, gapY);
      const dt = this.scene.game.loop.delta / 1000;
      const maxStep = PLAYER_SPEED * dt;
      if (dist <= maxStep) {
        // Within one frame's max step. Don't try to land via a scaled
        // gap/dt velocity — Phaser's next-frame physics dt isn't
        // necessarily this frame's dt, and the resulting overshoot can
        // exceed any reasonable tolerance and cause the player to
        // ping-pong around the target. Snap directly instead; body.position
        // picks it up in preUpdate before the next integration, and v=0
        // keeps physics from drifting back. touchTarget is intentionally
        // left set so the deadband above continues to filter sub-pixel
        // candidate jitter; nulling it here would bypass the deadband
        // on the very next frame and re-arm a new target from any
        // micro-movement in `candidate`.
        this.x = this.touchTarget.x;
        this.y = this.touchTarget.y;
      } else {
        // Diagonal motion is automatically normalised — the velocity
        // vector here has magnitude PLAYER_SPEED regardless of heading.
        newVx = (gapX / dist) * PLAYER_SPEED;
        newVy = (gapY / dist) * PLAYER_SPEED;
      }
    }
    this.setVelocity(newVx, newVy);

    this.x = Phaser.Math.Clamp(this.x, minX, maxX);
    this.y = Phaser.Math.Clamp(this.y, minY, maxY);

    if (input.firing && this.firingEnabled) {
      const now = this.scene.time.now;
      if (now - this.lastFireMs >= FIRE_INTERVAL_MS) {
        this.lastFireMs = now;
        const fy = this.y - FIRE_OFFSET_Y;
        this.stage.spawn(playerBullet, this.x, fy, 0, -PLAYER_BULLET_SPEED);
        this.stage.spawn(playerBullet, this.x - FIRE_SIDE_OFFSET_X, fy, -FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        this.stage.spawn(playerBullet, this.x + FIRE_SIDE_OFFSET_X, fy, FIRE_SIDE_VX, -PLAYER_BULLET_SPEED);
        this.stage.score.bullets += 3;
        shoot();
      }
    }
  }
}

// Per-frame input snapshot the GameScene assembles from keyboard +
// touch state and hands to Player.controlUpdate. Keeping the input
// reading on the scene side means the Player has no dependency on
// Phaser keys / touch helpers — it just acts on what it's told.
export type PlayerControlInput = {
  // Keyboard movement direction per axis: -1 / 0 / 1. Player normalises
  // diagonals (so |v| stays at PLAYER_SPEED) and zeroes whichever axis
  // is pressed into a wall before normalising.
  kbDirX: number;
  kbDirY: number;
  // Whether the focus modifier (Shift) is held. Only meaningful when at
  // least one kbDir component is non-zero; Player gates focused-mode on
  // both being true.
  focusHeld: boolean;
  // Touch finger position in logical coords (smoothed by Player), or
  // null when no movement finger is held / the platform is desktop.
  touchTarget: { x: number; y: number } | null;
  // Whether the auto-fire stream should be live this frame. True on
  // touch (auto-fire) or when the keyboard fire key is held.
  firing: boolean;
};
