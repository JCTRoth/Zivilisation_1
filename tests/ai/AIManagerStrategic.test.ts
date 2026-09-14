import { describe, it, expect } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { EnemyLocation } from '@/game/engine/EnemySearcher';

const createMockEngine = () => {
  const storage = {
    enemyLocations: new Map<number, EnemyLocation[]>(),
    visibility: [],
    explored: [],
    turnData: {}
  } as any;

  const squareGrid = {
    squareDistance: (c1: number, r1: number, c2: number, r2: number) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    getNeighbors: () => [],
    isValidSquare: () => true,
    findPath: () => [] as { col: number; row: number }[]
  };

  const engine: any = {
    civilizations: [],
    cities: [],
    units: [],
    map: { width: 20, height: 20 },
    squareGrid,
    getTileAt: () => ({ type: 'grassland', movement: 1, passable: true }),
    getUnitAt: () => null,
    getCityAt: () => null,
    getPlayerStorage: () => storage,
    isVisibleToPlayer: () => true,
    assignScoutZones: () => {},
    isInScoutZone: () => true,
    recordEnemyLocation: () => {},
    autoProduction: { processAutoProductionForCivilization: () => {} },
    sleep: () => Promise.resolve(),
    onStateChange: () => {},
    measurePerformance: (_: string, fn: () => any) => fn(),
    roundManager: {
      getRoundNumber: () => 10,
      setUnitPath: () => {}
    }
  };

  return { engine, storage };
};

describe('AIManager strategic targeting', () => {
  it('prioritizes known enemy cities for combat units', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0 }];
    storage.enemyLocations.set(2, [{
      col: 4,
      row: 4,
      type: 'city',
      id: 'enemy-city',
      discoveredRound: 1,
      lastSeenRound: 9
    }]);

    const aiManager = new AIManager(engine as any);
    const unit = { id: 'u1', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 };

    const target = (aiManager as any).chooseAITarget(unit);

    expect(target).toEqual({ col: 4, row: 4 });
  });

  it('directs units to defend threatened cities', () => {
    const { engine } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 6, row: 6 }];
    const enemyUnit = { id: 'enemy', type: 'warrior', civilizationId: 0, col: 7, row: 6, attack: 3, defense: 1 };
    const defender = { id: 'defender', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 };
    engine.units = [enemyUnit, defender];

    const aiManager = new AIManager(engine as any);

    const target = (aiManager as any).chooseAITarget(defender);

    expect(target).toEqual({ col: 7, row: 6 });
  });

  it('prepares offensive plan when army strength is sufficient', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0 }];
    engine.units = [
      { id: 'u1', type: 'archer', civilizationId: 1, col: 0, row: 0, attack: 3, defense: 2, movesRemaining: 1 },
      { id: 'u2', type: 'archer', civilizationId: 1, col: 1, row: 0, attack: 3, defense: 2, movesRemaining: 1 },
      { id: 'u3', type: 'archer', civilizationId: 1, col: 0, row: 1, attack: 3, defense: 2, movesRemaining: 1 }
    ];
    storage.enemyLocations.set(2, [{
      col: 4,
      row: 4,
      type: 'city',
      id: 'enemy-city',
      discoveredRound: 1,
      lastSeenRound: 8
    }]);

    const aiManager = new AIManager(engine as any);
    (aiManager as any).updateOffensivePlan(1, storage, 10);

    expect(storage.turnData.offensivePlan).toBeTruthy();
    expect(storage.turnData.offensivePlan.target).toEqual({ col: 4, row: 4 });
  });

  it('keeps one combat unit near the city while the remaining force attacks as a group', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0 }];
    engine.units = [
      { id: 'guard', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 3 },
      { id: 'u2', type: 'warrior', civilizationId: 1, col: 1, row: 0, attack: 3, defense: 1 },
      { id: 'u3', type: 'warrior', civilizationId: 1, col: 2, row: 0, attack: 3, defense: 1 },
      { id: 'u4', type: 'warrior', civilizationId: 1, col: 3, row: 0, attack: 3, defense: 1 },
    ];
    storage.enemyLocations.set(2, [{
      col: 8,
      row: 8,
      type: 'city',
      id: 'enemy-city',
      discoveredRound: 1,
      lastSeenRound: 9,
    }]);

    const aiManager = new AIManager(engine as any);
    const guardTarget = (aiManager as any).chooseAITarget(engine.units[0]);
    const attackerTarget = (aiManager as any).chooseAITarget(engine.units[1]);

    expect(guardTarget).toEqual({ col: 0, row: 0 });
    expect(attackerTarget).toEqual({ col: 8, row: 8 });
  });

  it('treats occupied units and cities as settler path obstacles', () => {
    const { engine } = createMockEngine();
    engine.units = [
      { id: 'settler', type: 'settler', civilizationId: 1, col: 2, row: 2 },
      { id: 'blocker', type: 'warrior', civilizationId: 1, col: 3, row: 2 },
    ];
    engine.cities = [{ id: 'city', civilizationId: 1, col: 4, row: 2 }];

    const aiManager = new AIManager(engine as any);
    const obstacles = (aiManager as any).getSettlerPathObstacles('settler', { col: 5, row: 2 });

    expect(obstacles).toContain('3,2');
    expect(obstacles).toContain('4,2');
    expect(obstacles).not.toContain('2,2');
    expect(obstacles).not.toContain('5,2');
  });

  it('rejects a cached settlement target occupied by a friendly unit', () => {
    const { engine } = createMockEngine();
    engine.units = [
      { id: 'settler', type: 'settler', civilizationId: 1, col: 2, row: 2 },
      { id: 'friendly-unit', type: 'warrior', civilizationId: 1, col: 4, row: 2 },
    ];
    engine.squareGrid.findPath = () => [{ col: 2, row: 2 }, { col: 4, row: 2 }];
    engine.getUnitAt = (col: number, row: number) => engine.units.find((unit: any) => unit.col === col && unit.row === row) ?? null;

    const aiManager = new AIManager(engine as any);
    const valid = (aiManager as any).isSettlementTargetValid(
      engine.units[0],
      { col: 4, row: 2 },
    );

    expect(valid).toBe(false);
  });
});
