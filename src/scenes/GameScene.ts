import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { getSelectedCharacter } from '../content/characters';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import type { Entity } from '../entities/Entity';
import { EntityPool } from '../entities/EntityPool';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import { TOUCH_BUTTON_RADIUS, TOUCH_BUTTON_Y } from '../input/touch';
import { DAMAGE_CLASSES } from '../script/types';

const CORRIDOR_SCROLL_PX_PER_MS = 0.25;
const SPECKS_SCROLL_PX_PER_MS = 0.55;

export const PRACTICE_HITS_KEY_PREFIX = 'practiceHits:';

export type GameSceneData = {
  practice?: WaveDef;
};

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private pool!: EntityPool;
  private hud!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  private specks!: Phaser.GameObjects.TileSprite;
  private practiceWave: WaveDef | null = null;
  private playerKind!: PlayerKind;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.practiceWave = data?.practice ?? null;
  }

  create(): void {
    this.bg = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor').setDepth(-10);
    this.specks = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor_specks').setDepth(-9);

    this.pool = new EntityPool(this);

    this.hpText = this.add
      .text(GAME_W - 8, 8, '', { color: '#ff5577', fontSize: '24px' })
      .setOrigin(1, 0)
      .setDepth(100);

    const character = getSelectedCharacter(this);
    if (!character)
      throw new Error('GameScene started without a selected character — go through CharacterSelect first');

    this.playerKind = new PlayerKind({ hpText: this.hpText, practice: this.practiceWave !== null, character });
    this.player = new Player(this, this.pool, this.playerKind);
    this.pool.player = this.player;

    const stageKind = this.practiceWave ? makeWaveStage(this.practiceWave) : stage;
    this.pool.spawn(stageKind, 0, 0, 0, 0);

    for (const c of DAMAGE_CLASSES) {
      this.physics.add.overlap(this.pool.damages[c], this.pool.damagedBy[c], (a, b) => {
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
    }

    this.hud = this.add.text(8, 8, '', { color: '#aaaaaa', fontSize: '12px' }).setScrollFactor(0).setDepth(100);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.practiceWave) {
        this.registry.set(PRACTICE_HITS_KEY_PREFIX + this.practiceWave.id, this.playerKind.hits);
      }
    });
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
    // line one. We have to bail before pool.update so scripts never tick with
    // a dead player.
    //
    // Why not check at the bottom of update (right before render)? scene.start
    // only queues the scene swap for next frame; it doesn't preempt the rest
    // of this update. By then pool.update has already run with alive === false
    // — exactly the tick we want to skip. (If physics ran AFTER scene.update,
    // the death wouldn't have happened yet during pool.update and the
    // end-of-update check would be fine — but Phaser 3's order is the other
    // way around, so top-of-update is the only safe slot.)
    if (!this.player.alive) {
      this.scene.start('End', { won: false });
      return;
    }

    // Tick handlers first, controls last (before Phaser's physics step). This
    // lets a script flip pool.paused or player.controlsEnabled this frame and
    // have those state changes land before controlUpdate decides whether to
    // read input or auto-fire — otherwise a held fire key spawns a bullet in
    // the same frame (or the frame before) a cutscene begins, and it pops into
    // view as physics integrates.
    this.pool.update(time, delta);
    if (!this.pool.paused) {
      this.bg.tilePositionY -= delta * CORRIDOR_SCROLL_PX_PER_MS;
      this.specks.tilePositionY -= delta * SPECKS_SCROLL_PX_PER_MS;

      this.player.controlUpdate();
    }

    const hostile = this.pool.damages.player.countActive(true);
    const controls = isTouchDevice ? 'buttons: move   tap: fire' : '← →: move   Z: fire';
    const mode = this.practiceWave ? `   PRACTICE: ${this.practiceWave.name}` : '';
    this.hud.setText(
      `${this.player.character.name}   ${controls}   hostile: ${hostile}   fps: ${Math.round(this.game.loop.actualFps)}${mode}`,
    );
  }
}
