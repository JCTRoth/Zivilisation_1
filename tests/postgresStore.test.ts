import { describe, it, expect } from 'vitest';
import { PostgresPersistence, POSTGRES_SCHEMA_SQL, type PgClient } from '@server/persistence/postgresStore';

/**
 * The Postgres adapter is exercised with a fake pg client: no database server
 * is needed to verify the SQL shape, JSONB casts and RNG-state envelope.
 * Full multi-process room discovery still requires a live integration test.
 */
describe('Postgres persistence adapter', () => {
  const makeClient = (rows: Array<Record<string, unknown>> = []): PgClient & {
    calls: Array<{ text: string; params?: unknown[] }>;
  } => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    return {
      calls,
      async query(text, params) {
        calls.push({ text, params });
        return { rows };
      },
    };
  };

  it('creates JSONB tables with a row-lock-friendly schema', async () => {
    const client = makeClient();
    const persistence = new PostgresPersistence(client);
    await persistence.initSchema();
    expect(client.calls[0].text).toBe(POSTGRES_SCHEMA_SQL);
    expect(POSTGRES_SCHEMA_SQL).toContain('JSONB NOT NULL');
    expect(POSTGRES_SCHEMA_SQL).toContain('PRIMARY KEY (room_id, seq)');
  });

  it('writes and reads the save envelope with RNG state', async () => {
    const client = makeClient([{ blob: { version: 5, currentTurn: 7 } }]);
    const persistence = new PostgresPersistence(client);
    await persistence.saveBlob('r1', 'civ1_savegame', JSON.stringify({
      version: 5, rngState: 42, disasterRngState: 99,
    }));
    const write = client.calls[0];
    expect(write.text).toContain('$4::jsonb');
    expect(write.params).toEqual(['r1', 'civ1_savegame', 5, expect.any(String), 42, 99]);

    const blob = await persistence.loadBlob('r1', 'civ1_savegame');
    expect(JSON.parse(blob!)).toMatchObject({ version: 5, currentTurn: 7 });
  });

  it('persists outbox events and seat hashes', async () => {
    const client = makeClient();
    const persistence = new PostgresPersistence(client);
    await persistence.appendEvent('r1', 3, 1, 'COMBAT_HIT', { attacker: { id: 'a' } });
    await persistence.saveSeat('r1', 1, 'hash', 'red');
    expect(client.calls[0].text).toContain('event_outbox');
    expect(client.calls[0].params?.[2]).toBe(1); // seat
    expect(client.calls[1].text).toContain('INTO seats');
  });
});
