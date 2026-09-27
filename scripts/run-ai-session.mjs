// Standalone AI-vs-AI session driver (not part of the e2e suite).
// Starts a Computer vs Computer game and lets it run for a fixed duration,
// then reports the generated log file path and a quick summary.
//
// Usage: node scripts/run-ai-session.mjs [durationSeconds] [--headful]
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const DURATION_S = Number(process.argv[2] || 90);
const HEADFUL = process.argv.includes('--headful');
const LOG_DIR = join(process.cwd(), 'game-logs');

function latestLogFile() {
  if (!existsSync(LOG_DIR)) return null;
  return readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.log'))
    .map((f) => join(LOG_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

async function main() {
  const browser = await chromium.launch({
    headless: !HEADFUL,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  console.log(`[session] Opening ${BASE} ...`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  // Step 1 – Civilization selection
  await page.locator('h2.modal-title').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Next →' }).click();

  // Step 2 – Game settings: pick AI_VS_AI (last map type option)
  await page.getByText('Fine-tune Your Challenge').waitFor({ state: 'visible' });
  await page.locator('select.setup-setting__control').last().selectOption('AI_VS_AI');
  await page.getByRole('button', { name: '🏛️ Start Game' }).click();

  // Wait for the game canvas to mount
  await page.locator('.game-canvas canvas').first().waitFor({ state: 'visible', timeout: 30000 });
  console.log(`[session] Game started. Letting AI play for ${DURATION_S}s ...`);

  // Capture console errors to detect crashes
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const start = Date.now();
  let lastTurn = -1;
  while (Date.now() - start < DURATION_S * 1000) {
    // Poll the current turn shown in the top bar
    const txt = await page.locator('.game-top-bar').textContent().catch(() => '');
    const m = txt?.match(/Turn\s+(\d+)/i);
    if (m) {
      const t = parseInt(m[1], 10);
      if (t !== lastTurn) {
        console.log(`[session] turn ${t} ...`);
        lastTurn = t;
      }
    }
    await page.waitForTimeout(2500);
  }

  // Give the log buffer a moment to flush
  await page.waitForTimeout(1500);

  const logFile = latestLogFile();
  console.log('\n=== SESSION SUMMARY ===');
  console.log('Log file:', logFile);
  if (logFile) {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    console.log('Log lines:', lines.length);
    const rounds = lines.filter((l) => l.includes('ROUND ')).length;
    const moves = lines.filter((l) => l.includes('"event":"UNIT_MOVED"')).length;
    const combat = lines.filter((l) => l.includes('COMBAT_VICTORY') || l.includes('COMBAT_DEFEAT')).length;
    const cities = lines.filter((l) => l.includes('CITY_FOUNDED')).length;
    console.log('Rounds:', rounds, '| Moves:', moves, '| Combat:', combat, '| Cities founded:', cities);
  }
  if (errors.length) {
    console.log('\nBrowser errors:');
    errors.slice(0, 20).forEach((e) => console.log('  -', e.slice(0, 200)));
  } else {
    console.log('\nNo browser errors recorded.');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('[session] FAILED:', err);
  process.exit(1);
});
