/**
 * InfrastructurePlanner — how much public works a city still needs.
 *
 * Infrastructure in this engine is not bought with gold: a tile improvement
 * costs *worker-turns*, and only a settler can spend them (`canBuildImprovement`
 * rejects anything that is not a settler). The gold therefore shows up one step
 * later — a settler costs 40 — and that is the link this planner closes: an
 * unimproved city needs settlers, settlers cost gold, and that gold is what a
 * building sale can free.
 *
 * ## How much a city needs
 * A small city does not need public works; its few tiles are worked as they
 * are. The requirement appears above size 6 and is complete at size 12, where
 * *every* buildable tile around the city should carry an improvement — that is
 * the point at which the tile base, not the citizen count, is the limit.
 *
 * ## Why attack stops the plan
 * Settlers are the softest unit in the game (1 defence, and a capture costs a
 * city) and they stand still in the open for turns at a time. Under constant
 * raiding the same settler can be killed before the tile it was building on
 * pays off, so a city under pressure is told to buy defence first and comes
 * back to its roads later. The planner reports the risk rather than silently
 * shrinking the plan, so the caller can log why it declined to spend.
 */

import {
  IMPROVEMENT_PROPERTIES,
  IMPROVEMENT_REQUIREMENTS,
  IMPROVEMENT_TYPES,
} from '@/data/TileImprovementConstants';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

/** The settler is the one unit that can work a tile. */
const SETTLER_TYPE = 'settler';

/** Cost of the only unit that can build an improvement. */
export const SETTLER_BUILD_COST = UNIT_PROPERTIES[SETTLER_TYPE]?.cost ?? 40;

/** Tile types no settler can work. */
const WATER_TERRAINS: ReadonlySet<string> = new Set([
  TERRAIN_TYPES.OCEAN,
  TERRAIN_TYPES.LAKE,
]);

/**
 * A city needs no public works at or below this size — it can work the tiles it
 * has as they stand. Above it, the requirement climbs.
 */
export const INFRASTRUCTURE_POP_THRESHOLD = 6;

/**
 * At this size every buildable tile around the city should be improved. Between
 * the two thresholds the requirement scales with how many tiles there are.
 */
export const INFRASTRUCTURE_FULL_COVERAGE_POP = 12;

/** How far from a city its tiles count as "around it" (Chebyshev). */
export const INFRASTRUCTURE_RADIUS = 2;

/** How much of the plan is attempted at partial coverage. */
const PARTIAL_COVERAGE = 0.5;

/** Settlers the plan may ask for, however big the deficit. */
const MAX_SETTLERS = 3;

export type InfrastructureThreat = 'none' | 'raiders' | 'besieged';

export interface InfrastructureTile {
  col: number;
  row: number;
  terrain: string;
  improvement?: string;
  /** Civilization that owns the tile, when it is not ours. */
  ownedBy?: number;
}

export interface InfrastructureContext {
  civilizationId: number;
  technologies: ReadonlySet<string>;
  /** True when food is what actually limits the city. */
  isFoodConstrained: boolean;
  /** True when the civ is at war and wants shields rather than granaries. */
  isAtWar: boolean;
  /** Enemy units within `RAIDER_RADIUS` of the city. */
  raidersNearby: number;
  /** An enemy army group is marching onto the city. */
  underAssault: boolean;
  /**
   * Whether fresh water is in reach of this tile, i.e. whether irrigation could
   * actually be built on it. Omitted when the caller cannot answer, in which
   * case irrigation is assumed possible — the engine has the last word anyway.
   */
  hasIrrigationSupply?: (col: number, row: number) => boolean;
}

export interface InfrastructureDemand {
  cityId: string;
  cityName: string;
  population: number;
  /** Tiles around the city that accept some improvement. */
  buildableTiles: number;
  /** How many of those should carry one at this city's size. */
  requiredTiles: number;
  /** How many already do. */
  currentTiles: number;
  /** requiredTiles − currentTiles, never below zero. */
  deficit: number;
  /** Worker-turns still to be spent on the chosen tiles. */
  workerTurnsNeeded: number;
  /** Settlers the plan wants, to close the gap in reasonable time. */
  settlersNeeded: number;
  /** What those settlers cost. */
  goldNeeded: number;
  threat: InfrastructureThreat;
  /**
   * Whether the AI should spend on this now. False while the city is under
   * attack: the settlers would simply be targets.
   */
  wantsInfrastructure: boolean;
  /** The tiles worth building on, best first, for a settler to walk to. */
  targets: Array<{ col: number; row: number; improvement: string; workerTurns: number }>;
  reasons: string[];
}

const chebyshev = (c1: number, r1: number, c2: number, r2: number): number =>
  Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

/** Would this improvement ever be legal on this terrain, ignoring water/fresh? */
function improvementAllowed(type: string, terrain: string): boolean {
  const props = IMPROVEMENT_PROPERTIES[type];
  if (!props) return false;
  if (WATER_TERRAINS.has(terrain)) return false;
  if (props.turnsByTerrain) return props.turnsByTerrain[terrain] !== undefined;
  if (props.terrainRestrictions) return props.terrainRestrictions.includes(terrain);
  return true;
}

/**
 * The improvement this tile still wants, best first.
 *
 * Irrigation is preferred when the city is food-bound because it is the only
 * improvement that grows the city (+1 food per tile); mining is preferred at
 * war (+3 production on hills is the fastest shield income in the game); a road
 * is otherwise the default because it is +1 trade on the fertile belt, which
 * is gold. Railroad replaces a road once the tech exists.
 */
function bestImprovementForTile(
  tile: InfrastructureTile,
  ctx: InfrastructureContext,
): { improvement: string; workerTurns: number } | null {
  const candidates: string[] = [];

  // Irrigation is the only candidate the engine can refuse for a reason that
  // has nothing to do with terrain or tech: no water. Asking first saves the
  // settler a wasted trip across the map.
  const canIrrigate = ctx.hasIrrigationSupply
    ? ctx.hasIrrigationSupply(tile.col, tile.row)
    : true;

  if (ctx.isFoodConstrained && canIrrigate && improvementAllowed(IMPROVEMENT_TYPES.IRRIGATION, tile.terrain)) {
    candidates.push(IMPROVEMENT_TYPES.IRRIGATION);
  }
  if (ctx.isAtWar && improvementAllowed(IMPROVEMENT_TYPES.MINES, tile.terrain)) {
    candidates.push(IMPROVEMENT_TYPES.MINES);
  }
  if (canIrrigate && improvementAllowed(IMPROVEMENT_TYPES.IRRIGATION, tile.terrain)) {
    candidates.push(IMPROVEMENT_TYPES.IRRIGATION);
  }
  if (improvementAllowed(IMPROVEMENT_TYPES.MINES, tile.terrain)) {
    candidates.push(IMPROVEMENT_TYPES.MINES);
  }
  // Rail is an upgrade of a road the tile already has.
  if (
    tile.improvement === IMPROVEMENT_TYPES.ROAD &&
    ctx.technologies.has('railroad') &&
    improvementAllowed(IMPROVEMENT_TYPES.RAILROAD, tile.terrain)
  ) {
    candidates.push(IMPROVEMENT_TYPES.RAILROAD);
  }
  if (!tile.improvement && improvementAllowed(IMPROVEMENT_TYPES.ROAD, tile.terrain)) {
    candidates.push(IMPROVEMENT_TYPES.ROAD);
  }

  for (const type of candidates) {
    const props = IMPROVEMENT_PROPERTIES[type];
    if (!props) continue;
    if (props.requiredTech && !ctx.technologies.has(props.requiredTech)) continue;

    // Mirrors the engine's own buildability rule: a tile that already carries
    // an improvement can only take another one if it TRANSFORMS the terrain
    // (irrigating jungle, mining grassland) or is a rail upgrade of its road.
    // Suggesting irrigation on a roaded tile would send a settler to a tile the
    // engine then refuses.
    if (tile.improvement) {
      const transformsTerrain =
        !!props.convertsToByTerrain && tile.terrain in props.convertsToByTerrain;
      const isUpgrade = (IMPROVEMENT_REQUIREMENTS as Record<string, string>)[type] === tile.improvement;
      if (!transformsTerrain && !isUpgrade) continue;
    }

    const requiredBase = (IMPROVEMENT_REQUIREMENTS as Record<string, string>)[type];
    if (requiredBase && tile.improvement !== requiredBase) continue;
    const workerTurns = props.turnsByTerrain?.[tile.terrain] ?? props.turns ?? 1;
    return { improvement: type, workerTurns };
  }
  return null;
}

/** How many tiles around a city of this size should carry an improvement. */
export function requiredImprovementTiles(population: number, buildableTiles: number): number {
  if (buildableTiles <= 0) return 0;
  if (population <= INFRASTRUCTURE_POP_THRESHOLD) return 0;
  if (population >= INFRASTRUCTURE_FULL_COVERAGE_POP) return buildableTiles;
  return Math.ceil(buildableTiles * PARTIAL_COVERAGE);
}

/**
 * What public works does this city still need, and what would it cost to get
 * them? Pure — the caller supplies the tiles and the situation.
 */
export function planCityInfrastructure(
  city: { id: string; name: string; population: number; col: number; row: number },
  tiles: readonly InfrastructureTile[],
  ctx: InfrastructureContext,
): InfrastructureDemand {
  const reasons: string[] = [];

  // Only our own land, and only inside the city's tile ring.
  const owned = tiles.filter(
    t => t.ownedBy === undefined || t.ownedBy === ctx.civilizationId,
  );
  const nearby = owned.filter(
    t => chebyshev(t.col, t.row, city.col, city.row) <= INFRASTRUCTURE_RADIUS,
  );

  // A tile counts as buildable when at least one improvement is legal on it.
  const workable = nearby.filter(t =>
    bestImprovementForTile(t, ctx) !== null || !!t.improvement,
  );
  const buildableTiles = nearby.filter(t => bestImprovementForTile(t, ctx) !== null).length;

  const requiredTiles = requiredImprovementTiles(city.population, buildableTiles);
  const currentTiles = workable.filter(t => !!t.improvement).length;
  const deficit = Math.max(0, requiredTiles - currentTiles);

  // The tiles worth building on, cheapest first so a settler banked early
  // shows progress; ties broken by distance so it walks to the nearest.
  // A tile that already carries a road still belongs here when the answer is a
  // railroad — upgrading it is the whole point of the late-game plan.
  const targets = workable
    .filter(t => {
      const best = bestImprovementForTile(t, ctx);
      return best !== null && best.improvement !== t.improvement;
    })
    .map(t => {
      const best = bestImprovementForTile(t, ctx)!;
      return { col: t.col, row: t.row, improvement: best.improvement, workerTurns: best.workerTurns };
    })
    .sort((a, b) =>
      a.workerTurns - b.workerTurns ||
      chebyshev(a.col, a.row, city.col, city.row) -
        chebyshev(b.col, b.row, city.col, city.row));

  const workerTurnsNeeded = targets.reduce((sum, t) => sum + t.workerTurns, 0);
  const settlersNeeded = deficit > 0
    ? Math.min(MAX_SETTLERS, Math.max(1, Math.ceil(deficit / 4)))
    : 0;
  const goldNeeded = settlersNeeded * SETTLER_BUILD_COST;

  const threat: InfrastructureThreat =
    ctx.underAssault ? 'besieged' : ctx.raidersNearby > 0 ? 'raiders' : 'none';

  if (city.population <= INFRASTRUCTURE_POP_THRESHOLD) {
    reasons.push(`size ${city.population} — no public works needed yet (over ${INFRASTRUCTURE_POP_THRESHOLD} starts)`);
  } else if (city.population >= INFRASTRUCTURE_FULL_COVERAGE_POP) {
    reasons.push(`size ${city.population} — every buildable tile should be improved`);
  } else {
    reasons.push(`size ${city.population} — ${requiredTiles} of ${buildableTiles} tiles should be improved`);
  }

  if (deficit === 0) reasons.push('already covered');

  let wantsInfrastructure = deficit > 0;
  if (wantsInfrastructure && threat !== 'none') {
    // The whole plan is worker-turns spent by a 1-defence unit standing still
    // in the open. Under attack that is not a build programme, it is a donation.
    wantsInfrastructure = false;
    reasons.push(
      threat === 'besieged'
        ? 'city under assault — settlers would not survive the trip, buy defence first'
        : `${ctx.raidersNearby} raider(s) nearby — settlers are targets, hold the roads until it is safe`,
    );
  }

  return {
    cityId: city.id,
    cityName: city.name,
    population: city.population,
    buildableTiles,
    requiredTiles,
    currentTiles,
    deficit,
    workerTurnsNeeded,
    settlersNeeded,
    goldNeeded,
    threat,
    wantsInfrastructure,
    targets,
    reasons,
  };
}
