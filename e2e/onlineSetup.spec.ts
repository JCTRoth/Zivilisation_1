import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The pre-game flow, end to end:
 *
 *  - step two offers exactly two doors — *Start a new game* and *Join a
 *    running game* — and a new game carries the same settings offline and
 *    online (online only adds the invite links);
 *  - offline, the two online choices gray out;
 *  - with a server up, a running game can be picked from the list, its
 *    settings and players read off it, and joined — and a game started
 *    online hands out one invite per human seat.
 */

// The wizard talks to `defaultGameServer()` — no URL field in the UI — so the
// server has to be where the client looks by default.
const SERVER_PORT = 8787;
const WS_PORT = 8788;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const DB_FILE = join(tmpdir(), 'civ1-e2e-join.db');

test.setTimeout(180_000);

let server: ChildProcess | null = null;
let serverLog = '';

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`game server did not become healthy\n--- server log ---\n${serverLog}`);
}

async function createRoom(lobby: Record<string, unknown>): Promise<{ id: string; token: string | null }> {
  const created = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lobby),
  }).then((r) => r.json()) as { ok: boolean; id: string; token?: string | null };
  if (!created.ok) throw new Error(`ROOM_CREATE_FAILED: ${JSON.stringify(created)}`);
  return { id: created.id, token: created.token ?? null };
}

async function mintSeats(roomId: string, token: string | null, seats: number[]): Promise<void> {
  const minted = await fetch(`${BASE}/rooms/${encodeURIComponent(roomId)}/seats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, seats }),
  }).then((r) => r.json()) as { ok: boolean };
  if (!minted.ok) throw new Error(`SEAT_MINT_FAILED: ${JSON.stringify(minted)}`);
}

test.afterAll(async () => {
  if (server?.pid) {
    try {
      // Negative pid → the whole process group (npx spawns a grandchild).
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_FILE + suffix)) unlinkSync(DB_FILE + suffix);
  }
});

test.describe('setup step two — start or join', () => {
  test('offers both doors and keeps every setting under the new game', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible();
    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();

    // Two doors, new game selected first.
    const startCard = page.getByRole('button', { name: 'Start a new game' });
    const joinCard = page.getByRole('button', { name: 'Join a running game' });
    await expect(startCard).toHaveAttribute('aria-pressed', 'true');
    await expect(joinCard).toHaveAttribute('aria-pressed', 'false');

    // Starting a game — hot seat or online — keeps the whole settings sheet.
    // The choice lives in the Players table: seat 0 is you, as a hot seat.
    const seat0 = page.locator('.setup-lobby__type').nth(0);
    await expect(seat0).toHaveText('Human Hot Seat');
    await expect(page.locator('.setup-lobby__type').nth(1)).toHaveText('AI');
    await expect(page.getByText('Terms of Engagement')).toBeVisible();
    await expect(page.getByText('Players', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeVisible();

    // Without a server the online type is off and says which condition is
    // missing (this describe runs before the server is started).
    const serverUp = await fetch('http://localhost:8787/health', {
      signal: AbortSignal.timeout(1_500),
    }).then((r) => r.ok).catch(() => false);
    if (!serverUp) {
      // The players table carries several hints; this one is appended last.
      await expect(page.locator('.setup-lobby .setup-setting__hint').last())
        .toContainText('The game server is not reachable.');
      await expect(joinCard).toBeDisabled();
      await expect(joinCard).toContainText('not reachable');
      // The local door is the one left standing.
      await expect(startCard).toHaveAttribute('aria-pressed', 'true');
    }
  });
});

test.describe('with a running game server', () => {
  test.beforeAll(async () => {
    // An external stack (CIV1_SERVER) is not on the client's default port, so
    // the list would be empty there — run these against our own server only.
    if (process.env.CIV1_SERVER) return;
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
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group so the grandchild dies with it.
      detached: true,
    });
    server.stdout?.on('data', (chunk) => { serverLog += String(chunk); });
    server.stderr?.on('data', (chunk) => { serverLog += String(chunk); });
    await waitForHealth();
  });

  test.afterAll(async () => {
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      server = null;
    }
  });

  test('an online seat needs the server and a connection', async ({ page, context }) => {
    test.skip(!!process.env.CIV1_SERVER, 'needs the local game server');
    await page.goto('/');
    await page.getByRole('button', { name: 'Next →' }).click();

    const seat0 = page.locator('.setup-lobby__type').nth(0);
    await expect(seat0).toHaveText('Human Hot Seat');

    // Offline: the cycle skips the state it cannot reach, and says why.
    await context.setOffline(true);
    await seat0.click();
    await expect(seat0).toHaveText('AI');
    await expect(page.locator('.setup-lobby .setup-setting__hint').last())
      .toContainText("You're offline — online play needs a connection.");
    // …while the local table is untouched by it.
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeEnabled();

    // Back on the wire: human seats come back and Online is reachable.
    await context.setOffline(false);
    await seat0.click();
    await expect(seat0).toHaveText('Human Hot Seat');
    await seat0.click();
    await expect(seat0).toHaveText('Human Online');
  });

  test('reads a running game off the list and joins it', async ({ page }) => {
    test.skip(!!process.env.CIV1_SERVER, 'needs the local game server');
    // Seat 0 is invited (the host), seat 1 is still free to claim.
    const { id: roomId, token } = await createRoom({
      mapType: 'CLOSEUP_1V1',
      numberOfCivilizations: 2,
      difficulty: 'WARLORD',
      humanSeats: [0, 1],
    });
    await mintSeats(roomId, token, [0]);

    await page.goto('/');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByRole('button', { name: 'Join a running game' }).click();

    // Joining stays in the same step: the list takes the place of the local
    // settings, and the doors are still there to go back.
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();
    await expect(page.getByText('Running games')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByText('Terms of Engagement')).toBeHidden();
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeHidden();

    const row = page.getByRole('button', { name: new RegExp(roomId) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // The settings the game was started with…
    // The join card now uses the same summary block as the start screen.
    const summary = page.locator('.setup-summary');
    await expect(page.getByText("This game's settings")).toBeVisible();
    await expect(summary).toContainText('Close-Up 1v1');
    await expect(summary).toContainText('Warlord');
    // …and underneath, every seat with its state.
    await expect(page.getByText('waiting to join')).toBeVisible();
    await expect(page.getByText('free seat')).toBeVisible();

    await page.getByRole('button', { name: 'Join this game' }).click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
  });

  test('starts online with the same settings and hands out the invites', async ({ page }) => {
    test.skip(!!process.env.CIV1_SERVER, 'needs the local game server');
    await page.goto('/');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Seat 0 plays over the network, seat 1 is a human on this device — so
    // there is somebody to invite.
    const seat0 = page.locator('.setup-lobby__type').nth(0);
    const seat1 = page.locator('.setup-lobby__type').nth(1);
    await expect(seat0).toHaveText('Human Hot Seat');
    await seat0.click();
    await expect(seat0).toHaveText('Human Online');
    await seat1.click();
    await expect(seat1).toHaveText('Human Hot Seat');
    await page.getByRole('button', { name: '🏛️ Start Game' }).click();

    // The room is created from the settings on screen; the links are the next
    // step and the command bar offers the door into the seat.
    await expect(page.getByText('The Table Is Open')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Join as seat 0/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Join as seat 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter the game' })).toBeVisible();

    await page.getByRole('button', { name: 'Enter the game' }).click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
  });
});
