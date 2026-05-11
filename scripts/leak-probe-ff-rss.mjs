// Firefox probe with process-level RSS sampling.
//
// Playwright FF has no CDP and no `performance.memory`, so we can't see
// the JS heap directly. Instead we read /proc/<pid>/status for every
// Firefox process spawned by the test (parent + content processes) and
// sum their RSS. This catches anything Firefox holds: JS heap, native,
// WebGL textures, audio buffers, the lot.
//
// Run:
//   PROBE_URL=http://localhost:5174/ node scripts/leak-probe-ff-rss.mjs
//   PROBE_URL=... PROBE_MODE=churn node scripts/leak-probe-ff-rss.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { firefox } from 'playwright';

const URL = process.env.PROBE_URL ?? 'http://localhost:5173/';
const RUN_SECS = Number(process.env.PROBE_SECS ?? 90);
const STEP_SECS = Number(process.env.PROBE_STEP ?? 3);
const MODE = process.env.PROBE_MODE ?? 'idle'; // 'idle' or 'churn'
const CHURN_CYCLES = Number(process.env.PROBE_CYCLES ?? 20);

// Walk /proc and find all firefox-related processes spawned by `rootPid`
// (the parent we launched). We discover the tree via ppid each cycle so
// content processes spawned later are picked up automatically.
function descendants(rootPid) {
  const out = new Set([rootPid]);
  let added = true;
  let pids = [];
  try {
    pids = readdirSync('/proc')
      .filter((d) => /^\d+$/.test(d))
      .map(Number);
  } catch {
    return out;
  }
  while (added) {
    added = false;
    for (const pid of pids) {
      if (out.has(pid)) continue;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        // Format: pid (comm) state ppid ...   (comm may contain spaces+parens)
        const close = stat.lastIndexOf(')');
        const after = stat.slice(close + 2).split(' ');
        const ppid = Number(after[1]);
        if (out.has(ppid)) {
          out.add(pid);
          added = true;
        }
      } catch {
        /* gone */
      }
    }
  }
  return out;
}

function rssKB(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function commName(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const open = stat.indexOf('(');
    const close = stat.lastIndexOf(')');
    return stat.slice(open + 1, close);
  } catch {
    return '?';
  }
}

function totalRSS(rootPid, ourPidsAtStart) {
  // Descendants() walks /proc by ppid. New child processes (e.g. content
  // processes spawned later for tabs) get included automatically, plus
  // we union with the initial pid set so we don't lose any that have
  // odd parentage.
  const pids = descendants(rootPid);
  for (const p of ourPidsAtStart ?? []) pids.add(p);
  let total = 0;
  const breakdown = [];
  for (const pid of pids) {
    const r = rssKB(pid);
    total += r;
    if (r > 0) breakdown.push({ pid, comm: commName(pid), rssKB: r });
  }
  return { total, breakdown, pidCount: pids.size };
}

async function bootMenu(page) {
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
  await sleep(500);
}

async function readPhaserCounts(page) {
  return await page.evaluate(() => {
    const g = window.__game;
    let totalObj = 0;
    let totalTw = 0;
    let totalTm = 0;
    const scenes = [];
    for (const s of g.scene.scenes) {
      let n = 0;
      const visit = (o) => {
        n += 1;
        if (o.list) for (const c of o.list) visit(c);
      };
      for (const c of s.children?.list ?? []) visit(c);
      const tw = s.tweens?._active?.length ?? 0;
      const tm = s.time?._active?.length ?? 0;
      totalObj += n;
      totalTw += tw;
      totalTm += tm;
      if (s.scene.isActive() || n > 0) {
        scenes.push({ k: s.scene.key, active: s.scene.isActive(), obj: n, tw, tm });
      }
    }
    const probe = (e) => e?._eventsCount ?? -1;
    return {
      totalObj,
      totalTw,
      totalTm,
      scenes,
      dom: document.getElementsByTagName('*').length,
      sounds: g.sound?.sounds?.length ?? 0,
      gameEv: probe(g.events),
      gameSnd: probe(g.sound),
    };
  });
}

function listFirefoxPids() {
  const out = new Set();
  let pids = [];
  try {
    pids = readdirSync('/proc')
      .filter((d) => /^\d+$/.test(d))
      .map(Number);
  } catch {
    return out;
  }
  for (const pid of pids) {
    try {
      const c = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (
        /^(firefox|MainThread|Web Content|Privileged Content|Isolated Web Co|RDD|Socket Process|Utility Process|GMP)/i.test(
          c,
        )
      )
        out.add(pid);
      // Also match by cmdline (FF child processes have varied comm).
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmd.includes('firefox') || cmd.includes('-greomni')) out.add(pid);
    } catch {
      /* gone */
    }
  }
  return out;
}

async function main() {
  const before = listFirefoxPids();
  const browser = await firefox.launch({ headless: true });
  // Wait a beat for child content processes to spawn.
  await sleep(1500);
  const after = listFirefoxPids();
  const ourPids = new Set([...after].filter((p) => !before.has(p)));
  if (ourPids.size === 0) throw new Error('no new firefox processes detected');
  // Pick the one with the lowest pid as the root for descendant traversal.
  const rootPid = Math.min(...ourPids);
  console.log(`[probe] firefox pids=${[...ourPids].sort((a, b) => a - b).join(',')} root=${rootPid}, mode=${MODE}`);

  const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[page:err] ${e.message}`));

  console.log(`[probe] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'load' });
  await bootMenu(page);
  console.log('[probe] menu active');

  // Let things settle so initial allocations are out of the way.
  await sleep(2000);

  const samples = [];

  async function sample(label) {
    const rss = totalRSS(rootPid, ourPids);
    const counts = await readPhaserCounts(page);
    const row = {
      label,
      ts: Date.now(),
      rssKB: rss.total,
      pidCount: rss.pidCount,
      dom: counts.dom,
      obj: counts.totalObj,
      tw: counts.totalTw,
      tm: counts.totalTm,
      sounds: counts.sounds,
      gameEv: counts.gameEv,
    };
    samples.push(row);
    console.log(
      `[${label.padEnd(10)}] rss=${(rss.total / 1024).toFixed(1)}MB pids=${rss.pidCount} dom=${counts.dom} obj=${counts.totalObj} tw=${counts.totalTw} tm=${counts.totalTm} snd=${counts.sounds} gameEv=${counts.gameEv}`,
    );
  }

  await sample('baseline');

  if (MODE === 'churn') {
    async function gotoScene(targetKey) {
      await page.evaluate((key) => {
        const g = window.__game;
        const active = g.scene.scenes.find((s) => s.scene.isActive());
        active.scene.start(key);
      }, targetKey);
      await page.waitForFunction(
        (key) => !!window.__game?.scene?.scenes?.some((s) => s.scene.key === key && s.scene.isActive()),
        targetKey,
        { timeout: 5_000 },
      );
      await sleep(400);
    }
    for (let c = 1; c <= CHURN_CYCLES; c++) {
      await gotoScene('Credits');
      await gotoScene('Menu');
      await gotoScene('TestMenu');
      await gotoScene('Menu');
      if (c % 2 === 0 || c === CHURN_CYCLES) await sample(`cycle ${c}`);
    }
  } else {
    const startMs = Date.now();
    while ((Date.now() - startMs) / 1000 < RUN_SECS) {
      await sleep(STEP_SECS * 1000);
      await sample(`t=${Math.round((Date.now() - startMs) / 1000)}s`);
    }
  }

  // Final breakdown of where the memory sits.
  const final = totalRSS(rootPid, ourPids);
  console.log('\n[probe] final per-process breakdown (sorted desc):');
  for (const p of final.breakdown.sort((a, b) => b.rssKB - a.rssKB).slice(0, 8)) {
    console.log(`  pid=${p.pid} ${p.comm.padEnd(20)} ${(p.rssKB / 1024).toFixed(1)} MB`);
  }

  // Trend.
  console.log('\n[probe] trend:');
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dRSS = (last.rssKB - first.rssKB) / 1024;
  const elapsedSec = (last.ts - first.ts) / 1000;
  console.log(
    `  RSS: ${(first.rssKB / 1024).toFixed(1)}MB → ${(last.rssKB / 1024).toFixed(1)}MB (Δ${dRSS.toFixed(1)}MB over ${elapsedSec.toFixed(0)}s)`,
  );
  if (samples.length > 2) {
    const ratesMBperMin = [];
    for (let i = 1; i < samples.length; i++) {
      const dr = (samples[i].rssKB - samples[i - 1].rssKB) / 1024;
      const dt = (samples[i].ts - samples[i - 1].ts) / 60_000;
      if (dt > 0) ratesMBperMin.push(dr / dt);
    }
    const avg = ratesMBperMin.reduce((a, b) => a + b, 0) / ratesMBperMin.length;
    console.log(`  avg rate: ${avg.toFixed(2)} MB/min`);
  }
  console.log(
    `  DOM: ${first.dom} → ${last.dom}, gameObj: ${first.obj} → ${last.obj}, tweens: ${first.tw} → ${last.tw}, timers: ${first.tm} → ${last.tm}`,
  );

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
