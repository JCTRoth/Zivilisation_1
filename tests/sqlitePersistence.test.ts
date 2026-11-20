import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePersistence } from '@server/persistence/sqliteStore';
import { RoomManager } from '@server/roomManager';
import { HttpTransport } from '@server/transport';
import { createSeatToken } from '@server/auth';
import { GameRoom } from '@server/room';

/** Step 6: durable rooms, saves and RNG state across a server restart. */
describe('SQLite persistence', () => {
  const files: string[] = [];
  const open: SqlitePersistence[] = [];

  const newPersistence = (): SqlitePersistence => {
    // `os.tmpdir()` rather than a hard-coded path: the directory has to
    // exist on every machine that runs the suite (CI included).
    const file = join(tmpdir(), `civ1-persist-${files.length}-${Date.now()}.db`);
    files.push(file);
    const persistence = new SqlitePersistence(file);
    open.push(persistence);
    return persistence;
  };

  afterEach(() => {
    for (const persistence of open) persistence.close();
    for (const file of files) {
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(file + suffix)) unlinkSync(file + suffix);
      }
    }
    files.length = 0;
    open.length = 0;
  });

  it('stores a save blob together with its version and RNG state', () => {
    const persistence = newPersistence();
    persistence.rooms.upsertRoom('room_x', { seed: 1 });
    const store = persistence.saveStoreFor('room_x');
    store.set('civ1_savegame', JSON.stringify({
      version: 5, rngState: 1234, disasterRngState: 5678,
    }));

    const row = persistence.db.prepare(
      'SELECT version, rng_state, disaster_rng_state, blob FROM saves WHERE room_id = ?',
    ).get('room_x') as {
      version: number; rng_state: number; disaster_rng_state: number; blob: string;
    };
    expect(row).toMatchObject({ version: 5, rng_state: 1234, disaster_rng_state: 5678 });
    expect(store.get('civ1_savegame')).toBe(row.blob);
  });

  it('keeps room metadata, seat tokens and the event outbox', () => {
    const persistence = newPersistence();
    const repo = persistence.rooms;
    repo.upsertRoom('room_y', { seed: 42, numberOfCivilizations: 3 });
    expect(repo.listRooms()).toHaveLength(1);
    expect(repo.getRoom('room_y')).toMatchObject({ seed: 42 });

    repo.saveSeat('room_y', 1, 'hash-abc', 'red');
    expect(repo.getSeatTokenHash('room_y', 1)).toBe('hash-abc');
    repo.appendEvent('room_y', 1, null, 'TURN_START', { civilizationId: 0 });
    repo.appendEvent('room_y', 2, 1, 'NOTIFICATION', { message: 'hi' });
    expect(repo.readEvents('room_y', 0)).toMatchObject([
      { seq: 1, type: 'TURN_START' },
      { seq: 2, type: 'NOTIFICATION' },
    ]);
  });

  it('persists classified events and serves JSON catch-up after a sequence', async () => {
    const persistence = newPersistence();
    const transport = new HttpTransport({ port: 0, secret: 'secret', persistence });
    await transport.waitUntilReady();
    const created = await fetch(`http://127.0.0.1:${transport.port}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 8, numberOfCivilizations: 2 }),
    }).then((r) => r.json()) as { id: string };
    const room = transport.rooms.get(created.id)!;

    room.engine.onStateChange?.('TURN_START', { civilizationId: 0 });
    room.engine.onStateChange?.('NOTIFICATION', { civId: 0, message: 'hello' });
    const stored = persistence.rooms.readEvents(created.id, 0);
    expect(stored.map((e) => e.type).slice(-2)).toEqual(['TURN_START', 'NOTIFICATION']);
    expect(stored[0].seq).toBe(1); // room start already emitted one TURN_START

    const token = createSeatToken('secret', created.id, 0);
    const catchUp = await fetch(
      `http://127.0.0.1:${transport.port}/rooms/${created.id}/events?token=${token}&after=1`,
    ).then((r) => r.json()) as { ok: boolean; events: Array<{ seq: number; type: string }> };
    expect(catchUp.ok).toBe(true);
    expect(catchUp.events.map((e) => e.type)).toEqual(['TURN_START', 'NOTIFICATION']);
    expect(catchUp.events[0].seq).toBe(2);

    await transport.close();
  });

  it('trims the outbox and asks for a snapshot when a client is too old', async () => {
    const persistence = newPersistence();
    persistence.rooms.upsertRoom('trim', { seed: 3 });
    for (let i = 1; i <= 3; i++) {
      persistence.rooms.appendEvent('trim', i, null, 'TURN_START', { civilizationId: 0 });
    }
    persistence.rooms.trimOutbox('trim', 1);
    expect(persistence.rooms.readEvents('trim', 0).map((e) => e.seq)).toEqual([2, 3]);
    expect(persistence.rooms.oldestEventSeq('trim')).toBe(2);

    const transport = new HttpTransport({ port: 0, persistence });
    await transport.waitUntilReady();
    const room = transport.rooms.get('trim');
    expect(room).toBeTruthy();
    const response = await fetch(
      `http://127.0.0.1:${transport.port}/rooms/trim/events?seat=0&after=0`,
    ).then((r) => r.json()) as { ok: boolean; reason?: string };
    expect(response).toMatchObject({ ok: false, reason: 'SNAPSHOT_REQUIRED' });
    await transport.close();
  });

  it('rejects a retried command after restart even without an in-memory cache', async () => {
    const persistence = newPersistence();
    persistence.rooms.upsertRoom('idem_restart', { seed: 6 });
    const store = persistence.saveStoreFor('idem_restart');
    const first = new GameRoom({ id: 'idem_restart', lobby: { seed: 6 }, saveStore: store });
    await first.start();
    const envelope = {
      command: { type: 'SET_RATES', tax: 30, science: 50, luxury: 20 } as never,
      context: { actorId: 0, turn: first.engine.currentTurn, seq: 7 },
    };
    expect(first.submit(envelope)).toMatchObject({ ok: true });
    expect(first.engine.getLastCommandSeq(0)).toBe(7);
    expect(first.flushSave()).toBe(true);
    expect(JSON.parse(store.get('civ1_savegame')!).commandSeqs).toMatchObject({ '0': 7 });
    first.stop();

    const second = new GameRoom({ id: 'idem_restart', lobby: { seed: 6 }, saveStore: store });
    await second.start();
    expect(second.submit(envelope)).toMatchObject({ ok: false, reason: 'STALE_COMMAND' });
    second.stop();
  });

  it('restores a room after a restart, including its command state and RNG stream', async () => {
    const persistence = newPersistence();
    const firstManager = new RoomManager(persistence);
    const room = firstManager.create({ seed: 99, numberOfCivilizations: 2 }, 'room_persist');
    await room.start();

    const result = room.submit({
      command: { type: 'SET_RATES', tax: 15, science: 70, luxury: 15 },
      context: { actorId: 0, turn: room.engine.currentTurn, seq: 1 },
    });
    expect(result).toMatchObject({ ok: true });
    expect(room.engine.civilizations[0].scienceRate).toBe(70);

    // Persist the current position, then advance the in-memory stream. The
    // restored engine must reproduce exactly those six draws from the save.
    room.flushSave();
    const expectedRolls = Array.from({ length: 6 }, () => room.engine.rng());
    for (const r of firstManager.list()) {
      // stop the running tick loop without dropping the persisted rows
      (firstManager.get(r.id) as GameRoom).stop();
    }

    // Simulate a server process restart with a fresh manager on the same DB.
    const restarted = new RoomManager(persistence);
    const restored = await restarted.restoreAll();
    expect(restored).toHaveLength(1);
    const restoredRoom = restarted.get('room_persist')!;
    expect(restoredRoom.engine.civilizations[0].scienceRate).toBe(70);
    expect(Array.from({ length: 6 }, () => restoredRoom.engine.rng())).toEqual(expectedRolls);
  });
});
