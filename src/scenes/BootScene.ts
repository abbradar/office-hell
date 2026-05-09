import Phaser from 'phaser';
import { initBuses } from '../audio/buses';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop, setMusicManager } from '../audio/music/loop';
import { configureVoiceCaps, preloadAudio } from '../audio/preload';
import { setSoundManager } from '../audio/sfx/pool';
import { computeCanvasH } from '../canvasSize';
import { GAME_H, GAME_W } from '../config';
import { preloadCharacterSheets, registerAllCharacterAnims } from '../content/characterSheets';
import { preloadElevator, registerElevatorAnims } from '../content/elevator';
import { generateTextures, preloadOfficeMap, preloadPlayerBullet } from '../content/textures';
import { isTouchDevice } from '../input/device';
import { preloadInputIcons } from '../ui/inputIcons';
import { preloadMuteIcons } from '../ui/muteButton';
import { COLOR_ACCENT_GOLD, COLOR_PANEL_BORDER, COLOR_TEXT_DIM_STR, COLOR_WALL_STR } from '../ui/palette';

export class BootScene extends Phaser.Scene {
  // Set in showLoadingUI() during preload(). Phaser guarantees preload runs
  // before create(), so by the time anyone reads it the assignment is in.
  private loadingText!: Phaser.GameObjects.Text;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // The loading screen is all `preload()` does now — the synchronous
    // bullet/trash/corridor texture generation moved into `content/textures`,
    // which runs as its own promise in `create()` so network requests get
    // kicked off before we burn CPU on canvas draws.
    this.showLoadingUI();
  }

  create(): void {
    initBuses(this.sound);
    setSoundManager(this.sound);
    setMusicManager(this.sound);
    configureVoiceCaps();

    // Take over Phaser's blur/focus audio handling. The default
    // (pauseOnBlur = true) suspends the AudioContext on blur and resumes
    // it on focus — but `WebAudioSoundManager.update` also calls
    // `context.resume()` every frame whenever the game has focus, which
    // means any code that suspends the context loses to Phaser the next
    // tick. iOS additionally fails to auto-resume reliably when the user
    // returns to the tab. Owning the response ourselves lets the
    // GameScene route blur to its pause overlay (which already calls
    // `pauseMusic()`), so blur-pause and ESC-pause go through the same
    // path and behave consistently across desktop and iOS.
    this.sound.pauseOnBlur = false;

    // Queue the heavy stuff (character sheets + gameplay audio) and kick the
    // loader. Phaser is happy to run a second pass after preload — the
    // existing PROGRESS handler refills the bar for this batch.
    preloadCharacterSheets(this);
    preloadElevator(this);
    preloadOfficeMap(this);
    preloadPlayerBullet(this);
    preloadAudio(this);
    preloadInputIcons(this);
    preloadMuteIcons(this);
    this.load.start();

    // Kick off dynamic-import of every other scene in parallel with the asset
    // stream and the user-gesture wait. Vite splits each into its own chunk;
    // the content/script modules they depend on tag along. Each scene
    // registers itself as soon as its own chunk lands, instead of waiting on
    // the slowest one in a single Promise.all batch.
    const menuPromise = import('../scenes/MenuScene').then((m) => this.scene.add('Menu', m.MenuScene));
    const gamePromise = import('../scenes/GameScene').then((m) => this.scene.add('Game', m.GameScene));
    const endPromise = import('../scenes/EndScene').then((m) => this.scene.add('End', m.EndScene));
    const testMenuPromise = import('../scenes/TestMenuScene').then((m) => this.scene.add('TestMenu', m.TestMenuScene));
    const charSelectPromise = import('../scenes/CharacterSelectScene').then((m) =>
      this.scene.add('CharacterSelect', m.CharacterSelectScene),
    );
    const patternTestPromise = import('../scenes/PatternTestScene').then((m) =>
      this.scene.add('PatternTest', m.PatternTestScene),
    );

    // Fonts are dynamic-imported too: the woff2 URL imports + FontFace
    // registration code live in ui/fonts and would otherwise pin into the boot
    // chunk. The loading-screen text uses the Phaser/system default font, so
    // we don't need fonts to render the bar — just to keep MenuScene from
    // measuring text against the wrong family.
    const fontsPromise = import('../ui/fonts').then((m) => m.preloadFonts());

    const assetsPromise = new Promise<void>((resolve, reject) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        try {
          // Anims tie into spritesheets that just landed — register now.
          registerAllCharacterAnims(this);
          registerElevatorAnims(this);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    // Texture generation last: it's pure CPU/canvas, so deferring it as a
    // microtask lets the synchronous download kick-offs above get into flight
    // before we start blocking on draws.
    const texturesPromise = Promise.resolve().then(() => generateTextures(this));

    Promise.all([
      assetsPromise,
      menuPromise,
      gamePromise,
      endPromise,
      testMenuPromise,
      charSelectPromise,
      patternTestPromise,
      fontsPromise,
      texturesPromise,
    ]).then(() => {
      const promptText = isTouchDevice ? 'tap to continue' : 'press any key or click to continue';
      this.loadingText.setText(promptText);

      // Native DOM listeners, not Phaser input events: Phaser drains pointer/
      // key events from its update loop, so a Phaser-dispatched callback runs
      // outside the user-gesture stack and requestFullscreen() gets rejected.
      // Calling it synchronously from the DOM handler keeps transient
      // activation alive. The same handler also unlocks the AudioContext
      // (browsers require a gesture for that too) by starting the loop.
      //
      // Pointerup, not pointerdown: per the HTML spec, touch pointerdown does
      // NOT grant user activation — only pointerup/touchend do. On mouse the
      // activation from the preceding pointerdown is still live at pointerup,
      // so this works for both inputs.
      let fired = false;
      const onGesture = () => {
        if (fired) return;
        fired = true;
        window.removeEventListener('pointerup', onGesture);
        window.removeEventListener('keydown', onGesture);

        if (isTouchDevice && !this.scale.isFullscreen) {
          this.scale.startFullscreen();
        }
        // Browsers require a user gesture to unlock the AudioContext —
        // this handler is that gesture, which is why we don't start the loop
        // until the player presses something.
        playMusicLoop(MENU_LOOP_KEY);
        this.scene.start('Menu');
      };

      // Listen on window so a laptop with a touch screen catches either input.
      window.addEventListener('pointerup', onGesture);
      window.addEventListener('keydown', onGesture);

      // Two things happen on every viewport change (fullscreen toggle,
      // address-bar show/hide, orientation flip, desktop window drag):
      //
      // 1. Recompute the canvas height. On touch we extend the canvas
      //    below the playfield to accommodate the control band so the
      //    band always reaches the screen bottom; the height depends on
      //    the parent aspect.
      // 2. Recompute the integer display zoom. Because we run with
      //    Scale.NONE (see main.ts), Phaser doesn't auto-scale the
      //    canvas — we pick the largest integer multiple of the game
      //    size that still fits the parent. Integer-only avoids the
      //    fractional-scale text/sprite distortion that pixelArt:true +
      //    NEAREST sampling produces under Scale.FIT.
      //
      // RESIZE (not ENTER_FULLSCREEN): Phaser fires RESIZE *after* its
      // own getParentBounds() refreshes `scale.parentSize`, so reading
      // parentSize here gives the live post-fullscreen viewport.
      //
      // Guard: setGameSize / setZoom both call refresh() which re-fires
      // RESIZE; only mutate when the value actually changes, otherwise
      // we recurse forever.
      let appliedZoom = 0;
      const applyIntegerZoom = (pw: number, ph: number): void => {
        const z = Math.max(1, Math.min(Math.floor(pw / this.scale.width), Math.floor(ph / this.scale.height)));
        if (z !== appliedZoom) {
          appliedZoom = z;
          this.scale.setZoom(z);
        }
      };

      this.scale.on(Phaser.Scale.Events.RESIZE, () => {
        const pw = this.scale.parentSize.width;
        const ph = this.scale.parentSize.height;
        if (!pw || !ph) return;
        const next = computeCanvasH(pw, ph);
        if (next !== this.scale.height) {
          // setGameSize, not resize: resize() is documented for the NONE
          // scale mode but doesn't update gameSize's aspect ratio, leaving
          // the canvas geometry stale. setGameSize calls
          // displaySize.setAspectRatio() before refresh().
          this.scale.setGameSize(GAME_W, next);
        }
        applyIntegerZoom(pw, ph);
      });

      // Initial zoom — Phaser's first RESIZE may have fired before our
      // listener was attached, so prime the zoom now from the current
      // parentSize. Subsequent changes go through the listener.
      const pw0 = this.scale.parentSize.width;
      const ph0 = this.scale.parentSize.height;
      if (pw0 && ph0) applyIntegerZoom(pw0, ph0);
    });
  }

  private showLoadingUI(): void {
    this.cameras.main.setBackgroundColor(COLOR_WALL_STR);

    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const barW = 320;
    const barH = 14;
    const barX = cx - barW / 2;
    const barY = cy - barH / 2;

    this.loadingText = this.add
      .text(cx, cy - 24, 'loading…', {
        color: COLOR_TEXT_DIM_STR,
        fontSize: '14px',
      })
      .setOrigin(0.5);

    const border = this.add.graphics();
    border.lineStyle(2, COLOR_PANEL_BORDER, 1);
    border.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    const fill = this.add.graphics();
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(COLOR_ACCENT_GOLD, 1);
      fill.fillRect(barX, barY, barW * value, barH);
    });
  }
}
