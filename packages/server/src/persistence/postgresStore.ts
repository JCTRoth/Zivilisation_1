/**
 * Optional Postgres backend for multi-process deployments (report step 2).
 *
 * The engine's `SaveStore` is synchronous, so Postgres cannot implement it
 * directly. Instead this adapter owns the async I/O: it hydrates a room's
 * in-memory store at startup and writes snapshots/events in the background.
 * The room engine still uses the same synchronous port and never sees SQL.
 */
import type { LobbyConfig } from '../lobby';

export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  lobby_json  JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saves (
  room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot                TEXT NOT NULL DEFAULT 'civ1_savegame',
  version             INTEGER NOT NULL DEFAULT 0,
  blob                JSONB NOT NULL,
  rng_state           BIGINT,
  disaster_rng_state  BIGINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, slot)
);
CREATE TABLE IF NOT EXISTS seats (
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat         INTEGER NOT NULL,
  token_hash   TEXT NOT NULL,
  color        TEXT,
  status       TEXT NOT NULL DEFAULT 'joined',
  connected_at TIMESTAMPTZ,
  PRIMARY KEY (room_id, seat)
);
CREATE TABLE IF NOT EXISTS event_outbox (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq        BIGINT NOT NULL,
  seat       INTEGER,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_outbox_room ON event_outbox(room_id, seq);
`;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Add new entries here — never edit an already-applied migration. */
export const POSTGRES_MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial schema', sql: POSTGRES_SCHEMA_SQL },
];

export class PostgresPersistence {
  constructor(private readonly client: PgClient) {}

  /** Apply unapplied migrations exactly once (safe to call from many workers). */
  async initSchema(): Promise<void> {
    await this.client.query(
      `CREATE TABLE IF NOT EXISTS migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const result = await this.client.query('SELECT version FROM migrations');
    const applied = new Set(result.rows.map((row) => Number(row.version)));
    for (const migration of POSTGRES_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await this.client.query(migration.sql);
      await this.client.query(
        'INSERT INTO migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    }
  }

  async listRooms(): Promise<Array<{ id: string; lobby: LobbyConfig }>> {
    const result = await this.client.query('SELECT id, lobby_json FROM rooms ORDER BY id');
    return result.rows.map((row) => ({
      id: String(row.id),
      lobby: (typeof row.lobby_json === 'string'
        ? JSON.parse(row.lobby_json)
        : row.lobby_json) as LobbyConfig,
    }));
  }

  /** Alias used by the async RoomManager contract. */
  loadRooms(): Promise<Array<{ id: string; lobby: LobbyConfig }>> {
    return this.listRooms();
  }

  async loadRoom(id: string): Promise<{ id: string; lobby: LobbyConfig } | null> {
    const result = await this.client.query(
      'SELECT id, lobby_json FROM rooms WHERE id = $1', [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      lobby: (typeof row.lobby_json === 'string'
        ? JSON.parse(row.lobby_json)
        : row.lobby_json) as LobbyConfig,
    };
  }

  async upsertRoom(id: string, lobby: LobbyConfig): Promise<void> {
    await this.client.query(
      `INSERT INTO rooms (id, lobby_json) VALUES ($1, $2::jsonb)
       ON CONFLICT(id) DO UPDATE SET lobby_json = excluded.lobby_json, updated_at = now()`,
      [id, JSON.stringify(lobby)],
    );
  }

  async removeRoom(id: string): Promise<void> {
    await this.client.query('DELETE FROM rooms WHERE id = $1', [id]);
  }

  async loadBlob(roomId: string, slot: string): Promise<string | null> {
    const result = await this.client.query(
      'SELECT blob FROM saves WHERE room_id = $1 AND slot = $2',
      [roomId, slot],
    );
    const blob = result.rows[0]?.blob;
    return blob === undefined || blob === null ? null : JSON.stringify(blob);
  }

  async saveBlob(roomId: string, slot: string, json: string): Promise<void> {
    let version = 0;
    let rngState: number | null = null;
    let disasterRngState: number | null = null;
    try {
      const parsed = JSON.parse(json) as {
        version?: number; rngState?: number; disasterRngState?: number;
      };
      version = Number(parsed.version) || 0;
      rngState = typeof parsed.rngState === 'number' ? parsed.rngState : null;
      disasterRngState = typeof parsed.disasterRngState === 'number' ? parsed.disasterRngState : null;
    } catch {
      // still persist the raw JSON
    }
    await this.client.query(
      `INSERT INTO saves (room_id, slot, version, blob, rng_state, disaster_rng_state)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT(room_id, slot) DO UPDATE SET
         version = excluded.version, blob = excluded.blob,
         rng_state = excluded.rng_state,
         disaster_rng_state = excluded.disaster_rng_state,
         updated_at = now()`,
      [roomId, slot, version, json, rngState, disasterRngState],
    );
  }

  async appendEvent(
    roomId: string, seq: number, seat: number | null, type: string, payload: unknown,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO event_outbox (room_id, seq, seat, type, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT(room_id, seq) DO NOTHING`,
      [roomId, seq, seat, type, JSON.stringify(payload ?? null)],
    );
  }

  async oldestEventSeq(roomId: string): Promise<number> {
    const result = await this.client.query(
      'SELECT COALESCE(MIN(seq), 0) AS seq FROM event_outbox WHERE room_id = $1',
      [roomId],
    );
    return Number(result.rows[0]?.seq ?? 0);
  }

  async readEvents(roomId: string, after: number, limit = 100): Promise<Array<{
    seq: number; seat: number | null; type: string; payload: unknown;
  }>> {
    const result = await this.client.query(
      `SELECT seq, seat, type, payload FROM event_outbox
       WHERE room_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [roomId, after, limit],
    );
    return result.rows.map((row) => ({
      seq: Number(row.seq),
      seat: row.seat === null ? null : Number(row.seat),
      type: String(row.type),
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    }));
  }

  async trimOutbox(roomId: string, keepSeq: number): Promise<void> {
    await this.client.query(
      'DELETE FROM event_outbox WHERE room_id = $1 AND seq <= $2', [roomId, keepSeq],
    );
  }

  async lastEventSeq(roomId: string): Promise<number> {
    const result = await this.client.query(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM event_outbox WHERE room_id = $1',
      [roomId],
    );
    return Number(result.rows[0]?.seq ?? 0);
  }

  async saveSeat(roomId: string, seat: number, tokenHash: string, color?: string): Promise<void> {
    await this.client.query(
      `INSERT INTO seats (room_id, seat, token_hash, color, connected_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT(room_id, seat) DO UPDATE SET token_hash = excluded.token_hash,
         color = excluded.color, status = 'joined', connected_at = now()`,
      [roomId, seat, tokenHash, color ?? null],
    );
  }
}
