import type { ProductionItem } from './game';

/**
 * COMMAND LAYER — the typed protocol between the UI and the game engine.
 *
 * The UI never calls engine methods directly. It sends a `Command` to a
 * `GameSession`, which attaches the acting seat's identity (`CommandContext`)
 * and hands it to `GameEngine.submit()`. That function authorises the seat
 * (turn + ownership) and then delegates to the existing rules engine, so the
 * rules stay in one place and the transport (local engine today, a socket
 * tomorrow) can change without the UI noticing.
 *
 * Rules:
 *  - A command is plain, JSON-serializable data. No callbacks, no engine refs.
 *  - `CommandContext` is built by the session from the live connection, never
 *    taken from the payload — a command may not assert who it belongs to.
 *  - Every command ends in exactly one outcome: accepted (with the engine's
 *    own result) or rejected (with a machine-readable reason).
 */

/** Outcome of a `MOVE_UNIT` command as reported by the engine's move rules. */
interface MoveCommandOutcome {
  success: boolean;
  reason?: string;
  /** True when the move resolved as combat instead of a walk. */
  combat?: boolean;
  gold?: number;
  science?: number;
}

/** Outcome of a `SET_CITY_PRODUCTION` command (tech gate, duplicates, …). */
interface ProductionCommandOutcome {
  success: boolean;
  reason?: string;
}

/**
 * Identity of the acting seat for one command. `turn` is the round the sender
 * believed it was acting in, `seq` a per-actor monotonic counter that makes
 * retries idempotent.
 */
export interface CommandContext {
  actorId: number;
  turn: number;
  seq: number;
}

/** One player intent. One command = one action — never bundle several. */
export type Command =
  | { type: 'MOVE_UNIT'; unitId: string; col: number; row: number }
  | { type: 'SET_RATES'; tax: number; science: number; luxury: number }
  | {
      type: 'SET_CITY_PRODUCTION';
      cityId: string;
      item: ProductionItem;
      /** Append to the build queue instead of replacing the current item. */
      queue?: boolean;
    }
  | { type: 'FOUND_CITY'; settlerId: string };

/** Why the authority refused a command. Exhaustive, machine-readable. */
type CommandRejectionReason =
  /** Not the acting seat's turn, or the command carries a stale round number. */
  | 'NOT_YOUR_TURN'
  /** The acting seat has no civilization in this game. */
  | 'CIV_NOT_FOUND'
  /** The subject does not exist (or is already gone). */
  | 'UNIT_NOT_FOUND'
  | 'CITY_NOT_FOUND'
  /** The subject exists but belongs to somebody else. */
  | 'NOT_YOUR_UNIT'
  | 'NOT_YOUR_CITY'
  /** The command type is not part of the protocol. */
  | 'UNKNOWN_COMMAND'
  /** The engine refused it while applying (defensive — rules reject inline). */
  | 'ILLEGAL';

/** The authority refused the command. Named so callers can type-guard it. */
export type CommandRejection = {
  ok: false;
  reason: CommandRejectionReason;
  details?: string;
};

export type CommandResult =
  | { ok: true; command: 'MOVE_UNIT'; move: MoveCommandOutcome }
  | { ok: true; command: 'SET_RATES' }
  | { ok: true; command: 'SET_CITY_PRODUCTION'; production: ProductionCommandOutcome }
  | { ok: true; command: 'FOUND_CITY'; founded: boolean }
  | CommandRejection;
