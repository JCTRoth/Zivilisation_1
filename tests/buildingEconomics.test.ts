/**
 * The building cost/usage equation.
 *
 * `BuildingEffects` now consumes every declared building effect the game
 * rules have a home for: `production`, `unitProduction`, `veteranUnits`,
 * `foodStorage`, `growthBonus`, `health`, `culture`, `corruptionReduction`,
 * `missileDefense`, `isPalace`, `defense` and `housingCap` all move the
 * simulation, so the equation must CREDIT them — otherwise an AI would still
 * price a Factory as "worth exactly nothing" while it quietly adds shields.
 * Truly unread keys (`gold`, `food`, …) stay in `INERT_EFFECTS`.
 *
 * These tests pin the equation, and above all the two verdicts that follow from
 * it: SDI is only worth its upkeep against a real atomic capability, and the
 * Stock Exchange's worth depends entirely on the tax rate.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateBuildingEconomics,
  isSellableForBudget,
  BEAKER_GOLD_EQUIVALENT,
  SHIELD_GOLD_EQUIVALENT,
  HEALTH_GOLD_EQUIVALENT,
  GROWTH_GOLD_EQUIVALENT,
  CULTURE_GOLD_EQUIVALENT,
  VETERAN_UNITS_GOLD_EQUIVALENT,
  HOUSING_CAP_GOLD_EQUIVALENT,
  CORRUPTION_PROTECTED_SHARE,
  INERT_EFFECTS,
  type CityEconomics,
} from '@/game/engine/AI/BuildingEconomics';
import { TRADE_GOLD_MULTIPLIER } from '@/game/engine/EconomicManager';

const city = (overrides: Partial<CityEconomics> = {}): CityEconomics => ({
  taxRate: 50,
  cityOutputPerTurn: 10,
  happinessSlackWithout: 3,
  isThreatened: false,
  isCoastal: false,
  civUsesShips: false,
  rivalCanBuildAtomicWeapons: false,
  ...overrides,
});

/** Mirror of the ledger's one-decimal rounding (BuildingEconomics round1). */
const r1 = (value: number): number => Math.round(value * 10) / 10;

/** What a building with `corruptionReduction: r` saves at this city's output. */
const corruptionSaved = (r: number, output = 10): number =>
  output * (1 - r) * CORRUPTION_PROTECTED_SHARE;

describe('wired effects are income, not noise', () => {
  it('credits a Factory with the shields it actually adds every turn', () => {
    const result = evaluateBuildingEconomics('factory', city());
    expect(result.liveEffects).toContain('production:2');
    expect(result.inertEffects).not.toContain('production:2');
    expect(result.incomePerTurn).toBeCloseTo(2 * SHIELD_GOLD_EQUIVALENT, 5);
    // 2 shields vs 3 gold upkeep: a slight loss, not "worth nothing" — the
    // inert branch of the sell audit must never see it again.
    expect(result.verdict).toBe('draining');
    expect(result.hasAnyLiveEffect).toBe(true);
  });

  it.each([
    ['power_plant', 'production:1', 1 * SHIELD_GOLD_EQUIVALENT],
    ['hydro_plant', 'production:1', 1 * SHIELD_GOLD_EQUIVALENT],
    ['nuclear_plant', 'production:2', 2 * SHIELD_GOLD_EQUIVALENT],
    ['recycling_center', 'production:1', 1 * SHIELD_GOLD_EQUIVALENT],
    ['aqueduct', 'health:2', 2 * HEALTH_GOLD_EQUIVALENT + 1 * GROWTH_GOLD_EQUIVALENT + HOUSING_CAP_GOLD_EQUIVALENT],
    ['barracks', 'veteranUnits:true', 1 * SHIELD_GOLD_EQUIVALENT + VETERAN_UNITS_GOLD_EQUIVALENT],
    ['courthouse', 'corruptionReduction:0.8', corruptionSaved(0.8)],
  ])('%s now earns from %s', (building, live, income) => {
    const result = evaluateBuildingEconomics(building, city());
    expect(result.liveEffects).toContain(live);
    expect(result.inertEffects).not.toContain(live);
    expect(result.incomePerTurn).toBeCloseTo(income, 5);
    expect(result.hasAnyLiveEffect).toBe(true);
  });

  it('keeps only effects nobody reads in INERT_EFFECTS', () => {
    // Everything wired into BuildingEffects must have left the dead list…
    for (const key of [
      'production', 'culture', 'health', 'growthBonus', 'foodStorage',
      'unitProduction', 'veteranUnits', 'corruptionReduction',
      'missileDefense', 'isPalace', 'housingCap',
    ]) {
      expect(INERT_EFFECTS.has(key), `${key} is wired into the engine now`).toBe(false);
    }
    // …while genuinely unread keys stay listed.
    expect(INERT_EFFECTS.has('gold')).toBe(true);
    expect(INERT_EFFECTS.has('food')).toBe(true);
  });
});

describe('SDI Defense — only against a real atomic threat', () => {
  it('earns nothing from interception when no rival can build an atomic weapon', () => {
    const result = evaluateBuildingEconomics('sdi_defense', city({ rivalCanBuildAtomicWeapons: false }));
    expect(result.liveEffects).not.toContain('missileDefense');
    // Its declared culture (+1) is a real, if tiny, credit now — the battery
    // is a drain (−4 gold/turn) rather than dead weight by definition.
    expect(result.incomePerTurn).toBe(r1(CULTURE_GOLD_EQUIVALENT));
    // 4 gold/turn is the most expensive upkeep in the game.
    expect(result.upkeepPerTurn).toBe(4);
    expect(result.netPerTurn).toBeLessThan(0);
    expect(result.verdict).toBe('draining');
    expect(result.reasons.join(' ')).toMatch(/no rival can build an atomic weapon/);
  });

  it('earns its keep when a rival can field atomic weapons', () => {
    const result = evaluateBuildingEconomics('sdi_defense', city({
      rivalCanBuildAtomicWeapons: true,
      cityOutputPerTurn: 12,
    }));
    expect(result.liveEffects).toContain('missileDefense');
    expect(result.incomePerTurn).toBeGreaterThanOrEqual(12);
    expect(result.netPerTurn).toBeGreaterThanOrEqual(8);
    expect(result.verdict).toBe('profitable');
  });
});

describe('trade buildings — the return must beat the upkeep', () => {
  it('values trade through the tax rate', () => {
    // Stock Exchange: +3 trade, +20% corruption kept, 2 upkeep.
    const rich = evaluateBuildingEconomics('stock_exchange', city({ taxRate: 60 }));
    // 3 trade × TRADE_GOLD_MULTIPLIER × 0.6 tax + the corruption it stops.
    expect(rich.incomePerTurn).toBeCloseTo(3 * TRADE_GOLD_MULTIPLIER * 0.6 + corruptionSaved(0.8), 5);
    expect(rich.netPerTurn).toBeCloseTo(3 * TRADE_GOLD_MULTIPLIER * 0.6 + corruptionSaved(0.8) - 2, 5);
    expect(rich.verdict).toBe('profitable');
  });

  it('says the same building is a bad buy under a low tax rate', () => {
    // Democracy caps tax at 10% → 3 trade × TRADE_GOLD_MULTIPLIER × 0.1
    // + corruption kept, against 2 upkeep.
    const poor = evaluateBuildingEconomics('stock_exchange', city({ taxRate: 10 }));
    expect(poor.incomePerTurn).toBeCloseTo(3 * TRADE_GOLD_MULTIPLIER * 0.1 + corruptionSaved(0.8), 5);
    expect(poor.netPerTurn).toBeCloseTo(3 * TRADE_GOLD_MULTIPLIER * 0.1 + corruptionSaved(0.8) - 2, 5);
    expect(poor.verdict).toBe('draining');
    expect(isSellableForBudget(poor)).toBe(true);
  });

  it('still keeps the marketplace at 50% tax — its corruption cut counts too', () => {
    // +1 trade × TRADE_GOLD_MULTIPLIER × 0.5 + corruption kept, against 1 upkeep.
    const result = evaluateBuildingEconomics('marketplace', city({ taxRate: 50 }));
    expect(result.netPerTurn).toBeCloseTo(TRADE_GOLD_MULTIPLIER * 0.5 + corruptionSaved(0.5) - 1, 5);
    expect(result.verdict).toBe('profitable');
    expect(isSellableForBudget(result)).toBe(false);
  });
});

describe('happiness is worth exactly the disorder it prevents', () => {
  it('is worthless in a city that stays content without it', () => {
    const result = evaluateBuildingEconomics('temple', city({
      happinessSlackWithout: 6,
      cityOutputPerTurn: 20,
    }));
    // Only its declared culture earns anything — the happiness bought nothing.
    expect(result.incomePerTurn).toBe(r1(CULTURE_GOLD_EQUIVALENT));
    expect(result.netPerTurn).toBe(r1(CULTURE_GOLD_EQUIVALENT - 1));
    expect(result.reasons.join(' ')).toMatch(/stays content/);
  });

  it('is worth the whole city output when removing it would cause disorder', () => {
    const result = evaluateBuildingEconomics('temple', city({
      happinessSlackWithout: 0, // the temple's +1 is the only thing holding it together
      cityOutputPerTurn: 20,
    }));
    expect(result.incomePerTurn).toBe(r1(20 + CULTURE_GOLD_EQUIVALENT));
    expect(result.netPerTurn).toBe(r1(20 + CULTURE_GOLD_EQUIVALENT - 1));
    expect(result.reasons.join(' ')).toMatch(/prevents disorder/);
  });

  it('prices the City Walls happiness drag by how close the city is to disorder', () => {
    // Plenty of slack: the −1 costs nothing, so the walls are just their upkeep.
    const roomy = evaluateBuildingEconomics('city_walls', city({
      happinessSlackWithout: 8,
      cityOutputPerTurn: 20,
    }));
    expect(roomy.netPerTurn).toBe(-2);

    // A city right on the edge cannot afford them at all.
    const edgy = evaluateBuildingEconomics('city_walls', city({
      happinessSlackWithout: 1,
      cityOutputPerTurn: 20,
    }));
    expect(edgy.netPerTurn).toBeLessThan(roomy.netPerTurn - 5);
    expect(edgy.reasons.join(' ')).toMatch(/risks .* city output/);
  });

  it('gives the walls a free pass in a city that is already unhappy', () => {
    const miserable = evaluateBuildingEconomics('city_walls', city({
      happinessSlackWithout: 0,
      cityOutputPerTurn: 20,
    }));
    expect(miserable.netPerTurn).toBe(-2);
    expect(miserable.reasons.join(' ')).toMatch(/already unhappy/);
  });
});

describe('other live effects', () => {
  it('converts science at the documented beaker rate', () => {
    const result = evaluateBuildingEconomics('university', city());
    expect(result.incomePerTurn).toBe(r1(2 * BEAKER_GOLD_EQUIVALENT + CULTURE_GOLD_EQUIVALENT));
    expect(result.liveEffects).toContain('science:2');
    expect(result.liveEffects).toContain('culture:1');
  });

  it('prices walls by whether anything is actually attacking', () => {
    const quiet = evaluateBuildingEconomics('city_walls', city({
      isThreatened: false, happinessSlackWithout: 6, cityOutputPerTurn: 15,
    }));
    const besieged = evaluateBuildingEconomics('city_walls', city({
      isThreatened: true, happinessSlackWithout: 6, cityOutputPerTurn: 15,
    }));
    expect(besieged.incomePerTurn).toBeGreaterThan(quiet.incomePerTurn);
    expect(quiet.reasons.join(' ')).toMatch(/nothing is attacking/);
  });

  it('grades a harbour by whether the civ actually sails', () => {
    const inland = evaluateBuildingEconomics('harbor', city({ isCoastal: false }));
    expect(inland.incomePerTurn).toBe(0);

    const berth = evaluateBuildingEconomics('harbor', city({ isCoastal: true }));
    const fleet = evaluateBuildingEconomics('harbor', city({ isCoastal: true, civUsesShips: true }));
    expect(berth.incomePerTurn).toBeGreaterThan(inland.incomePerTurn);
    expect(fleet.incomePerTurn).toBeGreaterThan(berth.incomePerTurn);
  });

  it('credits a granary through its declared effects, not through its id', () => {
    const result = evaluateBuildingEconomics('granary', city());
    expect(result.liveEffects).toEqual(
      expect.arrayContaining(['foodStorage:2', 'growthBonus:1', 'health:1']),
    );
    expect(result.incomePerTurn).toBeCloseTo(
      2 * GROWTH_GOLD_EQUIVALENT + GROWTH_GOLD_EQUIVALENT + HEALTH_GOLD_EQUIVALENT, 5,
    );
    expect(result.verdict).toBe('profitable');
  });

  it('is sellable only when it does not pay for itself', () => {
    expect(isSellableForBudget(evaluateBuildingEconomics('bank', city({ taxRate: 60 })))).toBe(false);
    expect(isSellableForBudget(evaluateBuildingEconomics('sdi_defense', city()))).toBe(true);
  });
});
