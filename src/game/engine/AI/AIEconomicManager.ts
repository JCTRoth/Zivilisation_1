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

import { getGovernment } from '../../../data/GovernmentData';
import { BARBARIAN_CIV_ID } from '../../../data/VillageConstants';
import { CityUtils } from '../../../utils/CityUtils';
import type { City, Civilization } from '../../../../types/game';
import { resolveAICivStrategy, type StrategyProfile } from './AITypes';
import GameEngine from '../GameEngine';
import {
  EconomicManager,
  UNIT_MAINTENANCE,
  ABSOLUTE_MIN_GOLD,
} from '../EconomicManager';

const AI_SCIENCE_FLOOR = 20;

/**
 * The science floor a civ keeps even while it is in deficit.
 *
 * It used to be zero, on the reasoning that a civ which cannot pay its bills
 * should stop paying for research. But research is cumulative and the AI has
 * tech-gated governments: a civ that drops to zero science while its treasury
 * dips below zero tends to sit there, because every turn of no research makes
 * the next one unaffordable too. An AI stuck at 100% tax and 0% science never
 * reaches Communism — it cannot research the tech — so the "saving" was
 * permanent. Ten percent is enough to finish a tech and climb out.
 */
const AI_SCIENCE_DEEP_FLOOR = 10;
const AI_MIN_TAX = 35;
export const AI_RESERVE_TURNS: Record<StrategyProfile, number> = {
  military_expansion: 3,
  defensive_turtle: 3,
  balanced_growth: 2,
  early_expansion: 2,
  wonder_rush: 2,
  science_focus: 2,
};
const AI_RESERVE_REBUILD = 0.1;
const AI_MIN_GOLD_RESERVE = ABSOLUTE_MIN_GOLD;

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
    // Barbarians spend everything on war and do not research — leave their
    // 100% tax / 0% science rates alone.
    if (civ.id === BARBARIAN_CIV_ID) return;
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

    const maxTaxIncome = this.econ.maxTaxIncome(civ);
    const maxSpecGold = this.econ.maxSpecialistGold(civ);

    // Plan against a realistic tax floor (50%) so AI doesn't think it has
    // 0 gold at 10% tax.
    const planningTax = Math.max(civ.taxRate ?? 0, 50) / 100;
    const projectedIncome =
      Math.floor(maxTaxIncome * planningTax) + maxSpecGold;

    // ALWAYS divert 10% of projected income to the reserve, not only while the
    // reserve is short. With the old `min(shortfall, …)` a civ that happened to
    // hold its reserve planned its army against 100% of its income — net
    // exactly zero — so the next completed building's upkeep, the next rate
    // change or the next warship tipped the treasury negative and the upkeep
    // disbander started eating the army (≈12 abandoned units per 300-round
    // test game). Ten per cent is the headroom that makes "never negative"
    // structural instead of lucky. (It is also never MORE than the old value
    // was when the shortfall was smaller, so the cap only ever tightens.)
    const reserveContribution = projectedIncome * 0.1;

    const buildingUpkeep = this.econ.buildingUpkeep(civId);
    const availableForUnits =
      projectedIncome - buildingUpkeep - reserveContribution;
    const affordableUnits = Math.floor(availableForUnits / UNIT_MAINTENANCE);

    // Units are never free: `unitUpkeep` charges every unit its full
    // maintenance (the "each city supports one unit for free" note in
    // doc/AI_ECONOMY.md does not match the implementation), so this is a hard
    // budget ceiling. A building-heavy empire can therefore legitimately
    // compute a cap of zero.
    return Math.max(0, affordableUnits);
  }

  /**
   * True when the treasury is below the reserve this civ's own policy wants to
   * hold (or already negative).
   *
   * This is the "upkeep pressure has started" signal: while it holds, a gold
   * coin spent on income (marketplace, bank) is worth more than another unit
   * or another wonder. TODO.txt records the failure it exists to prevent — the
   * AI reaching 0–8 gold with a big army and then doing nothing about it.
   */
  public isUnderEconomicPressure(civ: Civilization): boolean {
    if (!civ || civ.id == null) return false;
    const gold = civ.resources?.gold ?? 0;
    if (gold < 0) return true;
    return gold < this.calculateReserveTarget(civ, this.econ.totalUpkeep(civ.id));
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
    const scienceAllowance = inDeficit ? AI_SCIENCE_DEEP_FLOOR : AI_SCIENCE_FLOOR;

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

    let newTax =
      targetTax >= rates.tax
        ? Math.min(targetTax, rates.tax + MAX_DELTA)
        : Math.max(targetTax, rates.tax - MAX_DELTA);

    // 4. Fill Luxury, then Science.
    // The science floor is a LAW, not a preference: the gradual MAX_DELTA cap
    // can leave `newTax` above `targetTax` for many turns, and previously only
    // luxury was trimmed to get back to the floor. A civ that was already at
    // 100% tax therefore kept science at 0% indefinitely (an AI-vs-AI export
    // caught exactly that) — so trim luxury first, then hand the remainder back
    // from tax.
    const scienceFloor = inDeficit ? AI_SCIENCE_DEEP_FLOOR : AI_SCIENCE_FLOOR;
    let newLuxury = Math.min(luxury, 100 - newTax);
    let newScience = 100 - newTax - newLuxury;
    if (newScience < scienceFloor) {
      const trimLux = Math.min(newLuxury, scienceFloor - newScience);
      newLuxury -= trimLux;
      newScience += trimLux;
    }
    if (newScience < scienceFloor) {
      newTax = Math.max(0, 100 - newLuxury - scienceFloor);
      newScience = 100 - newTax - newLuxury;
    }

    this.econ.setRates(civ.id, newTax, newScience, newLuxury);
  }

  private luxuryNeedPct(civ: Civilization, cities: City[]): number {
    const gov = getGovernment(civ?.government);
    if (!gov) return 0;
    let maxNeed = 0;
    let minAfterCommerce = Infinity;

    for (const city of cities) {
      const population = city?.population ?? 1;
      // No government tolerance: every citizen counts as unhappy.
      const unhappiness = population;
      const specLuxury = this.econ.specialistYields(city).luxury;

      // Same helper the happiness total uses, so the AI's luxury arithmetic can
      // never drift from the rule it is reasoning about.
      const martialLawBonus = this.econ.martialLaw?.(civ, city).bonus ?? 0;

      // NOTE: this used to credit up to four points of *hypothetical*
      // entertainers the governor had not hired (and often refused to, because
      // of the food-headroom gate). The city was unhappy, `anyCityProblem`
      // said so, and the answer came out `min(0, 30, …) = 0 %` luxury — so a
      // disordered city got no relief from the rates either. Only specialists
      // that actually exist count here.
      const nonLuxHappiness =
        specLuxury
        + martialLawBonus
        + (gov.happinessBonus ?? 0)
        + 2 // base contentment
        + (this.econ.wonderHappinessForCity?.(city) ?? 0); // a wonder's content is already ours
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