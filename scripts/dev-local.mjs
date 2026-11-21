#!/usr/bin/env node
/**
 * One-command local development: Postgres in Docker, app on the host.
 *
 *   npm run dev:local
 *
 * Starts the `postgres` service from docker-compose.yml, waits until it is
 * accepting connections, then runs the authoritative server (`npm run
 * dev:server`) and the Vite client (`npm run dev`) on the host. The browser
 * gets hot reload, the server runs under the normal Node debugger, and only
 * the database is containerised.
 *
 * Credentials come from the repository's `.env` (created from `.env.example`
 * on first run) so that Compose and the host server always agree. The URL
 * passed to the host server points at localhost:5433, the port Compose
 * publishes — not at the `postgres:5432` hostname used inside the Compose
 * network.
 *
 * Options:
 *   --dry-run        print the plan without touching Docker or starting processes
 *   --stop-postgres  also `docker compose stop postgres` on exit (default: leave it running)
 *   --help           show this help
 *
 * Environment overrides:
 *   DEV_PG_URL       full Postgres URL for the host server (default: derived from .env)
 *   PORT, WS_PORT    server ports (defaults 8787 / 8788)
 *   DEV_WEB_PORT     Vite port (default 3000)
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const stopPostgresOnExit = args.includes('--stop-postgres');

const USAGE = `
Usage: npm run dev:local [-- --dry-run | --stop-postgres | --help]

Starts Postgres in Docker and runs the server + Vite client on the host.
Credentials come from .env (copied from .env.example on first run).

  --dry-run        print the plan without touching Docker or starting processes
  --stop-postgres  also stop the Postgres container on exit (default: leave it running)
  --help           show this help

Environment overrides: DEV_PG_URL, PORT, WS_PORT, DEV_WEB_PORT.
`.trim();

if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

/** Minimal KEY=VALUE reader — intentionally not a full dotenv implementation. */
function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

let createdEnv = false;
if (!existsSync(envPath) && !dryRun) {
  copyFileSync(examplePath, envPath);
  createdEnv = true;
}
const fileEnv = parseEnv(existsSync(envPath)
  ? readFileSync(envPath, 'utf8')
  : readFileSync(examplePath, 'utf8'));

const cfg = {
  db: fileEnv.POSTGRES_DB || 'civ1',
  user: fileEnv.POSTGRES_USER || 'civ1',
  password: fileEnv.POSTGRES_PASSWORD || 'change-me-in-env',
  secret: process.env.GAME_SERVER_SECRET || fileEnv.GAME_SERVER_SECRET || 'change-me-in-env',
  serverPort: process.env.PORT || '8787',
  wsPort: process.env.WS_PORT || '8788',
  webPort: process.env.DEV_WEB_PORT || '3000',
  pgPort: '5433', // fixed by docker-compose.yml's 5433:5432 mapping
};
cfg.pgUrl = process.env.DEV_PG_URL
  || `postgres://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password)}`
     + `@localhost:${cfg.pgPort}/${encodeURIComponent(cfg.db)}`;

const mask = (value) => value ? '*'.repeat(Math.min(value.length, 12)) : '(empty)';

function log(message) {
  console.log(`[dev:local] ${message}`);
}

function fail(message) {
  console.error(`[dev:local] ERROR: ${message}`);
  process.exit(1);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} exited with code ${result.status}`);
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function checkHostPorts() {
  const ports = [
    ['web', cfg.webPort, 'DEV_WEB_PORT'],
    ['server', cfg.serverPort, 'PORT'],
    ['WebSocket', cfg.wsPort, 'WS_PORT'],
  ];
  for (const [name, port, override] of ports) {
    if (await portInUse(port)) {
      fail(`${name} port ${port} is already in use. Stop the other process `
        + `(a full Compose stack also binds 3000) or set ${override} before the command.`);
    }
  }
}

async function waitForPostgres(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = '';
  while (Date.now() < deadline) {
    const probe = spawnSync('docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready',
        '-U', cfg.user, '-d', cfg.db],
      { cwd: root, encoding: 'utf8' });
    if (probe.status === 0) return;
    lastOutput = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
    await delay(500);
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs / 1000}s`
    + (lastOutput ? ` (last probe: ${lastOutput})` : ''));
}

async function waitForServer(timeoutMs = 30_000) {
  const url = `http://127.0.0.1:${cfg.serverPort}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // Not listening yet — keep polling.
    }
    await delay(300);
  }
  return false;
}

if (dryRun) {
  log('dry run — no processes will be started');
  log(`1. docker compose up -d postgres  (credentials from ${existsSync(envPath) ? '.env' : '.env.example'})`);
  log('2. wait for pg_isready on localhost:5433');
  log(`3. npm run dev:server  with PG_URL=postgres://${cfg.user}:${mask(cfg.password)}@localhost:${cfg.pgPort}/${cfg.db}`);
  log(`4. npm run dev -- --port ${cfg.webPort}`);
  log(`URLs: web http://localhost:${cfg.webPort} · server http://localhost:${cfg.serverPort} · ws :${cfg.wsPort} · postgres localhost:${cfg.pgPort}`);
  process.exit(0);
}

if (createdEnv) {
  log(`created .env from .env.example — edit it to change local credentials`);
}

const binExtension = process.platform === 'win32' ? '.cmd' : '';
for (const bin of ['tsx', 'vite']) {
  if (!existsSync(join(root, 'node_modules', '.bin', bin + binExtension))) {
    fail(`'${bin}' is not installed — run \`npm install\` in the repository root first.`);
  }
}

const dockerProbe = spawnSync('docker', ['compose', 'version'], { cwd: root, encoding: 'utf8' });
if (dockerProbe.error || dockerProbe.status !== 0) {
  fail('Docker Compose v2 is required (docker compose version failed). '
    + 'Install Docker or use `npm run dev` / `npm run dev:server` without Postgres.');
}

await checkHostPorts();

try {
  log('starting Postgres container...');
  run('docker', ['compose', 'up', '-d', 'postgres']);
  log('waiting for Postgres to accept connections...');
  await waitForPostgres();
  log('Postgres is ready.');
} catch (error) {
  fail(`could not start Postgres: ${error.message}. `
    + 'Check that the Docker daemon is running and that host port 5433 is free.');
}

let shuttingDown = false;
const children = [];

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down...');
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
  if (stopPostgresOnExit) {
    log('stopping Postgres container (--stop-postgres)...');
    try { run('docker', ['compose', 'stop', 'postgres']); } catch { /* best effort */ }
  }
  await Promise.race([
    Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve)))),
    delay(5000),
  ]);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function start(name, commandArgs, extraEnv) {
  const child = spawn(npmCmd, commandArgs, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[dev:local] failed to start ${name}: ${error.message}`);
    void shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`${name} exited (${signal ?? code}); stopping the other processes`);
    void shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

start('server', ['run', 'dev:server'], {
  PG_URL: cfg.pgUrl,
  GAME_SERVER_SECRET: cfg.secret,
  PORT: cfg.serverPort,
  WS_PORT: cfg.wsPort,
});

const webArgs = ['run', 'dev'];
if (cfg.webPort !== '3000') webArgs.push('--', '--port', cfg.webPort);
start('web', webArgs, {});

log(`web       http://localhost:${cfg.webPort}`);
log(`server    http://localhost:${cfg.serverPort} (ws :${cfg.wsPort})`);
log(`postgres  localhost:${cfg.pgPort} (credentials from .env)`);
log(`lobby     http://localhost:${cfg.webPort}/?lobby`);
log('Ctrl-C stops the app; Postgres keeps running (use --stop-postgres to stop it too).');

if (await waitForServer()) {
  log('server /health is OK.');
} else {
  log(`WARNING: server did not answer /health within 30s — see its output above.`);
}
