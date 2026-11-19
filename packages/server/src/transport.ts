import type { OutboundEvent } from './fog';
import type { CommandEnvelope } from './commands';
import type { CommandResult } from '@civ1/shared';

/** One connected client. `civId` is assigned at join, never trusted from a command. */
export interface Connection {
  readonly id: string;
  readonly civId: number;
  send(event: OutboundEvent): void;
  close(): void;
}

/**
 * Transport boundary: commands in, classified events out. A WebSocket adapter
 * implements this; the local-session adapter in packages/web does the same on
 * the client side, which is why the UI never changes when the transport does.
 */
export interface Transport {
  onCommand(handler: (connection: Connection, envelope: CommandEnvelope) => Promise<CommandResult>): void;
  broadcast(roomId: string, event: OutboundEvent): void;
  close(): void;
}
