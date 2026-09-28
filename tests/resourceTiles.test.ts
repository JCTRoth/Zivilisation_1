/**
 * Pre-rendered feature-on-tile textures — the composed PNGs produced by
 * tools/tile-generator/compose_feature_tiles.mjs for every legal resource ×
 * terrain pairing. Resources never move, so their picture belongs to the
 * static terrain layer; the dynamic layer only draws units and cities. These
 * tests lock in:
 *
 *  - every mapped composed tile exists in public/assets/tiles,
 *  - loading them never gates the terrain boot (`ready`), only the separate
 *    `resourceTilesReady`,
 *  - `getTileTexture` picks the composed variant for a resource tile and the
 *    plain terrain texture otherwise,
 *  - MapRenderer lifts the composed picture above the feature sprites and only
 *    falls back to a Civ1 glyph when no composed tile has decoded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MapRenderer, type TerrainRenderGrid } from '@/game/rendering/MapRenderer';
import {
  RESOURCE_TILE_FILES,
  TerrainTextureManager,
} from '@/game/rendering/TerrainTextureManager';
import type { MapState } from '../types/game';

/** Files the Image stub can decode; anything else errors like a real 404. */
const AVAILABLE = new Set([
  'terrain_ocean.png',
  'terrain_plains.png',
  'terrain_river.png',
  'terrain_forest_1.png',
  // Every composed resource tile, glyph or artwork.
  'terrain_arctic_seal.png',
  'terrain_desert_oasis.png',
  'terrain_forest_game.png',
  'terrain_hills_coal.png',
  'terrain_jungle_gems.png',
  'terrain_mountains_gold.png',
  'terrain_swamp_oil.png',
  'terrain_tundra_game.png',
  'terrain_ocean_fish.png',
  // Five fish poses ship as variants (fish1..fish5.png → _2.._5).
  'terrain_ocean_fish_2.png',
  'terrain_ocean_fish_3.png',
  'terrain_ocean_fish_4.png',
  'terrain_ocean_fish_5.png',
  'terrain_river_fish.png',
  'terrain_plains_horses.png',
  'terrain_plains_horses_2.png',
]);

/** Resource tiles the stub is told to leave hanging (never load/error). */
let blocked: Set<string> = new Set();

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    const name = value.split('/').pop()?.split(/[?#]/)[0] ?? '';
    if (blocked.has(name)) return; // stays pending forever
    if (AVAILABLE.has(name)) {
      this.naturalWidth = 512;
      this.naturalHeight = 512;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    } else {
      queueMicrotask(() => this.onerror?.());
    }
  }
}

beforeEach(() => {
  blocked = new Set();
  (globalThis as unknown as { Image: unknown }).Image = StubImage;
});

async function loadedManager(): Promise<TerrainTextureManager> {
  const manager = new TerrainTextureManager();
  await manager.ready;
  await manager.resourceTilesReady;
  return manager;
}

interface RecordedDraw {
  img: { src: string } | null;
  x: number;
  y: number;
  w: number;
  h: number;
  fillRect: boolean;
}

function createStubContext(): { ctx: CanvasRenderingContext2D; draws: RecordedDraw[] } {
  const draws: RecordedDraw[] = [];
  const ctx = {
    drawImage: (img: { src: string }, x: number, y: number, w: number, h: number) => {
      draws.push({ img, x, y, w, h, fillRect: false });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      draws.push({ img: null, x, y, w, h, fillRect: true });
    },
    fillText: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws };
}

describe('pre-rendered resource tiles', () => {
  it('maps every legal resource × terrain pairing and ships its composed PNG', () => {
    // Derived from SPECIAL_RESOURCES: one entry per legal pairing.
    expect(Object.keys(RESOURCE_TILE_FILES).sort()).toEqual([
      'ARCTIC.SEAL',
      'DESERT.OASIS',
      'FOREST.GAME',
      'HILLS.COAL',
      'JUNGLE.GEMS',
      'MOUNTAINS.GOLD',
      'OCEAN.FISH',
      'PLAINS.HORSES',
      'RIVER.FISH',
      'SWAMP.OIL',
      'TUNDRA.GAME',
    ]);
    for (const [key, url] of Object.entries(RESOURCE_TILE_FILES)) {
      expect(url).toMatch(/^\/assets\/tiles\/terrain_.+\.png$/);
      expect(existsSync(join(process.cwd(), 'public', url)), `${key} → ${url}`).toBe(true);
    }
    // Horses ships a second pose next to the primary tile.
    expect(existsSync(join(process.cwd(), 'public', 'assets/tiles/terrain_plains_horses_2.png'))).toBe(true);
  });

  it('does not gate terrain boot on the optional resource tiles', async () => {
    blocked = new Set(['terrain_ocean_fish.png', 'terrain_river_fish.png', 'terrain_plains_horses.png']);
    const manager = new TerrainTextureManager();

    // `ready` settles without the blocked resource tiles…
    await manager.ready;
    expect(manager.isReady).toBe(true);

    // …while `resourceTilesReady` deliberately stays pending.
    const pending = await Promise.race([
      manager.resourceTilesReady.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50)),
    ]);
    expect(pending).toBe(true);
  });

  it('looks up composed tiles case-insensitively and only for mapped pairings', async () => {
    const tm = await loadedManager();
    expect(tm.hasResourceTile('OCEAN', 'Fish')).toBe(true);
    expect(tm.hasResourceTile('ocean', 'fish')).toBe(true);
    expect(tm.hasResourceTile('PLAINS', 'Horses')).toBe(true);
    expect(tm.hasResourceTile('OCEAN', 'Gold')).toBe(false);
    expect(tm.hasResourceTile(null, 'Fish')).toBe(false);
  });

  it('draws the composed texture for resource tiles and the base texture otherwise', async () => {
    const tm = await loadedManager();
    const { ctx, draws } = createStubContext();

    tm.drawTile(ctx, 'OCEAN', 0, 0, 64, '#000', true, 0, 0, 'Fish');
    expect(draws[0].img?.src).toMatch(/terrain_ocean_fish\.png$/);

    // No composed tile for Gold → plain ocean base.
    tm.drawTile(ctx, 'OCEAN', 0, 0, 64, '#000', true, 1, 0, 'Gold');
    expect(draws[1].img?.src).toMatch(/terrain_ocean\.png$/);
    expect(draws[1].img?.src).not.toMatch(/fish/);
  });

  it('picks a stable pose per tile and spreads neighbours over both horse poses', async () => {
    const tm = await loadedManager();
    const poses = new Set<string>();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const first = tm.getTileTexture('PLAINS', 'Horses', col, row);
        expect(first).not.toBeNull();
        expect(tm.getTileTexture('PLAINS', 'Horses', col, row)).toBe(first);
        expect(first!.src).toMatch(/terrain_plains_horses(_2)?\.png$/);
        poses.add(first!.src);
      }
    }
    expect(poses.size).toBe(2);
  });

  it('spreads fish over all five shipped poses', async () => {
    const tm = await loadedManager();
    const poses = new Set<string>();
    // A 6x6 patch is enough for the hash to hit every variant; each tile keeps
    // its own pose between frames.
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const first = tm.getTileTexture('OCEAN', 'Fish', col, row);
        expect(first).not.toBeNull();
        expect(tm.getTileTexture('OCEAN', 'Fish', col, row)).toBe(first);
        expect(first!.src).toMatch(/terrain_ocean_fish(_[2-5])?\.png$/);
        poses.add(first!.src);
      }
    }
    expect(poses.size).toBe(5);
  });
});

interface FakeTextureManager {
  isReady: boolean;
  drawTile: ReturnType<typeof vi.fn>;
  drawFeature: ReturnType<typeof vi.fn>;
  drawTextureTransition: ReturnType<typeof vi.fn>;
  drawCornerTransition4: ReturnType<typeof vi.fn>;
  drawRiver: ReturnType<typeof vi.fn>;
  getPriority: ReturnType<typeof vi.fn>;
  drawResourceTile: ReturnType<typeof vi.fn>;
}

function createFakeTextureManager(
  drawResourceTile: boolean | ((terrain: string, resource: string | null) => boolean) = false,
): FakeTextureManager {
  return {
    isReady: true,
    drawTile: vi.fn(),
    drawFeature: vi.fn(),
    drawTextureTransition: vi.fn(),
    drawCornerTransition4: vi.fn(),
    drawRiver: vi.fn(),
    getPriority: vi.fn(() => 0),
    drawResourceTile: vi.fn((_ctx, terrain, resource) =>
      typeof drawResourceTile === 'function' ? drawResourceTile(terrain, resource) : drawResourceTile),
  };
}

function renderBase(
  renderer: MapRenderer,
  grid: TerrainRenderGrid,
  ctx: CanvasRenderingContext2D,
): void {
  renderer.renderTerrainBase({
    offscreenCanvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
    map: { width: grid[0]?.length ?? 0, height: grid.length } as MapState,
    terrainGrid: grid,
  } as never);
}

describe('MapRenderer integration', () => {
  it('passes the tile resource into the base texture draw', () => {
    const renderer = new MapRenderer(32);
    const tm = createFakeTextureManager();
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const grid: TerrainRenderGrid = [
      [
        { type: 'ocean', resource: 'Fish', explored: true, visible: true },
        { type: 'ocean', resource: null, explored: true, visible: true },
      ],
    ];
    const { ctx } = createStubContext();
    renderBase(renderer, grid, ctx);

    expect(tm.drawTile).toHaveBeenCalledTimes(2);
    expect(tm.drawTile.mock.calls[0][9]).toBe('Fish'); // resource argument
    expect(tm.drawTile.mock.calls[1][9]).toBeNull();
  });

  it('lifts the composed resource picture above the feature pass', () => {
    const renderer = new MapRenderer(32);
    const tm = createFakeTextureManager(true);
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const grid: TerrainRenderGrid = [[
      { type: 'jungle', resource: 'Gems', explored: true, visible: true },
    ]];
    const { ctx } = createStubContext();
    renderBase(renderer, grid, ctx);

    expect(tm.drawResourceTile).toHaveBeenCalledTimes(1);
    expect(tm.drawResourceTile.mock.calls[0][1]).toBe('jungle');
    expect(tm.drawResourceTile.mock.calls[0][2]).toBe('Gems');
  });

  it('draws villages and improvements in the static terrain pass', () => {
    const renderer = new MapRenderer(32);
    const tm = createFakeTextureManager(true);
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const texts: string[] = [];
    const ctx = {
      fillText: (text: string) => texts.push(text),
      clearRect: () => {},
      save: () => {}, restore: () => {},
    } as unknown as CanvasRenderingContext2D;

    const grid: TerrainRenderGrid = [[
      { type: 'grassland', village: true, explored: true, visible: true },
      { type: 'plains', improvement: 'road', hasRoad: true, explored: true, visible: true },
    ]];
    renderBase(renderer, grid, ctx);

    expect(texts).toContain('🛖');
    expect(texts).toContain('R');
  });

  it('draws the glyph fallback in the static pass only without a composed tile', () => {
    const renderer = new MapRenderer(32);
    // Fish has a composed tile ready, Gold does not (e.g. generator not run).
    const tm = createFakeTextureManager((_terrain, resource) => resource === 'Fish');
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const glyphs: string[] = [];
    const ctx = {
      fillText: (text: string) => glyphs.push(text),
      clearRect: () => {},
      save: () => {}, restore: () => {},
    } as unknown as CanvasRenderingContext2D;

    const grid: TerrainRenderGrid = [[
      { type: 'ocean', resource: 'Fish', explored: true, visible: true },
      { type: 'mountains', resource: 'Gold', explored: true, visible: true },
    ]];
    renderBase(renderer, grid, ctx);

    // The fish "F" fallback is suppressed, the gold bag glyph is drawn.
    expect(glyphs).toContain('💰');
    expect(glyphs).not.toContain('F');
    expect(tm.drawResourceTile).toHaveBeenCalledTimes(2);
  });
});
