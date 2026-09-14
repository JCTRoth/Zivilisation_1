import { describe, expect, it } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { Unit } from '../../types/game';

/**
 * Regression tests for the Civ1 income strategy "roads on worked tiles":
 * a road on a tile a city WORKS grants +1 trade on grassland/plains/desert
 * (IMPROVEMENT_PROPERTIES.road.tradeBonusTerrains), which raises the city's
 * commerce → more tax + science. The AI settler should (a) build a road when
 * it stands on such a tile and (b) walk to the nearest such tile when idle.
 */

interface MockTile {
  col: number;
  row: number;
  type: string;
  terrain?: string;
  improvement?: string | null;
}

const settler = (id: string, civId: number, col: number, row: number): Unit =>
  ({
    id,
    type: 'settler',
    civilizationId: civId,
    col,
    row,
    attack: 0,
    defense: 1,
    health: 100,
    movesRemaining: 1,
    workTarget: null,
    homeCityId: null,
    isNoneUnit: false,
  }) as unknown as Unit;

const buildManager = (cities: Array<{ id: string; civilizationId: number; col: number; row: number; workingTiles?: Set<string> }>, tiles: MockTile[], canBuild: (type: string) => boolean) => {
  const squareGrid = {
    squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
      Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    getNeighbors: () => [] as { col: number; row: number }[],
    isValidSquare: () => true,
  };
  const engine: any = {
    civilizations: [
      undefined,
      { id: 1, productionProfile: 'balanced_growth', personality: { aggression: 5 } },
    ],
    cities,
    units: [],
    map: { tiles },
    squareGrid,
    gameSettings: { difficulty: 'PRINCE' },
    getTileAt: (col: number, row: number) =>
      tiles.find((t) => t.col === col && t.row === row) ?? { type: 'grassland' },
    getUnitAt: () => null,
    getCityAt: () => null,
    getPlayerStorage: () => ({ enemyLocations: new Map(), turnData: {}, visibility: [], explored: [] }),
    isVisibleToPlayer: () => true,
    isExploredByPlayer: () => true,
    isInScoutZone: () => true,
    assignScoutZones: () => {},
    recordEnemyLocation: () => {},
    canBuildImprovement: (_unitId: string, type: string) => canBuild(type),
    autoProduction: { processAutoProductionForCivilization: () => {} },
    sleep: () => Promise.resolve(),
    onStateChange: () => {},
    log: () => {},
    measurePerformance: (_name: string, fn: () => unknown) => fn(),
    roundManager: { getRoundNumber: () => 10, setUnitPath: () => {} },
  };
  const manager = new AIManager(engine);
  const chooseImprovementForSettler = (
    manager as unknown as { chooseImprovementForSettler(u: Unit): string | null }
  ).chooseImprovementForSettler.bind(manager);
  const findTradeRoadTarget = (
    manager as unknown as { findTradeRoadTarget(u: Unit): { col: number; row: number } | null }
  ).findTradeRoadTarget.bind(manager);
  return { chooseImprovementForSettler, findTradeRoadTarget };
};

describe('AI trade-road strategy (roads on worked tiles boost income)', () => {
  it('builds a road when standing on a worked grassland tile without an improvement', () => {
    const city = { id: 'c1', civilizationId: 1, col: 5, row: 5, workingTiles: new Set(['5,5']) };
    const tiles: MockTile[] = [
      { col: 5, row: 5, type: 'grassland', improvement: null },
    ];
    const { chooseImprovementForSettler } = buildManager([city], tiles, () => true);
    expect(chooseImprovementForSettler(settler('s1', 1, 5, 5))).toBe('road');
  });

  it('does NOT re-build a road on a worked tile that already has one', () => {
    const city = { id: 'c1', civilizationId: 1, col: 5, row: 5, workingTiles: new Set(['5,5']) };
    const tiles: MockTile[] = [
      { col: 5, row: 5, type: 'grassland', improvement: 'road' },
    ];
    const { chooseImprovementForSettler } = buildManager([city], tiles, () => true);
    // The `!tile.improvement` guard blocks the trade-road branch.
    expect(chooseImprovementForSettler(settler('s1', 1, 5, 5))).not.toBe('road');
  });

  it('does not build a road on a worked tile whose terrain gets no trade bonus', () => {
    const city = { id: 'c1', civilizationId: 1, col: 5, row: 5, workingTiles: new Set(['5,5']) };
    const tiles: MockTile[] = [
      { col: 5, row: 5, type: 'forest', improvement: null },
    ];
    const { chooseImprovementForSettler } = buildManager([city], tiles, () => true);
    // Forest is not in road.tradeBonusTerrains → the branch must not fire.
    expect(chooseImprovementForSettler(settler('s1', 1, 5, 5))).not.toBe('road');
  });

  it('routes an idle settler to the nearest worked grassland/plains/desert tile lacking a road', () => {
    const city = {
      id: 'c1', civilizationId: 1, col: 5, row: 5,
      workingTiles: new Set(['6,5', '5,6', '7,7']),
    };
    const tiles: MockTile[] = [
      { col: 6, row: 5, type: 'grassland', improvement: null }, // closest candidate
      { col: 5, row: 6, type: 'plains', improvement: 'mines' }, // already improved → skip
      { col: 7, row: 7, type: 'desert', improvement: null },    // farther candidate
    ];
    const { findTradeRoadTarget } = buildManager([city], tiles, () => true);
    expect(findTradeRoadTarget(settler('s1', 1, 4, 4))).toEqual({ col: 6, row: 5 });
  });

  it('skips worked tiles that already have an improvement or a non-trade terrain', () => {
    const city = {
      id: 'c1', civilizationId: 1, col: 5, row: 5,
      workingTiles: new Set(['6,5', '7,5', '8,5']),
    };
    const tiles: MockTile[] = [
      { col: 6, row: 5, type: 'forest', improvement: null },       // non-trade terrain → skip
      { col: 7, row: 5, type: 'grassland', improvement: 'mines' }, // improved → skip
      { col: 8, row: 5, type: 'plains', improvement: null },       // candidate
    ];
    const { findTradeRoadTarget } = buildManager([city], tiles, () => true);
    expect(findTradeRoadTarget(settler('s1', 1, 0, 0))).toEqual({ col: 8, row: 5 });
  });

  it('returns null when no worked trade tile needs a road', () => {
    const city = {
      id: 'c1', civilizationId: 1, col: 5, row: 5,
      workingTiles: new Set(['6,5']),
    };
    const tiles: MockTile[] = [
      { col: 6, row: 5, type: 'grassland', improvement: 'road' }, // already roaded
    ];
    const { findTradeRoadTarget } = buildManager([city], tiles, () => true);
    expect(findTradeRoadTarget(settler('s1', 1, 4, 4))).toBeNull();
  });
});
