// Firefox version of leak-probe.mjs.
//
// Differences vs Chromium variant:
//   - No CDP — Firefox uses Juggler. Playwright doesn't expose CDP for FF.
//   - No `performance.memory` — Chrome-only API.
//   - No --expose-gc — V8-only.
//
// We sample what *is* portable: Phaser counters (scene game-objects,
// tweens, timers), EventEmitter listener counts, DOM node count, and
// any window.performance entries that grow. A real leak in the menu
// will surface here as a monotonic rise in any of these counters.
//
// Run:
//   PROBE_URL=http://localhost:5174/ node scripts/leak-probe-ff.mjs

import { firefox } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.env.PROBE_URL ?? 'http://localhost:5173/';
const RUN_SECS = Number(process.env.PROBE_SECS ?? 75);
const STEP_SECS = Number(process.env.PROBE_STEP ?? 2);

async function main() {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const t = msg.type();
    const txt = msg.text();
    if (txt.startsWith('[leak-probe]') || t === 'error' || t === 'warning') {
      console.log(`[page:${t}] ${txt}`);
    }
  });
  page.on('pageerror', (e) => console.log(`[page:pageerror] ${e.message}`));

  console.log(`[probe] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'load' });

  await page.waitForFunction(() => !!window.__game?.scene?.getScene('Menu'), { timeout: 30_000 });

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
  await sleep(500);

  await page.evaluate(({ stepMs }) => {
    const g = window.__game;

    function gameObjectsAlive(scene) {
      let n = 0;
      const visit = (o) => { n += 1; if (o.list) for (const c of o.list) visit(c); };
      for (const c of scene.children?.list ?? []) visit(c);
      return n;
    }
    function tweenStats(scene) {
      const tm = scene.tweens;
      if (!tm) return { tweens: 0, pending: 0 };
      const active = tm._active?.length ?? tm.getTweens?.()?.length ?? 0;
      const pending = tm._pending?.length ?? 0;
      return { tweens: active, pending };
    }
    function timerStats(scene) {
      return scene.time?._active?.length ?? 0;
    }
    function activeSceneStats(game) {
      const out = [];
      for (const s of game.scene.scenes) {
        if (!s.scene.isActive() && !s.scene.isVisible()) continue;
        out.push({
          key: s.scene.key,
          obj: gameObjectsAlive(s),
          ...tweenStats(s),
          timers: timerStats(s),
        });
      }
      return out;
    }
    function listenerCounts(game) {
      const out = {};
      const probe = (name, e) => { if (e) out[name] = e._eventsCount ?? -1; };
      probe('game.events', game.events);
      probe('game.sound', game.sound);
      probe('game.scale', game.scale);
      const menu = game.scene.scenes.find((s) => s.scene.key === 'Menu');
      probe('menu.events', menu?.events);
      probe('menu.input', menu?.input);
      return out;
    }

    const t0 = performance.now();
    let n = 0;
    const sample = () => {
      n += 1;
      const ts = ((performance.now() - t0) / 1000).toFixed(1);
      const dom = document.getElementsByTagName('*').length;
      const fps = Math.round(g.loop?.actualFps ?? 0);
      const sounds = g.sound?.sounds?.length ?? 0;
      const row = {
        t: ts,
        n,
        fps,
        dom,
        sounds,
        scenes: activeSceneStats(g),
        listeners: listenerCounts(g),
      };
      console.log('[leak-probe]', JSON.stringify(row));
    };
    sample();
    window.__leakProbeInterval = setInterval(sample, stepMs);
  }, { stepMs: STEP_SECS * 1000 });

  console.log(`[probe] sampling for ${RUN_SECS}s…`);
  await sleep(RUN_SECS * 1000);

  await page.evaluate(() => clearInterval(window.__leakProbeInterval));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
