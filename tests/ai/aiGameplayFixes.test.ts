/**
 * Direct fixes from the AI-vs-AI progression analysis:
 *  - civ.score is computed every turn (it stayed 0 for the whole game),
 *  - a Harbor can never be built without a water connection, and the AI gives
 *    it zero priority inland / a solid weight on the coast,
 *  - military units (not just scouts) remember tiles they could not enter, so
 *    repeated `move_failed` loops stop.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { AIBuildingStrategy } from '@/game/engine/AI/AIBuildingStrategy';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { computeAggression, planBulkAttack } from '@/game/engine/AI/AIAggression';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const G = TERRAIN_TYPES.GRASSLAND;

function makeEngine(rows: string[][]) {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.devMode = true;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
    ),
  };
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return e as GameEngine;
}

describe('Live scoreboard', () => {
  it('computes civ.score every turn end (population + land + cities + techs + wonders)', () => {
    const e = makeEngine(Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => G)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = e as any;
    engine.civilizations = [
      { id: 0, name: 'A', isHuman: true, isAlive: true, technologies: ['a', 'b'], score: 0 },
      { id: 1, name: 'B', isHuman: false, isAlive: true, technologies: [], score: 0 },
    ];
    engine.cities = [
      { id: 'c0', name: 'A City', civilizationId: 0, col: 3, row: 3, population: 2, buildings: ['pyramids'], buildQueue: [], currentProduction: null, tradeRoutes: [] },
      { id: 'c1', name: 'B City', civilizationId: 1, col: 5, row: 5, population: 1, buildings: [], buildQueue: [], currentProduction: null, tradeRoutes: [] },
    ];
    engine.units = [
      { id: 'u0', type: 'warrior', civilizationId: 0, col: 3, row: 3, health: 100, movesRemaining: 1, isDefeated: false },
      { id: 'u1', type: 'warrior', civilizationId: 1, col: 5, row: 5, health: 100, movesRemaining: 1, isDefeated: false },
    ];
    engine.isGameOver = false;

    e.victoryManager.evaluateEndOfTurn();

    const before = engine.civilizations[0].score as number;
    expect(before).toBeGreaterThan(0);

    // Score reacts to empire growth: one more technology adds exactly 5.
    engine.civilizations[0].technologies.push('c');
    e.victoryManager.evaluateEndOfTurn();
    expect(engine.civilizations[0].score).toBe(before + 5);

    // Pollution from buildings subtracts from the score.
    engine.cities[0].buildings.push('factory'); // pollution: 2
    e.victoryManager.evaluateEndOfTurn();
    expect(engine.civilizations[0].score).toBe(before + 5 - 2);

    // Peace years accumulate: after 5 peace turns the bonus is +1.
    engine.civilizations[0].peaceTurns = 4;
    e.victoryManager.evaluateEndOfTurn();
    expect(engine.civilizations[0].peaceTurns).toBe(5);
    expect(engine.civilizations[0].score).toBe(before + 5 - 2 + 1);
  });
});

describe('Harbor is only built when needed', () => {
  const city = {
    id: 'city-1', name: 'Port', civilizationId: 0, col: 1, row: 1,
    population: 3, buildings: [], specialists: [], workingTiles: new Set(['1,1']),
    currentProduction: null, autoProduction: true,
  };
  const civ = {
    id: 0, name: 'Civ', technologies: ['masonry'],
    personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
  };
  const gameState = {
    currentYear: -1000, roundNumber: 10, isBorderCity: false,
    isUnderThreat: false, numCities: 2,
  };

  it('gives an inland city zero harbor priority', () => {
    const plans = AIBuildingStrategy.evaluateBuildings(
      city as never, civ as never, 'balanced_growth', { ...gameState, cityCoastal: false },
    );
    expect(plans.find((p) => p.buildingType === 'harbor')).toBeUndefined();
  });

  it('gives a coastal city a solid harbor priority', () => {
    const plans = AIBuildingStrategy.evaluateBuildings(
      city as never, civ as never, 'balanced_growth', { ...gameState, cityCoastal: true },
    );
    const harbor = plans.find((p) => p.buildingType === 'harbor');
    expect(harbor).toBeDefined();
    expect(harbor!.priority).toBeGreaterThan(0);
  });

  it('ProductionManager rejects a harbor in a landlocked city', () => {
    // All-land map → the city has no water connection.
    const e = makeEngine([[G, G, G], [G, G, G], [G, G, G]]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: ['masonry'] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [{ ...city, col: 1, row: 1 }];

    const result = e.productionManager.setCityProduction('city-1', {
      type: 'building', itemType: 'harbor', name: 'Harbor', cost: 30,
    } as never);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_water_access');
  });
});

// ---------------------------------------------------------------------------
// Coastal cities build a Harbor as soon as they are safe
// ---------------------------------------------------------------------------

function makeCoastalProductionEngine() {
  const city = {
    id: 'city-1', name: 'Port', civilizationId: 1, col: 1, row: 1,
    population: 3, buildings: [], specialists: [], workingTiles: new Set(['1,1']),
    currentProduction: null, autoProduction: true,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine: any = {
    cities: [city],
    units: [{
      id: 'def', type: 'warrior', civilizationId: 1, col: 1, row: 1,
      attack: 1, defense: 2, health: 100, movesRemaining: 1, isDefeated: false,
    }],
    civilizations: [null, {
      id: 1, name: 'Civ', technologies: ['masonry', 'pottery'],
      resources: { gold: 100 }, personality: {}, luxuryRate: 0,
    }],
    economicManager: {
      sustainableUnits: () => 5,
      cityHappiness: () => ({ disorder: false, unhappiness: 0, happiness: 2 }),
    },
    productionManager: {
      cityHasHarborOrCoast: () => true,
      getBuildableBuildingTypes: () => ['harbor', 'granary'],
    },
    getPlayerStorage: () => ({ turnData: {} }),
    squareGrid: { squareDistance: () => 1 },
    roundManager: { getRoundNumber: () => 0 },
    currentYear: -500,
    gameSettings: { difficulty: 'PRINCE' },
    getCityAt: () => null,
    getUnitAt: () => city,
    map: { width: 20, height: 20 },
  };
  return { engine, city, auto: new AutoProduction(engine) };
}

describe('Coastal city builds a Harbor early', () => {
  it('proposes a Harbor for a safe coastal city', () => {
    const { auto, city } = makeCoastalProductionEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (auto as any).determineProductionItem(city, { needsDefense: false, netThreat: 0 }, []);
    expect(item?.type).toBe('building');
    expect(item?.itemType).toBe('harbor');
  });

  it('builds defenders instead while under direct threat', () => {
    const { auto, city } = makeCoastalProductionEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (auto as any).determineProductionItem(city, { needsDefense: true, netThreat: 3 }, []);
    expect(item?.itemType).not.toBe('harbor');
    expect(item?.type).toBe('unit');
  });

  it('never proposes a Harbor in a landlocked city', () => {
    const { auto, city, engine } = makeCoastalProductionEngine();
    engine.productionManager.getBuildableBuildingTypes = () => ['granary'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (auto as any).determineProductionItem(city, { needsDefense: false, netThreat: 0 }, []);
    expect(item?.itemType).not.toBe('harbor');
  });

  it('does not queue a second Harbor once one exists', () => {
    const { auto, city } = makeCoastalProductionEngine();
    city.buildings.push('harbor');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (auto as any).determineProductionItem(city, { needsDefense: false, netThreat: 0 }, []);
    expect(item?.itemType).not.toBe('harbor');
  });
});

// ---------------------------------------------------------------------------
// Economy-aware army cap + scout cap
// ---------------------------------------------------------------------------

function makeProductionEngine(units: number, sustainable: number) {
  const city = {
    id: 'city-1', name: 'Civ City', civilizationId: 1, col: 0, row: 0,
    population: 3, buildings: [], specialists: [], workingTiles: new Set(['0,0']),
    currentProduction: null, autoProduction: true,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine: any = {
    cities: [city],
    units: Array.from({ length: units }, (_, i) => ({
      id: `u${i}`, type: 'warrior', civilizationId: 1, col: 0, row: 0,
      attack: 1, defense: 2, health: 100, movesRemaining: 1, isDefeated: false,
    })),
    civilizations: [null, { id: 1, name: 'Civ', technologies: ['pottery'], resources: { gold: 100 }, personality: {} }],
    economicManager: { sustainableUnits: () => sustainable },
    productionManager: { getBuildableBuildingTypes: () => ['granary'] },
    getPlayerStorage: () => ({ turnData: {} }),
    squareGrid: { squareDistance: () => 1 },
    roundManager: { getRoundNumber: () => 0 },
    currentYear: -500,
    gameSettings: { difficulty: 'PRINCE' },
    getCityAt: () => null,
    getUnitAt: () => null,
    map: { width: 20, height: 20 },
  };
  return { engine, auto: new AutoProduction(engine) };
}

describe('Economy-aware army cap', () => {
  it('reports the cap exhausted when the army exceeds sustainable income', () => {
    const { auto } = makeProductionEngine(5, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((auto as any).isUnitCapExhausted(1)).toBe(true);

    const { auto: rich } = makeProductionEngine(5, 20);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rich as any).isUnitCapExhausted(1)).toBe(false);
  });

  it('enforces an absolute scout cap (3) including queued scouts', () => {
    const { engine, auto } = makeProductionEngine(0, 10);
    const scout = { type: 'unit', itemType: 'scout', name: 'Scout', cost: 15 };
    engine.cities[0].buildQueue = [scout];
    engine.units.push(
      { id: 's1', type: 'scout', civilizationId: 1, col: 1, row: 1, attack: 0.5, defense: 1, health: 100, movesRemaining: 1, isDefeated: false },
      { id: 's2', type: 'scout', civilizationId: 1, col: 2, row: 2, attack: 0.5, defense: 1, health: 100, movesRemaining: 1, isDefeated: false },
    );
    // 2 alive + 1 queued = 3 → no more scouts even though the desired count
    // for a tiny army is 1 and there is "room" by that metric.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((auto as any).needsScout(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retaliation
// ---------------------------------------------------------------------------

describe('Retaliation', () => {
  it('raises aggression when a city was just lost', () => {
    const base = computeAggression({
      personalityAggression: 5, ownArmyStrength: 10, enemyArmyStrength: 10,
      criticalThreats: 0, threatenedCities: 0, knownEnemyCities: 1,
      numOwnCities: 3, numEnemyCities: 1, isAtWar: true, currentYear: 0,
    }, () => 0.99);
    const retaliating = computeAggression({
      personalityAggression: 5, ownArmyStrength: 10, enemyArmyStrength: 10,
      criticalThreats: 0, threatenedCities: 0, knownEnemyCities: 1,
      numOwnCities: 3, numEnemyCities: 1, isAtWar: true, currentYear: 0,
      recentlyLostCity: true,
    }, () => 0.99);
    expect(retaliating.score).toBeGreaterThan(base.score);
    expect(retaliating.reasons.join(' ')).toContain('retaliate');
  });

  it('prefers the capturer as a bulk-attack target', () => {
    const e = makeEngine([[G, G, G], [G, G, G], [G, G, G]]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = e as any;
    engine.cities = [
      { id: 'own', civilizationId: 0, col: 1, row: 1, population: 2, buildings: [] },
      { id: 'civ1city', civilizationId: 1, col: 2, row: 1, population: 2, buildings: [] },
      { id: 'civ2city', civilizationId: 2, col: 2, row: 2, population: 2, buildings: [] },
    ];
    engine.units = [];
    engine.squareGrid = new SquareGrid(3, 3);
    const targets = [
      { col: 2, row: 1, type: 'city' as const, id: 'civ1city', civId: 1 },
      { col: 2, row: 2, type: 'city' as const, id: 'civ2city', civId: 2 },
    ];
    const plan = planBulkAttack(engine, 0, targets, 50, 5, 0, true, 2);
    expect(plan?.target).toEqual({ col: 2, row: 2 });
    expect(plan?.targetCivId).toBe(2);
  });
});

describe('Failed-move memory for all units', () => {
  it('military units also blacklist a tile they could not enter', () => {
    const e = makeEngine([[G, G, G], [G, G, G], [G, G, G]]);
    const warrior = {
      id: 'w1', type: 'warrior', civilizationId: 0, col: 1, row: 1,
      health: 100, movesRemaining: 1, isDefeated: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).units = [warrior];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: [] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e.aiManager as any).blacklistScoutTarget(warrior, 2, 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = (warrior as any)._blockedScoutTargets as Set<string>;
    expect(blocked).toBeDefined();
    expect(blocked.has('2,1')).toBe(true);
  });
});

describe('the unit cap never relies on an optimistic 100% tax projection', () => {
  it('uses the AI sustainable cap when both models exist', () => {
    // The civ can field 5 units sustainably, but a 100%-tax projection claims
    // 20. `Math.max` of the two let the optimistic number win, so the AI built
    // an army it could not pay for and disbanded the surplus (84 built / 84
    // disbanded in one AI-vs-AI run).
    const { auto } = makeProductionEngine(6, 5);
    const engine = (auto as unknown as { gameEngine: Record<string, unknown> }).gameEngine;
    engine.aiEconomicManager = { sustainableUnits: () => 5 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((auto as any).isUnitCapExhausted(1)).toBe(true);

    // Fewer units than the conservative cap → room to build.
    const { auto: smaller } = makeProductionEngine(3, 5);
    const engine2 = (smaller as unknown as { gameEngine: Record<string, unknown> }).gameEngine;
    engine2.aiEconomicManager = { sustainableUnits: () => 5 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((smaller as any).isUnitCapExhausted(1)).toBe(false);
  });
});
