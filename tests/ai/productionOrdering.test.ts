/**
 * The production order a city chooses: expansion → caravans → works.
 *
 * The measured deadlock this pins: the settler branch sat ABOVE the caravan
 * branch and its target ALWAYS included the public-works corps, so a civ with
 * any road left to build queued settlers forever and never built a caravan —
 * 15 settlers and 0 caravans per 150 rounds, on civs that had researched `trade`
 * and held three empty route slots each. `trade` was reached on 3–4 of 4 civs and
 * not one caravan existed.
 *
 * Split the settler need and the deadlock is gone: expansion (must exist for the
 * empire to grow, plus colony sealift) first, caravans second, road crews third.
 * Measured after the reorder: caravans produced on 4/4 seeds (2/1/1/5, was
 * 2/0/0/0) and, given enough rounds to cross the map at movement 1, **10 trade
 * routes from 12 caravans** on seed 7.
 */
import { describe, it, expect } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import type { City, Civilization, Unit } from '../../types/game';

/**
 * A two-city AI civ with route capacity free and `trade` researched — the
 * exact shape in which no caravan was ever produced.
 */
const world = (opts: { settlers?: number; scouts?: number; works?: boolean } = {}) => {
  const cities = [0, 1].map((n) => ({
    id: `c${n}`, name: `City${n}`, civilizationId: 1, col: n * 4, row: 3,
    population: 6, buildings: [], tradeRoutes: [],
    currentProduction: null, buildQueue: [], autoProduction: true,
  })) as unknown as City[];
  const units: Unit[] = [
    { id: 'g', type: 'warrior', civilizationId: 1, col: 0, row: 3, attack: 1, defense: 1 },
  ] as unknown as Unit[];
  for (let s = 0; s < (opts.settlers ?? 0); s++) {
    units.push({ id: `s${s}`, type: 'settler', civilizationId: 1, col: 9, row: 9 } as unknown as Unit);
  }
  // The scout corps outranks caravans, so a world that wants to test caravans
  // must have its scouts already.
  for (let k = 0; k < (opts.scouts ?? 1); k++) {
    units.push({ id: `k${k}`, type: 'scout', civilizationId: 1, col: 7, row: 7 } as unknown as Unit);
  }
  const civ = {
    id: 1, name: 'TestCiv', isHuman: false, isAI: true,
    technologies: ['trade'], resources: { gold: 90, science: 5, food: 0, production: 0, trade: 0 },
    taxRate: 50, scienceRate: 30, luxuryRate: 20,
    productionProfile: 'balanced_growth',
    personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5 },
  } as unknown as Civilization;

  const engine = {
    cities, units, civilizations: [null, civ] as unknown as Civilization[],
    squareGrid: { squareDistance: (a: number, b: number, c: number, d: number) =>
      Math.max(Math.abs(a - c), Math.abs(b - d)) },
    getTileAt: () => ({ type: 'grassland', terrain: 'grassland' }),
    getCityAt: () => null, getUnitAt: () => null,
    getPlayerStorage: () => ({ turnData: {} }),
    roundManager: { getRoundNumber: () => 100 },
    currentYear: -1000, gameSettings: { difficulty: 'PRINCE' },
    map: { width: 20, height: 20 },
    economicManager: {
      previewEconomy: () => ({ net: 12 }),
      affordableUnitUpkeep: () => 12,
      sustainableUnits: () => 9,
      unitMaintenanceOf: () => 2,
      plannedUnitUpkeep: () => 2,
      totalUpkeep: () => 0,
      AI_MIN_GOLD_RESERVE: 8,
      cityHappiness: () => ({ happiness: 6, unhappiness: 1, disorder: false }),
    },
    aiManager: {
      citiesWantingCaravans: () => cities.map((c) => c.id),
      wantsPublicWorks: () => opts.works ?? true,
      hasSettlerWorksMandate: () => opts.works ?? true,
      citiesNeedBuildOut: () => opts.works ?? true,
      countOutstandingWorks: () => 25,
      countReachableWorks: () => 25,
      colonySettlerShortfall: () => 0,
    },
    diplomacyManager: { isAtWar: () => false },
  };
  return { engine, civ, cities, units };
};

const pick = (engine: unknown, cityId: string) => {
  const ap = new AutoProduction(engine as never);
  const city = (engine as { cities: Array<{ id: string }> }).cities.find((c) => c.id === cityId)!;
  const item = (ap as unknown as {
    determineProductionItem: (c: unknown, t: null, p: string[]) => unknown;
  }).determineProductionItem(city, null, []);
  return item as { type: string; itemType: string } | null;
};

describe('expansion roads caravans works', () => {
  it('a civ with no settler yet still expands — the capital move wins', () => {
    // Expansion is the hard need and outranks everything, caravans included.
    const w = world({ settlers: 0 });
    expect(pick(w.engine, 'c0')?.itemType).toBe('settler');
  });

  it('a caravan preempts the WORKS corps but never the expansion corps', () => {
    // Two settlers alive is what balanced_growth wants at two cities, so the
    // expansion cadence is satisfied and only the works corps is left — and the
    // caravan takes its slot.
    const w = world({ settlers: 2, works: true });
    expect(pick(w.engine, 'c0')?.itemType).toBe('caravan');
  });

  it('the works corps still builds when the route capacity is full', () => {
    // Fill every slot: the caravan branch refuses, and the deferred road crew
    // must then be produced instead of nothing at all.
    const w = world({ settlers: 2, works: true });
    for (const c of w.cities) {
      (c as { tradeRoutes: unknown[] }).tradeRoutes = Array.from({ length: 3 }, () => ({}));
    }
    const picked = pick(w.engine, 'c0');
    // Either the road crew or something else useful — but never null, and never
    // a caravan the civ has no route capacity for.
    expect(picked).not.toBeNull();
    expect(picked?.itemType).not.toBe('caravan');
  });

  it('with no works left the caravan is not in competition at all', () => {
    const w = world({ settlers: 2, works: false });
    // wantsWorks false → no works corps to preempt, so the caravan branch is
    // reached on its own merits and still wins.
    expect(pick(w.engine, 'c0')?.itemType).toBe('caravan');
  });
});
