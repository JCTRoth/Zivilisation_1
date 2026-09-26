import { test, expect } from '@playwright/test';

test('boot reliability probe', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 160)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now();
    await page.goto('/');
    let appeared = true;
    try {
      await expect(page.getByRole('button', { name: /Next →/ })).toBeVisible({ timeout: 30_000 });
    } catch {
      appeared = false;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`ATTEMPT ${attempt}: Next button ${appeared ? 'visible' : 'MISSING'} after ${secs}s`);
    if (!appeared) {
      const html = await page.content();
      console.log(`  body length: ${html.length}`);
      console.log(`  has #root children: ${await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? -1))}`);
      console.log(`  title: ${await page.title()}`);
      console.log(`  h2 texts: ${JSON.stringify(await page.locator('h2').allTextContents())}`);
      console.log(`  buttons: ${JSON.stringify((await page.locator('button').allTextContents()).slice(0, 12))}`);
      console.log(`  console errors so far: ${JSON.stringify(errors.slice(-6), null, 1)}`);
    }
    errors.length = 0;
  }
});
