/**
 * The building cost/usage equation.
 *
 * The engine consumes far fewer building effects than the building table
 * declares: `production`, `culture`, `health`, `pollution`, `unitProduction`,
 * `veteranUnits`, `growthBonus`, `foodStorage`, `corruptionReduction` and
 * `missileDefense` are read nowhere (or only for a score). Crediting those as
 * income is what makes an AI hold a Factory and an SDI Defense forever — 200
 * shields and 4 gold a turn for nothing.
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
  INERT_EFFECTS,
  type CityEconomics,
} from '@/game/engine/AI/BuildingEconomics';

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

describe('inert effects are not income', () => {
  it('treats a Factory as doing nothing — the engine never reads `production`', () => {
    const result = evaluateBuildingEconomics('factory', city());
    expect(result.liveEffects).not.toContain('production:2');
    expect(result.inertEffects).toContain('production:2');
    expect(result.incomePerTurn).toBe(0);
    expect(result.verdict).toBe('inert');
  });

  it.each([
    ['power_plant', 'production:1'],
    ['hydro_plant', 'production:1'],
    ['nuclear_plant', 'production:2'],
    ['recycling_center', 'production:1'],
    ['aqueduct', 'health:2'],
    ['barracks', 'veteranUnits:true'],
    ['courthouse', 'corruptionReduction:0.8'],
  ])('%s earns nothing from %s', (building, inert) => {
    const result = evaluateBuildingEconomics(building, city());
    expect(result.inertEffects).toContain(inert);
    expect(result.incomePerTurn).toBe(0);
  });

  it('lists every inert effect key the engine ignores', () => {
    expect(INERT_EFFECTS.has('production')).toBe(true);
    expect(INERT_EFFECTS.has('missileDefense')).toBe(true);
    expect(INERT_EFFECTS.has('culture')).toBe(true);
  });
});

describe('SDI Defense — only against a real atomic threat', () => {
  it('earns nothing when no rival can build an atomic weapon', () => {
    const result = evaluateBuildingEconomics('sdi_defense', city({ rivalCanBuildAtomicWeapons: false }));
    expect(result.hasAnyLiveEffect).toBe(false);
    expect(result.incomePerTurn).toBe(0);
    // 4 gold/turn is the most expensive upkeep in the game.
    expect(result.upkeepPerTurn).toBe(4);
    expect(result.netPerTurn).toBe(-4);
    expect(result.verdict).toBe('inert');
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
    // Stock Exchange: +3 trade, 2 upkeep.
    const rich = evaluateBuildingEconomics('stock_exchange', city({ taxRate: 60 }));
    // 3 × TRADE_GOLD_MULTIPLIER(2) × 0.6 = 3.6 gold/turn.
    expect(rich.incomePerTurn).toBeCloseTo(3.6, 5);
    expect(rich.netPerTurn).toBeCloseTo(1.6, 5);
    expect(rich.verdict).toBe('profitable');
  });

  it('says the same building is a bad buy under a low tax rate', () => {
    // Democracy caps tax at 10% → 3 × 2 × 0.1 = 0.6 against 2 upkeep.
    const poor = evaluateBuildingEconomics('stock_exchange', city({ taxRate: 10 }));
    expect(poor.incomePerTurn).toBeCloseTo(0.6, 5);
    expect(poor.netPerTurn).toBeCloseTo(-1.4, 5);
    expect(poor.verdict).toBe('draining');
    expect(isSellableForBudget(poor)).toBe(true);
  });

  it('treats a marketplace as break-even at 50% tax', () => {
    // +1 trade × 2 × 0.5 = 1 gold against 1 upkeep.
    const result = evaluateBuildingEconomics('marketplace', city({ taxRate: 50 }));
    expect(result.netPerTurn).toBe(0);
    expect(result.verdict).toBe('break_even');
    expect(isSellableForBudget(result)).toBe(false);
  });
});

describe('happiness is worth exactly the disorder it prevents', () => {
  it('is worthless in a city that stays content without it', () => {
    const result = evaluateBuildingEconomics('temple', city({
      happinessSlackWithout: 6,
      cityOutputPerTurn: 20,
    }));
    expect(result.incomePerTurn).toBe(0);
    expect(result.netPerTurn).toBe(-1);
    expect(result.reasons.join(' ')).toMatch(/stays content/);
  });

  it('is worth the whole city output when removing it would cause disorder', () => {
    const result = evaluateBuildingEconomics('temple', city({
      happinessSlackWithout: 0, // the temple's +1 is the only thing holding it together
      cityOutputPerTurn: 20,
    }));
    expect(result.incomePerTurn).toBe(20);
    expect(result.netPerTurn).toBe(19);
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
    expect(result.incomePerTurn).toBeCloseTo(2 * BEAKER_GOLD_EQUIVALENT, 5);
    expect(result.liveEffects).toContain('science:2');
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

  it('credits a granary, which the engine honours by id rather than by effect', () => {
    const result = evaluateBuildingEconomics('granary', city());
    expect(result.liveEffects).toContain('foodStorage:halves-loss-on-growth');
  });

  it('is sellable only when it does not pay for itself', () => {
    expect(isSellableForBudget(evaluateBuildingEconomics('bank', city({ taxRate: 60 })))).toBe(false);
    expect(isSellableForBudget(evaluateBuildingEconomics('sdi_defense', city()))).toBe(true);
  });
});
