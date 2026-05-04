import Phaser from 'phaser';
import { initBuses } from '../audio/buses';
import { MENU_LOOP_KEY } from '../audio/keys';
import { playMusicLoop, setMusicManager } from '../audio/music/loop';
import { configureVoiceCaps, preloadAudio } from '../audio/preload';
import { setSoundManager } from '../audio/sfx/pool';
import { GAME_H, GAME_W } from '../config';
import { preloadCharacterSheets, registerAllCharacterAnims } from '../content/characterSheets';
import { generateTextures } from '../content/textures';
import { isTouchDevice } from '../input/device';
import { preloadInputIcons } from '../ui/inputIcons';
import { preloadMuteIcons } from '../ui/muteButton';

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

    // Queue the heavy stuff (character sheets + gameplay audio) and kick the
    // loader. Phaser is happy to run a second pass after preload — the
    // existing PROGRESS handler refills the bar for this batch.
    preloadCharacterSheets(this);
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
      fontsPromise,
      texturesPromise,
    ]).then(() => {
      const promptText = isTouchDevice ? 'tap to continue' : 'press any key or click to continue';
      this.loadingText.setText(promptText);

      const onGesture = () => {
        // 1s self-crossfade dissolves the loop seam; the menu sits open long
        // enough that a hard wrap (even a sample-accurate one) gets perceptible.
        // Browsers also require a user gesture to unlock the AudioContext —
        // this handler is that gesture, which is why we don't start the loop
        // until the player presses something.
        playMusicLoop(MENU_LOOP_KEY, { crossfadeMs: 1000 });
        this.scene.start('Menu');
      };

      // Register both — a laptop with a touch screen can produce either, and
      // there's no harm in listening for both since we only fire once.
      this.input.once(Phaser.Input.Events.POINTER_DOWN, onGesture);
      this.input.keyboard?.once(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, onGesture);
    });
  }

  private showLoadingUI(): void {
    this.cameras.main.setBackgroundColor('#10101a');

    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const barW = 320;
    const barH = 14;
    const barX = cx - barW / 2;
    const barY = cy - barH / 2;

    this.add
      .text(cx, cy - 60, 'OFFICE HELL', {
        color: '#ff5577',
        fontSize: '36px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.loadingText = this.add
      .text(cx, cy - 24, 'loading…', {
        color: '#888888',
        fontSize: '14px',
      })
      .setOrigin(0.5);

    const border = this.add.graphics();
    border.lineStyle(2, 0x444466, 1);
    border.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    const fill = this.add.graphics();
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(0xffd96a, 1);
      fill.fillRect(barX, barY, barW * value, barH);
    });
  }
}
