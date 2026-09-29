/**
 * Fisher Boat economics — when does a boat actually pay for itself?
 *
 * A deployed boat repeats one fixed cycle:
 *   - fish until the hold is full (FISHER_BOAT_STORAGE turns),
 *   - sail home (ceil(d / movement) turns),
 *   - unload,
 *   - sail back out (ceil(d / movement) turns).
 *
 *     cycleTurns(d)  = FISHER_BOAT_STORAGE + 2 * ceil(d / movement)
 *     catchValue(d)  = FISHER_BOAT_STORAGE * foodPerFish(d)        [food]
 *     foodPerTurn(d) = catchValue(d) / cycleTurns(d)
 *
 * The net also upgrades the tile it sits on: a fish tile pays +1 food to the
 * city working it while a boat keeps a net deployed there. That bonus is only
 * real when the home city can actually work the tile (within CITY_RADIUS and
 * not a excluded corner).
 *
 * Priced in gold-equivalents, the boat is worth building when its per-turn
 * value beats its per-turn cost:
 *
 *     valuePerTurn  = (foodPerTurn(d) + netTileFoodPerTurn) * FOOD_VALUE
 *     upkeepPerTurn = maintenance + cost / PAYBACK_TURNS
 *     netValue      = valuePerTurn - upkeepPerTurn   > 0
 *
 * With the current numbers (food ≈ 2 gold, payload 20 shields amortised over
 * 20 turns + 1 gold upkeep = 2 gold/turn) the equation says:
 *   - a fish tile the city can work is worth it even right next to port,
 *   - a ground 3 tiles out that no city works is NOT worth it (0.6 food/turn),
 *   - a rich ground 8 tiles out IS worth it (18 food / 14 turns),
 *   - anything past ~16 tiles is never worth the round trip.
 */

import { CITY_RADIUS } from './EconomicManager';
import {
  FISHER_BOAT_STORAGE,
  UNIT_PROPERTIES,
  fisherCatchValue,
} from '@/data/UnitConstants';

/** Gold-equivalent value of one food delivered (growth ≈ a taxman's 2 gold). */
export const FISHER_FOOD_VALUE = 2;
/** Turns over which the build cost is amortised when judging the boat. */
export const FISHER_PAYBACK_TURNS = 20;
/** Extra food the city working a netted fish tile gets. */
export const FISHER_NET_TILE_FOOD = 1;

export interface FisherEconomicsOptions {
  movement?: number;
  maintenance?: number;
  cost?: number;
  /** Food/turn the home city gains from the netted tile (0 when out of range). */
  netTileFoodPerTurn?: number;
  foodValue?: number;
  paybackTurns?: number;
}

export interface FisherEconomics {
  /** Chebyshev distance between home city and ground. */
  distance: number;
  /** Fishing + round-trip turns per full catch. */
  cycleTurns: number;
  /** Food delivered per turn over a full cycle. */
  foodPerTurn: number;
  /** Food/turn the net itself adds to the worked tile. */
  netTileFoodPerTurn: number;
  /** Food value in gold-equivalents per turn. */
  valuePerTurn: number;
  /** Maintenance + amortised build cost per turn. */
  upkeepPerTurn: number;
  /** valuePerTurn − upkeepPerTurn. */
  netValuePerTurn: number;
  /** Whether the boat beats its upkeep in this slot. */
  worthwhile: boolean;
}

/** Whether a tile at this offset is inside a city's workable radius. */
export function isTileWorkable(dCol: number, dRow: number): boolean {
  if (Math.abs(dCol) > CITY_RADIUS || Math.abs(dRow) > CITY_RADIUS) return false;
  if (Math.abs(dCol) === CITY_RADIUS && Math.abs(dRow) === CITY_RADIUS) return false;
  return true;
}

/**
 * Evaluate one fishing ground.
 *
 * @param distance - Chebyshev distance from the home city to the fish tile.
 */
export function fisherEconomics(
  distance: number,
  options: FisherEconomicsOptions = {},
): FisherEconomics {
  const d = Math.max(0, Math.floor(distance));
  const props = UNIT_PROPERTIES.fisher_boat;
  const movement = Math.max(1, options.movement ?? props?.movement ?? 2);
  const maintenance = options.maintenance ?? props?.maintenance ?? 1;
  const cost = options.cost ?? props?.cost ?? 20;
  const netTileFoodPerTurn = options.netTileFoodPerTurn ?? 0;
  const foodValue = options.foodValue ?? FISHER_FOOD_VALUE;
  const paybackTurns = Math.max(1, options.paybackTurns ?? FISHER_PAYBACK_TURNS);

  const tripTurnsPerLeg = Math.ceil(d / movement);
  const cycleTurns = FISHER_BOAT_STORAGE + 2 * tripTurnsPerLeg;
  const foodPerTurn = fisherCatchValue(d) / cycleTurns;
  const valuePerTurn = (foodPerTurn + netTileFoodPerTurn) * foodValue;
  const upkeepPerTurn = maintenance + cost / paybackTurns;
  const netValuePerTurn = valuePerTurn - upkeepPerTurn;

  return {
    distance: d,
    cycleTurns,
    foodPerTurn,
    netTileFoodPerTurn,
    valuePerTurn,
    upkeepPerTurn,
    netValuePerTurn,
    worthwhile: netValuePerTurn > 0,
  };
}

/** Food the fish tile itself yields while netted (1) vs unnetted (reduced). */
export function netTileFoodFor(city: { col: number; row: number }, tile: { col: number; row: number }): number {
  return isTileWorkable(tile.col - city.col, tile.row - city.row) ? FISHER_NET_TILE_FOOD : 0;
}

/** Minimal engine surface the ground search needs (keeps this module testable). */
export interface FisherGroundEngine {
  squareGrid?: {
    width?: number;
    height?: number;
    chebyshevDistance(c1: number, r1: number, c2: number, r2: number): number;
  } | null;
  getTileAt?(col: number, row: number): { resource?: string | null } | null | undefined;
  isExploredByPlayer?(civilizationId: number, col: number, row: number): boolean;
}

export interface FishingGround extends FisherEconomics {
  col: number;
  row: number;
}

/**
 * Every explored fish tile with its economics, best net value first (ties by
 * distance). Returns an empty list when the map/grid is not available.
 */
export function evaluateFishingGrounds(
  engine: FisherGroundEngine,
  city: { col: number; row: number; civilizationId: number },
  options: FisherEconomicsOptions = {},
): FishingGround[] {
  const grid = engine.squareGrid;
  if (!grid || typeof engine.getTileAt !== 'function') return [];
  const width = grid.width ?? 0;
  const height = grid.height ?? 0;

  const grounds: FishingGround[] = [];
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const tile = engine.getTileAt(col, row);
      const resource = String((tile as { resource?: string } | null)?.resource ?? '').toLowerCase();
      if (resource !== 'fish') continue;
      if (typeof engine.isExploredByPlayer === 'function'
          && !engine.isExploredByPlayer(city.civilizationId, col, row)) {
        continue;
      }
      const distance = grid.chebyshevDistance(city.col, city.row, col, row);
      grounds.push({
        col,
        row,
        ...fisherEconomics(distance, {
          ...options,
          netTileFoodPerTurn: netTileFoodFor(city, { col, row }),
        }),
      });
    }
  }

  grounds.sort((a, b) =>
    b.netValuePerTurn - a.netValuePerTurn || a.distance - b.distance,
  );
  return grounds;
}

/** Best fishing ground for a city (by net value), or null when there is none. */
export function bestFishingGround(
  engine: FisherGroundEngine,
  city: { col: number; row: number; civilizationId: number },
  options: FisherEconomicsOptions = {},
): FishingGround | null {
  return evaluateFishingGrounds(engine, city, options)[0] ?? null;
}

/** Engine surface needed to judge a whole civilization's fishing value. */
export interface FisherRelevanceEngine extends FisherGroundEngine {
  cities?: Array<{
    col: number;
    row: number;
    civilizationId: number;
    buildings?: unknown[];
  }>;
}

/** Whether a city sits next to navigable water (ocean, sea or river). */
function cityBordersWater(
  engine: FisherGroundEngine,
  city: { col: number; row: number },
): boolean {
  for (let dCol = -1; dCol <= 1; dCol++) {
    for (let dRow = -1; dRow <= 1; dRow++) {
      if (dCol === 0 && dRow === 0) continue;
      const tile = engine.getTileAt?.(city.col + dCol, city.row + dRow) as
        | { type?: string; terrain?: string }
        | null
        | undefined;
      const terrain = String(tile?.type ?? tile?.terrain ?? '').toLowerCase();
      if (terrain === 'ocean' || terrain === 'sea' || terrain === 'river') return true;
    }
  }
  return false;
}

/**
 * How much a Fisher Boat is worth to a civilization right now:
 *  0 — no coastal city has a worthwhile ground (or every one already has a
 *      Harbor that can build the boat),
 *  1 — a ground that just pays for the boat,
 *  2 — a ground clearly better than its upkeep (net value > 1 gold/turn).
 *
 * AIResearch turns this into a priority for the Harbor's prerequisite
 * (Masonry); without it the AI never unlocked the boat at all.
 */
export function fishingRelevanceForCiv(
  engine: FisherRelevanceEngine,
  civilizationId: number,
): number {
  let relevance = 0;
  for (const city of engine.cities ?? []) {
    if (city.civilizationId !== civilizationId) continue;
    if (!cityBordersWater(engine, city)) continue;
    const ownsHarbor = (city.buildings ?? []).some((b) => {
      const id = typeof b === 'string'
        ? b
        : ((b as { id?: string })?.id ?? (b as { type?: string })?.type ?? '');
      return String(id) === 'harbor';
    });
    if (ownsHarbor) continue;
    const ground = bestFishingGround(engine, city);
    if (ground?.worthwhile) {
      relevance = Math.max(relevance, ground.netValuePerTurn > 1 ? 2 : 1);
    }
  }
  return relevance;
}

/** Food per turn helper re-exported for callers that only need the rate. */
export function fisherFoodPerTurn(distance: number, movement = 2): number {
  return fisherEconomics(distance, { movement }).foodPerTurn;
}
