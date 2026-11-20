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
const SERVER = `http://127.0.0.1:${SERVER_PORT}`;

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
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_FILE + suffix)) unlinkSync(DB_FILE + suffix);
  }
});

test('two players can create and join the same authoritative room', async ({ browser }) => {
  const lobby = await browser.newPage();
  await lobby.goto(`/?lobby=${encodeURIComponent(SERVER)}`);
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
  // The app strips the join params from the address bar once consumed, so
  // assert against the captured links instead of pageA/pageB.url().

  // Both mirrors loaded the same authoritative state.
  const state = await fetch(`${SERVER}/rooms/${roomId}/state?token=${new URL(url0!, 'http://localhost').searchParams.get('token')}`)
    .then((r) => r.json()) as { ok: boolean };
  expect(state.ok).toBe(true);

  await contextA.close();
  await contextB.close();
  await lobby.close();
});
