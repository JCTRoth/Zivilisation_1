import { describe, it, expect } from 'vitest';
import { LocalEventBus, PostgresEventBus, type PgNotifyClient } from '@server/pubsub';
import { RoomManager } from '@server/roomManager';
import type { RoomEventMessage } from '@server/pubsub';

describe('room event bus', () => {
  it('delivers events to subscribers and stops after close', () => {
    const bus = new LocalEventBus();
    const received: RoomEventMessage[] = [];
    const unsubscribe = bus.subscribe((m) => received.push(m));
    bus.publish({ roomId: 'r1', event: { type: 'TURN_START', payload: {} } });
    expect(received).toHaveLength(1);
    unsubscribe();
    bus.publish({ roomId: 'r1', event: { type: 'TURN_END', payload: {} } });
    expect(received).toHaveLength(1);
  });

  it('uses LISTEN/NOTIFY for cross-process delivery', async () => {
    let notifyHandler: ((channel: string, payload: string) => void) | null = null;
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client: PgNotifyClient = {
      async query(text, params) {
        calls.push({ text, params });
        return { rows: [] };
      },
      onNotification(handler) {
        notifyHandler = handler;
        return () => { notifyHandler = null; };
      },
    };
    const bus = new PostgresEventBus(client);
    await bus.start();
    expect(calls[0].text).toContain('LISTEN');

    const received: RoomEventMessage[] = [];
    bus.subscribe((m) => received.push(m));
    await bus.publish({ roomId: 'r2', event: { type: 'COMBAT_HIT', payload: {} } });
    expect(calls[1].text).toContain('pg_notify');
    expect(JSON.parse(String(calls[1].params?.[1]))).toMatchObject({ roomId: 'r2' });

    notifyHandler!('civ1_room_events', JSON.stringify({
      roomId: 'r2', event: { type: 'TURN_START', payload: {} },
    }));
    expect(received).toHaveLength(1);

    await bus.close();
    expect(calls.at(-1)?.text).toContain('UNLISTEN');
  });

  it('forwards another process\'s event only to the matching local room', () => {
    const bus = new LocalEventBus();
    const a = new RoomManager(undefined, bus, 'process-a');
    const b = new RoomManager(undefined, bus, 'process-b');
    // Both processes host the same logical room id (each has its own engine).
    const roomA = a.create({ seed: 1 }, 'rShared');
    const roomB = b.create({ seed: 1 }, 'rShared');
    const seenA: string[] = [];
    const seenB: string[] = [];
    roomA.addListener((e) => seenA.push(e.type));
    roomB.addListener((e) => seenB.push(e.type));

    bus.publish({ roomId: 'rShared', event: { type: 'TURN_START', payload: {} } });
    expect(seenB).toEqual(['TURN_START']);
    expect(seenA).toEqual(['TURN_START']);

    // An event emitted by roomA's engine is published to the shared bus and
    // lands on roomB's local listeners, as it would in another process.
    roomA.engine.onStateChange?.('NOTIFICATION', { civId: 0, message: 'hi' });
    expect(seenB).toEqual(['TURN_START', 'NOTIFICATION']);
    // The originating process sees its own event once (local emit), not twice.
    expect(seenA).toEqual(['TURN_START', 'NOTIFICATION']);
  });
});
