import type { Unit, City, Civilization } from './game';

/**
 * Wire format for events the authority pushes to seats. Shared so the web
 * client can type its event stream without importing the server package.
 */
export interface OutboundEvent {
  /** Per-room monotonic sequence, assigned by the authority before fan-out. */
  seq?: number;
  type: string;
  payload: unknown;
  /** Owning seat, when the event is about one civilization. */
  civId?: number;
  /** Location of the subject, when the event happens on the map. */
  col?: number;
  row?: number;
  /** Never broadcast beyond the owning seat. */
  seatOnly?: boolean;
  /** Classification rule used for this event. */
  scope?: 'universal' | 'seat' | 'location';
}

/** Fields carried by every event on the wire. */
type EventBase = Pick<OutboundEvent, 'civId' | 'col' | 'row' | 'seatOnly' | 'scope'>;

/** Payloads the client knows how to apply incrementally. */
interface ProjectablePayloads {
  TURN_START: { currentTurn?: number; civilizationId?: number; playerId?: number };
  TURN_END: { currentTurn?: number; civilizationId?: number };
  UNIT_MOVED: { unit: Partial<Unit> & { id: string } };
  UNIT_CREATED: { unit: Partial<Unit> & { id: string } };
  UNIT_DEFEATED: { unit: Partial<Unit> & { id: string } };
  UNIT_REMOVED: { unit: { id: string } };
  CITY_FOUND: { city: Partial<City> & { id: string } };
  CITY_CAPTURED: { city: Partial<City> & { id: string } };
  CITY_UPDATED: { city: Partial<City> & { id: string } };
  CIVILIZATION_UPDATED: { civilization: Partial<Civilization> & { id: number } };
  RESEARCH_COMPLETE: { civilization: Partial<Civilization> & { id: number } };
  COMBAT_HIT: { attacker: Partial<Unit> & { id: string }; defender: Partial<Unit> & { id: string } };
  COMBAT_VICTORY: { attacker: Partial<Unit> & { id: string }; defender: Partial<Unit> & { id: string } };
  VILLAGE_RESULT: { civId: number; goldAmount?: number; techId?: string };
  PHASE_CHANGE: { civilizationId?: number; phase?: string };
  NOTIFICATION: { message?: string; kind?: 'info' | 'success' | 'warning' | 'error'; civId?: number };
}

export type ProjectableEvent = {
  [K in keyof ProjectablePayloads]: EventBase & { type: K; payload: ProjectablePayloads[K] };
}[keyof ProjectablePayloads];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/**
 * Runtime type guard for the events the incremental projection understands.
 * Returns null for the long tail, which the client handles via a snapshot.
 */
export function asProjectableEvent(event: OutboundEvent): ProjectableEvent | null {
  const data = record(event.payload);
  const base: EventBase = {
    civId: event.civId, col: event.col, row: event.row,
    seatOnly: event.seatOnly, scope: event.scope,
  };
  const hasEntity = (key: string, id: 'string' | 'number') => {
    const entity = record(data[key]);
    return typeof entity.id === id;
  };

  switch (event.type) {
    case 'TURN_START':
    case 'TURN_END':
      return { ...base, type: event.type, payload: data as ProjectablePayloads['TURN_START'] };
    case 'UNIT_MOVED':
    case 'UNIT_CREATED':
    case 'UNIT_DEFEATED':
      return hasEntity('unit', 'string')
        ? { ...base, type: event.type, payload: data as ProjectablePayloads['UNIT_MOVED'] }
        : null;
    case 'UNIT_REMOVED':
      return hasEntity('unit', 'string')
        ? { ...base, type: 'UNIT_REMOVED', payload: data as ProjectablePayloads['UNIT_REMOVED'] }
        : null;
    case 'CITY_FOUND':
    case 'CITY_CAPTURED':
    case 'CITY_UPDATED':
      return hasEntity('city', 'string')
        ? { ...base, type: event.type, payload: data as ProjectablePayloads['CITY_FOUND'] }
        : null;
    case 'COMBAT_HIT':
    case 'COMBAT_VICTORY':
      return hasEntity('attacker', 'string') && hasEntity('defender', 'string')
        ? { ...base, type: event.type, payload: data as ProjectablePayloads['COMBAT_HIT'] }
        : null;
    case 'VILLAGE_RESULT':
      return typeof data.civId === 'number'
        ? { ...base, type: 'VILLAGE_RESULT', payload: data as ProjectablePayloads['VILLAGE_RESULT'] }
        : null;
    case 'PHASE_CHANGE':
      return typeof data.phase === 'string'
        ? { ...base, type: 'PHASE_CHANGE', payload: data as ProjectablePayloads['PHASE_CHANGE'] }
        : null;
    case 'CIVILIZATION_UPDATED':
    case 'RESEARCH_COMPLETE':
      return hasEntity('civilization', 'number')
        ? { ...base, type: event.type, payload: data as ProjectablePayloads['CIVILIZATION_UPDATED'] }
        : null;
    case 'NOTIFICATION':
      return typeof data.message === 'string'
        ? { ...base, type: 'NOTIFICATION', payload: data as ProjectablePayloads['NOTIFICATION'] }
        : null;
    default:
      return null;
  }
}
