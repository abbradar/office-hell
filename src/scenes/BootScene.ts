import Phaser from 'phaser';
import { initBuses } from '../audio/buses';
import { MENU_LOOP_KEY } from '../audio/keys';
import { installAutoPauseOnBlur, playMusicLoop, setMusicManager } from '../audio/music/loop';
import { configureVoiceCaps, preloadAudio } from '../audio/preload';
import { setSoundManager } from '../audio/sfx/pool';
import { computeCanvasH } from '../canvasSize';
import { GAME_H, GAME_W } from '../config';
import { preloadCharacterSheets, registerAllCharacterAnims } from '../content/characterSheets';
import { preloadElevator, registerElevatorAnims } from '../content/elevator';
import {
  generateTextures,
  preloadBackgrounds,
  preloadBombExplosion,
  preloadBullets,
  preloadPlayerBullet,
  preloadWaterDispenser,
  registerBombAnims,
} from '../content/textures';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { DISPLAY_RESIZE_EVENT, displayState } from '../render/displayState';
import { loadInputIcons } from '../ui/inputIcons';
import { preloadMuteIcons } from '../ui/muteButton';
import { COLOR_ACCENT_GOLD, COLOR_PANEL_BORDER, COLOR_TEXT_DIM_STR, COLOR_WALL_STR } from '../ui/palette';

// Recompute the world-on-canvas geometry shared by every scene.
//
// The Phaser canvas internal is sized at native device pixels (parent CSS
// × DPR) so each canvas pixel == a screen pixel. Inside the canvas, the
// world (GAME_W × logicalH) is centered + scaled by `scale = min(canvas /
// world)`. Per-scene cameras (see render/cameraBind.ts) read this state
// and pin their viewport + zoom; the factory override in
// render/textResolution.ts reads `scale` for Text resolution.
//
// `setGameSize` is called only when the target dimensions differ from the
// current ones — otherwise the call would re-trigger Phaser's RESIZE
// event and we'd recurse forever.
export function recomputeDisplay(scene: Phaser.Scene): boolean {
  const cssW = scene.scale.parentSize.width;
  const cssH = scene.scale.parentSize.height;
  if (!cssW || !cssH) return false;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(1, Math.round(cssW * dpr));
  const targetH = Math.max(1, Math.round(cssH * dpr));
  let resized = false;
  if (targetW !== scene.scale.width || targetH !== scene.scale.height) {
    scene.scale.setGameSize(targetW, targetH);
    resized = true;
  }
  // Phaser's Scale.RESIZE writes canvas.style.width/height in canvas-
  // internal pixels (= our device pixels), which would visually blow the
  // canvas up DPR× past the parent. Override to CSS px so the rendered
  // size matches the parent rect.
  const c = scene.game.canvas;
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;

  const logicalH = computeCanvasH(cssW, cssH);
  const sByW = targetW / GAME_W;
  const sByH = targetH / logicalH;
  const s = Math.min(sByW, sByH);
  const renderedW = GAME_W * s;
  const renderedH = logicalH * s;
  const offX = Math.max(0, Math.round((targetW - renderedW) / 2));
  const offY = Math.max(0, Math.round((targetH - renderedH) / 2));

  displayState.scale = s;
  displayState.offsetX = offX;
  displayState.offsetY = offY;
  displayState.logicalH = logicalH;
  displayState.canvasW = targetW;
  displayState.canvasH = targetH;
  return resized;
}

export class BootScene extends Phaser.Scene {
  // Set in showLoadingUI() during preload(). Phaser guarantees preload runs
  // before create(), so by the time anyone reads it the assignment is in.
  private loadingText!: Phaser.GameObjects.Text;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // Prime displayState before the loading-bar text renders so
    // `Text.resolution = scale` resolves to the live value at creation
    // time. Without this, the bar text rasterises against scale=1 and
    // looks fuzzy until the first runtime resize.
    recomputeDisplay(this);
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

    // Pause the active music track on window blur / tab hide and resume
    // it on focus. Without this, Phaser's per-sound loop machinery (which
    // reschedules a new buffer source on every update tick at the loop
    // boundary) goes stale while rAF is throttled in a hidden tab — the
    // menu loop can audibly restart from the beginning, or two source
    // nodes can overlap and double up, when focus returns.
    installAutoPauseOnBlur(this.game);

    // Queue the heavy stuff (character sheets + gameplay audio) and kick the
    // loader. Phaser is happy to run a second pass after preload — the
    // existing PROGRESS handler refills the bar for this batch.
    preloadCharacterSheets(this);
    preloadElevator(this);
    preloadBackgrounds(this);
    preloadPlayerBullet(this);
    preloadBullets(this);
    preloadWaterDispenser(this);
    preloadBombExplosion(this);
    preloadAudio(this);
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
          registerBombAnims(this);
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

    // Input icon SVGs load outside the Phaser loader: they're decoded
    // into a white-on-transparent stencil canvas at a high baseline
    // resolution and registered as Phaser textures (see inputIcons.ts).
    // Kicked off in parallel with the rest.
    const inputIconsPromise = loadInputIcons(this.game);

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
      inputIconsPromise,
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
      //
      // On touch the listener stays installed for the lifetime of the game
      // so that any subsequent press re-requests fullscreen if the browser
      // dropped us out (Esc, OS back gesture, etc.). On non-touch we tear
      // it down after the first press — there's no fullscreen path to keep
      // arming.
      let started = false;
      const onGesture = () => {
        if (isTouchDevice && !this.scale.isFullscreen) {
          this.scale.startFullscreen();
        }
        if (started) return;
        started = true;
        // Browsers require a user gesture to unlock the AudioContext —
        // this handler is that gesture, which is why we don't start the loop
        // until the player presses something.
        playMusicLoop(MENU_LOOP_KEY);
        this.scene.start('Menu');
        if (!isTouchDevice) {
          window.removeEventListener('pointerup', onGesture);
          window.removeEventListener('keydown', onGesture);
        }
      };

      // Listen on window so a laptop with a touch screen catches either input.
      window.addEventListener('pointerup', onGesture);
      window.addEventListener('keydown', onGesture);

      // Tear the keepalive down with the game so a hot-reload or explicit
      // game.destroy() doesn't leak a dangling listener.
      this.game.events.once(Phaser.Core.Events.DESTROY, () => {
        window.removeEventListener('pointerup', onGesture);
        window.removeEventListener('keydown', onGesture);
      });

      // When the viewport changes (fullscreen toggle, address-bar
      // show/hide, orientation flip, desktop window drag) recompute the
      // device-pixel canvas size + world-rect math, then notify every
      // scene so its main camera re-pins the viewport / zoom and any
      // text bitmap re-rasterises at the new scale.
      //
      // Listen on RESIZE (not ENTER_FULLSCREEN): Phaser fires RESIZE
      // *after* its own getParentBounds() refresh, so reading parentSize
      // here gives the live post-fullscreen viewport. ENTER_FULLSCREEN
      // fires inside the DOM fullscreenchange handler before the browser
      // has settled the new layout.
      //
      // recomputeDisplay returns true only when it called setGameSize
      // (which itself re-fires RESIZE). The DISPLAY_RESIZE_EVENT below
      // only goes out on actual changes — emitting unconditionally would
      // be cheap but would re-rasterise every Text on every native scroll
      // tick, which is a lot of work for nothing.
      this.scale.on(Phaser.Scale.Events.RESIZE, () => {
        const before = `${displayState.canvasW}x${displayState.canvasH}|${displayState.logicalH}`;
        recomputeDisplay(this);
        const after = `${displayState.canvasW}x${displayState.canvasH}|${displayState.logicalH}`;
        if (before !== after) this.game.events.emit(DISPLAY_RESIZE_EVENT);
      });
    });
  }

  private showLoadingUI(): void {
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
