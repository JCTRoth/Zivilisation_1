/**
 * How far fresh water reaches, and who decides which tiles a city works.
 *
 * Two rules the AI had to stop guessing at:
 *
 *  - Irrigation used to require water touching the tile, which left cities
 *    short of farmland whenever the river ran past the edge of their land. A
 *    canal can now be dug out to it, and the engine is the authority on how far.
 *  - The governor re-picked who works what, but `cityWorkedTiles` rebuilt the
 *    layout from raw total yield on every population change, so the mode was
 *    silently reverted. The governor's weights are now the ranking the engine
 *    uses, which is what makes a Commerce city stay a Commerce city.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';
import type { City } from '../types/game';
import { makeGridEngine } from './helpers/world';

const G = 'grassland';
const RIVER = 'river';
const LAKE = 'lake';
const OCEAN = 'ocean';

/** A 9×9 plain map with a river column at `riverCol`. */
function mapWithRiver(riverCol: number): GameEngine {
  const rows: string[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: string[] = [];
    for (let c = 0; c < 9; c++) row.push(c === riverCol ? RIVER : G);
    rows.push(row);
  }
  return makeGridEngine(rows);
}

describe('irrigation water reach', () => {
  it('irrigates a tile next to the river, as it always did', () => {
    const engine = mapWithRiver(2);
    expect(engine.canSupplyIrrigation(3, 4)).toBe(true);
  });

  it('reaches five fields out, which is what the canal is for', () => {
    const engine = mapWithRiver(0);
    // (5,4) is 5 orthogonal steps from the river at (0,4).
    expect(engine.canSupplyIrrigation(5, 4)).toBe(true);
  });

  it('stops at six, so the reach is a real limit and not "somewhere"', () => {
    const engine = mapWithRiver(0);
    expect(engine.canSupplyIrrigation(6, 4)).toBe(false);
  });

  it('counts a lake as fresh water', () => {
    const engine = makeGridEngine([
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [LAKE, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
    ]);
    expect(engine.canSupplyIrrigation(5, 4)).toBe(true);
    expect(engine.canSupplyIrrigation(6, 4)).toBe(false);
  });

  it('does not treat the ocean as fresh water', () => {
    const engine = makeGridEngine([
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [OCEAN, OCEAN, OCEAN, OCEAN, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G, G],
    ]);
    expect(engine.canSupplyIrrigation(5, 4)).toBe(false);
  });

  it('lets a canal be extended from an already-irrigated tile', () => {
    const engine = mapWithRiver(0);
    engine.getTileAt(5, 4)!.improvement = IMPROVEMENT_TYPES.IRRIGATION;
    // The tile beyond it has no water of its own, but its neighbour does.
    expect(engine.canSupplyIrrigation(6, 4)).toBe(true);
  });
});

describe('governor weights decide who works what', () => {
  /**
   * A pop-3 city on a 7×7 desert, with the interesting tiles placed by hand:
   *
   *   centre (3,3) grassland 2/1/0     — worked free
   *   (3,2),(2,3) irrigated   3/1/0     — the food the city cannot do without
   *   (3,4) river             2/0/1     — the best tile for trade
   *   (2,2) forest            1/2/0     — the best tile for shields
   *
   * Four slots, three of them already spoken for by the food floor, so the last
   * one is decided purely by the ranking. River and forest tie on total yield,
   * so a total-yield ranking cannot separate them — only weights can.
   */
  function cityWorld() {
    const rows: string[][] = [];
    for (let r = 0; r < 7; r++) rows.push(Array<string>(7).fill('desert'));
    const engine = makeGridEngine(rows);

    const place = (col: number, row: number, terrain: string, improvement?: string) => {
      const tile = engine.getTileAt(col, row)!;
      tile.terrain = terrain;
      tile.type = terrain;
      if (improvement) tile.improvement = improvement;
    };
    place(3, 3, 'grassland');
    place(3, 2, 'grassland', IMPROVEMENT_TYPES.IRRIGATION);
    place(2, 3, 'grassland', IMPROVEMENT_TYPES.IRRIGATION);
    place(3, 4, 'river');
    place(2, 2, 'forest');

    const city = {
      id: 'c1',
      name: 'Test',
      civilizationId: 0,
      col: 3,
      row: 3,
      population: 3,
      specialists: [],
      workingTiles: new Set<string>(['3,3']),
      yields: { food: 0, production: 0, trade: 0 },
      buildings: [],
    } as unknown as City;
    engine.cities = [city];
    return { engine, city };
  }

  it('hands the last slot to the tile the governor prefers for trade', () => {
    const { engine, city } = cityWorld();
    city.governorWeights = { food: 0, production: 1, trade: 3 };
    engine.economicManager.recomputeCityYields(city);
    expect([...(city.workingTiles ?? [])].sort()).toEqual(['2,3', '3,2', '3,3', '3,4']);
  });

  it('hands the same slot to the tile a production governor prefers', () => {
    const { engine, city } = cityWorld();
    city.governorWeights = { food: 0, production: 3, trade: 1 };
    engine.economicManager.recomputeCityYields(city);
    expect([...(city.workingTiles ?? [])].sort()).toEqual(['2,2', '2,3', '3,2', '3,3']);
  });

  it('feeds the city before either mode gets its pick', () => {
    const { engine, city } = cityWorld();
    city.governorWeights = { food: 0, production: 3, trade: 1 };
    engine.economicManager.recomputeCityYields(city);
    // Six citizens' worth of eating is secured from the irrigated tiles whatever
    // the governor wants: a Shields mode cannot starve a city.
    expect(city.yields?.food ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('falls back to total yield when no governor has spoken', () => {
    const { engine, city } = cityWorld();
    delete city.governorWeights;
    engine.economicManager.recomputeCityYields(city);
    expect(city.workingTiles?.size).toBe(4);
  });
});
