type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'portrait' | 'landscape' | 'any') => Promise<void>;
};

async function enterPortrait(): Promise<void> {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    try {
      await root.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // User denied or unsupported; fall through and try lock anyway.
    }
  }
  const o = screen.orientation as LockableOrientation | undefined;
  try {
    await o?.lock?.('portrait');
  } catch {
    // iOS Safari and some others can't lock outside a standalone PWA.
    // Input is viewport-relative, so the game stays playable either way.
  }
}

window.addEventListener('pointerdown', enterPortrait, { once: true });
