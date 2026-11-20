import { describe, it, expect, afterEach } from 'vitest';
import { classifyEvent } from '@server/classify';
import { engineFogFilter } from '@server/fog';
import { GameRoom } from '@server/room';
import { HttpTransport } from '@server/transport';
import { WsTransport } from '@server/wsTransport';
import { RoomManager } from '@server/roomManager';
import { createSeatToken, verifySeatToken } from '@server/auth';
import { SqlitePersistence } from '@server/persistence/sqliteStore';
import WebSocket from 'ws';
import type GameEngine from '@shared/game/engine/GameEngine';
import { createRemoteSession } from '@/remoteSession';
import { sendCommand, setActiveSession } from '@/session';
import { subscribeToRoomEvents } from '@/remoteEvents';
import { createRemoteGame } from '@/remoteGame';
import { createRoomWithSeats } from '@/lobbyApi';

/** The server boundary: commands in, classified + fog-filtered events out. */
describe('server transport', () => {
  const transports: HttpTransport[] = [];
  const wsTransports: WsTransport[] = [];
  const rooms: GameRoom[] = [];
  const remoteGames: Array<{ close(): void }> = [];

  afterEach(async () => {
    for (const remote of remoteGames) remote.close();
    for (const room of rooms) room.stop();
    for (const transport of transports) await transport.close();
    for (const transport of wsTransports) await transport.close();
    setActiveSession(null);
    transports.length = 0;
    wsTransports.length = 0;
    rooms.length = 0;
    remoteGames.length = 0;
  });

  it('signs seat tokens and rejects tampering, wrong rooms and expiry', () => {
    const token = createSeatToken('secret', 'r1', 2, 60);
    expect(verifySeatToken('secret', token, 'r1')).toBe(2);
    expect(verifySeatToken('secret', token, 'r2')).toBeNull();
    expect(verifySeatToken('other-secret', token, 'r1')).toBeNull();
    const [body, signature] = token.split('.');
    expect(verifySeatToken('secret', `${body}.${signature}x`, 'r1')).toBeNull();
    expect(verifySeatToken('secret', createSeatToken('secret', 'r1', 2, -1), 'r1')).toBeNull();
    expect(verifySeatToken('secret', null, 'r1')).toBeNull();
  });

  it('requires a signed token when the transport is configured with a secret', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'secure', lobby: { seed: 3, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const base = `http://127.0.0.1:${transport.port}`;
    const created = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 4 }),
    }).then((r) => r.json());
    expect(created.token).toBeTruthy();

    const forged = await fetch(`${base}/rooms/secure/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seat: 1, command: { type: 'SET_RATES', tax: 100, science: 0, luxury: 0 } }),
    }).then((r) => r.json());
    expect(forged).toMatchObject({ ok: false });

    const authorized = await fetch(`${base}/rooms/secure/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: createSeatToken('secret', 'secure', 0),
        seat: 1, // deliberately forged — the token wins
        command: { type: 'SET_RATES', tax: 25, science: 50, luxury: 25 },
      }),
    }).then((r) => r.json());
    expect(authorized).toMatchObject({ ok: true, command: 'SET_RATES' });
    expect(room.engine.civilizations[0].scienceRate).toBe(50);
  });

  it('creates a room and mints seat tokens through the lobby API', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);

    const result = await createRoomWithSeats(
      `http://127.0.0.1:${transport.port}`,
      { seed: 21, numberOfCivilizations: 2 },
      [0, 1],
    );
    expect(Object.keys(result.tokens)).toEqual(['0', '1']);
    expect(verifySeatToken('secret', result.tokens['1'], result.roomId)).toBe(1);
    expect(transport.rooms.get(result.roomId)).toBeTruthy();
  });

  it('mints one signed token per seat, host-only', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'lobby', lobby: { seed: 5, numberOfCivilizations: 3 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const base = `http://127.0.0.1:${transport.port}`;
    const hostToken = createSeatToken('secret', 'lobby', 0);
    const guestToken = createSeatToken('secret', 'lobby', 1);

    const denied = await fetch(`${base}/rooms/lobby/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: guestToken, seats: [2] }),
    }).then((r) => r.json());
    expect(denied).toMatchObject({ ok: false, reason: 'HOST_ONLY' });

    const minted = await fetch(`${base}/rooms/lobby/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: hostToken, seats: [0, 1, 2], colors: ['red', 'blue', 'green'] }),
    }).then((r) => r.json());
    expect(minted.ok).toBe(true);
    expect(Object.keys(minted.tokens)).toEqual(['0', '1', '2']);
    expect(verifySeatToken('secret', minted.tokens['2'], 'lobby')).toBe(2);
    expect(room.saveStore.get('seat_token_hash_2')).toBeTruthy();
  });

  it('rejects a retried command with the same seat and sequence', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'idem', lobby: { seed: 12, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const token = createSeatToken('secret', 'idem', 0);
    const post = (seq: number, tax: number) => fetch(`http://127.0.0.1:${transport.port}/rooms/idem/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token, seq,
        command: { type: 'SET_RATES', tax, science: 100 - tax - 20, luxury: 20 },
      }),
    }).then((r) => r.json()) as Promise<{ ok: boolean; reason?: string }>;

    expect(await post(1, 30)).toMatchObject({ ok: true });
    // Same seq with a different payload returns the cached result: no second apply.
    expect(await post(1, 99)).toMatchObject({ ok: true });
    expect(room.engine.civilizations[0].taxRate).toBe(30);
    expect(await post(2, 40)).toMatchObject({ ok: true });
    expect(room.engine.civilizations[0].taxRate).toBe(40);
  });

  it('reports deep readiness separately from liveness', async () => {
    const transport = new HttpTransport({ port: 0, readyCheck: async () => false });
    await transport.waitUntilReady();
    transports.push(transport);
    const base = `http://127.0.0.1:${transport.port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/ready`)).status).toBe(503);
  });

  it('sends a closed frame on SSE streams before shutdown', async () => {
    const transport = new HttpTransport({ port: 0 });
    await transport.waitUntilReady();
    const room = new GameRoom({ id: 'drain', lobby: { seed: 2 } });
    transport.register(room);
    await room.start();

    const response = await fetch(`http://127.0.0.1:${transport.port}/rooms/drain/events?seat=0`);
    const reader = response.body!.getReader();
    await transport.close(); // not in transports[] — afterEach must not close twice
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain('event: closed');
  });

  it('exposes Prometheus metrics and correlates a command with its log line', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'metrics', lobby: { seed: 4 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await fetch(`http://127.0.0.1:${transport.port}/rooms/metrics/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: createSeatToken('secret', 'metrics', 0), seq: 1,
          command: { type: 'SET_RATES', tax: 20, science: 60, luxury: 20 },
        }),
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    const commandLog = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((l) => l?.message === 'command');
    expect(commandLog).toMatchObject({
      level: 'info', roomId: 'metrics', commandSeq: 1, type: 'SET_RATES', ok: true,
    });

    const metricsText = await fetch(`http://127.0.0.1:${transport.port}/metrics`).then((r) => r.text());
    const counter = Number(metricsText.match(/civ1_commands_total\{type="SET_RATES",result="ok"\} (\d+)/)?.[1] ?? 0);
    expect(counter).toBeGreaterThan(0);
    expect(metricsText).toContain('civ1_events_total{type="TURN_START"}');
  });

  it('classifies seat ownership and event location', () => {
    const event = classifyEvent('COMBAT_HIT', {
      unit: { id: 'u1', civilizationId: 2, col: 7, row: 9 },
    });
    expect(event.civId).toBe(2);
    expect({ col: event.col, row: event.row }).toEqual({ col: 7, row: 9 });
    expect(classifyEvent('ESPIONAGE_RESULT', { civId: 1 }).seatOnly).toBe(true);
  });

  it('keeps seat-only events away from other seats and applies fog to map events', () => {
    const engine = {
      isVisibleToPlayer: (_seat: number, col: number) => col === 3,
    } as unknown as GameEngine;
    const filter = engineFogFilter(engine);

    expect(filter.isVisible(classifyEvent('ESPIONAGE_RESULT', { civId: 1 }), 1)).toBe(true);
    expect(filter.isVisible(classifyEvent('ESPIONAGE_RESULT', { civId: 1 }), 2)).toBe(false);
    expect(filter.isVisible(classifyEvent('COMBAT_HIT', { col: 3, row: 3 }), 0)).toBe(true);
    expect(filter.isVisible(classifyEvent('COMBAT_HIT', { col: 8, row: 3 }), 0)).toBe(false);
    // Public turn transitions are universal, even though they name a civ.
    expect(filter.isVisible(classifyEvent('TURN_START', { civilizationId: 0 }), 1)).toBe(true);
    expect(classifyEvent('WAR_DECLARED', { civId: 0 }).scope).toBe('universal');
  });

  it('creates, lists and removes rooms over HTTP', async () => {
    const transport = new HttpTransport({ port: 0 });
    await transport.waitUntilReady();
    transports.push(transport);
    const base = `http://127.0.0.1:${transport.port}`;

    const created = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 5, numberOfCivilizations: 2 }),
    }).then((r) => r.json());
    expect(created).toMatchObject({ ok: true, id: 'room_1' });

    const listed = await fetch(`${base}/rooms`).then((r) => r.json());
    expect(listed.rooms).toHaveLength(1);

    const saved = await fetch(`${base}/rooms/room_1/save`, { method: 'POST' }).then((r) => r.json());
    expect(saved).toMatchObject({ ok: true });

    const removed = await fetch(`${base}/rooms/room_1`, { method: 'DELETE' }).then((r) => r.json());
    expect(removed).toMatchObject({ ok: true });
    const after = await fetch(`${base}/rooms`).then((r) => r.json());
    expect(after.rooms).toHaveLength(0);
  });

  it('accepts a command over a WebSocket and pushes it through the room', async () => {
    const manager = new RoomManager();
    const room = manager.create({ seed: 9, numberOfCivilizations: 2 }, 'ws_room');
    rooms.push(room);
    await room.start();
    const transport = new WsTransport({ port: 0 }, manager);
    await transport.waitUntilReady();
    wsTransports.push(transport);

    const socket = new WebSocket(`ws://127.0.0.1:${transport.port}/?room=ws_room&token=0`);
    const reply = await new Promise<{ result: { ok: boolean; command?: string } }>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('open', () => {
        socket.send(JSON.stringify({
          type: 'command',
          requestId: 'req1',
          command: { type: 'SET_RATES', tax: 20, science: 70, luxury: 10 },
        }));
      });
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as { type?: string };
        if (message.type === 'result') resolve(message as never);
      });
    });
    socket.close();

    expect(reply.result).toMatchObject({ ok: true, command: 'SET_RATES' });
    expect(room.engine.civilizations[0].taxRate).toBe(20);
  });

  it('delivers classified events to a client event stream', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'stream', lobby: { seed: 13, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const token = createSeatToken('secret', 'stream', 0);
    const received = new Promise<{ type: string }>((resolve, reject) => {
      const subscription = subscribeToRoomEvents({
        baseUrl: `http://127.0.0.1:${transport.port}`,
        roomId: 'stream',
        token,
        onConnected: () => {
          room.engine.onStateChange?.('TURN_START', { civilizationId: 0 });
        },
        onEvent: (event) => {
          subscription.close();
          resolve(event);
        },
        onError: reject,
      });
    });
    expect(await received).toMatchObject({ type: 'TURN_START', scope: 'universal' });
  });

  it('runs remote mode: server snapshot + commands through a mirror engine', async () => {
    const transport = new HttpTransport({ port: 0, secret: 'secret' });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'mirror', lobby: { seed: 17, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const token = createSeatToken('secret', 'mirror', 0);
    const mirror = await createRemoteGame({
      baseUrl: `http://127.0.0.1:${transport.port}`,
      roomId: 'mirror',
      token,
    });
    remoteGames.push(mirror);
    expect(mirror.engine.civilizations).toHaveLength(2);

    const result = await sendCommand({ type: 'SET_RATES', tax: 10, science: 80, luxury: 10 });
    expect(result).toMatchObject({ ok: true });
    expect(room.engine.civilizations[0].scienceRate).toBe(80);
    // The server publishes an event after the command; the mirror refreshes.
    room.engine.onStateChange?.('NOTIFICATION', { civId: 0, message: 'rates' });
    await mirror.refresh();
    expect(mirror.engine.civilizations[0].scienceRate).toBe(80);
  });

  it('does not reload a snapshot for every own command', async () => {
    const persistence = new SqlitePersistence(':memory:');
    const transport = new HttpTransport({ port: 0, secret: 'secret', persistence });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'fewstate', lobby: { seed: 31, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const originalFetch = globalThis.fetch;
    let stateCalls = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/state')) stateCalls++;
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const token = createSeatToken('secret', 'fewstate', 0);
      const mirror = await createRemoteGame({
        baseUrl: `http://127.0.0.1:${transport.port}`,
        roomId: 'fewstate',
        token,
      });
      remoteGames.push(mirror);
      expect(stateCalls).toBe(1); // initial snapshot only
      for (let i = 0; i < 5; i++) {
        await sendCommand({ type: 'SET_RATES', tax: 20 + i, science: 60, luxury: 20 - i });
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(stateCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      persistence.close();
    }
  });

  it('runs the same UI command through a remote session', async () => {
    const transport = new HttpTransport({ port: 0 });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'remote', lobby: { seed: 11, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    setActiveSession(createRemoteSession({
      baseUrl: `http://127.0.0.1:${transport.port}`,
      roomId: 'remote',
      seat: 0,
    }));
    const result = await sendCommand({ type: 'SET_RATES', tax: 40, science: 40, luxury: 20 });
    expect(result).toMatchObject({ ok: true, command: 'SET_RATES' });
    expect(room.engine.civilizations[0].scienceRate).toBe(40);
  });

  it('accepts a command over HTTP and answers with a typed result', async () => {
    const transport = new HttpTransport({ port: 0 });
    await transport.waitUntilReady();
    transports.push(transport);
    const room = new GameRoom({ id: 'r1', lobby: { seed: 7, numberOfCivilizations: 2 } });
    rooms.push(room);
    transport.register(room);
    await room.start();

    const base = `http://127.0.0.1:${transport.port}`;
    const health = await fetch(`${base}/health`).then((r) => r.json());
    expect(health).toMatchObject({ ok: true });
    expect(health.rooms[0].id).toBe('r1');

    const result = await fetch(`${base}/rooms/r1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seat: 0,
        command: { type: 'SET_RATES', tax: 30, science: 60, luxury: 10 },
      }),
    }).then((r) => r.json());
    expect(result).toMatchObject({ ok: true, command: 'SET_RATES' });
    expect(room.engine.civilizations[0].taxRate).toBe(30);
  });
});
