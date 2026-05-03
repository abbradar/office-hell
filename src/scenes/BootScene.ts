import Phaser from 'phaser';
import { setAudioContext } from '../audio/sfx';
import { BULLET_RADIUS, GAME_W } from '../config';
import boss1Url from '../sprites/boss1.png';
import coworker1Url from '../sprites/coworker1.png';
import coworker2Url from '../sprites/coworker2.png';
import playerSpriteUrl from '../sprites/player.png';

export const PLAYER_FRAME_W = 48;
export const PLAYER_FRAME_H = 48;
export const ENEMY_FRAME_W = 48;
export const ENEMY_FRAME_H = 48;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.spritesheet('player', playerSpriteUrl, {
      frameWidth: PLAYER_FRAME_W,
      frameHeight: PLAYER_FRAME_H,
    });
    this.load.spritesheet('coworker1', coworker1Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    this.load.spritesheet('coworker2', coworker2Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    this.load.spritesheet('boss1', boss1Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });

    const g = this.add.graphics();

    const bd = BULLET_RADIUS * 2;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(BULLET_RADIUS, BULLET_RADIUS, BULLET_RADIUS);
    g.generateTexture('bullet', bd, bd);
    g.clear();

    g.fillStyle(0x6cf0a8, 1);
    g.fillRect(0, 0, 6, 14);
    g.fillStyle(0xffffff, 1);
    g.fillRect(1, 1, 4, 5);
    g.generateTexture('playerBullet', 6, 14);
    g.clear();

    // Report bullet placeholder — paper-coloured rectangle with a darker border.
    // Will be swapped for an actual paper sprite later.
    const rw = 8;
    const rh = 10;
    g.fillStyle(0xc0b890, 1);
    g.fillRect(0, 0, rw, rh);
    g.fillStyle(0xf0e8d0, 1);
    g.fillRect(1, 1, rw - 2, rh - 2);
    g.generateTexture('reportBullet', rw, rh);
    g.clear();

    // Missed-call bullet placeholder — red square with a white core, to read as
    // "phone notification" at a glance and stand out from the round white bullet.
    // Will be swapped for an actual missed-call sprite later.
    const mc = 8;
    g.fillStyle(0xff5577, 1);
    g.fillRect(0, 0, mc, mc);
    g.fillStyle(0xffffff, 1);
    g.fillRect(2, 2, mc - 4, mc - 4);
    g.generateTexture('missedCall', mc, mc);
    g.clear();

    // Trash bin placeholder for the bomb effect — flat front-on can with a lid
    // overhang and a few vertical ribs. Drawn high enough that the player can
    // tell at a glance where their bullets are being yanked toward.
    const tw = 36;
    const th = 42;
    g.fillStyle(0x222222, 1);
    g.fillRect(4, 8, tw - 8, th - 8);
    g.fillStyle(0x666666, 1);
    g.fillRect(2, 8, tw - 4, th - 8);
    g.fillStyle(0x888888, 1);
    g.fillRect(0, 0, tw, 8);
    g.fillStyle(0x4a4a4a, 1);
    g.fillRect(9, 14, 2, th - 20);
    g.fillRect(17, 14, 2, th - 20);
    g.fillRect(25, 14, 2, th - 20);
    g.generateTexture('trashBin', tw, th);
    g.clear();

    const cw = GAME_W;
    const ch = 128;
    g.fillStyle(0x1a1a28, 1);
    g.fillRect(0, 0, cw, ch);
    g.fillStyle(0x3a3a55, 1);
    g.fillRect(0, 0, 40, ch);
    g.fillRect(cw - 40, 0, 40, ch);
    g.fillStyle(0x6262a0, 1);
    g.fillRect(38, 0, 2, ch);
    g.fillRect(cw - 40, 0, 2, ch);
    g.fillStyle(0x303048, 1);
    g.fillRect(40, 0, cw - 80, 2);
    g.generateTexture('corridor', cw, ch);
    g.clear();

    const sw = GAME_W;
    const sh = 256;
    g.fillStyle(0xa0a8d0, 1);
    for (let i = 0; i < 32; i++) {
      g.fillRect(Phaser.Math.Between(48, sw - 48), Phaser.Math.Between(0, sh - 1), 2, 2);
    }
    g.fillStyle(0x8090c0, 0.7);
    for (let i = 0; i < 24; i++) {
      g.fillRect(Phaser.Math.Between(48, sw - 48), Phaser.Math.Between(0, sh - 1), 1, 1);
    }
    g.generateTexture('corridor_specks', sw, sh);

    g.destroy();
  }

  create(): void {
    this.anims.create({
      key: 'player_walk',
      frames: this.anims.generateFrameNumbers('player', { start: 0, end: 5 }),
      frameRate: 10,
      repeat: -1,
    });

    // Coworker / boss sheets are 3 cols × 6 rows of 48×48 (RPG-Maker style).
    // Frames 0–2 are the south-facing walk cycle; ping-pong them with the
    // standard 1-0-1-2 sequence for a smooth gait.
    for (const key of ['coworker1', 'coworker2', 'boss1']) {
      this.anims.create({
        key: `${key}_walk`,
        frames: this.anims.generateFrameNumbers(key, { frames: [1, 0, 1, 2] }),
        frameRate: 6,
        repeat: -1,
      });
    }

    // Phaser's WebAudioSoundManager owns the AudioContext + its unlock-on-
    // user-gesture handling. Reuse it for our procedural SFX so we don't have
    // to re-implement either. Falls through silently on NoAudioSoundManager.
    if (this.sound instanceof Phaser.Sound.WebAudioSoundManager) {
      setAudioContext(this.sound.context);
    }

    this.scene.start('Menu');
  }
}
