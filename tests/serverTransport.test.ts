import { describe, it, expect, afterEach } from 'vitest';
import { classifyEvent } from '@server/classify';
import { engineFogFilter } from '@server/fog';
import { GameRoom } from '@server/room';
import { HttpTransport } from '@server/transport';
import type GameEngine from '@shared/game/engine/GameEngine';

/** The server boundary: commands in, classified + fog-filtered events out. */
describe('server transport', () => {
  const transports: HttpTransport[] = [];
  const rooms: GameRoom[] = [];

  afterEach(async () => {
    for (const room of rooms) room.stop();
    for (const transport of transports) await transport.close();
    transports.length = 0;
    rooms.length = 0;
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
    expect(filter.isVisible(classifyEvent('TURN_START', { civilizationId: 0 }), 1)).toBe(false);
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
    expect(health).toMatchObject({ ok: true, rooms: ['r1'] });

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
