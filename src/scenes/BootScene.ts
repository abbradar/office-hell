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
import { generateTextures, preloadBackgrounds, preloadPlayerBullet, registerDoorsFrames } from '../content/textures';
import { isTouchDevice } from '../input/device';
import { displayState } from '../render/displayState';
import { bindLogicalCamera } from '../render/logicalCamera';
import { preloadInputIcons } from '../ui/inputIcons';
import { preloadMuteIcons } from '../ui/muteButton';
import { COLOR_ACCENT_GOLD, COLOR_PANEL_BORDER, COLOR_TEXT_DIM_STR, COLOR_WALL_STR } from '../ui/palette';

// Recompute the world-to-screen geometry shared by every scene.
// Every gameplay scene's main camera is sized to the *logical* canvas
// (GAME_W × logicalH); the SharpBilinearPipeline upscales that camera's
// captured render to fill the screen. displayState records the scale and
// offset every other surface (UI overlays, screenToLogical pointer maps)
// derives its math from.
export function recomputeDisplay(scene: Phaser.Scene): void {
  const sw = scene.scale.width;
  const sh = scene.scale.height;
  if (!sw || !sh) return;
  const logicalH = computeCanvasH(sw, sh);
  // Fit by the binding dimension. Most viewports are taller-than-logical-
  // aspect (portrait phones extended via computeCanvasH; desktop widescreens
  // hit the height limit) so width fits with side bars. Narrow desktop
  // windows where canvas aspect < logical aspect would overflow the
  // logical content horizontally if we always fit-by-height — pick the
  // tighter fit.
  const sByH = sh / logicalH;
  const sByW = sw / GAME_W;
  const s = Math.min(sByH, sByW);
  const displayedW = GAME_W * s;
  const displayedH = logicalH * s;
  const offsetX = Math.max(0, Math.round((sw - displayedW) / 2));
  const offsetY = Math.max(0, Math.round((sh - displayedH) / 2));
  displayState.worldScale = s;
  displayState.worldOffsetX = offsetX;
  displayState.worldOffsetY = offsetY;
  displayState.logicalH = logicalH;
}

export class BootScene extends Phaser.Scene {
  // Set in showLoadingUI() during preload(). Phaser guarantees preload runs
  // before create(), so by the time anyone reads it the assignment is in.
  private loadingText!: Phaser.GameObjects.Text;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // Prime displayState before the loading bar renders so the BootScene's
    // own camera comes up correctly — bindLogicalCamera reads logicalH off
    // displayState. Without this the loading bar lands in the upper-left
    // logical-rect of the screen-sized canvas.
    recomputeDisplay(this);
    // The loading screen is all `preload()` does now — the synchronous
    // bullet/trash/corridor texture generation moved into `content/textures`,
    // which runs as its own promise in `create()` so network requests get
    // kicked off before we burn CPU on canvas draws.
    this.showLoadingUI();
  }

  create(): void {
    // Override Phaser's canvas→world pointer transform so pointer.x / .y
    // arrive in *logical* coordinates everywhere — including setInteractive
    // hit tests, which read pointer.x directly. Without this, the canvas
    // (Scale.RESIZE → screen-pixel size) and the world (logical, fed
    // through SharpBilinearPipeline) live in different coordinate spaces
    // and every `obj.setInteractive(...)` would fail when the canvas is
    // bigger than logical area. Now both are in logical space, so the
    // existing menu hit areas (rectangles in logical pixels) work
    // unchanged. Custom pointer handlers also receive logical coords —
    // no per-call screenToLogical conversion needed.
    const baseTransformX = this.scale.transformX.bind(this.scale);
    const baseTransformY = this.scale.transformY.bind(this.scale);
    this.scale.transformX = (pageX: number): number => {
      const canvasX = baseTransformX(pageX);
      return (canvasX - displayState.worldOffsetX) / displayState.worldScale;
    };
    this.scale.transformY = (pageY: number): number => {
      const canvasY = baseTransformY(pageY);
      return (canvasY - displayState.worldOffsetY) / displayState.worldScale;
    };

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
    preloadBackgrounds(this);
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
    const creditsPromise = import('../scenes/CreditsScene').then((m) => this.scene.add('Credits', m.CreditsScene));

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
          registerDoorsFrames(this);
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
      creditsPromise,
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

      // On viewport changes (fullscreen toggle, address-bar show/hide,
      // orientation flip, desktop window drag) we update the canvas to
      // the new parent size and recompute displayState so every scene's
      // post-FX upscale targets the right output dims.
      //
      // Listen on RESIZE (not ENTER_FULLSCREEN): Phaser fires RESIZE
      // *after* its own getParentBounds() refresh, so reading parentSize
      // here gives the live post-fullscreen viewport. ENTER_FULLSCREEN
      // fires inside the DOM fullscreenchange handler before the browser
      // has settled the new layout.
      //
      // Guard: only setGameSize when the value actually changes,
      // otherwise we recurse forever (setGameSize -> RESIZE -> ...).
      this.scale.on(Phaser.Scale.Events.RESIZE, () => {
        const pw = this.scale.parentSize.width;
        const ph = this.scale.parentSize.height;
        if (!pw || !ph) return;
        if (pw !== this.scale.width || ph !== this.scale.height) {
          this.scale.setGameSize(pw, ph);
        }
        recomputeDisplay(this);
        // Notify each running scene so it can resize its camera viewport
        // and reposition any screen-anchored UI. Each scene listens for
        // its own RESIZE event from displayState (we just emit on the
        // game registry).
        this.game.events.emit('display-resize');
      });
    });
  }

  private showLoadingUI(): void {
    // Loading bar lives in logical pixel space — pin the camera to it
    // and route through the sharp-bilinear post-FX so the bar fills the
    // height correctly even before any other scene has started.
    bindLogicalCamera(this);
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
