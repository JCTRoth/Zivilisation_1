/**
 * AIEconomicManager — AI-specific economic planning and rate management.
 *
 * Handles dynamic rate adjustment, sustainable army sizing, and treasury
 * reserve management. Runs BEFORE EconomicManager.processTurn() to set rates
 * proactively and prevent disbanding.
 *
 * This module owns the AI reserve policy: `sustainableUnits()` is the
 * authoritative cap that AutoProduction and AI decision-making should consult
 * before queueing new military units.
 */

import { getGovernment } from '../../data/GovernmentData';
import { CityUtils } from '../../utils/CityUtils';
import type { City, Civilization } from '../../../types/game';
import { resolveAICivStrategy, type StrategyProfile } from './AITypes';
import GameEngine from './GameEngine';
import {
  EconomicManager,
  UNIT_MAINTENANCE,
  ABSOLUTE_MIN_GOLD,
} from './EconomicManager';

export const AI_SCIENCE_FLOOR = 20;
export const AI_MIN_TAX = 35;
export const AI_RESERVE_TURNS: Record<StrategyProfile, number> = {
  military_expansion: 3,
  defensive_turtle: 3,
  balanced_growth: 2,
  early_expansion: 2,
  wonder_rush: 2,
  science_focus: 2,
};
export const AI_RESERVE_REBUILD = 0.1;
export const AI_MIN_GOLD_RESERVE = ABSOLUTE_MIN_GOLD;

export class AIEconomicManager {
  private gameEngine: GameEngine;
  private econ: EconomicManager;

  constructor(gameEngine: GameEngine, econ: EconomicManager) {
    this.gameEngine = gameEngine;
    this.econ = econ;
  }

  /**
   * Main AI pre-processing hook. Call this BEFORE EconomicManager.processTurn().
   */
  public preProcessTurn(civ: Civilization): void {
    if (!civ || civ.isHuman) return;
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civ.id,
    );
    if (cities.length === 0) return;

    this.adjustRatesForAI(civ, cities);
  }

  /**
   * Public helper for AutoProduction / AI unit-queue logic.
   * Returns the number of units currently fielded by this civ.
   */
  public currentUnitCount(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    return (this.gameEngine?.units ?? []).filter(
      (u) =>
        u.civilizationId === civId &&
        !u.isDefeated &&
        (u.health == null || u.health > 0),
    ).length;
  }

  /**
   * True if the AI can afford to add another unit without breaking its
   * reserve. AutoProduction should consult this before queueing new military.
   */
  public canAffordMoreUnits(civ: Civilization): boolean {
    return this.currentUnitCount(civ) < this.sustainableUnits(civ);
  }

  /**
   * The number of units a civ can sustain without a permanent upkeep deficit:
   * upkeep = max(units, cityCount), paid from the commerce left after luxury.
   *
   * Reserve target ("X") is defined as:
   *   X = max(AI_MIN_GOLD_RESERVE, TotalExpenses * ReserveTurns)
   * where ReserveTurns scales with the AI's strategy profile.
   */
  sustainableUnits(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;

    const totalExpenses = this.econ.totalUpkeep(civId);
    const reserveTarget = this.calculateReserveTarget(civ, totalExpenses);

    const maxTaxIncome = this.econ.maxTaxIncome(civ);
    const maxSpecGold = this.econ.maxSpecialistGold(civ);

    // Plan against a realistic tax floor (50%) so AI doesn't think it has
    // 0 gold at 10% tax.
    const planningTax = Math.max(civ.taxRate ?? 0, 50) / 100;
    const projectedIncome =
      Math.floor(maxTaxIncome * planningTax) + maxSpecGold;

    // Reserve contribution is the amount of income diverted to rebuilding
    // the reserve (never more than 50% of income).
    const gold = civ.resources?.gold ?? 0;
    const shortfall = Math.max(0, reserveTarget - gold);
    const reserveContribution = Math.min(shortfall, projectedIncome * 0.1);

    const buildingUpkeep = this.econ.buildingUpkeep(civId);
    const availableForUnits =
      projectedIncome - buildingUpkeep - reserveContribution;
    const affordableUnits = Math.floor(availableForUnits / UNIT_MAINTENANCE);

    return Math.max(0, affordableUnits);
  }

  private calculateReserveTarget(
    civ: Civilization,
    totalExpenses: number,
  ): number {
    const strategy = resolveAICivStrategy(civ);
    const reserveTurns = AI_RESERVE_TURNS[strategy] ?? 2;
    return Math.max(
      AI_MIN_GOLD_RESERVE,
      totalExpenses * reserveTurns,
    );
  }

  private adjustRatesForAI(civ: Civilization, cities: City[]): void {
    const gov = getGovernment(civ?.government);
    if (!gov) return;
    const rates = this.econ.getRates(civ.id);
    const gold = civ.resources?.gold ?? 0;

    const totalExpenses = this.econ.totalUpkeep(civ.id);
    const reserveTarget = this.calculateReserveTarget(civ, totalExpenses);

    const maxTaxIncome = this.econ.maxTaxIncome(civ);
    if (maxTaxIncome <= 0) return;

    // 1. Determine Luxury Need
    const luxuryNeed = this.luxuryNeedPct(civ, cities);
    const anyCityProblem = cities.some((c: City) => {
      const h = this.econ.cityHappiness(c, civ);
      return h.disorder || h.unhappiness >= h.happiness;
    });
    const luxury = anyCityProblem
      ? Math.min(luxuryNeed, 30, 100 - AI_MIN_TAX - AI_SCIENCE_FLOOR)
      : 0;

    // 2. Determine Tax Need (Expenses + Reserve Rebuild)
    const inDeficit = gold < 0;
    const scienceAllowance = inDeficit ? 0 : AI_SCIENCE_FLOOR;

    const baseNeed = Math.ceil(
      (Math.max(0, totalExpenses - Math.max(0, gold)) / maxTaxIncome) * 100,
    );
    const shortfall = Math.max(0, reserveTarget - gold);
    const rebuildPct =
      gold >= reserveTarget || inDeficit
        ? 0
        : Math.ceil(((shortfall * AI_RESERVE_REBUILD) / maxTaxIncome) * 100);

    const taxNeed = baseNeed + rebuildPct;
    const targetTax = Math.max(
      AI_MIN_TAX,
      Math.min(
        gov.maxTaxRate,
        100 - luxury - scienceAllowance,
        taxNeed,
      ),
    );

    // 3. Gradual Movement (Prevent Oscillation)
    const crisis = gold < -totalExpenses;
    const deepCrisis = gold < -totalExpenses * 2;
    const belowReserve = gold < reserveTarget && !inDeficit;
    const MAX_DELTA = deepCrisis ? 100 : crisis ? 50 : belowReserve ? 20 : 10;

    const newTax =
      targetTax >= rates.tax
        ? Math.min(targetTax, rates.tax + MAX_DELTA)
        : Math.max(targetTax, rates.tax - MAX_DELTA);

    // 4. Fill Luxury, then Science
    let newLuxury = Math.min(luxury, 100 - newTax);
    let newScience = 100 - newTax - newLuxury;
    if (newScience < AI_SCIENCE_FLOOR && newLuxury > 0) {
      const trim = Math.min(newLuxury, AI_SCIENCE_FLOOR - newScience);
      newLuxury -= trim;
      newScience += trim;
    }

    this.econ.setRates(civ.id, newTax, newScience, newLuxury);
  }

  private luxuryNeedPct(civ: Civilization, cities: City[]): number {
    const gov = getGovernment(civ?.government);
    if (!gov) return 0;
    const govName = (gov.name ?? '').toLowerCase();
    const martialLawMax =
      govName === 'despotism' || govName === 'anarchy'
        ? 4
        : govName === 'monarchy' || govName === 'communism'
          ? 3
          : 0;

    let maxNeed = 0;
    let minAfterCommerce = Infinity;

    for (const city of cities) {
      const population = city?.population ?? 1;
      const unhappiness = Math.max(0, population - gov.tolerance);
      const specLuxury = this.econ.specialistYields(city).luxury;

      const garrisonUnits = (this.gameEngine?.units ?? []).filter(
        (u) =>
          u.civilizationId === civ.id &&
          u.col === city.col &&
          u.row === city.row &&
          !u.isDefeated &&
          (u.attack ?? 0) > 0,
      ).length;
      const martialLawBonus = Math.min(garrisonUnits, martialLawMax);

      const currentEntertainers = (city.specialists ?? []).filter(
        (s: string) => s === 'entertainer',
      ).length;
      const canAddEntertainers = Math.max(
        0,
        Math.min(2, population - 1 - currentEntertainers),
      );
      const entertainerPotential = canAddEntertainers * 2;

      const nonLuxHappiness =
        specLuxury + martialLawBonus + entertainerPotential + 2; // +Base contentment
      maxNeed = Math.max(
        maxNeed,
        Math.max(0, unhappiness - nonLuxHappiness),
      );

      const commerce = this.econ.cityCommerce(city);
      const effective = commerce * (1 - (gov.commercePenalty ?? 0));
      const after = Math.max(
        0,
        Math.floor(
          effective - CityUtils.calculateCorruption(city, civ, effective),
        ),
      );
      if (after > 0) minAfterCommerce = Math.min(minAfterCommerce, after);
    }

    if (maxNeed <= 0 || !Number.isFinite(minAfterCommerce)) return 0;
    return Math.min(
      100,
      Math.ceil((maxNeed * 100) / minAfterCommerce),
    );
  }
}