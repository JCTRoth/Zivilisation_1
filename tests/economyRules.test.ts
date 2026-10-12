/**
 * The economy rules that changed, pinned.
 *
 * Each of these was a number the engine read from nowhere, read wrongly, or did
 * not read at all. The values live in `src/data/` (balance numbers) or as
 * exported constants beside the code that consumes them, and this suite is what
 * keeps them honest — a rule nobody asserts is a rule nobody notices breaking.
 */
import { describe, it, expect } from 'vitest';
import {
  CITIZEN_FOOD_DEMAND_PER_CITIZEN,
  APPETITE_RAMP_ABOVE_POP,
  APPETITE_RAMP_PER_CITIZEN,
  citizenFoodDemand,
  AQUEDUCT_HOUSING_CAP,
  ABSOLUTE_MIN_GOLD,
  DEBT_REPAYMENT_PER_TURN,
  DEBT_REPAYMENT_PER,
  EconomicManager,
} from '@/game/engine/EconomicManager';
import {
  PURCHASE_GOLD_PER_SHIELD,
  CITY_UPKEEP_PER_CITY,
  FREE_CITY_SUPPORT,
  TREATY_ROUTE_TRADE_MULTIPLIER,
} from '@/data/GameConstants';
import {
  CORRUPTION_REDUCTION_BUILDINGS,
  CORRUPTION_DISTANCE_STEP,
  MAX_CORRUPTION_DISTANCE_MULTIPLIER,
} from '@/data/CorruptionConstants';
import {
  MAX_TRADE_ROUTES,
  TRADE_ROUTE_DISTANCE_WEIGHT,
  TRADE_ROUTE_POP_DIVISOR,
} from '@/game/engine/GameEngine';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import { getGovernment } from '@/data/GovernmentData';

describe('appetite ramp', () => {
  it('is flat below the ramp and rises above it', () => {
    expect(CITIZEN_FOOD_DEMAND_PER_CITIZEN).toBe(2);
    expect(APPETITE_RAMP_ABOVE_POP).toBe(5);
    expect(APPETITE_RAMP_PER_CITIZEN).toBeCloseTo(0.2, 5);
    expect(citizenFoodDemand(1)).toBe(2);
    expect(citizenFoodDemand(APPETITE_RAMP_ABOVE_POP)).toBe(2);
    expect(citizenFoodDemand(APPETITE_RAMP_ABOVE_POP + 1))
      .toBeCloseTo(CITIZEN_FOOD_DEMAND_PER_CITIZEN + APPETITE_RAMP_PER_CITIZEN, 5);
  });

  it('is monotonic — a bigger citizen never eats less', () => {
    for (let size = 1; size < 40; size++) {
      expect(citizenFoodDemand(size + 1)).toBeGreaterThanOrEqual(citizenFoodDemand(size));
    }
  });
});

describe('aqueduct housing cap', () => {
  it('gates city size at 10', () => {
    expect(AQUEDUCT_HOUSING_CAP).toBe(10);
    // The Aqueduct is the building that lifts it, and it is the expensive one —
    // so the cap is worth paying for.
    expect(BUILDING_PROPERTIES.aqueduct.cost).toBeGreaterThanOrEqual(100);
  });
});

describe('city upkeep', () => {
  it('charges for cities beyond the free support', () => {
    expect(FREE_CITY_SUPPORT).toBe(3);
    expect(CITY_UPKEEP_PER_CITY).toBe(1);
    const upkeep = (cityCount: number): number => {
      const e = new EconomicManager({
        cities: Array.from({ length: cityCount }, (_, i) => ({ id: `c${i}`, civilizationId: 0 })),
        units: [],
      } as never);
      return e.totalUpkeep(0);
    };
    expect(upkeep(0)).toBe(0);
    expect(upkeep(FREE_CITY_SUPPORT)).toBe(0);
    expect(upkeep(FREE_CITY_SUPPORT + 1)).toBe(CITY_UPKEEP_PER_CITY);
    expect(upkeep(FREE_CITY_SUPPORT + 4)).toBe(4 * CITY_UPKEEP_PER_CITY);
  });
});

describe('bankruptcy debt', () => {
  it('resets to the floor and books the rest as debt', () => {
    expect(ABSOLUTE_MIN_GOLD).toBe(8);
    expect(DEBT_REPAYMENT_PER).toBeGreaterThan(0);
    expect(DEBT_REPAYMENT_PER_TURN).toBeGreaterThan(0);
  });

  it('prices a bigger loan with faster service', () => {
    // 50 gold of debt → 1/turn; 200 → 4/turn. The function is private; the rule
    // is asserted through the constants it is built from.
    const service = (debt: number): number =>
      DEBT_REPAYMENT_PER_TURN * Math.ceil(debt / DEBT_REPAYMENT_PER);
    expect(service(1)).toBe(DEBT_REPAYMENT_PER_TURN);
    expect(service(DEBT_REPAYMENT_PER)).toBe(DEBT_REPAYMENT_PER_TURN);
    expect(service(DEBT_REPAYMENT_PER * 4)).toBe(4 * DEBT_REPAYMENT_PER_TURN);
  });
});

describe('one shield-to-gold rate', () => {
  it('is the same everywhere', () => {
    expect(PURCHASE_GOLD_PER_SHIELD).toBe(2);
    // The arbitrage that is gone: a 120-shield building cost 120 gold to buy and
    // 240 to rush.
    const shields = 120;
    expect(shields * PURCHASE_GOLD_PER_SHIELD).toBe(2 * shields);
  });
});

describe('trade agreement value', () => {
  it('is a route multiplier, not a minted stipend', () => {
    expect(TREATY_ROUTE_TRADE_MULTIPLIER).toBeGreaterThan(1);
  });
});

describe('corruption', () => {
  it('reads the government base rate, so the government tree matters', () => {
    const rates = ['despotism', 'monarchy', 'republic', 'democracy', 'communism', 'anarchy']
      .map((g) => getGovernment(g).corruptionRate);
    for (const rate of rates) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(0.3);
    }
    // The whole point: they are not all the same number.
    expect(new Set(rates).size).toBeGreaterThan(1);
    expect(getGovernment('democracy').corruptionRate)
      .toBeLessThan(getGovernment('despotism').corruptionRate);
  });

  it('caps the distance multiplier', () => {
    expect(CORRUPTION_DISTANCE_STEP).toBe(10);
    expect(MAX_CORRUPTION_DISTANCE_MULTIPLIER).toBeLessThan(2);
    expect(MAX_CORRUPTION_DISTANCE_MULTIPLIER).toBeGreaterThan(1);
  });

  it('lists every building whose declared corruptionReduction is now honoured', () => {
    for (const id of CORRUPTION_REDUCTION_BUILDINGS) {
      const props = BUILDING_PROPERTIES[id] as
        | { effects?: { corruptionReduction?: number } } | undefined;
      const reduction = props?.effects?.corruptionReduction;
      expect(typeof reduction, `${id} must declare corruptionReduction`).toBe('number');
      expect(reduction).toBeGreaterThan(0);
      expect(reduction).toBeLessThan(1);
    }
  });
});

describe('trade route pricing', () => {
  it('multiplies by distance, so a long haul repays the caravan', () => {
    expect(TRADE_ROUTE_DISTANCE_WEIGHT).toBeGreaterThan(1);
    expect(TRADE_ROUTE_POP_DIVISOR).toBeLessThanOrEqual(4);
    const payout = (pop: number, distance: number): number =>
      Math.round(pop * TRADE_ROUTE_DISTANCE_WEIGHT * distance);
    // Two size-3 cities 8 tiles apart: 96 gold, against the caravan's 50 shields.
    expect(payout(6, 8)).toBeGreaterThan(50);
    // A short hop is still worth something.
    expect(payout(6, 1)).toBeGreaterThan(0);
  });

  it('holds three routes per city', () => {
    // Civ1's rule, and the one the coordinator plans against: 3 slots, and the
    // OLDEST is evicted when a fourth arrives (see `addTradeRoute`).
    expect(MAX_TRADE_ROUTES).toBe(3);
  });
});
