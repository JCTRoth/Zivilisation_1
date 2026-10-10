import GameEngine from '@/game/engine/GameEngine';
import { HUMAN_PLAYER_ID } from '@/utils/PlayerConstants';
import type { Command, CommandContext, CommandRejection, CommandResult } from '../../types/commands';

/**
 * A game session: the transport the UI talks to instead of the engine itself.
 *
 * The session owns the *only* thing the UI must never own — which seat is
 * acting. It builds `CommandContext` from the live connection and hands the
 * command to the authority; the UI sends intents and receives results and
 * knows nothing about who it is or where the engine runs.
 *
 * `createLocalSession` runs the engine in this tab (today's single-player
 * behaviour). A remote session implements the same interface over a socket:
 * `send` posts the command and resolves with the server's `CommandResult`. The
 * UI does not change — that is the whole point of the seam.
 */
export interface GameSession {
  send(command: Command): Promise<CommandResult>;
}

let activeSession: GameSession | null = null;

/** Called once per engine lifetime (see `useGameEngine`). */
export function setActiveSession(session: GameSession | null): void {
  activeSession = session;
}

/**
 * Send one command to the active session. Never throws: a transport or engine
 * failure comes back as a typed rejection so callers can render it.
 */
export function sendCommand(command: Command): Promise<CommandResult> {
  if (!activeSession) {
    console.error('[session] no active game session — command dropped', command.type);
    return Promise.resolve({ ok: false, reason: 'UNKNOWN_COMMAND', details: 'no active session' });
  }
  return activeSession.send(command);
}

/**
 * Type guard for the rejected variant. Callers need it because `ok` is a plain
 * boolean in this project's non-strict tsconfig, so `if (!result.ok)` does not
 * narrow the union on its own.
 */
export function isCommandRejection(result: CommandResult): result is CommandRejection {
  return result.ok === false;
}

/**
 * Session backed by the in-tab engine. Builds the acting seat's identity from
 * the engine itself: the human civilization, the current round, and a
 * per-session sequence counter that makes a retried command identifiable.
 */
export function createLocalSession(engine: GameEngine): GameSession {
  let seq = 0;

  const actingContext = (): CommandContext => {
    const humanCiv = engine.civilizations?.find((civ) => civ.isHuman);
    return {
      actorId: humanCiv?.id ?? HUMAN_PLAYER_ID,
      turn: engine.currentTurn ?? 1,
      seq: ++seq,
    };
  };

  return {
    send(command: Command): Promise<CommandResult> {
      // The local engine is synchronous and its methods already return results
      // rather than throwing; a remote transport would be the only reason for
      // a real rejection here.
      try {
        return Promise.resolve(engine.submit(command, actingContext()));
      } catch (error) {
        console.error('[session] command failed', command.type, error);
        return Promise.resolve({ ok: false, reason: 'ILLEGAL', details: String(error) });
      }
    },
  };
}
