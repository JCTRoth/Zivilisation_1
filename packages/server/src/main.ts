import cluster from 'node:cluster';
import { SqlitePersistence } from './persistence/sqliteStore';
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
const workers = Math.max(1, Number(process.env.WORKERS ?? 1));

if (cluster.isPrimary && workers > 1) {
  if (!pgUrl) {
    console.error('[server] WORKERS > 1 requires PG_URL: SQLite rooms cannot be shared across processes.');
    process.exit(1);
  }
  let shuttingDown = false;
  console.log(`[server] primary ${process.pid} starting ${workers} workers`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    if (shuttingDown) return;
    console.warn(`[server] worker ${worker.id} exited (${code}) — respawning`);
    cluster.fork();
  });
  const shutdown = () => {
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process?.kill('SIGTERM');
    setTimeout(() => process.exit(0), 2000).unref();
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
    closeExtra = async () => {
      await pgBus.close();
      await listener.end();
      await pool.end();
    };
    console.log(`[server:${sourceId}] Postgres + LISTEN/NOTIFY`);
  } else {
    persistence = new SqlitePersistence(dbFile);
    bus = new LocalEventBus();
    closeExtra = async () => (persistence as SqlitePersistence).close();
    console.log(`[server:${sourceId}] SQLite (${dbFile})`);
  }

  const http = new HttpTransport({
    port,
    secret,
    bus,
    sourceId,
    ...(persistence instanceof SqlitePersistence
      ? { persistence }
      : { asyncPersistence: persistence as AsyncRoomStore }),
  });
  await http.waitUntilReady();
  const ws = new WsTransport({ port: wsPort, secret }, http.rooms);
  await ws.waitUntilReady();

  console.log(`[server:${sourceId}] HTTP ${port}  WS ${wsPort}`);

  const shutdown = async () => {
    await ws.close();
    await http.close();
    await closeExtra();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
