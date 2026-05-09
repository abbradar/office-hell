export const MENU_LOOP_KEY = 'menuLoop';
export const CLICK_SFX_KEY = 'clickSfx';
export const SHOOT_SFX_KEY = 'shootSfx';
export const HURT_SFX_KEY = 'hurtSfx';

// Stage 1 music. The retro tracks share an opening that plays once before the
// first loop kicks in; the metal track is the boss theme with its own opening.
export const STAGE1_RETRO_OPENING_KEY = 'stage1RetroOpening';
export const STAGE1_RETRO_01_LOOP_KEY = 'stage1Retro01Loop';
export const STAGE1_RETRO_02_LOOP_KEY = 'stage1Retro02Loop';
export const STAGE1_METAL_OPENING_KEY = 'stage1MetalOpening';
export const STAGE1_METAL_LOOP_KEY = 'stage1MetalLoop';

// Stage 2 final-boss metal track. Distinct from stage 1's metal so the
// final-boss bookend has its own intensity instead of recycling the
// mid-stage-1 boss theme.
export const STAGE2_METAL_OPENING_KEY = 'stage2MetalOpening';
export const STAGE2_METAL_LOOP_KEY = 'stage2MetalLoop';

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
