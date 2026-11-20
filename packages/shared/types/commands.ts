import type { ProductionItem } from './game';
import type { DiplomatActionResult } from '../game/engine/DiplomacyTypes';

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
 * One player intent that maps to a single engine method with a boolean-ish
 * outcome. The transport only needs to know whether it applied and, if not,
 * why — the engine remains the single source of the actual rules.
 */
export type SimpleCommandName =
  | 'FORTIFY_UNIT'
  | 'UNFORTIFY_UNIT'
  | 'SLEEP_UNIT'
  | 'WAKE_UNIT'
  | 'SKIP_UNIT'
  | 'DISBAND_UNIT'
  | 'BUILD_IMPROVEMENT'
  | 'SET_RESEARCH'
  | 'DEPLOY_FISHING_NET'
  | 'RECALL_FISHING_BOAT'
  | 'CLEAR_TRADE_ROUTE'
  | 'PROMOTE_SPECIALIST'
  | 'DEMOTE_SPECIALIST'
  | 'CONVERT_TILE_SPECIALIST';

export interface SimpleCommandOutcome {
  ok: true;
  command: SimpleCommandName;
  applied: boolean;
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
  | { type: 'FOUND_CITY'; settlerId: string }
  | { type: 'TEAM_COORDINATE_ATTACK'; col: number; row: number }
  | { type: 'TEAM_DEFEND_CITY'; cityId: string }
  // Unit orders
  | { type: 'FORTIFY_UNIT'; unitId: string }
  | { type: 'UNFORTIFY_UNIT'; unitId: string }
  | { type: 'SLEEP_UNIT'; unitId: string }
  | { type: 'WAKE_UNIT'; unitId: string }
  | { type: 'SKIP_UNIT'; unitId: string }
  | { type: 'DISBAND_UNIT'; unitId: string }
  | { type: 'BUILD_IMPROVEMENT'; unitId: string; improvement: string }
  | { type: 'DEPLOY_FISHING_NET'; unitId: string }
  | { type: 'RECALL_FISHING_BOAT'; unitId: string }
  | { type: 'ESTABLISH_TRADE_ROUTE'; unitId: string }
  | { type: 'CLEAR_TRADE_ROUTE'; unitId: string }
  | { type: 'EXECUTE_DIPLOMAT_ACTION'; unitId: string; targetCivId: number; action: string }
  // City / empire orders
  | { type: 'SET_RESEARCH'; civId: number; techId: string; savedProgress?: number }
  | { type: 'PROMOTE_SPECIALIST'; cityId: string; specialistType: string }
  | { type: 'DEMOTE_SPECIALIST'; cityId: string; specialistIndex: number }
  | {
      type: 'CONVERT_TILE_SPECIALIST';
      cityId: string;
      col: number;
      row: number;
      specialistType: string | null;
    }
  // Production queue
  | { type: 'PURCHASE_PRODUCTION'; cityId: string; item: ProductionItem }
  | { type: 'REMOVE_QUEUE_ITEM'; cityId: string; index: number }
  | { type: 'MOVE_QUEUE_ITEM'; cityId: string; fromIndex: number; toIndex: number }
  | { type: 'PROMOTE_QUEUE_ITEM'; cityId: string; index: number }
  | { type: 'MOVE_CURRENT_PRODUCTION_DOWN'; cityId: string };

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
  /** A command with this seat/seq was already handled (possibly by another worker). */
  | 'STALE_COMMAND'
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
  | { ok: true; command: 'TEAM_COORDINATE_ATTACK' }
  | { ok: true; command: 'TEAM_DEFEND_CITY' }
  | SimpleCommandOutcome
  | {
      ok: true;
      command: 'PURCHASE_PRODUCTION' | 'REMOVE_QUEUE_ITEM' | 'MOVE_QUEUE_ITEM'
        | 'PROMOTE_QUEUE_ITEM' | 'MOVE_CURRENT_PRODUCTION_DOWN';
      production: ProductionCommandOutcome;
    }
  | { ok: true; command: 'ESTABLISH_TRADE_ROUTE'; result: { success: boolean; gold?: number; reason?: string } }
  | { ok: true; command: 'EXECUTE_DIPLOMAT_ACTION'; result: DiplomatActionResult }
  | CommandRejection;
