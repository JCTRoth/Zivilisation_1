/**
 * Pre-rendered feature-on-tile textures — the composed PNGs produced by
 * tools/tile-generator/compose_feature_tiles.mjs are drawn as the terrain base
 * for tiles that carry the matching resource, replacing the old per-frame SVG
 * overlay. These tests lock in:
 *
 *  - every mapped composed tile exists in public/assets/tiles,
 *  - loading them never gates the terrain boot (`ready`), only the separate
 *    `resourceTilesReady`,
 *  - `getTileTexture` picks the composed variant for a resource tile and the
 *    plain terrain texture otherwise,
 *  - MapRenderer passes the tile's resource to `drawTile` and only falls back
 *    to a Civ1 glyph when no composed tile exists for the pairing.
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
  'terrain_forest.png',
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
  it('ships a composed PNG for every mapped tile', () => {
    expect(Object.keys(RESOURCE_TILE_FILES).sort()).toEqual(['OCEAN.FISH', 'PLAINS.HORSES', 'RIVER.FISH']);
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
  hasResourceTile: (terrain: string, resource: string | null) => boolean;
}

function createFakeTextureManager(
  hasTile: boolean | ((terrain: string, resource: string | null) => boolean) = false,
): FakeTextureManager {
  return {
    isReady: true,
    drawTile: vi.fn(),
    drawFeature: vi.fn(),
    drawTextureTransition: vi.fn(),
    drawCornerTransition4: vi.fn(),
    drawRiver: vi.fn(),
    getPriority: vi.fn(() => 0),
    hasResourceTile: (terrain, resource) =>
      typeof hasTile === 'function' ? hasTile(terrain, resource) : hasTile,
  };
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
    renderer.renderTerrainBase({
      offscreenCanvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
      map: { width: 2, height: 1 } as MapState,
      terrainGrid: grid,
    } as never);

    expect(tm.drawTile).toHaveBeenCalledTimes(2);
    expect(tm.drawTile.mock.calls[0][9]).toBe('Fish'); // resource argument
    expect(tm.drawTile.mock.calls[1][9]).toBeNull();
  });

  it('draws a glyph only for resources without a composed tile', () => {
    const renderer = new MapRenderer(32);
    const withTiles = createFakeTextureManager(
      (terrain, resource) =>
        RESOURCE_TILE_FILES[`${terrain.toUpperCase()}.${String(resource).toUpperCase()}`] !== undefined,
    );
    renderer.textureManager = withTiles as unknown as TerrainTextureManager;

    const ctx = {
      fillText: (text: string) => glyphs.push(text),
      save: () => {}, restore: () => {},
    } as unknown as CanvasRenderingContext2D;
    const glyphs: string[] = [];

    const draw = (resource: string) => (
      renderer as unknown as {
        drawTerrainSymbol: (
          ctx: CanvasRenderingContext2D, x: number, y: number,
          tile: Record<string, unknown>, options: Record<string, unknown>,
        ) => void;
      }
    ).drawTerrainSymbol(ctx, 100, 100, { type: 'ocean', resource, explored: true }, {
      drawBase: false, drawRivers: false, zoom: 2, dynamicOverlays: true,
    });

    draw('Fish'); // composed tile exists → no glyph
    expect(glyphs).toEqual([]);

    // No composed tile for Gold → the Civ1 glyph is drawn.
    draw('Gold');
    expect(glyphs).toEqual(['💰']);
  });
});
