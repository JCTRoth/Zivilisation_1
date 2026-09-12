/**
 * EconomicManager — the Tax/Science/Luxury economic core for Civ1.
 *
 * Handles universal economic rules: tile yields, city commerce, rate splitting,
 * happiness/disorder, and total upkeep (Units + Buildings).
 * AI-specific logic (reserve targets, preventative tax raising, sustainable
 * army sizing) is delegated to AIEconomicManager.
 */

import { BUILDING_PROPERTIES } from '../../data/BuildingConstants';
import { getGovernment } from '../../data/GovernmentData';
import { CityUtils } from '../../utils/CityUtils';
import { UNIT_PROPS } from '../../utils/Constants';
import {
  TERRAIN_PROPERTIES,
  TERRAIN_TYPES,
  SPECIAL_RESOURCES,
} from '../../data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES } from '../../data/TileImprovementConstants';
import { SPECIALIST_YIELDS } from '../../data/GameConstants';
import type { City, Civilization, Unit } from '../../../types/game';
import GameEngine from './GameEngine';

interface EconomyTile {
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

export const UNIT_MAINTENANCE = 1;
export const CITY_CENTER_COMMERCE = 2;
export const TRADE_GOLD_MULTIPLIER = 2;
export const BASE_CONTENTMENT = 2;
export const CAPTURED_CITY_UNHAPPY = 3;
export const CITY_RADIUS = 2;
export const CITY_CENTER_MIN = { food: 2, production: 1, trade: 1 };

/**
 * Floor the treasury is reset to after the AI is forced to disband.
 * Keeps the civ solvent for the next turn (see spec item 6).
 */
export const ABSOLUTE_MIN_GOLD = 8;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export class EconomicManager {
  private gameEngine: GameEngine;

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
    const scienceBonus = city?.scienceBonus ?? 0;
    return {
      commerce: afterCorruption,
      corruption,
      tax: Math.floor(afterCorruption * (rates.tax / 100)) * TRADE_GOLD_MULTIPLIER,
      science:
        Math.round(afterCorruption * (rates.science / 100)) + scienceBonus,
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

    const resName = tile.resource;
    if (resName) {
      const special = SPECIAL_RESOURCES.find(
        (r) => r.name.toLowerCase() === String(resName).toLowerCase(),
      );
      if (special) {
        food += special.food ?? 0;
        production += special.production ?? 0;
        trade += special.trade ?? 0;
      }
    }

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
    for (const sq of this.cityTerritory(city)) {
      const owner = this.territoryOwner(sq.col, sq.row);
      if (owner && owner.id !== city.id) continue;
      const tile = this.getTile(sq.col, sq.row);
      if (!tile) continue;
      candidates.push({
        col: sq.col,
        row: sq.row,
        yields: this.tileYields(tile),
      });
    }
    const total = (y: {
      food: number;
      production: number;
      trade: number;
    }): number => y.food + y.production + y.trade;
    candidates.sort((a, b) => total(b.yields) - total(a.yields));

    const specCount = (city.specialists ?? []).length;
    const pop = Math.max(1, (city.population ?? 1) - specCount);

    const chosenKeys = new Set<string>([`${city.col},${city.row}`]);
    const worked: Array<{
      col: number;
      row: number;
      yields: { food: number; production: number; trade: number };
    }> = [{ col: city.col, row: city.row, yields: centerYields }];

    const userAssigned = city.userAssignedTiles ?? new Set<string>();
    for (const cand of candidates) {
      if (worked.length >= pop) break;
      const key = `${cand.col},${cand.row}`;
      if (!userAssigned.has(key) || chosenKeys.has(key)) continue;
      chosenKeys.add(key);
      worked.push(cand);
    }

    for (const cand of candidates) {
      if (worked.length >= pop) break;
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
    for (const key of city.workingTiles ?? []) {
      const sep = key.indexOf(',');
      if (sep === -1) continue;
      const col = Number(key.slice(0, sep));
      const row = Number(key.slice(sep + 1));
      if (Number.isNaN(col) || Number.isNaN(row)) continue;
      const y = this.tileYields(this.getTile(col, row));
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
   * Disband units until the deficit is covered.
   *
   * Disband order: non-defenders first, then non-scouts, then higher
   * maintenance, then higher unit cost. The last defender of any city is
   * preserved during the first pass; a second pass removes them only if the
   * deficit cannot otherwise be covered (spec item 6).
   */
  private disbandUnitsToCoverDeficit(
    civId: number,
    deficit: number,
    cities: City[],
  ): number {
    const allUnits = (this.gameEngine?.units ?? []).filter(
      (u: Unit) =>
        u.civilizationId === civId &&
        !u.isDefeated &&
        (u.health == null || u.health > 0),
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
    let specScienceTotal = 0;

    const accumulateOutputs = () => {
      taxTotal = 0;
      scienceTotal = 0;
      luxuryTotal = 0;
      commerceTotal = 0;
      specGoldTotal = 0;
      specScienceTotal = 0;
      for (const city of cities) {
        const out = this.applyCityOutputs(city, civ);
        taxTotal += out.tax;
        scienceTotal += out.science;
        luxuryTotal += out.luxury;
        commerceTotal += out.commerce;
        const spec = this.specialistYields(city);
        specGoldTotal += spec.gold;
        specScienceTotal += spec.science;
      }
    };

    for (const city of cities) {
      this.recomputeCityYields(city);
    }
    accumulateOutputs();

    civ.resources.trade = commerceTotal;
    civ.resources.science = scienceTotal + specScienceTotal;
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
        civ.resources.science = scienceTotal + specScienceTotal;
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