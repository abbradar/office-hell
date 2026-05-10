import type Phaser from 'phaser';
import elevatorUrl from '../assets/misc/elevator_doors.png';
import { GAME_H, GAME_W } from '../config';

// 7-frame doors strip: frame 0 = fully closed, frame 6 = fully open. The
// sheet is 224×48; per-frame is 32×48. Used as a full-screen backdrop on
// Menu and CharacterSelect — open frame's dark interior doubles as the
// menu/character-select background.
export const ELEVATOR_DOORS_KEY = 'elevator_doors';
export const ELEVATOR_FRAME_W = 32;
export const ELEVATOR_FRAME_H = 48;
export const ELEVATOR_FRAME_CLOSED = 0;
export const ELEVATOR_FRAME_OPEN = 6;
export const ELEVATOR_OPEN_ANIM = 'elevator_open';
export const ELEVATOR_CLOSE_ANIM = 'elevator_close';
// Total open / close animation duration. 7 frames at ~71 ms/frame ≈ 500 ms.
export const ELEVATOR_OPEN_MS = 500;

// Backdrop is sized slightly larger than the playfield so the menu's idle
// rumble (a few-pixel up/down jitter) doesn't expose the scene's clear
// color at the edges.
export const ELEVATOR_BACKDROP_OVERFLOW = 24;

export function preloadElevator(scene: Phaser.Scene): void {
  scene.load.spritesheet(ELEVATOR_DOORS_KEY, elevatorUrl, {
    frameWidth: ELEVATOR_FRAME_W,
    frameHeight: ELEVATOR_FRAME_H,
  });
}

export function registerElevatorAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists(ELEVATOR_OPEN_ANIM)) return;
  scene.anims.create({
    key: ELEVATOR_OPEN_ANIM,
    frames: scene.anims.generateFrameNumbers(ELEVATOR_DOORS_KEY, { start: 0, end: 6 }),
    duration: ELEVATOR_OPEN_MS,
    repeat: 0,
  });
  // Close = reverse frame order. generateFrameNumbers's `frames` array
  // accepts an explicit sequence, including descending — that's how we
  // get the reversed playback without a separate sheet.
  scene.anims.create({
    key: ELEVATOR_CLOSE_ANIM,
    frames: scene.anims.generateFrameNumbers(ELEVATOR_DOORS_KEY, { frames: [6, 5, 4, 3, 2, 1, 0] }),
    duration: ELEVATOR_OPEN_MS,
    repeat: 0,
  });
}

// Shared placement so the open doors carry over from MenuScene's open
// animation to CharacterSelect without a visual jump.
export function addElevatorBackdrop(scene: Phaser.Scene, frame: number): Phaser.GameObjects.Sprite {
  return scene.add
    .sprite(GAME_W / 2, GAME_H / 2, ELEVATOR_DOORS_KEY, frame)
    .setDisplaySize(GAME_W + ELEVATOR_BACKDROP_OVERFLOW, GAME_H + ELEVATOR_BACKDROP_OVERFLOW)
    .setDepth(-10);
}
