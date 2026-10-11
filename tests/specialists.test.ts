/**
 * Unit tests for the Civ1 Specialists system.
 *
 * Specialists: when a citizen is pulled off a tile they become a Specialist
 * (Entertainer / Taxman / Scientist), trading raw tile yields for fixed
 * city-specific yields (Luxury / Gold / Science).
 *
 * Covers:
 *  - specialistYields aggregation
 *  - cityWorkedTiles sizing (population − specialists)
 *  - Specialist constants and types
 *  - GameEngine promote/demote/removeCitizenFromTile
 */
import { describe, it, expect } from 'vitest';
import { SPECIALIST_YIELDS } from '../src/data/GameConstants';
import type { City, SpecialistType } from '../types/game';
import { EconomicManager } from '../src/game/engine/EconomicManager';
import GameEngine from '../src/game/engine/GameEngine';
import { checkInvariants } from './helpers/world';

/**
 * Found a city on a real map and hand it back typed as the domain City, which
 * carries the optional citizen fields (`specialists`, `workingTiles`) that
 * `foundCity`'s inferred literal type omits.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function realCity(engine: GameEngine, col: number, row: number, pop: number): Promise<any> {
  const city = engine.foundCity(col, row, 0, `City${col}`) as unknown as City;
  city.population = pop;
  city.specialists = [];
  if (!city.workingTiles) city.workingTiles = new Set<string>();
  return city;
}

/** A real engine on a fixed map — the conversion path touches real tiles. */
async function realEngine(): Promise<GameEngine> {
  const engine = new GameEngine(null);
  (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
  await engine.initialize({
    numberOfCivilizations: 2,
    mapType: 'MANY_CITIES',
    devMode: false,
    startingGold: 100,
  });
  return engine;
}

// ── Shared mock helpers (from governmentManager.test.ts) ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEngine(overrides: any = {}): any {
  const engine: any = {
    civilizations: [],
    cities: [],
    units: [],
    economicManager: {
      setGovernment: () => {},
    },
    log: () => {},
    ...overrides,
  };
  return engine;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCiv(id: number, overrides: any = {}): any {
  return {
    id,
    name: `Civ${id}`,
    government: 'despotism',
    technologies: [],
    capital: null,
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: 50 },
    taxRate: 0,
    scienceRate: 50,
    luxuryRate: 50,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCity(civId: number, overrides: any = {}): any {
  return {
    id: `city-${civId}-1`,
    name: `City ${civId}`,
    civilizationId: civId,
    col: 5,
    row: 5,
    population: 3,
    buildings: [],
    isCapital: false,
    yields: { food: 6, production: 3, trade: 4 },
    specialists: [],
    workingTiles: new Set<string>(['5,5', '5,4', '6,5']),
    ...overrides,
  };
}

// ── Specialist constants ────────────────────────────────────────────────

describe('Specialist constants', () => {
  it('has all three specialist types defined', () => {
    expect(SPECIALIST_YIELDS.entertainer).toBeDefined();
    expect(SPECIALIST_YIELDS.taxman).toBeDefined();
    expect(SPECIALIST_YIELDS.scientist).toBeDefined();
  });

  it('entertainer provides +2 luxury, no gold or science', () => {
    expect(SPECIALIST_YIELDS.entertainer.luxury).toBe(2);
    expect(SPECIALIST_YIELDS.entertainer.gold).toBe(0);
    expect(SPECIALIST_YIELDS.entertainer.science).toBe(0);
  });

  it('taxman provides +2 gold, no luxury or science', () => {
    expect(SPECIALIST_YIELDS.taxman.gold).toBe(2);
    expect(SPECIALIST_YIELDS.taxman.luxury).toBe(0);
    expect(SPECIALIST_YIELDS.taxman.science).toBe(0);
  });

  it('scientist provides +2 science, no luxury or gold', () => {
    expect(SPECIALIST_YIELDS.scientist.science).toBe(2);
    expect(SPECIALIST_YIELDS.scientist.luxury).toBe(0);
    expect(SPECIALIST_YIELDS.scientist.gold).toBe(0);
  });

  it('each specialist has an icon', () => {
    expect(typeof SPECIALIST_YIELDS.entertainer.icon).toBe('string');
    expect(typeof SPECIALIST_YIELDS.taxman.icon).toBe('string');
    expect(typeof SPECIALIST_YIELDS.scientist.icon).toBe('string');
  });
});

// ── EconomicManager.specialistYields ────────────────────────────────────

describe('EconomicManager.specialistYields', () => {
  it('returns zero when no specialists', () => {
    const engine = makeEngine();
    const econ = new EconomicManager(engine);
    const city = makeCity(0, { specialists: [] });
    expect(econ.specialistYields(city)).toEqual({ luxury: 0, gold: 0, science: 0 });
  });

  it('sums multiple specialist yields', () => {
    const engine = makeEngine();
    const econ = new EconomicManager(engine);
    const city = makeCity(0, {
      specialists: ['entertainer', 'taxman', 'scientist'] as SpecialistType[],
    });
    expect(econ.specialistYields(city)).toEqual({ luxury: 2, gold: 2, science: 2 });
  });

  it('handles multiple entertainers', () => {
    const engine = makeEngine();
    const econ = new EconomicManager(engine);
    const city = makeCity(0, {
      specialists: ['entertainer', 'entertainer', 'entertainer'] as SpecialistType[],
    });
    expect(econ.specialistYields(city)).toEqual({ luxury: 6, gold: 0, science: 0 });
  });

  it('handles undefined specialists gracefully', () => {
    const engine = makeEngine();
    const econ = new EconomicManager(engine);
    const city = makeCity(0, { specialists: undefined });
    expect(econ.specialistYields(city)).toEqual({ luxury: 0, gold: 0, science: 0 });
  });
});

// ── Specialist integration with happiness ────────────────────────────────

describe('Specialist luxury helps prevent disorder', () => {
  it('a city on the brink of disorder becomes content with an entertainer', () => {
    const engine = makeEngine();
    const econ = new EconomicManager(engine);
    // 0% luxury → no luxury from rate split; despotism (tolerance 2).
    const civ = makeCiv(0, { government: 'despotism', luxuryRate: 0, taxRate: 100, scienceRate: 0 });
    engine.civilizations = [civ];

    // No tolerance: unhappiness = population. A pop-4 city with 0% luxury and no
    // buildings has happiness = 2 (base contentment), so 2 < 4 → disorder.
    const city = makeCity(0, { population: 4, specialists: [] });
    const result1 = econ.cityHappiness(city, civ);
    expect(result1.unhappiness).toBe(4);
    expect(result1.disorder).toBe(true);

    // Add an entertainer → +2 luxury → happiness = 4. 4 > 4 is false → content.
    const cityWithSpec = makeCity(0, { population: 4, specialists: ['entertainer'] as SpecialistType[] });
    const result2 = econ.cityHappiness(cityWithSpec, civ);
    expect(result2.disorder).toBe(false);
  });
});

// ── Specialist yields in processTurn totals ──────────────────────────────

describe('Specialist yields flow into processTurn totals', () => {
  it('taxman gold is added to civ resources', () => {
    const engine = makeEngine({
      getTileAt: () => ({ type: 'grassland', resource: null, improvement: null, hasRoad: false, hasRiver: false, village: false }),
      squareGrid: {
        squareDistance: (c1: number, r1: number, c2: number, r2: number) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
        chebyshevDistance: (c1: number, r1: number, c2: number, r2: number) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
      },
    });
    const civ = makeCiv(0, { taxRate: 50, scienceRate: 50, luxuryRate: 0 });
    engine.civilizations = [civ];
    // City with 3 taxman specialists, no trade (0% tax → 0 tax income)
    // but specialists add +6 gold directly.
    const city = makeCity(0, {
      population: 3,
      specialists: ['taxman', 'taxman', 'taxman'] as SpecialistType[],
      workingTiles: new Set<string>(['5,5']),
      yields: { food: 4, production: 2, trade: 0 },
      tradeRoutes: [],
    });
    engine.cities = [city];
    engine.units = [];

    const econ = new EconomicManager(engine);
    const goldBefore = civ.resources.gold;
    econ.processTurn(civ);

    // Specialist Taxman gold (3 × 2 = 6) should be added to the treasury.
    // City upkeep and corruption may reduce the net, but gold must increase
    // by at least the specialist gold minus city upkeep.
    const goldAfter = civ.resources.gold;
    const specGold = 3 * 2; // 3 taxmen × 2 gold each
    expect(goldAfter).toBeGreaterThanOrEqual(goldBefore + specGold - 2);
  });
});

// ── convertTileCitizenToSpecialist ────────────────────────────────────────

describe('convertTileCitizenToSpecialist', () => {
  it('moves one citizen off a worked tile onto the specialist list', async () => {
    const engine = await realEngine();
    const city = await realCity(engine, 20, 20, 3);
    // The centre is worked for free, but foundCity leaves the set empty — the
    // governor adds it lazily. Add it so the invariant holds here too.
    city.workingTiles.add('20,20');
    city.workingTiles.add('20,21');
    city.workingTiles.add('20,22');
    expect(city.workingTiles.size).toBe(3);

    const ok = engine.convertTileCitizenToSpecialist(city.id, 20, 21, 'taxman');

    expect(ok).toBe(true);
    expect(city.workingTiles.has('20,21')).toBe(false);
    expect(city.workingTiles.has('20,22')).toBe(true);
    expect(city.specialists).toEqual(['taxman']);
    // The invariant: tiles + specialists === population. A citizen moved, none vanished.
    expect(city.workingTiles.size + city.specialists.length).toBe(city.population);
    expect(checkInvariants(engine)).toEqual([]);
  });

  it('refuses to convert the free centre tile', async () => {
    const engine = await realEngine();
    const city = await realCity(engine, 24, 24, 2);
    city.workingTiles.add('24,24'); // the free centre
    city.workingTiles.add('24,25');

    const ok = engine.convertTileCitizenToSpecialist(city.id, 24, 24, 'scientist');

    expect(ok).toBe(false);
    // Nothing moved: the centre still stands and no specialist appeared.
    expect(city.workingTiles.has('24,24')).toBe(true);
    expect(city.specialists).toEqual([]);
  });

  it('falls back to entertainer when no type is given', async () => {
    const engine = await realEngine();
    const city = await realCity(engine, 28, 28, 2);
    city.workingTiles.add('28,29');

    expect(engine.convertTileCitizenToSpecialist(city.id, 28, 29)).toBe(true);
    expect(city.specialists).toEqual(['entertainer']);
  });

  it('refuses when every citizen is already a specialist', async () => {
    const engine = await realEngine();
    const city = await realCity(engine, 32, 32, 1);
    city.specialists = ['entertainer'];
    // A pop-1 city with one specialist has no tile citizen left to hand over.

    const ok = engine.convertTileCitizenToSpecialist(city.id, 32, 33, 'scientist');

    expect(ok).toBe(false);
    expect(city.specialists).toEqual(['entertainer']);
  });

  it('is refused on a tile the city is not working', async () => {
    const engine = await realEngine();
    const city = await realCity(engine, 36, 36, 2);
    city.workingTiles.add('36,37');

    // (36,39) is in the radius but nobody works it — no citizen to convert.
    const ok = engine.convertTileCitizenToSpecialist(city.id, 36, 39, 'entertainer');

    expect(ok).toBe(false);
    expect(city.specialists).toEqual([]);
  });
});
