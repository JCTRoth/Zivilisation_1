import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * City capture & destruction mechanics (Civ I–style).
 *
 * When a military unit moves onto an enemy city tile (`moveUnit`), the engine
 * resolves city combat:
 *  - win vs pop>1  → city changes hands (captured), attacker consumed
 *  - win vs pop==1 → city is destroyed, attacker consumed
 *  - loss          → attacker takes damage / is defeated
 * City walls TRIPLE the city's defense (air units and siege artillery ignore
 * them), are always destroyed on capture, and become obsolete with Metallurgy.
 * Capturing a city destroys improvements, plunders gold, wipes out the
 * garrison, resets production, and leaves resentful citizens (unrest).
 * Civilian units (settler/worker/caravan/diplomat/scout) cannot attack cities.
 */
describe('City capture & destruction', () => {
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
    (engine as any).civilizations = [];
  });

  let cityCounter = 0;

  const isLand = (col: number, row: number): boolean => {
    const tile = (engine as any).getTileAt?.(col, row);
    if (!tile) return false;
    const type = String(tile.type ?? '').toLowerCase();
    return type !== 'ocean' && type !== 'water';
  };

  /** Find a land tile adjacent to the given city (no unit on it). */
  const adjacentLand = (city: any): { col: number; row: number } => {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const col = city.col + dc;
      const row = city.row + dr;
      if (isLand(col, row) && !(engine as any).getUnitAt(col, row)) {
        return { col, row };
      }
    }
    throw new Error('No adjacent land tile for city');
  };

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

  /** Make an enemy city of civ 1 (returns the created city). */
  const makeEnemyCity = (population: number, opts: { walls?: boolean; isCapital?: boolean; buildings?: string[] } = {}): any => {
    const civ1 = engine.civilizations[1];
    // Reuse a tile far from all existing cities. Cities are placed on
    // movement-1 terrain (Civ1) so a 1-move attacker can reach them.
    const CHEAP_TERRAIN = new Set(['grassland', 'plains', 'desert', 'tundra', 'river']);
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    let spot: { col: number; row: number } | null = null;
    // A wide river city would be unreachable for a 1-move settler (`cannot_move`
    // instead of the civilian rule under test), and an occupied tile would turn
    // the scripted move into combat. Skip both so the scenario is deterministic.
    const isWideRiver = (col: number, row: number): boolean => {
      const tile = (engine as any).getTileAt?.(col, row);
      if (String(tile?.type ?? '').toLowerCase() !== 'river') return false;
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const n = (engine as any).getTileAt?.(col + dc, row + dr);
        return String(n?.type ?? '').toLowerCase() === 'river';
      });
    };
    for (let row = 2; row < height - 2 && !spot; row++) {
      for (let col = 2; col < width - 2; col++) {
        if (!isLand(col, row)) continue;
        const tile = (engine as any).getTileAt?.(col, row);
        if (!tile || !CHEAP_TERRAIN.has(String(tile.type ?? '').toLowerCase())) continue;
        if (isWideRiver(col, row)) continue;
        if (engine.cities.some((c: any) => Math.abs(c.col - col) + Math.abs(c.row - row) < 4)) continue;
        if (engine.units.some((u: any) => Math.max(Math.abs(u.col - col), Math.abs(u.row - row)) <= 1)) continue;
        spot = { col, row };
        break;
      }
    }
    if (!spot) throw new Error('No free spot for enemy city');
    const city: any = {
      id: `enemy_city_${Date.now()}_${cityCounter++}`,
      name: 'Enemy City',
      civilizationId: civ1.id,
      col: spot.col,
      row: spot.row,
      population,
      foodStored: 0,
      foodNeeded: population * 20,
      yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
      buildings: opts.buildings ?? (opts.walls ? ['city_walls'] : []),
      wonders: [],
      isCapital: opts.isCapital === true,
      buildQueue: [],
      currentProduction: null,
      productionStored: 0,
      productionProgress: 0,
    };
    (engine as any).cities.push(city);
    return city;
  };

  it('captures a size-2 enemy city and consumes the attacker', () => {
    const city = makeEnemyCity(2);
    const pos = adjacentLand(city);
    addUnit('atk1', 0, pos);

    randomSpy.mockReturnValue(0.05); // attacker wins

    const result = (engine as any).moveUnit('atk1', city.col, city.row);

    expect(result.success).toBe(true);
    expect(result.reason).toBe('city_captured');
    // City changed hands.
    expect(engine.cities.find((c: any) => c.id === city.id)?.civilizationId).toBe(0);
    // Population dropped by one.
    expect(engine.cities.find((c: any) => c.id === city.id)?.population).toBe(1);
    // Attacker survives but is spent for this turn.
    expect(engine.units.some((u: any) => u.id === 'atk1')).toBe(true);
    const attacker = engine.units.find((u: any) => u.id === 'atk1');
    expect(attacker.movesRemaining).toBe(0);
    expect(emitted).toContain('CITY_CAPTURED');
  });

  it('destroys a size-1 enemy city', () => {
    const city = makeEnemyCity(1);
    const pos = adjacentLand(city);
    addUnit('atk2', 0, pos);

    randomSpy.mockReturnValue(0.05); // attacker wins

    const result = (engine as any).moveUnit('atk2', city.col, city.row);

    expect(result.success).toBe(true);
    expect(engine.cities.some((c: any) => c.id === city.id)).toBe(false);
    expect(emitted).toContain('CITY_DESTROYED');
  });

  it('destroys a size-1 capital and re-establishes government', () => {
    const city = makeEnemyCity(1, { isCapital: true });
    const pos = adjacentLand(city);
    addUnit('atk3', 0, pos);

    randomSpy.mockReturnValue(0.05);

    (engine as any).moveUnit('atk3', city.col, city.row);

    expect(engine.cities.some((c: any) => c.id === city.id)).toBe(false);
    // GovernmentManager should have ensured a replacement capital for civ 1.
    const civ1 = engine.civilizations[1];
    expect(civ1.capital || (civ1 as any).hasCapital).toBeDefined();
  });

  it('civilian units cannot attack or capture a city', () => {
    const city = makeEnemyCity(2);
    const pos = adjacentLand(city);
    addUnit('stl1', 0, pos, 'settler', 0);

    randomSpy.mockReturnValue(0.05);

    const result = (engine as any).moveUnit('stl1', city.col, city.row);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('civilian_cannot_attack_city');
    expect(engine.cities.find((c: any) => c.id === city.id)?.civilizationId).toBe(1);
  });

  it('a weak attacker loses and the city keeps its owner', () => {
    const city = makeEnemyCity(3);
    const pos = adjacentLand(city);
    addUnit('weak1', 0, pos, 'warrior', 1);

    randomSpy.mockReturnValue(0.99); // attacker loses

    const result = (engine as any).moveUnit('weak1', city.col, city.row);

    expect(result.success).toBe(false);
    expect(engine.cities.find((c: any) => c.id === city.id)?.civilizationId).toBe(1);
    // Attacker took damage.
    const attacker = engine.units.find((u: any) => u.id === 'weak1');
    expect(attacker).toBeDefined();
    expect(attacker.health).toBeLessThan(100);
  });

  it('city walls make capture harder (defense tripled)', () => {
    const walled = makeEnemyCity(2, { walls: true });
    const open = makeEnemyCity(2);
    const walledPos = adjacentLand(walled);
    const openPos = adjacentLand(open);

    // Same attacker vs open city: wins at 0.5 threshold region.
    // Walled: defense 6 vs attack 2 → attacker wins only if random < 2/8 = 0.25.
    // Open:   defense 2 vs attack 2 → attacker wins only if random < 2/4 = 0.5.
    // At random = 0.4 the open city is captured, the walled one is not.
    addUnit('wA', 0, walledPos);
    addUnit('oA', 0, openPos);

    randomSpy.mockReturnValue(0.4);

    const rw = (engine as any).moveUnit('wA', walled.col, walled.row);
    const ro = (engine as any).moveUnit('oA', open.col, open.row);
    void rw; void ro;

    expect(engine.cities.find((c: any) => c.id === open.id)?.civilizationId).toBe(0);
    expect(engine.cities.find((c: any) => c.id === walled.id)?.civilizationId).toBe(1);
  });

  it('air units ignore city walls entirely', () => {
    const walled = makeEnemyCity(2, { walls: true });
    const pos = adjacentLand(walled);
    // Bomber (attack 12) vs a walled size-2 city. Walls are ignored, so the
    // defense is 2 (not 6): attacker wins whenever random < 12/14 ≈ 0.857.
    addUnit('bomber1', 0, pos, 'bomber', 12);

    randomSpy.mockReturnValue(0.5);

    const result = (engine as any).moveUnit('bomber1', walled.col, walled.row);

    expect(result.success).toBe(true);
    expect(engine.cities.find((c: any) => c.id === walled.id)?.civilizationId).toBe(0);
  });

  it('capture destroys city walls plus one random building', () => {
    const city = makeEnemyCity(3, { buildings: ['city_walls', 'temple', 'granary'] });
    const pos = adjacentLand(city);
    addUnit('atkA', 0, pos);

    randomSpy.mockReturnValue(0.05); // attacker wins; building pick → index 0

    (engine as any).moveUnit('atkA', city.col, city.row);

    const captured = engine.cities.find((c: any) => c.id === city.id);
    expect(captured?.civilizationId).toBe(0);
    // Walls always destroyed + one random building (temple at random 0.05).
    expect(captured.buildings).not.toContain('city_walls');
    expect(captured.buildings).not.toContain('temple');
    expect(captured.buildings).toContain('granary');
  });

  it('capture plunders gold from the defender treasury', () => {
    const city = makeEnemyCity(2);
    const pos = adjacentLand(city);
    addUnit('atkB', 0, pos);

    engine.civilizations[1].resources.gold = 500;
    randomSpy.mockReturnValue(0.05);

    (engine as any).moveUnit('atkB', city.col, city.row);

    // 20% of 500 = 100 (capped at 100) transferred to the capturer (civ 0
    // started with 100).
    expect(engine.civilizations[0].resources.gold).toBe(200);
    expect(engine.civilizations[1].resources.gold).toBe(400);
  });

  it('capture resets production and marks the city for unrest', () => {
    const city = makeEnemyCity(2);
    city.currentProduction = { type: 'unit', itemType: 'warrior', cost: 10 };
    city.buildQueue = [{ type: 'building', itemType: 'temple', cost: 40 }];
    city.productionStored = 40;
    city.productionProgress = 40;
    const pos = adjacentLand(city);
    addUnit('atkC', 0, pos);

    randomSpy.mockReturnValue(0.05);

    (engine as any).moveUnit('atkC', city.col, city.row);

    const captured = engine.cities.find((c: any) => c.id === city.id);
    expect(captured.currentProduction).toBeNull();
    expect(captured.buildQueue).toHaveLength(0);
    expect(captured.productionStored).toBe(0);
    expect(captured.productionProgress).toBe(0);
    expect(captured.capturedTurns).toBeGreaterThan(0);
  });

  it('killing the last garrison instantly captures the city', () => {
    const city = makeEnemyCity(2);
    // A defender standing on the city tile (civ 1).
    addUnit('garrison1', 1, { col: city.col, row: city.row });
    const pos = adjacentLand(city);
    addUnit('atkD', 0, pos);

    randomSpy.mockReturnValue(0.05); // unit combat AND city combat both won

    const result = (engine as any).moveUnit('atkD', city.col, city.row);

    // Unit combat killed the defender, then the city was captured instantly.
    expect(result.success).toBe(true);
    const captured = engine.cities.find((c: any) => c.id === city.id);
    expect(captured?.civilizationId).toBe(0);
    expect(captured?.population).toBe(1);
    // The defender is destroyed (kept briefly for the death animation) and
    // the attacker survives (spent for this turn, moves=0).
    const garrison: any = engine.units.find((u: any) => u.id === 'garrison1');
    expect(garrison).toBeDefined();
    expect(garrison.isDefeated).toBe(true);
    expect(engine.units.some((u: any) => u.id === 'atkD')).toBe(true);
    const attacker = engine.units.find((u: any) => u.id === 'atkD');
    expect(attacker.movesRemaining).toBe(0);
    expect(emitted).toContain('CITY_CAPTURED');
  });

  it('a won garrison fight is never punished by the city (the winner survives)', () => {
    // Regression: after the last defender died, the follow-up city assault
    // rolled the city roll too. On a lost roll the city counter-struck, so a
    // unit that had just WON (and was told so by the toast) could be killed
    // moments later — it vanished right after the fight.
    const city = makeEnemyCity(2);
    addUnit('garrison2', 1, { col: city.col, row: city.row }, 'warrior', 1);
    const pos = adjacentLand(city);
    addUnit('atkE', 0, pos, 'legion', 3);

    // 0.01 → the unit round is won; 0.99 → the (now empty) city repels.
    randomSpy.mockReturnValueOnce(0.01).mockReturnValue(0.99);

    (engine as any).moveUnit('atkE', city.col, city.row);

    const attacker: any = engine.units.find((u: any) => u.id === 'atkE');
    expect(attacker).toBeDefined();
    expect(attacker.isDefeated).not.toBe(true);
    expect(attacker.health).toBe(100);
    // The city held out and the player is told about it (no damage numbers).
    expect(engine.cities.find((c: any) => c.id === city.id)?.civilizationId).toBe(1);
    const cityAttacked = emitted.includes('CITY_ATTACKED');
    expect(cityAttacked).toBe(true);
  });

  it('a failed attack can cost an unwalled city a citizen, but walls protect it', () => {
    // Unwalled: attacker loses (0.99), then the population-loss roll succeeds
    // (0.1 < 0.5) → the city drops to population 2.
    const open = makeEnemyCity(3);
    const openPos = adjacentLand(open);
    addUnit('weak1', 0, openPos, 'warrior', 1);

    randomSpy.mockReturnValueOnce(0.99).mockReturnValueOnce(0.1);
    (engine as any).moveUnit('weak1', open.col, open.row);
    expect(engine.cities.find((c: any) => c.id === open.id)?.population).toBe(2);

    // Walled: same losing roll, but the walls shield the population.
    const walled = makeEnemyCity(3, { walls: true });
    const walledPos = adjacentLand(walled);
    addUnit('weak2', 0, walledPos, 'warrior', 1);

    randomSpy.mockReturnValueOnce(0.99).mockReturnValueOnce(0.1);
    (engine as any).moveUnit('weak2', walled.col, walled.row);
    expect(engine.cities.find((c: any) => c.id === walled.id)?.population).toBe(3);
  });

  it('metallurgy discovery scraps city walls', () => {
    const city = makeEnemyCity(2, { buildings: ['city_walls', 'temple'] });

    (engine as any).scrapObsoleteCityWalls(1);

    const after = engine.cities.find((c: any) => c.id === city.id);
    expect(after.buildings).not.toContain('city_walls');
    expect(after.buildings).toContain('temple');
  });

  it('captured cities suffer unrest in the happiness model', () => {
    const econ = (engine as any).economicManager;
    const civ0 = engine.civilizations[0];
    const city = engine.cities.find((c: any) => c.civilizationId === 0);
    city.buildings = [];
    city.population = 1;
    city.capturedTurns = 0;
    // Clear garrison units from the city tile so martial law doesn't mask
    // the disorder test — we want to test the capturedTurns unhappiness alone.
    engine.units = engine.units.filter(
      (u: any) => !(u.col === city.col && u.row === city.row && u.civilizationId === 0),
    );

    const calm = econ.cityHappiness(city, civ0);
    expect(calm.unhappiness).toBe(0);
    expect(calm.disorder).toBe(false);

    city.capturedTurns = 3;
    const restless = econ.cityHappiness(city, civ0);
    // Resentful captured citizens push the city into disorder.
    expect(restless.unhappiness).toBeGreaterThan(calm.unhappiness);
    expect(restless.disorder).toBe(true);
  });
});

/**
 * The AI should actively assault and capture enemy cities: when an AI combat
 * unit is at war and adjacent to an enemy city, its target scan returns the
 * city and stepping onto the tile triggers the same city combat that the
 * human uses (capture on win, destruction at size 1).
 */
describe('AI captures cities', () => {
  let engine: GameEngine;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
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
    (engine as any).civilizations = [];
  });

  it('an AI warrior captures an undefended enemy city', async () => {
    const civ0 = engine.civilizations[0];
    const civ1 = engine.civilizations[1];
    civ0.isHuman = true;
    civ0.isAI = false;
    civ1.isHuman = false;
    civ1.isAI = true;

    // Pick an undefended civ-0 city (no unit standing on it) and make it
    // size 2 so the outcome is a capture (not destruction). Skip river cities:
    // a wide-river city tile is unreachable for a warrior on the bank, which
    // would make the scenario map-dependent instead of testing the capture.
    const isRiver = (col: number, row: number): boolean => {
      const tile = (engine as any).getTileAt?.(col, row);
      return String(tile?.type ?? '').toLowerCase() === 'river';
    };
    const targetCity = engine.cities.find(
      (c: any) => c.civilizationId === 0
        && !(engine as any).getUnitAt(c.col, c.row)
        && !isRiver(c.col, c.row)
    );
    expect(targetCity).toBeDefined();
    targetCity.population = 2;

    // Strip all units so the only actors are the AI's own warriors.
    (engine as any).units = [];

    // The staging tile must be passable land (not ocean/lake).
    let spot: { col: number; row: number } | null = null;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const col = targetCity.col + dc;
      const row = targetCity.row + dr;
      if (engine.isTilePassable(col, row)) { spot = { col, row }; break; }
    }
    expect(spot).toBeTruthy();

    // A small AI army. Civ 1 is `military_expansion` (aggression 8 via its
    // profile personality) and the human has no units, so the AI's own
    // diplomacy declares war this turn — no manual declareWar needed.
    (engine as any).units.push(
      { id: 'ai_attacker', civilizationId: 1, type: 'warrior', col: spot!.col, row: spot!.row, movesRemaining: 2, maxMoves: 2, health: 100, attack: 2, defense: 1, icon: 'warrior', orders: 'none', areTurnsDone: false, isSkipped: false },
      { id: 'ai_2', civilizationId: 1, type: 'warrior', col: Math.max(0, spot!.col + 3), row: spot!.row, movesRemaining: 2, maxMoves: 2, health: 100, attack: 2, defense: 1, icon: 'warrior', orders: 'none', areTurnsDone: false, isSkipped: false },
      { id: 'ai_3', civilizationId: 1, type: 'warrior', col: spot!.col, row: Math.max(0, spot!.row + 3), movesRemaining: 2, maxMoves: 2, health: 100, attack: 2, defense: 1, icon: 'warrior', orders: 'none', areTurnsDone: false, isSkipped: false },
    );

    randomSpy.mockReturnValue(0.05); // attacker always wins city combat

    // Run the AI turn (Phase 2c of the turn runs AI diplomacy → declares war,
    // then the unit phase marches the adjacent warrior onto the city).
    (engine as any).activePlayer = 1;
    await engine.processAITurn(1);

    // The AI declared war on its own and captured the city.
    expect(engine.diplomacyManager.isAtWar(1, 0)).toBe(true);
    const cityAfter = engine.cities.find((c: any) => c.id === targetCity.id);
    expect(cityAfter).toBeDefined();
    expect(cityAfter!.civilizationId).toBe(1);
    // Attacker survives but is spent for this turn.
    expect(engine.units.some((u: any) => u.id === 'ai_attacker')).toBe(true);
    const attacker = engine.units.find((u: any) => u.id === 'ai_attacker');
    expect(attacker.movesRemaining).toBe(0);
  });
});
