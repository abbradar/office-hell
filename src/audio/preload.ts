import type Phaser from 'phaser';
import menuLoopUrl from '../assets/audio/loops/checking_manifest.ogg';
import endingLoopUrl from '../assets/audio/loops/ending/unchained_destiny_loop.ogg';
import endingOpeningUrl from '../assets/audio/loops/ending/unchained_destiny_opening.ogg';
import kaedalusLongUrl from '../assets/audio/loops/kaedalus/crack_long.ogg';
import kaedalusShortUrl from '../assets/audio/loops/kaedalus/crack_short.ogg';
import monsterIntroUrl from '../assets/audio/loops/monster_rpg/12okt.ogg';
import monsterBattleUrl from '../assets/audio/loops/monster_rpg/battle.ogg';
import monsterChaseUrl from '../assets/audio/loops/monster_rpg/chase.ogg';
import monsterFinalBossUrl from '../assets/audio/loops/monster_rpg/final_boss.ogg';
import stage1MetalLoopUrl from '../assets/audio/loops/stage1/boss_battle_8_metal_loop.ogg';
import stage1MetalOpeningUrl from '../assets/audio/loops/stage1/boss_battle_8_metal_opening.ogg';
import stage1Retro01LoopUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_01_loop.ogg';
import stage1RetroOpeningUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_01_opening.ogg';
import stage1Retro02LoopUrl from '../assets/audio/loops/stage1/boss_battle_8_retro_02_loop.ogg';
import stage2MetalLoopUrl from '../assets/audio/loops/stage2/boss_battle_9_metal_loop.ogg';
import stage2MetalOpeningUrl from '../assets/audio/loops/stage2/boss_battle_9_metal_opening.ogg';
import hurtSfxUrl from '../assets/audio/sfx/hit_hurt.wav';
import shootSfxUrl from '../assets/audio/sfx/noised_laser.wav';
import clickSfxUrl from '../assets/audio/sfx/switch20.wav';
import {
  CLICK_SFX_KEY,
  ENDING_LOOP_KEY,
  ENDING_OPENING_KEY,
  HURT_SFX_KEY,
  KAEDALUS_LONG_KEY,
  KAEDALUS_SHORT_KEY,
  MENU_LOOP_KEY,
  MONSTER_BATTLE_KEY,
  MONSTER_CHASE_KEY,
  MONSTER_FINAL_BOSS_KEY,
  MONSTER_INTRO_KEY,
  SHOOT_SFX_KEY,
  STAGE1_METAL_LOOP_KEY,
  STAGE1_METAL_OPENING_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_OPENING_KEY,
  STAGE2_METAL_LOOP_KEY,
  STAGE2_METAL_OPENING_KEY,
} from './keys';
import { setVoiceCap } from './sfx/pool';

const AUDIO_ASSETS: Record<string, string> = {
  [MENU_LOOP_KEY]: menuLoopUrl,
  [CLICK_SFX_KEY]: clickSfxUrl,
  [SHOOT_SFX_KEY]: shootSfxUrl,
  [HURT_SFX_KEY]: hurtSfxUrl,
  [STAGE1_RETRO_OPENING_KEY]: stage1RetroOpeningUrl,
  [STAGE1_RETRO_01_LOOP_KEY]: stage1Retro01LoopUrl,
  [STAGE1_RETRO_02_LOOP_KEY]: stage1Retro02LoopUrl,
  [STAGE1_METAL_OPENING_KEY]: stage1MetalOpeningUrl,
  [STAGE1_METAL_LOOP_KEY]: stage1MetalLoopUrl,
  [STAGE2_METAL_OPENING_KEY]: stage2MetalOpeningUrl,
  [STAGE2_METAL_LOOP_KEY]: stage2MetalLoopUrl,
  [ENDING_OPENING_KEY]: endingOpeningUrl,
  [ENDING_LOOP_KEY]: endingLoopUrl,
  [KAEDALUS_LONG_KEY]: kaedalusLongUrl,
  [KAEDALUS_SHORT_KEY]: kaedalusShortUrl,
  [MONSTER_INTRO_KEY]: monsterIntroUrl,
  [MONSTER_BATTLE_KEY]: monsterBattleUrl,
  [MONSTER_CHASE_KEY]: monsterChaseUrl,
  [MONSTER_FINAL_BOSS_KEY]: monsterFinalBossUrl,
};

export function preloadAudio(scene: Phaser.Scene): void {
  for (const [key, url] of Object.entries(AUDIO_ASSETS)) {
    scene.load.audio(key, url);
  }
}

// Per-sample voice caps. Click is UI-only and never overlaps more than a
// few times. Shoot fires hot during boss patterns + player auto-fire — the
// sample is ~250ms with peak concurrency ~3-4 in normal play, so 8 lets
// dense ring volleys stack without clipping the player's own shots.
export function configureVoiceCaps(): void {
  setVoiceCap(CLICK_SFX_KEY, 4);
  setVoiceCap(SHOOT_SFX_KEY, 8);
}
