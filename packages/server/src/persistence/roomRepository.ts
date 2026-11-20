import type Database from 'better-sqlite3';
import type { LobbyConfig } from '../lobby';

/** Metadata queries for rooms, seats and the optional event outbox. */
export class RoomRepository {
  constructor(private readonly db: Database.Database) {}

  upsertRoom(id: string, lobby: LobbyConfig): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO rooms (id, lobby_json, status, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET lobby_json = excluded.lobby_json, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(lobby), now, now);
  }

  getRoom(id: string): LobbyConfig | null {
    const row = this.db.prepare('SELECT lobby_json FROM rooms WHERE id = ?').get(id) as
      | { lobby_json: string } | undefined;
    return row ? JSON.parse(row.lobby_json) as LobbyConfig : null;
  }

  listRooms(): Array<{ id: string; lobby: LobbyConfig; status: string }> {
    const rows = this.db.prepare('SELECT id, lobby_json, status FROM rooms ORDER BY id').all() as
      Array<{ id: string; lobby_json: string; status: string }>;
    return rows.map((r) => ({ id: r.id, lobby: JSON.parse(r.lobby_json) as LobbyConfig, status: r.status }));
  }

  removeRoom(id: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  }

  saveSeat(roomId: string, seat: number, tokenHash: string, color?: string): void {
    this.db.prepare(`
      INSERT INTO seats (room_id, seat, token_hash, color, status, connected_at)
      VALUES (?, ?, ?, ?, 'joined', ?)
      ON CONFLICT(room_id, seat) DO UPDATE SET
        token_hash = excluded.token_hash, color = excluded.color,
        status = 'joined', connected_at = excluded.connected_at
    `).run(roomId, seat, tokenHash, color ?? null, Date.now());
  }

  getSeatTokenHash(roomId: string, seat: number): string | null {
    const row = this.db.prepare(
      'SELECT token_hash FROM seats WHERE room_id = ? AND seat = ?',
    ).get(roomId, seat) as { token_hash: string } | undefined;
    return row?.token_hash ?? null;
  }

  /** Oldest retained sequence (0 when empty). */
  oldestEventSeq(roomId: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MIN(seq), 0) AS seq FROM event_outbox WHERE room_id = ?',
    ).get(roomId) as { seq: number };
    return Number(row.seq) || 0;
  }

  /** Drop events at or below `keepSeq` (retention window). */
  trimOutbox(roomId: string, keepSeq: number): void {
    this.db.prepare('DELETE FROM event_outbox WHERE room_id = ? AND seq <= ?')
      .run(roomId, keepSeq);
  }

  /** Last persisted event sequence, so a restored room does not reuse ids. */
  lastEventSeq(roomId: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM event_outbox WHERE room_id = ?',
    ).get(roomId) as { seq: number };
    return Number(row.seq) || 0;
  }

  appendEvent(roomId: string, seq: number, seat: number | null, type: string, payload: unknown): void {
    this.db.prepare(`
      INSERT INTO event_outbox (room_id, seq, seat, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, seq) DO NOTHING
    `).run(roomId, seq, seat, type, JSON.stringify(payload ?? null), Date.now());
  }

  readEvents(roomId: string, afterSeq = 0, limit = 100): Array<{
    seq: number; seat: number | null; type: string; payload: unknown;
  }> {
    const rows = this.db.prepare(`
      SELECT seq, seat, type, payload FROM event_outbox
      WHERE room_id = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(roomId, afterSeq, limit) as Array<{
      seq: number; seat: number | null; type: string; payload: string;
    }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }
}
