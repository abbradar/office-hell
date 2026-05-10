import type Phaser from 'phaser';
import coachUrl from '../assets/characters/coach1.png';
import bossUrl from '../assets/characters/coworker_boss1.png';
import checkEmailUrl from '../assets/characters/coworker_female_check_email1.png';
import vacationItalyUrl from '../assets/characters/coworker_female_manager1.png';
import geezerUrl from '../assets/characters/coworker_geezer1.png';
import gymBroUrl from '../assets/characters/coworker_gym_bro1.png';
import hrUrl from '../assets/characters/coworker_hr1.png';
import janitorUrl from '../assets/characters/coworker_janitor1.png';
import oversleptUrl from '../assets/characters/coworker_overslept1.png';
import partyManagerUrl from '../assets/characters/coworker_party_manager1.png';
import salesUrl from '../assets/characters/coworker_sales1.png';
import sysopUrl from '../assets/characters/coworker_sysop1.png';
import mcFemaleUrl from '../assets/characters/mc_female.png';
import mcMaleUrl from '../assets/characters/mc_male.png';
import vipUrl from '../assets/characters/vip1.png';
import { CHARACTER_FRAME_H, CHARACTER_FRAME_W, registerCharacterAnims } from './animations';

// Sprite key → asset URL. Every sheet shares the 6×12 / 48×48 layout
// described in animations.ts, so they all preload identically and register
// the same set of (idle/walk/run × 4 directions) anims.
export const CHARACTER_SHEETS: Record<string, string> = {
  // Player characters.
  mc_male: mcMaleUrl,
  mc_female: mcFemaleUrl,
  // Named coworkers and bosses.
  boss: bossUrl,
  coach1: coachUrl,
  janitor: janitorUrl,
  checkEmail: checkEmailUrl,
  vacationItaly: vacationItalyUrl,
  geezer: geezerUrl,
  gymBro: gymBroUrl,
  hr: hrUrl,
  overslept: oversleptUrl,
  partyManager: partyManagerUrl,
  sales: salesUrl,
  sysop: sysopUrl,
  vip: vipUrl,
};

export function preloadCharacterSheets(scene: Phaser.Scene): void {
  for (const [key, url] of Object.entries(CHARACTER_SHEETS)) {
    scene.load.spritesheet(key, url, {
      frameWidth: CHARACTER_FRAME_W,
      frameHeight: CHARACTER_FRAME_H,
    });
  }
}

// Call once the spritesheet load has completed — anims need the texture in
// the cache before `generateFrameNumbers` resolves indices.
export function registerAllCharacterAnims(scene: Phaser.Scene): void {
  for (const key of Object.keys(CHARACTER_SHEETS)) {
    registerCharacterAnims(scene, key);
  }
}
