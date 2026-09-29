import { describe, it, expect, vi } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';

const createMockEngine = () => {
  const city = {
    id: 'city-1',
    name: 'Testopolis',
    civilizationId: 1,
    col: 0,
    row: 0,
    population: 3,
    buildings: [],
    currentProduction: null,
    autoProduction: true
  };

  const units = [
    { id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 },
    // Satisfied settler corps (balanced_growth @4 cities wants 2) so the
    // expansion branch doesn't pre-empt the offensive-support branch.
    { id: 's1', type: 'settler', civilizationId: 1, col: 5, row: 5 },
    { id: 's2', type: 'settler', civilizationId: 1, col: 6, row: 5 },
  ];

  // The civ already has 4 cities, so the (now higher-priority) settler
  // expansion branch is skipped and the offensive-support branch is reachable.
  const extraCities = [2, 3, 4].map((n) => ({
    id: `city-${n}`,
    name: `Testopolis ${n}`,
    civilizationId: 1,
    col: n,
    row: n,
    population: 3,
    buildings: [],
    autoProduction: true
  }));

  const productionManager = {
    setCityProduction: vi.fn().mockReturnValue({ success: true })
  };

  const storage = {
    turnData: {
      offensivePlan: {
        requiredUnits: 4
      }
    }
  };

  const engine: any = {
    cities: [city, ...extraCities],
    units,
    civilizations: [
      null,
      {
        id: 1,
        name: 'TestCiv',
        technologies: new Set(['warrior_code']),
        personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
        warWith: new Set(),
      }
    ],
    productionManager,
    getPlayerStorage: () => storage,
    squareGrid: {
      squareDistance: () => 1
    },
    roundManager: {
      getRoundNumber: () => 0
    },
    currentYear: -500,
    gameSettings: { difficulty: 'PRINCE' },
    getCityAt: () => null,
    getUnitAt: () => null,
    map: { width: 20, height: 20 }
  };

  return { engine, productionManager };
};

describe('AutoProduction offensive support', () => {
  it('builds offensive units when a campaign requires reinforcements', () => {
    const { engine, productionManager } = createMockEngine();
    const autoProduction = new AutoProduction(engine);

    autoProduction.setAutoProduction('city-1');

    expect(productionManager.setCityProduction).toHaveBeenCalled();
    const item = productionManager.setCityProduction.mock.calls[0][1];
    expect(item.type).toBe('unit');
    expect(item.itemType).toBe('archer');
  });
});

/**
 * Scout corps maintenance: the AI builds 1–3 scouts depending on total troop
 * count (<6 → 1, 6–11 → 2, >=12 → 3), always ranking below city defense.
 */
describe('AutoProduction scout corps', () => {
  const createScoutMockEngine = (totalTroops: number, scoutCount: number, numCities: number = 1, settlers: number = 0) => {
    const city = {
      id: 'city-1',
      name: 'Testopolis',
      civilizationId: 1,
      col: 0,
      row: 0,
      population: 3,
      buildings: [],
      currentProduction: null,
      autoProduction: true
    };

    // Extra cities (when numCities > 1) skip the settler-expansion branch so
    // the scout branch stays reachable for already-expanded civs.
    const extraCities = [];
    for (let n = 2; n <= numCities; n++) {
      extraCities.push({
        id: `city-${n}`,
        name: `Testopolis ${n}`,
        civilizationId: 1,
        col: n,
        row: n,
        population: 3,
        buildings: [],
        autoProduction: true
      });
    }

    const units: any[] = [];
    // One defender in the city so the "needs defender" step is satisfied.
    units.push({ id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 });
    // A satisfied settler corps (balanced_growth @4 cities wants 2) keeps the
    // expansion branch from pre-empting the scout branch; @1 city (default 0
    // settlers) the expansion branch is expected to fire instead.
    for (let i = 0; i < settlers; i++) {
      units.push({ id: `settler${i}`, type: 'settler', civilizationId: 1, col: 8, row: 8 });
    }
    // Fill the remaining troop budget with warriors (military type).
    const extraTroops = Math.max(0, totalTroops - 1 - scoutCount);
    for (let i = 0; i < extraTroops; i++) {
      units.push({ id: `troop${i}`, type: 'warrior', civilizationId: 1, col: 10, row: 10, attack: 1, defense: 1 });
    }
    for (let i = 0; i < scoutCount; i++) {
      units.push({ id: `scout${i}`, type: 'scout', civilizationId: 1, col: 12, row: 12, attack: 0.5, defense: 1 });
    }

    const productionManager = { setCityProduction: vi.fn().mockReturnValue({ success: true }) };
    // No offensive plan → the scout step is reachable (step 4 skipped).
    const storage = { turnData: {} };

    const engine: any = {
      cities: [city, ...extraCities],
      units,
      civilizations: [
        null,
        {
          id: 1,
          name: 'TestCiv',
          technologies: new Set(['warrior_code']),
          personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
          warWith: new Set(),
        }
      ],
      productionManager,
      getPlayerStorage: () => storage,
      squareGrid: { squareDistance: () => 1 },
      roundManager: { getRoundNumber: () => 0 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 }
    };

    return { engine, productionManager };
  };

  const producedItem = (pm: any) => pm.setCityProduction.mock.calls[0][1];

  it('builds a scout for a small army (< 6 troops) with no scouts yet', () => {
    const { engine, productionManager } = createScoutMockEngine(2, 0, 4, 2);
    new AutoProduction(engine).setAutoProduction('city-1');

    expect(productionManager.setCityProduction).toHaveBeenCalled();
    expect(producedItem(productionManager).itemType).toBe('scout');
  });

  it('builds a scout when 6+ troops want a second scout', () => {
    const { engine, productionManager } = createScoutMockEngine(6, 0, 4, 2);
    new AutoProduction(engine).setAutoProduction('city-1');

    expect(producedItem(productionManager).itemType).toBe('scout');
  });

  it('builds a scout when 12+ troops want a third scout', () => {
    const { engine, productionManager } = createScoutMockEngine(12, 0, 4, 2);
    new AutoProduction(engine).setAutoProduction('city-1');

    expect(producedItem(productionManager).itemType).toBe('scout');
  });

  it('does not build more scouts when already at the target count', () => {
    // 2 troops → wants 1 scout; already has 1 → falls through to settlers.
    const { engine, productionManager } = createScoutMockEngine(2, 1);
    new AutoProduction(engine).setAutoProduction('city-1');

    expect(producedItem(productionManager).itemType).not.toBe('scout');
    expect(producedItem(productionManager).itemType).toBe('settler');
  });

  it('defender need outranks scout production', () => {
    const { engine, productionManager } = createScoutMockEngine(6, 0);
    // Remove the defender from the city tile → city needs a defender first.
    engine.units = engine.units.filter((u: any) => u.id !== 'def');
    new AutoProduction(engine).setAutoProduction('city-1');

    const item = producedItem(productionManager);
    expect(item.type).toBe('unit');
    expect(item.itemType).not.toBe('scout');
  });
});

/**
 * Happiness economy regression: a city spending 40%+ of its commerce on
 * luxury must build a temple BEFORE a defender. Otherwise the "no defender"
 * branch keeps producing military (each unit walks off the tile, so the city
 * never shows a defender) and the temple that would fix the economy is never
 * built — the civ stays at 70% luxury / 0 science all game (the 167-round
 * AI-vs-AI log: both civs stalled this way and never fought a real war).
 */
describe('AutoProduction happiness emergency', () => {
  const createHappinessMockEngine = () => {
    const city = {
      id: 'city-1',
      name: 'Testopolis',
      civilizationId: 1,
      col: 0,
      row: 0,
      population: 3,
      buildings: [],
      currentProduction: null,
      autoProduction: true,
    };
    const productionManager = { setCityProduction: vi.fn().mockReturnValue({ success: true }) };
    const engine: any = {
      cities: [city],
      units: [],
      civilizations: [
        null,
        {
          id: 1,
          name: 'TestCiv',
          technologies: new Set(['warrior_code', 'ceremonial_burial']),
          personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
          warWith: new Set(),
          luxuryRate: 0,
        },
      ],
      productionManager,
      getPlayerStorage: () => ({ turnData: {} }),
      squareGrid: { squareDistance: () => 1 },
      roundManager: { getRoundNumber: () => 0 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 },
    };
    return { engine, productionManager };
  };

  it('builds a temple in a luxury crisis even with no defender on the tile', () => {
    const { engine, productionManager } = createHappinessMockEngine();
    // No defender anywhere → the (old) "needs defender" branch would fire.
    // 60% luxury → isHappinessCrisis true, so the temple must win.
    engine.civilizations[1].luxuryRate = 60;

    new AutoProduction(engine).setAutoProduction('city-1');

    expect(productionManager.setCityProduction).toHaveBeenCalled();
    const item = productionManager.setCityProduction.mock.calls[0][1];
    expect(item.type).toBe('building');
    expect(item.itemType).toBe('temple');
  });

  it('counts a defender within 2 tiles as garrison (no endless defender builds)', () => {
    const { engine, productionManager } = createHappinessMockEngine();
    // A defender sits adjacent (mock squareDistance always returns 1) instead
    // of ON the city tile — it must still satisfy the garrison check so the
    // city stops producing defenders forever.
    engine.units = [{ id: 'def', type: 'warrior', civilizationId: 1, col: 1, row: 1, attack: 1, defense: 1 }];

    new AutoProduction(engine).setAutoProduction('city-1');

    const item = productionManager.setCityProduction.mock.calls[0][1];
    // Not another defender (the garrison is satisfied) — falls through to the
    // settler/expansion branch.
    expect(item.itemType).not.toBe('warrior');
    expect(item.itemType).not.toBe('phalanx');
  });
});

/**
 * The doctrine probes the map (colonisable islands), per-city threats and the
 * economy, and auto-production asks for it once per city per queue slot. The
 * verdict is cached per civ on the cheap counts it consumes; these tests pin
 * both halves of that: repeats are free, and any count change re-runs it.
 */
describe('AutoProduction naval doctrine caching', () => {
  const createDoctrineMockEngine = () => {
    const city = {
      id: 'city-1',
      name: 'Testopolis',
      civilizationId: 1,
      col: 0,
      row: 0,
      population: 3,
      buildings: [],
      currentProduction: null,
      autoProduction: true,
    };
    const engine: any = {
      cities: [city],
      units: [],
      civilizations: [
        null,
        {
          id: 1,
          name: 'TestCiv',
          technologies: new Set<string>(),
          resources: { gold: 100 },
          personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
          warWith: new Set(),
        },
      ],
      getPlayerStorage: () => ({ turnData: {} }),
      roundManager: { getRoundNumber: () => 7 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 },
      // The expensive probe the cache must keep off the hot path.
      getColonizableIslands: vi.fn(() => []),
    };
    return { engine };
  };

  it('answers repeated queries for an unchanged civ from the cache', () => {
    const { engine } = createDoctrineMockEngine();
    const autoProduction = new AutoProduction(engine);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forCiv = (autoProduction as any).navalDoctrineFor.bind(autoProduction);

    const first = forCiv(1);
    expect(first).not.toBeNull();
    expect(forCiv(1)).toBe(first);
    expect(forCiv(1)).toBe(first);
    expect(engine.getColonizableIslands).toHaveBeenCalledTimes(1);
  });

  it('re-runs the doctrine when a count it consumes changes', () => {
    const { engine } = createDoctrineMockEngine();
    const autoProduction = new AutoProduction(engine);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forCiv = (autoProduction as any).navalDoctrineFor.bind(autoProduction);

    const first = forCiv(1);
    // A new unit changes the naval counts even though `round` is unchanged.
    engine.units.push({
      id: 'fer', type: 'ferry', civilizationId: 1, col: 0, row: 0, isDefeated: false, attack: 0, defense: 0,
    });
    const second = forCiv(1);
    expect(second).not.toBe(first);
    expect(engine.getColonizableIslands).toHaveBeenCalledTimes(2);

    // …and a treasury change too.
    engine.civilizations[1].resources.gold = 50;
    forCiv(1);
    expect(engine.getColonizableIslands).toHaveBeenCalledTimes(3);
  });

  it('re-runs the doctrine on the next round even with no count change', () => {
    const { engine } = createDoctrineMockEngine();
    const autoProduction = new AutoProduction(engine);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forCiv = (autoProduction as any).navalDoctrineFor.bind(autoProduction);

    forCiv(1);
    engine.roundManager.getRoundNumber = () => 8;
    forCiv(1);
    expect(engine.getColonizableIslands).toHaveBeenCalledTimes(2);
  });
});
