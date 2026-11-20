import type { OutboundEvent } from './fog';

/**
 * Turn an engine event into a wire event with enough metadata for per-seat
 * filtering. The engine emits plain `(type, data)`; classification is a server
 * responsibility so the client never decides what it is allowed to see.
 */

/** Events that must never leave the authority except to the seat concerned. */
export const SEAT_ONLY_EVENTS = new Set([
  'AI_DIPLOMACY_OFFER',
  'DIPLOMACY_OFFER',
  'ESPIONAGE_RESULT',
  'INTELLIGENCE_REPORT',
  'NOMAD_PARLEY',
  'NOMAD_CITY_OFFER',
  'BRIBE_RESULT',
  'PLAYER_REGISTERED',
  'HANDOFF',
]);

function ownerOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const raw = obj.civilizationId ?? obj.civId ?? obj.playerId ?? obj.viewerId;
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
  const civId = ownerOf(record) ?? ownerOf(record.unit) ?? ownerOf(record.city) ?? ownerOf(record.fromCivId !== undefined ? { civId: record.fromCivId } : undefined);
  const location = locationOf(data);
  return {
    type,
    payload: data ?? null,
    civId,
    col: location?.col,
    row: location?.row,
    seatOnly: SEAT_ONLY_EVENTS.has(type),
  };
}
