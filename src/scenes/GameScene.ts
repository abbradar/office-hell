import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Player } from '../entities/Player';
import { EntityPool } from '../entities/EntityPool';
import { stage } from '../content/stage';
import { hit } from '../audio/sfx';

const CORRIDOR_SCROLL_PX_PER_MS = 0.25;
const SPECKS_SCROLL_PX_PER_MS = 0.55;

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private pool!: EntityPool;
  private hud!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  private specks!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('Game');
  }

  create(): void {
    this.bg = this.add
      .tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor')
      .setDepth(-10);
    this.specks = this.add
      .tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'corridor_specks')
      .setDepth(-9);

    this.pool = new EntityPool(this);
    this.player = new Player(this, GAME_W / 2);
    this.pool.player.x = this.player.x;
    this.pool.player.y = this.player.y;

    this.pool.spawn(stage, 0, 0);

    this.physics.add.overlap(this.player, this.pool.hostileGroup, () => {
      hit();
      this.scene.restart();
    });

    this.hud = this.add
      .text(8, 8, '', { color: '#aaaaaa', fontSize: '12px' })
      .setScrollFactor(0);
  }

  override update(time: number, delta: number): void {
    this.bg.tilePositionY -= delta * CORRIDOR_SCROLL_PX_PER_MS;
    this.specks.tilePositionY -= delta * SPECKS_SCROLL_PX_PER_MS;

    this.player.update();
    this.pool.player.x = this.player.x;
    this.pool.player.y = this.player.y;
    this.pool.update(time, delta);

    const live = this.pool.hostileGroup.countActive(true);
    this.hud.setText(
      `tap left/right or arrows  hostile: ${live}  fps: ${Math.round(this.game.loop.actualFps)}`,
    );
  }
}
