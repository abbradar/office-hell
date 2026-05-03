// Logical play field. Sprites are fixed pixel sizes (player/enemies are 48px,
// bullets ~6–8px), so shrinking these constants makes everything fill more of
// the screen — characters look ~20% larger relative to the field. Phaser is
// configured with Scale.FIT, so the canvas still scales to fit the page.
export const GAME_W = 400;
export const GAME_H = 660;

export const PLAYER_SPEED = 280;
export const PLAYER_HITBOX_RADIUS = 4;
export const PLAYER_Y = GAME_H - 80;

export const BULLET_RADIUS = 3;
export const ENTITY_POOL_SIZE = 1024;
export const CULL_MARGIN = 96;
