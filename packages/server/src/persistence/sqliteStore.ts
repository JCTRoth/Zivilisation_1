import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SaveStore } from '../saveStore';
import { SCHEMA_SQL } from './schema';
import { RoomRepository } from './roomRepository';

/**
 * SQLite persistence backend (report step 6).
 *
 * The game state itself stays an opaque V5 save blob — the engine's own
 * migration code owns its evolution. Only the envelope columns (version,
 * RNG state, timestamps) live in the database, so schema changes here do not
 * touch the simulation.
 */
export class SqlitePersistence {
  readonly db: Database.Database;
  readonly rooms: RoomRepository;

  constructor(filename = ':memory:') {
    // SQLite creates the database file, but not the directory holding it.
    // Without this, a configured DB_FILE inside a fresh directory (a
    // container volume, a CI workspace) fails with "Cannot open database
    // because the directory does not exist".
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.rooms = new RoomRepository(this.db);
  }

  /** A store bound to one room: `get('civ1_savegame')` returns that room's game. */
  saveStoreFor(roomId: string): SaveStore {
    return new SqliteSaveStore(this.db, roomId);
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteSaveStore implements SaveStore {
  private readonly getStmt: Database.Statement;
  private readonly setStmt: Database.Statement;

  constructor(
    private readonly db: Database.Database,
    private readonly roomId: string,
  ) {
    this.getStmt = this.db.prepare(
      'SELECT blob FROM saves WHERE room_id = ? AND slot = ?',
    );
    this.setStmt = this.db.prepare(`
      INSERT INTO saves (room_id, slot, version, blob, rng_state, disaster_rng_state, updated_at)
      VALUES (@room_id, @slot, @version, @blob, @rng_state, @disaster_rng_state, @updated_at)
      ON CONFLICT(room_id, slot) DO UPDATE SET
        version = excluded.version,
        blob = excluded.blob,
        rng_state = excluded.rng_state,
        disaster_rng_state = excluded.disaster_rng_state,
        updated_at = excluded.updated_at
    `);
  }

  get(slot: string): string | null {
    const row = this.getStmt.get(this.roomId, slot) as { blob: string } | undefined;
    return row?.blob ?? null;
  }

  set(slot: string, json: string): void {
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
      // Store the raw blob anyway; the engine will reject it on load.
    }
    this.setStmt.run({
      room_id: this.roomId,
      slot,
      version,
      blob: json,
      rng_state: rngState,
      disaster_rng_state: disasterRngState,
      updated_at: Date.now(),
    });
  }
}
