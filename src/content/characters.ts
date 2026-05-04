import type Phaser from 'phaser';

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
