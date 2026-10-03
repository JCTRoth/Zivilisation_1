/**
 * Map-load performance probe (CDP).
 *
 * The Chrome DevTools MCP is not always attached to the agent session, but the
 * performance data we need comes from the same place: the DevTools Protocol.
 * This drives a headless Chromium over CDP, picks a map type in the setup
 * dialog, starts the game and reports:
 *
 *   - how long the map canvas took to appear,
 *   - every long task from the first frame of the page (not just a window after
 *     the canvas appeared — the worst stall of all used to happen before that
 *     point and a post-canvas window hid it),
 *   - which functions were on the stack during each of the longest stalls,
 *   - a CPU profile of the hottest frames.
 *
 * Usage:
 *   npm run dev                                  # in another shell
 *   node scripts/profile-map-load.mjs [mapType] [runs]
 *
 * Env:
 *   WINDOW_MS=8000     how long to let the game run after the canvas appears
 *   SAMPLE_US=500      CPU profiler sampling interval
 *   BASE_URL=http://localhost:3000/              point at a different dev server
 *   TRACE=0            skip the (very large) timeline trace; CPU profile only
 *   LABELS=a,b,c       extra labels to click before starting, e.g. to pick a slot
 */
// `@playwright/test` re-exports the browser types and is the package this repo
// actually depends on — importing bare `playwright` only worked because it
// happens to be installed as its dependency, which knip rightly flags.
import { chromium } from '@playwright/test';

const MAP_TYPE = process.argv[2] ?? 'AI_VS_AI_NAVAL_TROPICAL';
const RUNS = Number(process.argv[3] ?? 1);
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000/';
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 8000);
const SAMPLE_US = Number(process.env.SAMPLE_US ?? 500);
const WANT_TRACE = process.env.TRACE !== '0';

async function measure({ labels = [] } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const cdp = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });

  // Long tasks from the very first frame, injected before any app code runs.
  await page.addInitScript(() => {
    window.__longTasks = [];
    window.__firstFrameAt = null;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longTasks.push({ start: e.startTime, dur: e.duration });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* longtask unsupported: the CPU profile still reports stalls */
    }
    requestAnimationFrame(() => {
      window.__firstFrameAt ??= performance.now();
    });

    // Count the canvas work the terrain transition pass is made of. Every edge
    // or corner transition builds a gradient and clips, so these counters tell
    // us how many whole-map passes ran — without touching game code.
    const stats = { clip: 0, lin: 0, rad: 0, drawImage: 0, fillRect: 0 };
    window.__canvasStats = stats;
    const proto = CanvasRenderingContext2D.prototype;
    const wrap = (name, key) => {
      const orig = proto[name];
      proto[name] = function (...args) {
        stats[key]++;
        return orig.apply(this, args);
      };
    };
    wrap('clip', 'clip');
    wrap('createLinearGradient', 'lin');
    wrap('createRadialGradient', 'rad');
    wrap('drawImage', 'drawImage');
    wrap('fillRect', 'fillRect');
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('h2.modal-title');
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.getByText('Fine-tune Your Challenge').waitFor({ state: 'visible' });
  await page.locator('select.setup-setting__control').last().selectOption(MAP_TYPE);
  for (const text of labels) {
    await page.getByText(text, { exact: false }).first().click();
  }

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
  await cdp.send('Profiler.start');

  const t0 = Date.now();
  await page.getByRole('button', { name: /Start Game/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.game-canvas canvas').length >= 2,
    null,
    { timeout: 180000 },
  );
  const canvasMs = Date.now() - t0;

  // Let the game actually play: a lag that only appears once the fog is
  // revealing and the AI is moving is the interesting one.
  await page.waitForTimeout(WINDOW_MS);

  const session = await page.evaluate(() => ({
    firstFrameAt: window.__firstFrameAt,
    longTasks: window.__longTasks ?? [],
    canvasStats: window.__canvasStats ?? null,
    rebuilds: window.__rebuilds ?? null,
    diff: window.__diff ?? null,
    reasons: window.__reasons ?? null,
    now: performance.now(),
  }));
  const { profile } = await cdp.send('Profiler.stop');

  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parentOf = new Map();
  for (const n of profile.nodes) {
    for (const c of n.children ?? []) parentOf.set(c, n.id);
  }
  const label = (n) => {
    const f = n?.callFrame ?? {};
    const url = (f.url || '').split('?')[0].split('/').pop() || '(native)';
    return `${f.functionName || '(anon)'} @ ${url}:${(f.lineNumber ?? 0) + 1}`;
  };

  // Map each CPU sample onto the page clock so we can ask "what was running
  // during this stall?". Profile timestamps are monotonic microseconds; anchor
  // them on the profile's own end time and the clock reading taken at the same
  // moment.
  const offsetUs = (profile.endTime ?? 0) - session.now * 1000;
  const sampleTimeMs = [];
  {
    let t = (profile.startTime ?? 0) / 1000 - offsetUs / 1000;
    for (let i = 0; i < profile.samples.length; i++) {
      t += (profile.timeDeltas?.[i] ?? 0) / 1000;
      sampleTimeMs.push(t);
    }
  }

  const stalls = session.longTasks
    .map((task) => {
      const counts = new Map();
      for (let i = 0; i < sampleTimeMs.length; i++) {
        const t = sampleTimeMs[i];
        if (t < task.start || t > task.start + task.dur) continue;
        const k = label(nodes.get(profile.samples[i]));
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const top3 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { start: Math.round(task.start), dur: Math.round(task.dur), top3 };
    })
    .filter((t) => t.top3.length > 0)
    .sort((a, b) => b.dur - a.dur);

  // Self time overall.
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const k = label(nodes.get(profile.samples[i]));
    self.set(k, (self.get(k) ?? 0) + 1);
  }
  const selfTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Self time per line for the three hottest frames — several are anonymous, so
  // the function name alone does not say which loop is burning the time.
  const hits = new Map();
  for (const id of profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1);
  const hotFrames = [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, n]) => {
      const node = nodes.get(id);
      const lines = (node?.positionTicks ?? [])
        .filter((t) => t.ticks > 0)
        .sort((a, b) => b.ticks - a.ticks)
        .slice(0, 5)
        .map((t) => `line ${t.line} (${t.ticks} ticks)`);
      return { frame: label(node), hits: n, lines };
    });

  let worstBreakdown = [];
  if (WANT_TRACE) {
    const finished = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: ['devtools.timeline', 'toplevel'],
      },
    });
    await page.waitForTimeout(Math.min(3000, WINDOW_MS));
    await cdp.send('Tracing.end');
    const { stream } = await finished;
    const parts = [];
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream, size: 20_000_000 });
      parts.push(chunk.data);
      if (chunk.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    const events = JSON.parse(parts.join('')).traceEvents;
    const longs = events
      .filter((e) => e.ph === 'X' && e.dur >= 50000)
      .sort((a, b) => b.dur - a.dur);
    const worst = longs[0];
    if (worst) {
      const names = new Map(events.filter((e) => e.name).map((e) => [e.name, e.name]));
      const nested = events
        .filter(
          (e) =>
            e.ph === 'X' &&
            e.dur &&
            e.ts >= worst.ts &&
            e.ts + e.dur <= worst.ts + worst.dur &&
            names.has(e.name),
        )
        .sort((a, b) => b.dur - a.dur)
        .slice(0, 10)
        .map((e) => [e.name, Math.round(e.dur / 1000), e.args?.data?.functionName ?? '']);
      worstBreakdown = nested;
    }
  }

  await browser.close();

  const durations = session.longTasks.map((t) => Math.round(t.dur)).sort((a, b) => b - a);
  return {
    canvasMs,
    rebuilds: session.rebuilds,
    diff: session.diff,
    reasons: session.reasons,
    canvasStats: session.canvasStats,
    firstFrameAt: session.firstFrameAt,
    longTasks: session.longTasks,
    durations,
    blockingTotal: durations.reduce((a, b) => a + b, 0),
    stalls,
    selfTop,
    hotFrames,
    worstBreakdown,
    errors,
  };
}

function report(r) {
  const d = r.durations;
  const p50 = d.length ? d[Math.floor(d.length * 0.5)] : 0;
  console.log(`  canvas appeared      : ${r.canvasMs} ms`);
  console.log(
    `  long tasks (whole run): ${d.length} | >=50ms ${d.filter((x) => x >= 50).length}` +
      ` | >=500ms ${d.filter((x) => x >= 500).length} | >=1s ${d.filter((x) => x >= 1000).length}`,
  );
  console.log(`  blocking total       : ${r.blockingTotal} ms | worst ${d[0] ?? 0} ms | p50 ${p50} ms`);
  console.log(`  worst five           : ${d.slice(0, 5).join(' / ')} ms`);
  if (r.diff?.length) {
    console.log('  what changed per rebuild:');
    for (const d of r.diff) console.log(`    ${d}`);
  }
  if (r.rebuilds) {
    console.log(`  whole-map rebuilds   : ${r.rebuilds.length} at ${r.rebuilds.join(', ')} ms`);
    console.log(`  rebuild triggers     : ${JSON.stringify(r.reasons)}`);
  }
  if (r.canvasStats) {
    // The tropical map needs 8292 gradient composites per whole-map pass, so
    // dividing tells us how many times the base layer was rebuilt.
    const passes = r.canvasStats.rad / 5526;
    console.log(
      `  canvas ops           : clip ${r.canvasStats.clip} | linGrad ${r.canvasStats.lin}` +
        ` | radGrad ${r.canvasStats.rad} | drawImage ${r.canvasStats.drawImage} | fillRect ${r.canvasStats.fillRect}`,
    );
    if (Number.isFinite(passes)) {
      console.log(`  whole-map passes     : ~${passes.toFixed(1)} (radGrad / 5526 corner transitions per pass)`);
    }
  }
  if (r.stalls.length) {
    console.log('  longest stalls, by function:');
    for (const s of r.stalls.slice(0, 5)) {
      console.log(`    ${String(s.dur).padStart(5)}ms @${s.start}ms  ${s.top3.map(([k, v]) => `${k} (${v})`).join('  <-  ')}`);
    }
  }
  if (r.hotFrames.length) {
    console.log('  hottest frames, by line:');
    for (const h of r.hotFrames) {
      console.log(`    ${String(h.hits).padStart(6)} samples  ${h.frame}`);
      for (const l of h.lines) console.log(`         ${l}`);
    }
  }
  if (r.worstBreakdown.length) {
    console.log('  worst long task, trace breakdown:');
    for (const [name, ms, fn] of r.worstBreakdown) {
      console.log(`    ${String(ms).padStart(5)}ms ${name} ${fn}`);
    }
  }
  if (r.errors.length) console.log(`  console errors       : ${r.errors.slice(0, 3).join(' | ')}`);
}

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n=== run ${i}/${RUNS} · ${MAP_TYPE} · ${BASE_URL} ===`);
  try {
    report(await measure());
  } catch (err) {
    console.log(`  FAILED: ${String(err).slice(0, 300)}`);
  }
}