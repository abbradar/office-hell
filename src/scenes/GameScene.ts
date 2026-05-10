import Phaser from 'phaser';
import { getMusicTime, pauseMusic, resumeMusic, stopMusicLoop } from '../audio/music/loop';
import { playerDeath } from '../audio/sfx/events';
import { DEADZONE_Y, GAME_H, GAME_W, HEADER_H, WALL_W } from '../config';
import { activateDeathBomb } from '../content/bomb';
import { getSelectedCharacter } from '../content/characters';
import { computeDoorYs, DOOR_COUNT, DOOR_H, DOOR_SPACING } from '../content/doors';
import { stageKaedalus } from '../content/kaedalusStage';
import { stageMonsterRpg } from '../content/monsterRpgStage';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import { stageTest } from '../content/testStage';
import { BG_DOORS_BBOX_KEY, BG_DOORS_KEY, BG_FLOOR_KEY, BG_WALLS_KEY } from '../content/textures';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { displayState } from '../render/displayState';
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

// HUD text refresh budget: setText on a Phaser.Text re-rasterises the
// backing canvas and re-uploads it via gl.texImage2D. Doing that every
// frame (because actualFps changes every frame) was capping us at ~57 fps
// on top of the GPU pipeline, independent of bullet count. 1 Hz is plenty
// for "hostile / fps / practice mode" — the only sub-second thing in the
// line is the displayed FPS itself.
const HUD_REFRESH_MS = 1000;

// Door layout constants live in src/content/doors.ts so stage scripts
// can compute door y values from the same formula. See that module for
// the cycle / spacing rationale.
//
// Background rendering pipeline — four stacked layers, drawn back-to-front
// every frame:
//   1. Floor   (depth -10, BG_FLOOR_KEY)  — full-canvas TileSprite,
//                                            vertical scroll = corridor
//                                            advance.
//   2. Walls   (depth  -9, wallsRt)       — RenderTexture: tiled walls
//                                            drawn in...
//   3. ...then BG_DOORS_BBOX_KEY is erased at each visible door slot's
//      y, punching through to the floor in the rect the doors will
//      cover. (Same layer, not a separate display object — the third
//      logical step happens inside the walls RT.)
//   4. Doors   (depth  -8, doorSlots)     — full-width door Image drawn
//                                            at the same (x, y) as the
//                                            eraser, filling the cutout.
// Eraser and door Image share native size + origin (0, 0), so they
// cover the exact same rect — the door pixels can't drift past the
// cutout edge.

const BOMB_BUTTON_RADIUS = 50;
const BOMB_BUTTON_X = GAME_W / 2;

// With a control band, the bomb button sits at the canvas bottom — the
// rest of the band is the finger-follow movement zone (see
// getTouchTargetX). Without a band (desktop), it tucks above the bottom
// of the playfield.
function bombButtonY(): number {
  return displayState.logicalH > GAME_H ? displayState.logicalH - 60 : GAME_H - 220;
}

// Pointer.x / .y arrive in canvas-internal device pixels because the
// canvas is sized at parent CSS × DPR (see main.ts). The world is rendered
// into a centered scaled rect inside that — convert to logical coords by
// subtracting the world rect's offset and dividing by displayState.scale.
function pointerLogicalX(x: number): number {
  return (x - displayState.offsetX) / displayState.scale;
}
function pointerLogicalY(y: number): number {
  return (y - displayState.offsetY) / displayState.scale;
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

// Per-run state container. Phaser reuses the same Scene instance across
// `scene.start('Game')`, so class field initializers (e.g. `= 0`, `= []`)
// only fire at construction — any per-run state declared that way leaks
// the previous run's value when create() runs again. Bundling everything
// per-run into one object lets init() rebuild it from scratch each time
// and makes "did I forget to reset that field?" a type error: anything
// added here gets initialised by `RunState`'s ctor or TypeScript complains.
//
// Anything assigned with `!:` and reassigned every create() (player,
// stage, the various Text / RenderTexture refs) stays out of here —
// those are already fresh by the time update() runs. Only fields that
// are set at runtime (mutated by handlers, accumulated across frames)
// live here.
class RunState {
  // From init data — set once at scene entry.
  readonly practiceWave: WaveDef | null;
  readonly testMode: boolean;
  readonly musicMode: 'kaedalus' | 'monster-rpg' | null;
  // ESC pause state. Distinct from `stage.paused`, which dialogues also set —
  // we share the same physics/script freeze (set stage.paused + physics.pause)
  // but track this flag so X can route to "exit to menu" only while the
  // pause overlay owns the freeze. Only entered when no dialogue is active,
  // so the two pause owners never overlap.
  userPaused = false;
  pauseOverlay: Phaser.GameObjects.Container | null = null;
  // Set once when the player has died and we've kicked off the flicker /
  // game-over transition. Idempotent: keeps update() from re-firing the
  // sequence on every subsequent frame while the animation plays out.
  deathStarted = false;
  // Continue overlay shown when HP hits 0 in the real stage. Holds the
  // freeze (stage.freeze + paused music) until the player picks
  // continue (revive + death-bomb) or exit-to-menu. Cleared when either
  // path runs; subsequent deaths re-show it. Null in practice / test /
  // music modes — those fall through to startDeathSequence.
  continueOverlay: Phaser.GameObjects.Container | null = null;
  // Edge-triggered touch bomb input — matches keyboard JustDown(X)
  // semantics. Set on a pointerdown inside the bomb circle and drained
  // by consumeBombPress. Tracking only pointerdown (not pointermove)
  // means a finger sliding off the move pad into the bomb region won't
  // accidentally burn a bomb.
  bombPending = false;
  // Accumulated forward scroll, in pixels. Mirrors `-bg.tilePositionY` (the
  // floor's tile offset) and drives the doors' wrap-around y. Tracked
  // separately so the doors keep their phase across the modulo without
  // having to reason about tilePositionY's seed offset.
  bgScrollY = 0;
  // Doors: each visible "door slot" is one full-canvas-width Image of the
  // doors texture (transparent in the middle, panels at the wall columns).
  // y is recomputed each frame from the shared scroll offset. Built fresh
  // each create() — the array MUST start empty there or the loop appends
  // a second set on top of the previous run's destroyed Images.
  readonly doorSlots: Phaser.GameObjects.Image[] = [];
  // HUD text is a canvas-backed Phaser.Text — every changed string redraws
  // the canvas and re-uploads it via gl.texImage2D, which serialises the
  // WebGL pipeline. The fps + hostile-count line was rebuilt every frame
  // (actualFps changes constantly), so we throttle to 1 Hz here. Reset on
  // every tick that exceeds the budget; HUD freeze during pause is fine
  // because pause itself is a longer-than-1 s state.
  hudAccumMs = HUD_REFRESH_MS;

  constructor(data: GameSceneData | undefined) {
    this.practiceWave = data?.practice ?? null;
    this.testMode = data?.test ?? false;
    this.musicMode = data?.music ?? null;
  }
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private stage!: StageManager;
  private hud!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private bossNameText!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  // Walls layer baked per-frame: walls texture drawn in, then the doors
  // silhouette (BG_DOORS_BBOX_KEY) is erased at each door's y. Eraser and
  // door Image share native size + origin (0, 0), so the cutout matches
  // the door panel pixel for pixel.
  private wallsRt!: Phaser.GameObjects.RenderTexture;
  // Off-display TileSprite of the 1px-tall walls texture, sized to the
  // full canvas. Drawn into wallsRt each frame so the wall pattern tiles
  // vertically across the playfield in a single RT.draw() call instead of
  // looping the 1px source GAME_H times.
  private wallsTile!: Phaser.GameObjects.TileSprite;
  private debugHud: Phaser.GameObjects.Text | null = null;
  private playerKind!: PlayerKind;
  // Per-run mutable state — see RunState. Built fresh in init() each
  // entry; never assign to fields that should be in here directly.
  private state!: RunState;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.state = new RunState(data);
    // pauseGame() sets `scene.time.paused = true` to freeze realSeconds
    // waits during the ESC pause overlay. Phaser's Clock.shutdown() does
    // NOT reset `paused`, and the same Clock instance is reused across
    // scene.start, so a hard exit from the pause menu (X → Menu) leaves
    // the clock paused for the next run. Without this reset, every
    // `realSeconds` yield (e.g. bombSkipPoll's `realSeconds: 0.05` poll)
    // is parked forever in the next session and X-skip silently no-ops.
    this.time.paused = false;
  }

  consumeBombPress(): boolean {
    const pending = this.state.bombPending;
    this.state.bombPending = false;
    return pending;
  }

  // Finger-follow movement target: (x, y) of the most recently pressed
  // active pointer in logical coords, or null if no movement pointer is
  // held. Pointers currently inside the bomb circle are excluded — both
  // because a tap there is already handled as a bomb press and because
  // a finger resting on the bomb shouldn't yank the player to centre.
  getTouchTarget(): { x: number; y: number } | null {
    let chosen: { x: number; y: number } | null = null;
    let chosenTime = -Infinity;
    const bombR2 = BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS;
    const bombY = bombButtonY();
    for (const p of this.game.input.pointers) {
      if (!p.isDown) continue;
      const lx = pointerLogicalX(p.x);
      const ly = pointerLogicalY(p.y);
      const dxB = lx - BOMB_BUTTON_X;
      const dyB = ly - bombY;
      if (dxB * dxB + dyB * dyB <= bombR2) continue;
      if (p.downTime > chosenTime) {
        chosen = { x: lx, y: ly };
        chosenTime = p.downTime;
      }
    }
    return chosen;
  }

  create(): void {
    bindLogicalCamera(this);
    stopMusicLoop();

    // Scene-level pointer listener auto-cleans on shutdown. Pointer
    // coords are already in game space (Phaser's scale manager handles
    // the canvas-fit transform), so a plain distance check is enough.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const dx = pointerLogicalX(pointer.x) - BOMB_BUTTON_X;
      const dy = pointerLogicalY(pointer.y) - bombButtonY();
      if (dx * dx + dy * dy <= BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS) this.state.bombPending = true;
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

    // Doors: each slot is one full-canvas-width Image of the doors
    // texture, drawn at canvas (0, slot_y). The PNG has door panels at
    // the wall columns (x=0..WALL_W-1, x=GAME_W-WALL_W..GAME_W-1) and is
    // transparent in the middle, so a single Image renders both panels
    // and never touches the corridor. Per-frame the same y drives
    // wallsRt.erase() at (0, y) so the wall cutout tracks the door
    // panels exactly.
    for (let i = 0; i < DOOR_COUNT; i++) {
      const startY = i * DOOR_SPACING - DOOR_H;
      this.state.doorSlots.push(this.add.image(0, startY, BG_DOORS_KEY).setOrigin(0, 0).setDepth(-8));
    }

    // Mask the touch-control band so bullets that drift below the playfield
    // (within CULL_MARGIN before being culled) don't peek through behind the
    // buttons. Depth 50 sits above entities (default 0) and below HUD (99+).
    // displayState.logicalH is the world's logical height (= GAME_H on
    // desktop, larger on touch); the band is anything past GAME_H.
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
    const isRealStage = !this.state.practiceWave && !this.state.testMode && this.state.musicMode === null;
    this.playerKind = new PlayerKind({
      hpText: this.hpText,
      bombsText: this.bombsText,
      practice: this.state.practiceWave !== null,
      character,
      bombs: isRealStage ? 0 : undefined,
    });
    this.player = new Player(this, this.stage, this.playerKind);
    this.stage.player = this.player;

    // Music + sync test stages: pin player invincible for the whole run so
    // dying doesn't interrupt the timing checks. Pushed once with no pop —
    // bombs still push/pop on top, but the base depth stays at 1.
    if (this.state.testMode || this.state.musicMode !== null) this.player.pushInvincible();

    const stageKind =
      this.state.musicMode === 'kaedalus'
        ? stageKaedalus
        : this.state.musicMode === 'monster-rpg'
          ? stageMonsterRpg
          : this.state.testMode
            ? stageTest
            : this.state.practiceWave
              ? makeWaveStage(this.state.practiceWave)
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
      const bombY = bombButtonY();
      // Bomb button — gold accent reads as "the ✱-button" without a
      // separate label. Movement is finger-follow (see getTouchTargetX),
      // so the rest of the touch area is implicit and unmarked.
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
    const debugTinted = this.state.testMode || this.state.musicMode !== null;
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
      if (this.state.userPaused || this.stage.paused) return;
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
      if (this.state.practiceWave) {
        this.registry.set(PRACTICE_HITS_KEY_PREFIX + this.state.practiceWave.id, this.playerKind.hits);
      }
    });
  }

  private handleResume(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (this.state.userPaused) {
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
    if (!this.state.userPaused) return;
    this.scene.start('Menu');
  }

  private pauseGame(): void {
    console.warn(`[menu-open t=${performance.now().toFixed(0)}]`);
    this.state.userPaused = true;
    this.stage.freeze();
    // Freeze Phaser's clock too: `stage.freeze()` only stops the physics
    // and script-frame queues, but `realSeconds` waits (e.g. the
    // `waitTrackEnded` body's `delayedCall`) live on `scene.time` and
    // keep ticking through `freeze()`. Without this pause, the script
    // would advance past `waitTrackEnded` during the overlay and call
    // `playMusicLoop(NEW_KEY)`, starting the next track audibly even
    // though the user is paused. Dialogue/cutscene freezes intentionally
    // leave the clock running — only ESC pause stops it.
    this.time.paused = true;
    pauseMusic();
    this.showPauseOverlay();
  }

  private unpauseGame(): void {
    this.state.userPaused = false;
    this.stage.unfreeze();
    this.time.paused = false;
    resumeMusic();
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    if (this.state.pauseOverlay) return;
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
    this.state.pauseOverlay = c;
  }

  private hidePauseOverlay(): void {
    this.state.pauseOverlay?.destroy();
    this.state.pauseOverlay = null;
  }

  private allowsContinue(): boolean {
    return !this.state.practiceWave && !this.state.testMode && this.state.musicMode === null;
  }

  private showContinueOverlay(): void {
    if (this.state.continueOverlay) return;
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
    this.state.continueOverlay = c;

    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-Z', this.handleContinueConfirm, this);
    kb.on('keydown-ESC', this.handleContinueExit, this);
  }

  private dismissContinueOverlay(): void {
    this.state.continueOverlay?.destroy();
    this.state.continueOverlay = null;
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.off('keydown-Z', this.handleContinueConfirm, this);
    kb.off('keydown-ESC', this.handleContinueExit, this);
  }

  private handleContinueConfirm(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.state.continueOverlay) return;
    this.dismissContinueOverlay();
    this.revivePlayerWithDeathBomb();
  }

  private handleContinueExit(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.state.continueOverlay) return;
    // Don't bother dismissing the overlay — scene.start tears the whole
    // scene down, taking the container with it.
    this.scene.start('Menu');
  }

  private revivePlayerWithDeathBomb(): void {
    const p = this.player;
    this.stage.score.continues++;
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
      if (this.state.continueOverlay !== null || this.state.deathStarted) return;
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
        this.state.bgScrollY += advance;
        // tilePositionY is fed straight into the texture-coord shader uniform
        // (TileSpriteWebGLRenderer) and is NOT affected by camera.roundPixels —
        // a fractional value samples the floor texture at sub-texel offsets,
        // so the scroll advances by uneven visual amounts each frame (judder
        // under variable delta). Drive it from the rounded float accumulator
        // so the displayed position always lands on an integer pixel; the
        // accumulator itself stays float so the next frame's increment and
        // the door-wrap math (computeDoorYs, which rounds its own output)
        // don't lose precision.
        this.bg.tilePositionY = -Math.round(this.state.bgScrollY);
      }
      // Mirror the scroll onto the stage so script helpers (alignDoor,
      // pickDoorCenterY) read the same number that drives the door
      // rasterisation below.
      this.stage.bgScrollY = this.state.bgScrollY;
      // Doors ride the floor: each slot's y is its phase offset plus the
      // shared scroll, wrapped through DOOR_CYCLE so the trio cycles
      // through the canvas with no gaps. Subtract DOOR_H so the wrap
      // happens fully off-screen at the top instead of popping in.
      // Round to an integer pixel: the door renders through the main
      // scene camera (roundPixels=true via pixelArt) while the eraser
      // hits the wallsRt's own camera (roundPixels=false by default), so
      // a fractional y would let the two rasterise to slightly different
      // rows and the door panels would flicker in and out. Rounding once
      // up front feeds both paths the same integer.
      const doorYs = computeDoorYs(this.state.bgScrollY);

      // Refresh the walls layer: blit the tiled walls into the RT, then
      // erase each slot's full-width bbox. Eraser and door Image share
      // native size + origin (0, 0), so Phaser's batchTextureFrame path
      // produces identical pixel coverage.
      this.wallsRt.clear();
      this.wallsRt.draw(this.wallsTile, 0, 0);
      this.state.doorSlots.forEach((slot, i) => {
        const y = doorYs[i] ?? 0;
        slot.y = y;
        this.wallsRt.erase(BG_DOORS_BBOX_KEY, 0, y);
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

    this.state.hudAccumMs += delta;
    if (this.state.hudAccumMs >= HUD_REFRESH_MS) {
      this.state.hudAccumMs = 0;
      const hostile = this.stage.damages.player.countActive(true);
      const mode = this.state.practiceWave ? `   PRACTICE: ${this.state.practiceWave.name}` : '';
      this.hud.setText(`hostile: ${hostile}   fps: ${Math.round(this.game.loop.actualFps)}${mode}`);
    }

    this.bossNameText.setText(this.stage.bossName ?? '');

    if (this.debugHud) this.debugHud.setText(this.formatDebugLine());
  }

  // Death animation: freeze the world (stage script + physics), strobe the
  // player sprite a few times, hide it, then sit on the frozen frame for a
  // beat before swapping to End. Tweens and scene.time keep running because
  // we only pause physics — not the scene itself — so the sequence
  // self-completes without needing update() ticks.
  private startDeathSequence(): void {
    this.state.deathStarted = true;
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
    // Whole-second precision: the formatted string only changes once a
    // second, so Phaser.Text.setText hits its `value !== this._text`
    // early-bail and skips the canvas redraw + gl.texImage2D upload on
    // most frames. wave / yield reason / track key change rarely enough
    // that they pass through cheaply on the same path.
    const trackPart = m === null ? 'track: (none)  t: -' : `track: ${m.key}  t: ${Math.floor(m.time)}s`;

    const wave = this.stage.wave;
    const secondLineParts: string[] = [];
    if (wave) secondLineParts.push(`wave: ${wave}`);
    const reason = this.stage.lastYieldReason;
    if (reason) secondLineParts.push(`yield: ${reason}`);

    return secondLineParts.length > 0 ? `${trackPart}\n${secondLineParts.join('  ')}` : trackPart;
  }
}
