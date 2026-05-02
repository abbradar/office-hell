import Phaser from 'phaser';
import { GAME_W, GAME_H } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { EndScene } from './scenes/EndScene';

// itch.io's iframe embed (especially with "Click to launch in fullscreen")
// doesn't reliably grant keyboard focus on canvas clicks. Browsers are
// inconsistent about whether <canvas> with tabindex actually accepts focus,
// but a <div tabindex="0"> always does. Force focus onto this hidden trap so
// keys land inside the iframe document and bubble to the window where Phaser
// listens. Re-focus on every pointer event, on fullscreen transitions, and on
// load — any of these can wipe focus state in the embed.
const focusTrap = document.createElement('div');
focusTrap.tabIndex = 0;
focusTrap.setAttribute('aria-hidden', 'true');
focusTrap.style.cssText =
  'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;outline:none;pointer-events:none;';
document.body.appendChild(focusTrap);

const tag = (s: string): string => `[focus] ${s}`;
const stateSnapshot = (): string => {
  const ae = document.activeElement;
  const aeDesc = ae ? `${ae.tagName}${ae.id ? '#' + ae.id : ''}` : 'null';
  return `activeElement=${aeDesc} hasFocus=${document.hasFocus()} fs=${document.fullscreenElement ? 'yes' : 'no'} inIframe=${window !== window.top}`;
};

const focusGame = (reason: string): void => {
  const before = stateSnapshot();
  focusTrap.focus({ preventScroll: true });
  console.log(tag(`focusGame(${reason}) before=[${before}] after=[${stateSnapshot()}]`));
};
window.addEventListener('pointerdown', () => focusGame('pointerdown'), { passive: true });
window.addEventListener('pointerup', () => focusGame('pointerup'), { passive: true });
document.addEventListener('fullscreenchange', () => focusGame('fullscreenchange'));
window.addEventListener('load', () => focusGame('load'));
focusGame('init');

// Diagnose where keyboard events actually land. If any of these never fire on
// itch.io, we know the iframe never receives keys at all and the issue is at
// the embed level, not Phaser.
window.addEventListener(
  'keydown',
  (e) => console.log(tag(`window keydown key=${e.key} state=[${stateSnapshot()}]`)),
  true,
);
document.addEventListener(
  'keydown',
  (e) => console.log(tag(`document keydown key=${e.key} state=[${stateSnapshot()}]`)),
  true,
);
focusTrap.addEventListener('keydown', (e) =>
  console.log(tag(`trap keydown key=${e.key} state=[${stateSnapshot()}]`)),
);

window.addEventListener('focus', () => console.log(tag(`window focus ${stateSnapshot()}`)));
window.addEventListener('blur', () => console.log(tag(`window blur ${stateSnapshot()}`)));
console.log(tag(`boot ${stateSnapshot()}`));

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#10101a',
  pixelArt: true,
  // itch.io's CDN serves PNGs with a Content-Type that Firefox refuses to
  // decode when wrapped in a blob URL (Phaser 3.60+'s default XHR-as-blob
  // image path). Force the legacy <img src> loader so the browser sniffs the
  // bytes itself.
  loader: { imageLoadType: 'HTMLImageElement' },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, MenuScene, GameScene, EndScene],
});
