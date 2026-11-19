/**
 * BuildingCoordinator — the civ-level building policy, and the answer to "does
 * this empire need another one of these?".
 *
 * ## Why this module exists
 *
 * The building *chooser* (`AIBuildingStrategy`) asks a single question per
 * candidate: "would this city like this building?" It never asks how many the
 * civ already owns. Because the candidate list is per city and a city skips
 * only what it already has, an empire will happily build a sixth Temple, a
 * fourth Marketplace and a third Bank — each one a fresh, exciting purchase,
 * each one worth almost nothing. That is the "6× times but only 1 or 2 are
 * needed" shape: the marginal copy is the problem, not the first one.
 *
 * Two independent guards, because either alone is fooled:
 *
 *  1. **A cap** (`USEFUL_COPIES_PER_CIV`) — a ceiling drawn from the game
 *     rules and from the engine's own arithmetic. Most of these buildings have
 *     a *saturating* effect in Civ 1: one Courthouse removes the corruption, one
 *     Aqueduct accelerates the whole city, one Colosseum gives its happiness,
 *     one Factory gives its production. A second copy of any of them is a
 *     maintenance bill for nothing.
 *  2. **A measurement** (`evaluateBuildingForCity`) — recompute the city's real
 *     output with and without the building and see whether the difference pays
 *     for itself. This is what catches the cases a table cannot: a sixth
 *     Temple in a city that is already comfortably content, a Marketplace in a
 *     city whose extra trade is entirely eaten by corruption, and — because it
 *     measures rather than reads the building table — every building whose
 *     declared effects the engine never applies.
 *
 * ## The dead-effects problem, stated once
 *
 * The building table declares `production`, `culture`, `health`, `pollution`,
 * `unitProduction`, `veteranUnits`, `growthBonus`, `foodStorage`,
 * `corruptionReduction`, `missileDefense`, `defense` and more. The engine reads
 * only **happiness, trade and science** from a building (plus pollution in the
 * demographics check). So a Factory, a Power Plant, an Aqueduct, a Granary, an
 * SDI Defense and every wonder pay upkeep and do nothing at all. Measuring
 * rather than trusting the table is what makes that visible: those buildings
 * score a marginal value of zero, which is the honest answer.
 */

import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import type { City, Civilization } from '../../../../types/game';
import { BEAKER_GOLD_EQUIVALENT, MIN_DISORDER_CITY_WORTH } from './BuildingEconomics';

/**
 * How many copies of each building an empire actually wants, across all its
 * cities. Anything above this is a maintenance bill buying nothing.
 *
 * The numbers are the game's own, not a guess: Civ 1 gives one Courthouse its
 * corruption cut, one Aqueduct its growth, one Bank its trade bonus, one
 * Factory its production, one power plant of any kind its output — a second of
 * any of those is inert even in the original. Happiness buildings are the one
 * group allowed to stack (four count, in the original), because a large city
 * genuinely needs the points; trade buildings are allowed two because a city
 * can usefully exceed its own tiles' trade.
 */
const USEFUL_COPIES_PER_CITY: Readonly<Record<string, number>> = {
  // Allowed to a small depth: these scale with the city, up to a point.
  temple: 3,
  marketplace: 2,
  library: 2,
  university: 2,
};

/**
 * Buildings that are an empire-wide effect, and so are wanted at most once no
 * matter how many cities the civ has.
 */
const USEFUL_COPIES_PER_CIV: Readonly<Record<string, number>> = {
  palace: 1,
  sdi_defense: 1,
  great_wall: 1,
  hanging_gardens: 1,
  lighthouse: 1,
  magellans_voyage: 1,
  michelangelo: 1,
  newton: 1,
  oracle: 1,
  pyramids: 1,
  united_nations: 1,
  womens_suffrage: 1,
};

/**
 * Copies of this building one city should hold.
 *
 * Anything not listed here is capped at ONE per city, which is the game's own
 * rule: one Courthouse carries the whole corruption cut, one Aqueduct the whole
 * growth bonus, one Bank the whole trade bonus, one Factory the whole
 * production bonus, one power plant of any kind the whole output bonus, one
 * Colosseum the whole happiness. A second copy of any of those does nothing
 * even in the original — it is pure upkeep, which is exactly how a city ends up
 * holding six buildings that all do the same nothing.
 */
export function usefulCityCopies(buildingType: string): number {
  return USEFUL_COPIES_PER_CITY[buildingType] ?? 1;
}

/** Copies the whole empire should hold, or 0 when there is no empire-wide cap. */
export function usefulCivCopies(buildingType: string): number {
  return USEFUL_COPIES_PER_CIV[buildingType] ?? 0;
}

/** What one food of surplus is worth, in gold, when judging a purchase. */
const FOOD_GOLD_EQUIVALENT = 1;

/** What one shield of city production is worth when judging a purchase. */
const PRODUCTION_GOLD_EQUIVALENT = 1;

interface CitySnapshot {
  gold: number;
  science: number;
  foodSurplus: number;
  production: number;
  happiness: number;
  unhappiness: number;
  disorder: boolean;
}

/**
 * The buildings whose happiness counts towards keeping a city content.
 *
 * Civ 1 counts only the FIRST FOUR of them in a city — a fifth Temple adds
 * nothing at all. That is a rule about the *set*, not about each type, which is
 * why it is enforced here as a combined cap: a city may hold four of these
 * between them, in any mix, and a fifth is pure upkeep.
 */
export const HAPPINESS_BUILDINGS: ReadonlySet<string> = new Set([
  'temple',
  'colosseum',
  'cathedral',
  'hospital',
]);

/**
 * How many happiness buildings a city may hold, across all types.
 *
 * Civ 1 counts four, and that is kept: with tolerance gone every citizen is
 * unhappy, so contentment has to come from somewhere — but it must not come
 * from upkeep. Raising this ceiling to six was tried and is a trap: it lets a
 * civ buy its way out of disorder with buildings, at 1-2 gold a turn each, and
 * with a dozen cities that upkeep bankrupts the treasury outright, which is a
 * worse economy than the disorder it cured. The cheaper sources of happiness —
 * Entertainers, luxury, martial law — are what carry a crowded city now, and
 * the cap exists to stop the buildings joining in.
 */
export const HAPPINESS_BUILDINGS_PER_CITY = 4;

/**
 * Buildings whose value is military, not economic — so the economic measurement
 * is never allowed to demote them.
 *
 * `evaluateBuildingForCity` can only see gold, science, food, production and
 * disorder. A wall's worth is the city it is standing in front of, a Barracks'
 * is the army it produces, a Harbor's is the fleet it unlocks: none of which
 * appear in a city's output. Letting the measurement vote on them means a
 * measured value of zero and a priority cut to a fifth — and an empire that
 * stops building walls is an empire the barbarians take, which is exactly what
 * happened the first time this ran. The cap still applies (one of each per city
 * is right); only the demotion is withheld.
 */
export const DEFENCE_BUILDINGS: ReadonlySet<string> = new Set([
  'city_walls',
  'barracks',
  'sdi_defense',
  'harbor',
]);

/** How many of the happiness buildings this city already holds, any type. */
function happinessBuildingsIn(city: City): number {
  let n = 0;
  for (const b of city.buildings ?? []) if (HAPPINESS_BUILDINGS.has(buildingId(b))) n++;
  return n;
}

type EconomicEngine = {
  economicManager?: {
    cityOutputs: (city: City, civ: Civilization) => { tax: number; science: number };
    cityHappiness: (city: City, civ: Civilization) => {
      happiness: number; unhappiness: number; disorder: boolean;
    };
    cityFoodBalance: (city: City, civ: Civilization) => { surplus: number };
  };
};

/** The building id, whether the engine stores it as a string or an object. */
function buildingId(b: unknown): string {
  if (typeof b === 'string') return b;
  const o = b as { id?: string; type?: string } | null;
  return o?.id ?? o?.type ?? '';
}

/** How many copies of one building type a city owns. */
export function countCopiesIn(city: City, buildingType: string): number {
  let n = 0;
  for (const b of city.buildings ?? []) if (buildingId(b) === buildingType) n++;
  return n;
}

export interface MarginalBuildingValue {
  buildingType: string;
  /** Copies of this building the empire owns, all cities. */
  civCopies: number;
  /** Copies this city owns. */
  cityCopies: number;
  /** Copies this city is allowed before another is waste. */
  cityCap: number;
  /** Copies the whole empire is allowed, or 0 for no empire-wide cap. */
  civCap: number;
  /** Real per-turn change the building makes to THIS city. */
  marginalGold: number;
  marginalBeakers: number;
  marginalFood: number;
  marginalProduction: number;
  /** Points of unhappiness this building takes off the city. */
  happinessRelief: number;
  /** Whether it pulls this city out of disorder. */
  avoidsDisorder: boolean;
  upkeep: number;
  /** Gains minus upkeep, in gold-equivalent per turn. */
  netPerTurn: number;
  worthBuilding: boolean;
  reason: string;
}

function snapshot(
  engine: EconomicEngine,
  civ: Civilization,
  city: City,
): CitySnapshot | null {
  const em = engine.economicManager;
  if (!em?.cityOutputs || !em.cityHappiness) return null;
  const out = em.cityOutputs(city, civ);
  const happy = em.cityHappiness(city, civ);
  const food = em.cityFoodBalance?.(city, civ);
  return {
    gold: out.tax ?? 0,
    science: out.science ?? 0,
    foodSurplus: food?.surplus ?? 0,
    production: city.yields?.production ?? 0,
    happiness: happy.happiness ?? 0,
    unhappiness: happy.unhappiness ?? 0,
    disorder: happy.disorder === true,
  };
}

/**
 * What one more copy of this building is actually worth to this city.
 *
 * Measured, not read off the building table: the city's output is recomputed
 * with the building and without it. That is the only way to see that a Temple
 * in a content city is worth nothing, that a Factory is worth nothing at all,
 * and that a Temple in a city one point from disorder is worth the city.
 */
export function evaluateBuildingForCity(
  engine: EconomicEngine,
  civ: Civilization,
  city: City,
  buildingType: string,
  civCopyCount: number,
  cityCopyCount: number,
): MarginalBuildingValue {
  const props = BUILDING_PROPERTIES[buildingType];
  const upkeep = props?.maintenance ?? 0;
  const cityCap = usefulCityCopies(buildingType);
  const civCap = usefulCivCopies(buildingType);

  const before = snapshot(engine, civ, city);
  const withBuilding: City = {
    ...city,
    buildings: [...(city.buildings ?? []), buildingType],
  };
  const after = snapshot(engine, civ, withBuilding);

  const base: MarginalBuildingValue = {
    buildingType,
    civCopies: civCopyCount,
    cityCopies: cityCopyCount,
    cityCap,
    civCap,
    marginalGold: 0,
    marginalBeakers: 0,
    marginalFood: 0,
    marginalProduction: 0,
    happinessRelief: 0,
    avoidsDisorder: false,
    upkeep,
    netPerTurn: -upkeep,
    worthBuilding: false,
    reason: '',
  };

  if (!before || !after) {
    return { ...base, reason: 'no economic model available' };
  }

  const marginalGold = after.gold - before.gold;
  const marginalBeakers = after.science - before.science;
  const marginalFood = after.foodSurplus - before.foodSurplus;
  const marginalProduction = after.production - before.production;
  const shortfallBefore = Math.max(0, before.unhappiness - before.happiness);
  const shortfallAfter = Math.max(0, after.unhappiness - after.happiness);
  const relief = Math.max(0, shortfallBefore - shortfallAfter);
  const avoidsDisorder = shortfallBefore > 0 && shortfallAfter === 0;

  // Disorder stops tax, science and growth at once, so escaping it is worth the
  // city's whole output, with the same floor the sell-side audit uses.
  // Escaping disorder outright is worth the city's whole output.
  const cityWorth = Math.max(
    before.gold + before.science * BEAKER_GOLD_EQUIVALENT,
    MIN_DISORDER_CITY_WORTH,
  );
  const disorderWorth = avoidsDisorder ? cityWorth : 0;

  // Relief that does NOT complete the set is worth the share of the output it
  // recovers. The engine's disorder is all-or-nothing, so one Temple in a city
  // five points short does not hand back a fifth of its output — but it is one
  // step of a purchase the city is going to make anyway. Refusing it on the
  // grounds that one Temple alone is worth nothing left five cities disordering
  // for the rest of the game, which is exactly what happened when this was
  // measured a point at a time.
  const partialReliefWorth = (!avoidsDisorder && relief > 0 && shortfallBefore > 0)
    ? (relief / shortfallBefore) * cityWorth
    : 0;

  const net =
    marginalGold
    + marginalBeakers * BEAKER_GOLD_EQUIVALENT
    + marginalFood * FOOD_GOLD_EQUIVALENT
    + marginalProduction * PRODUCTION_GOLD_EQUIVALENT
    + partialReliefWorth
    + disorderWorth
    - upkeep;

  const measured: MarginalBuildingValue = {
    ...base,
    marginalGold,
    marginalBeakers,
    marginalFood,
    marginalProduction,
    happinessRelief: relief,
    avoidsDisorder,
    netPerTurn: Math.round(net * 100) / 100,
  };

  // Order matters: a cap we have already hit is refused whatever the
  // measurement says, because the cap encodes "this effect does not stack".
  if (cityCopyCount >= cityCap) {
    return {
      ...measured,
      worthBuilding: false,
      reason: `city already has ${cityCopyCount} of ${cityCap} useful ${buildingType}`,
    };
  }
  if (civCap > 0 && civCopyCount >= civCap) {
    return {
      ...measured,
      worthBuilding: false,
      reason: `empire already has ${civCopyCount} of ${civCap} ${buildingType}`,
    };
  }
  // The first four happiness buildings in a city are the ones that count.
  if (
    HAPPINESS_BUILDINGS.has(buildingType)
    && happinessBuildingsIn(city) >= HAPPINESS_BUILDINGS_PER_CITY
  ) {
    return {
      ...measured,
      worthBuilding: false,
      reason: `city already has its ${HAPPINESS_BUILDINGS_PER_CITY} happiness buildings`,
    };
  }
  if (net <= 0) {
    return {
      ...measured,
      worthBuilding: false,
      reason: net === 0 && upkeep === 0
        ? 'no effect the engine applies'
        : `costs ${upkeep}/turn, returns ${Math.max(0, net + upkeep)}/turn`,
    };
  }
  return {
    ...measured,
    worthBuilding: true,
    reason: `+${net}/turn over ${upkeep} upkeep`,
  };
}

/**
 * How many copies of `buildingType` this civ owns, and how many this city has.
 */
export function countBuildingCopies(
  engine: { cities?: City[] },
  civ: Civilization,
  city: City,
  buildingType: string,
): { civCopies: number; cityCopies: number } {
  let civCopies = 0;
  for (const c of engine.cities ?? []) {
    if (c.civilizationId !== civ.id) continue;
    civCopies += countCopiesIn(c, buildingType);
  }
  return { civCopies, cityCopies: countCopiesIn(city, buildingType) };
}

/**
/**
 * A priority multiplier for a candidate building.
 *
 * Below 1 when the empire already owns plenty of this type, and lower still
 * when a sister city has fewer — which is how an empire levels its cities up
 * instead of stacking one. This is the coordination half: the per-city chooser
 * asks "is this good for me", the coordinator asks "is this good for us".
 */
export function coordinationWeight(
  engine: { cities?: City[] },
  civ: Civilization,
  city: City,
  buildingType: string,
): { weight: number; reason: string } {
  const { civCopies, cityCopies } = countBuildingCopies(engine, civ, city, buildingType);
  const cityCap = usefulCityCopies(buildingType);
  const civCap = usefulCivCopies(buildingType);
  if (cityCopies >= cityCap) {
    return { weight: 0, reason: `city already has its ${cityCap} useful ${buildingType}` };
  }
  if (civCap > 0 && civCopies >= civCap) {
    return { weight: 0, reason: `empire at its ${civCap}-copy limit for ${buildingType}` };
  }
  const worstElsewhere = (engine.cities ?? []).reduce((min, other) => {
    if (other.civilizationId !== civ.id) return min;
    return Math.min(min, countCopiesIn(other, buildingType));
  }, Number.POSITIVE_INFINITY);
  const spread = Number.isFinite(worstElsewhere) && worstElsewhere < civCopies;
  // Still allowed, but a city that already has the most should not be the one
  // to buy the next one.
  return {
    weight: spread ? 0.6 : 1,
    reason: spread ? `another city has fewer ${buildingType}` : '',
  };
}
