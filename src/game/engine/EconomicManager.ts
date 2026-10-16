/**
 * EconomicManager — the Tax/Science/Luxury economic core for Civ1.
 *
 * Handles universal economic rules: tile yields, city commerce, rate splitting,
 * happiness/disorder, and total upkeep (Units + Buildings).
 * AI-specific logic (reserve targets, preventative tax raising, sustainable
 * army sizing) is delegated to AIEconomicManager.
 */

import {
  BUILDING_PROPERTIES,
  BUILDING_TYPES,
  WONDER_PROPERTIES,
} from '../../data/BuildingConstants';
import { getGovernment } from '../../data/GovernmentData';
import { CityUtils } from '../../utils/CityUtils';
import { UNIT_PROPS } from '../../utils/Constants';
import {
  TERRAIN_PROPERTIES,
  TERRAIN_TYPES,
  getResourceYields,
} from '../../data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '../../data/TileImprovementConstants';
import { SPECIALIST_YIELDS, CITY_UPKEEP_PER_CITY, FREE_CITY_SUPPORT, TREATY_ROUTE_TRADE_MULTIPLIER } from '../../data/GameConstants';
import { cityBuildingEffects } from './BuildingEffects';
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
  /** Units retired by the standing-army drawdown — budget housekeeping,
   * distinct from the disbander's emergency liquidation. */
  retired: number;
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
/**
 * Commerce every city has before any tile is worked.
 *
 * Two — the original Civ1-flavoured number, kept. The economy used to be
 * balanced by raising this to 4 (and the trade multiplier to 3) because a
 * city's commerce never scaled: nothing paved the worked tiles, so every city
 * earned the floor forever. With the public-works corps fixed
 * (`AIManager.countOutstandingWorks` → `SettlerGovernor`), roads actually land
 * and commerce scales on its own — the simulator's row R20 shows 0 disbands,
 * 0 bankruptcies and an army of ~6 with the ORIGINAL constants once the works
 * programme runs. Raising the floor as well only inflated the economy
 * (rows R9-R12 hoard 231-1062 gold a turn).
 */
export const CITY_CENTER_COMMERCE = 4;
/**
 * Gold per point of after-corruption commerce at 100% tax. Exported because the
 * building cost/usage equation has to convert a building's declared `trade`
 * bonus into actual gold, and a number silently re-derived in two places is
 * exactly how the two drift apart.
 *
 * Two, unchanged: the whole economy is priced against this one number (a unit
 * costs 1-6 gold a turn), and it is the *right* number once city commerce can
 * actually grow. It was raised to 3 as a stopgap while no roads were being
 * built; `scripts/economy_sim.py` row R20 measures no need for it once the
 * works programme lands.
 */
export const TRADE_GOLD_MULTIPLIER = 3;
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

/**
 * Food every citizen eats per turn, up to `APPETITE_RAMP_ABOVE_POP`.
 *
 * Below that size the demand is flat (Civ1's 2 a citizen); above it each
 * citizen eats `APPETITE_RAMP_PER_CITIZEN` more, so a size-12 city's citizens
 * eat 3.4 each rather than 2. This is the documented Civ1 rule that the engine
 * had flattened away: with a flat demand, one worked tile per citizen gives a
 * constant surplus forever and a city's food bill never catches up with its
 * size, so growth is free once a city is fed at all. The ramp is what makes a
 * big city harder to keep than a small one and pushes the empire to keep
 * expanding instead of parking one city at size 30.
 *
 * One function, three callers (the growth pipeline, the AI's food planning and
 * the shared tile assigner) so a famine is never priced at a different appetite
 * than the citizen is assumed to eat at.
 */
export const CITIZEN_FOOD_DEMAND_PER_CITIZEN = 2;

/** City size above which each citizen's appetite starts to rise. */
export const APPETITE_RAMP_ABOVE_POP = 5;

/** Extra food per citizen per size above `APPETITE_RAMP_ABOVE_POP`. */
export const APPETITE_RAMP_PER_CITIZEN = 0.2;

/** What one citizen of a city this size eats per turn. */
export function citizenFoodDemand(population: number): number {
  const size = Math.max(0, Math.floor(population));
  return CITIZEN_FOOD_DEMAND_PER_CITIZEN
    + APPETITE_RAMP_PER_CITIZEN * Math.max(0, size - APPETITE_RAMP_ABOVE_POP);
}

/**
 * City size an Aqueduct is required for.
 *
 * Without one a city stops growing here, which is what makes the Aqueduct (120
 * shields, 1 gold, "helps cities grow larger") worth building instead of the
 * inert 2 `health` it used to hand out. `growthBonus` and `health` are declared
 * but unread by the engine; the housing cap is the one that changes play.
 */
export const AQUEDUCT_HOUSING_CAP = 10;

/**
 * Floor the treasury is reset to after the AI is forced to disband.
 * Keeps the civ solvent for the next turn (see spec item 6).
 */
export const ABSOLUTE_MIN_GOLD = 8;

/**
 * Debt service: how fast a forgiven deficit is repaid.
 *
 * One gold per turn per 50 of debt, so a 40-gold loan costs 1 gold/turn and a
 * 400-gold one costs 8 — a civ that goes bankrupt repeatedly sees a rising
 * bill, while a single bad turn is a rounding error it climbs out of. It is
 * charged only from income that actually arrived, so it can never push a
 * treasury below zero on its own.
 */
export const DEBT_REPAYMENT_PER_TURN = 1;

/** Debt each unit of `DEBT_REPAYMENT_PER_TURN` service covers. */
export const DEBT_REPAYMENT_PER = 50;

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

  /**
   * Trade this city earns from its permanent trade routes.
   *
   * A route to a civ we hold a **trade agreement** with is worth
   * `TREATY_ROUTE_TRADE_MULTIPLIER` — which is what a trade agreement is now
   * worth. It used to pay a flat 2 gold a turn to BOTH sides out of nothing
   * (`DiplomacyManager.processTurn`), an unbounded faucet that minted money
   * every round a treaty stood: that is how a civ with no cities and 6 gold of
   * lifetime tax income finished a game holding 271 gold. Basing it on routes
   * means the treaty pays only where caravans have actually been delivered, and
   * it can never be collected by a civ that trades with nobody.
   */
  routeTrade(city: City): number {
    if (!Array.isArray(city.tradeRoutes)) return 0;
    const civId = city.civilizationId;
    return city.tradeRoutes.reduce((total: number, r) => {
      const base = r.trade ?? 0;
      if (base <= 0) return total;
      const treaty = this.hasTradeAgreementWith(civId, r.civilizationId);
      return total + base * (treaty ? TREATY_ROUTE_TRADE_MULTIPLIER : 1);
    }, 0);
  }

  /** Whether a trade agreement stands between these two civs right now. */
  private hasTradeAgreementWith(a: number | undefined, b: number | undefined): boolean {
    if (a == null || b == null || a === b) return false;
    const dm = this.gameEngine?.diplomacyManager as
      | { hasTreaty?: (x: number, y: number, t: string) => boolean }
      | undefined;
    return dm?.hasTreaty?.(a, b, 'trade_agreement') === true;
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
    // One floor, at the end — not two. The old `floor(effective - corruption)`
    // discarded up to a whole commerce point BEFORE the rate split, and the
    // split floored again, so a city with 2 commerce (the CITY_CENTER_COMMERCE
    // floor on a roadless city) produced `floor(1 × 0.8) × 2 = 0` gold at an
    // 80% tax rate. The reported `commerce` stays integer; only the rate
    // arithmetic sees the fraction.
    const afterCorruption = Math.max(0, effective - corruption);
    // A roadless city earns 0.4 gold at a 20 % tax rate. That is a real number,
    // not zero, so `tax` is FRACTIONAL here and the treasury carries the
    // remainder (`taxGoldWithCarry`): flooring per city is what made every
    // low-tax rate pay literally nothing — Democracy's 10 % cap collected 0
    // gold from a 2-commerce city, and a city taxed below 50 % paid 0 at any
    // rate. Luxury stays integer: it is compared against integer unhappiness,
    // and half a content citizen has no meaning.
    const rates = this.getRates(civ?.id);
    const buildingScience = this.buildingBonuses(city).science;
    const scienceBonus = buildingScience > 0 || (city.buildings?.length ?? 0) > 0
      ? buildingScience
      : (city.scienceBonus ?? 0);
    const specialistScience = this.specialistYields(city).science;
    // Wonder science (Great Library +10%, SETI +30%, Copernicus ×2, …) scales
    // the city's whole science line — flat bonuses and percentages together.
    const wonderScienceMult = this.gameEngine?.wonderEffects?.scienceMultiplierForCity(city) ?? 1;
    const baseScience =
      Math.round(afterCorruption * (rates.science / 100)) + scienceBonus + specialistScience;
    return {
      commerce: Math.floor(afterCorruption),
      corruption,
      tax: (afterCorruption * (rates.tax / 100)) * TRADE_GOLD_MULTIPLIER,
      science: Math.round(baseScience * wonderScienceMult),
      luxury: Math.floor(afterCorruption * (rates.luxury / 100)),
    };
  }

  /**
   * Gold this civ banks this turn from its cities' fractional tax.
   *
   * **The treasury only ever holds whole coins, and they are rounded UP at the
   * moment of booking.** The rate split is fractional all the way through — a
   * 4-commerce city taxed at 20 % earns 2.4 gold — and the moment that number is
   * written into the treasury it becomes 3. Rounding up (rather than carrying a
   * remainder) is the rule: a civ that earned 0.4 gold a turn gets its coin now,
   * not in three turns' time, and the books never show a fraction.
   *
   * Everything the AI *plans* against (previews, income projections, the
   * sustainable-army cap) still uses the exact fractional figure — rounding at
   * planning time would overstate every empire's income. Rounding happens
   * exactly once, here, at the cash desk.
   */
  private taxGoldWithCarry(civ: Civilization, grossTax: number): { banked: number; gross: number } {
    // Rounded up: 0.1 gold of income is still a coin, and the treasury is
    // integral by construction after this point.
    const banked = Math.max(0, Math.ceil(Math.max(0, grossTax)));
    if (civ) civ.goldFractionCarry = 0; // nothing survives a round-up
    return { banked: banked, gross: grossTax };
  }

  /**
   * Gross gold-per-turn the civ's cities would yield at 100 % tax, after
   * corruption and the government commerce penalty.
   *
   * Fractional, because the treasury carries the remainder (`taxGoldWithCarry`):
   * a 2.5-commerce city taxed at 40 % earns 2 gold a turn, not 0.
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
        Math.max(0, effective - corruption) * TRADE_GOLD_MULTIPLIER
      );
    }, 0);
  }

  /**
   * Gold this civ can expect this turn at its CURRENT rates: tax income plus
   * specialist gold.
   *
   * Deliberately the real rate rather than the 100%-tax fantasy
   * (`maxTaxIncome`) - anything the AI commits to, including building upkeep,
   * has to be paid out of what actually arrives.
   */
  projectedIncome(civ: Civilization): number {
    if (!civ) return 0;
    const share = Math.min(100, Math.max(0, civ.taxRate ?? 50)) / 100;
    return Math.floor(this.maxTaxIncome(civ) * share) + this.maxSpecialistGold(civ);
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
   * How many units the civ can keep alive on its income.
   *
   * Self-consistent by construction: the fleet already fielded is charged
   * against income first (`unitUpkeep`), buildings second, and only what is
   * left buys the *new* units — priced at what the civ is about to build (or,
   * failing that, the most expensive type it already fields, because the AI
   * buys its era's unit and pricing a future tank at a rifleman's 1 gold is how
   * a solvent empire goes broke three technologies later). The answer is a
   * TOTAL army size, which is what `AutoProduction` compares against
   * `currentUnits + queuedUnits`.
   *
   * There is **no free unit support**: every unit with a home city pays its
   * full maintenance. The used-to-be `− cityCount` ("one free unit per city")
   * over-counted the cap by the size of the empire and was contradicted by the
   * comment three lines down.
   */
  sustainableUnits(civ: Civilization, plannedUnitType?: string): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const income = this.projectedIncome(civ);
    const committed = this.buildingUpkeep(civId) + this.unitUpkeep(civId)
      + this.queuedUnitUpkeep(civId);
    const headroom = income - committed;
    if (headroom <= 0) return this.unitCountFor(civId);
    const unitPrice = this.unitMaintenanceOf(civ, plannedUnitType);
    if (unitPrice <= 0) return this.unitCountFor(civId);
    return this.unitCountFor(civId) + Math.floor(headroom / unitPrice);
  }

  /**
   * Gold per turn left for UNIT upkeep after buildings take their share: the
   * income the civ really has, minus what it already committed.
   *
   * This is the currency {@link sustainableUnits} divides by a unit price to
   * produce a COUNT. Exposed on its own because a count is only meaningful when
   * every unit costs the same — it does not. A caravan, a settler and a scout all
   * cost 0 gold a turn while a rifleman costs 2, yet under a count-based cap a
   * free unit occupied a slot that belonged to a soldier, and a civ funding its
   * roads was told it was at its army ceiling. Callers that need to ask "can I
   * keep this thing alive" should use this number, not a headcount.
   *
   * Negative when the civ is already overspending — the honest answer, and the
   * one the caller compares against a unit's price.
   */
  affordableUnitUpkeep(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const income = this.projectedIncome(civ);
    // The queue is charged alongside the field: a queued unit's upkeep begins
    // the turn it arrives, and three cities reading the same headroom must not
    // each spend it. See `queuedUnitUpkeep` for the measurement that put this
    // term here.
    const committed = this.buildingUpkeep(civId) + this.unitUpkeep(civId)
      + this.queuedUnitUpkeep(civId);
    return income - committed;
  }

  /** Living units the civ has in the field (the army the cap is a ceiling for). */
  private unitCountFor(civId: number): number {
    return (this.gameEngine?.units ?? []).filter(
      (u: Unit) => u.civilizationId === civId && !u.isDefeated,
    ).length;
  }

  /**
   * What one more unit of this type will really cost per turn — including the
   * units that cost nothing.
   *
   * {@link unitMaintenanceOf} floors a price at 1 (it divides a gold budget to
   * produce an army size, and a zero divisor or a zero price would break that
   * arithmetic). The floor is right for buying soldiers and wrong for the
   * question the unit cap actually asks — "can this civ keep this unit alive?".
   * A Caravan's upkeep is genuinely 0 (Civ1: it is consumed by the delivery and
   * pays nothing afterwards), and pricing it at 1 made it occupy a gold slot it
   * never draws on, so a civ funding its roads was refused the trade units that
   * would pay for them.
   */
  plannedUnitUpkeep(civ: Civilization, plannedUnitType?: string): number {
    if (plannedUnitType) {
      const planned = UNIT_PROPS[plannedUnitType]?.maintenance;
      if (typeof planned === 'number') return Math.max(0, planned);
    }
    const owned = (this.gameEngine?.units ?? []).filter(
      (u: Unit) => u.civilizationId === civ?.id && !u.isDefeated && (u.maintenance ?? 0) > 0,
    );
    if (owned.length === 0) return UNIT_MAINTENANCE;
    return Math.max(
      UNIT_MAINTENANCE,
      ...owned.map((u: Unit) => u.maintenance ?? UNIT_MAINTENANCE),
    );
  }

  /**
   * Gold per turn one more unit will cost: the planned type's maintenance, or
   * the most expensive type the civ already fields.
   */
  unitMaintenanceOf(civ: Civilization, plannedUnitType?: string): number {
    return Math.max(1, this.plannedUnitUpkeep(civ, plannedUnitType));
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
   * `CITIZEN_FOOD_DEMAND_PER_CITIZEN` per citizen.
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

    // A citizen with no field to work is not a worker — it is an idle mouth
    // the city still feeds while producing nothing for it. Civ1's answer is
    // the Entertainer: convert the overflow citizens so the tile list and the
    // specialist list always add up, and the city at least gets happiness out
    // of a citizen it could not employ anyway. (`cityTerritory` already drops
    // the centre, so `candidates` IS the pool of field slots.)
    //
    // Converting here — rather than waiting for the governor — makes it
    // automatic for every city, AI or human. The governor may still staff
    // SPARE citizens as Taxmen or Scientists; these have no spare tile, so
    // Entertainer is their default.
    const fieldSlots = candidates.length;
    const population = city.population ?? 1;
    const idleCitizens = population - (city.specialists ?? []).length - fieldSlots;
    if (idleCitizens > 0) {
      if (!city.specialists) city.specialists = [];
      for (let i = 0; i < idleCitizens && city.specialists.length < population; i++) {
        city.specialists.push('entertainer');
      }
    }

    const total = (y: {
      food: number;
      production: number;
      trade: number;
    }): number => y.food + y.production + y.trade;

    // How this city RANKs the tiles it works. Without a governor the engine
    // ranks by raw total yield. With one, the governor's own weights apply, so
    // the slots it hands out after the food floor are the slots it would have
    // chosen itself — otherwise every growth step silently reverted a Commerce
    // city back to whatever added up to the most, which is how a city ended up
    // starving its trade to keep a tile worth 5.
    const weights = city.governorWeights;
    const score = weights
      ? (y: { food: number; production: number; trade: number }): number =>
          y.food * weights.food + y.production * weights.production + y.trade * weights.trade
      : total;
    candidates.sort((a, b) => score(b.yields) - score(a.yields));

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
        (a, b) => b.yields.food - a.yields.food || score(b.yields) - score(a.yields),
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
    const wonderEffects = this.gameEngine?.wonderEffects;
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
        // Isaac Newton's College: Libraries/Universities grant double science
        // in every city of the wonder's owner (1 when no wonder applies).
        const scienceMult = wonderEffects?.buildingScienceMultiplier(city, id) ?? 1;
        science += (effects.science ?? 0) * scienceMult;
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
    let tradeSquares = 0;
    for (const t of worked) {
      food += t.yields.food;
      production += t.yields.production;
      trade += t.yields.trade;
      if (t.yields.trade > 0) tradeSquares++;
    }
    trade += this.buildingBonuses(city).trade;
    // Factory / Power Plant / …: flat shields the buildings add every turn
    // (the declared `production` effect; it was inert before BuildingEffects).
    production += cityBuildingEffects(city).production;
    // Colossus / Statue of Liberty: +N on every worked tile that already
    // produces trade (tile granularity — the building bonus above is flat).
    const wonderEffects = this.gameEngine?.wonderEffects;
    const tradePerSquare = wonderEffects?.tradePerTradeSquareForCity(city) ?? 0;
    if (tradePerSquare > 0) trade += tradeSquares * tradePerSquare;
    // Hoover Dam (+1 flat) / AI Supercluster (+10%): wonder production.
    if (wonderEffects) {
      const prodBonus = wonderEffects.productionBonusForCity(city);
      if (prodBonus.flat !== 0 || prodBonus.percent !== 0) {
        production = Math.round((production + prodBonus.flat) * (1 + prodBonus.percent / 100));
      }
    }
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
    let tradeSquares = 0;
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
      if (y.trade > 0) tradeSquares++;
    }
    // Wonder modifiers are tile-derived, so they apply on this manual refresh
    // path too (flat building trade stays exclusive to recomputeCityYields —
    // see that function).
    const wonderEffects = this.gameEngine?.wonderEffects;
    // Flat building shields (Factory, Power Plant, …) are not tile-derived and
    // must survive a manual tile reshuffle exactly like the wonder flat bonus.
    production += cityBuildingEffects(city).production;
    const tradePerSquare = wonderEffects?.tradePerTradeSquareForCity(city) ?? 0;
    if (tradePerSquare > 0) trade += tradeSquares * tradePerSquare;
    if (wonderEffects) {
      const prodBonus = wonderEffects.productionBonusForCity(city);
      if (prodBonus.flat !== 0 || prodBonus.percent !== 0) {
        production = Math.round((production + prodBonus.flat) * (1 + prodBonus.percent / 100));
      }
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
   * `CITIZEN_FOOD_DEMAND_PER_CITIZEN` food (a flat 2, Civ 1 style, at any city
   * size), and settlers owned by the city eat 1 each (2 under Republic and
   * Democracy). AI city management and production decisions consult this
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
    // The appetite ramp: flat 2 a citizen up to size 5, then +0.2 per citizen
    // per further size. `citizenFoodDemand` is the single definition, so the
    // growth pipeline, the AI's planning and the tile assigner all charge the
    // same rate.
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

  /**
   * Martial law: how many happiness points this city's garrison is actually
   * worth, and how many it could be worth at all.
   *
   * This is the whole of the "authoritarian rule" mechanic, exported because
   * three places need the same answer: the happiness total, the AI's luxury
   * calculation, and the AI deciding whether to walk a unit onto a city tile.
   * When they disagreed, the AI garrisoned for *defence* within two tiles —
   * which earns nothing here — and then hired Entertainers to do a job its
   * military units could have done for free.
   *
   * A garrison point needs the unit standing **on the city tile**: an exact
   * coordinate match, not a radius.
   */
  martialLaw(
    civ: Civilization,
    city: City,
    garrisonUnits?: number,
  ): { bonus: number; max: number; current: number } {
    const gov = getGovernment(civ?.government);
    const govName = (gov.name ?? '').toLowerCase();
    // Republic and Democracy keep the law off their civilian cities, but they
    // are not exempt from defending them: one garrisoned unit still counts. It
    // is the smallest possible bonus, so a republic cannot buy its way out of
    // unhappiness by posting soldiers, but a single defender is worth something
    // and the AI should be allowed to see that.
    const max =
      govName === 'despotism' || govName === 'anarchy'
        ? 4
        : govName === 'monarchy' || govName === 'communism'
          ? 3
          : govName === 'republic' || govName === 'democracy'
            ? 1
            : 0;
    const current = garrisonUnits ?? this.garrisonOnCityTile(civ, city);
    return { bonus: Math.min(current, max), max, current };
  }

  /**
   * Own living combat units holding the city.
   *
   * A unit counts if it stands on the city tile, or if it is **fortified** on
   * or beside it. The fortified case is the point: a garrison that has dug in
   * next to the walls is defending that city just as much as one standing in the
   * middle of it, and it is already paying the +50% defense bonus for it. It was
   * not counted, so the AI could park a soldier beside a city, have it report
   * "no target — fortifying to defend", and still get nothing for it — the one
   * place a garrison is *supposed* to pay is the happiness it buys.
   *
   * Deliberately not "any unit nearby": an unfortified unit passing through, or
   * one that happens to be adjacent because it is marching past, is not a
   * garrison and must not mint content citizens.
   */
  garrisonOnCityTile(civ: Civilization, city: City): number {
    return (this.gameEngine?.units ?? []).filter(
      (u: Unit) =>
        u.civilizationId === civ?.id &&
        !u.isDefeated &&
        (u.attack ?? 0) > 0 &&
        this.holdsCity(u, city),
    ).length;
  }

  /** Is this unit garrisoning `city`? On the tile, or fortified beside it. */
  private holdsCity(unit: Unit, city: City): boolean {
    if (unit.col === city?.col && unit.row === city?.row) return true;
    if (!unit.isFortified) return false;
    const d = Math.max(Math.abs(unit.col - (city?.col ?? -99)), Math.abs(unit.row - (city?.row ?? -99)));
    return d === 1;
  }

  /**
   * Flat happiness a wonder grants to THIS city (Human Genome Project, Hanging
   * Gardens). Scope (city / civilization / continent), ownership and
   * obsolescence are resolved by the WonderEffects engine — a wonder is held
   * by exactly one city but may apply much wider.
   */
  wonderHappinessForCity(city: City): number {
    return this.gameEngine?.wonderEffects?.happinessForCity(city) ?? 0;
  }

  /**
   * Unhappy citizens this wonder converts to content in THIS city
   * (J.S. Bach's Cathedral on the continent, Shakespeare's Theatre locally).
   * Returned separately so the caller subtracts it from unhappiness.
   */
  wonderUnhappyToContentForCity(city: City): number {
    return this.gameEngine?.wonderEffects?.unhappyToContentForCity(city) ?? 0;
  }

  /**
   * One declared effect of one building, as a number.
   *
   * Wonders live in `WONDER_PROPERTIES`, not `BUILDING_PROPERTIES`, and that is
   * easy to miss: looking a wonder up in the wrong table returns `undefined`
   * rather than an error, so a wonder's `globalHappiness` simply never arrived.
   * Both tables are consulted here, and the effects bag carries an index
   * signature, so declared-but-untyped keys come back as `unknown` and are
   * coerced rather than trusted.
   */
  private buildingEffect(buildingId: string, effect: string): number {
    const props = BUILDING_PROPERTIES[buildingId] ?? WONDER_PROPERTIES[buildingId];
    const value = Number((props?.effects as Record<string, unknown> | undefined)?.[effect] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  /** Happiness for one city (base + luxury + buildings + government bonus). */
  cityHappiness(city: City, civ: Civilization): CityHappinessResult {
    const out = this.cityOutputs(city, civ);
    const gov = getGovernment(civ?.government);
    const population = city?.population ?? 1;
    const capturedUnrest =
      city?.capturedTurns && city.capturedTurns > 0 ? CAPTURED_CITY_UNHAPPY : 0;
    // Every citizen is unhappy, full stop. Governments no longer absorb any of
    // them: there is no tolerance, so a city's content has to be bought with
    // buildings, luxury, specialists and martial law, or the crowd riots.
    //
    // Wonders can convert unhappy citizens to content directly (Bach,
    // Shakespeare) — that reduces the DEMAND side instead of buying happiness.
    const wonderContent = this.wonderUnhappyToContentForCity(city);
    const unhappiness = Math.max(0, population + capturedUnrest - wonderContent);
    const specLuxury = this.specialistYields(city).luxury;

    const garrisonUnits = this.garrisonOnCityTile(civ, city);

    const martialLawBonus = this.martialLaw(civ, city, garrisonUnits).bonus;

    const happiness =
      out.luxury +
      specLuxury +
      martialLawBonus +
      this.buildingHappiness(city) +
      this.wonderHappinessForCity(city) +
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

  /**
   * Happiness this city's buildings contribute, on its own.
   *
   * Public because the AI's luxury planner reasons about the same number the
   * happiness total uses: a planner that cannot see a city's temples asks the
   * empire to spend commerce on contentment it already owns (`luxuryNeedPct`
   * returned 100 % for a pop-4 city holding two temples, which was then capped
   * to 30 % of all commerce).
   */
  buildingHappinessForCity(city: City): number {
    return this.buildingHappiness(city);
  }

  private buildingHappiness(city: City): number {
    const buildings = city?.buildings ?? [];
    const wonderEffects = this.gameEngine?.wonderEffects;
    return buildings.reduce((total: number, b: unknown) => {
      const id =
        typeof b === 'string'
          ? b
          : (b as { id?: string; type?: string })?.id ??
            (b as { type?: string })?.type ??
            '';
      let happiness = this.buildingEffect(id, 'happiness');
      // The Oracle doubles Temples, Michelangelo's Chapel boosts Cathedrals —
      // per-building-type multipliers owned by the wonder effect engine.
      if (happiness !== 0 && wonderEffects) {
        happiness *= wonderEffects.buildingHappinessMultiplier(city, id);
      }
      return total + happiness;
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
      const afterCorruption = Math.max(0, effective - corruption);
      commerce += Math.floor(afterCorruption);

      // --- Disorder check (mirrors cityHappiness) ---
      const population = city?.population ?? 1;
      const capturedUnrest =
        city?.capturedTurns && city.capturedTurns > 0 ? CAPTURED_CITY_UNHAPPY : 0;
      const wonderContent = this.wonderUnhappyToContentForCity(city);
      const unhappiness = Math.max(0, population + capturedUnrest - wonderContent);

      const specLuxury = this.specialistYields(city).luxury;

      const garrisonUnits = this.garrisonOnCityTile(civ, city);
      const martialLawBonus = this.martialLaw(civ, city, garrisonUnits).bonus;

      // Luxury from the *proposed* rate (not the current rate).
      const cityLuxury = Math.floor(afterCorruption * (proposedRates.luxury / 100));

      const happiness =
        cityLuxury +
        specLuxury +
        martialLawBonus +
        this.buildingHappiness(city) +
        this.wonderHappinessForCity(city) +
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
      const wonderScienceMult = this.gameEngine?.wonderEffects?.scienceMultiplierForCity(city) ?? 1;
      science += Math.round(
        (Math.round((afterCorruption * proposedRates.science) / 100)
          + scienceBonus
          + this.specialistYields(city).science) * wonderScienceMult,
      );
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
   * Upkeep the BUILD QUEUE will commit once its units arrive.
   *
   * `unitUpkeep` charges only units alive in the field, so the army cap saw
   * the same headroom from every city: three cities each queued a rifleman,
   * and when all three landed the upkeep tripled in one round and the upkeep
   * disbander liquidated what the cities had queued. Measured live (seed 33,
   * civ2, 320 rounds): 53 disbands in four waves, 29 of them in one round at
   * r220, immediately after the army had been built to 64 units against an
   * income that fit about half that. The queue is a future unit's upkeep and
   * is charged where the cap is computed — a queued rifleman and a fielded
   * rifleman cost the same gold.
   */
  queuedUnitUpkeep(civId: number): number {
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    let total = 0;
    for (const city of cities) {
      const items: Array<{ type?: string; itemType?: string }> = [
        ...(city.currentProduction
          && city.currentProduction.type === 'unit'
          ? [city.currentProduction as { type?: string; itemType?: string }]
          : []),
        ...(Array.isArray(city.buildQueue)
          ? (city.buildQueue as Array<{ type?: string; itemType?: string }>).filter(
            (q) => (q?.type ?? q?.itemType) === 'unit',
          )
          : []),
      ];
      for (const item of items) {
        const unitType = item?.itemType ?? item?.type;
        if (!unitType) continue;
        total += UNIT_PROPS[unitType]?.maintenance ?? UNIT_MAINTENANCE;
      }
    }
    return total;
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

  /**
   * Total gold-per-turn upkeep: units, buildings, and the empire's cities.
   *
   * City upkeep is the sink the economy was missing — a city used to cost the
   * treasury nothing at all, so gold bore no relation to empire size and the
   * only outflow was rushes. `CITY_UPKEEP_PER_CITY` per city beyond
   * `FREE_CITY_SUPPORT`, so the opening is untouched and the bill starts with
   * the fourth town.
   */
  totalUpkeep(civId: number): number {
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    const cityUpkeep = Math.max(
      0,
      cities.length - FREE_CITY_SUPPORT,
    ) * CITY_UPKEEP_PER_CITY;
    return this.unitUpkeep(civId) + this.buildingUpkeep(civId) + cityUpkeep;
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
          colonyMissions?: Array<{ settlerId?: string; ferryId?: string | null }>;
          colonyMission?: { settlerId?: string; ferryId?: string | null };
          invasionMission?: { troopIds?: string[]; landedIds?: string[]; ferryId?: string | null };
          nukeMission?: { nukeId?: string; subId?: string | null };
        }
      | undefined;
    if (!turnData) return ids;
    for (const m of turnData.colonyMissions ?? []) {
      if (m?.settlerId) ids.add(String(m.settlerId));
      if (m?.ferryId) ids.add(String(m.ferryId));
    }
    const nukeMission = turnData.nukeMission;
    if (nukeMission?.nukeId) ids.add(String(nukeMission.nukeId));
    if (nukeMission?.subId) ids.add(String(nukeMission.subId));
    if (turnData.colonyMission?.settlerId) ids.add(String(turnData.colonyMission.settlerId));
    if (turnData.colonyMission?.ferryId) ids.add(String(turnData.colonyMission.ferryId));
    if (turnData.invasionMission?.ferryId) ids.add(String(turnData.invasionMission.ferryId));
    for (const id of turnData.invasionMission?.troopIds ?? []) ids.add(String(id));
    for (const id of turnData.invasionMission?.landedIds ?? []) ids.add(String(id));
    return ids;
  }

  /**
   * What the STANDING army alone may cost per turn.
   *
   * The one budget the builder and the destroyer both read. It is income at
   * the civ's real rates, minus buildings, minus the empire's cities, minus
   * the debt service the treasury will lose to this turn. Debt was the
   * missing line: `{@link repayDebt}` charges it after banking, so a civ
   * paying 20 of its 30 income into a loan has a budget of 10, but every
   * cap until now priced the loan at zero and happily built a 20-upkeep army.
   */
  armyBudgetFor(civ: Civilization): number {
    const civId = civ?.id;
    if (civId == null) return 0;
    const cities = (this.gameEngine?.cities ?? []).filter(
      (c: City) => c.civilizationId === civId,
    );
    const cityUpkeep = Math.max(
      0,
      cities.length - FREE_CITY_SUPPORT,
    ) * CITY_UPKEEP_PER_CITY;
    const debtService = DEBT_REPAYMENT_PER_TURN
      * Math.ceil((civ.debt ?? 0) / DEBT_REPAYMENT_PER);
    const income = this.projectedIncome(civ);
    return Math.max(0, income - this.buildingUpkeep(civId) - cityUpkeep - debtService);
  }

  /**
   * Retire ONE unit a round while the standing army costs more than its
   * budget — the slope the disbander never had.
   *
   * The disbander is a cliff: it waits for the treasury to go negative, then
   * liquidates as many units as the imbalance demands, which measured 29 in
   * one round (r220, seed 33) — catapults, cannons and riflemen that took
   * dozens of turns to build, destroyed to cure an imbalance that had been
   * visible for rounds. This runs BEFORE the treasury is empty, on the
   * budget comparison, and takes at most one unit, so an empire whose income
   * fell slides down to a size it can pay instead of falling off a ledge.
   *
   * It reuses `{@link disbandUnitsToCoverDeficit}` with a deficit of one gold,
   * so every protection already tested stands: sole city defenders, mission
   * units, loaded ferries, fisher boats on a route, caravans under way, and
   * any unit whose maintenance is paid for FREE (a free unit is never the
   * reason the civ is overspent, and removing it saves no gold).
   */
  private retireSurplusUnit(civ: Civilization, cities: City[]): number {
    const budget = this.armyBudgetFor(civ);
    if (this.unitUpkeep(civ.id) <= budget) return 0;
    return this.disbandUnitsToCoverDeficit(civ.id, 1, cities);
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
        // The same argument, generalised: ANY unit that costs nothing cannot be
        // the reason the civ is in deficit, so removing it saves no gold and only
        // destroys the investment. Settlers were the remaining case — 0 gold a
        // turn, 50 shields, and a road the civ is still earning from.
        (u.maintenance ?? UNIT_MAINTENANCE) > 0 &&
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
      // A unit that costs nothing cannot be the reason the civ is in deficit.
      // Removing it would not add a single gold to the treasury — it would only
      // destroy 50 shields and a trade route. The sort puts these last (they pay
      // 0), but a large deficit walked all the way down and still removed them,
      // which is how a civ disbanded every caravan it ever built: 18 were
      // produced in a four-game batch and not one survived to deliver.
      if (maintenanceOf(unit) <= 0) return false;
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
  // Bankruptcy
  // ------------------------------------------------------------------

  /**
   * Restore a bankrupt civ to the solvency floor — as a LOAN, not a gift.
   *
   * The treasury used to be reset with `Math.max(gold, ABSOLUTE_MIN_GOLD)`,
   * which *created* the missing gold: a civ that finished the turn at −50 was
   * handed 8, so every bankruptcy was free money. Measured over a 400-round
   * batch that is how dead civs ended holding thousands of gold (median 278,
   * max 3 269) with no cities and no tax income to show for it, and why the
   * harness reported zero bankrupt turns while 419 units were being disbanded
   * for upkeep.
   *
   * Now the forgiven amount is booked as debt on the civ and repaid at
   * `DEBT_REPAYMENT_PER_TURN` gold a turn out of income. A civ with no income
   * keeps its debt — which is the honest outcome, and it is visible in the
   * progression export instead of hidden by the reset.
   */
  private forgiveDeficit(civ: Civilization, deficit: number): void {
    const gold = civ.resources?.gold ?? 0;
    const restored = ABSOLUTE_MIN_GOLD - gold;
    if (restored <= 0 && deficit <= 0) return;
    if (restored > 0) {
      civ.resources.gold = ABSOLUTE_MIN_GOLD;
      civ.debt = (civ.debt ?? 0) + restored + deficit;
    } else {
      // No gold was created; only the unpaid bills are booked.
      civ.debt = (civ.debt ?? 0) + deficit;
    }
    (civ as { lastForgivenDeficit?: number }).lastForgivenDeficit = restored + deficit;
    this.gameEngine?.onStateChange?.('ECONOMY_FORGIVEN', {
      civilizationId: civ.id,
      goldRestored: Math.max(0, restored),
      debtBooked: (civ as { lastForgivenDeficit?: number }).lastForgivenDeficit ?? 0,
      debt: civ.debt ?? 0,
      deficit,
    });
  }

  /**
   * Repay this civ's debt out of this turn's income, before it is banked.
   *
   * Debt is paid only from gold that actually arrived (income minus upkeep), so
   * a civ cannot be pushed below zero by its own loan, and a civ with no income
   * simply waits.
   */
  private repayDebt(civ: Civilization, available: number): number {
    const debt = civ.debt ?? 0;
    if (debt <= 0 || available <= 0) return 0;
    const service = DEBT_REPAYMENT_PER_TURN * Math.ceil(debt / DEBT_REPAYMENT_PER);
    const paid = Math.min(debt, available, service);
    civ.debt = debt - paid;
    return paid;
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
        retired: 0,
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
    // The treasury banks whole gold and carries the fraction (see
    // `taxGoldWithCarry`). `taxTotal` stays the gross figure so the emergency
    // tax raise below can price its own delta, and only the banked amount moves
    // the treasury.
    const banked = this.taxGoldWithCarry(civ, taxTotal);

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

    // ---- Nuclear plant meltdown and pollution ----
    this.processNuclearPlants(civId, cities);

    const upkeep = this.totalUpkeep(civId);
    // Debt service comes out of this turn's income before anything is banked.
    const debtService = this.repayDebt(civ, Math.max(0, banked.banked + specGoldTotal - upkeep));
    civ.resources.gold =
      (civ.resources.gold ?? 0) + banked.banked + specGoldTotal - upkeep - debtService;

    // ---- Standing-army drawdown (the slope the disbander never had) ---
    // Run while the treasury is STILL SOLVENT: when the standing army costs
    // more than its budget, retire ONE unit this round. Without this the
    // imbalance sits invisible until gold goes negative, and the disbander
    // then liquidates the whole gap at once — 29 units in one round, seed 33
    // civ2 r220. One unit a round lets an empire whose income fell slide down
    // to a size it can pay.
    let retired = 0;
    if (civ.resources.gold >= 0) {
      retired = this.retireSurplusUnit(civ, cities);
    }

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
        // Tax to the max and re-collect. The raise lands as *banked* coins
        // (rounded up, like every other booking) minus what this turn already
        // banked, so the delta is integral too and the treasury never sees a
        // fraction from this path either.
        this.setRates(civId, gov.maxTaxRate, 0, 0);
        accumulateOutputs();
        const raised = this.taxGoldWithCarry(civ, taxTotal);
        civ.resources.gold += raised.banked - banked.banked;
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
      // Forgive the accumulated deficit into a tracked loan and restore the
      // solvency floor. See `forgiveDeficit` — the gold used to be created out
      // of nothing here, which is why city-less civs finished 400-round games
      // holding thousands of gold they never earned.
      this.forgiveDeficit(civ, deficit);
    }

    return {
      // `tax` is what was BANKED — whole coins, rounded up — not the gross the
      // cities produced. The treasury and the report must agree, or the log
      // says "3.6 gold of tax" next to a treasury that gained 4.
      tax: banked.banked,
      science: scienceTotal,
      luxury: luxuryTotal,
      commerce: commerceTotal,
      upkeep,
      deficit,
      disbanded,
      retired,
    };
  }


  

  // ---- Nuclear plant meltdown and pollution ----

  /**
   * Process nuclear power plant effects:
   * 1. Each nuclear plant generates 3 pollution per turn (tile pollution around city)
   * 2. Small chance of meltdown causing pollution similar to nuclear strike (but smaller radius)
   */
  private processNuclearPlants(_civId: number, cities: City[]): void {
    if (!this.gameEngine) return;
    
    const grid = this.gameEngine.squareGrid;
    if (!grid) return;
    
    for (const city of cities) {
      if (!city.buildings?.includes('nuclear_plant')) continue;
      
      // 1. Regular nuclear plant pollution: 3 pollution per turn around the city
      this.applyNuclearPlantPollution(city);
      
      // 2. Meltdown chance: small random chance per turn per plant
      // Base chance: 1% per turn, increased by city disorder
      const meltdownChance = this.calculateMeltdownChance(city);
      if (Math.random() < meltdownChance) {
        this.triggerNuclearMeltdown(city);
      }
    }
  }
  
  /**
   * Calculate meltdown chance based on city state.
   * Base 1% chance, doubled if city is in disorder.
   */
  private calculateMeltdownChance(city: City): number {
    let chance = 0.01; // 1% base chance
    const happiness = this.cityHappiness(city, this.gameEngine.civilizations?.[city.civilizationId]);
    if (happiness.disorder) chance *= 2; // Double chance if city is in disorder
    return chance;
  }
  
  /**
   * Apply regular nuclear plant pollution around the city.
   * 3 pollution points per turn distributed around the city.
   */
  private applyNuclearPlantPollution(city: City): void {
    const grid = this.gameEngine?.squareGrid;
    if (!grid) return;
    
    const radius = 2; // Same as nuclear blast radius
    
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const c = city.col + dc;
        const r = city.row + dr;
        if (grid.chebyshevDistance(c, r, city.col, city.row) <= radius) {
          const tile = this.gameEngine.getTileAt(c, r);
          if (tile && tile.type !== 'ocean' && tile.type !== 'lake') {
            // Add pollution improvement if not already present
            if (tile.improvement !== IMPROVEMENT_TYPES.POLLUTION) {
              tile.improvement = IMPROVEMENT_TYPES.POLLUTION;
            }
          }
        }
      }
    }
  }
  
  /**
   * Trigger a nuclear meltdown - similar to nuclear strike but smaller radius.
   * Creates pollution in a radius around the city.
   */
  private triggerNuclearMeltdown(city: City): void {
    const grid = this.gameEngine?.squareGrid;
    if (!grid) return;
    
    const radius = 3; // Slightly larger than nuclear blast
    const centerCol = city.col;
    const centerRow = city.row;
    
    // Notify player
    this.gameEngine?.onStateChange?.('NUCLEAR_MELTDOWN', {
      cityId: city.id,
      cityName: city.name,
      col: city.col,
      row: city.row,
      civilizationId: city.civilizationId,
      radius,
    });
    
    // Apply pollution in radius around city
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const c = centerCol + dc;
        const r = centerRow + dr;
        if (!grid?.isValidSquare(c, r)) continue;
        if (grid.chebyshevDistance(c, r, centerCol, centerRow) > radius) continue;
        
        const tile = this.gameEngine.getTileAt(c, r);
        if (tile && tile.type !== 'ocean' && tile.type !== 'lake') {
          tile.improvement = IMPROVEMENT_TYPES.POLLUTION;
        }
      }
    }
    
    console.log(`[EconomicManager] Nuclear meltdown at ${city.name} (${city.col},${city.row})`);
  }


}