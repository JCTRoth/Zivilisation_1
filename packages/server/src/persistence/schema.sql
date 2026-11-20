-- DDL for the SQLite persistence backend.
-- Mirror of schema.ts, which is what the code actually executes.
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  lobby_json  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saves (
  room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot                TEXT NOT NULL DEFAULT 'civ1_savegame',
  version             INTEGER NOT NULL DEFAULT 0,
  blob                TEXT NOT NULL,
  rng_state           INTEGER,
  disaster_rng_state  INTEGER,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (room_id, slot)
);

CREATE TABLE IF NOT EXISTS seats (
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat         INTEGER NOT NULL,
  token_hash   TEXT NOT NULL,
  color        TEXT,
  status       TEXT NOT NULL DEFAULT 'joined',
  connected_at INTEGER,
  PRIMARY KEY (room_id, seat)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  seat       INTEGER,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_saves_room ON saves(room_id);
CREATE INDEX IF NOT EXISTS idx_seats_room ON seats(room_id);
CREATE INDEX IF NOT EXISTS idx_outbox_room ON event_outbox(room_id, seq);
