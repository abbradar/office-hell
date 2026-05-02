type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'portrait' | 'landscape' | 'any') => Promise<void>;
};

function tryLock(): void {
  const o = screen.orientation as LockableOrientation | undefined;
  o?.lock?.('portrait').catch(() => {
    // Common cases: iOS Safari doesn't support orientation lock outside a
    // standalone PWA; some Android browsers require fullscreen first.
    // Input is orientation-agnostic, so the game stays playable either way.
  });
}

tryLock();
window.addEventListener('pointerdown', tryLock, { once: true });
