/**
 * AICityManager — the AI's advanced city governor.
 *
 * Runs once per AI city per turn (from `AutoProduction`) and manages the three
 * Civ1 city levers in the order the situation demands:
 *
 *   1. FOOD (survival & growth): re-assign tile workers so the city keeps a
 *      stable food surplus; a city that cannot feed itself converts its
 *      money/science specialists back into farmers. Famine is prevented by
 *      moving citizens to food tiles BEFORE the growth phase can starve them,
 *      and anything above the food cap is converted into production/trade.
 *   2. MONEY / SCIENCE (specialists): once food is secure and the city is
 *      content, spare citizens become Taxmen or Scientists according to the
 *      civ's strategy (science/wonder → Scientist, military/turtle → Taxman).
 *   3. PRODUCTION (granary): expansion-minded civs keep a Granary in their
 *      settler-factory cities so growth and settler production stay steady;
 *      a starving city builds a Granary as an emergency (the food math mirrors
 *      `EconomicManager.cityFoodBalance` — the exact numbers the engine uses,
 *      including the food the city's own settlers eat).
 *
 * All decisions are expressed through the engine APIs (`workingTiles` /
 * `userAssignedTiles` + `EconomicManager.refreshYieldsFromWorkingTiles`,
 * `promoteCitizenToSpecialist`, `demoteSpecialistToWorker`), so the governor
 * cannot desync from the growth pipeline.
 */

import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import type { City, Civilization, SpecialistType } from '../../../../types/game';
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

export class AICityManager {
  private gameEngine: GameEngine;
  private econ: EconomicManager;

  constructor(gameEngine: GameEngine, econ: EconomicManager) {
    this.gameEngine = gameEngine;
    this.econ = econ;
  }

  /**
   * Manage one city for this turn. Only auto-managed (AI) cities are touched;
   * human cities keep their player assignment and specialist choices.
   */
  manageCity(city: City, civ: Civilization, strategy?: StrategyProfile): void {
    if (!city || city.autoProduction !== true || !civ) return;
    // The governor only manages AI cities: human players keep control of
    // their workers and specialists even when auto-production is enabled.
    if (civ.isHuman === true) return;
    // Barbarian cities are auto-managed for military production only; the
    // governor (specialists, granaries, worker rebalancing) must not run there.
    if (civ.id === BARBARIAN_CIV_ID) return;
    const resolved = strategy ?? resolveAICivStrategy(civ);
    this.secureFood(city, civ);
    this.manageSpecialists(city, civ, resolved);
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

  private secureFood(city: City, civ: Civilization): void {
    let balance = this.econ.cityFoodBalance(city, civ);

    // 1. Money/science specialists do not work a tile — return them to the
    //    fields before famine strikes (Entertainers stay: disorder kills the
    //    city's output entirely).
    if (balance.surplus < AI_MIN_FOOD_SURPLUS && this.demoteNonEntertainer(city)) {
      balance = this.econ.cityFoodBalance(city, civ);
    }

    // 2. Swap the worst worked tile for the best unworked food tile until the
    //    city has a stable surplus (or no improving swap is left).
    let swaps = 0;
    while (balance.surplus < AI_MIN_FOOD_SURPLUS && swaps < 4) {
      if (!this.swapWorkedTile(city, civ, 'food')) break;
      balance = this.econ.cityFoodBalance(city, civ);
      swaps++;
    }

    // 3. Abundant food is turned into production/trade as long as growth stays
    //    stable ("low surplus over all" — no wasted farmer).
    let optimizations = 0;
    while (balance.surplus > AI_FOOD_SURPLUS_CAP && optimizations < 3) {
      if (!this.swapWorkedTile(city, civ, 'produce')) break;
      balance = this.econ.cityFoodBalance(city, civ);
      optimizations++;
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
   *  - mode 'food'    → maximise the food gain (famine recovery).
   *  - mode 'produce' → maximise production/trade without dropping below the
   *                     safe food surplus.
   */
  private swapWorkedTile(city: City, civ: Civilization, mode: 'food' | 'produce'): boolean {
    const working = city.workingTiles instanceof Set ? city.workingTiles : new Set<string>();
    if (working.size === 0) return false;
    const centerKey = `${city.col},${city.row}`;

    const worked: TileYield[] = [];
    for (const key of working) {
      // The city centre is always worked and can never be swapped out.
      if (key === centerKey) continue;
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
      const balance = this.econ.cityFoodBalance(city, civ);
      let bestGain = 0;
      for (const w of worked) {
        for (const c of available) {
          const foodAfter = balance.surplus + (c.food - w.food);
          if (foodAfter < AI_MIN_FOOD_SURPLUS) continue;
          const gain = c.production + c.trade * 0.5 - (w.production + w.trade * 0.5);
          if (gain > bestGain) {
            bestGain = gain;
            best = { from: w.key, to: c.key };
          }
        }
      }
    }
    if (!best) return false;

    working.delete(best.from);
    working.add(best.to);
    // Pin the choice so the per-turn auto-assigner keeps honouring it; the
    // governor re-evaluates (and re-pins) every turn.
    const userAssigned =
      city.userAssignedTiles instanceof Set ? city.userAssignedTiles : new Set<string>();
    userAssigned.delete(best.from);
    userAssigned.add(best.to);
    city.workingTiles = working;
    city.userAssignedTiles = userAssigned;
    this.econ.refreshYieldsFromWorkingTiles(city);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Money / Science
  // ──────────────────────────────────────────────────────────────────────

  private manageSpecialists(city: City, civ: Civilization, strategy: StrategyProfile): void {
    const specialists = city.specialists ?? (city.specialists = []);
    const balance = this.econ.cityFoodBalance(city, civ);

    // Never convert a farmer while the city is short on food; instead keep
    // the fields staffed.
    if (balance.surplus < AI_MIN_FOOD_SURPLUS) return;

    const happy = this.econ.cityHappiness(city, civ);
    if (happy.disorder || happy.unhappiness >= happy.happiness) return;

    const pop = city.population ?? 1;
    const nonEntertainers = specialists.filter((s) => s !== 'entertainer').length;
    if (pop < AI_SPECIALIST_MIN_POP) return;
    if (nonEntertainers >= AI_MAX_SPECIALISTS_PER_CITY) return;
    if (balance.surplus < AI_MIN_FOOD_SURPLUS + AI_SPECIALIST_FOOD_HEADROOM) return;

    const type = this.pickSpecialistType(civ, strategy);
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
