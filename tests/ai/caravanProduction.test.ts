/**
 * Why a caravan actually reaches the field — and what a route slot is worth.
 *
 * Three fixes, each pinned here, each measured to matter:
 *
 *  1. **The gate is shields and a citizen, not gold.** A Caravan's upkeep is 0,
 *     so `canAffordAnotherUnit` (a per-turn surplus test) was asking the
 *     treasury a question in the wrong currency. The profiled run built
 *     caravans and delivered none because the gate never opened: 0 produced.
 *     With the gate moved, the same batches build ~3.3 caravans per game.
 *  2. **The army cap is gold, not a headcount.** `sustainableUnits` divides a
 *     gold budget by a unit price to make a COUNT, which only works when every
 *     unit costs the same. A caravan (0/turn) took a slot that belonged to a
 *     rifleman (2/turn), so a civ funding its roads was told it was at its
 *     army ceiling.
 *  3. **Trade is planned at the top of the turn**, not lazily under the first
 *     caravan it finds (there is none, until there is — chicken, egg). The
 *     city-production phase that follows asks the coordinator which cities want
 *     caravans, so the plan has to exist before that question is asked.
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import type GameEngine from '@/game/engine/GameEngine';
import { MAX_CARAVANS_PER_CITY, MAX_CARAVAN_TRADE_ROUTES } from '@/data/GameConstants';

/**
 * A two-city civ with the trade tech and empty route slots — everything a
 * caravan decision needs, and nothing else. `previewSurplus` is what the OLD
 * gate asked: a per-turn treasury forecast.
 */
const civEngine = (opts: {
  gold?: number;
  previewSurplus?: number;
  upkeep?: number;
  trueUpkeep?: number;
  cities?: number;
}) => {
  const cities = Array.from({ length: opts.cities ?? 2 }, (_, n) => ({
    id: `city-${n + 1}`,
    name: `City ${n + 1}`,
    civilizationId: 1,
    col: n,
    row: 0,
    population: 3,
    buildings: [],
    tradeRoutes: [],
    buildQueue: [],
    currentProduction: null,
    autoProduction: true,
  }));
  const units = [{ id: 'u1', type: 'warrior', civilizationId: 1, col: 0, row: 0 }];

  const civ = {
    id: 1,
    name: 'TestCiv',
    isAI: true,
    isHuman: false,
    technologies: new Set(['trade']),
    resources: { gold: opts.gold ?? 0 },
    taxRate: 50,
    scienceRate: 30,
    luxuryRate: 20,
    personality: { aggression: 5, diplomacy: 5, military: 5 },
    productionProfile: 'balanced_growth',
  };

  const economicManager = {
    // What the treasury test used to see: a deep deficit is NO answer here.
    previewEconomy: vi.fn(() => ({ net: opts.previewSurplus ?? -25 })),
    affordableUnitUpkeep: vi.fn(() => opts.upkeep ?? 5),
    sustainableUnits: vi.fn(() => 12),
    plannedUnitUpkeep: vi.fn(() => opts.trueUpkeep ?? 2),
    unitMaintenanceOf: vi.fn(() => Math.max(1, opts.trueUpkeep ?? 2)),
    AI_MIN_GOLD_RESERVE: 20,
    describeRates: () => ({ tax: 50, science: 30, luxury: 20 }),
  };

  const engine = {
    cities, units,
    civilizations: [null, civ],
    aiManager: {
      citiesWantingCaravans: vi.fn(() => []),
      countOutstandingWorks: () => 0,
      countOutstandingWorksForCity: () => 0,
    },
    economicManager,
    aiEconomicManager: undefined,
    getPlayerStorage: () => ({ turnData: {} }),
    getCityAt: () => null,
    getUnitAt: () => null,
    getTileAt: () => null,
    getCaravanHomeCity: (caravan: { homeCityId: string }) =>
      cities.find((c) => c.id === caravan.homeCityId) ?? null,
    diplomacyManager: { isAtWar: () => false },
    map: { width: 20, height: 20 },
    squareGrid: { squareDistance: () => 1 },
    roundManager: { getRoundNumber: () => 7 },
    currentYear: -3000,
    gameSettings: { difficulty: 'PRINCE' },
    productionManager: { setCityProduction: vi.fn(() => ({ success: true })) },
  };
  // A hand-built double: everything the governor, the coordinator and the
  // production gate can ask, and nothing else.
  const typed = engine as unknown as GameEngine;
  return { engine: typed, economicManager, civ, cities };
  
};

describe('the caravan production gate', () => {
  it('is open for a broke civ: a caravan costs shields, not gold', () => {
    const { engine, economicManager } = civEngine({ gold: 0, previewSurplus: -25 });
    const ap = new AutoProduction(engine);

    const wants = (ap as unknown as {
      shouldBuildCaravan: (c: unknown, city: unknown, queue: string[]) => boolean;
    }).shouldBuildCaravan(engine.civilizations[1], engine.cities[0], []);

    expect(wants).toBe(true);
    // The treasury forecast is simply never consulted for this decision.
    expect(economicManager.previewEconomy).not.toHaveBeenCalled();
  });

  it('still refuses when the civ has no route room, or too many caravans', () => {
    const full = civEngine({ gold: 0, previewSurplus: -25 });
    for (const c of full.cities) {
      (c as { tradeRoutes: unknown[] }).tradeRoutes =
        Array.from({ length: MAX_CARAVAN_TRADE_ROUTES }, (_, n) => ({ cityId: `r${n}`, trade: 5, round: 1 }));
    }
    const apFull = new AutoProduction(full.engine);
    expect((apFull as never as { shouldBuildCaravan: (c: unknown, city: unknown, q: string[]) => boolean })
      .shouldBuildCaravan(full.engine.civilizations[1], full.cities[0], [])).toBe(false);

    const many = civEngine({ gold: 0, previewSurplus: -25 });
    many.engine.units.push(...Array.from({ length: MAX_CARAVANS_PER_CITY }, (_, n) => ({
      id: `c${n}`, type: 'caravan', civilizationId: 1, col: 9, row: 9, homeCityId: 'city-1',
    })) as unknown as typeof many.engine.units);
    const apMany = new AutoProduction(many.engine);
    expect((apMany as never as { shouldBuildCaravan: (c: unknown, city: unknown, q: string[]) => boolean })
      .shouldBuildCaravan(many.engine.civilizations[1], many.cities[0], [])).toBe(false);
  });

  it('stays a pop-2 floor: a size-1 city does not divert its one citizen', () => {
    const small = civEngine({ gold: 0, previewSurplus: -25 });
    (small.cities[0] as { population: number }).population = 1;
    const ap = new AutoProduction(small.engine);
    expect((ap as never as { shouldBuildCaravan: (c: unknown, city: unknown, q: string[]) => boolean })
      .shouldBuildCaravan(small.engine.civilizations[1], small.cities[0], [])).toBe(false);
  });
});

describe('the army cap', () => {
  const cap = (engine: GameEngine) =>
    (new AutoProduction(engine) as never as {
      isUnitCapExhausted: (civId: number, type?: string) => boolean;
    }).isUnitCapExhausted(1, 'caravan');

  it('a zero-upkeep unit never exhausts a gold cap', () => {
    const { engine, economicManager } = civEngine({ gold: 0, previewSurplus: -25, trueUpkeep: 0 });
    expect(cap(engine)).toBe(false);
    // …and it never even had to look: the price alone settles it.
    expect(economicManager.affordableUnitUpkeep).not.toHaveBeenCalled();
  });

  it('a priced unit is refused when the income cannot keep it alive', () => {
    const poor = civEngine({ gold: 0, previewSurplus: -25, upkeep: 1 });
    // The mock prices a caravan at 2 for this case.
    (poor.economicManager.plannedUnitUpkeep as unknown as { mockReturnValue: (n: number) => void })
      .mockReturnValue(2);
    expect(cap(poor.engine)).toBe(true);
  });

  it('a priced unit is allowed when the income covers its upkeep', () => {
    const rich = civEngine({ gold: 500, previewSurplus: 40, upkeep: 9 });
    (rich.economicManager.plannedUnitUpkeep as unknown as { mockReturnValue: (n: number) => void })
      .mockReturnValue(2);
    expect(cap(rich.engine)).toBe(false);
  });
});
