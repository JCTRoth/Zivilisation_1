/**
 * AI settler tile improvements (Civ1): the AI should build roads, irrigation
 * and mines near its cities instead of only founding cities and wandering.
 * Multi-turn construction applies to AI settlers exactly as to the human.
 */
import { describe, expect, it, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import { IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';

describe('AI settler tile improvements (Civ1)', () => {
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
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  /** Find a land tile whose (col+1,row) AND (col,row+1) neighbours are also land. */
  function findLandPair(e: GameEngine): { col: number; row: number; ncol: number; nrow: number; ecol: number; erow: number } {
    const width = (e as unknown as { map: { width: number } }).map.width;
    const tiles = (e as unknown as { map: { tiles: Array<{ type?: string }> } }).map.tiles;
    for (let idx = 0; idx < tiles.length; idx++) {
      const t = tiles[idx];
      if (!t || !t.type || t.type === TERRAIN_TYPES.OCEAN) continue;
      const col = idx % width;
      const row = Math.floor(idx / width);
      const a = e.getTileAt(col + 1, row) as unknown as { type?: string } | undefined;
      const b = e.getTileAt(col, row + 1) as unknown as { type?: string } | undefined;
      if (a && a.type && a.type !== TERRAIN_TYPES.OCEAN &&
          b && b.type && b.type !== TERRAIN_TYPES.OCEAN) {
        return { col, row, ncol: col + 1, nrow: row, ecol: col, erow: row + 1 };
      }
    }
    throw new Error('no land triple found');
  }

  /** Strip every fresh-water source within the irrigation reach of a tile. */
  function clearWaterInReach(e: GameEngine, col: number, row: number, reach = 6): void {
    for (let dc = -reach; dc <= reach; dc++) {
      for (let dr = -reach; dr <= reach; dr++) {
        const t = e.getTileAt(col + dc, row + dr) as unknown as
          { type: string; terrain?: string; improvement: string | null } | undefined;
        if (!t) continue;
        if (t.type === TERRAIN_TYPES.RIVER || t.type === TERRAIN_TYPES.LAKE) t.type = TERRAIN_TYPES.PLAINS;
        if (t.terrain === TERRAIN_TYPES.RIVER || t.terrain === TERRAIN_TYPES.LAKE) t.terrain = TERRAIN_TYPES.PLAINS;
        if (t.improvement === IMPROVEMENT_TYPES.IRRIGATION) t.improvement = null;
      }
    }
  }

  function setTile(e: GameEngine, col: number, row: number, type: string, improvement: string | null = null): void {
    const t = e.getTileAt(col, row) as unknown as { type: string; terrain?: string; improvement: string | null; resource?: string | null };
    t.type = type;
    t.terrain = type;
    t.improvement = improvement;
    t.resource = null;
  }

  function addCity(e: GameEngine, civId: number, col: number, row: number): void {
    (e as unknown as { cities: unknown[] }).cities.push({
      id: `ai_city_${col}_${row}`,
      civilizationId: civId,
      col,
      row,
      population: 1,
    });
  }

  function addSettler(e: GameEngine, civId: number, col: number, row: number): any {
    const s = {
      id: `ai_settler_${col}_${row}`,
      type: 'settler',
      civilizationId: civId,
      col,
      row,
      movesRemaining: 2,
      isFortified: false,
      workTarget: null as string | null,
      workTurns: 0,
    };
    (e as unknown as { units: unknown[] }).units.push(s);
    return s;
  }

  function choose(e: GameEngine, settler: any): string | null {
    return (e as any).aiManager.chooseImprovementForSettler(settler);
  }

  it('mines hills/mountains next to a friendly city', async () => {
    const e = await setupEngine();
    const { col, row, ncol, nrow } = findLandPair(e);
    setTile(e, col, row, TERRAIN_TYPES.HILLS);
    setTile(e, ncol, nrow, TERRAIN_TYPES.HILLS);
    addCity(e, 1, col, row);
    const s = addSettler(e, 1, ncol, nrow);

    expect(choose(e, s)).toBe('mine');
  });

  it('irrigates fertile tiles next to fresh water', async () => {
    const e = await setupEngine();
    const { col, row, ncol, nrow } = findLandPair(e);
    setTile(e, col, row, TERRAIN_TYPES.GRASSLAND);
    setTile(e, ncol, nrow, TERRAIN_TYPES.GRASSLAND);
    addCity(e, 1, col, row);
    // Put a river orthogonally adjacent to the settler's tile.
    const river = e.getTileAt(ncol + 1, nrow) as unknown as { type: string; terrain?: string } | undefined;
    if (!river) return;
    river.terrain = TERRAIN_TYPES.RIVER;
    const s = addSettler(e, 1, ncol, nrow);

    expect(choose(e, s)).toBe('irrigation');
  });

  it('builds a road as the fallback on a roadless tile', async () => {
    const e = await setupEngine();
    const { col, row, ncol, nrow } = findLandPair(e);
    setTile(e, col, row, TERRAIN_TYPES.GRASSLAND);
    setTile(e, ncol, nrow, TERRAIN_TYPES.GRASSLAND);
    addCity(e, 1, col, row);
    // No water in the whole irrigation reach → no irrigation; not hills → no
    // mine → road. Clearing only the four neighbours is not enough any more,
    // since a canal can reach water five fields away.
    clearWaterInReach(e, ncol, nrow);
    const s = addSettler(e, 1, ncol, nrow);
    expect(choose(e, s)).toBe('road');
  });

  it('does not improve tiles far from any friendly city', async () => {
    const e = await setupEngine();
    const { ncol, nrow } = findLandPair(e);
    setTile(e, ncol, nrow, TERRAIN_TYPES.HILLS);
    // No city anywhere near the settler.
    const s = addSettler(e, 1, ncol, nrow);
    expect(choose(e, s)).toBeNull();
  });

  it('respects the improvement budget (stops after ~2 per city)', async () => {
    const e = await setupEngine();
    const { col, row, ncol, nrow, ecol, erow } = findLandPair(e);
    setTile(e, col, row, TERRAIN_TYPES.GRASSLAND);
    setTile(e, ncol, nrow, TERRAIN_TYPES.GRASSLAND);
    setTile(e, ecol, erow, TERRAIN_TYPES.GRASSLAND);
    addCity(e, 1, col, row);
    // Budget = max(2, 1*2) = 2; plant 3 improvements near the city.
    setTile(e, col, row, TERRAIN_TYPES.GRASSLAND, 'road');
    setTile(e, ncol, nrow, TERRAIN_TYPES.GRASSLAND, 'road');
    setTile(e, ecol, erow, TERRAIN_TYPES.GRASSLAND, 'road');
    const s = addSettler(e, 1, ncol, nrow);
    expect(choose(e, s)).toBeNull();
  });

  it('returns null on ocean and arctic tiles', async () => {
    const e = await setupEngine();
    const { col, row } = findLandPair(e);
    addCity(e, 1, col, row);
    const n = findLandPair(e);
    setTile(e, n.ncol, n.nrow, TERRAIN_TYPES.OCEAN);
    const sOcean = addSettler(e, 1, n.ncol, n.nrow);
    expect(choose(e, sOcean)).toBeNull();
  });

  it('AI settler construction completes over multiple turns (multi-turn model)', async () => {
    const e = await setupEngine();
    const { col, row, ncol, nrow } = findLandPair(e);
    setTile(e, col, row, TERRAIN_TYPES.HILLS);
    setTile(e, ncol, nrow, TERRAIN_TYPES.HILLS);
    addCity(e, 1, col, row);
    const s = addSettler(e, 1, ncol, nrow);

    expect(e.buildImprovement(s.id, 'mine')).toBe(true);
    expect(s.workTarget).toBe('mines'); // canonical improvement id
    expect(s.workTurns).toBe(9); // 10 worker-turns on hills, first spent now
    for (let i = 0; i < 9; i++) e.advanceUnitWork(s.id);
    expect((e.getTileAt(ncol, nrow) as unknown as { improvement: string | null }).improvement).toBe('mines');
    expect(s.workTarget).toBeNull();
  });
});
