/**
 * AICityManager — the CITY GOVERNOR.
 *
 * Runs once per city per turn (from `AutoProduction`) and manages the three
 * Civ1 city levers in the order the situation demands:
 *
 *   0. CONTENTMENT: while the city is unhappy, an Entertainer is pulled onto
 *      the staff (disorder zeroes a city's output entirely).
 *   1. FOOD (survival & growth, MANDATORY in every mode): re-assign tile
 *      workers so the city keeps a stable food surplus; a city that cannot
 *      feed itself converts its money/science specialists back into farmers.
 *      Famine is prevented by moving citizens to food tiles BEFORE the growth
 *      phase can starve them.
 *   2. SURPLUS (per mode): once food is secure the governor steers what is
 *      left over according to the city's governor mode (see `GOVERNOR_PROFILES`).
 *   3. SPECIALISTS (per mode): spare, content citizens become Taxmen or
 *      Scientists according to the mode / the civ's strategy.
 *
 * The governor is INDEPENDENT of a city's Auto Production switch: "Auto"
 * decides what the city BUILDS, the governor decides who WORKS. It never
 * touches a tile the player assigned by hand (`userAssignedTiles`) — those
 * stay put even when the city is starving (the starvation modal then points
 * the player at them).
 *
 * AI civs keep their strategy-driven profile (unchanged behaviour); human
 * cities use the mode chosen in the city screen (`city.governor`).
 *
 * All decisions are expressed through the engine APIs (`workingTiles` /
 * `userAssignedTiles` + `EconomicManager.refreshYieldsFromWorkingTiles`,
 * `promoteCitizenToSpecialist`, `demoteSpecialistToWorker`), so the governor
 * cannot desync from the growth pipeline.
 */

import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import type { City, CityGovernorMode, Civilization, SpecialistType } from '../../../../types/game';
import { resolveAICivStrategy, type StrategyProfile } from './AITypes';
import type GameEngine from '../GameEngine';
import type { EconomicManager } from '../EconomicManager';

/** Stable growth needs at least this much food surplus per turn. */
export const AI_MIN_FOOD_SURPLUS = 1;
/** Surplus above this is converted into production/trade (growth stays safe). */
export const AI_FOOD_SURPLUS_CAP = 4;
/** Turns of stored food left before starvation counts as an emergency. */
export const AI_FAMINE_WARNING_TURNS = 2;
/** Extra surplus required before converting a farmer into a specialist. */
export const AI_SPECIALIST_FOOD_HEADROOM = 2;
export const AI_SPECIALIST_MIN_POP = 3;
export const AI_MAX_SPECIALISTS_PER_CITY = 2;
/** Gold comfort level used to pick Taxman vs Scientist for balanced civs. */
export const AI_SPECIALIST_GOLD_COMFORT = 50;
/** Granary-for-growth is only worth it while the empire is still expanding. */
export const AI_GRANARY_MIN_POP = 2;
/** How many Entertainers the contentment pass keeps on staff. */
export const MAX_ENTERTAINERS_PER_CITY = 2;
export const AI_GRANARY_CITY_TARGET = 10;
/** Strategies that keep building settlers (and therefore value granaries). */
export const AI_EXPANSIONIST_STRATEGIES: StrategyProfile[] = [
  'early_expansion',
  'balanced_growth',
  'military_expansion',
];

interface TileYield {
  key: string;
  food: number;
  production: number;
  trade: number;
}

/**
 * What a governor does once the food floor is secured. `food` is the safety
 * net every mode shares; the rest is what the mode spends the surplus on.
 */
export interface GovernorProfile {
  mode: CityGovernorMode;
  /** The food surplus the governor always pulls towards (never below 1). */
  surplusTarget: number;
  /** Above this surplus the governor starts trading food for p/t tiles. */
  surplusCap: number;
  /** Weights used to rank tile swaps in the "balanced" step. */
  weights: { food: number; production: number; trade: number };
  /** Extra surplus required before a worker may become a specialist. */
  specialistHeadroom: number;
  /** How many non-Entertainer specialists the mode maintains. */
  maxSpecialists: number;
  /** Minimum population before any specialist is considered. */
  specialistMinPop: number;
  /** Which specialist the mode prefers ('strategy' = follow the civ profile). */
  specialist: SpecialistType | 'strategy';
}

/** The four player-selectable governor modes. */
export const GOVERNOR_PROFILES: Record<CityGovernorMode, GovernorProfile> = {
  growth: {
    mode: 'growth',
    // Keeps farming: fills the food box, converts only the true excess.
    surplusTarget: AI_FOOD_SURPLUS_CAP + 2,
    surplusCap: AI_FOOD_SURPLUS_CAP + 2,
    weights: { food: 3, production: 0.5, trade: 0.5 },
    specialistHeadroom: AI_SPECIALIST_FOOD_HEADROOM + 4,
    maxSpecialists: 0,
    specialistMinPop: AI_SPECIALIST_MIN_POP,
    specialist: 'taxman',
  },
  production: {
    mode: 'production',
    // Food floor only, then shields.
    surplusTarget: AI_MIN_FOOD_SURPLUS,
    surplusCap: AI_MIN_FOOD_SURPLUS,
    weights: { food: 0, production: 3, trade: 1 },
    specialistHeadroom: AI_SPECIALIST_FOOD_HEADROOM,
    maxSpecialists: 0,
    specialistMinPop: AI_SPECIALIST_MIN_POP,
    specialist: 'taxman',
  },
  commerce: {
    mode: 'commerce',
    // Food floor, then trade + money/science specialists.
    surplusTarget: AI_MIN_FOOD_SURPLUS,
    surplusCap: AI_MIN_FOOD_SURPLUS,
    weights: { food: 0, production: 1, trade: 3 },
    specialistHeadroom: AI_SPECIALIST_FOOD_HEADROOM,
    maxSpecialists: AI_MAX_SPECIALISTS_PER_CITY,
    specialistMinPop: AI_SPECIALIST_MIN_POP,
    specialist: 'strategy',
  },
  balanced: {
    mode: 'balanced',
    // The classic Civ1 mix: small surplus, then production + half trade.
    surplusTarget: AI_MIN_FOOD_SURPLUS,
    surplusCap: AI_FOOD_SURPLUS_CAP,
    weights: { food: 0, production: 1, trade: 0.5 },
    specialistHeadroom: AI_SPECIALIST_FOOD_HEADROOM,
    maxSpecialists: AI_MAX_SPECIALISTS_PER_CITY,
    specialistMinPop: AI_SPECIALIST_MIN_POP,
    specialist: 'strategy',
  },
};

/** The profile an AI civ gets — today's numbers, driven by its strategy. */
const AI_GOVERNOR_PROFILE: GovernorProfile = {
  mode: 'balanced',
  surplusTarget: AI_MIN_FOOD_SURPLUS,
  surplusCap: AI_FOOD_SURPLUS_CAP,
  weights: { food: 0, production: 1, trade: 0.5 },
  specialistHeadroom: AI_SPECIALIST_FOOD_HEADROOM,
  maxSpecialists: AI_MAX_SPECIALISTS_PER_CITY,
  specialistMinPop: AI_SPECIALIST_MIN_POP,
  specialist: 'strategy',
};

export class AICityManager {
  private gameEngine: GameEngine;
  private econ: EconomicManager;

  constructor(gameEngine: GameEngine, econ: EconomicManager) {
    this.gameEngine = gameEngine;
    this.econ = econ;
  }

  /**
   * Govern one city for this turn: contentment, then the mandatory food
   * security pass, then the mode's surplus/specialist policy.
   *
   * Runs for EVERY city — it is independent of the Auto Production switch
   * (that decides what the city builds; the governor decides who works). AI
   * civs follow their strategy profile, human civs their chosen mode.
   * Tiles the player assigned by hand are never moved.
   */
  manageCity(city: City, civ: Civilization, strategy?: StrategyProfile): void {
    if (!city || !civ) return;
    // Barbarian cities are auto-managed for military production only; the
    // governor (specialists, granaries, worker rebalancing) must not run there.
    if (civ.id === BARBARIAN_CIV_ID) return;
    const resolved = strategy ?? resolveAICivStrategy(civ);
    const profile = civ.isHuman === true
      ? GOVERNOR_PROFILES[city.governor ?? 'balanced']
      : AI_GOVERNOR_PROFILE;

    this.secureContentment(city, civ);
    this.secureFood(city, civ, profile);
    this.steerSurplus(city, civ, profile);
    this.manageSpecialists(city, civ, profile, resolved);
    city.governorDirty = false;
  }

  /**
   * Contentment first: a disordered city produces nothing at all, so the
   * governor staffs an Entertainer while the city is unhappy (and never
   * beyond what it actually needs).
   */
  private secureContentment(city: City, civ: Civilization): void {
    const specialists = city.specialists ?? (city.specialists = []);
    const happy = this.econ.cityHappiness(city, civ);
    const unhappy = happy.disorder || happy.unhappiness >= happy.happiness;
    const entertainers = specialists.filter((sp) => sp === 'entertainer').length;

    if (unhappy && entertainers < MAX_ENTERTAINERS_PER_CITY && (city.population ?? 1) > 1) {
      this.gameEngine.promoteCitizenToSpecialist?.(city.id, 'entertainer');
      return;
    }
    // Unneeded Entertainers go back to the fields.
    while (entertainers > 0 && !unhappy) {
      const index = specialists.lastIndexOf('entertainer');
      if (index < 0) break;
      if (!this.gameEngine.demoteSpecialistToWorker?.(city.id, index)) break;
      break;
    }
  }

  /** The centralized food balance for a city (never throws). */
  foodBalance(city: City, civ: Civilization | undefined) {
    return this.econ.cityFoodBalance(city, civ);
  }

  /**
   * Whether the city is heading for famine: negative net food and either an
   * empty/negative store or starvation within the warning window.
   */
  isFoodEmergency(city: City, civ: Civilization | undefined): boolean {
    const b = this.econ.cityFoodBalance(city, civ);
    if (b.surplus >= 0) return false;
    if (b.storage + b.surplus < 0) return true;
    return b.turnsUntilStarvation >= 0 && b.turnsUntilStarvation <= AI_FAMINE_WARNING_TURNS;
  }

  /**
   * The building that best supports the city's food/growth plan, or null.
   *
   * A Granary does NOT fix a negative food balance (it only halves the food
   * box kept on growth), so famine itself is handled by the worker
   * reallocation above. What this covers is the long-term food plan:
   *  - an Aqueduct when growth is blocked by the housing cap, and
   *  - a Granary for an expansionist civ's growing settler-factory city.
   */
  foodSecurityBuilding(
    city: City,
    civ: Civilization | undefined,
    strategy: StrategyProfile,
  ): string | null {
    const pop = city.population ?? 1;
    const maxPop = city.maxPopulation ?? 10;
    const hasAqueduct = (city.buildings ?? []).includes('aqueduct');
    if (pop >= maxPop && !hasAqueduct && this.canBuild(city, 'aqueduct')) {
      return 'aqueduct';
    }
    if (this.shouldBuildGrowthGranary(city, civ, strategy)) {
      return 'granary';
    }
    return null;
  }

  /**
   * Long-term growth plan: an expansionist civ keeps a Granary in its growing
   * cities so settler production and population growth stay steady.
   */
  shouldBuildGrowthGranary(
    city: City,
    civ: Civilization | undefined,
    strategy: StrategyProfile,
  ): boolean {
    if (!AI_EXPANSIONIST_STRATEGIES.includes(strategy)) return false;
    if (!civ) return false;
    const b = this.econ.cityFoodBalance(city, civ);
    if (b.hasGranary) return false;
    if (b.surplus < AI_MIN_FOOD_SURPLUS) return false;
    if ((city.population ?? 1) < AI_GRANARY_MIN_POP) return false;
    const cityCount = (this.gameEngine.cities ?? []).filter(
      (c) => c.civilizationId === civ.id,
    ).length;
    if (cityCount >= AI_GRANARY_CITY_TARGET) return false;
    return this.canBuild(city, 'granary');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Food
  // ──────────────────────────────────────────────────────────────────────

  private secureFood(city: City, civ: Civilization, profile: GovernorProfile): void {
    let balance = this.econ.cityFoodBalance(city, civ);

    // 1. Money/science specialists do not work a tile — return them to the
    //    fields before famine strikes (Entertainers stay: disorder kills the
    //    city's output entirely).
    if (balance.surplus < AI_MIN_FOOD_SURPLUS && this.demoteNonEntertainer(city)) {
      balance = this.econ.cityFoodBalance(city, civ);
    }

    // 2. Swap the worst worked tile for the best unworked food tile until the
    //    city has a stable surplus (or no improving swap is left). This is the
    //    mandatory food-first pass every governor mode starts with.
    let swaps = 0;
    while (balance.surplus < Math.max(AI_MIN_FOOD_SURPLUS, profile.surplusTarget) && swaps < 4) {
      if (!this.swapWorkedTile(city, civ, 'food', profile)) break;
      balance = this.econ.cityFoodBalance(city, civ);
      swaps++;
    }
  }

  /**
   * Food is safe — now spend the surplus the way the mode wants: pull workers
   * back onto food until `surplusTarget`, then trade the excess for the
   * production/trade the mode values.
   */
  private steerSurplus(city: City, civ: Civilization, profile: GovernorProfile): void {
    let balance = this.econ.cityFoodBalance(city, civ);
    let pulled = 0;
    while (balance.surplus < profile.surplusTarget && pulled < 3) {
      if (!this.swapWorkedTile(city, civ, 'food', profile)) break;
      balance = this.econ.cityFoodBalance(city, civ);
      pulled++;
    }
    let converted = 0;
    while (balance.surplus > profile.surplusCap && converted < 3) {
      if (!this.swapWorkedTile(city, civ, 'balance', profile)) break;
      balance = this.econ.cityFoodBalance(city, civ);
      converted++;
    }
  }

  private demoteNonEntertainer(city: City): boolean {
    const specialists = city.specialists ?? [];
    const index = specialists.findIndex((s) => s === 'taxman' || s === 'scientist');
    if (index === -1) return false;
    return this.gameEngine.demoteSpecialistToWorker?.(city.id, index) ?? false;
  }

  /**
   * Swap one worked tile for an unworked tile in the city radius.
   *  - mode 'food'    → maximise the food gain (famine recovery / growth).
   *  - mode 'balance' → maximise the mode's weighted gain without dropping
   *                     below the mode's food floor.
   *
   * Tiles the player assigned by hand are never swapped out.
   */
  private swapWorkedTile(
    city: City,
    civ: Civilization,
    mode: 'food' | 'balance',
    profile: GovernorProfile,
  ): boolean {
    const working = city.workingTiles instanceof Set ? city.workingTiles : new Set<string>();
    if (working.size === 0) return false;
    const centerKey = `${city.col},${city.row}`;

    // A manual allocation is the player's own decision — the governor never
    // moves it (not even to stop a famine; the starvation modal says so).
    const userAssigned = city.userAssignedTiles instanceof Set
      ? city.userAssignedTiles
      : new Set<string>();

    const worked: TileYield[] = [];
    for (const key of working) {
      // The city centre is always worked and can never be swapped out.
      if (key === centerKey) continue;
      if (userAssigned.has(key)) continue;
      const [col, row] = key.split(',').map(Number);
      const tile = this.gameEngine.getTileAt?.(col, row);
      if (!tile) continue;
      const y = this.econ.cityTileYields(tile);
      worked.push({ key, food: y.food, production: y.production, trade: y.trade });
    }
    if (worked.length === 0) return false;

    const available: TileYield[] = [];
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        if (dc === 0 && dr === 0) continue;
        const col = city.col + dc;
        const row = city.row + dr;
        if (!this.gameEngine.isTileInCityRadius?.(city, col, row)) continue;
        const key = `${col},${row}`;
        if (working.has(key)) continue;
        const tile = this.gameEngine.getTileAt?.(col, row);
        if (!tile) continue;
        // Never poach a tile another city is already working.
        const claimedElsewhere = (this.gameEngine.cities ?? []).some(
          (other) => other.id !== city.id && other.workingTiles?.has(key),
        );
        if (claimedElsewhere) continue;
        const y = this.econ.cityTileYields(tile);
        available.push({ key, food: y.food, production: y.production, trade: y.trade });
      }
    }
    if (available.length === 0) return false;

    const total = (t: TileYield): number => t.food + t.production + t.trade;
    let best: { from: string; to: string } | null = null;

    const w = profile.weights;
    const score = (t: TileYield): number =>
      t.food * w.food + t.production * w.production + t.trade * w.trade;

    if (mode === 'food') {
      const worst = worked.reduce((a, b) =>
        b.food < a.food || (b.food === a.food && total(b) < total(a)) ? b : a,
      );
      const bestCandidate = available.reduce((a, b) =>
        b.food > a.food || (b.food === a.food && total(b) > total(a)) ? b : a,
      );
      if (bestCandidate.food > worst.food) {
        best = { from: worst.key, to: bestCandidate.key };
      }
    } else {
      // Never drop below the mode's food floor while chasing weighted yield.
      const balance = this.econ.cityFoodBalance(city, civ);
      const floor = Math.max(AI_MIN_FOOD_SURPLUS, profile.surplusTarget);
      let bestGain = 0;
      for (const from of worked) {
        for (const to of available) {
          const foodAfter = balance.surplus + (to.food - from.food);
          if (foodAfter < floor) continue;
          const gain = score(to) - score(from);
          if (gain > bestGain) {
            bestGain = gain;
            best = { from: from.key, to: to.key };
          }
        }
      }
    }
    if (!best) return false;

    working.delete(best.from);
    working.add(best.to);
    city.workingTiles = working;
    // NOTE: `userAssignedTiles` is *only* the player's own placements — the
    // governor never writes its choices there, or they would be shown to the
    // player as "manual" and become untouchable by the next re-balance. It only
    // has to keep the freed tile out of `workingTiles` (done above).
    this.econ.refreshYieldsFromWorkingTiles(city);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Money / Science
  // ──────────────────────────────────────────────────────────────────────

  private manageSpecialists(
    city: City,
    civ: Civilization,
    profile: GovernorProfile,
    strategy: StrategyProfile,
  ): void {
    const specialists = city.specialists ?? (city.specialists = []);
    const balance = this.econ.cityFoodBalance(city, civ);

    // Never convert a farmer while the city is short on food; instead keep
    // the fields staffed.
    if (balance.surplus < AI_MIN_FOOD_SURPLUS) return;
    // Modes that keep everyone on the tiles (growth / production) do not add
    // money or science specialists.
    if (profile.maxSpecialists <= 0) return;

    const happy = this.econ.cityHappiness(city, civ);
    if (happy.disorder || happy.unhappiness >= happy.happiness) return;

    const pop = city.population ?? 1;
    const nonEntertainers = specialists.filter((sp) => sp !== 'entertainer').length;
    if (pop < profile.specialistMinPop) return;
    if (nonEntertainers >= profile.maxSpecialists) return;
    if (balance.surplus < AI_MIN_FOOD_SURPLUS + profile.specialistHeadroom) return;

    const type =
      profile.specialist === 'strategy'
        ? this.pickSpecialistType(civ, strategy)
        : profile.specialist;
    this.gameEngine.promoteCitizenToSpecialist?.(city.id, type);
  }

  /** Taxman vs Scientist by strategy (and treasury for balanced civs). */
  private pickSpecialistType(civ: Civilization, strategy: StrategyProfile): SpecialistType {
    switch (strategy) {
      case 'science_focus':
      case 'wonder_rush':
        return 'scientist';
      case 'military_expansion':
      case 'defensive_turtle':
        return 'taxman';
      default:
        return (civ.resources?.gold ?? 0) < AI_SPECIALIST_GOLD_COMFORT
          ? 'taxman'
          : 'scientist';
    }
  }

  private canBuild(city: City, buildingType: string): boolean {
    const pm = this.gameEngine.productionManager;
    if (typeof pm?.getBuildableBuildingTypes !== 'function') return false;
    return pm.getBuildableBuildingTypes(city.id).includes(buildingType);
  }
}

export default AICityManager;
