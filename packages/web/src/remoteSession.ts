import type { Command, CommandResult } from '@shared/types/commands';
import type { GameSession } from './session';

/**
 * The client half of the transport seam. `createLocalSession` runs the engine
 * in this tab; `createRemoteSession` sends the same `Command` to a server room.
 * The UI keeps calling `sendCommand()` and never learns which one is bound.
 */
export interface RemoteSessionOptions {
  /** Base URL of the game server, e.g. `http://localhost:8787`. */
  baseUrl: string;
  roomId: string;
  /**
   * Seat, only needed by an unauthenticated demo server. With a signed token
   * the authority derives the seat and ignores this field.
   */
  seat?: number;
  /** Optional signed lobby token; the server maps it to the seat. */
  token?: string;
  /** Called after each reply so the read model can refresh immediately. */
  onResult?: (result: CommandResult) => void;
}

export function createRemoteSession(options: RemoteSessionOptions): GameSession {
  const { baseUrl, roomId, seat } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(roomId)}/commands`;
  let seq = 0;

  return {
    async send(command: Command): Promise<CommandResult> {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ seat, token: options.token, command, seq: ++seq }),
        });
        const result = await response.json() as CommandResult;
        options.onResult?.(result);
        return result;
      } catch (error) {
        return { ok: false, reason: 'UNKNOWN_COMMAND', details: String(error) };
      }
    },
  };
}
