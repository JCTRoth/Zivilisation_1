import type { OutboundEvent } from '@civ1/shared/types/events';
import type { PgClient } from './persistence/postgresStore';

/** One event, tagged with the room it belongs to, crossing process boundaries. */
export interface RoomEventMessage {
  roomId: string;
  event: OutboundEvent;
  /** Originating process/manager; receivers ignore their own messages. */
  sourceId?: string;
}

export interface RoomEventBus {
  publish(message: RoomEventMessage): Promise<void> | void;
  subscribe(handler: (message: RoomEventMessage) => void): () => void;
  close(): Promise<void> | void;
}

/** Default in-process bus: no behaviour change for single-process servers. */
export class LocalEventBus implements RoomEventBus {
  private readonly handlers = new Set<(message: RoomEventMessage) => void>();

  publish(message: RoomEventMessage): void {
    for (const handler of this.handlers) handler(message);
  }

  subscribe(handler: (message: RoomEventMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
  }
}

/**
 * Postgres LISTEN/NOTIFY bus. Each process publishes classified events to one
 * channel; every other process receives them and forwards to its local room.
 */
export interface PgNotifyClient extends PgClient {
  onNotification(handler: (channel: string, payload: string) => void): () => void;
}

export class PostgresEventBus implements RoomEventBus {
  private readonly channel = 'civ1_room_events';
  private readonly handlers = new Set<(message: RoomEventMessage) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly client: PgNotifyClient) {}

  async start(): Promise<void> {
    await this.client.query(`LISTEN ${this.channel}`);
    this.unsubscribe = this.client.onNotification((channel, payload) => {
      if (channel !== this.channel) return;
      try {
        const message = JSON.parse(payload) as RoomEventMessage;
        for (const handler of this.handlers) handler(message);
      } catch {
        // ignore malformed notifications
      }
    });
  }

  async publish(message: RoomEventMessage): Promise<void> {
    await this.client.query('SELECT pg_notify($1, $2)', [this.channel, JSON.stringify(message)]);
  }

  subscribe(handler: (message: RoomEventMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async close(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
    await this.client.query(`UNLISTEN ${this.channel}`);
    this.handlers.clear();
  }
}
