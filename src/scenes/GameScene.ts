import Phaser from 'phaser';
import { getMusicTime, pauseMusic, resumeMusic, stopMusicLoop } from '../audio/music/loop';
import { playerDeath } from '../audio/sfx/events';
import { DEADZONE_Y, GAME_H, GAME_W, WALL_W } from '../config';
import { activateDeathBomb } from '../content/bomb';
import { getSelectedCharacter } from '../content/characters';
import { computeDoorYs, DOOR_COUNT, DOOR_H, DOOR_SPACING } from '../content/doors';
import { stageKaedalus } from '../content/kaedalusStage';
import { stageMonsterRpg } from '../content/monsterRpgStage';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import { stageTest } from '../content/testStage';
import {
  BG_DOORS_BBOX_KEY,
  BG_DOORS_FRAME_LEFT,
  BG_DOORS_FRAME_RIGHT,
  BG_DOORS_KEY,
  BG_FLOOR_KEY,
  BG_WALLS_KEY,
} from '../content/textures';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import { displayState } from '../render/displayState';
import { bindLogicalCamera } from '../render/logicalCamera';
import { StageManager } from '../script/StageManager';
import { DAMAGE_CLASSES } from '../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import {
  COLOR_ACCENT_GOLD,
  COLOR_ACCENT_GOLD_STR,
  COLOR_ACCENT_GREEN_STR,
  COLOR_ACCENT_RED_STR,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';

const CORRIDOR_SCROLL_PX_PER_MS = 0.1;

// Door layout constants live in src/content/doors.ts so stage scripts
// can compute door y values from the same formula. See that module for
// the cycle / spacing rationale.

const HEADER_H = 28;

const TOUCH_BUTTON_RADIUS = 90;
const BOMB_BUTTON_RADIUS = 50;
const BOMB_BUTTON_X = GAME_W / 2;

// On touch devices with a control band, the move pads hug the canvas
// bottom (lower half clips off-screen — the corner position works well
// for a thumb at the edge). Without a band (desktop), they fall back to
// the original in-playfield position. Coords are in *logical* pixels
// (cameras.main viewport is pinned to GAME_W × logicalH); the band
// height comes from displayState which BootScene's resize handler keeps
// in sync with the canvas aspect.
function touchButtonY(): number {
  const logicalH = displayState.logicalH;
  return logicalH > GAME_H ? logicalH - 60 : GAME_H - 60;
}

// With a control band, the bomb button sits at the canvas bottom (same y
// as the move pads) — the centre column (x ≈ 90..310) is clear of either
// move circle so the bomb ring is fully visible without overlapping.
// Without a band (desktop), it tucks above the move pad inside the playfield.
function bombButtonY(): number {
  const logicalH = displayState.logicalH;
  return logicalH > GAME_H ? logicalH - 60 : GAME_H - 220;
}

// Pointer coords arrive in *logical* space — BootScene overrides
// scale.transformX/Y so Phaser's canvas→world conversion goes all the
// way to logical pixels. Distance check is plain.
function anyHeldInCircle(pointers: Phaser.Input.Pointer[], cx: number, cy: number, r: number): boolean {
  const r2 = r * r;
  for (const p of pointers) {
    if (!p.isDown) continue;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

export const PRACTICE_HITS_KEY_PREFIX = 'practiceHits:';

export type GameSceneData = {
  practice?: WaveDef;
  // When true, run the diagnostics test stage (content/testStage.ts) instead
  // of the normal stage. Surfaces an extra debug HUD line built from the
  // music clock + stage queue introspection.
  test?: boolean;
  // Music-test stages — same debug HUD treatment as `test`, different
  // stage definition. Mutually exclusive; if more than one is set, the
  // first one in `chooseStageKind` wins.
  music?: 'kaedalus' | 'monster-rpg';
};

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private stage!: StageManager;
  private hud!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private bossNameText!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  // Doors: each visible "door slot" is rendered as a (left, right) pair
  // of Images sourced from frames of the 36×80 doors texture. They share
  // a y, recomputed each frame from the same scroll offset.
  private doorSlots: { left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image }[] = [];
  // Walls layer baked per-frame: walls texture drawn in, then a solid
  // doors-shaped silhouette (BG_DOORS_BBOX_KEY) is erased from it at each
  // door's y. The bbox texture is registered with the same native size as
  // the doors texture, so drawing both at the same (x, y) with origin
  // (0, 0) and no scaling produces pixel-identical bounds — eraser and
  // door cover the exact same rect.
  private wallsRt!: Phaser.GameObjects.RenderTexture;
  // Off-display TileSprite of the 1px-tall walls texture, sized to the
  // full canvas. Drawn into wallsRt each frame so the wall pattern tiles
  // vertically across the playfield in a single RT.draw() call instead of
  // looping the 1px source GAME_H times.
  private wallsTile!: Phaser.GameObjects.TileSprite;
  // Accumulated forward scroll, in pixels. Mirrors `-bg.tilePositionY` (the
  // floor's tile offset) and drives the doors' wrap-around y. Tracked
  // separately so the doors keep their phase across the modulo without
  // having to reason about tilePositionY's seed offset.
  private bgScrollY = 0;
  private practiceWave: WaveDef | null = null;
  private testMode = false;
  private musicMode: 'kaedalus' | 'monster-rpg' | null = null;
  private debugHud: Phaser.GameObjects.Text | null = null;
  private playerKind!: PlayerKind;
  // ESC pause state. Distinct from `stage.paused`, which dialogues also set —
  // we share the same physics/script freeze (set stage.paused + physics.pause)
  // but track this flag so X can route to "exit to menu" only while the
  // pause overlay owns the freeze. Only entered when no dialogue is active,
  // so the two pause owners never overlap.
  private userPaused = false;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  // Set once when the player has died and we've kicked off the flicker /
  // game-over transition. Idempotent: keeps update() from re-firing the
  // sequence on every subsequent frame while the animation plays out.
  private deathStarted = false;
  // Continue overlay shown when HP hits 0 in the real stage. Holds the
  // freeze (stage.freeze + paused music) until the player picks
  // continue (revive + death-bomb) or exit-to-menu. Cleared when either
  // path runs; subsequent deaths re-show it. Null in practice / test /
  // music modes — those fall through to startDeathSequence.
  private continueOverlay: Phaser.GameObjects.Container | null = null;
  // Edge-triggered touch bomb input — matches keyboard JustDown(X)
  // semantics. Set on a pointerdown inside the bomb circle and drained
  // by consumeBombPress. Tracking only pointerdown (not pointermove)
  // means a finger sliding off the move pad into the bomb region won't
  // accidentally burn a bomb.
  private bombPending = false;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.practiceWave = data?.practice ?? null;
    this.testMode = data?.test ?? false;
    this.musicMode = data?.music ?? null;
  }

  consumeBombPress(): boolean {
    const pending = this.bombPending;
    this.bombPending = false;
    return pending;
  }

  isLeftHeld(): boolean {
    return anyHeldInCircle(this.game.input.pointers, 0, touchButtonY(), TOUCH_BUTTON_RADIUS);
  }

  isRightHeld(): boolean {
    return anyHeldInCircle(this.game.input.pointers, GAME_W, touchButtonY(), TOUCH_BUTTON_RADIUS);
  }

  create(): void {
    stopMusicLoop();

    // Pin cameras.main to logical resolution and route its output
    // through SharpBilinear post-FX. World content (sprites, walls,
    // HUD text) is authored in logical (0..GAME_W, 0..logicalH) coords
    // and the post-FX upscales the captured logical-resolution FBO to
    // fill the screen with sharp-bilinear sampling — no wobble at any
    // non-integer ratio.
    bindLogicalCamera(this);

    // Scene-level pointer listener auto-cleans on shutdown. Pointer
    // coords arrive in logical space (BootScene's transformX/Y override),
    // so a plain distance check against the logical bomb-button centre is
    // enough.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const dx = pointer.x - BOMB_BUTTON_X;
      const dy = pointer.y - bombButtonY();
      if (dx * dx + dy * dy <= BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS) this.bombPending = true;
    });

    // Floor: small repeating tile (416 wide × 112 tall, designed to loop
    // seamlessly in both axes). TileSprite scrolls the texture vertically
    // as `tilePositionY` advances; with a 660-tall sprite the source
    // tiles ~6 times down the canvas. Seed tilePositionX = 8 to centre
    // the 16px horizontal overhang the same way the previous floor did.
    this.bg = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, BG_FLOOR_KEY).setDepth(-10);
    this.bg.tilePositionX = 8;

    // Walls: a 400×1 repeating pattern. Tiled to canvas height via an
    // off-display TileSprite, then drawn into a per-frame RenderTexture
    // so we can erase each door's bbox before the doors are drawn on top.
    this.wallsRt = this.add.renderTexture(0, 0, GAME_W, GAME_H).setOrigin(0, 0).setDepth(-9);
    this.wallsTile = this.make
      .tileSprite({ x: 0, y: 0, width: GAME_W, height: GAME_H, key: BG_WALLS_KEY }, false)
      .setOrigin(0, 0);

    // Doors: each slot is a (left, right) pair of Images sourced from
    // the BG_DOORS_FRAME_LEFT / BG_DOORS_FRAME_RIGHT frames of the 36×80
    // doors texture. The two halves render at the canvas's wall columns
    // (x=0 and x=GAME_W - WALL_W) and share a y. Per-frame, the same y
    // also drives wallsRt.erase() at both x positions so the wall cutout
    // tracks the door panel exactly. Wall column width matches WALL_W,
    // which is what doors.png was sliced against.
    for (let i = 0; i < DOOR_COUNT; i++) {
      const startY = i * DOOR_SPACING - DOOR_H;
      const left = this.add.image(0, startY, BG_DOORS_KEY, BG_DOORS_FRAME_LEFT).setOrigin(0, 0).setDepth(-8);
      const right = this.add
        .image(GAME_W - WALL_W, startY, BG_DOORS_KEY, BG_DOORS_FRAME_RIGHT)
        .setOrigin(0, 0)
        .setDepth(-8);
      this.doorSlots.push({ left, right });
    }

    // Mask the touch-control band so bullets that drift below the playfield
    // (within CULL_MARGIN before being culled) don't peek through behind the
    // buttons. Depth 50 sits above entities (default 0) and below HUD (99+).
    // Band height is the logical-canvas overrun beyond GAME_H — the touch
    // band lives in logical space (it rides the world FBO through the
    // sharp-bilinear blit just like the playfield does).
    const bandH = displayState.logicalH - GAME_H;
    if (bandH > 0) {
      this.add.rectangle(0, GAME_H, GAME_W, bandH, COLOR_WALL).setOrigin(0, 0).setDepth(50);
    }

    this.stage = new StageManager(this);

    this.add.rectangle(0, 0, GAME_W, HEADER_H, COLOR_PANEL, 0.92).setOrigin(0, 0).setDepth(99);
    this.add
      .rectangle(0, HEADER_H - 1, GAME_W, 1, COLOR_PANEL_BORDER, 0.6)
      .setOrigin(0, 0)
      .setDepth(99);

    this.hpText = this.add
      .text(8, HEADER_H / 2, '', { ...FONT_MENU, color: COLOR_ACCENT_RED_STR })
      .setOrigin(0, 0.5)
      .setDepth(100);
    // Bombs sit just right of HP. Allowing ~64px of HP slot covers the
    // widest hp string ("♥♥") at FONT_MENU 16px.
    this.bombsText = this.add
      .text(72, HEADER_H / 2, '', { ...FONT_MENU, color: COLOR_ACCENT_GOLD_STR })
      .setOrigin(0, 0.5)
      .setDepth(100);
    this.bossNameText = this.add
      .text(GAME_W / 2, HEADER_H / 2, '', { ...FONT_DIALOGUE_SM, color: COLOR_TEXT_PRIMARY_STR })
      .setOrigin(0.5)
      .setDepth(100);

    const character = getSelectedCharacter(this);
    if (!character)
      throw new Error('GameScene started without a selected character — go through CharacterSelect first');

    // Real stage: bombs start at 0; the intro's wellness-coach drop-in
    // unlocks them. Practice / test / music modes get the full pile so
    // they're usable straight from the menu.
    const isRealStage = !this.practiceWave && !this.testMode && this.musicMode === null;
    this.playerKind = new PlayerKind({
      hpText: this.hpText,
      bombsText: this.bombsText,
      practice: this.practiceWave !== null,
      character,
      bombs: isRealStage ? 0 : undefined,
    });
    this.player = new Player(this, this.stage, this.playerKind);
    this.stage.player = this.player;

    // Music + sync test stages: pin player invincible for the whole run so
    // dying doesn't interrupt the timing checks. Pushed once with no pop —
    // bombs still push/pop on top, but the base depth stays at 1.
    if (this.testMode || this.musicMode !== null) this.player.pushInvincible();

    const stageKind =
      this.musicMode === 'kaedalus'
        ? stageKaedalus
        : this.musicMode === 'monster-rpg'
          ? stageMonsterRpg
          : this.testMode
            ? stageTest
            : this.practiceWave
              ? makeWaveStage(this.practiceWave)
              : stage;
    this.stage.spawn(stageKind, 0, 0, 0, 0, { debugYieldReasons: true });

    for (const c of DAMAGE_CLASSES) {
      this.physics.add.overlap(this.stage.damages[c], this.stage.damagedBy[c], (a, b) => {
        const attacker = a as Entity;
        const target = b as Entity;
        if (!attacker.alive || !target.alive) return;
        // Top-of-screen dead zone: an enemy that's still drifting in from
        // y = -30 shouldn't be killable by the player's auto-fire before
        // it's visually on-screen. The player itself sits at y ≈ 580 so
        // this never gates legitimate enemy-bullet → player collisions.
        if (target.y < DEADZONE_Y) return;
        attacker.kind.targetCollision(attacker, target);
      });
    }

    if (isTouchDevice) {
      const moveY = touchButtonY();
      const bombY = bombButtonY();
      this.add
        .circle(0, moveY, TOUCH_BUTTON_RADIUS, COLOR_PANEL_BORDER, 0.18)
        .setStrokeStyle(2, COLOR_PANEL_BORDER, 0.45)
        .setDepth(100);
      this.add
        .circle(GAME_W, moveY, TOUCH_BUTTON_RADIUS, COLOR_PANEL_BORDER, 0.18)
        .setStrokeStyle(2, COLOR_PANEL_BORDER, 0.45)
        .setDepth(100);
      this.add
        .text(28, moveY, '◀', { color: COLOR_TEXT_PRIMARY_STR, fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);
      this.add
        .text(GAME_W - 28, moveY, '▶', { color: COLOR_TEXT_PRIMARY_STR, fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);

      // Bomb button — gold accent reads as "the ✱-button" without a
      // separate label. Centred between the two corner-clipped move pads
      // so neither thumb sits in front of it during normal play.
      this.add
        .circle(BOMB_BUTTON_X, bombY, BOMB_BUTTON_RADIUS, COLOR_ACCENT_GOLD, 0.2)
        .setStrokeStyle(2, COLOR_ACCENT_GOLD, 0.6)
        .setDepth(100);
      this.add
        .text(BOMB_BUTTON_X, bombY, '✱', { color: COLOR_ACCENT_GOLD_STR, fontSize: '30px' })
        .setOrigin(0.5)
        .setAlpha(0.95)
        .setDepth(101);
    }

    this.hud = this.add
      .text(WALL_W + 8, HEADER_H + 4, '', { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR })
      .setScrollFactor(0)
      .setDepth(100);

    // Debug HUD (track / t / next / blocked) shown for the real stage and
    // every test/music stage. Test/music modes get the green tint as a
    // "you're in test mode" cue; real-stage version is greyer so it recedes.
    // x is nudged past the wall column so it sits inside the playfield
    // rather than getting clipped by the side wall. Depth sits below every
    // dialogue-ish overlay (bubbles=50, scroll indicator=95, tutorial=150,
    // dialogue=200) so any of them draw on top of the debug line.
    const debugTinted = this.testMode || this.musicMode !== null;
    this.debugHud = this.add
      .text(WALL_W + 8, HEADER_H + 20, '', {
        ...FONT_DEBUG,
        color: debugTinted ? COLOR_ACCENT_GREEN_STR : COLOR_TEXT_DIM_STR,
      })
      .setScrollFactor(0)
      .setDepth(10);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    kb.on('keydown-ESC', this.handleResume, this);
    kb.on('keydown-X', this.handleExitToMenu, this);

    // Auto-pause when the player tabs away or hides the page. We own
    // this because BootScene set `sound.pauseOnBlur = false` to take
    // over from Phaser's per-frame onFocus contention. Both events fire
    // because no single one is reliable across platforms — desktop
    // browsers fire window blur, iOS Safari only fires visibilitychange
    // when the tab actually hides. Resume is intentionally manual: the
    // pause overlay stays up after focus returns so the player chooses
    // when to drop back into bullets.
    const onLoseFocus = (): void => {
      if (this.userPaused || this.stage.paused) return;
      this.pauseGame();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onLoseFocus);
    const onVisibility = (): void => {
      if (document.hidden) onLoseFocus();
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onLoseFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      // wallsTile is held off the display list, so the scene's normal
      // teardown won't reach it — destroy it explicitly.
      this.wallsTile.destroy();
      if (this.practiceWave) {
        this.registry.set(PRACTICE_HITS_KEY_PREFIX + this.practiceWave.id, this.playerKind.hits);
      }
    });
  }

  private handleResume(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (this.userPaused) {
      this.unpauseGame();
      return;
    }
    // Only own the freeze when nobody else does — dialogue holds the same
    // stage.paused / physics.pause state during cutscenes, and toggling them
    // out from under it would resume physics mid-line.
    if (this.stage.paused) return;
    this.pauseGame();
  }

  private handleExitToMenu(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.userPaused) return;
    this.scene.start('Menu');
  }

  private pauseGame(): void {
    this.userPaused = true;
    this.stage.freeze();
    pauseMusic();
    this.showPauseOverlay();
  }

  private unpauseGame(): void {
    this.userPaused = false;
    this.stage.unfreeze();
    resumeMusic();
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    if (this.pauseOverlay) return;
    const c = this.add.container(0, 0).setDepth(200);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, COLOR_PANEL, 0.85);
    c.add(dim);
    const title = this.add
      .text(GAME_W / 2, GAME_H * 0.4, 'PAUSED', { ...FONT_TITLE, color: COLOR_ACCENT_GOLD_STR })
      .setOrigin(0.5);
    c.add(title);
    const hint = makePrompt(this, GAME_W / 2, GAME_H * 0.55, '<back>  RESUME\n<bomb>  MENU', {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
      align: 'center',
    });
    c.add(hint);
    this.pauseOverlay = c;
  }

  private hidePauseOverlay(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
  }

  private allowsContinue(): boolean {
    return !this.practiceWave && !this.testMode && this.musicMode === null;
  }

  private showContinueOverlay(): void {
    if (this.continueOverlay) return;
    this.stage.freeze();
    pauseMusic();

    const c = this.add.container(0, 0).setDepth(200);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, COLOR_PANEL, 0.85);
    c.add(dim);
    const title = this.add
      .text(GAME_W / 2, GAME_H * 0.38, 'CONTINUE?', { ...FONT_TITLE, color: COLOR_ACCENT_RED_STR })
      .setOrigin(0.5);
    c.add(title);
    const hint = makePrompt(this, GAME_W / 2, GAME_H * 0.55, '<confirm>  CONTINUE\n<back>  QUIT', {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
      align: 'center',
    });
    c.add(hint);
    this.continueOverlay = c;

    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-Z', this.handleContinueConfirm, this);
    kb.on('keydown-ESC', this.handleContinueExit, this);
  }

  private dismissContinueOverlay(): void {
    this.continueOverlay?.destroy();
    this.continueOverlay = null;
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.off('keydown-Z', this.handleContinueConfirm, this);
    kb.off('keydown-ESC', this.handleContinueExit, this);
  }

  private handleContinueConfirm(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.continueOverlay) return;
    this.dismissContinueOverlay();
    this.revivePlayerWithDeathBomb();
  }

  private handleContinueExit(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.continueOverlay) return;
    // Don't bother dismissing the overlay — scene.start tears the whole
    // scene down, taking the container with it.
    this.scene.start('Menu');
  }

  private revivePlayerWithDeathBomb(): void {
    const p = this.player;
    p.alive = true;
    p.hp = this.playerKind.hp;
    p.body.enable = true;
    p.setVelocity(0, 0);
    p.setVisible(true);
    p.setAlpha(1);
    p.clearTint();
    if (p.anims.isPaused) p.anims.resume();
    p.updateAnim();
    p.render();

    // Drop any pointerdown that landed on the bomb circle while the
    // overlay was up so unfreezing doesn't immediately burn a bomb.
    this.consumeBombPress();
    this.stage.unfreeze();
    resumeMusic();

    activateDeathBomb(p, this.stage);
  }

  override update(time: number, delta: number): void {
    // Death check first — placement matters because of Phaser 3's frame order.
    //
    // Arcade physics runs on the SceneEvents.UPDATE event, which fires BEFORE
    // the scene's update() method:
    //
    //   PRE_UPDATE → UPDATE (physics integrates + overlap callbacks fire) →
    //   scene.update() (← we are here) → POST_UPDATE → PRE_RENDER → render
    //
    // So a fatal player-vs-bullet overlap in this frame has already called
    // player.die() before this method runs; alive === false is visible from
    // line one. We have to bail before stage.update so scripts never tick with
    // a dead player.
    //
    // Why not check at the bottom of update (right before render)? scene.start
    // only queues the scene swap for next frame; it doesn't preempt the rest
    // of this update. By then stage.update has already run with alive === false
    // — exactly the tick we want to skip. (If physics ran AFTER scene.update,
    // the death wouldn't have happened yet during stage.update and the
    // end-of-update check would be fine — but Phaser 3's order is the other
    // way around, so top-of-update is the only safe slot.)
    if (!this.player.alive) {
      if (this.continueOverlay !== null || this.deathStarted) return;
      // Continue prompt only in the real stage — practice / test / music
      // modes either keep the player invincible or never decrement HP, so
      // a death there is anomalous and falls through to the death sequence.
      if (this.allowsContinue()) this.showContinueOverlay();
      else this.startDeathSequence();
      return;
    }

    // Tick handlers first, controls last (before Phaser's physics step). This
    // lets a script flip stage.paused or player.controlsEnabled this frame and
    // have those state changes land before controlUpdate decides whether to
    // read input or auto-fire — otherwise a held fire key spawns a bullet in
    // the same frame (or the frame before) a cutscene begins, and it pops into
    // view as physics integrates.
    this.stage.update(time, delta);
    if (!this.stage.paused) {
      // Floor only scrolls between encounters — `stage.running` is the
      // single source of truth, flipped around each wave by the stage
      // script. The player anim follows the same flag (see
      // Player.updateAnim), so MC + floor stay in sync. Scroll rate is
      // additionally scaled by `scrollSpeedMultiplier` so cutscenes can
      // dial it (e.g. the ending walks home at 0.5×).
      if (this.stage.running) {
        const advance = delta * CORRIDOR_SCROLL_PX_PER_MS * this.stage.scrollSpeedMultiplier;
        this.bg.tilePositionY -= advance;
        this.bgScrollY += advance;
      }
      // Mirror the scroll onto the stage so script helpers (alignDoor,
      // pickDoorCenterY) read the same number that drives the door
      // rasterisation below.
      this.stage.bgScrollY = this.bgScrollY;
      // Doors ride the floor: each slot's y is its phase offset plus the
      // shared scroll, wrapped through DOOR_CYCLE so the trio cycles
      // through the canvas with no gaps. Subtract DOOR_H so the wrap
      // happens fully off-screen at the top instead of popping in.
      // Round to an integer pixel: the door renders through the main
      // scene camera (roundPixels=true via pixelArt) while the eraser
      // hits the wallsRt's own camera (roundPixels=false by default), so
      // a fractional y would let the two rasterise to slightly different
      // rows and the door panels would flicker in and out. Rounding once
      // up front feeds both paths (and both halves of each slot) the
      // same integer.
      const doorYs = computeDoorYs(this.bgScrollY);

      // Refresh the walls layer: blit the tiled walls into the RT, then
      // erase each slot's two panel bboxes (one per side). The bbox
      // texture and a single door panel frame have the same native size
      // and are drawn at the same x/y with origin (0, 0), so Phaser's
      // batchTextureFrame path produces identical pixel coverage.
      this.wallsRt.clear();
      this.wallsRt.draw(this.wallsTile, 0, 0);
      this.doorSlots.forEach((slot, i) => {
        const y = doorYs[i] ?? 0;
        slot.left.y = y;
        slot.right.y = y;
        this.wallsRt.erase(BG_DOORS_BBOX_KEY, 0, y);
        this.wallsRt.erase(BG_DOORS_BBOX_KEY, GAME_W - WALL_W, y);
      });

      this.player.controlUpdate();
    } else {
      // Drop any queued bomb tap while paused — every pointerdown
      // advances dialogue, so a tap that happened to land in a bomb
      // circle would otherwise fire a bomb the moment play resumes.
      this.consumeBombPress();
    }
    // Player isn't part of stage.active, so its anim doesn't get the per-tick
    // refresh that pooled entities get inside stage.update — drive it here. Run
    // even while paused so the dialogue's first frame doesn't show a stale anim
    // from before the cutscene started.
    this.player.updateAnim();

    const hostile = this.stage.damages.player.countActive(true);
    const mode = this.practiceWave ? `   PRACTICE: ${this.practiceWave.name}` : '';
    this.hud.setText(`hostile: ${hostile}   fps: ${Math.round(this.game.loop.actualFps)}${mode}`);

    this.bossNameText.setText(this.stage.bossName ?? '');

    if (this.debugHud) this.debugHud.setText(this.formatDebugLine());
  }

  // Death animation: freeze the world (stage script + physics), strobe the
  // player sprite a few times, hide it, then sit on the frozen frame for a
  // beat before swapping to End. Tweens and scene.time keep running because
  // we only pause physics — not the scene itself — so the sequence
  // self-completes without needing update() ticks.
  private startDeathSequence(): void {
    this.deathStarted = true;
    this.stage.freeze();

    playerDeath();

    // Stepped strobe: 8 toggles at ~80ms = ~640ms of flicker. setTint
    // alternates between white (full visible) and a transparent alpha
    // toggle would also work, but alpha is cheaper and reads clearly.
    const FLICKER_TOGGLES = 8;
    const FLICKER_INTERVAL_MS = 80;
    let toggle = 0;
    this.time.addEvent({
      delay: FLICKER_INTERVAL_MS,
      repeat: FLICKER_TOGGLES - 1,
      callback: () => {
        toggle++;
        this.player.setAlpha(toggle % 2 === 0 ? 1 : 0);
      },
    });

    const FLICKER_TOTAL_MS = FLICKER_INTERVAL_MS * FLICKER_TOGGLES;
    const POST_FLICKER_HOLD_MS = 600;
    this.time.delayedCall(FLICKER_TOTAL_MS, () => {
      this.player.setVisible(false);
    });
    this.time.delayedCall(FLICKER_TOTAL_MS + POST_FLICKER_HOLD_MS, () => {
      this.scene.start('End', { won: false });
    });
  }

  private formatDebugLine(): string {
    const m = getMusicTime();
    const trackPart = m === null ? 'track: (none)  t: -' : `track: ${m.key}  t: ${m.time.toFixed(2)}s`;

    const wave = this.stage.wave;
    const secondLineParts: string[] = [];
    if (wave) secondLineParts.push(`wave: ${wave}`);
    const reason = this.stage.lastYieldReason;
    if (reason) secondLineParts.push(`yield: ${reason}`);

    return secondLineParts.length > 0 ? `${trackPart}\n${secondLineParts.join('  ')}` : trackPart;
  }
}
