// Scene-churn probe. Like leak-probe.mjs, but instead of sitting on the
// menu it bounces Menu ↔ Credits ↔ Menu ↔ TestMenu ↔ Menu repeatedly,
// sampling between transitions. Looks for state that grows when scenes
// shut down and re-create.
//
// Run: PROBE_URL=http://localhost:5174/ node scripts/leak-churn.mjs

import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const URL = process.env.PROBE_URL ?? 'http://localhost:5173/';
const CYCLES = Number(process.env.PROBE_CYCLES ?? 8);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const txt = msg.text();
    if (txt.startsWith('[churn]')) console.log(`[page] ${txt}`);
  });
  page.on('pageerror', (e) => console.log(`[page:err] ${e.message}`));

  console.log(`[probe] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'load' });

  await page.waitForFunction(() => !!window.__game?.scene?.getScene('Menu'), { timeout: 30_000 });

  // Boot through the gesture gate.
  for (let i = 0; i < 20; i++) {
    const isMenu = await page.evaluate(
      () => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === 'Menu' && s.scene.isActive()),
    );
    if (isMenu) break;
    await page.mouse.click(400, 400);
    await page.keyboard.press('Space');
    await sleep(400);
  }
  await page.waitForFunction(
    () => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === 'Menu' && s.scene.isActive()),
    { timeout: 15_000 },
  );
  console.log('[probe] menu active');
  await sleep(800);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  // Helper: push the menu through a scene transition + come back.
  async function snapshot(label) {
    await page.evaluate(() => {
      if (typeof window.gc === 'function')
        try {
          window.gc();
        } catch (_) {
          /* */
        }
    });
    await sleep(200);
    const m = await cdp.send('Performance.getMetrics');
    const mm = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
    const counts = await page.evaluate(() => {
      const g = window.__game;
      const out = { scenes: [], totalGameObjects: 0, totalTweens: 0, totalTimers: 0 };
      for (const s of g.scene.scenes) {
        let n = 0;
        const visit = (o) => {
          n++;
          if (o.list) for (const c of o.list) visit(c);
        };
        for (const c of s.children?.list ?? []) visit(c);
        const tweens = s.tweens?._active?.length ?? 0;
        const timers = s.time?._active?.length ?? 0;
        out.scenes.push({
          k: s.scene.key,
          active: s.scene.isActive(),
          obj: n,
          tweens,
          timers,
          listeners: s.events?._eventsCount ?? 0,
          inputListeners: s.input?._eventsCount ?? 0,
        });
        out.totalGameObjects += n;
        out.totalTweens += tweens;
        out.totalTimers += timers;
      }
      return out;
    });
    console.log(
      `[${label}] heapUsed=${(mm.JSHeapUsedSize / 1024).toFixed(0)}KB nodes=${mm.Nodes} listeners=${mm.JSEventListeners} audio=${mm.AudioHandlers}`,
    );
    console.log(
      `[${label}] totalGameObj=${counts.totalGameObjects} tweens=${counts.totalTweens} timers=${counts.totalTimers}`,
    );
    for (const s of counts.scenes) {
      if (s.active || s.obj > 0) {
        console.log(
          `  ${s.active ? '*' : ' '} ${s.k.padEnd(16)} obj=${s.obj} tw=${s.tweens} tm=${s.timers} ev=${s.listeners} inEv=${s.inputListeners}`,
        );
      }
    }
    return mm;
  }

  // Helper: drive a scene start FROM the currently active scene's
  // ScenePlugin. Calling start() from a non-active scene's plugin only
  // stops `this` (a no-op when already stopped), so the currently-active
  // scene would never be torn down.
  async function gotoScene(targetKey) {
    await page.evaluate((key) => {
      const g = window.__game;
      const active = g.scene.scenes.find((s) => s.scene.isActive());
      if (!active) throw new Error('no active scene');
      active.scene.start(key);
    }, targetKey);
    await page.waitForFunction(
      (key) => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === key && s.scene.isActive()),
      targetKey,
      { timeout: 5_000 },
    );
    await sleep(500);
  }

  const baseline = await snapshot('baseline');

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    await gotoScene('Credits');
    await gotoScene('Menu');
    await gotoScene('TestMenu');
    await gotoScene('Menu');
    await snapshot(`cycle ${cycle}`);
  }

  const final = await snapshot('final');

  console.log('\n[summary]');
  const keys = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'JSEventListeners', 'AudioHandlers'];
  for (const k of keys) {
    const a = baseline[k] ?? 0,
      b = final[k] ?? 0;
    const fmt = k.includes('Heap')
      ? `${(a / 1024).toFixed(0)}KB → ${(b / 1024).toFixed(0)}KB (Δ${((b - a) / 1024).toFixed(1)}KB)`
      : `${a} → ${b} (Δ${b - a})`;
    console.log(`  ${k}: ${fmt}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
