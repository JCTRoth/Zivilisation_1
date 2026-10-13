/**
 * The public-works corps — sized from the ground, not from an empty queue.
 *
 * The bug this suite pins: `SettlerGovernor.getRecommendedSettlerCount` sized the
 * works corps from its own improvement queue, which nothing ever fills — so the
 * corps was permanently zero, no settler was ever sent to improve a tile, and a
 * played game built 2 roaded tiles in 150 rounds while every city's commerce sat
 * on the centre floor. The count now comes from `AIManager.countOutstandingWorks`.
 */
import { describe, it, expect } from 'vitest';
import { SettlerGovernor } from '@/game/engine/AI/SettlerGovernor';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Unit } from '../../types/game';

const city = (over: Partial<City> = {}): City => ({
  id: 'c1', name: 'Town', civilizationId: 0, col: 5, row: 5, population: 6,
  buildings: [], specialists: [], workingTiles: new Set<string>(),
  tradeRoutes: [], yields: { food: 6, production: 3, trade: 2 },
  ...over,
} as unknown as City);

const settler = (id: string, over: Partial<Unit> = {}): Unit => ({
  id, type: 'settler', civilizationId: 0, col: 5, row: 6,
  ...over,
} as unknown as Unit);

describe('SettlerGovernor works corps', () => {
  it('asks the injected source for outstanding work rather than its own queue', () => {
    const gov = new SettlerGovernor();
    let asked: number | null = null;
    gov.setOutstandingWorksSource((civId) => { asked = civId; return 12; });

    const rec = gov.getRecommendedSettlerCount([city()], [settler('s1')]);

    expect(asked).toBe(0);            // it asked, with the right civ
    expect(rec).toBeGreaterThan(0);   // 12 tiles of work want settlers
    expect(rec).toBeLessThanOrEqual(3); // …capped by MAX_WORKS_CORPS
  });

  it('caps the corps however much work there is', () => {
    const gov = new SettlerGovernor();
    gov.setOutstandingWorksSource(() => 100);
    // 3 settlers alive already: nothing more to recommend.
    const rec = gov.getRecommendedSettlerCount(
      [city()], [settler('s1'), settler('s2'), settler('s3')],
    );
    expect(rec).toBe(0);
  });

  it('falls back to its own queue when no source is injected', () => {
    const gov = new SettlerGovernor();
    gov.queueImprovement({ col: 6, row: 6, improvementType: 'road', priority: 1 });
    const rec = gov.getRecommendedSettlerCount([city()], []);
    expect(rec).toBeGreaterThan(0);
  });

  it('recommends nothing when there is no work at all', () => {
    const gov = new SettlerGovernor();
    gov.setOutstandingWorksSource(() => 0);
    // Five cities, so no expansion need either.
    const cities = [city(), city({ id: 'c2' }), city({ id: 'c3' }),
      city({ id: 'c4' }), city({ id: 'c5' })];
    const rec = gov.getRecommendedSettlerCount(cities, []);
    expect(rec).toBe(0);
  });
});

describe('AIManager.countOutstandingWorks', () => {
  /** A 9x9 all-grass map with a real Grid and a real AIManager. */
  function makeManager() {
    const width = 9;
    const height = 9;
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    Object.assign(e, {
      units: [],
      cities: [],
      civilizations: [{ id: 0, isAI: true, technologies: [], resources: { gold: 0 } }],
      activePlayer: 0,
      map: {
        width,
        height,
        tiles: Array.from({ length: width * height }, (_, i) => ({
          col: i % width,
          row: Math.floor(i / width),
          type: 'grassland',
          terrain: 'grassland',
          resource: null,
          improvement: null,
          visible: true,
          explored: true,
        })),
      },
    });
    (e as unknown as { squareGrid: unknown }).squareGrid = new SquareGrid(width, height);
    (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(0);
    const ai = (e as unknown as { aiManager: { countOutstandingWorks: (id: number) => number } }).aiManager;
    const tiles = (e as unknown as { map: { tiles: Array<{ improvement?: string | null }> } }).map.tiles;
    return { ai, cities: (e as unknown as { cities: City[] }).cities, tiles };
  }

  it('counts the unimproved workable tiles inside a city radius', () => {
    const { ai, cities } = makeManager();
    cities.push(city({ col: 4, row: 4 }));
    const count = ai.countOutstandingWorks(0);
    // `cityAreaTiles` is the 5x5 box minus the centre minus the four far
    // corners = 20 tiles, and grass is roadable, irrigable AND minable.
    expect(count).toBe(20);
  });

  it('counts a tile once even when two cities share it', () => {
    const { ai, cities } = makeManager();
    cities.push(city({ id: 'a', col: 4, row: 4 }));
    cities.push(city({ id: 'b', col: 4, row: 6 }));
    const twoCities = ai.countOutstandingWorks(0);
    cities.length = 1;
    const oneCity = ai.countOutstandingWorks(0);
    expect(twoCities).toBeGreaterThan(oneCity);
    expect(twoCities).toBeLessThan(oneCity * 2);
  });

  it('ignores tiles that already carry an improvement', () => {
    const { ai, cities, tiles } = makeManager();
    cities.push(city({ col: 4, row: 4 }));
    const before = ai.countOutstandingWorks(0);
    for (const t of tiles) t.improvement = 'road';
    expect(ai.countOutstandingWorks(0)).toBe(0);
    expect(before).toBeGreaterThan(0);
  });

  it('ignores other civilizations', () => {
    const { ai, cities } = makeManager();
    cities.push(city({ col: 4, row: 4, civilizationId: 1 }));
    expect(ai.countOutstandingWorks(0)).toBe(0);
  });
});
