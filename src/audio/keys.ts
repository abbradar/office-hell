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

// Stage 2 final-boss track. Distinct from stage 1's retro_03 so the
// final-boss bookend has its own intensity instead of recycling the
// mid-stage-1 boss theme. Only the short opening segment is used — it
// loops under the entire stage-2 sequence (entry → dialog → fight).
export const STAGE2_RETRO_03_OPENING_KEY = 'stage2Retro03Opening';

// Ending — "Unchained Destiny". Plays under the post-stage-2 walk-home
// scene with the credits roll fading over the corridor.
export const ENDING_OPENING_KEY = 'endingOpening';
export const ENDING_LOOP_KEY = 'endingLoop';

// Kaedalus test stage — same arrangement at two lengths. Long version
// loops as the regular stage music; short version loops under the boss
// fight after a hand-off triggered mid-stage.
export const KAEDALUS_LONG_KEY = 'kaedalusLong';
export const KAEDALUS_SHORT_KEY = 'kaedalusShort';

// Monster RPG 2 test stage — four tracks driving a four-phase progression.
// 12okt + battle play once (no native loop seam, so we treat them as
// one-shots); chase + final_boss loop under the two boss fights.
export const MONSTER_INTRO_KEY = 'monsterIntro';
export const MONSTER_BATTLE_KEY = 'monsterBattle';
export const MONSTER_CHASE_KEY = 'monsterChase';
export const MONSTER_FINAL_BOSS_KEY = 'monsterFinalBoss';
