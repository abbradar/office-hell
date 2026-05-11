// Run the practice boss fight in headless Chromium and capture
// screenshots every 250 ms for the first 8 seconds of the music
// track. Used to verify whether line-stroke telegraphs at t=2.124
// and t=4.248 actually draw on screen.
//
// Output: /tmp/boss-frames/frame_NN.png + a manifest of music
// times.

import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.PROBE_URL ?? 'http://localhost:5174/';
const OUT = '/tmp/boss-frames';
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 480, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[err] ${e.message}`));
  page.on('console', (msg) => {
    const t = msg.type();
    const txt = msg.text();
    if (t === 'error' || txt.startsWith('[boss-probe]')) console.log(`[page:${t}] ${txt}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game?.scene?.getScene?.('Menu'), { timeout: 20_000 });

  // Boot gesture — dismiss tap-to-start.
  for (let i = 0; i < 8; i++) {
    const isMenu = await page.evaluate(
      () => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === 'Menu' && s.scene.isActive()),
    );
    if (isMenu) break;
    await page.mouse.click(240, 360);
    await page.keyboard.press('Space');
    await sleep(300);
  }
  console.log('[probe] menu active');

  // Press T to go to TestMenu.
  await page.keyboard.press('T');
  await page.waitForFunction(
    () => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === 'TestMenu' && s.scene.isActive()),
    { timeout: 5_000 },
  );
  console.log('[probe] test menu active');
  await sleep(300);

  // Pick the boss row via the TestMenu's internal state and trigger
  // its private `start()` method. Phaser exposes the method at
  // runtime regardless of TS private.
  await page.evaluate(() => {
    const tm = window.__game.scene.getScene('TestMenu');
    const state = tm.state;
    const headers = state.headerTexts?.length ?? 0;
    const bossIdx = state.rows.findIndex((r) =>
      (r.text ?? '').toLowerCase().includes('final boss'),
    );
    if (bossIdx < 0) throw new Error('boss row not found');
    state.cursor = headers + bossIdx;
    tm.start();
  });

  await page.waitForFunction(
    () => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === 'Game' && s.scene.isActive()),
    { timeout: 5_000 },
  );
  console.log('[probe] game scene active — waiting for boss entry + dialog');

  // Dismiss the opening dialog by hammering Space until the music
  // starts (== music time becomes a real number > 0).
  const dialogDeadline = Date.now() + 30_000;
  while (Date.now() < dialogDeadline) {
    const musicTime = await page.evaluate(() => {
      const g = window.__game;
      const game = g.scene.getScene('Game');
      // Music time is exposed on the stage manager via getMusicTime
      // imported from audio/music/loop — but easier to read via the
      // raw audio context.
      const sm = game.stage;
      if (!sm) return null;
      // Use the stage's lastBeat etc — fallback to checking via the
      // module: window.__game.sound's context might work.
      try {
        // best effort: the audio module exports getMusicTime
        return null;
      } catch {
        return null;
      }
    });
    // We can't easily read getMusicTime from page; just check whether
    // the music key is current.
    const isReady = await page.evaluate(() => {
      const g = window.__game;
      const game = g.scene.getScene('Game');
      // Heuristic: boss exists and is alive AND no dialogue is active.
      const stage = game.stage;
      if (!stage) return false;
      if (stage.paused) return false;  // dialog freeze flips this on
      // Confirm the boss has entered.
      return !stage.dialogue;  // optimistic
    });
    if (isReady) break;
    await page.keyboard.press('Space');
    await sleep(200);
  }

  // Wait a touch longer for music to begin and beat 0 to fire.
  await sleep(500);
  console.log('[probe] capturing 8 s of frames');

  const captureStart = Date.now();
  const INTERVAL_MS = 250;
  const DURATION_MS = 8000;
  let frame = 0;
  const manifest = [];
  while (Date.now() - captureStart < DURATION_MS) {
    const elapsed = ((Date.now() - captureStart) / 1000).toFixed(2);
    const path = `${OUT}/frame_${String(frame).padStart(2, '0')}_t${elapsed}.png`;
    await page.screenshot({ path, fullPage: false, clip: { x: 0, y: 0, width: 480, height: 720 } });
    manifest.push({ frame, elapsed_s: Number(elapsed), file: path });
    frame++;
    await sleep(INTERVAL_MS);
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`[probe] ${frame} frames → ${OUT}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
