/**
 * BuildingAnalyzer — evaluates which buildings in a city are worth keeping
 * and which are candidates for sale (razing).
 *
 * The AI calls this each turn for each city. The analyzer scores every
 * building based on its contribution to the city's current situation and
 * returns the worst offenders (up to 3) with human-readable reasons.
 *
 * Scoring model:
 *   - Base value ≈ shield cost / 10 (a rough "how much did this cost" proxy).
 *   - Redundancy: 2+ of the same building in one city → value × 0.3.
 *   - Missing prerequisite (bank without marketplace, university without
 *     library, harbor with no water) → value × 0.2.
 *   - Happiness buildings in an unhappy city → value × 2 (keep!).
 *   - Defense buildings in a threatened city → value × 2 (keep!).
 *   - Obsolete (e.g., city walls vs. artillery-age units) → value × 0.1.
 *   - Wonders are never sold (value = Infinity).
 *
 * Buildings scoring below SELL_THRESHOLD are returned as sell candidates.
 */

import type { City, Civilization, Unit, MapState } from '../../../../types/game';
import { HAPPINESS_BUILDINGS as COORDINATOR_HAPPINESS_BUILDINGS } from './BuildingCoordinator';
import { BUILDING_PROPERTIES, BUILDING_TYPES, WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import type { ArmyGroup } from './AITypes';
import { UNIT_PROPERTIES } from '@/utils/Constants';
import {
  evaluateBuildingEconomics,
  isSellableForBudget,
  NUCLEAR_WEAPON_TECH,
  type BuildingEconomics,
  type CityEconomics,
} from './BuildingEconomics';

/** Minimum score below which a building is considered for sale. */
const SELL_THRESHOLD = 1.5;

/** Maximum number of sell recommendations per city per turn. */
const MAX_RECOMMENDATIONS = 3;

/** Buildings that are never sold, no matter how redundant. */
const NEVER_SELL = new Set<string>([
  BUILDING_TYPES.PALACE,
  BUILDING_TYPES.CITY_WALLS, // walls are cheap but strategically vital
]);

/** Buildings that become obsolete when the enemy has gunpowder units. */
const OBSOLETE_WITH_GUNPOWDER = new Set<string>([
  BUILDING_TYPES.CITY_WALLS,
  BUILDING_TYPES.BARRACKS,
]);

/** Buildings that require another BUILDING in the same city to be useful. */
const REQUIRES_BUILDING: Record<string, string[]> = {
  [BUILDING_TYPES.BANK]: [BUILDING_TYPES.MARKETPLACE],
  [BUILDING_TYPES.STOCK_EXCHANGE]: [BUILDING_TYPES.BANK],
  [BUILDING_TYPES.UNIVERSITY]: [BUILDING_TYPES.LIBRARY],
  [BUILDING_TYPES.CATHEDRAL]: [BUILDING_TYPES.TEMPLE],
  [BUILDING_TYPES.AQUEDUCT]: [BUILDING_TYPES.TEMPLE],
};

/**
 * Buildings that provide happiness.
 *
 * Shared with the coordinator rather than restated: this set is also what the
 * "first four in a city count" cap is enforced against, and two lists of the
 * same four building types drifting apart is how a city ends up holding five
 * happiness buildings and paying upkeep on the one that does nothing.
 */
const HAPPINESS_BUILDINGS = COORDINATOR_HAPPINESS_BUILDINGS;

/** Buildings that provide defense. */
const DEFENSE_BUILDINGS = new Set<string>([
  BUILDING_TYPES.CITY_WALLS,
  BUILDING_TYPES.BARRACKS,
  BUILDING_TYPES.SDI_DEFENSE,
]);

/**
 * After a sale the building is off the production menus for this many rounds,
 * so the auditor and auto-production cannot ping-pong the same building
 * (built → sold → rebuilt → sold). The analyzer flags clearly-bad buildings,
 * not marginal ones, so the wait is cheap.
 */
export const BUILDING_REBUY_COOLDOWN_ROUNDS = 40;

/** Minimal engine surface needed to read the sale log. */
interface CooldownEngine {
  getPlayerStorage?: (civilizationId: number) => { turnData?: Record<string, unknown> } | undefined;
  roundManager?: { getRoundNumber?: () => number } | null;
}

/**
 * Whether a building this civ sold recently must not be rebuilt yet. Read by
 * AutoProduction before offering a building plan; a stale entry ages out of
 * the window and is ignored (no cleanup needed).
 */
export function buildingOnRebuyCooldown(
  engine: CooldownEngine,
  civilizationId: number,
  buildingType: string,
): boolean {
  const storage = engine.getPlayerStorage?.(civilizationId);
  const soldAt = storage?.turnData?.soldBuildings as Record<string, number> | undefined;
  const when = soldAt?.[buildingType];
  if (typeof when !== 'number') return false;
  const now = engine.roundManager?.getRoundNumber?.() ?? 0;
  return now - when < BUILDING_REBUY_COOLDOWN_ROUNDS;
}

/**
 * Note the round a building was sold on, so `buildingOnRebuyCooldown` can keep
 * the AI from immediately rebuilding it. Without this the cooldown would never
 * trigger and the audit would degenerate into build → sell → build every turn.
 */
export function rememberBuildingSale(
  engine: CooldownEngine,
  civilizationId: number,
  buildingType: string,
): void {
  const storage = engine.getPlayerStorage?.(civilizationId);
  if (!storage?.turnData) return;
  const soldAt = (storage.turnData.soldBuildings as Record<string, number> | undefined) ?? {};
  soldAt[buildingType] = engine.roundManager?.getRoundNumber?.() ?? 0;
  storage.turnData.soldBuildings = soldAt;
}

export interface SellRecommendation {
  buildingType: string;
  score: number;
  reasons: string[];
  /**
   * Whether the building is structurally wrong for this city regardless of
   * what it cost: duplicated, or missing a building it depends on.
   *
   * The numeric `score` is proportional to build cost, so on its own it can
   * never condemn an expensive building — a 200-shield Factory scores 20 and
   * clears any sane threshold. This flag is what lets redundancy and a missing
   * prerequisite condemn a building whatever it cost.
   */
  structurallyRedundant: boolean;
  /**
   * A situational bonus lifted this building back out of danger — it is
   * defending a threatened city or holding an unhappy one together.
   *
   * The cost/usage equation cannot see this on its own for a Barracks: the
   * engine credits no `defense` for it, so on paper it is an inert 1 gold/turn
   * building and would be liquidated out of a city that is under attack. The
   * audit has to be able to overrule the arithmetic with the situation.
   */
  situationallyProtected: boolean;
}

export interface CityBuildingReport {
  cityId: string;
  cityName: string;
  sellCandidates: SellRecommendation[];
  totalBuildings: number;
  averageScore: number;
  /**
   * The cost/usage equation for every building in the city. Two independent
   * verdicts are kept deliberately: `score` is the structural read (redundancy,
   * prerequisites, obsolescence) and `economics` is the money read. A building
   * is only sold when both agree it has stopped earning its keep.
   */
  economics: BuildingEconomics[];
}

/** Everything `scoreBuilding` needs to judge one building in its city. */
interface CitySituation {
  isUnhappy: boolean;
  isThreatened: boolean;
  hasGunpowder: boolean;
  /** Ocean or river touches the city — the Harbor's entire worth. */
  hasWaterAccess: boolean;
}

/**
 * Analyzes the buildings of a single city and returns sell recommendations.
 */
export function analyzeCityBuildings(
  city: City,
  civ: Civilization,
  units: Unit[],
  cities: City[],
  map: MapState,
  armyGroups: ArmyGroup[] = [],
  allCivs: Civilization[] = [],
): CityBuildingReport {
  const buildings = city.buildings ?? [];
  const scores: SellRecommendation[] = [];

  // Count building occurrences for redundancy check.
  const buildingCounts = new Map<string, number>();
  for (const b of buildings) {
    buildingCounts.set(b, (buildingCounts.get(b) ?? 0) + 1);
  }

  // Determine city-level context.
  const situation: CitySituation = {
    isUnhappy: isCityUnhappy(city, civ),
    isThreatened: isCityThreatened(city, civ, units, cities, armyGroups),
    hasGunpowder: civHasGunpowder(civ, units),
    hasWaterAccess: hasWaterAccess(city, map),
  };

  for (const buildingType of buildings) {
    const { score, reasons, structurallyRedundant, situationallyProtected } = scoreBuilding(
      buildingType,
      buildingCounts.get(buildingType) ?? 1,
      buildings,
      situation,
    );
    scores.push({ buildingType, score, reasons, structurallyRedundant, situationallyProtected });
  }

  // The cost/usage equation, measured per building against this city.
  const cityEconomics = buildCityEconomics(city, civ, units, cities, map, armyGroups, allCivs);
  const economics = buildings.map((buildingType) =>
    evaluateBuildingEconomics(buildingType, cityEconomics));

  const economicsByType = new Map(economics.map((e) => [e.buildingType, e]));

  // Sort ascending — worst buildings first.
  scores.sort((a, b) => a.score - b.score);

  // The cost/usage equation has the casting vote, in both directions.
  //
  //  - A building that PAYS for itself is never sold, however redundant: giving
  //    up income to save upkeep loses on both sides of the trade.
  //  - A building that does NOTHING the engine can see is sold whatever it cost.
  //    This is the case a cost-proportional score cannot reach — an SDI Defense
  //    (200 shields, 4 gold/turn) and a Factory both score far above the
  //    threshold while being worth exactly nothing.
  //  - Anything in between has to be structurally weak as well, so the audit
  //    does not liquidate a merely unprofitable building on a hunch.
  const sellCandidates = scores
    .filter((s) => {
      const e = economicsByType.get(s.buildingType);
      if (!e) return s.score <= SELL_THRESHOLD;
      if (!isSellableForBudget(e)) return false;
      // A building that is defending a threatened city or holding an unhappy
      // one together is never sold, whatever the arithmetic says.
      if (s.situationallyProtected) return false;
      return e.verdict === 'inert' || s.score <= SELL_THRESHOLD || s.structurallyRedundant;
    })
    .slice(0, MAX_RECOMMENDATIONS);

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const averageScore = scores.length > 0 ? totalScore / scores.length : 0;

  return {
    cityId: city.id,
    cityName: city.name,
    sellCandidates,
    totalBuildings: buildings.length,
    averageScore: Math.round(averageScore * 100) / 100,
    economics,
  };
}

/**
 * Assemble the facts the cost/usage equation needs for one city.
 *
 * `happinessSlackWithout` is measured with EVERY happiness building removed, so
 * a Temple is scored against the disorder it would actually prevent rather
 * than the headroom it created itself — otherwise every happiness building
 * looks like it is saving the city from itself.
 */
function buildCityEconomics(
  city: City,
  civ: Civilization,
  units: Unit[],
  cities: City[],
  map: MapState,
  armyGroups: ArmyGroup[],
  allCivs: Civilization[],
): CityEconomics {
  return {
    taxRate: civ?.taxRate ?? 50,
    cityOutputPerTurn: Math.max(0, city.tax ?? 0),
    happinessSlackWithout: happinessSlackWithoutHappyBuildings(city),
    isThreatened: isCityThreatened(city, civ, units, cities, armyGroups),
    isCoastal: hasWaterAccess(city, map),
    civUsesShips: civUsesShips(civ, units),
    rivalCanBuildAtomicWeapons: rivalsCanBuildAtomicWeapons(civ, allCivs),
  };
}

/**
 * happiness − unhappiness as it would be with every happiness building gone.
 *
 * The city's stored happiness already includes what its buildings contribute
 * (`applyCityOutputs` runs each turn), so the counterfactual is that stored
 * figure minus the sum of the buildings' positive happiness. City Walls'
 * −1 stays in, because the question is "would the city fall apart without a
 * Temple", not "with the walls removed too".
 */
function happinessSlackWithoutHappyBuildings(city: City): number {
  const buildingsHappiness = (city.buildings ?? []).reduce(
    (sum, b) => sum + Math.max(0, BUILDING_PROPERTIES[b]?.effects?.happiness ?? 0),
    0,
  );
  const stored = city.happiness;
  const happiness = typeof stored === 'number' ? stored : 0;
  return happiness - buildingsHappiness - (city.unhappiness ?? 0);
}

/** Whether this civ has ever put a warship to sea (an island start counts). */
function civUsesShips(civ: Civilization, units: Unit[]): boolean {
  if (!civ) return false;
  if (civ.startsOnIsland) return true;
  return units.some(u =>
    u.civilizationId === civ.id
    && UNIT_PROPERTIES[String(u.type ?? '').trim().toLowerCase()]?.naval === true);
}

/**
 * Whether any living rival could field an atomic weapon. This is the whole
 * justification for an SDI Defense's 4 gold/turn upkeep: with no rival on
 * `nuclear_power` there is nothing to intercept.
 */
function rivalsCanBuildAtomicWeapons(civ: Civilization, allCivs: Civilization[]): boolean {
  if (allCivs.length <= 1) return false;
  return allCivs.some(other =>
    other.id !== civ?.id
    && other.isAlive !== false
    && (other.technologies ?? []).includes(NUCLEAR_WEAPON_TECH));
}

/**
 * Scores a single building instance. Returns the score and a list of reasons.
 */
function scoreBuilding(
  buildingType: string,
  count: number,
  allBuildings: string[],
  situation: CitySituation,
): {
  score: number;
  reasons: string[];
  structurallyRedundant: boolean;
  situationallyProtected: boolean;
} {
  const reasons: string[] = [];
  let structurallyRedundant = false;
  let situationallyProtected = false;

  // Wonders are never sold.
  if (WONDER_PROPERTIES[buildingType]) {
    return {
      score: Infinity, reasons: ['protected (wonder)'],
      structurallyRedundant, situationallyProtected,
    };
  }
  if (NEVER_SELL.has(buildingType)) {
    return {
      score: Infinity, reasons: ['protected'],
      structurallyRedundant, situationallyProtected,
    };
  }

  // Base value from cost.
  const props = BUILDING_PROPERTIES[buildingType];
  const baseCost = props?.cost ?? 20;
  let score = baseCost / 10;

  // Redundancy penalty.
  if (count > 1) {
    score *= 0.3;
    structurallyRedundant = true;
    reasons.push(`redundant (x${count})`);
  }

  // Missing prerequisite penalty.
  const required = REQUIRES_BUILDING[buildingType];
  if (required) {
    const hasPrereq = required.some((r) => allBuildings.includes(r));
    if (!hasPrereq) {
      score *= 0.2;
      structurallyRedundant = true;
      reasons.push(`missing ${required.join('/')}`);
    }
  }

  // A harbor inland grants nothing: no ships, no sea food.
  if (buildingType === BUILDING_TYPES.HARBOR && !situation.hasWaterAccess) {
    score *= 0.2;
    reasons.push('inland (no water access)');
  }

  // Obsolete penalty.
  if (situation.hasGunpowder && OBSOLETE_WITH_GUNPOWDER.has(buildingType)) {
    score *= 0.1;
    reasons.push('obsolete (gunpowder era)');
  }

  // Happiness bonus.
  if (situation.isUnhappy && HAPPINESS_BUILDINGS.has(buildingType)) {
    score *= 2.0;
    situationallyProtected = true;
    reasons.push('happiness (city is unhappy)');
  }

  // Defense bonus.
  if (situation.isThreatened && DEFENSE_BUILDINGS.has(buildingType)) {
    score *= 2.0;
    situationallyProtected = true;
    reasons.push('defense (city is threatened)');
  }

  return {
    score: Math.round(score * 100) / 100,
    reasons,
    structurallyRedundant,
    situationallyProtected,
  };
}

/**
 * Determines if a city is unhappy (more unhappy than happy citizens).
 */
function isCityUnhappy(city: City, civ: Civilization): boolean {
  // Use the city's happiness data if available.
  const unhappy = (city as { unhappyCitizens?: number }).unhappyCitizens;
  const happy = (city as { happyCitizens?: number }).happyCitizens;
  if (unhappy !== undefined && happy !== undefined) {
    return unhappy > happy;
  }
  // Fallback: check if the civ has a happiness penalty.
  return (civ as { happinessPenalty?: number }).happinessPenalty !== undefined;
}

/** Enemy units this close to the city make it threatened. */
const THREAT_RADIUS = 3;
/** Enemy cities this close also count — an army is usually nearby them. */
const ENEMY_CITY_RADIUS = 4;

/**
 * Determines if a city is threatened: enemy units closing in, an enemy city on
 * the doorstep, or a coordinated enemy army group marching onto it.
 */
function isCityThreatened(
  city: City,
  civ: Civilization,
  units: Unit[],
  cities: City[],
  armyGroups: ArmyGroup[],
): boolean {
  for (const unit of units) {
    // Own units are not a threat.
    if (unit.civilizationId === civ.id) continue;
    const dist = Math.max(Math.abs(unit.col - city.col), Math.abs(unit.row - city.row));
    if (dist <= THREAT_RADIUS) return true;
  }

  for (const other of cities) {
    if (other.civilizationId === civ.id) continue;
    if (other.id === city.id) continue;
    const dist = Math.max(Math.abs(other.col - city.col), Math.abs(other.row - city.row));
    if (dist <= ENEMY_CITY_RADIUS) return true;
  }

  // A coordinated enemy army group aiming at (or next to) this city is the
  // most reliable signal there is: it is an actual committed attack, not a
  // scout that wandered past.
  for (const group of armyGroups) {
    const target = group.targetLocation;
    const dist = Math.max(Math.abs(target.col - city.col), Math.abs(target.row - city.row));
    if (dist <= 1) return true;
  }

  return false;
}

/**
 * Whether ocean or river touches the city — the same test the ship production
 * uses, so the auditor and the fleet agree on what counts as a harbour city.
 */
function hasWaterAccess(city: City, map: MapState): boolean {
  const waterTypes = new Set<string>([TERRAIN_TYPES.OCEAN, TERRAIN_TYPES.RIVER]);
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const col = city.col + dc;
      const row = city.row + dr;
      if (col < 0 || row < 0 || col >= map.width || row >= map.height) continue;
      const tile = map.tiles.find((t) => t.col === col && t.row === row);
      if (!tile) continue;
      const type = String(tile.type ?? tile.terrain ?? '').toLowerCase();
      if (waterTypes.has(type)) return true;
    }
  }
  return false;
}

/**
 * Determines if the civilization has gunpowder-era units.
 */
function civHasGunpowder(civ: Civilization, units: Unit[]): boolean {
  const gunpowderUnits = ['artillery', 'cannon', 'howitzer'];
  return units.some(
    (u) => u.civilizationId === civ.id && gunpowderUnits.includes(u.type),
  );
}
