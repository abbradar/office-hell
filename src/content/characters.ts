import type Phaser from 'phaser';

export type CharacterDef = {
  id: string;
  name: string;
  blurb: string;
  sprite: string;
  frame: number;
};

// Both characters reuse the player sprite for now — the roster shape is what we want stable;
// real per-character art (and stat differences) can swap in without touching the menu/select scene.
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'intern',
    name: 'The Intern',
    blurb: 'fresh blood, optimistic, shoots fast',
    sprite: 'player',
    frame: 0,
  },
  {
    id: 'veteran',
    name: 'The Veteran',
    blurb: 'jaded, caffeinated, hits harder',
    sprite: 'player',
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
