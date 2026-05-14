import Phaser from 'phaser';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop } from '../audio/music/loop';
import { playClick } from '../audio/sfx/events';
import { DEVELOPER_MODE, GAME_H, GAME_W } from '../config';
import { hasAnyPracticeUnlock } from './GameScene';
import {
  addElevatorBackdrop,
  ELEVATOR_BACKDROP_TINT,
  ELEVATOR_FRAME_CLOSED,
  ELEVATOR_MENU_VERTICAL_PAD,
  ELEVATOR_OPEN_ANIM,
} from '../content/elevator';
import { MENU_LOGO_KEY } from '../content/textures';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { loadSaveState, type SavedGameState } from '../state/save';
import { FONT_DIALOGUE_LG, FONT_MENU } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import { COLOR_ACCENT_GOLD_STR, COLOR_TEXT_PRIMARY_STR, COLOR_WALL_STR } from '../ui/palette';
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

// Shift the elevator up so its top building-frame band is mostly cropped
// off-screen. The source sprite has a thick frame piece at the top and no
// equivalent at the bottom — left as-is the composition reads top-heavy.
// Pairs with ELEVATOR_BACKDROP_OVERFLOW (in elevator.ts) which is bumped
// to cover the freshly-exposed area at the bottom.
const ELEVATOR_Y_OFFSET = -40;

// Per-run mutable state. Phaser reuses the scene instance across
// `scene.start('Menu')` (e.g. coming back from CharSelect's back link
// or EndScene), so a class-field `starting = false` would keep the
// previous run's value when create() runs again. The save snapshot is
// also captured here so the CONTINUE handler reads the exact slot the
// button was shown for — a fresh `loadSaveState()` at click time could
// race with another tab clearing the slot.
class RunState {
  starting = false;
  // Cached save snapshot at scene-entry time. Null = no save → CONTINUE
  // button is hidden. Re-read each init() so a death save during the
  // current session surfaces immediately on the next return-to-menu.
  readonly continueSnapshot: SavedGameState | null;

  constructor() {
    this.continueSnapshot = loadSaveState();
  }
}

export class MenuScene extends Phaser.Scene {
  private state!: RunState;

  constructor() {
    super('Menu');
  }

  init(): void {
    this.state = new RunState();
  }

  create(): void {
    bindLogicalCamera(this);
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);

    // Music is owned by the audio module and survives scene transitions, so
    // the loop keeps playing across CharacterSelect / TestMenu / End. The
    // call is idempotent for the same key — calling it again on a return to
    // the menu (e.g. from EndScene) just no-ops while the loop is alive.
    playMusicLoop(MENU_LOOP_KEY);

    addMuteButton(this);

    const elevator = addElevatorBackdrop(this, ELEVATOR_FRAME_CLOSED, ELEVATOR_MENU_VERTICAL_PAD);
    elevator.y = GAME_H / 2 + ELEVATOR_Y_OFFSET;
    elevator.setTint(ELEVATOR_BACKDROP_TINT);
    this.scheduleRumble(elevator);

    // Logo + menu prompts sit in the lower two-thirds of the elevator door
    // panel, lower than they used to. Designer pass concluded the previous
    // layout (logo at 0.22, prompts starting at 0.5) felt top-loaded — this
    // sinks the whole stack so the bottom margin reads as the composition's
    // base rather than dead space.
    this.add
      .image(GAME_W / 2, GAME_H * 0.32, MENU_LOGO_KEY)
      .setOrigin(0.5)
      .setScale(2);

    // Equal-spaced prompts: the column is anchored at START (0.62) and
    // CREDITS (0.88), with whichever optional middle rows are visible
    // distributed evenly between them. Stride therefore depends on the
    // count of visible rows (2 → 0.26, 3 → 0.13, 4 → ~0.087), which
    // keeps the visible gaps identical regardless of which combination
    // of CONTINUE / PRACTICE is currently shown. START uses FONT_MENU
    // (slightly heavier) than the rest; equal Y stride is the simplest
    // way to keep the column visually rhythmic without bespoke padding.
    const snap = this.state.continueSnapshot;
    const showContinue = snap !== null;
    const showPractice = DEVELOPER_MODE || hasAnyPracticeUnlock();
    const visibleCount = 2 + (showContinue ? 1 : 0) + (showPractice ? 1 : 0);
    const TOP_Y_FRAC = 0.62;
    const BOTTOM_Y_FRAC = 0.88;
    const strideFrac = (BOTTOM_Y_FRAC - TOP_Y_FRAC) / (visibleCount - 1);
    const yFor = (index: number): number => GAME_H * (TOP_Y_FRAC + index * strideFrac);

    let slot = 0;
    const startTemplate = isTouchDevice ? '▶ TAP TO START' : '▶ START  <confirm>';
    const startText = makePrompt(this, GAME_W / 2, yFor(slot++), startTemplate, {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    // Fat-finger pad: tap area extends well past the rendered text so a
    // thumb tap doesn't have to be precise. Hit area is in container
    // local coords (origin at the centre of the prompt).
    setLargeHit(startText, GAME_W * 0.7, 110);

    const startTween = this.tweens.add({
      targets: startText,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    // CONTINUE prompt — only present when there's an auto-save to
    // resume from. Lives between START and PRACTICE so the eye lands
    // on it naturally (returning-from-death players want this row, not
    // a full restart). Gold accent to read as a "you have unfinished
    // business" cue distinct from the neutral primary text of the
    // surrounding rows.
    let continueText: Phaser.GameObjects.Container | null = null;
    if (showContinue) {
      const continueTemplate = isTouchDevice ? '▷ CONTINUE' : '▷ CONTINUE  <bomb>';
      continueText = makePrompt(this, GAME_W / 2, yFor(slot++), continueTemplate, {
        ...FONT_DIALOGUE_LG,
        color: COLOR_ACCENT_GOLD_STR,
      });
      setLargeHit(continueText, GAME_W * 0.6, 80);
    }

    // PRACTICE prompt is visible in dev unconditionally, and in
    // production once the player has reached at least one wave (so
    // there's something non-trivial to replay). The TestMenuScene
    // itself filters wave rows to encountered ones only; the
    // pattern-sandbox shortcut stays visible regardless. Slot below
    // CONTINUE; if CONTINUE is hidden, PRACTICE moves up to that slot.
    let practiceText: Phaser.GameObjects.Container | null = null;
    if (showPractice) {
      const practiceTemplate = isTouchDevice ? '▷ PRACTICE' : '▷ PRACTICE  <practice>';
      practiceText = makePrompt(this, GAME_W / 2, yFor(slot++), practiceTemplate, {
        ...FONT_DIALOGUE_LG,
        color: COLOR_TEXT_PRIMARY_STR,
      });
      setLargeHit(practiceText, GAME_W * 0.6, 80);
    }

    const creditsTemplate = isTouchDevice ? '▷ CREDITS' : '▷ CREDITS  <credits>';
    const creditsText = makePrompt(this, GAME_W / 2, yFor(slot++), creditsTemplate, {
      ...FONT_DIALOGUE_LG,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    setLargeHit(creditsText, GAME_W * 0.6, 80);

    const start = (): void => {
      if (this.state.starting) return;
      this.state.starting = true;
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
    const goContinue = (): void => {
      if (this.state.starting || snap === null) return;
      this.state.starting = true;
      playClick();
      startTween.stop();
      startText.setAlpha(1);
      // Continue still goes through CharacterSelect — the saved state
      // doesn't pin a character (rosters are mechanically identical, so
      // re-picking is fine) and threading the snapshot through CharSelect's
      // `nextData` keeps the launch path uniform with START.
      elevator.play(ELEVATOR_OPEN_ANIM);
      elevator.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.scene.start('CharacterSelect', { next: 'Game', nextData: { continueFrom: snap } });
      });
    };
    const goPractice = (): void => {
      if (this.state.starting) return;
      playClick();
      this.scene.start('TestMenu');
    };
    const goCredits = (): void => {
      if (this.state.starting) return;
      playClick();
      this.scene.start('Credits');
    };

    onTap(this, startText, start);
    onTap(this, creditsText, goCredits);
    this.input.keyboard?.once('keydown-Z', start);
    this.input.keyboard?.once('keydown-C', goCredits);
    if (continueText) {
      onTap(this, continueText, goContinue);
      this.input.keyboard?.once('keydown-X', goContinue);
    }
    if (practiceText) {
      onTap(this, practiceText, goPractice);
      this.input.keyboard?.once('keydown-T', goPractice);
    }
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
      if (!this.scene.isActive() || this.state.starting) return;
      const baseY = GAME_H / 2 + ELEVATOR_Y_OFFSET;
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
