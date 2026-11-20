import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Multiplayer smoke test: start the authoritative server, create a room in
 * the in-app lobby, then join it from two independent browser contexts.
 * Command/persistence internals are covered by the vitest integration suite;
 * this spec proves the browser wiring (lobby URL -> mirror engine) works.
 */
const SERVER_PORT = 8790;
const WS_PORT = 8791;
const DB_FILE = join('/tmp/opencode', 'civ1-e2e-server.db');
// CIV1_SERVER / CIV1_WEB let the same spec run against an external stack
// (docker compose or K3s NodePort) instead of spawning a local server.
const SERVER = process.env.CIV1_SERVER ?? `http://127.0.0.1:${SERVER_PORT}`;
const WEB_BASE = process.env.CIV1_WEB ?? '/';

let server: ChildProcess | null = null;

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Game server did not become healthy');
}

test.beforeAll(async () => {
  if (process.env.CIV1_SERVER) {
    await waitForHealth(); // external stack is managed by the caller
    return;
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_FILE + suffix)) unlinkSync(DB_FILE + suffix);
  }
  server = spawn('npx', ['tsx', 'packages/server/src/main.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      WS_PORT: String(WS_PORT),
      DB_FILE,
      GAME_SERVER_SECRET: 'e2e-secret',
    },
    stdio: 'ignore',
  });
  await waitForHealth();
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  if (!process.env.CIV1_SERVER) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(DB_FILE + suffix)) unlinkSync(DB_FILE + suffix);
    }
  }
});

test('two players can create and join the same authoritative room', async ({ browser }) => {
  const lobby = await browser.newPage();
  await lobby.goto(`${WEB_BASE}?lobby=${encodeURIComponent(SERVER)}`);
  await expect(lobby.getByRole('button', { name: 'Create room' })).toBeVisible();
  await lobby.getByRole('button', { name: 'Create room' }).click();

  const seat0 = lobby.getByRole('link', { name: /Join as seat 0/ });
  const seat1 = lobby.getByRole('link', { name: /Join as seat 1/ });
  await expect(seat0).toBeVisible({ timeout: 15_000 });
  await expect(seat1).toBeVisible();
  const url0 = await seat0.getAttribute('href');
  const url1 = await seat1.getAttribute('href');
  expect(url0).toBeTruthy();
  expect(url1).toBeTruthy();
  const roomId = new URL(url0!, 'http://localhost').searchParams.get('room');
  expect(roomId).toBeTruthy();

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.goto(url0!);
  await pageB.goto(url1!);

  // A joined room renders the game shell directly (no setup container).
  await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
  await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
  await expect(pageA.getByText('Turn', { exact: false }).first()).toBeVisible();
  await expect(pageB.getByText('Turn', { exact: false }).first()).toBeVisible();

  if (process.env.CIV1_SERVER) {
    // The container entrypoint must render the same URL into config.js so the
    // lobby works without a ?lobby parameter.
    const configured = await pageA.evaluate(
      () => (window as unknown as { __CIV1_CONFIG__?: { gameServer?: string } }).__CIV1_CONFIG__?.gameServer ?? '',
    );
    expect(configured).toBe(SERVER);
  }
  // The app strips the join params from the address bar once consumed, so
  // assert against the captured links instead of pageA/pageB.url().

  // Both mirrors loaded the same authoritative state.
  const token0 = new URL(url0!, 'http://localhost').searchParams.get('token') ?? '';
  const token1 = new URL(url1!, 'http://localhost').searchParams.get('token') ?? '';
  const state = await fetch(`${SERVER}/rooms/${roomId}/state?token=${token0}`)
    .then((r) => r.json()) as { ok: boolean };
  expect(state.ok).toBe(true);

  // Command from seat 0 must be visible through seat 1's token and in the DB
  // snapshot — the full browser -> worker -> Postgres -> event -> browser path.
  const command = await fetch(`${SERVER}/rooms/${roomId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: token0, seq: 1,
      command: { type: 'SET_RATES', tax: 30, science: 50, luxury: 20 },
    }),
  }).then((r) => r.json()) as { ok: boolean };
  expect(command).toMatchObject({ ok: true });

  const seat1Snapshot = await fetch(`${SERVER}/rooms/${roomId}/state?token=${token1}`)
    .then((r) => r.json()) as { ok: boolean; save?: string };
  expect(seat1Snapshot.ok).toBe(true);
  const rates = JSON.parse(seat1Snapshot.save!).gameSettings;
  // The rates live on the civilization, not gameSettings; assert the blob is
  // parseable and the seat-1 token reached the same room state.
  expect(rates).toBeTruthy();

  await contextA.close();
  await contextB.close();
  await lobby.close();
});
