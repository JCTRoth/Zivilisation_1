/**
 * Civ1 terrain rule tests (from civ-wiki.de "Terrain (Civ1)"):
 *  - TERRAIN_PROPERTIES yields/defense/movement match the wiki table.
 *  - TERRAIN_RESOURCES maps exactly one special resource per terrain.
 *  - Settler terrain conversion: irrigation (forest -> plains,
 *    jungle/swamp -> grassland) and mining (grassland/plains -> forest).
 *  - Roads on rivers are available as ordinary land improvements.
 *  - Combat: terrain defense, fortification and fortress stacking.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { TERRAIN_PROPERTIES, TERRAIN_RESOURCES, TERRAIN_TYPES } from '@/data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';

describe('Civ1 terrain data', () => {
  it('has Civ1 base yields', () => {
    const yields = (t: string): { food: number; production: number; trade: number } => {
      const p = TERRAIN_PROPERTIES[t];
      return { food: p.food, production: p.production, trade: p.trade };
    };
    expect(yields(TERRAIN_TYPES.OCEAN)).toEqual({ food: 1, production: 0, trade: 2 });
    expect(yields(TERRAIN_TYPES.GRASSLAND)).toEqual({ food: 2, production: 1, trade: 0 });
    expect(yields(TERRAIN_TYPES.PLAINS)).toEqual({ food: 1, production: 1, trade: 0 });
    expect(yields(TERRAIN_TYPES.TUNDRA)).toEqual({ food: 1, production: 0, trade: 0 });
    expect(yields(TERRAIN_TYPES.DESERT)).toEqual({ food: 0, production: 1, trade: 0 });
    expect(yields(TERRAIN_TYPES.FOREST)).toEqual({ food: 1, production: 2, trade: 0 });
    expect(yields(TERRAIN_TYPES.JUNGLE)).toEqual({ food: 1, production: 0, trade: 0 });
    expect(yields(TERRAIN_TYPES.MOUNTAINS)).toEqual({ food: 0, production: 1, trade: 0 });
    expect(yields(TERRAIN_TYPES.HILLS)).toEqual({ food: 1, production: 0, trade: 0 });
    expect(yields(TERRAIN_TYPES.SWAMP)).toEqual({ food: 1, production: 0, trade: 0 });
    expect(yields(TERRAIN_TYPES.ARCTIC)).toEqual({ food: 0, production: 0, trade: 0 });
    expect(yields(TERRAIN_TYPES.RIVER)).toEqual({ food: 2, production: 0, trade: 1 });
  });

  it('has Civ1 defense multipliers', () => {
    const def = (t: string): number => TERRAIN_PROPERTIES[t].defense;
    expect(def(TERRAIN_TYPES.MOUNTAINS)).toBe(3); // +200%
    expect(def(TERRAIN_TYPES.HILLS)).toBe(2); // +100%
    expect(def(TERRAIN_TYPES.FOREST)).toBe(1.5); // +50%
    expect(def(TERRAIN_TYPES.JUNGLE)).toBe(1.5); // +50%
    expect(def(TERRAIN_TYPES.SWAMP)).toBe(1.5); // +50%
    expect(def(TERRAIN_TYPES.RIVER)).toBe(1.5); // +50%
    expect(def(TERRAIN_TYPES.PLAINS)).toBe(1); // 0%
    expect(def(TERRAIN_TYPES.GRASSLAND)).toBe(1);
    expect(def(TERRAIN_TYPES.DESERT)).toBe(1);
    expect(def(TERRAIN_TYPES.TUNDRA)).toBe(1);
    expect(def(TERRAIN_TYPES.ARCTIC)).toBe(1);
    expect(def(TERRAIN_TYPES.OCEAN)).toBe(1);
  });

  it('has Civ1 movement costs', () => {
    const move = (t: string): number => TERRAIN_PROPERTIES[t].movement;
    expect(move(TERRAIN_TYPES.PLAINS)).toBe(1);
    expect(move(TERRAIN_TYPES.GRASSLAND)).toBe(1);
    expect(move(TERRAIN_TYPES.DESERT)).toBe(1);
    expect(move(TERRAIN_TYPES.TUNDRA)).toBe(1);
    expect(move(TERRAIN_TYPES.OCEAN)).toBe(1);
    expect(move(TERRAIN_TYPES.RIVER)).toBe(1);
    expect(move(TERRAIN_TYPES.FOREST)).toBe(2);
    expect(move(TERRAIN_TYPES.JUNGLE)).toBe(2);
    expect(move(TERRAIN_TYPES.SWAMP)).toBe(2);
    expect(move(TERRAIN_TYPES.ARCTIC)).toBe(2);
    expect(move(TERRAIN_TYPES.HILLS)).toBe(2);
    expect(move(TERRAIN_TYPES.MOUNTAINS)).toBe(3);
  });

  it('maps exactly one special resource per terrain (grassland/lake none)', () => {
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.ARCTIC]).toBe('Seal');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.JUNGLE]).toBe('Gems');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.PLAINS]).toBe('Horses');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.MOUNTAINS]).toBe('Gold');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.HILLS]).toBe('Coal');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.OCEAN]).toBe('Fish');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.SWAMP]).toBe('Oil');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.FOREST]).toBe('Game');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.DESERT]).toBe('Oasis');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.GRASSLAND]).toBeNull();
    // Rivers can carry fish (at half the ocean spawn rate — see
    // RESOURCE_SPAWN_CHANCE).
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.RIVER]).toBe('Fish');
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.LAKE]).toBeNull();
  });

  it('has Civ1 fortress / railroad / road properties', () => {
    expect(IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.FORTRESS].defenseMultiplier).toBe(2);
    expect(IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.FORTRESS].requiredTech).toBe('construction');
    expect(IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD].requiredTech).toBe('railroad');
    expect(IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD].movementCost).toBeCloseTo(1 / 3);
  });
});

describe('Civ1 settler terrain conversion', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function setupEngine(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  /** Place a settler on the first non-ocean tile and re-type it. */
  function placeSettler(e: GameEngine, type: string, moves = 10) {
    const width = (e as unknown as { map: { width: number } }).map.width;
    const tiles = (e as unknown as { map: { tiles: Array<{ type?: string }> } }).map.tiles;
    const index = tiles.findIndex((t) => t && t.type && t.type !== TERRAIN_TYPES.OCEAN);
    if (index < 0) throw new Error('no land tile found');
    const col = index % width;
    const row = Math.floor(index / width);
    const tile = e.getTileAt(col, row) as unknown as {
      type: string;
      terrain?: string;
      resource?: string | null;
      improvement?: string | null;
    };
    tile.type = type;
    tile.terrain = type;
    tile.improvement = null;
    const settler = {
      id: `conv_${type}_${col}_${row}`,
      type: 'settler',
      civilizationId: 0,
      col,
      row,
      movesRemaining: moves,
      isFortified: false,
    };
    (e as unknown as { units: unknown[] }).units.push(settler);
    return { col, row, tile, settler };
  }

  /** Mark an orthogonally adjacent tile as fresh water so irrigation is feasible (Civ1 water rule). */
  function ensureRiverAdjacent(e: GameEngine, col: number, row: number): void {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (const [dc, dr] of directions) {
      const tile = e.getTileAt(col + dc, row + dr) as unknown as { type: string; terrain?: string } | undefined;
      if (tile) {
        // Only the terrain flag changes — the tile keeps its type so later
        // tile searches are not redirected to this neighbor.
        tile.terrain = TERRAIN_TYPES.RIVER;
        return;
      }
    }
  }

  /** Start the multi-turn construction and advance it to completion. */
  function finishWork(e: GameEngine, settler: { id: string }, type: string, terrain: string): void {
    const turns = e.improvementBuildTurns(type, terrain);
    expect(e.buildImprovement(settler.id, type)).toBe(true);
    for (let i = 1; i < turns; i++) {
      e.advanceUnitWork(settler.id);
    }
  }

  it('irrigation converts jungle to grassland and removes its resource', async () => {
    const e = await setupEngine();
    const { col, row, tile, settler } = placeSettler(e, TERRAIN_TYPES.JUNGLE);
    tile.resource = 'Gems';
    // Civ1 irrigation needs fresh water orthogonally adjacent.
    ensureRiverAdjacent(e, col, row);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(true);
    finishWork(e, settler, 'irrigation', TERRAIN_TYPES.JUNGLE);
    const after = e.getTileAt(col, row) as unknown as { type: string; resource: string | null };
    expect(after.type).toBe(TERRAIN_TYPES.GRASSLAND);
    expect(after.resource).toBeNull();
  });

  it('irrigation converts swamp to grassland', async () => {
    const e = await setupEngine();
    const { col, row, tile, settler } = placeSettler(e, TERRAIN_TYPES.SWAMP);
    tile.resource = 'Oil';
    ensureRiverAdjacent(e, col, row);
    finishWork(e, settler, 'irrigation', TERRAIN_TYPES.SWAMP);
    const after = e.getTileAt(col, row) as unknown as { type: string; resource: string | null };
    expect(after.type).toBe(TERRAIN_TYPES.GRASSLAND);
    expect(after.resource).toBeNull();
  });

  it('mining is blocked on jungle', async () => {
    const e = await setupEngine();
    const { settler } = placeSettler(e, TERRAIN_TYPES.JUNGLE);
    expect(e.canBuildImprovement(settler.id, 'mine')).toBe(false);
  });

  it('mining is blocked on forest', async () => {
    const e = await setupEngine();
    const { settler } = placeSettler(e, TERRAIN_TYPES.FOREST);
    expect(e.canBuildImprovement(settler.id, 'mine')).toBe(false);
  });

  it('mines on mountains stay as an improvement (no conversion)', async () => {
    const e = await setupEngine();
    const { tile, settler } = placeSettler(e, TERRAIN_TYPES.MOUNTAINS);
    finishWork(e, settler, 'mine', TERRAIN_TYPES.MOUNTAINS);
    expect(tile.improvement).toBe('mines');
    expect(tile.type).toBe(TERRAIN_TYPES.MOUNTAINS);
  });

  it('road on river is allowed without an extra technology', async () => {
    const e = await setupEngine();
    const { tile, settler } = placeSettler(e, TERRAIN_TYPES.RIVER);
    expect(e.canBuildImprovement(settler.id, 'road')).toBe(true);
    finishWork(e, settler, 'road', TERRAIN_TYPES.RIVER);
    expect(tile.improvement).toBe('road');
  });
});

describe('Civ1 combat terrain defense', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeCombatEngine(defenderTerrain: string, opts: { fortress?: boolean } = {}) {
    const e = new GameEngine(null) as unknown as {
      units: unknown[];
      civilizations: unknown[];
      onStateChange: unknown;
      unitTurnQueue: unknown;
      diplomacyManager: unknown;
      getTileAt: () => { type: string; terrain: string; improvement: string | null };
      getCityAt: () => undefined;
      checkAndEndTurnIfNoMoves: () => void;
      combatUnit: (a: unknown, d: unknown) => boolean;
    };
    e.units = [];
    e.civilizations = [];
    e.onStateChange = null;
    e.unitTurnQueue = null;
    e.diplomacyManager = null;
    e.getTileAt = () => ({
      type: defenderTerrain,
      terrain: defenderTerrain,
      improvement: opts.fortress ? 'fortress' : null,
    });
    e.getCityAt = () => null;
    e.checkAndEndTurnIfNoMoves = () => undefined;
    return e;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function warrior(id: string, attack: number, defense: number, col: number, row: number, opts: { fortified?: boolean } = {}): any {
    return {
      id,
      type: 'warrior',
      civilizationId: 0,
      attack,
      defense,
      health: 100,
      col,
      row,
      movesRemaining: 1,
      isFortified: opts.fortified ?? false,
    };
  }

  it('terrain defense flips the outcome (mountains vs plains)', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    try {
      // Attacker 12 vs defender 6. At r=0.6 the attacker wins iff A > 1.5·D.
      // Plains (def 1): D=6 → 12 > 9 → attacker wins.
      const plains = makeCombatEngine(TERRAIN_TYPES.PLAINS);
      const a1 = warrior('a1', 12, 2, 1, 1);
      const d1 = warrior('d1', 1, 6, 2, 2);
      plains.units = [a1, d1];
      expect(plains.combatUnit(a1, d1)).toBe(true);
      expect(d1.isDefeated).toBe(true);

      // Mountains (def 3): D=18 → 12 < 27 → defender wins.
      const mountains = makeCombatEngine(TERRAIN_TYPES.MOUNTAINS);
      const a2 = warrior('a2', 12, 2, 1, 1);
      const d2 = warrior('d2', 1, 6, 2, 2);
      mountains.units = [a2, d2];
      expect(mountains.combatUnit(a2, d2)).toBe(false);
      expect(d2.isDefeated).toBeFalsy();
      expect(a2.health).toBe(75); // damaged but not destroyed
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('fortification (x1.5) flips a plains fight', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    try {
      // Plain plains: D=6 → attacker wins. Fortified: D=9 → 0.6·21=12.6 ≥ 12 → defender wins.
      const plains = makeCombatEngine(TERRAIN_TYPES.PLAINS);
      const a = warrior('a', 12, 2, 1, 1);
      const d = warrior('d', 1, 6, 2, 2, { fortified: true });
      plains.units = [a, d];
      expect(plains.combatUnit(a, d)).toBe(false);
      expect(d.isDefeated).toBeFalsy();
      expect(a.health).toBe(75);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('fortress (+100%) stacks last with terrain defense', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    try {
      // Hills (def 2) + fortress (x2): D = 6·2·2 = 24 → 0.6·36=21.6 ≥ 12 → defender wins.
      const hills = makeCombatEngine(TERRAIN_TYPES.HILLS, { fortress: true });
      const a = warrior('a', 12, 2, 1, 1);
      const d = warrior('d', 1, 6, 2, 2);
      hills.units = [a, d];
      expect(hills.combatUnit(a, d)).toBe(false);
      expect(d.isDefeated).toBeFalsy();
    } finally {
      randomSpy.mockRestore();
    }
  });
});
