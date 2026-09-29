/**
 * Regression tests for the invasion-planning hot paths:
 *
 *  - `buildDefenceGrid` must be a drop-in replacement for per-tile `defenceOf`
 *    scans (`findInvasionBeach` used to be O(beaches × units)); and
 *  - `buildSeaInvasionContext` / `isSeaInvasionTarget` must classify remembered
 *    enemy positions exactly like the old per-location checks did, while only
 *    computing the civ-wide preconditions once per planning pass.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

/** Left landmass (civ 0) and right landmass (civ 1), ocean down the middle. */
const TWO_LANDMASSES = [
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
];

function makeEngine() {
  const height = TWO_LANDMASSES.length;
  const width = TWO_LANDMASSES[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: TWO_LANDMASSES.flat().map((type, i) => ({
      id: `${i % width},${Math.floor(i / width)}`,
      col: i % width,
      row: Math.floor(i / width),
      type,
      terrain: type,
      movement: type === O ? 99 : 1,
      defense: 1,
      resource: null,
      visible: true,
      explored: true,
    })),
  };
  e.civilizations = [
    { id: 0, name: 'Islanders', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 100 } },
    { id: 1, name: 'Mainlanders', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
  ];
  e.diplomacyManager = {
    getEnemies: () => [],
    isAtWar: () => false,
    declareWar: () => {},
  };
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number) {
  engine.cities.push({
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: 3,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
  } as never);
}

function addUnit(
  engine: GameEngine,
  opts: Partial<Unit> & { id: string; col: number; row: number },
) {
  engine.units.push({
    civilizationId: 0,
    health: 100,
    movesRemaining: 1,
    isDefeated: false,
    attack: 1,
    defense: 1,
    hitPoints: 2,
    maxHitPoints: 2,
    movement: 1,
    maxMoves: 1,
    ...opts,
  } as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const managerOf = (engine: GameEngine) => (engine as any).aiManager as {
  defenceOf(anchor: { col: number; row: number }, radius: number): number;
  buildDefenceGrid(radius: number): number[][];
  defenceAt(grid: number[][], anchor: { col: number; row: number }): number;
  collectKnownTargets(civilizationId: number, storage: unknown, roundNumber: number): Array<{
    col: number;
    row: number;
    type: 'city' | 'unit';
    reachableBy?: 'land' | 'sea';
  }>;
};

describe('defence grid', () => {
  function engineWithUnits(): GameEngine {
    const engine = makeEngine();
    addUnit(engine, { id: 'u1', col: 2, row: 2, attack: 2, defense: 1 });
    addUnit(engine, { id: 'u2', col: 6, row: 2, attack: 1, defense: 4, civilizationId: 1 });
    // Corner/edge units exercise the clamped neighbourhood.
    addUnit(engine, { id: 'u3', col: 0, row: 0, attack: 3, defense: 2 });
    addUnit(engine, { id: 'u4', col: 8, row: 4, attack: 0, defense: 0, type: 'ferry' });
    // A defeated unit must never contribute (matches defenceOf).
    addUnit(engine, { id: 'u5', col: 4, row: 4, attack: 9, defense: 9, isDefeated: true });
    return engine;
  }

  it('matches defenceOf at every tile for radius 1 and 2', () => {
    const engine = engineWithUnits();
    const manager = managerOf(engine);
    for (const radius of [1, 2]) {
      const grid = manager.buildDefenceGrid(radius);
      for (let row = 0; row < engine.map.height; row++) {
        for (let col = 0; col < engine.map.width; col++) {
          expect(
            manager.defenceAt(grid, { col, row }),
            `radius ${radius} at (${col},${row})`,
          ).toBe(manager.defenceOf({ col, row }, radius));
        }
      }
    }
  });

  it('is all zeros without units', () => {
    const engine = makeEngine();
    const manager = managerOf(engine);
    const grid = manager.buildDefenceGrid(1);
    for (const rowValues of grid) {
      expect(rowValues.every((value) => value === 0)).toBe(true);
    }
  });
});

describe('sea invasion context', () => {
  function landingEngine(canSail: boolean): GameEngine {
    const engine = makeEngine();
    if (!canSail) engine.civilizations[0].technologies = [];
    addCity(engine, 'Islandport', 2, 2, 0);
    addCity(engine, 'Mainport', 6, 2, 1);
    return engine;
  }

  const seaLocation = { col: 6, row: 2, type: 'city' as const, id: 'c1', discoveredRound: 1, lastSeenRound: 1 };
  const landLocation = { col: 2, row: 3, type: 'unit' as const, id: 'u1', discoveredRound: 1, lastSeenRound: 1 };

  it('marks a remembered city across the water as sea-reachable', () => {
    const engine = landingEngine(true);
    const storage = engine.getPlayerStorage(0)!;
    storage.enemyLocations.set(1, [seaLocation, landLocation] as never);

    const targets = managerOf(engine).collectKnownTargets(0, storage, 1);
    const seaTarget = targets.find((t) => t.col === 6 && t.row === 2);
    const landTarget = targets.find((t) => t.col === 2 && t.row === 3);
    expect(seaTarget?.reachableBy).toBe('sea');
    expect(landTarget?.reachableBy).toBe('land');
  });

  it('drops the cross-water target when the civ cannot sail', () => {
    const engine = landingEngine(false);
    const storage = engine.getPlayerStorage(0)!;
    storage.enemyLocations.set(1, [seaLocation, landLocation] as never);

    const targets = managerOf(engine).collectKnownTargets(0, storage, 1);
    // The land target still feeds the war plan; the island city does not.
    expect(targets.map((t) => t.type)).toEqual(['unit']);
    expect(targets[0].reachableBy).toBe('land');
  });
});
