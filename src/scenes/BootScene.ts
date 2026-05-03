import Phaser from 'phaser';
import boss1Url from '../assets/sprites/boss1.png';
import coworker1Url from '../assets/sprites/coworker1.png';
import coworker2Url from '../assets/sprites/coworker2.png';
import playerSpriteUrl from '../assets/sprites/player.png';
import menuLoopUrl from '../assets/audio/loops/high_tech_low_life_-_gl0ryt0th3m4ch1n3_seamless_loop.ogg';
import stage1MetalLoopUrl from '../assets/audio/loops/stage1/boss_battle_8_metal_loop.ogg';
import stage1MetalOpeningUrl from '../assets/audio/loops/stage1/boss_battle_8_metal_opening.ogg';
import stage1Retro01LoopUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_01_loop.ogg';
import stage1RetroOpeningUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_01_opening.ogg';
import stage1Retro02LoopUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_02_loop.ogg';
import clickSfxUrl from '../assets/audio/sfx/switch20.wav';
import { initBuses } from '../audio/buses';
import {
  CLICK_SFX_KEY,
  MENU_LOOP_KEY,
  STAGE1_METAL_LOOP_KEY,
  STAGE1_METAL_OPENING_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
} from '../audio/keys';
import { playMusicLoop, setMusicManager } from '../audio/music/loop';
import { setSoundManager, setVoiceCap } from '../audio/sfx/pool';
import { BULLET_RADIUS, GAME_H, GAME_W } from '../config';

export const PLAYER_FRAME_W = 48;
export const PLAYER_FRAME_H = 48;
export const ENEMY_FRAME_W = 48;
export const ENEMY_FRAME_H = 48;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.showLoadingUI();

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
    // Sales & important-client placeholders — reuse coworker sheets until the
    // custom character art for each lands. The keys are reserved so swapping
    // in the real sprites is just changing these URLs.
    this.load.spritesheet('sales', coworker1Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    this.load.spritesheet('importantClient', coworker2Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    this.load.spritesheet('gymBro', boss1Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    // Shrunk-old-man (stage boss "Mr. Hodges") placeholder until the retiree
    // art lands.
    this.load.spritesheet('shrunkOldMan', coworker2Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    // HR coordinator placeholder — reused for the bickering trio until the
    // dedicated HR sheet lands.
    this.load.spritesheet('hr', coworker1Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });
    // IT Admin placeholder — reused coworker sheet until the sysop art lands.
    this.load.spritesheet('itAdmin', coworker2Url, {
      frameWidth: ENEMY_FRAME_W,
      frameHeight: ENEMY_FRAME_H,
    });

    this.load.audio(MENU_LOOP_KEY, menuLoopUrl);
    this.load.audio(CLICK_SFX_KEY, clickSfxUrl);
    this.load.audio(STAGE1_RETRO_OPENING_KEY, stage1RetroOpeningUrl);
    this.load.audio(STAGE1_RETRO_01_LOOP_KEY, stage1Retro01LoopUrl);
    this.load.audio(STAGE1_RETRO_02_LOOP_KEY, stage1Retro02LoopUrl);
    this.load.audio(STAGE1_METAL_OPENING_KEY, stage1MetalOpeningUrl);
    this.load.audio(STAGE1_METAL_LOOP_KEY, stage1MetalLoopUrl);

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
    for (const key of [
      'coworker1',
      'coworker2',
      'boss1',
      'sales',
      'importantClient',
      'gymBro',
      'shrunkOldMan',
      'hr',
      'itAdmin',
    ]) {
      this.anims.create({
        key: `${key}_walk`,
        frames: this.anims.generateFrameNumbers(key, { frames: [1, 0, 1, 2] }),
        frameRate: 6,
        repeat: -1,
      });
    }

    initBuses(this.sound);
    setSoundManager(this.sound);
    setMusicManager(this.sound);
    setVoiceCap(CLICK_SFX_KEY, 4);

    playMusicLoop(MENU_LOOP_KEY);

    this.scene.start('Menu');
  }

  private showLoadingUI(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const barW = 320;
    const barH = 14;
    const barX = cx - barW / 2;
    const barY = cy - barH / 2;

    this.add
      .text(cx, cy - 60, 'OFFICE HELL', {
        color: '#ff5577',
        fontSize: '36px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 24, 'loading…', {
        color: '#888888',
        fontSize: '14px',
      })
      .setOrigin(0.5);

    const border = this.add.graphics();
    border.lineStyle(2, 0x444466, 1);
    border.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    const fill = this.add.graphics();
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(0xffd96a, 1);
      fill.fillRect(barX, barY, barW * value, barH);
    });
  }
}
