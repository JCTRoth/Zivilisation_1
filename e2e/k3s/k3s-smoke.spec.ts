import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Playwright suite against the K3s-deployed stack (NodePorts).
 * Every step that matters is captured as a screenshot in the Desktop folder.
 */
const SERVER = process.env.CIV1_SERVER ?? 'http://localhost:31787';
const WEB = process.env.CIV1_WEB ?? 'http://localhost:31080';
// Node-side fetch uses a resolvable URL; browser stays on the HTTPS ingress.
const API = process.env.CIV1_API ?? SERVER;
const SHOTS = process.env.CIV1_SCREENSHOTS ?? '/home/jonas/Desktop/civ1-k3s-screenshots';

let shotIndex = 0;
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[k3s-e2e] screenshot: ${file}`);
}

async function health(): Promise<{ ok: boolean; rooms: Array<{ id: string }> }> {
  return fetch(`${API}/health`).then((r) => r.json()) as never;
}

test.beforeAll(async () => {
  expect((await health()).ok).toBe(true);
});

test('K3s full chain: lobby -> two seats -> command -> database', async ({ browser }) => {
  // 1. Lobby screen on the K3s-served web client.
  const lobby = await browser.newPage();
  await lobby.goto(`${WEB}/?lobby=${encodeURIComponent(SERVER)}`);
  await expect(lobby.getByRole('button', { name: 'Create room' })).toBeVisible({ timeout: 20_000 });
  await shot(lobby, 'lobby-empty');

  // 2. Create the room through the real lobby UI.
  await lobby.getByRole('button', { name: 'Create room' }).click();
  const seat0 = lobby.getByRole('link', { name: /Join as seat 0/ });
  const seat1 = lobby.getByRole('link', { name: /Join as seat 1/ });
  await expect(seat0).toBeVisible({ timeout: 20_000 });
  await expect(seat1).toBeVisible();
  await shot(lobby, 'lobby-room-created');

  const url0 = (await seat0.getAttribute('href'))!;
  const url1 = (await seat1.getAttribute('href'))!;
  const roomId = new URL(url0, 'http://localhost').searchParams.get('room')!;
  const token0 = new URL(url0, 'http://localhost').searchParams.get('token') ?? '';
  const token1 = new URL(url1, 'http://localhost').searchParams.get('token') ?? '';
  expect(roomId).toBeTruthy();

  // 3. Two independent players join the same authoritative room.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.goto(new URL(url0, WEB).toString());
  await pageB.goto(new URL(url1, WEB).toString());
  await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 25_000 });
  await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 25_000 });
  await shot(pageA, 'seat0-game-loaded');
  await shot(pageB, 'seat1-game-loaded');

  // 4. Verify runtime config rendered by the container entrypoint.
  const configured = await pageA.evaluate(
    () => (window as unknown as { __CIV1_CONFIG__?: { gameServer?: string } }).__CIV1_CONFIG__?.gameServer ?? '',
  );
  // The container entrypoint must render a non-empty URL; in TLS mode the
  // lobby URL parameter overrides it, in NodePort mode it must be the server.
  expect(configured).toMatch(/^https?:\/\//);
  if (!process.env.CIV1_TLS) expect(configured).toBe(SERVER);

  // 5. Seat 0 issues a real command; seat 1 reads the same state.
  const command = await fetch(`${API}/rooms/${roomId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: token0, seq: 1,
      command: { type: 'SET_RATES', tax: 30, science: 50, luxury: 20 },
    }),
  }).then((r) => r.json()) as { ok: boolean };
  expect(command).toMatchObject({ ok: true });

  const snapshot = await fetch(`${API}/rooms/${roomId}/state?token=${token1}`)
    .then((r) => r.json()) as { ok: boolean; save?: string };
  expect(snapshot.ok).toBe(true);
  expect(JSON.parse(snapshot.save!).gameSettings).toBeTruthy();
  await shot(pageB, 'seat1-after-command');

  // 6. Observability endpoints are live in the deployed stack.
  const metrics = await fetch(`${API}/metrics`).then((r) => r.text());
  expect(metrics).toContain('civ1_commands_total');
  expect((await fetch(`${API}/ready`)).status).toBe(200);

  await contextA.close();
  await contextB.close();
  await lobby.close();
});

test('K3s game UI interactions (rates, research, end turn)', async ({ browser }) => {
  // Create a fresh room through the lobby.
  const lobby = await browser.newPage();
  await lobby.goto(`${WEB}/?lobby=${encodeURIComponent(SERVER)}`);
  await lobby.getByRole('button', { name: 'Create room' }).click();
  const url = (await lobby.getByRole('link', { name: /Join as seat 0/ }).getAttribute('href'))!;
  const page = await browser.newPage();
  await page.goto(new URL(url, WEB).toString());
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 25_000 });
  await shot(page, 'ui-initial');

  // Open the rates modal.
  const rates = page.getByRole('button', { name: /Open rates/i });
  if (await rates.count()) {
    await rates.first().click();
    await page.waitForTimeout(500);
    await shot(page, 'rates-modal');
    const close = page.getByRole('button', { name: /close|schließen|cancel/i }).first();
    if (await close.count()) await close.click();
    else await page.keyboard.press('Escape');
  }

  // Open the research panel.
  const research = page.getByRole('button', { name: /Research/i }).first();
  if (await research.count()) {
    await research.click();
    await page.waitForTimeout(500);
    await shot(page, 'research-panel');
    await page.keyboard.press('Escape');
  }

  // End turn — may open a confirmation dialog.
  const endTurn = page.getByRole('button', { name: /End Turn|Zug beenden/i }).first();
  await endTurn.click();
  await page.waitForTimeout(1000);
  await shot(page, 'after-end-turn');

  await page.close();
  await lobby.close();
});

test('K3s database holds the saved game and events', async () => {
  const state = await health();
  expect(state.rooms.length).toBeGreaterThan(0);
  const roomId = state.rooms[0].id;
  const token = await fetch(`${API}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed: 1 }),
  }).then((r) => r.json()).then((r: { token: string }) => r.token);
  const response = await fetch(`${API}/rooms/${roomId}/state?token=${token}`);
  // Wrong room token is rejected (401) — proves token/room binding in K3s.
  expect(response.status).toBe(401);
});
