// Telegram Mini App integration.
//
// The whole game is the same Vite build everywhere (itch, portals,
// desktop); this module is the single place that adapts it to running
// inside the Telegram in-app webview. Nothing here loads or runs unless
// the page was actually launched from Telegram, so the itch/portal/desktop
// builds are completely unaffected — no extra network request, no SDK.
//
// Detection is synchronous: Telegram injects `tgWebApp*` params into the
// launch URL fragment (e.g. `#tgWebAppData=…&tgWebAppVersion=8.0&
// tgWebAppPlatform=ios`). If they're absent we bail before touching the
// network. If present, we inject Telegram's official SDK script
// (`telegram-web-app.js`, which must match the client version, so it has
// to come from telegram.org rather than an npm pin) and drive the handful
// of WebApp calls that matter for a drag-to-move bullet hell.
//
// The load-bearing call is `disableVerticalSwipes()`: Telegram minimises
// the Mini App on a downward swipe, and the player's core input *is* a
// vertical thumb drag — without this, dodging downward keeps half-closing
// the app. `expand()` + `requestFullscreen()` reclaim the screen; the rest
// is cosmetics (header/background colour to match the game).

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
const BG_COLOR = '#10101a'; // matches Phaser backgroundColor + index.html theme-color

// Minimal shape of the bits of `window.Telegram.WebApp` we touch. The full
// surface is large and version-dependent; typing only what we call keeps us
// honest about the guarded subset. Methods added in later Bot API versions
// are optional and gated behind `isVersionAtLeast`.
interface TelegramWebApp {
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: string, cb: () => void): void;
  setBackgroundColor?(color: string): void;
  setHeaderColor?(color: string): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  lockOrientation?(orientation: 'portrait' | 'landscape'): void;
  // Bot API 8.0+: insets to clear the device safe area (notch, status bar)
  // and Telegram's own overlaid controls (X Close bar in fullscreen mode).
  // In expanded (non-fullscreen) mode, contentSafeAreaInset.top is 0 since
  // the Telegram bar is external chrome above the webview; in fullscreen it
  // equals the overlaid bar height. We use these JS values instead of the
  // --tg-*-safe-area-inset-* CSS variables because CSS variable propagation
  // is not reliable on all client versions.
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: { top: number; right: number; bottom: number; left: number };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

let active = false;

// True once `initTelegram()` has confirmed we're running inside Telegram
// and wired up the SDK. Read by the boot path to skip the browser-fullscreen
// gesture (Telegram owns fullscreen) and by anything that wants to branch on
// the host.
export function isTelegramActive(): boolean {
  return active;
}

// Synchronous, network-free check: did Telegram launch us? Safe to call
// before the SDK is loaded.
export function isTelegramLaunch(): boolean {
  return typeof window !== 'undefined' && window.location.hash.includes('tgWebApp');
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

// Initialise Telegram if (and only if) we were launched from it. Resolves to
// whether the integration is active. Awaited once in main.ts before Phaser is
// constructed, so the viewport is already expanded/fullscreen by the time the
// canvas is sized. A non-Telegram launch resolves on the next microtask with
// no side effects.
export async function initTelegram(): Promise<boolean> {
  if (!isTelegramLaunch()) return false;

  try {
    await loadScript(SDK_URL);
  } catch {
    // Offline or telegram.org blocked: fall through as a plain web build
    // rather than wedging the game on a missing SDK.
    return false;
  }

  const wa = window.Telegram?.WebApp;
  if (!wa) return false;

  active = true;
  wa.ready();

  const atLeast = (v: string) => typeof wa.isVersionAtLeast === 'function' && wa.isVersionAtLeast(v);
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Older clients can throw on unsupported methods even past the version
      // guard; never let a cosmetic call take down boot.
    }
  };

  guard(() => wa.expand());
  // disableVerticalSwipes (Bot API 7.7+) is the one that actually matters —
  // see the file header.
  if (atLeast('7.7') && wa.disableVerticalSwipes) guard(() => wa.disableVerticalSwipes?.());
  // Fullscreen + orientation lock (Bot API 8.0+).
  if (atLeast('8.0')) {
    if (wa.lockOrientation) guard(() => wa.lockOrientation?.('portrait'));
    if (wa.requestFullscreen) guard(() => wa.requestFullscreen?.());
  }
  if (wa.setBackgroundColor) guard(() => wa.setBackgroundColor?.(BG_COLOR));
  if (wa.setHeaderColor) guard(() => wa.setHeaderColor?.(BG_COLOR));

  // Apply Telegram's safe-area insets as body padding so the canvas clears
  // both the device notch (safeAreaInset) and any overlaid Telegram controls
  // (contentSafeAreaInset — the X Close bar when in fullscreen mode).
  //
  // We drive this from the JS API rather than CSS variables because:
  // 1. CSS variable propagation is not reliable on all client versions.
  // 2. The JS values update via events (safeAreaChanged, contentSafeAreaChanged)
  //    when the user transitions between expanded and fullscreen modes, and we
  //    can re-trigger Phaser's resize path in response.
  //
  // Setting body.style.paddingTop as an inline style overrides the CSS
  // `env(safe-area-inset-top)` rule in index.html, which only applies to
  // non-Telegram contexts. Telegram's safeAreaInset.top already includes the
  // device safe area so there is no double-counting.
  //
  // Called once synchronously here (before Phaser reads bodyRect in main.ts)
  // and again from the change events (after Phaser is running, so the resize
  // path re-fits the canvas). Only available on Bot API 8.0+; older clients
  // fall through and the CSS env() rule stays in effect.
  // Debug overlay — fixed div showing live values so problems are visible
  // on a real device without devtools. Remove once the inset wiring is confirmed.
  const dbg = document.createElement('div');
  Object.assign(dbg.style, {
    position: 'fixed', top: '0', left: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.75)', color: '#0f0', fontFamily: 'monospace',
    fontSize: '11px', padding: '4px 6px', lineHeight: '1.5', pointerEvents: 'none',
  });
  document.body.appendChild(dbg);
  const updateDbg = (): void => {
    const safeTop = wa.safeAreaInset?.top;
    const contentTop = wa.contentSafeAreaInset?.top;
    dbg.textContent = [
      `api≥8.0: ${atLeast('8.0')}`,
      `safeArea.top: ${safeTop ?? 'undef'}`,
      `contentSafe.top: ${contentTop ?? 'undef'}`,
      `body.paddingTop: ${document.body.style.paddingTop || '(css)'}`,
      `innerH: ${window.innerHeight}`,
      `bodyH: ${Math.round(document.body.getBoundingClientRect().height)}`,
    ].join('\n');
  };
  updateDbg();

  if (atLeast('8.0')) {
    const applyInsets = (): void => {
      const safeTop = wa.safeAreaInset?.top ?? 0;
      const contentTop = wa.contentSafeAreaInset?.top ?? 0;
      document.body.style.paddingTop = `${safeTop + contentTop}px`;
      updateDbg();
    };
    applyInsets();
    wa.onEvent('safeAreaChanged', () => {
      applyInsets();
      window.dispatchEvent(new Event('resize'));
    });
    wa.onEvent('contentSafeAreaChanged', () => {
      applyInsets();
      window.dispatchEvent(new Event('resize'));
    });
  }

  // Telegram resizes the webview on expand, fullscreen, and orientation
  // changes; nudge Phaser's ScaleManager so BootScene's RESIZE handler
  // recomputes the device-pixel canvas geometry.
  wa.onEvent('viewportChanged', () => window.dispatchEvent(new Event('resize')));

  return true;
}
