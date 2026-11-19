import { describe, expect, it, afterEach, vi } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@shared/data/VillageConstants';

/**
 * The AI must attack and capture barbarian-held cities exactly like cities of
 * any other enemy civilization.
 *
 * Root causes fixed:
 *  - `GameEngine.recordEnemyLocation` dropped barbarian locations because the
 *    barbarian civ id is -1 and the guard was `enemyCivId < 0` — so the AI
 *    never recorded barbarian cities and could never plan an assault on them.
 *  - `DiplomacyManager` has no relation entries for the on-demand barbarian
 *    faction, so `isAtWar(civ, -1)` returned false and every AI enemy filter
 *    (wide-area scan, threat estimate, bulk-attack gating) skipped barbarian
 *    units and cities entirely.
 */
describe('AI attacks & captures barbarian cities', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function makeEngine() {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    for (const civ of e.civilizations) { civ.isHuman = false; civ.isAI = true; }
    // Deterministic, empty battlefield (no other units/cities to interfere).
    (e as unknown as { units: unknown[] }).units = [];
    (e as unknown as { cities: unknown[] }).cities = [];
    return e;
  }

  /** A passable tile with an adjacent passable tile (both unoccupied). */
  function findLandSpot(e: GameEngine): { col: number; row: number } {
    const w = (e as unknown as { map: { width: number; height: number } }).map.width;
    const h = (e as unknown as { map: { width: number; height: number } }).map.height;
    for (let col = 4; col < w - 4; col++) {
      for (let row = 4; row < h - 4; row++) {
        if (!e.isTilePassable(col, row)) continue;
        if (e.getUnitAt(col, row) || e.getCityAt(col, row)) continue;
        const hasAdj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) =>
          e.isTilePassable(col + dc, row + dr)
          && !e.getUnitAt(col + dc, row + dr)
          && !e.getCityAt(col + dc, row + dr));
        if (hasAdj) return { col, row };
      }
    }
    throw new Error('No land spot found');
  }

  function adjacentSpot(e: GameEngine, col: number, row: number): { col: number; row: number } {
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
      .find((p) => e.isTilePassable(p.col, p.row) && !e.getUnitAt(p.col, p.row) && !e.getCityAt(p.col, p.row));
    if (!adj) throw new Error('No adjacent spot');
    return adj;
  }

  function addUnit(e: GameEngine, id: string, civId: number, col: number, row: number, type = 'archer', attack = 3) {
    const u = {
      id, type, civilizationId: civId, col, row,
      health: 100, movesRemaining: 1, maxMoves: 1,
      attack, defense: 2, icon: type, orders: 'none',
      homeCityId: '', areTurnsDone: false, isSkipped: false,
    } as never;
    (e as unknown as { units: unknown[] }).units.push(u);
    return u as { id: string; col: number; row: number; civilizationId: number };
  }

  function addCity(e: GameEngine, id: string, civId: number, col: number, row: number, pop = 2) {
    const c = {
      id, name: id, civilizationId: civId, col, row,
      population: pop, foodStored: 0, foodNeeded: pop * 20,
      yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
      buildings: [], wonders: [], buildQueue: [],
      currentProduction: null, productionStored: 0, productionProgress: 0,
    } as never;
    (e as unknown as { cities: unknown[] }).cities.push(c);
    return c as { id: string; col: number; row: number; civilizationId: number };
  }

  it('recordEnemyLocation records barbarian cities and feeds bulk-attack planning', async () => {
    const e = await makeEngine();
    engine = e;
    const spot = findLandSpot(e);
    addCity(e, 'barb_city', BARBARIAN_CIV_ID, spot.col, spot.row, 2);

    // The < 0 guard used to drop the barbarian faction (id -1) entirely.
    e.recordEnemyLocation(0, {
      col: spot.col, row: spot.row,
      targetType: 'city', targetId: 'barb_city', distance: 1, priority: 99,
    } as never);

    // Stored under the barbarian civ id…
    const storage = (e as unknown as { getPlayerStorage: (c: number) => { enemyLocations: Map<number, Array<{ id: string; type: string }>> } })
      .getPlayerStorage(0);
    const locs = storage.enemyLocations.get(BARBARIAN_CIV_ID) ?? [];
    expect(locs.some((l) => l.id === 'barb_city' && l.type === 'city')).toBe(true);

    // …and surfaced by collectKnownTargets, the feed for planBulkAttack —
    // so the army can plan a coordinated assault on the barbarian city.
    const aiManager = (e as unknown as { aiManager: unknown }).aiManager;
    const known = (aiManager as { collectKnownTargets: (c: number, s: unknown, r: number) => Array<{ type: string; id: string; col: number; row: number }> })
      .collectKnownTargets(0, storage, 1);
    expect(known.some((t) => t.type === 'city' && t.id === 'barb_city' && t.col === spot.col && t.row === spot.row)).toBe(true);
  });

  it('a combat unit targets an adjacent barbarian city (was filtered out as "not at war")', async () => {
    const e = await makeEngine();
    engine = e;
    const spot = findLandSpot(e);
    addCity(e, 'barb_city', BARBARIAN_CIV_ID, spot.col, spot.row, 2);
    const adj = adjacentSpot(e, spot.col, spot.row);
    const unit = addUnit(e, 'attacker', 0, adj.col, adj.row, 'archer', 3);

    const aiManager = (e as unknown as { aiManager: { chooseAITarget: (u: unknown) => { col: number; row: number } | null } }).aiManager;
    const target = aiManager.chooseAITarget(unit);

    // The wide-area enemy scan must include the barbarian city (distance 1)
    // now that barbarians are "at war", and return it as the unit's target.
    expect(target).toEqual({ col: spot.col, row: spot.row });
  });

  it('moveUnit captures an undefended barbarian city like any other enemy city', async () => {
    const e = await makeEngine();
    engine = e;
    const spot = findLandSpot(e);
    const city = addCity(e, 'barb_city', BARBARIAN_CIV_ID, spot.col, spot.row, 2);
    const adj = adjacentSpot(e, spot.col, spot.row);
    addUnit(e, 'attacker', 0, adj.col, adj.row, 'legion', 4);

    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValue(0.05); // attacker wins
    try {
      const result = (e as unknown as { moveUnit: (id: string, c: number, r: number) => { success: boolean; reason: string } })
        .moveUnit('attacker', spot.col, spot.row);
      expect(result.success).toBe(true);
      expect(result.reason).toBe('city_captured');
      const captured = (e as unknown as { cities: Array<{ id: string; civilizationId: number }> })
        .cities.find((c) => c.id === city.id);
      expect(captured?.civilizationId).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
