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

export const DEFAULT_CHARACTER: CharacterDef = (() => {
  const first = CHARACTERS[0];
  if (!first) throw new Error('CHARACTERS roster is empty');
  return first;
})();
