/**
 * EconomicManager — the Tax/Science/Luxury economic core for Civ1.
 *
 * Handles universal economic rules: tile yields, city commerce, rate splitting,
 * happiness/disorder, and total upkeep (Units + Buildings).
 * AI-specific logic (reserve targets, preventative tax raising, sustainable
 * army sizing) is delegated to AIEconomicManager.
 */

import { BUILDING_PROPERTIES, BUILDING_TYPES } from '../../data/BuildingConstants';
import { getGovernment } from '../../data/GovernmentData';
import { CityUtils } from '../../utils/CityUtils';
import { UNIT_PROPS } from '../../utils/Constants';
import {
  TERRAIN_PROPERTIES,
  TERRAIN_TYPES,
  getResourceYields,
} from '../../data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES } from '../../data/TileImprovementConstants';
import { SPECIALIST_YIELDS } from '../../data/GameConstants';
import type { City, Civilization, Unit } from '../../../types/game';
import GameEngine from './GameEngine';

interface EconomyTile {
  col?: number;
  row?: number;
  type?: string;
  terrain?: string;
  resource?: string | null;
  improvement?: string | null;
}

export interface CityEconomicOutputs {
  commerce: number;
  corruption: number;
  tax: number;
  science: number;
  luxury: number;
}

export interface CityHappinessResult {
  happiness: number;
  unhappiness: number;
  disorder: boolean;
}

export interface ProcessTurnResult {
  tax: number;
  science: number;
  luxury: number;
  commerce: number;
  upkeep: number;
  deficit: number;
  disbanded: number;
}

/** Side-effect-free projection returned by `previewEconomy`. */
export interface CivEconomyPreview {
  /** Total after-corruption commerce across all cities (including disordered). */
  commerce: number;
  /** Tax income (disordered cities contribute 0). */
  tax: number;
  /** Research beakers (disordered cities contribute 0). */
  science: number;
  /** Luxury happiness points (disordered cities contribute 0). */
  luxury: number;
  /** Unit + building upkeep. */
  upkeep: number;
  /** tax − upkeep. */
  net: number;
  /** Whether the civ owns at least one city. */
  hasCities: boolean;
}

export const UNIT_MAINTENANCE = 1;
const CITY_CENTER_COMMERCE = 2;
/**
 * Gold per point of after-corruption commerce at 100% tax. Exported because the
 * building cost/usage equation has to convert a building's declared `trade`
 * bonus into actual gold, and a number silently re-derived in two places is
 * exactly how the two drift apart.
 */
export const TRADE_GOLD_MULTIPLIER = 2;
/** Contentment every citizen contributes before any modifiers. */
const BASE_CONTENTMENT = 2;
const CAPTURED_CITY_UNHAPPY = 3;
export const CITY_RADIUS = 2;
const CITY_CENTER_MIN = { food: 2, production: 1, trade: 1 };

/**
 * Food surplus the shared tile assigner must secure before it spends the
 * remaining slots on raw yield.
 *
 * Without it a pop-2 city happily works two 1-food/4-trade tiles (total 5 beats
 * a 2-food tile's 3) and sits at surplus 0 forever: population never grows, so
 * commerce never grows, so the AI can never afford its upkeep or its research.
 * A real headless AI-vs-AI batch caught exactly that — cities stuck at pop 2
 * for 150 rounds with ten free 2-food tiles in their radius.
 */
const MIN_CITY_FOOD_SURPLUS = 1;

/** Food every citizen eats per turn before the size penalty below. */
export const BASE_CITIZEN_FOOD_DEMAND = 2;

/**
 * The city size at which the growing appetite starts. From this size on each
 * citizen eats `CITY_SIZE_FOOD_DEMAND_STEP` more per turn than the one below
 * it, so a city gets progressively harder to feed as it grows.
 *
 * This is the second half of the siege mechanic: a blockade cuts the tiles a
 * city can work, and the size penalty means a big city starves faster than a
 * small one when it is blockaded. A civ is therefore pushed to expand while it
 * can, and punished for letting one city grow fat and isolated.
 */
export const CITY_SIZE_FOOD_DEMAND_THRESHOLD = 6;

/** Extra food each citizen eats per turn, per city size above the threshold. */
export const CITY_SIZE_FOOD_DEMAND_STEP = 0.2;

/**
 * Total food one citizen of a city this size eats per turn.
 *
 * Exported so `TurnManager.processCityGrowth`, the AI's food planning and the
 * shared tile assigner cannot each re-derive it and drift: a famine must be
 * charged at exactly the rate the citizen is assumed to eat at.
 */
export function citizenFoodDemand(population: number): number {
  const sizesAboveThreshold = Math.max(
    0,
    (population ?? 1) - (CITY_SIZE_FOOD_DEMAND_THRESHOLD - 1),
  );
  return BASE_CITIZEN_FOOD_DEMAND + CITY_SIZE_FOOD_DEMAND_STEP * sizesAboveThreshold;
}

/**
 * Floor the treasury is reset to after the AI is forced to disband.
 * Keeps the civ solvent for the next turn (see spec item 6).
 */
export const ABSOLUTE_MIN_GOLD = 8;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export class EconomicManager {
  private gameEngine: GameEngine;
  /**
   * Treasury floor the AI will not spend below. Kept in step with
   * `ABSOLUTE_MIN_GOLD` (the level a bankrupt civ is reset to), so "money I
   * refuse to touch" and "money I would lose anyway to bankruptcy" are the
   * same number rather than a declared-but-unassigned field that every caller
   * had to `?? 8` around.
   */
  AI_MIN_GOLD_RESERVE: number = ABSOLUTE_MIN_GOLD;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ------------------------------------------------------------------
  // Rates
  // ------------------------------------------------------------------

  setRates(civId: number, tax: number, science: number, luxury: number): void {
    const civ = this.gameEngine?.civilizations?.[civId];
    if (!civ) return;

    let t = clamp(Math.round(tax), 0, 100);
    let s = clamp(Math.round(science), 0, 100);
    let l = clamp(Math.round(luxury), 0, 100);

    const sum = t + s + l;
    if (sum > 0 && sum !== 100) {
      const scale = 100 / sum;
      t = Math.round(t * scale);
      s = Math.round(s * scale);
      l = 100 - t - s;
      if (l < 0) {
        l = 0;
        s = 100 - t;
        if (s < 0) {
          s = 0;
          t = 100;
        }
      }
    } else if (sum === 0) {
      t = s = l = 0;
    }

    const gov = getGovernment(civ.government);
    if (gov.forcesZeroRates) {
      t = 0;
      s = 0;
      l = 0;
    } else if (t > gov.maxTaxRate) {
      const excess = t - gov.maxTaxRate;
      t = gov.maxTaxRate;
      if (s + l > 0) {
        const ratio = s / (s + l);
        s = clamp(s + Math.round(excess * ratio), 0, 100 - t);
        l = 100 - t - s;
      } else {
        l = 100 - t;
      }
    }

    civ.taxRate = t;
    civ.scienceRate = s;
    civ.luxuryRate = l;
  }

  getRates(civId: number): { tax: number; science: number; luxury: number } {
    const civ = this.gameEngine?.civilizations?.[civId];
    return {
      tax: civ?.taxRate ?? 50,
      science: civ?.scienceRate ?? 50,
      luxury: civ?.luxuryRate ?? 0,
    };
  }

  /** Switch a civ's government and re-apply rate caps/anarchy rules. */
  setGovernment(civId: number, government: string): void {
    const civ = this.gameEngine?.civilizations?.[civId];
    if (!civ) return;
    civ.government = government;
    const rates = this.getRates(civId);
    this.setRates(civId, rates.tax, rates.science, rates.luxury);
  }

  // ------------------------------------------------------------------
  // Per-city commerce split
  // ------------------------------------------------------------------

  routeTrade(city: City): number {
    if (!Array.isArray(city.tradeRoutes)) return 0;
    return city.tradeRoutes.reduce(
      (total: number, r) => total + (r.trade ?? 0),
      0,
    );
  }

  cityCommerce(city: City): number {
    return (
      Math.max(city?.yields?.trade ?? 0, CITY_CENTER_COMMERCE) +
      this.routeTrade(city)
    );
  }

  cityOutputs(city: City, civ: Civilization): CityEconomicOutputs {
    const commerce = this.cityCommerce(city);
    const gov = getGovernment(civ?.government);
    const effective = commerce * (1 - gov.commercePenalty);
    const corruption = CityUtils.calculateCorruption(city, civ, effective);
    const afterCorruption = Math.max(0, Math.floor(effective - corruption));
    const rates = this.getRates(civ?.id);
    const buildingScience = this.buildingBonuses(city).science;
    const scienceBonus = buildingScience > 0 || (city.buildings?.length ?? 0) > 0
      ? buildingScience
      : (city.scienceBonus ?? 0);
    const specialistScience = this.specialistYields(city).science;
    return {
      commerce: afterCorruption,
      corruption,
      tax: Math.floor(afterCorruption * (rates.tax / 100)) * TRADE_GOLD_MULTIPLIER,
      science:
        Math.round(afterCorruption * (rates.science / 100)) + scienceBonus + specialistScience,
      luxury: Math.floor(afterCorruption * (rates.luxury / 100)),
    };
  }

  /**
   * Maximum gold-per-turn at 100% tax, after corruption and government
   * commerce penalty, summed across all cities.
   */
  maxTaxIncome(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    const gov = getGovernment(civ.government);
    return cities.reduce((total: number, city: City) => {
      const commerce = this.cityCommerce(city);
      const effective = commerce * (1 - gov.commercePenalty);
      const corruption = CityUtils.calculateCorruption(city, civ, effective);
      return (
        total +
        Math.max(0, Math.floor(effective - corruption)) * TRADE_GOLD_MULTIPLIER
      );
    }, 0);
  }

  /**
   * Gold-per-turn contributed by specialists (taxmen) across all cities.
   * Not affected by tax rate.
   */
  maxSpecialistGold(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    return cities.reduce(
      (sum, city) => sum + this.specialistYields(city).gold,
      0,
    );
  }

  /**
   * Maximum number of units a civ can sustain without going negative on gold.
   * Equals full-tax income (tax + specialist gold) divided by 1 gold/unit upkeep,
   * floored. A civ always gets free support for one unit per city, so those
   * don't count toward the cap.
   */
  sustainableUnits(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    const cityCount = cities.length;
    // Taxable income at the civ's ACTUAL tax rate, not at 100%. Planning at
    // 100% made the unit cap systematically too high, so the AI kept building
    // past what it could pay for and then disbanded the surplus for upkeep —
    // an AI-vs-AI run produced 84 units and disbanded 84.
    const taxShare = Math.min(100, Math.max(0, civ.taxRate ?? 50)) / 100;
    const taxIncome = cities.reduce((total: number, city: City) => {
      const commerce = this.cityCommerce(city);
      const gov = getGovernment(civ.government);
      const effective = commerce * (1 - gov.commercePenalty);
      const corruption = CityUtils.calculateCorruption(city, civ, effective);
      const taxable = Math.max(0, Math.floor(effective - corruption));
      return total + Math.floor(taxable * taxShare) * TRADE_GOLD_MULTIPLIER;
    }, 0);
    const specialistGold = this.maxSpecialistGold(civ);
    // Buildings are paid for before units are, so they come off first.
    const totalIncome = Math.max(0, taxIncome + specialistGold - this.buildingUpkeep(civId));
    // Each unit costs 1 gold/turn upkeep (there is no free support: see
    // `unitUpkeep`), so this is a hard budget ceiling, not a soft one.
    const upkeepSlots = Math.max(0, totalIncome - cityCount);
    return upkeepSlots;
  }

  // ------------------------------------------------------------------
  // Real tile-based yields
  // ------------------------------------------------------------------

  private getTile(col: number, row: number): EconomyTile | null {
    try {
      return this.gameEngine?.getTileAt?.(col, row) ?? null;
    } catch {
      return null;
    }
  }

  tileYields(
    tile: EconomyTile | null | undefined,
  ): { food: number; production: number; trade: number } {
    if (!tile) return { food: 0, production: 0, trade: 0 };
    const terrainType = tile.type ?? tile.terrain;
    const base = TERRAIN_PROPERTIES[terrainType];
    let food = base?.food ?? 0;
    let production = base?.production ?? 0;
    let trade = base?.trade ?? 0;

    const resourceYields = getResourceYields(tile.resource, terrainType);
    food += resourceYields.food;
    production += resourceYields.production;
    trade += resourceYields.trade;

    const imp = tile.improvement
      ? IMPROVEMENT_PROPERTIES[tile.improvement]
      : null;
    if (imp) {
      const terrainEffects = imp.effectsByTerrain?.[terrainType];
      if (terrainEffects) {
        food += terrainEffects.food ?? 0;
        production += terrainEffects.production ?? 0;
        trade += terrainEffects.trade ?? 0;
      } else if (imp.effects) {
        food += imp.effects.food ?? 0;
        production += imp.effects.production ?? 0;
        trade += imp.effects.trade ?? 0;
      }
      if (imp.tradeBonusTerrains && terrainType !== TERRAIN_TYPES.RIVER) {
        if (imp.tradeBonusTerrains.includes(terrainType)) {
          trade += 1;
        }
      }
    }

    return { food, production, trade };
  }

  /**
   * Fishing grounds currently occupied by an active Fisher Boat, keyed
   * `col,row`. ANY stage of the route counts as "actively using" the ground —
   * the boat is assigned to it even while sailing home to unload or back out
   * to the net.
   */
  private activeFishingGrounds(): Set<string> {
    const grounds = new Set<string>();
    for (const u of this.gameEngine?.units ?? []) {
      if (u.isDefeated || !u.fishingRoute) continue;
      const tile = u.fishingRoute.fishingTile;
      if (tile) grounds.add(`${tile.col},${tile.row}`);
    }
    return grounds;
  }

  /**
   * A lazily-built fishing-net lookup for a pass over many tiles. `cityTileYields`
   * scanned every unit for EVERY fish tile it was asked about; a city working
   * several fishing grounds (or a fit that ranks all its worked tiles) paid that
   * scan once per tile. The set is built on the first query, so a pass with no
   * fish tile still costs nothing.
   */
  private fishingGroundLookup(): (col: number, row: number) => boolean {
    let grounds: Set<string> | null = null;
    return (col: number, row: number): boolean => {
      grounds ??= this.activeFishingGrounds();
      return grounds.has(`${col},${row}`);
    };
  }

  /**
   * Yields of a tile as worked by a city, given a fishing-net lookup. Fishing
   * grounds only pay their full fish bonus when a Fisher Boat is actively using
   * them: without a boat the city draws one food less from a Fish tile, so the
   * boat (and its catch) is what makes the ground valuable.
   */
  private cityTileYieldsWith(
    tile: EconomyTile | null | undefined,
    hasFishingNet: (col: number, row: number) => boolean,
  ): { food: number; production: number; trade: number } {
    const yields = this.tileYields(tile);
    if (!tile) return yields;
    if (String(tile.resource ?? '').toLowerCase() !== 'fish') return yields;
    if (typeof tile.col !== 'number' || typeof tile.row !== 'number') return yields;
    if (hasFishingNet(tile.col, tile.row)) return yields;
    return { ...yields, food: Math.max(0, yields.food - 1) };
  }

  /**
   * Yields of a tile as worked by a city. Public so the AI and the UI
   * rank/display the same numbers the growth pipeline uses; passes that walk
   * many tiles should use {@link cityTileYieldsWith} with one shared lookup.
   */
  cityTileYields(
    tile: EconomyTile | null | undefined,
  ): { food: number; production: number; trade: number } {
    return this.cityTileYieldsWith(tile, this.fishingGroundLookup());
  }

  private cityTerritory(city: City): Array<{ col: number; row: number }> {
    const territory: Array<{ col: number; row: number }> = [];
    for (let dCol = -CITY_RADIUS; dCol <= CITY_RADIUS; dCol++) {
      for (let dRow = -CITY_RADIUS; dRow <= CITY_RADIUS; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        if (Math.abs(dCol) === CITY_RADIUS && Math.abs(dRow) === CITY_RADIUS)
          continue;
        const col = city.col + dCol;
        const row = city.row + dRow;
        const valid =
          typeof this.gameEngine.squareGrid?.isValidSquare === 'function'
            ? this.gameEngine.squareGrid.isValidSquare(col, row)
            : col >= 0 &&
              row >= 0 &&
              col <
                (this.gameEngine.squareGrid?.width ??
                  Number.POSITIVE_INFINITY) &&
              row <
                (this.gameEngine.squareGrid?.height ??
                  Number.POSITIVE_INFINITY);
        if (valid) {
          territory.push({ col, row });
        }
      }
    }
    return territory;
  }

  /**
   * Whether a FOREIGN unit is standing on this tile.
   *
   * A city works the ground around it, and a foreign army camped on one of its
   * fields takes that field out of production for as long as it stays there.
   * The tile becomes unusable the moment the unit lands and is handed back the
   * moment it leaves — which is what makes the siege a race: every turn spent
   * blockaded is a turn of food the city does not get, and the city starves at
   * `citizenFoodDemand(population)`, which rises with size.
   *
   * A unit of the city's OWN civilization never blocks anything: garrisons,
   * settlers and builders standing on the tiles they feed are the normal case.
   */
  isTileOccupiedByForeignUnit(col: number, row: number, civilizationId: number): boolean {
    const unit = this.gameEngine.getUnitAt?.(col, row);
    if (!unit || unit.isDefeated) return false;
    return unit.civilizationId !== civilizationId;
  }

  private territoryOwner(col: number, row: number): City | null {
    const cities = (this.gameEngine.cities ?? []) as City[];
    return (
      cities
        .map((candidate, index) => ({
          candidate,
          index,
          distance: Math.max(
            Math.abs(candidate.col - col),
            Math.abs(candidate.row - row),
          ),
        }))
        .filter(({ distance }) => distance <= CITY_RADIUS)
        .sort((a, b) => a.distance - b.distance || a.index - b.index)[0]
        ?.candidate ?? null
    );
  }

  /**
   * Tiles a citizen of this city COULD be put on: inside the real city radius
   * (Civ 1 drops the four far corners), not owned by a rival city, not the
   * centre, and not already worked. This is the single source of truth for the
   * "Available Tiles" list and for validating a manual assignment — the naive
   * `max(|dx|,|dy|) <= 2` box wrongly offered corner tiles and other cities'
   * land, which the engine would then refuse anyway.
   */
  getWorkableTiles(city: City): Array<{ col: number; row: number; key: string }> {
    if (!city) return [];
    const worked = city.workingTiles ?? new Set<string>();
    const out: Array<{ col: number; row: number; key: string }> = [];
    for (const sq of this.cityTerritory(city)) {
      const key = `${sq.col},${sq.row}`;
      if (worked.has(key)) continue;
      const owner = this.territoryOwner(sq.col, sq.row);
      if (owner && owner.id !== city.id) continue;
      // Never offer a tile a foreign unit is standing on.
      if (this.isTileOccupiedByForeignUnit(sq.col, sq.row, city.civilizationId)) continue;
      out.push({ col: sq.col, row: sq.row, key });
    }
    return out;
  }

  /**
   * Whether one specific tile is a legal work assignment for this city.
   */
  canWorkTile(city: City, col: number, row: number): boolean {
    if (!city) return false;
    const key = `${col},${row}`;
    if (key === `${city.col},${city.row}`) return false;
    if ((city.workingTiles ?? new Set<string>()).has(key)) return false;
    const owner = this.territoryOwner(col, row);
    if (owner && owner.id !== city.id) return false;
    if (this.isTileOccupiedByForeignUnit(col, row, city.civilizationId)) return false;
    return this.cityTerritory(city).some((sq) => sq.col === col && sq.row === row);
  }

  private cityWorkedTiles(
    city: City,
  ):
    | Array<{
        col: number;
        row: number;
        yields: { food: number; production: number; trade: number };
      }>
    | null {
    if (
      !city ||
      typeof this.gameEngine?.getTileAt !== 'function' ||
      !this.gameEngine?.squareGrid
    ) {
      return null;
    }
    const centerTile = this.getTile(city.col, city.row);
    if (!centerTile) return null;

    const center = this.tileYields(centerTile);
    const centerYields = {
      food: Math.max(CITY_CENTER_MIN.food, center.food),
      production: Math.max(CITY_CENTER_MIN.production, center.production),
      trade: Math.max(CITY_CENTER_MIN.trade, center.trade),
    };

    const candidates: Array<{
      col: number;
      row: number;
      yields: { food: number; production: number; trade: number };
    }> = [];
    const hasFishingNet = this.fishingGroundLookup();
    for (const sq of this.cityTerritory(city)) {
      const owner = this.territoryOwner(sq.col, sq.row);
      if (owner && owner.id !== city.id) continue;
      // A foreign unit on the tile takes it out of production entirely.
      if (this.isTileOccupiedByForeignUnit(sq.col, sq.row, city.civilizationId)) continue;
      const tile = this.getTile(sq.col, sq.row);
      if (!tile) continue;
      candidates.push({
        col: sq.col,
        row: sq.row,
        yields: this.cityTileYieldsWith(tile, hasFishingNet),
      });
    }
    const total = (y: {
      food: number;
      production: number;
      trade: number;
    }): number => y.food + y.production + y.trade;
    candidates.sort((a, b) => total(b.yields) - total(a.yields));

    // The city CENTRE is always worked for free; every citizen then
    // works ONE additional tile in the radius. Counting the centre as a
    // citizen's tile made a size-1 city work only the centre (2 food produced
    // vs 2 eaten) — a permanent 0 surplus, so the city never grew.
    const specCount = (city.specialists ?? []).length;
    const workers = Math.max(0, (city.population ?? 1) - specCount);
    const targetTiles = workers + 1; // free centre + one tile per citizen

    const chosenKeys = new Set<string>([`${city.col},${city.row}`]);
    const worked: Array<{
      col: number;
      row: number;
      yields: { food: number; production: number; trade: number };
    }> = [{ col: city.col, row: city.row, yields: centerYields }];

    const userAssigned = city.userAssignedTiles ?? new Set<string>();
    // Manual allocations are the PLAYER's decision: they are picked first, and
    // the remaining citizens get the best free tiles. (Filling with the auto
    // pick first would silently out-vote the player whenever the city grows.)
    for (const cand of candidates) {
      if (worked.length >= targetTiles) break;
      const key = `${cand.col},${cand.row}`;
      if (key === `${city.col},${city.row}`) continue;
      if (!userAssigned.has(key) || chosenKeys.has(key)) continue;
      chosenKeys.add(key);
      worked.push(cand);
    }

    // Food floor FIRST: buy enough food to out-eat the citizens (plus any
    // settlers this city supports) before spending slots on raw yield. This
    // runs before the total-yield fill so a growing city never trades its last
    // food away for trade/production it cannot afford to keep.
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const balance = this.cityFoodBalance(city, civ);
    const foodTarget = balance.citizenConsumption + balance.settlerSupport + MIN_CITY_FOOD_SURPLUS;
    let foodSum = worked.reduce((n, w) => n + w.yields.food, 0);
    if (foodSum < foodTarget) {
      const byFood = [...candidates].sort(
        (a, b) => b.yields.food - a.yields.food || total(b.yields) - total(a.yields),
      );
      for (const cand of byFood) {
        if (worked.length >= targetTiles || foodSum >= foodTarget) break;
        const key = `${cand.col},${cand.row}`;
        if (chosenKeys.has(key)) continue;
        chosenKeys.add(key);
        worked.push(cand);
        foodSum += cand.yields.food;
      }
    }

    for (const cand of candidates) {
      if (worked.length >= targetTiles) break;
      const key = `${cand.col},${cand.row}`;
      if (chosenKeys.has(key)) continue;
      chosenKeys.add(key);
      worked.push(cand);
    }

    city.workingTiles = chosenKeys;
    return worked;
  }

  private buildingBonuses(city: City): { trade: number; science: number } {
    const buildings = city?.buildings ?? [];
    let trade = 0;
    let science = 0;
    for (const b of buildings) {
      const id =
        typeof b === 'string'
          ? b
          : (b as { id?: string; type?: string })?.id ??
            (b as { type?: string })?.type ??
            '';
      const effects = BUILDING_PROPERTIES[id]?.effects;
      if (effects) {
        trade += effects.trade ?? 0;
        science += effects.science ?? 0;
      }
    }
    return { trade, science };
  }

  specialistYields(city: City): {
    luxury: number;
    gold: number;
    science: number;
  } {
    const specs = city.specialists ?? [];
    let luxury = 0,
      gold = 0,
      science = 0;
    for (const t of specs) {
      const s = SPECIALIST_YIELDS[t];
      if (s) {
        luxury += s.luxury;
        gold += s.gold;
        science += s.science;
      }
    }
    return { luxury, gold, science };
  }

  /**
   * Fit a city's worked-tile set to the citizens it actually has: the centre is
   * free, so a city works `1 + population - specialists` tiles. Called whenever
   * the population changes (growth, starvation, capture, a settler joining).
   *
   * Without it a city that just lost a citizen kept working its old tiles, and
   * since `cityFoodBalance` charges consumption per CITIZEN while the tile
   * yields are counted per TILE, the extra tiles were free food. Excess tiles
   * are dropped worst-first, never a manually assigned one.
   */
  /**
   * Bring a city back inside its own population after losing citizens.
   *
   * Two things are sized by population and both have to shrink together: the
   * specialists (entertainers, taxmen…) and the worked tiles. Trimming only the
   * tiles left cities with MORE specialists than citizens — a settler
   * completing in a size-2 city took one pop and left "2 specialists, pop 1",
   * which the long-run invariant suite correctly refused.
   */
  fitCityToPopulation(city: City): boolean {
    let changed = false;
    const population = Math.max(1, city.population ?? 1);
    const specialists = city.specialists ?? [];
    if (specialists.length > population) {
      // Entertainers are the most expendable — a temple replaces them — so they
      // go first; anything after that drops from the end.
      const kept = [...specialists];
      while (kept.length > population) {
        const entertainer = kept.lastIndexOf('entertainer');
        kept.splice(entertainer >= 0 ? entertainer : kept.length - 1, 1);
      }
      city.specialists = kept;
      changed = true;
    }
    if (this.fitWorkedTilesToPopulation(city)) changed = true;
    return changed;
  }

  fitWorkedTilesToPopulation(city: City): boolean {
    const working = city.workingTiles;
    if (!(working instanceof Set) || working.size === 0) return false;
    // The centre tile is always worked, so the target never drops below 1 —
    // otherwise a city that lost citizens would try to shed its own centre.
    const target = Math.max(1, 1 + (city.population ?? 1) - (city.specialists ?? []).length);
    if (working.size <= target) return false;

    const centerKey = `${city.col},${city.row}`;
    const manual = city.userAssignedTiles instanceof Set ? city.userAssignedTiles : new Set<string>();
    const droppable: Array<{ key: string; total: number }> = [];
    const hasFishingNet = this.fishingGroundLookup();
    for (const key of working) {
      if (key === centerKey) continue;
      if (manual.has(key)) continue; // the player's choice stays
      const sep = key.indexOf(',');
      const y = this.cityTileYieldsWith(
        this.getTile(Number(key.slice(0, sep)), Number(key.slice(sep + 1))),
        hasFishingNet,
      );
      droppable.push({ key, total: y.food + y.production + y.trade });
    }
    // Worst tile first, so the city keeps its best land.
    droppable.sort((a, b) => a.total - b.total);
    let excess = working.size - target;
    for (const { key } of droppable) {
      if (excess <= 0) break;
      working.delete(key);
      excess--;
    }
    city.workingTiles = working;
    return true;
  }

  recomputeCityYields(city: City): void {
    const worked = this.cityWorkedTiles(city);
    if (!worked) return;
    let food = 0,
      production = 0,
      trade = 0;
    for (const t of worked) {
      food += t.yields.food;
      production += t.yields.production;
      trade += t.yields.trade;
    }
    trade += this.buildingBonuses(city).trade;
    city.yields = {
      food,
      production,
      trade: Math.max(trade, CITY_CENTER_COMMERCE),
    };
    city.scienceBonus = this.buildingBonuses(city).science;
  }

  /**
   * Recompute a city's yields from its CURRENT workingTiles WITHOUT
   * auto-reshuffling them. `recomputeCityYields` re-picks the best tiles,
   * which would undo a manual pick-up/drop performed this turn. Use this
   * right after a manual reassign so the player's chosen layout holds for the
   * rest of the turn (the per-turn recompute still honors userAssignedTiles).
   */
  refreshYieldsFromWorkingTiles(city: City): void {
    if (!city) return;
    let food = 0;
    let production = 0;
    let trade = 0;
    const hasFishingNet = this.fishingGroundLookup();
    // Drop tiles a foreign unit has taken, so a blockaded field stops paying
    // the moment it is occupied — not just after the next automatic re-pick.
    // Without this a manually assigned tile would keep feeding a besieged city
    // for as long as nobody happened to reassign the citizen.
    const worked = city.workingTiles ?? new Set<string>();
    for (const key of Array.from(worked)) {
      const sep = key.indexOf(',');
      if (sep === -1) continue;
      const col = Number(key.slice(0, sep));
      const row = Number(key.slice(sep + 1));
      if (Number.isNaN(col) || Number.isNaN(row)) continue;
      if (this.isTileOccupiedByForeignUnit(col, row, city.civilizationId)) {
        worked.delete(key);
        city.userAssignedTiles?.delete(key);
        continue;
      }
      const y = this.cityTileYieldsWith(this.getTile(col, row), hasFishingNet);
      food += y.food;
      production += y.production;
      trade += y.trade;
    }
    city.yields = {
      food,
      production,
      trade: Math.max(trade, CITY_CENTER_COMMERCE),
    };
    city.scienceBonus = this.buildingBonuses(city).science;
  }

  /**
   * The city's real food balance for this turn — the SAME math the growth
   * pipeline uses (`TurnManager.processCityGrowth`): every citizen eats
   * `citizenFoodDemand(population)` food (2 to start with, +0.2 per head per
   * size above 5), and settlers owned by the city eat 1 each (2 under Republic
   * and Democracy). AI city management and production decisions consult this
   * instead of re-deriving it, so famine prevention and settler support use
   * exactly the numbers the engine charges.
   */
  cityFoodBalance(city: City, civ: Civilization | undefined): {
    produced: number;
    citizenConsumption: number;
    settlerSupport: number;
    /** produced − consumption (may be negative). */
    surplus: number;
    storage: number;
    growthThreshold: number;
    granaryLine: number;
    hasGranary: boolean;
    /** −1 when the city is not growing / not starving. */
    turnsUntilGrowth: number;
    turnsUntilStarvation: number;
  } {
    const population = city?.population ?? 1;
    const government = String(civ?.government ?? 'despotism').toLowerCase();
    const settlerFoodPerTurn = government === 'republic' || government === 'democracy' ? 2 : 1;
    const settlerSupport = (this.gameEngine.units ?? []).filter(
      (unit) =>
        unit.type === 'settler' &&
        unit.homeCityId === city.id &&
        !unit.isNoneUnit,
    ).length * settlerFoodPerTurn;

    const produced = city?.yields?.food ?? city?.food ?? 0;
    // Citizens eat 2 food each to start with, and 0.2 more per head for every
    // size above 5 — so a large city is genuinely harder to keep fed than a
    // small one, which is what turns a blockade into a siege.
    const citizenConsumption = population * citizenFoodDemand(population);
    const surplus = produced - citizenConsumption - settlerSupport;
    const storage = city?.foodStored ?? 0;
    const growthThreshold = (population + 1) * 10;
    const hasGranary = city?.buildings?.includes?.(BUILDING_TYPES.GRANARY) ?? false;
    const granaryLine = hasGranary ? Math.floor(growthThreshold / 2) : 0;

    return {
      produced,
      citizenConsumption,
      settlerSupport,
      surplus,
      storage,
      growthThreshold,
      granaryLine,
      hasGranary,
      turnsUntilGrowth:
        surplus > 0 ? Math.ceil((growthThreshold - storage) / surplus) : -1,
      turnsUntilStarvation:
        surplus < 0 ? Math.ceil(storage / Math.abs(surplus)) : -1,
    };
  }

  /** Happiness for one city (base + luxury + buildings + government bonus). */
  cityHappiness(city: City, civ: Civilization): CityHappinessResult {
    const out = this.cityOutputs(city, civ);
    const gov = getGovernment(civ?.government);
    const population = city?.population ?? 1;
    const capturedUnrest =
      city?.capturedTurns && city.capturedTurns > 0 ? CAPTURED_CITY_UNHAPPY : 0;
    const unhappiness =
      Math.max(0, population - gov.tolerance) + capturedUnrest;
    const specLuxury = this.specialistYields(city).luxury;

    const garrisonUnits = (this.gameEngine?.units ?? []).filter(
      (u: Unit) =>
        u.civilizationId === civ.id &&
        u.col === city.col &&
        u.row === city.row &&
        !u.isDefeated &&
        (u.attack ?? 0) > 0,
    ).length;

    const govName = (gov.name ?? '').toLowerCase();
    const martialLawMax =
      govName === 'despotism' || govName === 'anarchy'
        ? 4
        : govName === 'monarchy' || govName === 'communism'
          ? 3
          : 0;
    const martialLawBonus = Math.min(garrisonUnits, martialLawMax);

    const happiness =
      out.luxury +
      specLuxury +
      martialLawBonus +
      this.buildingHappiness(city) +
      gov.happinessBonus +
      BASE_CONTENTMENT;
    return { happiness, unhappiness, disorder: unhappiness > happiness };
  }

  applyCityOutputs(
    city: City,
    civ: Civilization,
  ): CityEconomicOutputs & CityHappinessResult {
    const out = this.cityOutputs(city, civ);
    const happiness = this.cityHappiness(city, civ);
    const effective = happiness.disorder
      ? { ...out, tax: 0, science: 0, commerce: 0 }
      : out;
    city.tax = effective.tax;
    city.science = effective.science;
    city.luxury = effective.luxury;
    city.happiness = happiness.happiness;
    city.unhappiness = happiness.unhappiness;
    city.disorder = happiness.disorder;
    return { ...effective, ...happiness };
  }

  private buildingHappiness(city: City): number {
    const buildings = city?.buildings ?? [];
    return buildings.reduce((total: number, b: unknown) => {
      const id =
        typeof b === 'string'
          ? b
          : (b as { id?: string; type?: string })?.id ??
            (b as { type?: string })?.type ??
            '';
      return total + (BUILDING_PROPERTIES[id]?.effects?.happiness ?? 0);
    }, 0);
  }

  // ------------------------------------------------------------------
  // Preview (side-effect-free, used by RatesModal)
  // ------------------------------------------------------------------

  /**
   * Projected per-turn economy for `civ` using the **proposed** rates.
   * Mirrors the real `processTurn` pipeline (commerce → corruption → rate
   * split → disorder check → upkeep) but writes nothing to city state.
   * The RatesModal is the sole consumer; AI and gameplay use
   * `applyCityOutputs` / `processTurn` instead.
   */
  previewEconomy(
    civ: Civilization,
    proposedRates: { tax: number; science: number; luxury: number },
  ): CivEconomyPreview {
    const civId = civ?.id;
    if (civId == null) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    if (cities.length === 0) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }

    const gov = getGovernment(civ.government);

    let commerce = 0;
    let tax = 0;
    let science = 0;
    let luxury = 0;

    for (const city of cities) {
      // After-corruption commerce (same as cityOutputs).
      const rawCommerce = this.cityCommerce(city);
      const effective = rawCommerce * (1 - gov.commercePenalty);
      const corruption = CityUtils.calculateCorruption(city, civ, effective);
      const afterCorruption = Math.max(0, Math.floor(effective - corruption));
      commerce += afterCorruption;

      // --- Disorder check (mirrors cityHappiness) ---
      const population = city?.population ?? 1;
      const capturedUnrest =
        city?.capturedTurns && city.capturedTurns > 0 ? CAPTURED_CITY_UNHAPPY : 0;
      const unhappiness =
        Math.max(0, population - gov.tolerance) + capturedUnrest;

      const specLuxury = this.specialistYields(city).luxury;

      const garrisonUnits = (this.gameEngine?.units ?? []).filter(
        (u: Unit) =>
          u.civilizationId === civId &&
          u.col === city.col &&
          u.row === city.row &&
          !u.isDefeated &&
          (u.attack ?? 0) > 0,
      ).length;
      const govName = (gov.name ?? '').toLowerCase();
      const martialLawMax =
        govName === 'despotism' || govName === 'anarchy'
          ? 4
          : govName === 'monarchy' || govName === 'communism'
            ? 3
            : 0;
      const martialLawBonus = Math.min(garrisonUnits, martialLawMax);

      // Luxury from the *proposed* rate (not the current rate).
      const cityLuxury = Math.floor(afterCorruption * (proposedRates.luxury / 100));

      const happiness =
        cityLuxury +
        specLuxury +
        martialLawBonus +
        this.buildingHappiness(city) +
        gov.happinessBonus +
        BASE_CONTENTMENT;
      const disorder = unhappiness > happiness;

      if (disorder) {
        // Disordered city produces zero tax/science/luxury (Civ1 rule).
        continue;
      }

      tax += Math.floor((afterCorruption * proposedRates.tax) / 100) * TRADE_GOLD_MULTIPLIER;
      const buildingScience = this.buildingBonuses(city).science;
      const scienceBonus = buildingScience > 0 || (city.buildings?.length ?? 0) > 0
        ? buildingScience
        : (city.scienceBonus ?? 0);
      science += Math.round((afterCorruption * proposedRates.science) / 100)
        + scienceBonus
        + this.specialistYields(city).science;
      luxury += cityLuxury;
    }

    const upkeep = this.totalUpkeep(civId);
    return { commerce, tax, science, luxury, upkeep, net: tax - upkeep, hasCities: true };
  }

  // ------------------------------------------------------------------
  // Upkeep (Units + Buildings)
  // ------------------------------------------------------------------

  civScience(civId: number): number {
    return this.sumCityOutput(civId, 'science');
  }

  civGold(civId: number): number {
    return this.sumCityOutput(civId, 'tax');
  }

  civLuxury(civId: number): number {
    return this.sumCityOutput(civId, 'luxury');
  }

  civCommerce(civId: number): number {
    const civ = this.gameEngine?.civilizations?.[civId];
    if (!civ) return 0;
    const cities = this.gameEngine?.cities?.filter((c: City) => c.civilizationId === civId) ?? [];
    return cities.reduce((total: number, city: City) => total + this.cityOutputs(city, civ).commerce, 0);
  }

  private sumCityOutput(civId: number, key: 'tax' | 'science' | 'luxury'): number {
    const civ = this.gameEngine?.civilizations?.[civId];
    if (!civ) return 0;
    const cities = this.gameEngine?.cities?.filter((c: City) => c.civilizationId === civId) ?? [];
    return cities.reduce((total: number, city: City) => total + this.cityOutputs(city, civ)[key], 0);
  }

    unitUpkeep(civId: number): number {
    const units = this.gameEngine?.units?.filter((u: Unit) =>
      u.civilizationId === civId
      && !u.isDefeated
      && (u.health == null || u.health > 0),
    ) ?? [];
    // Units always cost their full maintenance price.
    // NONE units (starting/hut units and settlers released by a destroyed
    // size-1 city) have no home city and no support/upkeep burden.
    const totalMaintenance = units.reduce((total: number, u: Unit) => {
      if (u.isNoneUnit || u.homeCityId === null) return total;
      return total + (u.maintenance ?? UNIT_MAINTENANCE);
    }, 0);

    return totalMaintenance;
  }


  /**
   * Total gold-per-turn upkeep cost of all buildings across the civ's cities.
   * Supports both `upkeep` and `maintenance` keys on building properties.
   */
  buildingUpkeep(civId: number): number {
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    let total = 0;
    for (const city of cities) {
      for (const b of city.buildings ?? []) {
        const id =
          typeof b === 'string'
            ? b
            : (b as { id?: string; type?: string })?.id ??
              (b as { type?: string })?.type ??
              '';
        const props = BUILDING_PROPERTIES[id] as
          | { upkeep?: number; maintenance?: number }
          | undefined;
        if (!props) continue;
        total += props.upkeep ?? props.maintenance ?? 0;
      }
    }
    return total;
  }

  totalUpkeep(civId: number): number {
    return this.unitUpkeep(civId) + this.buildingUpkeep(civId);
  }

  // ------------------------------------------------------------------
  // Disbanding
  // ------------------------------------------------------------------

  /**
   * Ids of units an AI mission depends on: the colony settler and its ferry,
   * and the invasion troops and their ferry. Read structurally from the civ's
   * player storage so the economy does not need to import the AI mission
   * types (they live in AIManager).
   */
  private collectMissionUnitIds(civId: number): Set<string> {
    const ids = new Set<string>();
    const storage = this.gameEngine?.getPlayerStorage?.(civId);
    const turnData = storage?.turnData as unknown as
      | {
          colonyMission?: { settlerId?: string; ferryId?: string | null };
          invasionMission?: { troopIds?: string[]; landedIds?: string[]; ferryId?: string | null };
        }
      | undefined;
    if (!turnData) return ids;
    if (turnData.colonyMission?.settlerId) ids.add(String(turnData.colonyMission.settlerId));
    if (turnData.colonyMission?.ferryId) ids.add(String(turnData.colonyMission.ferryId));
    if (turnData.invasionMission?.ferryId) ids.add(String(turnData.invasionMission.ferryId));
    for (const id of turnData.invasionMission?.troopIds ?? []) ids.add(String(id));
    for (const id of turnData.invasionMission?.landedIds ?? []) ids.add(String(id));
    return ids;
  }

  /**
   * Disband units until the deficit is covered.
   *
   * Disband order: non-defenders first, then non-scouts, then higher
   * maintenance, then higher unit cost. The last defender of any city is
   * preserved during the first pass; a second pass removes them only if the
   * deficit cannot otherwise be covered (spec item 6). Units committed to an
   * AI mission are never candidates — see {@link collectMissionUnitIds}.
   */
  private disbandUnitsToCoverDeficit(
    civId: number,
    deficit: number,
    cities: City[],
  ): number {
    // Units committed to an AI colony/invasion mission — or already loaded
    // aboard a ferry — are protected. Disbanding the hull aborts the crossing
    // and strands the settler or army on the home island; a profiled naval
    // session disbanded 22 ferries, which reset every mission to stage
    // 'gather' so no colony was ever founded after the first.
    const missionUnitIds = this.collectMissionUnitIds(civId);
    const isMissionUnit = (u: Unit): boolean =>
      u.id != null && missionUnitIds.has(String(u.id));
    const isLoadedFerry = (u: Unit): boolean =>
      u.type === 'ferry' && (this.gameEngine?.getFerryCargo?.(u)?.length ?? 0) > 0;

    const allUnits = (this.gameEngine?.units ?? []).filter(
      (u: Unit) =>
        u.civilizationId === civId &&
        !u.isDefeated &&
        (u.health == null || u.health > 0) &&
        // A Fisher Boat on an active route is a food producer: the
        // FisherEconomics equation approved the boat because its food value
        // beats its 1-gold upkeep. Disbanding it to save that upkeep destroys
        // value (and the whole catch in its hold), so a working boat is never
        // a disband candidate — an idle one still is.
        !(u.type === 'fisher_boat' && u.fishingRoute) &&
        // A Caravan is one-shot income in transit: disbanding it destroys the
        // shields and the route it was carrying. New production is blocked by
        // the affordability gate instead of liquidating the ones under way.
        u.type !== 'caravan' &&
        !isMissionUnit(u) &&
        !isLoadedFerry(u),
    );
    if (allUnits.length === 0) return 0;

    const isDefender = (u: Unit): boolean => (u.attack ?? 0) > 0;
    const costOf = (u: Unit): number => UNIT_PROPS[u?.type]?.cost ?? 0;
    const isScout = (u: Unit): number => (u?.type === 'scout' ? 1 : 0);
    const maintenanceOf = (u: Unit): number =>
      u.maintenance ?? UNIT_MAINTENANCE;

    // Track defender counts per city tile so we can enforce "leave at least
    // one garrison" during the first pass.
    const cityKeys = new Set(cities.map((c) => `${c.col},${c.row}`));
    const defenderCounts = new Map<string, number>();
    for (const u of allUnits) {
      if (!isDefender(u)) continue;
      const key = `${u.col},${u.row}`;
      defenderCounts.set(key, (defenderCounts.get(key) ?? 0) + 1);
    }

    const isSoleCityDefender = (u: Unit): boolean => {
      if (!isDefender(u)) return false;
      const key = `${u.col},${u.row}`;
      return cityKeys.has(key) && (defenderCounts.get(key) ?? 0) <= 1;
    };

    // Sort priority (disband first): non-sole-defender, non-scout, then
    // descending maintenance, then descending unit cost.
    const ordered = [...allUnits].sort(
      (a, b) =>
        Number(isSoleCityDefender(a)) - Number(isSoleCityDefender(b)) ||
        isScout(a) - isScout(b) ||
        maintenanceOf(b) - maintenanceOf(a) ||
        costOf(b) - costOf(a),
    );

    const removedIds = new Set<number | string>();
    let remaining = deficit;
    let disbanded = 0;

    const tryDisband = (unit: Unit, force: boolean): boolean => {
      if (removedIds.has(unit.id)) return false;
      if (!force && isSoleCityDefender(unit)) return false;
      const key = `${unit.col},${unit.row}`;
      if (isDefender(unit)) {
        defenderCounts.set(
          key,
          Math.max(0, (defenderCounts.get(key) ?? 1) - 1),
        );
      }
      removedIds.add(unit.id);
      remaining -= maintenanceOf(unit);
      disbanded++;
      return true;
    };

    // Pass 1: honour "don't strip a city bare".
    for (const unit of ordered) {
      if (remaining <= 0) break;
      tryDisband(unit, false);
    }
    // Pass 2: survival trumps defense.
    if (remaining > 0) {
      for (const unit of ordered) {
        if (remaining <= 0) break;
        tryDisband(unit, true);
      }
    }

    if (removedIds.size > 0) {
      // A disbanded Ferry takes its passenger with it (an orphaned embarked
      // unit would be invisible and stuck).
      const cargoIds = this.gameEngine.units
        .filter((u: Unit) => u.embarkedOn && removedIds.has(u.embarkedOn))
        .map((u: Unit) => u.id);
      for (const id of cargoIds) removedIds.add(id);

      const removedUnits = this.gameEngine.units.filter((u: Unit) =>
        removedIds.has(u.id),
      );
      this.gameEngine.units = this.gameEngine.units.filter(
        (u: Unit) => !removedIds.has(u.id),
      );
      if (typeof this.gameEngine.onStateChange === 'function') {
        for (const unit of removedUnits) {
          this.gameEngine.onStateChange('UNIT_DISBANDED', {
            unit,
            reason: 'upkeep_deficit',
          });
        }
      }
    }

    return disbanded;
  }

  // ------------------------------------------------------------------
  // Turn Orchestration
  // ------------------------------------------------------------------

  processTurn(civ: Civilization): ProcessTurnResult {
    const civId = civ?.id;
    if (!civ || civId == null) {
      return {
        tax: 0,
        science: 0,
        luxury: 0,
        commerce: 0,
        upkeep: 0,
        deficit: 0,
        disbanded: 0,
      };
    }
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );

    let taxTotal = 0;
    let scienceTotal = 0;
    let luxuryTotal = 0;
    let commerceTotal = 0;
    let specGoldTotal = 0;

    const accumulateOutputs = () => {
      taxTotal = 0;
      scienceTotal = 0;
      luxuryTotal = 0;
      commerceTotal = 0;
      specGoldTotal = 0;
      for (const city of cities) {
        const out = this.applyCityOutputs(city, civ);
        taxTotal += out.tax;
        scienceTotal += out.science;
        luxuryTotal += out.luxury;
        commerceTotal += out.commerce;
        const spec = this.specialistYields(city);
        specGoldTotal += spec.gold;
      }
    };

    for (const city of cities) {
      this.recomputeCityYields(city);
    }
    accumulateOutputs();

    civ.resources.trade = commerceTotal;
    // Research is locked for the first RESEARCH_UNLOCK_ROUND rounds, and the
    // research step does nothing while no technology is selected — so the
    // science of those rounds used to be overwritten here and lost forever
    // (the docstring claimed it was "banked"). Bank it on the civ instead: when
    // a technology is finally chosen, the stored beakers are spent first.
    const banking = scienceTotal > 0 && !civ.currentResearch;
    if (banking) {
      civ.bankedScience = (civ.bankedScience ?? 0) + scienceTotal;
    }
    civ.resources.science = scienceTotal;
    civ.resources.production = 0;
    civ.resources.food = 0;

    const upkeep = this.totalUpkeep(civId);
    civ.resources.gold =
      (civ.resources.gold ?? 0) + taxTotal + specGoldTotal - upkeep;

    // ---- Emergency tax raise before disbanding -----------------------
    // Prefer maxing tax and killing science/luxury over losing units. The
    // AIEconomicManager normally handles this proactively; this is the
    // last-ditch fallback for cases it couldn't predict.
    if (civ.resources.gold < 0) {
      const gov = getGovernment(civ.government);
      const alreadyMaxed =
        (civ.taxRate ?? 0) >= gov.maxTaxRate &&
        (civ.scienceRate ?? 0) === 0 &&
        (civ.luxuryRate ?? 0) === 0;
      if (!alreadyMaxed) {
        const oldGoldIncome = taxTotal + specGoldTotal;
        this.setRates(civId, gov.maxTaxRate, 0, 0);
        accumulateOutputs();
        const newGoldIncome = taxTotal + specGoldTotal;
        civ.resources.gold += newGoldIncome - oldGoldIncome;
        civ.resources.trade = commerceTotal;
        civ.resources.science = scienceTotal;
      }
    }

    // ---- Disbanding protocol ----------------------------------------
    let deficit = 0;
    let disbanded = 0;
    if (civ.resources.gold < 0) {
      deficit = Math.abs(civ.resources.gold);
      const incomeAfterTax = taxTotal + specGoldTotal;
      let unitsToRemove = Math.max(
        0,
        this.totalUpkeep(civId) - incomeAfterTax,
      );
      while (unitsToRemove > 0) {
        const removed = this.disbandUnitsToCoverDeficit(
          civId,
          unitsToRemove,
          cities,
        );
        if (removed === 0) break;
        disbanded += removed;
        unitsToRemove = Math.max(
          0,
          this.totalUpkeep(civId) - incomeAfterTax,
        );
      }
      // Forgive the accumulated deficit and restore the AI-safe floor.
      civ.resources.gold = Math.max(civ.resources.gold, ABSOLUTE_MIN_GOLD);
    }

    return {
      tax: taxTotal,
      science: scienceTotal,
      luxury: luxuryTotal,
      commerce: commerceTotal,
      upkeep,
      deficit,
      disbanded,
    };
  }


  
}