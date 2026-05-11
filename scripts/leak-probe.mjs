// Memory-leak probe for the main menu.
//
// Drives a headless Chromium against `npm run dev`, sits on the menu, and
// samples heap + Phaser counters every 2 seconds for ~75 seconds. The
// diagnostic is injected at runtime via `page.evaluate` — no source
// modifications. Output is a tab-separated table on stdout plus a CDP
// `Performance.getMetrics` snapshot before & after.
//
// Run:
//   node scripts/leak-probe.mjs            # uses an already-running dev server on :5173
//   node scripts/leak-probe.mjs --start    # boots vite itself
//
// Tunables (env):
//   PROBE_URL    default http://localhost:5173/
//   PROBE_SECS   default 75
//   PROBE_STEP   default 2

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const URL = process.env.PROBE_URL ?? 'http://localhost:5173/';
const RUN_SECS = Number(process.env.PROBE_SECS ?? 75);
const STEP_SECS = Number(process.env.PROBE_STEP ?? 2);
const SHOULD_START_SERVER = process.argv.includes('--start');

let viteProc = null;
async function maybeStartServer() {
  if (!SHOULD_START_SERVER) return;
  console.log('[probe] starting vite dev server…');
  viteProc = spawn('npm', ['run', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let ready = false;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not become ready in 30s')), 30_000);
    viteProc.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      if (!ready && /Local:.*localhost/i.test(s)) {
        ready = true;
        clearTimeout(t);
        resolve();
      }
    });
    viteProc.stderr.on('data', (c) => process.stderr.write(c));
  });
  console.log('[probe] vite ready');
}

function stopServer() {
  if (viteProc && !viteProc.killed) {
    viteProc.kill('SIGTERM');
  }
}

async function main() {
  await maybeStartServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  const page = await context.newPage();

  // Forward console output (especially our probe's `[leak-probe]` rows).
  page.on('console', (msg) => {
    const t = msg.type();
    const txt = msg.text();
    // Only echo our own rows and errors/warnings; Phaser is chatty otherwise.
    if (txt.startsWith('[leak-probe]') || t === 'error' || t === 'warning') {
      console.log(`[page:${t}] ${txt}`);
    }
  });
  page.on('pageerror', (e) => console.log(`[page:pageerror] ${e.message}`));

  console.log(`[probe] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'load' });

  // Wait until BootScene has registered MenuScene (its assets-promise has
  // resolved and the gesture listener is armed).
  await page.waitForFunction(
    () => {
      const g = window.__game;
      if (!g?.scene) return false;
      return g.scene.getScene && !!g.scene.getScene('Menu');
    },
    { timeout: 30_000 },
  );

  // Synthesize gestures until the boot scene transitions. The boot scene
  // listens on `window.pointerup` / `keydown` — any one fires the
  // transition. On non-touch, the listener tears itself down after the
  // first hit, so the loop exits naturally.
  for (let i = 0; i < 20; i++) {
    const isMenu = await page.evaluate(() => {
      const g = window.__game;
      return !!g?.scene?.scenes?.some((s) => s.scene.key === 'Menu' && s.scene.isActive());
    });
    if (isMenu) break;
    await page.mouse.click(400, 400);
    await page.keyboard.press('Space');
    await sleep(500);
  }

  await page.waitForFunction(
    () => {
      const g = window.__game;
      return !!g?.scene?.scenes?.some((s) => s.scene.key === 'Menu' && s.scene.isActive());
    },
    { timeout: 15_000 },
  );
  console.log('[probe] menu active');
  await sleep(500);

  // Inject probe.
  await page.evaluate(
    ({ stepMs }) => {
      const g = window.__game;
      if (!g) {
        console.log('[leak-probe] __game missing; aborting');
        return;
      }

      // Snapshot the prototype-level event names so we can spot listener
      // counts that grow over the run.
      function gameObjectsAlive(scene) {
        let n = 0;
        const visit = (o) => {
          n += 1;
          if (o.list) for (const c of o.list) visit(c);
        };
        for (const c of scene.children?.list ?? []) visit(c);
        return n;
      }

      function tweenStats(scene) {
        const tm = scene.tweens;
        if (!tm) return { tweens: 0, pending: 0 };
        // Phaser 3.85: TweenManager keeps `_active` and `_pending` (or .tweens)
        const active = tm._active?.length ?? tm.getTweens?.()?.length ?? 0;
        const pending = tm._pending?.length ?? 0;
        return { tweens: active, pending };
      }

      function timerStats(scene) {
        const tc = scene.time;
        if (!tc) return 0;
        // Phaser TimerEvent list lives on `_active` (Clock).
        return tc._active?.length ?? tc._pendingInsertion?.length ?? 0;
      }

      function soundStats(game) {
        const sm = game.sound;
        if (!sm) return 0;
        return sm.sounds?.length ?? 0;
      }

      function activeSceneStats(game) {
        const out = [];
        for (const s of game.scene.scenes) {
          if (!s.scene.isActive() && !s.scene.isVisible()) continue;
          out.push({
            key: s.scene.key,
            gameObjects: gameObjectsAlive(s),
            ...tweenStats(s),
            timers: timerStats(s),
          });
        }
        return out;
      }

      function listenerCounts(game) {
        // Phaser's EventEmitter exposes `_eventsCount`. We sample a few suspects.
        const out = {};
        const probe = (name, emitter) => {
          if (!emitter) return;
          out[name] = emitter._eventsCount ?? -1;
        };
        probe('game.events', game.events);
        probe('game.sound', game.sound);
        probe('game.scale', game.scale);
        const menu = game.scene.scenes.find((s) => s.scene.key === 'Menu');
        probe('menu.events', menu?.events);
        probe('menu.input', menu?.input);
        probe('menu.tweens', menu?.tweens);
        probe('menu.time', menu?.time);
        return out;
      }

      const t0 = performance.now();
      let tickN = 0;

      const sample = () => {
        tickN += 1;
        const mem = performance.memory ?? null;
        const used = mem ? Math.round(mem.usedJSHeapSize / 1024) : -1;
        const total = mem ? Math.round(mem.totalJSHeapSize / 1024) : -1;
        const limit = mem ? Math.round(mem.jsHeapSizeLimit / 1024) : -1;
        const sceneStats = activeSceneStats(g);
        const sndCount = soundStats(g);
        const listeners = listenerCounts(g);
        const fps = Math.round(g.loop?.actualFps ?? 0);
        const ts = ((performance.now() - t0) / 1000).toFixed(1);
        const row = {
          t: ts,
          n: tickN,
          fps,
          usedKB: used,
          totalKB: total,
          limitKB: limit,
          sounds: sndCount,
          scenes: sceneStats,
          listeners,
        };
        console.log('[leak-probe]', JSON.stringify(row));
      };

      sample();
      window.__leakProbeInterval = setInterval(sample, stepMs);
    },
    { stepMs: STEP_SECS * 1000 },
  );

  // Snapshot some CDP-level metrics at the start.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const startMetrics = await cdp.send('Performance.getMetrics');
  console.log('[probe] start metrics:', JSON.stringify(simplifyMetrics(startMetrics)));

  // Sit on the menu.
  console.log(`[probe] sampling for ${RUN_SECS}s…`);
  await sleep(RUN_SECS * 1000);

  // Force a GC if available, then take final metrics.
  await page.evaluate(() => {
    clearInterval(window.__leakProbeInterval);
    if (typeof window.gc === 'function') {
      try {
        window.gc();
      } catch (_) {
        /* ignore */
      }
    }
  });
  await sleep(500);

  const endMetrics = await cdp.send('Performance.getMetrics');
  console.log('[probe] end metrics:', JSON.stringify(simplifyMetrics(endMetrics)));

  // Diff suite of suspect counters.
  const diff = diffMetrics(startMetrics.metrics, endMetrics.metrics, [
    'JSHeapUsedSize',
    'JSHeapTotalSize',
    'Nodes',
    'JSEventListeners',
    'LayoutCount',
    'RecalcStyleCount',
    'AudioHandlers',
  ]);
  console.log('[probe] diff:', JSON.stringify(diff, null, 2));

  await browser.close();
  stopServer();
}

function simplifyMetrics(res) {
  const out = {};
  for (const m of res.metrics) out[m.name] = m.value;
  return out;
}

function diffMetrics(a, b, keys) {
  const ma = Object.fromEntries(a.map((m) => [m.name, m.value]));
  const mb = Object.fromEntries(b.map((m) => [m.name, m.value]));
  const out = {};
  for (const k of keys) {
    if (ma[k] === undefined && mb[k] === undefined) continue;
    const va = ma[k] ?? 0;
    const vb = mb[k] ?? 0;
    out[k] = { start: va, end: vb, delta: vb - va };
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  stopServer();
  process.exit(1);
});
