import Phaser from 'phaser';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { playClick } from '../audio/sfx/events';
import { gameH, gameW } from '../config';
import { addElevatorBackdrop, ELEVATOR_FRAME_CLOSED, ELEVATOR_OPEN_ANIM } from '../content/elevator';
import { isTouchDevice } from '../input/device';
import { FONT_DIALOGUE_LG, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import { makePrompt } from '../ui/prompt';
import { onTap } from '../ui/tap';

// "Elevator stops at a floor" jitter: small enough to read as motor
// vibration on a full-screen backdrop without making the menu text wobble
// noticeably. The sprite is intentionally oversized (see
// ELEVATOR_BACKDROP_OVERFLOW) so this shift never exposes the scene
// clear color.
const RUMBLE_PIXELS = 4;
const RUMBLE_MIN_MS = 4000;
const RUMBLE_MAX_MS = 6000;
const RUMBLE_DURATION_MS = 100;

export class MenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    // Music is owned by the audio module and survives scene transitions, so
    // the loop keeps playing across CharacterSelect / TestMenu / End. The
    // call is idempotent for the same key — calling it again on a return to
    // the menu (e.g. from EndScene) just no-ops while the loop is alive.
    playMusicLoop(MENU_LOOP_KEY);

    addMuteButton(this);
    this.starting = false;

    const elevator = addElevatorBackdrop(this, ELEVATOR_FRAME_CLOSED);
    this.scheduleRumble(elevator);

    this.add
      .text(gameW() / 2, gameH() * 0.28, 'OFFICE HELL', {
        ...FONT_TITLE,
        color: '#ff5577',
      })
      .setOrigin(0.5);

    const startTemplate = isTouchDevice ? '▶ TAP TO START' : '▶ START  <confirm>';
    const startText = makePrompt(this, gameW() / 2, gameH() * 0.5, startTemplate, {
      ...FONT_MENU,
      color: '#ffffff',
    });
    // Fat-finger pad: tap area extends well past the rendered text so a
    // thumb tap doesn't have to be precise. Hit area is in container
    // local coords (origin at the centre of the prompt).
    setLargeHit(startText, gameW() * 0.7, 110);

    const startTween = this.tweens.add({
      targets: startText,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const practiceTemplate = isTouchDevice ? '▷ PRACTICE' : '▷ PRACTICE  <practice>';
    const practiceText = makePrompt(this, gameW() / 2, gameH() * 0.62, practiceTemplate, {
      ...FONT_DIALOGUE_LG,
      color: '#ffd96a',
    });
    setLargeHit(practiceText, gameW() * 0.6, 80);

    const start = (): void => {
      if (this.starting) return;
      this.starting = true;
      playClick();
      // Stop the START button's pulse so it doesn't keep flickering during
      // the door-open animation.
      startTween.stop();
      startText.setAlpha(1);
      elevator.play(ELEVATOR_OPEN_ANIM);
      elevator.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.scene.start('CharacterSelect', { next: 'Game' });
      });
    };
    const goPractice = (): void => {
      if (this.starting) return;
      playClick();
      this.scene.start('TestMenu');
    };

    onTap(this, startText, start);
    onTap(this, practiceText, goPractice);
    this.input.keyboard?.once('keydown-Z', start);
    this.input.keyboard?.once('keydown-T', goPractice);
  }

  // Schedule a short up/down jitter on the elevator at a random interval
  // between RUMBLE_MIN_MS and RUMBLE_MAX_MS — sells "the elevator is
  // working" without being noisy. Recurses by re-arming the timer at the
  // tween's end.
  private scheduleRumble(target: Phaser.GameObjects.Sprite): void {
    const delay = Phaser.Math.Between(RUMBLE_MIN_MS, RUMBLE_MAX_MS);
    this.time.delayedCall(delay, () => {
      // The scene may have been torn down between scheduling and firing
      // (e.g. quick START press). Bail if we're no longer the active menu.
      if (!this.scene.isActive() || this.starting) return;
      // Compute the rest position lazily — gameH() can change at runtime
      // when the viewport reshapes (fullscreen / orientation), and we want
      // each tween to read the live value.
      const baseY = gameH() / 2;
      this.tweens.add({
        targets: target,
        y: baseY - RUMBLE_PIXELS,
        duration: RUMBLE_DURATION_MS,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          target.y = baseY;
          this.scheduleRumble(target);
        },
      });
    });
  }
}

function setLargeHit(target: Phaser.GameObjects.Container, w: number, h: number): void {
  // Container local origin sits at the prompt's centre, so a centred
  // rectangle gives a hit pad evenly extending in all four directions.
  target.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
}
