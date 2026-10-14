/**
 * Human-city auto-production.
 *
 * The AI and the human share `determineProductionItem`, but they want different
 * things from it. An AI civ must expand: settlers first, because expansion is
 * the AI's job and its scouts come from the same corps. A HUMAN civ with
 * auto-production on wants its city kept busy while the player forms plans —
 * and a civ that cannot see the map cannot form any.
 *
 * The old order put the settler branch BELOW the harbour check but ABOVE the
 * scout branch, and the human settler target carried a +1 works-corps bonus
 * even though the player improves their own tiles. The result, measured: a
 * human capital queued settlers until the target was met, so the scout branch
 * below was never reached — autoproduction added settlers and never a scout.
 *
 * What is pinned here:
 *   1. a human city builds a SCOUT before a settler (exploration first),
 *   2. a human city holds a single replacement settler — never a works corps,
 *   3. a human civ is never charged a colony shortfall (islands the player may
 *      not want),
 *   4. the AI path is unchanged (settlers first, scaled by city count).
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import type { Civilization, Unit } from '../../types/game';

/** A single-city world with one garrisoned city and nothing else happening. */
const humanWorld = (opts: {
  population?: number;
  settlers?: number;
  scouts?: number;
  isHuman?: boolean;
  cities?: number;
  colonizable?: number;
  works?: boolean;
} = {}) => {
  const cityCount = opts.cities ?? 1;
  const cities = Array.from({ length: cityCount }, (_, n) => ({
    id: `city-${n}`,
    name: `Testopolis ${n}`,
    civilizationId: 1,
    col: n,
    row: 0,
    population: opts.population ?? 2,
    buildings: [],
    tradeRoutes: [],
    currentProduction: null,
    buildQueue: [],
    autoProduction: true,
  }));

  const units: Unit[] = [
    // A garrison within 2 tiles so the "no defender" branch stays quiet.
    { id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 } as Unit,
  ];
  for (let s = 0; s < (opts.settlers ?? 0); s++) {
    units.push({
      id: `s${s}`, type: 'settler', civilizationId: 1, col: 5, row: 5,
    } as unknown as Unit);
  }
  for (let s = 0; s < (opts.scouts ?? 0); s++) {
    units.push({
      id: `k${s}`, type: 'scout', civilizationId: 1, col: 6, row: 5,
    } as unknown as Unit);
  }

  const civ: Partial<Civilization> = {
    id: 1,
    name: 'PlayerCiv',
    isAI: !(opts.isHuman ?? true),
    isHuman: opts.isHuman ?? true,
    technologies: ['warrior_code'],
    personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5 },
    productionProfile: 'balanced_growth',
    resources: { gold: 50, science: 0, food: 0, trade: 0, production: 0 },
    taxRate: 50, scienceRate: 30, luxuryRate: 20,
  };

  const productionManager = {
    setCityProduction: vi.fn().mockReturnValue({ success: true }),
    cityHasHarborOrCoast: () => false,
  };

  const engine = {
    cities, units,
    civilizations: [null, civ],
    productionManager,
    getPlayerStorage: () => ({ turnData: {}, visibility: [], explored: [] }),
    squareGrid: {
      squareDistance: (a: number, b: number, c: number, d: number) =>
        Math.max(Math.abs(a - c), Math.abs(b - d)),
      getNeighbors: () => [],
      isValidSquare: () => true,
      findPath: () => [],
    },
    roundManager: { getRoundNumber: () => 10 },
    currentYear: -3000,
    gameSettings: { difficulty: 'PRINCE', mapType: 'CONTINENT' },
    getCityAt: () => null,
    getUnitAt: () => null,
    getTileAt: () => ({ type: 'grassland', terrain: 'grassland', col: 0, row: 0, visible: true, explored: true }),
    map: { width: 20, height: 20 },
    // A naval/colony probe: the number of islands the civ could colonise.
    getColonizableIslands: (id: number) =>
      id === 1 && (opts.colonizable ?? 0) > 0
        ? Array.from({ length: opts.colonizable ?? 0 }, (_, i) => ({ col: 30 + i, row: 30 }))
        : [],
    // The real AI manager answers the three works questions auto-production
    // asks. Without these the works-corps branch is silently dead and the
    // "+1 works settler" bug cannot be observed at all.
    aiManager: {
      wantsPublicWorks: () => opts.works ?? true,
      hasSettlerWorksMandate: () => opts.works ?? true,
      citiesNeedBuildOut: () => opts.works ?? true,
      countOutstandingWorks: () => 25,
      countOutstandingWorksForCity: () => 4,
      colonySettlerShortfall: () => 0,
    },
    diplomacyManager: { isAtWar: () => false, hasContacted: () => true },
  };

  return { engine, productionManager, civ, cities, units };
};

/** Run the private chooser and report what the city would produce. */
const pick = (engine: unknown, cityId = 'city-0'): { type: string; itemType: string } | null => {
  const ap = new AutoProduction(engine as never);
  const city = (engine as { cities: Array<{ id: string }> }).cities.find((c) => c.id === cityId);
  const item = (ap as unknown as {
    determineProductionItem: (c: unknown, t: null, p: string[]) => unknown;
  }).determineProductionItem(city, null, []);
  return (item ?? null) as { type: string; itemType: string } | null;
};

describe('human autoproduction explores first', () => {
  it('builds a SCOUT from a bare capital, not a settler', () => {
    const { engine } = humanWorld({ population: 2, settlers: 0, scouts: 0 });
    const item = pick(engine);
    expect(item?.itemType).toBe('scout');
  });

  it('keeps building scouts while the corps is short (human +1 boost)', () => {
    // One troop → base 1 scout, +1 human boost → 2 wanted.
    const one = humanWorld({ population: 2, scouts: 1 });
    expect(pick(one.engine)?.itemType).toBe('scout');
    // At 2 alive the corps is satisfied, so the city moves on to something else.
    const two = humanWorld({ population: 2, scouts: 2 });
    expect(pick(two.engine)?.itemType).not.toBe('scout');
  });

  it('holds exactly ONE replacement settler and no works corps', () => {
    // Scouts satisfied: a lone replacement settler is queued…
    const none = humanWorld({ population: 2, settlers: 0, scouts: 2 });
    expect(pick(none.engine)?.itemType).toBe('settler');
    // …and a second is not, even with cities left to build out.
    const one = humanWorld({ population: 2, settlers: 1, scouts: 2 });
    expect(pick(one.engine)?.itemType).not.toBe('settler');
  });

  it('never charges the human a colony shortfall', () => {
    // Two "colonisable islands" used to add +2 to the human settler target, so a
    // player who was not colonising got settlers anyway.
    const w = humanWorld({ population: 2, settlers: 1, scouts: 2, colonizable: 2 });
    expect(pick(w.engine)?.itemType).not.toBe('settler');
  });

  it('lets a pop-1 city make its FIRST settler only (the capital move)', () => {
    // Autoproduction must never take a player's only citizen without being
    // asked — except for the classic capital move, where a size-1 city that
    // completes its first settler is dissolved and the settler founds city #2.
    const first = humanWorld({ population: 1, settlers: 0, scouts: 2 });
    expect(pick(first.engine)?.itemType).toBe('settler');
    // With one already alive there is no capital move left, so the pop-1 city
    // is left alone.
    const second = humanWorld({ population: 1, settlers: 1, scouts: 2 });
    expect(pick(second.engine)?.itemType).not.toBe('settler');
  });
});

describe('AI autoproduction is unchanged', () => {
  it('still puts settlers first and scales them with city count', () => {
    // An AI capital with no settler yet builds a settler (the capital move).
    const ai = humanWorld({ population: 2, settlers: 0, scouts: 2, isHuman: false, cities: 1 });
    expect(pick(ai.engine)?.itemType).toBe('settler');
  });

  it('keeps a WORKS corps the human path no longer gets', () => {
    // A mature AI civ (a size-6+ city) with one settler alive still wants more:
    // the governor sizes the works corps from the roads and irrigation the map
    // still owes (25 outstanding works in the mock). The HUMAN path, given the
    // same world, holds exactly one replacement settler — this is the pair that
    // proves the change is scoped to humans.
    const ai = humanWorld({ population: 6, settlers: 1, scouts: 3, isHuman: false, cities: 4 });
    expect(pick(ai.engine)?.itemType).toBe('settler');

    const human = humanWorld({ population: 6, settlers: 1, scouts: 3, isHuman: true, cities: 4 });
    expect(pick(human.engine)?.itemType).not.toBe('settler');
  });
});
