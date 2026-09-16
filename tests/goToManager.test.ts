import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Regression tests for GoTo pathing:
 *  - Task 1: attack pathing must not give up because a FRIENDLY unit sits on
 *    the direct line — it routes around it (the hover preview now uses the same
 *    obstacle-aware pathfinding, so it stops drawing an impossible line through
 *    the friendly unit).
 *  - Task 3: moving units over an enemy city ATTACKS it. The old block in
 *    `GoToManager.executeFirstStep` cleared the path with
 *    `enemy_city_blocks_path` — a unit must instead resolve combat on the city
 *    tile.
 */
describe('GoToManager pathing', () => {
  let engine: GameEngine;
  let emitted: string[];
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, _data?: any) => { emitted.push(type); };
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
    (engine as any).units = [];
    (engine as any).cities = [];
  });

  const addUnit = (id: string, civId: number, pos: { col: number; row: number }, type = 'warrior', attack = 2) => {
    const unit: any = {
      id,
      civilizationId: civId,
      type,
      col: pos.col,
      row: pos.row,
      movesRemaining: 1,
      maxMoves: 1,
      health: 100,
      attack,
      defense: 1,
      icon: type,
      orders: 'none',
      areTurnsDone: false,
      isSkipped: false,
    };
    (engine as any).units.push(unit);
    return unit;
  };

  /** A 5×5 all-grassland lookup (grassland = cost 1, finite). */
  const grass = (_c: number, _r: number) => ({
    type: 'grassland',
    terrain: 'grassland',
    visible: true,
    explored: true,
    col: _c,
    row: _r,
  });

  it('routes an attack around a friendly unit on the direct line (task 1)', () => {
    const attacker = addUnit('att', 0, { col: 2, row: 2 }, 'warrior', 2);
    addUnit('friend', 0, { col: 3, row: 2 }, 'warrior', 2);
    addUnit('enemy', 1, { col: 4, row: 2 }, 'warrior', 2);

    // The straight line A→E crosses the friendly unit at (3,2).
    const res = engine.goToManager.calculatePath(
      attacker, 4, 2, grass, 5, 5,
    );

    expect(res.success).toBe(true);
    expect(res.path.length).toBeGreaterThan(0);
    // Never steps onto the friendly unit's tile.
    expect(res.path.some((s) => s.col === 3 && s.row === 2)).toBe(false);
    // And it reaches the enemy target (the final step is the attack).
    expect(res.path[res.path.length - 1]).toEqual({ col: 4, row: 2 });
  });

  it('executeFirstStep attacks an enemy city on the path instead of clearing it (task 3)', () => {
    // Directly construct the case the old code blocked: an enemy city as an
    // intermediate path step (path.length > 1). The unit must resolve combat,
    // not return `enemy_city_blocks_path`.
    const civ1 = engine.civilizations[1];
    const isLand = (col: number, row: number): boolean => {
      const tile = (engine as any).getTileAt?.(col, row);
      if (!tile) return false;
      const type = String(tile.type ?? '').toLowerCase();
      return type !== 'ocean' && type !== 'water';
    };
    let spot: { col: number; row: number } | null = null;
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    for (let row = 2; row < height - 2 && !spot; row++) {
      for (let col = 2; col < width - 2 && !spot; col++) {
        if (!isLand(col, row)) continue;
        if (engine.cities.some((c: any) => Math.abs(c.col - col) + Math.abs(c.row - row) < 4)) continue;
        // Attacker stands one tile to the east.
        if (!isLand(col + 1, row)) continue;
        spot = { col, row };
      }
    }
    if (!spot) throw new Error('No free spot found');
    const city: any = {
      id: 'enemy_city_goto',
      name: 'Enemy City',
      civilizationId: civ1.id,
      col: spot.col,
      row: spot.row,
      population: 1,
      foodStored: 0,
      foodNeeded: 20,
      yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
      buildings: [],
      wonders: [],
      isCapital: false,
      buildQueue: [],
      currentProduction: null,
      productionStored: 0,
      productionProgress: 0,
    };
    (engine as any).cities.push(city);

    const attacker = addUnit('att', 0, { col: spot.col + 1, row: spot.row }, 'warrior', 2);
    randomSpy.mockReturnValue(0.05); // attacker wins

    // Path with the enemy city as an intermediate step (more steps remain).
    engine.goToManager.setUnitPath(attacker.id, [
      { col: city.col, row: city.row },
      { col: city.col - 1, row: city.row },
    ]);

    const res = engine.goToManager.executeFirstStep(attacker.id);

    expect(res.reason ?? 'ok').not.toBe('enemy_city_blocks_path');
    // The unit actually moved onto the city and combat resolved.
    expect(res.success).toBe(true);
    expect(emitted).toContain('CITY_CAPTURED');
  });
});