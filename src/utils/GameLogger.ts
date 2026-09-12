/**
 * GameLogger – records every game event (moves, combat, city actions, AI
 * decisions, turn phases) as structured JSON lines and flushes them to the
 * dev server, which persists them to `game-logs/<sessionId>.log`.
 *
 * It is a singleton so the engine hook, AI and UI can all share one buffer.
 * If the dev server is unreachable the lines are kept in memory and can be
 * exported via downloadLog().
 *
 * City state: city-related events (founding, capture, destruction, production,
 * building/unit completion, …) carry the full JSON-safe city snapshot under
 * `detail.city`, and every TURN_START / TURN_END carries the active player's
 * complete city JSONs under `detail.cities` — so the log regularly contains
 * the full city state of every player.
 */

import { serializeCity, isCityEvent, isTurnBoundaryEvent } from './CitySnapshots';
import type { City, Unit } from '../../types/game';

/**
 * Known engine event-payload fields the logger reads to build messages.
 * Payloads are heterogeneous (units, cities, nested objects), so every known
 * field is optional and the index signature keeps arbitrary payloads
 * assignable. Using this instead of `Record<string, unknown>` lets us read
 * typed sub-objects without `any` casts.
 */
interface EventPayload {
  city?: City;
  unit?: Partial<Unit>;
  attacker?: Partial<Unit>;
  defender?: Partial<Unit>;
  item?: { itemType?: string; name?: string; type?: string };
  cities?: City[];
  cityId?: string;
  civilizationId?: number;
  roundNumber?: number;
  phase?: string;
  targetCol?: number;
  targetRow?: number;
  aggressorId?: number;
  targetId?: number;
  targetCivilizationId?: number;
  type?: string;
  taxRate?: number;
  scienceRate?: number;
  luxuryRate?: number;
  civName?: string;
  reason?: string;
  category?: string;
  message?: string;
  [key: string]: unknown;
}

interface GameLogEntry {
  ts: string; // ISO timestamp
  round: number;
  player: number;
  event: string;
  message: string;
  detail: Record<string, unknown>;
}

type ContextFn = () => { round: number; player: number };

class GameLogger {
  private sessionId: string | null = null;
  private pending: GameLogEntry[] = [];
  private context: ContextFn = () => ({ round: 0, player: 0 });
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private serverUnreachable = false;

  /** Start a named session (resets the buffer). */
  setSession(id: string): void {
    this.sessionId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    this.pending = [];
    this.serverUnreachable = false;
  }

  /** Provide the current round/player read from the live engine. */
  setContext(fn: ContextFn): void {
    this.context = fn;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  /**
   * Record a structured log line. `event` is the engine event name (or a
   * synthetic category like 'ai'), `message` a human-readable description.
   */
  log(event: string, message: string, detail: Record<string, unknown> = {}): GameLogEntry {
    const { round, player } = this.context();
    const entry: GameLogEntry = {
      ts: new Date().toISOString(),
      round,
      player,
      event,
      message,
      detail,
    };
    this.pending.push(entry);
    // Cap the pending buffer to prevent unbounded growth when server is unreachable
    if (this.pending.length > 500) {
      this.pending.splice(0, this.pending.length - 500);
    }
    this.scheduleFlush();
    return entry;
  }

  /**
   * Format and record a raw engine event (used as the onStateChange tap).
   * Event payloads are heterogeneous (units, cities, nested objects) and are
   * emitted by the engine's untyped event system; typing every shape here
   * would be a large refactor, so the payload is deliberately `any`.
   */
  record(event: string, data: Record<string, unknown> = {}): void {
    const message = this.formatMessage(event, data as EventPayload);
    if (message) {
      const detail: Record<string, unknown> = { data: this.sanitize(data) };
      // Attach the full JSON-safe city snapshot on city-related events so the
      // log regularly contains the complete city state, not just a summary.
      if (isCityEvent(event) && data?.city) {
        detail.city = serializeCity(data.city as City);
      }
      // Turn boundaries carry the active player's full city JSONs (attached by
      // the TurnManager), giving a regular per-player city snapshot in the log.
      if (isTurnBoundaryEvent(event) && Array.isArray(data?.cities)) {
        detail.cities = data.cities;
      }
      this.log(event, message, detail);
    }
  }

  /** Human-readable message for known engine events. */
  private formatMessage(event: string, data: EventPayload): string | null {
    switch (event) {
      case 'TURN_START':
        return `▶ Turn start — civ ${data.civilizationId} (round ${data.roundNumber})`;
      case 'PHASE_CHANGE':
        return `  phase → ${data.phase} (civ ${data.civilizationId})`;
      case 'TURN_END':
        return `■ Turn end — civ ${data.civilizationId} (round ${data.roundNumber})`;
      case 'UNIT_MOVED':
        return `Move: ${data.unit?.type}(${data.unit?.id}) → (${data.targetCol},${data.targetRow})`;
      case 'COMBAT_VICTORY':
        return `⚔ Combat: ${data.attacker?.type} defeated ${data.defender?.type} at (${data.defender?.col},${data.defender?.row})`;
      case 'COMBAT_DEFEAT':
        return `⚔ Combat: ${data.attacker?.type} was defeated by ${data.defender?.type}`;
      case 'COMBAT_HIT':
        return `⚔ Combat: ${data.attacker?.type} wounded ${data.defender?.type} (not enough power to overrun)`;
      case 'UNIT_DEFEATED':
        return `✝ Unit defeated: ${data.unit?.type}(${data.unit?.id})`;
      case 'CITY_FOUNDED':
        return `🏙 City founded: ${data.city?.name} at (${data.city?.col},${data.city?.row})`;
      case 'CITY_CAPTURED':
        return `🚩 City captured: ${data.city?.name} (civ ${data.city?.civilizationId})`;
      case 'UNIT_SKIPPED':
        return `Skip: ${data.unit?.type}(${data.unit?.id})`;
      case 'UNIT_SLEPT':
        return `Sleep: ${data.unit?.type}(${data.unit?.id})`;
      case 'UNIT_FORTIFIED':
        return `Fortify: ${data.unit?.type}(${data.unit?.id})`;
      case 'UNIT_PRODUCED':
        return `🏭 Produced unit: ${data.unit?.type} at ${data.cityId}`;
      case 'BUILDING_COMPLETED':
        return `🏗 Building completed at ${data.cityId}`;
      case 'CITY_PRODUCTION_CHANGED':
        return `Production @ ${data.cityId}: ${data.item?.itemType ?? data.item?.name ?? data.item ?? ''}`;
      case 'RESEARCH_PHASE':
        return `🔬 Research phase — civ ${data.civilizationId}`;
      case 'WAR_DECLARED':
        return `☠ WAR DECLARED: civ ${data.aggressorId ?? data.civilizationId} vs civ ${data.targetId ?? data.targetCivilizationId}`;
      case 'CITY_DESTROYED':
        return `💥💥💥 City destroyed 💥💥💥: ${data.city?.name} (was civ ${data.city?.civilizationId})`;
      case 'CITY_ATTACKED':
        return `💥 City attacked: ${data.city?.name} by ${data.attacker?.type}`;
      case 'CITY_DISORDER':
        return `🚨 City in disorder: ${data.city?.name} (production & growth halted)`;
      case 'UNIT_DISBANDED':
        return `✝ Unit disbanded (upkeep deficit): ${data.unit?.type}(${data.unit?.id})`;
      case 'RATES_CHANGED':
        return `📊 Rates — civ ${data.civilizationId}: Tax ${data.taxRate ?? 0}% / Science ${data.scienceRate ?? 0}% / Luxury ${data.luxuryRate ?? 0}%`;
      case 'DIPLOMACY_EVENT':
        return `🤝 Diplomacy: ${data.type ?? ''} civ ${data.civilizationId}`;
      case 'AI_FINISHED':
        return `🤖 AI turn finished — civ ${data.civilizationId}`;
      case 'GAME_WON':
        return `🏆 GAME WON by ${data.civName} (${data.reason})`;
      case 'GAME_LOST':
        return `💀 GAME LOST by ${data.civName} (${data.reason})`;
      case 'GAME_LOG':
        return `[${data.category ?? 'log'}] ${data.message ?? ''}`;
      default:
        return null; // skip uninteresting events
    }
  }

  /**
   * Keep detail payloads small & JSON-safe. Accepts any engine event payload
   * and returns a plain serialisable record.
   */
  private sanitize(data: unknown, depth = 0): unknown {
    if (data == null) return data;
    if (typeof data !== 'object') return data;
    // Preserve the structured unit/combat fields needed by AI analysis. The
    // previous key-only placeholders made grouping failures by unit type
    // impossible in exported logs.
    if (depth > 2) return '{' + Object.keys(data).join(',') + '}';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v == null) continue;
      if (['number', 'string', 'boolean'].includes(typeof v)) {
        out[k] = v;
      } else if (Array.isArray(v)) {
        if (v.length <= 8 && v.every((item) => item == null || ['number', 'string', 'boolean'].includes(typeof item))) {
          out[k] = v;
        } else {
          out[k] = '[array:' + v.length + ']';
        }
      } else if (typeof v === 'object') {
        const keys = Object.keys(v);
        const usefulKeys = ['id', 'type', 'itemType', 'name', 'civilizationId', 'col', 'row',
          'targetCol', 'targetRow', 'fromCol', 'fromRow', 'toCol', 'toRow', 'health',
          'movesRemaining', 'attack', 'defense', 'attackerWinChance', 'attackStrength',
          'defenseStrength', 'reason', 'action', 'strategy', 'tech', 'improvement'];
        const projected: Record<string, unknown> = {};
        for (const key of usefulKeys) {
          if (Object.prototype.hasOwnProperty.call(v, key)) {
            const value = (v as Record<string, unknown>)[key];
            if (value == null || ['number', 'string', 'boolean'].includes(typeof value)) {
              projected[key] = value;
            }
          }
        }
        out[k] = Object.keys(projected).length > 0
          ? projected
          : '{' + keys.join(',') + '}';
      }
    }
    return out;
  }

  private scheduleFlush(): void {
    if (this.flushTimer || !this.sessionId) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 400);
  }

  async flush(): Promise<void> {
    if (!this.sessionId || this.pending.length === 0) return;
    if (this.serverUnreachable) return; // keep in memory, avoid retry spam
    const batch = this.pending.splice(0, this.pending.length);
    try {
      const res = await fetch('/__game_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, lines: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      this.serverUnreachable = true;
      // Keep the batch so it is not lost silently.
      this.pending.unshift(...batch);
      console.warn('[GameLogger] dev-server log endpoint unreachable:', err);
    }
  }

  /** Trigger a flush immediately (e.g. before a page reload). */
  async flushNow(): Promise<void> {
    await this.flush();
  }

  /**
   * Return the full session log: the lines persisted by the dev server merged
   * with any lines still buffered in memory (deduped by ts/event/message).
   * Falls back to the in-memory buffer when the server is unreachable.
   */
  async getAllEntries(): Promise<GameLogEntry[]> {
    const merged = new Map<string, GameLogEntry>();
    for (const e of this.pending) {
      merged.set(`${e.ts}|${e.event}|${e.message}`, e);
    }
    if (this.sessionId && !this.serverUnreachable) {
      try {
        const res = await fetch(`/__game_log?session=${encodeURIComponent(this.sessionId)}`);
        if (res.ok) {
          const entries = await res.json();
          if (Array.isArray(entries)) {
            for (const e of entries) {
              if (e && typeof e === 'object' && typeof e.ts === 'string') {
                merged.set(`${e.ts}|${e.event}|${e.message}`, e as GameLogEntry);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[GameLogger] could not fetch full session log:', err);
      }
    }
    return [...merged.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /** Download the in-memory buffer as a file (fallback when no server). */
  downloadLog(filename = 'game-log.jsonl'): void {
    const blob = new Blob(
      this.pending.map((l) => JSON.stringify(l) + '\n'),
      { type: 'application/x-ndjson' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const gameLogger = new GameLogger();
