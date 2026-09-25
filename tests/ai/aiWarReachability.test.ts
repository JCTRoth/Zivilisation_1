/**
 * The AI must not start a war it cannot prosecute.
 *
 * An AI-vs-AI run (465 rounds) produced 17 declarations and only 3 attacks:
 * the Huns declared war on Russia from the other side of an ocean, mobilised
 * nothing, and the war sat there burning their treasury on upkeep for the rest
 * of the game. Army groups were already land-only (`engineTileReachableByLand`)
 * — the declaration itself was not gated.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

/** Left landmass (civ 0) and right landmass (civ 1), ocean down the middle. */
const TWO_LANKMASSES = [
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
];

function makeTwoLandmassEngine(): GameEngine {
  const width = TWO_LANKMASSES[0].length;
  const height = TWO_LANKMASSES.length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: TWO_LANKMASSES.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: type === O ? 99 : 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Islanders', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
    { id: 1, name: 'Mainlanders', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
  ];
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number) {
  const city = {
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
  };
  engine.cities.push(city as never);
  return city;
}

const aiManagerOf = (engine: GameEngine) =>
  (engine as unknown as { aiManager: Record<string, (...args: never[]) => unknown> }).aiManager;

describe('AI war declaration requires a reachable target', () => {
  it('sees no reachable enemy from another landmass', () => {
    const engine = makeTwoLandmassEngine();
    addCity(engine, 'Islandport', 1, 2, 0);
    addCity(engine, 'Mainport', 7, 2, 1);

    const ai = aiManagerOf(engine);
    const reachable = (ai.hasReachableEnemyTarget as (c: number, u: Unit, only?: number) => boolean)
      .bind(ai);

    expect(engine.areLandConnected(1, 2, 7, 2)).toBe(false);
    // No declaration target on the far continent…
    expect(reachable(0, { col: 1, row: 2 } as Unit, 1)).toBe(false);
    // …but the far civ is still a valid target once it is on the same land.
    expect(engine.areLandConnected(1, 2, 2, 2)).toBe(true);
    expect(reachable(0, { col: 1, row: 2 } as Unit, 0)).toBe(true);
  });

  it('finds a reachable enemy city on the same landmass', () => {
    const engine = makeTwoLandmassEngine();
    addCity(engine, 'Home', 1, 2, 0);
    addCity(engine, 'Neighbour', 2, 2, 1);

    const ai = aiManagerOf(engine);
    const reachable = (ai.hasReachableEnemyTarget as (c: number, u: Unit, only?: number) => boolean)
      .bind(ai);

    expect(engine.areLandConnected(1, 2, 2, 2)).toBe(true);
    expect(reachable(0, { col: 1, row: 2 } as Unit, 1)).toBe(true);
  });

  it('civCentroid points at the middle of a civ own cities', () => {
    const engine = makeTwoLandmassEngine();
    addCity(engine, 'A', 0, 0, 0);
    addCity(engine, 'B', 2, 4, 0);

    const ai = aiManagerOf(engine);
    const centroid = (ai.civCentroid as (c: number) => { col: number; row: number }).bind(ai);
    expect(centroid(0)).toEqual({ col: 1, row: 2 });
  });
});
