import type Phaser from 'phaser';
import kaedalusHodgeDialogUrl from '../assets/audio/chunks/kaedalus/71.ogg';
import neneBossDialogUrl from '../assets/audio/dialogues/nene/battle_9_opening.ogg';
import menuLoopUrl from '../assets/audio/loops/checking_manifest.ogg';
import endingLoopUrl from '../assets/audio/loops/ending/unchained_destiny_loop.ogg';
import endingOpeningUrl from '../assets/audio/loops/ending/unchained_destiny_opening.ogg';
import kaedalusShortUrl from '../assets/audio/loops/kaedalus/crack_short.ogg';
import kaedalusHodgeFightUrl from '../assets/audio/loops/kaedalus/hodge_fight.ogg';
import kaedalusStage2IntroUrl from '../assets/audio/loops/kaedalus/stage2_intro.ogg';
import stage1Retro01LoopUrl from '../assets/audio/loops/stage1/retro_01_loop.ogg';
import stage1RetroOpeningUrl from '../assets/audio/loops/stage1/retro_01_opening.ogg';
import stage1Retro02LoopUrl from '../assets/audio/loops/stage1/retro_02_loop.ogg';
import stage1Retro03LoopUrl from '../assets/audio/loops/stage1/retro_03_loop.ogg';
import stage1Retro03OpeningUrl from '../assets/audio/loops/stage1/retro_03_opening.ogg';
import finalBossMetalLoopUrl from '../assets/audio/loops/stage2/retro_03_loop.ogg';
import finalBossMetalOpeningUrl from '../assets/audio/loops/stage2/retro_03_opening.ogg';
import footstep05SfxUrl from '../assets/audio/sfx/footstep05.ogg';
import footstep06SfxUrl from '../assets/audio/sfx/footstep06.ogg';
import footstep09SfxUrl from '../assets/audio/sfx/footstep09.ogg';
import hurtSfxUrl from '../assets/audio/sfx/hit_hurt.wav';
import shootSfxUrl from '../assets/audio/sfx/noised_laser.wav';
import bossDieSfxUrl from '../assets/audio/sfx/zapTwoTone.mp3';
import bossPhaseSfxUrl from '../assets/audio/sfx/zap1.mp3';
import enemyDieSfxUrl from '../assets/audio/sfx/pepSound4.mp3';
import enemyHitSfxUrl from '../assets/audio/sfx/tone1.mp3';
import pickupSfxUrl from '../assets/audio/sfx/phaserUp4.mp3';
import clickSfxUrl from '../assets/audio/sfx/switch20.wav';
import {
  BOSS_DIE_SFX_KEY,
  BOSS_PHASE_SFX_KEY,
  CLICK_SFX_KEY,
  ENDING_LOOP_KEY,
  ENDING_OPENING_KEY,
  ENEMY_DIE_SFX_KEY,
  ENEMY_HIT_SFX_KEY,
  FINAL_BOSS_METAL_LOOP_KEY,
  FINAL_BOSS_METAL_OPENING_KEY,
  FOOTSTEP_05_SFX_KEY,
  FOOTSTEP_06_SFX_KEY,
  FOOTSTEP_09_SFX_KEY,
  HURT_SFX_KEY,
  KAEDALUS_HODGE_DIALOG_KEY,
  KAEDALUS_HODGE_FIGHT_KEY,
  KAEDALUS_SHORT_KEY,
  KAEDALUS_STAGE2_INTRO_KEY,
  MENU_LOOP_KEY,
  NENE_BOSS_DIALOG_KEY,
  PICKUP_SFX_KEY,
  SHOOT_SFX_KEY,
  STAGE1_RETRO_01_LOOP_KEY,
  STAGE1_RETRO_02_LOOP_KEY,
  STAGE1_RETRO_03_LOOP_KEY,
  STAGE1_RETRO_03_OPENING_KEY,
  STAGE1_RETRO_OPENING_KEY,
} from './keys';
import { setVoiceCap } from './sfx/pool';

const AUDIO_ASSETS: Record<string, string> = {
  [MENU_LOOP_KEY]: menuLoopUrl,
  [CLICK_SFX_KEY]: clickSfxUrl,
  [SHOOT_SFX_KEY]: shootSfxUrl,
  [HURT_SFX_KEY]: hurtSfxUrl,
  [PICKUP_SFX_KEY]: pickupSfxUrl,
  [ENEMY_HIT_SFX_KEY]: enemyHitSfxUrl,
  [ENEMY_DIE_SFX_KEY]: enemyDieSfxUrl,
  [BOSS_PHASE_SFX_KEY]: bossPhaseSfxUrl,
  [BOSS_DIE_SFX_KEY]: bossDieSfxUrl,
  [FOOTSTEP_05_SFX_KEY]: footstep05SfxUrl,
  [FOOTSTEP_06_SFX_KEY]: footstep06SfxUrl,
  [FOOTSTEP_09_SFX_KEY]: footstep09SfxUrl,
  [STAGE1_RETRO_OPENING_KEY]: stage1RetroOpeningUrl,
  [STAGE1_RETRO_01_LOOP_KEY]: stage1Retro01LoopUrl,
  [STAGE1_RETRO_02_LOOP_KEY]: stage1Retro02LoopUrl,
  [STAGE1_RETRO_03_OPENING_KEY]: stage1Retro03OpeningUrl,
  [STAGE1_RETRO_03_LOOP_KEY]: stage1Retro03LoopUrl,
  [FINAL_BOSS_METAL_OPENING_KEY]: finalBossMetalOpeningUrl,
  [FINAL_BOSS_METAL_LOOP_KEY]: finalBossMetalLoopUrl,
  [ENDING_OPENING_KEY]: endingOpeningUrl,
  [ENDING_LOOP_KEY]: endingLoopUrl,
  [KAEDALUS_STAGE2_INTRO_KEY]: kaedalusStage2IntroUrl,
  [KAEDALUS_SHORT_KEY]: kaedalusShortUrl,
  [KAEDALUS_HODGE_DIALOG_KEY]: kaedalusHodgeDialogUrl,
  [KAEDALUS_HODGE_FIGHT_KEY]: kaedalusHodgeFightUrl,
  [NENE_BOSS_DIALOG_KEY]: neneBossDialogUrl,
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
  // Hit sample fires on every non-killing bullet hit — dense fights can
  // stack a dozen per frame. Cap at 6 so the layer reads as percussion
  // rather than a wash.
  setVoiceCap(ENEMY_HIT_SFX_KEY, 6);
  setVoiceCap(ENEMY_DIE_SFX_KEY, 6);
  // Boss-death is louder and rarer — cap small.
  setVoiceCap(BOSS_DIE_SFX_KEY, 2);
  setVoiceCap(BOSS_PHASE_SFX_KEY, 2);
  // Boss pickup bursts 5 drops at once — give each its own voice.
  setVoiceCap(PICKUP_SFX_KEY, 6);
}
