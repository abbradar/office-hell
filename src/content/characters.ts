import type Phaser from 'phaser';
import type { StageManager } from '../script/StageManager';

export type CharacterDef = {
  id: string;
  name: string;
  blurb: string;
  sprite: string;
  frame: number;
};

// Two cosmetic skins, mechanically identical — same HP, same speed, same
// firing. The roster exists so the player can pick a face; the blurb is
// honest about the lack of difference.
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'female',
    name: 'Jane',
    blurb: 'tired, miserable, no different from John',
    sprite: 'mc_female',
    frame: 0,
  },
  {
    id: 'male',
    name: 'John',
    blurb: 'tired, miserable, no different from Jane',
    sprite: 'mc_male',
    frame: 0,
  },
];

export const CHARACTER_REGISTRY_KEY = 'selectedCharacter';

// Returns the character the player picked on the select screen, or undefined
// if nothing was set yet (e.g. running a scene directly via dev tooling).
// Hides the unavoidable cast for registry.get's any-typed return in one place.
export function getSelectedCharacter(scene: Phaser.Scene): CharacterDef | undefined {
  return scene.registry.get(CHARACTER_REGISTRY_KEY) as CharacterDef | undefined;
}

// Body-model pool for "ordinary" coworkers — the anonymous mooks that
// fill horde waves (email interns, meeting interns, etc). All four share
// the same 6×12 sheet layout and the same registered anim set, so a
// spawn() with `sprite: nextOrdinaryCoworkerSprite(stage)` Just Works
// regardless of which one is drawn. Keep this list aligned with the
// matching entries in `CHARACTER_SHEETS`; adding a body model is one
// asset import + one entry in each place.
const ORDINARY_COWORKER_SPRITES = ['whiteFemale1', 'whiteMale1', 'blackFemale1', 'blackMale1'] as const;

// Pick the next coworker body model for a horde spawn. Drives off the
// manager's seeded RNG so the same playthrough always sees the same
// sequence of bodies in the same slots — no run-to-run shimmer in
// replays. Lives outside StageManager so the manager itself stays
// content-agnostic.
export function nextOrdinaryCoworkerSprite(stage: StageManager): string {
  const i = Math.floor(stage.nextRandom() * ORDINARY_COWORKER_SPRITES.length);
  return ORDINARY_COWORKER_SPRITES[i] as string;
}
