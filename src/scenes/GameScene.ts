import Phaser from 'phaser';
import { getMusicTime, pauseMusic, resumeMusic, stopMusicLoop } from '../audio/music/loop';
import { playerDeath } from '../audio/sfx/events';
import { GAME_H, GAME_W } from '../config';
import { getSelectedCharacter } from '../content/characters';
import { stageKaedalus } from '../content/kaedalusStage';
import { stageMonsterRpg } from '../content/monsterRpgStage';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import { stageTest } from '../content/testStage';
import { FLOOR_PATTERN_KEY } from '../content/textures';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
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
  COLOR_WALL_BORDER,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';

const CORRIDOR_SCROLL_PX_PER_MS = 0.8;
const WALL_W = 40;

const HEADER_H = 28;

const TOUCH_BUTTON_RADIUS = 90;
const BOMB_BUTTON_RADIUS = 50;
const BOMB_BUTTON_X = GAME_W / 2;

// On touch devices with a control band, the move pads hug the canvas
// bottom (lower half clips off-screen — the corner position works well
// for a thumb at the edge). Without a band (desktop), they fall back to
// the original in-playfield position.
function touchButtonY(scale: Phaser.Scale.ScaleManager): number {
  return scale.height > GAME_H ? scale.height - 60 : GAME_H - 60;
}

// With a control band, the bomb button sits at the canvas bottom (same y
// as the move pads) — the centre column (x ≈ 90..310) is clear of either
// move circle so the bomb ring is fully visible without overlapping.
// Without a band (desktop), it tucks above the move pad inside the playfield.
function bombButtonY(scale: Phaser.Scale.ScaleManager): number {
  return scale.height > GAME_H ? scale.height - 60 : GAME_H - 220;
}

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
  private practiceWave: WaveDef | null = null;
  private testMode = false;
  private musicMode: 'kaedalus' | 'monster-rpg' | null = null;
  private debugHud: Phaser.GameObjects.Text | null = null;
  private playerKind!: PlayerKind;
  // ESC pause state. Distinct from `stage.paused`, which dialogues also set —
  // we share the same physics/script freeze (set stage.paused + physics.pause)
  // but track this flag so the second ESC routes to "exit to menu" instead of
  // "toggle off". Only entered when no dialogue is active, so the two pause
  // owners never overlap.
  private userPaused = false;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  // Set once when the player has died and we've kicked off the flicker /
  // game-over transition. Idempotent: keeps update() from re-firing the
  // sequence on every subsequent frame while the animation plays out.
  private deathStarted = false;
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
    return anyHeldInCircle(this.game.input.pointers, 0, touchButtonY(this.scale), TOUCH_BUTTON_RADIUS);
  }

  isRightHeld(): boolean {
    return anyHeldInCircle(this.game.input.pointers, GAME_W, touchButtonY(this.scale), TOUCH_BUTTON_RADIUS);
  }

  create(): void {
    stopMusicLoop();

    // Scene-level pointer listener auto-cleans on shutdown. Pointer
    // coords are already in game space (Phaser's scale manager handles
    // the canvas-fit transform), so a plain distance check is enough.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const dx = pointer.x - BOMB_BUTTON_X;
      const dy = pointer.y - bombButtonY(this.scale);
      if (dx * dx + dy * dy <= BOMB_BUTTON_RADIUS * BOMB_BUTTON_RADIUS) this.bombPending = true;
    });

    // Floor: tiled diamond pattern (recolored to two warm greys at boot)
    // scrolling vertically as the corridor advances. Spans the full
    // playfield; wall rects cover the gutters on top.
    this.bg = this.add
      .tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, FLOOR_PATTERN_KEY)
      .setDepth(-10)
      .setTileScale(0.1, 0.1);

    // Walls: static cream strips on each side. They don't scroll — the
    // architecture is fixed, motion reads off the moving floor underneath.
    this.add.rectangle(0, 0, WALL_W, GAME_H, COLOR_WALL).setOrigin(0, 0).setDepth(-9);
    this.add
      .rectangle(GAME_W - WALL_W, 0, WALL_W, GAME_H, COLOR_WALL)
      .setOrigin(0, 0)
      .setDepth(-9);
    // Wall/floor seam — a thin border line on each inner edge.
    this.add
      .rectangle(WALL_W - 2, 0, 2, GAME_H, COLOR_WALL_BORDER)
      .setOrigin(0, 0)
      .setDepth(-8);
    this.add
      .rectangle(GAME_W - WALL_W, 0, 2, GAME_H, COLOR_WALL_BORDER)
      .setOrigin(0, 0)
      .setDepth(-8);

    // Mask the touch-control band so bullets that drift below the playfield
    // (within CULL_MARGIN before being culled) don't peek through behind the
    // buttons. Depth 50 sits above entities (default 0) and below HUD (99+).
    const bandH = this.scale.height - GAME_H;
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
        attacker.kind.targetCollision(attacker, target);
      });
    }

    if (isTouchDevice) {
      const moveY = touchButtonY(this.scale);
      const bombY = bombButtonY(this.scale);
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
      .text(8, HEADER_H + 4, '', { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR })
      .setScrollFactor(0)
      .setDepth(100);

    // Debug HUD (track / t / next / blocked) shown for the real stage and
    // every test/music stage. Test/music modes get the green tint as a
    // "you're in test mode" cue; real-stage version is greyer so it recedes.
    const debugTinted = this.testMode || this.musicMode !== null;
    this.debugHud = this.add
      .text(8, HEADER_H + 20, '', { ...FONT_DEBUG, color: debugTinted ? COLOR_ACCENT_GREEN_STR : COLOR_TEXT_DIM_STR })
      .setScrollFactor(0)
      .setDepth(100);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    kb.on('keydown-ESC', this.handleEscape, this);
    kb.on('keydown-Z', this.handleResume, this);

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
      if (this.practiceWave) {
        this.registry.set(PRACTICE_HITS_KEY_PREFIX + this.practiceWave.id, this.playerKind.hits);
      }
    });
  }

  private handleEscape(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (this.userPaused) {
      this.scene.start('Menu');
      return;
    }
    // Only own the freeze when nobody else does — dialogue holds the same
    // stage.paused / physics.pause state during cutscenes, and toggling them
    // out from under it would resume physics mid-line.
    if (this.stage.paused) return;
    this.pauseGame();
  }

  private handleResume(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.userPaused) return;
    this.unpauseGame();
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
    const hint = makePrompt(this, GAME_W / 2, GAME_H * 0.55, '<fire>  RESUME\n<back>  MENU', {
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
      if (!this.deathStarted) this.startDeathSequence();
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
      // Player.updateAnim), so MC + floor stay in sync.
      if (this.stage.running) {
        this.bg.tilePositionY -= delta * CORRIDOR_SCROLL_PX_PER_MS;
      }

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
