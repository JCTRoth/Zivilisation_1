import type { OutboundEvent } from './fog';

/**
 * Turn an engine event into a wire event with enough metadata for per-seat
 * filtering. Classification is a server responsibility: the client never
 * decides what it is allowed to see.
 */

export type EventScope = 'universal' | 'seat' | 'location';

/** Explicit rules for the event types the wire cares about. */
const EVENT_RULES: Record<string, EventScope> = {
  // Public state transitions — every seat sees them.
  TURN_START: 'universal',
  TURN_END: 'universal',
  PHASE_CHANGE: 'universal',
  AI_FINISHED: 'universal',
  GAME_SAVED: 'universal',
  GAME_LOADED: 'universal',
  WAR_DECLARED: 'universal',
  PEACE_TREATY: 'universal',
  VICTORY: 'universal',
  // Private information — only the named seat receives it.
  AI_DIPLOMACY_OFFER: 'seat',
  DIPLOMACY_OFFER: 'seat',
  DIPLOMACY_RESPONSE: 'seat',
  ESPIONAGE_RESULT: 'seat',
  INTELLIGENCE_REPORT: 'seat',
  NOMAD_PARLEY: 'seat',
  NOMAD_CITY_OFFER: 'seat',
  BRIBE_RESULT: 'seat',
  PLAYER_REGISTERED: 'seat',
  HANDOFF: 'seat',
  RESEARCH_COMPLETE: 'seat',
  NOTIFICATION: 'seat',
  // Anything on the map is visible only where that seat's fog allows.
  COMBAT_HIT: 'location',
  COMBAT_VICTORY: 'location',
  COMBAT_DEFEAT: 'location',
  COMBAT_SPLASH: 'location',
  CITY_COMBAT: 'location',
  CITY_FOUND: 'location',
  CITY_CAPTURED: 'location',
  UNIT_DEFEATED: 'location',
  UNIT_REMOVED: 'location',
  UNIT_MOVED: 'location',
  VILLAGE_RESULT: 'location',
};

function ownerOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  // For an offer the recipient is the seat that must see it, not the sender.
  const raw = obj.toCivId ?? obj.civId ?? obj.civilizationId ?? obj.playerId ?? obj.viewerId;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function locationOf(value: unknown): { col: number; row: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const unit = obj.unit as Record<string, unknown> | undefined;
  const city = obj.city as Record<string, unknown> | undefined;
  const source = obj.col !== undefined ? obj : unit ?? city;
  if (!source) return undefined;
  const col = Number(source.col);
  const row = Number(source.row);
  return Number.isFinite(col) && Number.isFinite(row) ? { col, row } : undefined;
}

export function classifyEvent(type: string, data: unknown): OutboundEvent {
  const record = (data ?? {}) as Record<string, unknown>;
  const scope: EventScope = EVENT_RULES[type]
    ?? (locationOf(data) ? 'location' : ownerOf(data) !== undefined ? 'seat' : 'universal');
  const civId = ownerOf(record) ?? ownerOf(record.unit) ?? ownerOf(record.city);
  const location = locationOf(data);
  return {
    type,
    payload: data ?? null,
    scope,
    civId,
    col: location?.col,
    row: location?.row,
    seatOnly: scope === 'seat',
  };
}
