import cluster from 'node:cluster';
import type { SqlitePersistence } from './persistence/sqliteStore';
import { logger } from './logger';
import { PostgresPersistence } from './persistence/postgresStore';
import { LocalEventBus, PostgresEventBus, type RoomEventBus } from './pubsub';
import { HttpTransport } from './transport';
import { WsTransport } from './wsTransport';
import type { AsyncRoomStore, RoomEventBusSource } from './roomManager';
import pg from 'pg';

/**
 * Runnable authoritative server. Start with `npm run dev:server`.
 *
 * Environment:
 *   PORT, WS_PORT, GAME_SERVER_SECRET, DB_FILE
 *   PG_URL   — Postgres for rooms/saves/events + LISTEN/NOTIFY pub/sub.
 *   WORKERS  — number of Node worker processes (default 1). >1 requires PG_URL
 *              because SQLite-backed rooms cannot be shared between processes.
 */
const port = Number(process.env.PORT ?? 8787);
const wsPort = Number(process.env.WS_PORT ?? 8788);
const secret = process.env.GAME_SERVER_SECRET ?? 'dev-secret';
const dbFile = process.env.DB_FILE ?? 'server.db';
const pgUrl = process.env.PG_URL;
const host = process.env.HOST ?? '127.0.0.1';
const workers = Math.max(1, Number(process.env.WORKERS ?? 1));

if (cluster.isPrimary && workers > 1) {
  if (!pgUrl) {
    logger.error('WORKERS > 1 requires PG_URL: SQLite rooms cannot be shared across processes');
    process.exit(1);
  }
  let shuttingDown = false;
  // Concurrent CREATE TABLE IF NOT EXISTS from several workers races in
  // Postgres (pg_type unique violation). Initialise the schema once here.
  const bootstrapPool = new pg.Pool({ connectionString: pgUrl });
  await new PostgresPersistence(bootstrapPool).initSchema();
  await bootstrapPool.end();
  logger.info('primary starting workers', { workers });
  for (let i = 0; i < workers; i++) cluster.fork();
  let remaining = workers;
  cluster.on('exit', (worker, code) => {
    if (shuttingDown) {
      remaining--;
      if (remaining <= 0) process.exit(0);
      return;
    }
    logger.warn('worker exited, respawning', { workerId: String(worker.id), code });
    cluster.fork();
  });
  const shutdown = () => {
    shuttingDown = true;
    const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
    setTimeout(() => process.exit(0), timeoutMs).unref();
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process?.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  const sourceId: RoomEventBusSource = `worker_${cluster.worker?.id ?? process.pid}`;
  await startWorker(sourceId);
}

async function startWorker(sourceId: RoomEventBusSource): Promise<void> {
  let persistence: SqlitePersistence | AsyncRoomStore;
  let bus: RoomEventBus;
  let closeExtra: () => Promise<void> = async () => undefined;
  let readyCheck: () => Promise<boolean>;
  let isSqlite = false;

  if (pgUrl) {
    const pool = new pg.Pool({ connectionString: pgUrl });
    const postgres = new PostgresPersistence(pool);
    await postgres.initSchema();
    // LISTEN/NOTIFY needs a dedicated long-lived client (a Pool rotates clients).
    const listener = new pg.Client({ connectionString: pgUrl });
    await listener.connect();
    const notifyClient = {
      query: (text: string, params?: unknown[]) => listener.query(text, params),
      onNotification: (handler: (channel: string, payload: string) => void) => {
        const cb = (message: { channel: string; payload?: string }) => {
          handler(message.channel, message.payload ?? '');
        };
        listener.on('notification', cb);
        return () => { listener.off('notification', cb); };
      },
    };
    const pgBus = new PostgresEventBus(notifyClient);
    await pgBus.start();
    persistence = postgres;
    bus = pgBus;
    readyCheck = async () => {
      await pool.query('SELECT 1');
      return true;
    };
    closeExtra = async () => {
      await pgBus.close();
      await listener.end();
      await pool.end();
    };
    logger.info('Postgres + LISTEN/NOTIFY', { workerId: sourceId });
  } else {
    // Loaded only in single-process mode so Postgres images can omit the
    // native better-sqlite3 dependency entirely.
    const { SqlitePersistence: SqliteStore } = await import('./persistence/sqliteStore');
    const sqlite = new SqliteStore(dbFile);
    isSqlite = true;
    persistence = sqlite;
    bus = new LocalEventBus();
    readyCheck = async () => {
      sqlite.db.prepare('SELECT 1').get();
      return true;
    };
    closeExtra = async () => sqlite.close();
    logger.info('SQLite persistence', { workerId: sourceId, file: dbFile });
  }

  const http = new HttpTransport({
    port,
    host,
    secret,
    bus,
    sourceId,
    readyCheck,
    ...(isSqlite
      ? { persistence: persistence as SqlitePersistence }
      : { asyncPersistence: persistence as AsyncRoomStore }),
  });
  await http.waitUntilReady();
  const ws = new WsTransport({ port: wsPort, host, secret }, http.rooms);
  await ws.waitUntilReady();

  logger.info('listening', { workerId: sourceId, port, wsPort });

  const shutdown = async () => {
    await ws.close();
    await http.close();
    await closeExtra();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
