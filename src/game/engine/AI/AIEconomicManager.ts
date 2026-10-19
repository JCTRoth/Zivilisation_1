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
/**
 * The treasury the budget accountant defends (world-census postmortem: two
 * empires parked on gold 3–10 for 1,400+ rounds while the disband ledger grew
 * past 200). When net income is negative AND the treasury is under this floor
 * the controller stops drifting and RECONCILES: rates snap to the position
 * that pays the bills this round, discretionary gold spending freezes, and
 * production pivots to income until the books balance again.
 */
const RECONCILE_GOLD_FLOOR = 80;
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

    // The reconciliation ledger runs FIRST, on the books as they stand right
    // now: negative net income with the treasury under the floor means the
    // controller must reconcile this round — snap the rates, freeze spending,
    // pivot production — instead of crawling toward solvency a step a round
    // while the disbander takes the difference out of the army.
    const gold = civ.resources?.gold ?? 0;
    const brokenBooks = this.currentNet(civ) < 0 && gold < RECONCILE_GOLD_FLOOR;
    if (brokenBooks) {
      this.reconcileStreaks.set(civ.id, (this.reconcileStreaks.get(civ.id) ?? 0) + 1);
    } else {
      this.reconcileStreaks.delete(civ.id);
    }

    this.adjustRatesForAI(civ, cities, brokenBooks);
  }

  /**
   * Negative net income at the civ's CURRENT rates, every employer priced:
   * commerce at the running tax rate, taxmen's gold included, upkeep of units,
   * buildings, cities, and the debt service the treasury loses this turn.
   *
   * The single definition of "the books do not balance", shared by the
   * ledger and the ratchet, so neither can declare solvency the other's
   * arithmetic denies.
   */
  private currentNet(civ: Civilization): number {
    if (typeof this.econ.previewEconomy === 'function') {
      return this.econ.previewEconomy(civ, this.econ.getRates(civ.id)).net;
    }
    // Test-double fallback: cash income minus every known cost class.
    const income = typeof this.econ.projectedIncome === 'function'
      ? this.econ.projectedIncome(civ)
      : 0;
    return income - this.econ.totalUpkeep(civ.id);
  }

  /**
   * True while this civ's books are under reconciliation: net income was
   * negative with the treasury below {@link RECONCILE_GOLD_FLOOR}, and it has
   * not balanced again since. Concretely, while this holds the AI freezes all
   * discretionary gold spending and produces nothing it cannot pay wages for —
   * AutoProduction and the rush-buyer consult this as their HARD CAP.
   *
   * The world-census failure this caps: the producer built soldiers the
   * treasury could not feed (gold already under 80), the disbander took them
   * back the same round they arrived, and the ledger grew to 219 disbanded
   * while gold never left 3–8.
   */
  public isReconciling(civ: Civilization): boolean {
    return civ?.id != null && (this.reconcileStreaks.get(civ.id) ?? 0) > 0;
  }

  /** Consecutive rounds spent under reconciliation (0 when balancing). */
  public reconcileRounds(civ: Civilization): number {
    return civ?.id != null ? (this.reconcileStreaks.get(civ.id) ?? 0) : 0;
  }

  /**
   * Consecutive reconciliation rounds per civ, for the successor that reads
   * the freeze after a turn boundary rebuilds nothing.
   */
  private reconcileStreaks = new Map<number, number>();

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
   * Gold per turn this civ's rate controller will defend at its CEILING.
   *
   * The planning income for the doctrines that size a FLEET or an AIR FORCE
   * (`AutoProduction`): how much the civ could collect if the rate controller
   * ran at the top of its band. Planning against `maxTaxIncome` — the 100 %-tax
   * figure — sized fleets for money the civ never collected: the controller
   * holds 35 % while healthy and only rises toward the government's cap in a
   * crisis, so the surplus was 1.25–2.9× too high and hulls were built that
   * got disbanded again. Planning against the civ's *current* rate fails the
   * other way (a science push at 10 % tax would cap the fleet at zero), which
   * is why this uses the same ceiling `adjustRatesForAI` enforces.
   *
   * The ARMY cap (`sustainableUnits`) does NOT use this: it is measured
   * against the economy's real budget (`EconomicManager.armyBudgetFor`), so
   * the number the AI plans its soldiers with is the number the disbander
   * enforces. A doctrine may plan against a ceiling; a standing army may not
   * be larger than the treasury can pay for today.
   */
  planningIncome(civ: Civilization): number {
    const maxTaxIncome = this.econ.maxTaxIncome(civ);
    const maxSpecGold = this.econ.maxSpecialistGold(civ);

    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civ.id,
    );
    const planningTax = this.policyTaxRate(
      civ,
      this.policyLuxury(civ, cities),
      this.inDeficit(civ) ? AI_SCIENCE_DEEP_FLOOR : AI_SCIENCE_FLOOR,
    );
    return Math.floor(maxTaxIncome * planningTax) + maxSpecGold;
  }

  /**
   * The number of units a civ can sustain without a permanent upkeep deficit.
   *
   * The cap has to answer one question: *if I build this army, will the rate
   * controller keep me out of bankruptcy?* It used to answer a different one —
   * "what does 50 % tax buy?" — and a hard-coded 50 % is not a rate any policy
   * in this engine ever defends: the controller holds 35 % when the empire is
   * healthy and rises only as far as `maxTaxRate − luxury − science floor`.
   * Planning above that sized armies for an income the civ never actually ran,
   * the treasury went negative, and the disbander paid the difference out of
   * the army — including the garrisons that were holding the barbarians off.
   *
   * So the planning rate is the ceiling `adjustRatesForAI` itself enforces (see
   * `policyTaxRate`), and the unit is priced at what it will actually cost to
   * keep (`planningUnitMaintenance`). Pass `plannedUnitType` when the caller
   * already knows which unit it is about to build.
   *
   * The cap is a POLICY ceiling layered on top of the engine's own
   * `EconomicManager.sustainableUnits`; `AutoProduction` uses the engine's, so
   * the two can no longer disagree about what a unit costs.
   *
   * The money the cap is measured against is the ECONOMY's budget
   * (`armyBudgetFor`): the income the civ really collects, minus buildings,
   * minus the empire's cities, minus the debt service. The rate controller
   * raises the tax rate when the empire grows, so this budget grows with the
   * civ — but it never grows into money the treasury does not have, which is
   * exactly what the disbander measures.
   */
  sustainableUnits(civ: Civilization, plannedUnitType?: string): number {
    const civId = civ?.id;
    if (civId == null) return 0;

    // The budget the ECONOMY enforces: income at the civ's real rates, minus
    // buildings, minus the empire's cities, minus the debt service. This is
    // the same number the disbander reads (`EconomicManager.armyBudgetFor`),
    // and it has to be: planning against a looser figure — the 100 %-tax
    // fantasy, a policy ceiling the rate controller has not reached, or a
    // budget that forgot the cities and the loan — sizes an army the economy
    // will take apart again, one unit a turn, for the rest of the game.
    const budget = typeof this.econ.armyBudgetFor === 'function'
      ? this.econ.armyBudgetFor(civ)
      : this.planningIncome(civ) - this.econ.buildingUpkeep(civId);

    // ALWAYS divert 10% of that budget to the reserve, not only while the
    // reserve is short. With the old `min(shortfall, …)` a civ that happened to
    // hold its reserve planned its army against 100% of its income — net
    // exactly zero — so the next completed building's upkeep, the next rate
    // change or the next warship tipped the treasury negative and the upkeep
    // disbander started eating the army (≈12 abandoned units per 300-round
    // test game). Ten per cent is the headroom that makes "never negative"
    // structural instead of lucky. (It is also never MORE than the old value
    // was when the shortfall was smaller, so the cap only ever tightens.)
    const reserveContribution = budget * 0.1;

    // The fleet already fielded is charged against income too: `unitUpkeep` bills
    // every unit every turn, so a civ with a battleship cannot spend that gold on
    // archers. Ignoring it over-counted the cap by the cost of the entire existing
    // army, which is how the AI built past what it could pay for and then let the
    // disbander collect the difference.
    const unitUpkeep = typeof this.econ.unitUpkeep === 'function' ? this.econ.unitUpkeep(civId) : 0;
    const availableForUnits = budget - unitUpkeep - reserveContribution;
    const existingUnits = (this.gameEngine?.units ?? []).filter(
      (u: { civilizationId: number; isDefeated?: boolean }) =>
        u.civilizationId === civ.id && !u.isDefeated,
    ).length;
    if (availableForUnits <= 0) return existingUnits;
    const affordableUnits = Math.floor(
      availableForUnits / this.planningUnitMaintenance(civ, plannedUnitType),
    );

    // A TOTAL army size, like the engine cap it is layered over.
    return existingUnits + affordableUnits;
  }

  /**
   * The share of trade the rate controller is willing to turn into tax, as a
   * fraction — the ceiling planning must respect, never an aspiration.
   *
   * `adjustRatesForAI` targets `max(AI_MIN_TAX, min(maxTaxRate, 100 − luxury −
   * scienceAllowance, taxNeed))`: it defends the science floor, buys luxury
   * only when a city is close to disorder, and never exceeds the government's
   * tax cap. Subtracting the two floors from the government ceiling is
   * therefore *the most tax this civ will ever hold* — an army that fits under
   * it stays paid for, and one that does not is never built in the first place.
   *
   * A civ that already runs above the ceiling (pushed there by a crisis) keeps
   * its real rate: that income is not hypothetical.
   */
  private policyTaxRate(
    civ: Civilization,
    luxury: number,
    scienceAllowance: number,
  ): number {
    const gov = getGovernment(civ?.government);
    const maxTax = gov?.maxTaxRate ?? 100;
    const ceiling = Math.min(
      Math.max(maxTax - luxury - scienceAllowance, AI_MIN_TAX),
      maxTax,
    );
    const current = Math.min(civ.taxRate ?? 0, maxTax);
    return Math.max(ceiling, current) / 100;
  }

  /** Luxury the controller would buy for this civ right now (0 when content). */
  private policyLuxury(civ: Civilization, cities: City[]): number {
    const anyCityProblem = cities.some((c: City) => {
      const h = this.econ.cityHappiness(c, civ);
      return h.disorder || h.unhappiness >= h.happiness;
    });
    if (!anyCityProblem) return 0;
    return Math.min(
      this.luxuryNeedPct(civ, cities),
      30,
      100 - AI_MIN_TAX - AI_SCIENCE_FLOOR,
    );
  }

  private inDeficit(civ: Civilization): boolean {
    return (civ.resources?.gold ?? 0) < 0;
  }

  /**
   * The maintenance a *future* unit is priced at: the planned type's, or the
   * most expensive military unit the civ already owns. The AI builds its era's
   * unit, so the priciest thing in the barracks is the best available estimate
   * of what it will buy next — and over-pricing is the safe direction, because
   * a cap that is too low costs a slower army while a cap that is too high
   * costs the army.
   *
   * Delegates to `EconomicManager.unitMaintenanceOf` so the army cap, the
   * funding planner and the engine all price a unit identically.
   */
  private planningUnitMaintenance(civ: Civilization, plannedUnitType?: string): number {
    if (typeof this.econ.plannedUnitUpkeep === 'function') {
      return Math.max(1, this.econ.plannedUnitUpkeep(civ, plannedUnitType));
    }
    if (typeof this.econ.unitMaintenanceOf === 'function') {
      return this.econ.unitMaintenanceOf(civ, plannedUnitType);
    }
    const owned = (this.gameEngine?.units ?? []).filter(
      (u: { civilizationId: number; isDefeated?: boolean; maintenance?: number }) =>
        u.civilizationId === civ.id && !u.isDefeated && (u.maintenance ?? 0) > 0,
    );
    if (owned.length === 0) return UNIT_MAINTENANCE;
    return Math.max(
      UNIT_MAINTENANCE,
      ...owned.map((u: { maintenance?: number }) => u.maintenance ?? UNIT_MAINTENANCE),
    );
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

  private adjustRatesForAI(
    civ: Civilization,
    cities: City[],
    reconciling = false,
  ): void {
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
    const scienceAllowance = reconciling || inDeficit
      ? AI_SCIENCE_DEEP_FLOOR
      : AI_SCIENCE_FLOOR;

    const baseNeed = Math.ceil(
      (Math.max(0, totalExpenses - Math.max(0, gold)) / maxTaxIncome) * 100,
    );
    const shortfall = Math.max(0, reserveTarget - gold);
    const rebuildPct =
      gold >= reserveTarget || inDeficit
        ? 0
        : Math.ceil(((shortfall * AI_RESERVE_REBUILD) / maxTaxIncome) * 100);

    // Reconciliation priced a DURABLE balance, not a fire-sale: income has to
    // cover the bills every round out of commerce, WITHOUT burning the bank.
    // The old `baseNeed` counted the treasury's coins as coverage — so a civ
    // holding 40 gold against 24 of upkeep reconciled to tax 35 (income 6,
    // net −15), watched the bank it had just "spen[d]" melt over three rounds,
    // then met the disbander with the rates it had used as an alibi. Under
    // reconciliation the tax target is what pays the bills from income alone.
    const taxNeed = reconciling
      ? Math.ceil((totalExpenses / maxTaxIncome) * 100)
      : baseNeed + rebuildPct;

    const targetTax = Math.max(
      AI_MIN_TAX,
      Math.min(
        gov.maxTaxRate,
        100 - luxury - scienceAllowance,
        taxNeed,
      ),
    );

    // 3. Gradual Movement (Prevent Oscillation)
    // A reconciliation round does NOT crawl toward solvency: the books are
    // already broken, so steady 10- and 20-steps are just more rounds of
    // negative net at rates that cannot pay for what the empire owns — the
    // disbander takes the gap each of those rounds. MAX_DELTA 100 walks the
    // rate straight to this round's target.
    const deepCrisis = gold < -totalExpenses * 2;
    const crisis = gold < -totalExpenses;
    const belowReserve = gold < reserveTarget && !inDeficit;
    const MAX_DELTA = deepCrisis || reconciling
      ? 100
      : crisis
        ? 50
        : belowReserve
          ? 20
          : 10;

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
    const scienceFloor = inDeficit || reconciling ? AI_SCIENCE_DEEP_FLOOR : AI_SCIENCE_FLOOR;
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

    // 5. The downward ratchet — the law that makes the controller an
    //    accountant. RELAXING tax is only allowed while the books STILL
    //    balance at the lighter rates (`net >= 0`, debt service priced).
    //
    //    Without this the controller was the engine of the census seesaw they
    //    were meant to prevent: one disband freed upkeep, gold looked solvent
    //    again, `targetTax` slid down ten steps a round, the army that the
    //    producers had sized at the ceiling became unaffordable at the floor,
    //    and the slope took the difference back out of the field — army 2↔4,
    //    gold 3↔8, disbanded ledger forever. Now income never voluntarily
    //    falls below commitments: the rate only comes down once the treasury
    //    or a smaller army has actually made room for it.
    //
    //    Upward movement is never blocked — a crisis may raise tax as hard as
    //    it needs to. Only the relaxation needs to prove itself solvable.
    if (newTax < rates.tax) {
      const projected = typeof this.econ.previewEconomy === 'function'
        ? this.econ.previewEconomy(civ, { tax: newTax, science: newScience, luxury: newLuxury })
        : null;
      const stillSolvent = projected ? projected.net >= 0 : true;
      if (!stillSolvent) {
        // The lighter rates cannot pay the bills: keep the income the empire
        // already collects. (Luxury/science are refilled from the held rate
        // with the same floor order as above.)
        newTax = rates.tax;
        newLuxury = Math.min(luxury, 100 - newTax);
        newScience = 100 - newTax - newLuxury;
        if (newScience < scienceFloor) {
          const trimLux = Math.min(newLuxury, scienceFloor - newScience);
          newLuxury -= trimLux;
          newScience += trimLux;
        }
      }
    }

    this.econ.setRates(civ.id, newTax, newScience, newLuxury);
  }

  private luxuryNeedPct(civ: Civilization, cities: City[]): number {
    const gov = getGovernment(civ?.government);
    if (!gov) return 0;
    let maxNeedPct = 0;

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
      //
      // Building happiness counts for exactly the same reason: a city holding
      // two temples is already content, and a planner that cannot see them
      // divides the empire's commerce into luxury nobody needs. Omitting it
      // made `luxuryNeedPct` return 100 % for a pop-4 city with two temples
      // (happiness 4 vs unhappiness 4), which the caller then capped to 30 %
      // — a third of the empire's commerce spent on a disorder that was never
      // going to happen.
      const nonLuxHappiness =
        specLuxury
        + martialLawBonus
        + (gov.happinessBonus ?? 0)
        + 2 // base contentment
        + (this.econ.buildingHappinessForCity?.(city) ?? 0)
        + (this.econ.wonderHappinessForCity?.(city) ?? 0); // a wonder's content is already ours
      const need = Math.max(0, unhappiness - nonLuxHappiness);
      if (need <= 0) continue;

      const commerce = this.econ.cityCommerce(city);
      const effective = commerce * (1 - (gov.commercePenalty ?? 0));
      const after = Math.max(
        0,
        Math.floor(
          effective - CityUtils.calculateCorruption(city, civ, effective),
        ),
      );
      if (after <= 0) continue;

      // PER CITY, not across cities. The old form took the worst deficit in
      // the empire over the SMALLEST commerce of any city that had any, so one
      // hard-up town with a two-commerce neighbour set the luxury rate for
      // everybody — a rate sized for a city that did not exist.
      maxNeedPct = Math.max(
        maxNeedPct,
        Math.ceil((need * 100) / after),
      );
    }

    if (maxNeedPct <= 0) return 0;
    return Math.min(100, maxNeedPct);
  }
}