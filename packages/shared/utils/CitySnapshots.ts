/**
 * Shared helpers to produce JSON-safe snapshots of city objects, used by the
 * game progression exporter (GameProgression) and the game log (GameLogger).
 *
 * Live City objects carry method references (e.g. `processTurn`) that would be
 * dropped silently by JSON.stringify, so the serializable fields are extracted
 * explicitly here.
 */

import type { City, ProductionItem } from '../../types/game';

export interface CitySnapshot {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  hitPoints?: number;
  disorder?: boolean;
  capturedTurns?: number;
  trade?: number;
  production: number;
  food: number;
  gold: number;
  science: number;
  productionProgress?: number;
  buildQueue?: unknown[];
  currentProduction?: unknown;
  carriedOverProgress?: number;
  isCapital?: boolean;
  yields?: { food: number; production: number; trade: number };
  foodStored?: number;
  foodNeeded?: number;
  foodRequired?: number;
  productionStored?: number;
  buildings?: unknown[];
  shields?: number;
  productionQueue?: unknown[];
  autoProduction?: boolean;
  output?: unknown;
}

/** Convert a live City object into a plain JSON-safe snapshot. */
export function serializeCity(city: City): CitySnapshot {
  return {
    id: String(city?.id ?? ''),
    name: city?.name ?? '',
    civilizationId: city?.civilizationId ?? 0,
    col: city?.col ?? 0,
    row: city?.row ?? 0,
    population: city?.population ?? 0,
    hitPoints: city?.hitPoints,
    disorder: city?.disorder,
    capturedTurns: city?.capturedTurns,
    trade: city?.trade,
    production: city?.production ?? 0,
    food: city?.food ?? 0,
    gold: city?.gold ?? 0,
    science: city?.science ?? 0,
    productionProgress: city?.productionProgress,
    buildQueue: city?.buildQueue ? [...city.buildQueue] : undefined,
    currentProduction: city?.currentProduction ?? undefined,
    carriedOverProgress: city?.carriedOverProgress,
    isCapital: city?.isCapital,
    yields: city?.yields ? { ...city.yields } : undefined,
    foodStored: city?.foodStored,
    foodNeeded: city?.foodNeeded,
    foodRequired: city?.foodRequired,
    productionStored: city?.productionStored,
    buildings: city?.buildings ? [...city.buildings] : undefined,
    shields: city?.shields,
    productionQueue: city?.productionQueue ? [...city.productionQueue] : undefined,
    autoProduction: city?.autoProduction,
    output: city?.output,
  };
}

/** Convert an array of live City objects into JSON-safe snapshots. */
export function serializeCities(cities: City[]): CitySnapshot[] {
  return (cities ?? []).map((c) => serializeCity(c));
}

/**
 * Slim city snapshot used by the compact AI-optimised progression export.
 * Redundant / derivable fields are dropped (e.g. `productionProgress` duplicates
 * `productionStored`; item names & costs are game constants reachable via
 * itemType), keeping the per-city growth timeline while minimising size.
 */
export interface CompactCity {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  isCapital?: boolean;
  yields?: { food: number; production: number; trade: number };
  foodStored?: number;
  foodNeeded?: number;
  productionStored?: number;
  /** Current production item (itemType only; name/cost are game constants). */
  currentProduction?: string | null;
  /** Production queue as itemType strings (name/cost are game constants). */
  buildQueue?: string[];
  buildings?: string[];
  autoProduction?: boolean;
}

/** Extract the item id from a queue/current-production entry (object or string). */
function productionItemId(item: string | ProductionItem | null | undefined): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  return String(item.itemType ?? item.type ?? item.name ?? '');
}

/** Convert a live City object into a compact, analysis-focused snapshot. */
export function serializeCityCompact(city: City): CompactCity {
  return {
    id: String(city?.id ?? ''),
    name: city?.name ?? '',
    civilizationId: city?.civilizationId ?? 0,
    col: city?.col ?? 0,
    row: city?.row ?? 0,
    population: city?.population ?? 0,
    isCapital: city?.isCapital,
    yields: city?.yields ? { ...city.yields } : undefined,
    foodStored: city?.foodStored,
    foodNeeded: city?.foodNeeded,
    // productionProgress and productionStored track the same value; keep one.
    productionStored: city?.productionStored ?? city?.productionProgress,
    currentProduction: city?.currentProduction ? productionItemId(city.currentProduction) : undefined,
    buildQueue:
      Array.isArray(city?.buildQueue) && city.buildQueue.length > 0
        ? city.buildQueue.map(productionItemId).filter(Boolean)
        : undefined,
    buildings: city?.buildings ? [...city.buildings] : undefined,
    autoProduction: city?.autoProduction,
  };
}

/** Engine event names whose payload carries a city object. */
const CITY_EVENTS: ReadonlySet<string> = new Set<string>([
  'CITY_FOUNDED',
  'CITY_JOINED',
  'CITY_CAPTURED',
  'CITY_DESTROYED',
  'CITY_ATTACKED',
  'CITY_PRODUCTION_CHANGED',
  'CITY_PRODUCTION_PHASE',
  'CITY_DISORDER',
  'BUILDING_COMPLETED',
  'BUILDING_PURCHASED',
  'UNIT_PRODUCED',
  'UNIT_PURCHASED',
]);

export function isCityEvent(event: string): boolean {
  return CITY_EVENTS.has(event);
}

/** Turn boundary events that should carry the active player's full city JSONs. */
export function isTurnBoundaryEvent(event: string): boolean {
  return event === 'TURN_START' || event === 'TURN_END';
}
