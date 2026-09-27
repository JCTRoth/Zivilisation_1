// AI-vs-AI analysis session: play for DURATION_S, then export the compact
// progression CSV and the map JSON via the in-app menu (captured downloads).
//
// Usage: node scripts/run-ai-analysis-session.mjs [durationSeconds] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const DURATION_S = Number(process.argv[2] || 300);
const OUT_DIR = process.argv[3] || '/tmp/ai-analysis';
mkdirSync(OUT_DIR, { recursive: true });

function latestLogFile() {
  const LOG_DIR = join(process.cwd(), 'game-logs');
  return readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('aivsai-') && f.endsWith('.log'))
    .map((f) => join(LOG_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log(`[analysis] Opening ${BASE} ...`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  await page.locator('h2.modal-title').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Next →' }).click();

  await page.getByText('Fine-tune Your Challenge').waitFor({ state: 'visible' });
  await page.locator('select.setup-setting__control').last().selectOption('AI_VS_AI');
  await page.getByRole('button', { name: '🏛️ Start Game' }).click();

  await page.locator('.game-canvas canvas').first().waitFor({ state: 'visible', timeout: 30000 });
  const logFile = latestLogFile();
  console.log(`[analysis] Game started (${logFile}). Playing ${DURATION_S}s ...`);

  const start = Date.now();
  let lastTurn = -1;
  while (Date.now() - start < DURATION_S * 1000) {
    const txt = await page.locator('.game-top-bar').textContent().catch(() => '');
    const m = txt?.match(/Turn\s+(\d+)/i);
    if (m) {
      const t = parseInt(m[1], 10);
      if (t !== lastTurn) {
        console.log(`[analysis] turn ${t} ...`);
        lastTurn = t;
      }
    }
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1500);

  // Export CSV + map directly via the dev window hooks — robust even when
  // the game has ended and the top bar menu is gone.
  console.log('[analysis] Exporting CSV + map ...');
  const csv = await page.evaluate(async () => {
    const engine = window.__gameEngine;
    if (!engine || !window.__gameProgression) return null;
    return window.__gameProgression.buildCompactCsv(engine);
  });
  if (!csv) throw new Error('CSV export failed: engine/progression hook unavailable');
  const { writeFileSync } = await import('node:fs');
  const csvPath = join(OUT_DIR, 'progression-compact.csv');
  writeFileSync(csvPath, csv);
  console.log('[analysis] CSV saved:', csvPath, `(${(csv.length / 1024).toFixed(0)} KB)`);

  const mapJson = await page.evaluate(() => {
    const engine = window.__gameEngine;
    const map = window.__gameStore?.getState?.().map;
    if (!map) return null;
    return JSON.stringify({
      meta: { width: map.width, height: map.height, turn: engine?.currentTurn ?? 0 },
      map: map,
    });
  });
  if (mapJson) {
    const mapPath = join(OUT_DIR, 'map.json');
    writeFileSync(mapPath, mapJson);
    console.log('[analysis] Map saved:', mapPath, `(${(mapJson.length / 1024).toFixed(0)} KB)`);
  } else {
    console.log('[analysis] Map export skipped (store hook unavailable)');
  }

  const finalLog = latestLogFile();
  const { readFileSync } = await import('node:fs');
  if (finalLog) {
    const lines = readFileSync(finalLog, 'utf8').split('\n').filter(Boolean);
    console.log('\n=== ANALYSIS SESSION SUMMARY ===');
    console.log('Log file:', finalLog);
    console.log('Log lines:', lines.length);
    console.log('Rounds:', lines.filter((l) => l.includes('ROUND ')).length);
    console.log('Moves:', lines.filter((l) => l.includes('"event":"UNIT_MOVED"')).length);
    console.log('Combat:', lines.filter((l) => l.includes('COMBAT_VICTORY') || l.includes('COMBAT_DEFEAT')).length);
    console.log('Cities founded:', lines.filter((l) => l.includes('CITY_FOUNDED')).length);
  }
  console.log('Files in ' + OUT_DIR + ':', readdirSync(OUT_DIR).join(', '));

  await browser.close();
}

main().catch((err) => {
  console.error('[analysis] FAILED:', err.message);
  process.exit(1);
});
