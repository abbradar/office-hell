export const MENU_LOOP_KEY = 'menuLoop';
export const CLICK_SFX_KEY = 'clickSfx';
export const SHOOT_SFX_KEY = 'shootSfx';
export const HURT_SFX_KEY = 'hurtSfx';

// Stage 1 music. The retro_01/retro_02 tracks share an opening that plays
// once before the first loop kicks in; retro_03 is the boss theme with
// its own opening.
export const STAGE1_RETRO_OPENING_KEY = 'stage1RetroOpening';
export const STAGE1_RETRO_01_LOOP_KEY = 'stage1Retro01Loop';
export const STAGE1_RETRO_02_LOOP_KEY = 'stage1Retro02Loop';
export const STAGE1_RETRO_03_OPENING_KEY = 'stage1Retro03Opening';
export const STAGE1_RETRO_03_LOOP_KEY = 'stage1Retro03Loop';

// Final-boss track — the "metal" loop. Distinct from stage 1's retro_03
// so the final-boss bookend has its own intensity instead of recycling
// the mid-stage-1 boss theme. Intro plays once at the boss entrance,
// then hands off to the loop for the rest of the fight.
export const FINAL_BOSS_METAL_OPENING_KEY = 'finalBossMetalOpening';
export const FINAL_BOSS_METAL_LOOP_KEY = 'finalBossMetalLoop';

// Ending — "Unchained Destiny". Plays under the post-stage-2 walk-home
// scene with the credits roll fading over the corridor.
export const ENDING_OPENING_KEY = 'endingOpening';
export const ENDING_LOOP_KEY = 'endingLoop';

// Kaedalus stage. The pre-Hodge intro is a one-shot built from the 1..70
// bar chunks, played through once over the four pre-boss waves. The short
// version loops under the post-Hodge waves before the boss enters.
export const KAEDALUS_STAGE2_INTRO_KEY = 'kaedalusStage2Intro';
export const KAEDALUS_SHORT_KEY = 'kaedalusShort';

// Chunks split from the kaedalus long arrangement, anchored to the Hodge
// encounter — see content/waves/shrunkOldMan.ts:
//   - dialog: the 71 chunk, short loop under the pre-fight dialogue
//   - fight: 74 + 75-f concatenated, one-shot under the fight itself
export const KAEDALUS_HODGE_DIALOG_KEY = 'kaedalusHodgeDialog';
export const KAEDALUS_HODGE_FIGHT_KEY = 'kaedalusHodgeFight';

// Beats-per-bar for the kaedalus fight track. 120 BPM with 1.5-beat bars
// (or equivalently 2/4 at 60 = 3 s/bar) per the composer; the early-kill
// bonus rounds up to the next bar boundary before hard-cutting.
export const KAEDALUS_FIGHT_BAR_S = 3;

// Nene's pre-fight loop. Plays under the final-boss opening dialog;
// the boss-track intro hands off at the loop's next seam after the
// dialog is dismissed.
export const NENE_BOSS_DIALOG_KEY = 'neneBossDialog';
