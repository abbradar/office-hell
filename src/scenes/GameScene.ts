import Phaser from 'phaser';
import { getMusicTime, stopMusicLoop } from '../audio/music/loop';
import { BUTTON_BAND_H, CANVAS_W, GAME_H, GAME_W } from '../config';
import { getSelectedCharacter } from '../content/characters';
import { stageKaedalus } from '../content/kaedalusStage';
import { stageMonsterRpg } from '../content/monsterRpgStage';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import { stageTest } from '../content/testStage';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import {
  BOMB_BUTTON_RADIUS,
  BOMB_BUTTON_X,
  BOMB_BUTTON_Y,
  clearBombPress,
  TOUCH_BUTTON_RADIUS,
  TOUCH_BUTTON_Y,
} from '../input/touch';
import { StageManager } from '../script/StageManager';
import { DAMAGE_CLASSES } from '../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { makePrompt } from '../ui/prompt';

const CORRIDOR_SCROLL_PX_PER_MS = 0.25;
const SPECKS_SCROLL_PX_PER_MS = 0.55;

const HEADER_H = 28;

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
  private specks!: Phaser.GameObjects.TileSprite;
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

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.practiceWave = data?.practice ?? null;
    this.testMode = data?.test ?? false;
    this.musicMode = data?.music ?? null;
  }

  create(): void {
    stopMusicLoop();

    this.bg = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor').setDepth(-10);
    this.specks = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor_specks').setDepth(-9);

    // Mask the touch-control band so bullets that drift below the playfield
    // (within CULL_MARGIN before being culled) don't peek through behind the
    // buttons. Depth 50 sits above entities (default 0) and below HUD (99+).
    if (BUTTON_BAND_H > 0) {
      this.add.rectangle(0, GAME_H, CANVAS_W, BUTTON_BAND_H, 0x10101a).setOrigin(0, 0).setDepth(50);
    }

    this.stage = new StageManager(this);

    this.add.rectangle(0, 0, GAME_W, HEADER_H, 0x000000, 0.55).setOrigin(0, 0).setDepth(99);
    this.add
      .rectangle(0, HEADER_H - 1, GAME_W, 1, 0xffffff, 0.18)
      .setOrigin(0, 0)
      .setDepth(99);

    this.hpText = this.add
      .text(8, HEADER_H / 2, '', { ...FONT_MENU, color: '#ff5577' })
      .setOrigin(0, 0.5)
      .setDepth(100);
    // Bombs sit just right of HP. Allowing ~64px of HP slot covers the
    // widest hp string ("♥♥") at FONT_MENU 16px.
    this.bombsText = this.add
      .text(72, HEADER_H / 2, '', { ...FONT_MENU, color: '#ffd866' })
      .setOrigin(0, 0.5)
      .setDepth(100);
    this.bossNameText = this.add
      .text(GAME_W / 2, HEADER_H / 2, '', { ...FONT_DIALOGUE_SM, color: '#ffffff' })
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
      this.add
        .circle(0, TOUCH_BUTTON_Y, TOUCH_BUTTON_RADIUS, 0xffffff, 0.12)
        .setStrokeStyle(2, 0xffffff, 0.35)
        .setDepth(100);
      this.add
        .circle(GAME_W, TOUCH_BUTTON_Y, TOUCH_BUTTON_RADIUS, 0xffffff, 0.12)
        .setStrokeStyle(2, 0xffffff, 0.35)
        .setDepth(100);
      this.add
        .text(28, TOUCH_BUTTON_Y, '◀', { color: '#ffffff', fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);
      this.add
        .text(GAME_W - 28, TOUCH_BUTTON_Y, '▶', { color: '#ffffff', fontSize: '34px' })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setDepth(101);

      // Bomb button — yellow tint matches the bombs HUD glyph (#ffd866)
      // so the button reads as "the ✱-button" without a separate label.
      // Centred between the two corner-clipped move pads so neither thumb
      // sits in front of it during normal play.
      this.add
        .circle(BOMB_BUTTON_X, BOMB_BUTTON_Y, BOMB_BUTTON_RADIUS, 0xffffff, 0.12)
        .setStrokeStyle(2, 0xffd866, 0.5)
        .setDepth(100);
      this.add
        .text(BOMB_BUTTON_X, BOMB_BUTTON_Y, '✱', { color: '#ffd866', fontSize: '30px' })
        .setOrigin(0.5)
        .setAlpha(0.85)
        .setDepth(101);
    }

    this.hud = this.add
      .text(8, HEADER_H + 4, '', { ...FONT_DEBUG, color: '#aaaaaa' })
      .setScrollFactor(0)
      .setDepth(100);

    // Debug HUD (track / t / next / blocked) shown for the real stage and
    // every test/music stage. Test/music modes get the green tint as a
    // "you're in test mode" cue; real-stage version is greyer so it recedes.
    const debugTinted = this.testMode || this.musicMode !== null;
    this.debugHud = this.add
      .text(8, HEADER_H + 20, '', { ...FONT_DEBUG, color: debugTinted ? '#6cf0a8' : '#888888' })
      .setScrollFactor(0)
      .setDepth(100);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    kb.on('keydown-ESC', this.handleEscape, this);
    kb.on('keydown-Z', this.handleResume, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
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
    this.stage.paused = true;
    this.physics.pause();
    this.showPauseOverlay();
  }

  private unpauseGame(): void {
    this.userPaused = false;
    this.stage.paused = false;
    this.physics.resume();
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    if (this.pauseOverlay) return;
    const c = this.add.container(0, 0).setDepth(200);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.55);
    c.add(dim);
    const title = this.add.text(GAME_W / 2, GAME_H * 0.4, 'PAUSED', { ...FONT_TITLE, color: '#ffd866' }).setOrigin(0.5);
    c.add(title);
    const hint = makePrompt(this, GAME_W / 2, GAME_H * 0.55, '<fire>  RESUME\n<back>  MENU', {
      ...FONT_MENU,
      color: '#ffffff',
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
      this.scene.start('End', { won: false });
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
      this.bg.tilePositionY -= delta * CORRIDOR_SCROLL_PX_PER_MS;
      this.specks.tilePositionY -= delta * SPECKS_SCROLL_PX_PER_MS;

      this.player.controlUpdate();
    } else {
      // Drop any queued bomb tap while paused — every pointerdown
      // advances dialogue, so a tap that happened to land in a bomb
      // circle would otherwise fire a bomb the moment play resumes.
      clearBombPress();
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
