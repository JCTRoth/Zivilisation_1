/**
 * Resource artwork (SVG) — the vector sprites (fish, horses) are loaded by the
 * same TerrainTextureManager feature pipeline as terrain features and baked
 * into the cached 2×-resolution terrain base. These tests lock in:
 *
 *  - every mapped resource sprite exists in src/assets/resources,
 *  - variants are picked per tile (stable, no flicker) and names are
 *    case-insensitive,
 *  - drawResource keeps the sprite inside its tile and reports "no artwork" so
 *    MapRenderer can fall back to the Civ1 glyph,
 *  - renderTerrainBase paints resources in the static pass (explored tiles
 *    only), which is what keeps them off the per-frame CPU/GPU budget.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  MapRenderer,
  type TerrainLayerParams,
  type TerrainRenderGrid,
} from '@/game/rendering/MapRenderer';
import {
  RESOURCE_TEXTURE_URLS,
  TerrainTextureManager,
} from '@/game/rendering/TerrainTextureManager';
import type { MapState } from '../types/game';

/** Vite emits a URL for `new URL(...)`; resolve it back to a file path. */
function assetFilePath(url: string): string {
  if (url.startsWith('file:')) return fileURLToPath(url);
  const path = url.split(/[?#]/)[0];
  return join(process.cwd(), path.startsWith('/') ? path.slice(1) : path);
}

/** URL filename → natural size used by the Image stub. */
let imageSizes: Record<string, [number, number]> = {};

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
    const size = imageSizes[name];
    if (!size) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    this.naturalWidth = size[0];
    this.naturalHeight = size[1];
    this.complete = true;
    queueMicrotask(() => this.onload?.());
  }
}

/** Natural sizes of the cropped SVG artwork. */
const REAL_RESOURCE_SIZES: Record<string, [number, number]> = {
  'fish.svg': [390, 274],
  'horses.svg': [449, 441],
  'horses_2.svg': [414, 344],
};

function useImageStub(sizes: Record<string, [number, number]>): void {
  imageSizes = sizes;
  (globalThis as unknown as { Image: unknown }).Image = StubImage;
}

interface DrawCalls {
  drawImage: Array<{ x: number; y: number; w: number; h: number }>;
  fillText: string[];
}

function createStubContext(): { ctx: CanvasRenderingContext2D; calls: DrawCalls } {
  const calls: DrawCalls = { drawImage: [], fillText: [] };
  const ctx = {
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      calls.drawImage.push({ x, y, w, h });
    },
    fillText: (text: string) => {
      calls.fillText.push(text);
    },
    clearRect: () => {},
    fillRect: () => {},
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** Loaded manager backed by the real SVG file names. */
async function loadedManager(): Promise<TerrainTextureManager> {
  const manager = new TerrainTextureManager();
  await manager.ready;
  return manager;
}

beforeEach(() => {
  useImageStub(REAL_RESOURCE_SIZES);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resource artwork', () => {
  it('ships an SVG for every mapped resource', () => {
    expect(Object.keys(RESOURCE_TEXTURE_URLS).sort()).toEqual(['FISH', 'HORSES']);
    for (const [key, urls] of Object.entries(RESOURCE_TEXTURE_URLS)) {
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(existsSync(assetFilePath(url)), `${key} → ${url}`).toBe(true);
        expect(assetFilePath(url)).toMatch(/\.svg$/);
      }
    }
    // Horses ships a second pose.
    expect(RESOURCE_TEXTURE_URLS.HORSES).toHaveLength(2);
  });

  it('looks resources up case-insensitively and only when artwork exists', async () => {
    const tm = await loadedManager();
    expect(tm.getResourceTexture('Fish')).not.toBeNull();
    expect(tm.getResourceTexture('HORSES')).not.toBeNull();
    expect(tm.getResourceTexture('horses')).not.toBeNull();
    // No artwork for the other special resources — glyph fallback stays.
    expect(tm.getResourceTexture('Gold')).toBeNull();
    expect(tm.getResourceTexture('seal')).toBeNull();
    expect(tm.getResourceTexture(null)).toBeNull();
  });

  it('picks the same variant for a tile every time and spreads neighbouring tiles', async () => {
    const tm = await loadedManager();
    const poses = new Set<string>();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const first = tm.getResourceTexture('Horses', col, row);
        const again = tm.getResourceTexture('Horses', col, row);
        expect(first).not.toBeNull();
        // Same tile, same picture — no flicker between renders.
        expect(again).toBe(first);
        expect(first!.src).toMatch(/(horses|horses_2)\.svg$/);
        poses.add(first!.src);
      }
    }
    // Both horse poses appear on a 4×4 patch.
    expect(poses.size).toBe(2);
  });

  it('fits the sprite inside the tile, preserving its aspect ratio', async () => {
    // A wide variant proves the box fit, not just the near-square case.
    useImageStub({ ...REAL_RESOURCE_SIZES, 'horses_2.svg': [512, 256] });
    const tm = await loadedManager();
    const { ctx, calls } = createStubContext();

    // Variant index (col*7 + row*13) % 2: (0,1) selects the second pose.
    expect(tm.drawResource(ctx, 'Horses', 0, 0, 50, 0, 1)).toBe(true);
    const wide = calls.drawImage[0];
    expect(wide.w / wide.h).toBeCloseTo(2, 5);
    // 80 % box of a 50px tile, centred and fully inside.
    expect(wide.w).toBeCloseTo(40, 5);
    expect(wide.h).toBeCloseTo(20, 5);
    expect(wide.x).toBeGreaterThanOrEqual(0);
    expect(wide.y).toBeGreaterThanOrEqual(0);
    expect(wide.x + wide.w).toBeLessThanOrEqual(50);
    expect(wide.y + wide.h).toBeLessThanOrEqual(50);

    // Real fish is 390×274; its aspect ratio survives the tile fit.
    expect(tm.drawResource(ctx, 'Fish', 100, 200, 50, 0, 0)).toBe(true);
    const fish = calls.drawImage[1];
    expect(fish.w).toBeCloseTo(40, 5);
    expect(fish.h).toBeCloseTo(40 * (274 / 390), 5);
    expect(fish.x).toBeCloseTo(100 + (50 - fish.w) / 2, 5);
    expect(fish.y).toBeCloseTo(200 + (50 - fish.h) / 2, 5);
    expect(fish.x + fish.w).toBeLessThanOrEqual(150);
    expect(fish.y + fish.h).toBeLessThanOrEqual(250);

    // Unknown resource → caller keeps the glyph.
    expect(tm.drawResource(ctx, 'Gold', 0, 0, 50)).toBe(false);
  });

  it('reports "not ready" instead of drawing a half-loaded sprite', async () => {
    useImageStub({});
    const tm = new TerrainTextureManager(); // loads never settle
    const { ctx, calls } = createStubContext();
    expect(tm.getResourceTexture('Fish')).toBeNull();
    expect(tm.drawResource(ctx, 'Fish', 0, 0, 32)).toBe(false);
    expect(calls.drawImage).toEqual([]);
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
  drawResource: ReturnType<typeof vi.fn>;
}

function createFakeTextureManager(): FakeTextureManager {
  return {
    isReady: true,
    drawTile: vi.fn(),
    drawFeature: vi.fn(),
    drawTextureTransition: vi.fn(),
    drawCornerTransition4: vi.fn(),
    drawRiver: vi.fn(),
    getPriority: vi.fn(() => 0),
    drawResource: vi.fn(() => true),
  };
}

function renderBase(
  renderer: MapRenderer,
  grid: TerrainRenderGrid,
  width: number,
  height: number,
): DrawCalls {
  const { ctx, calls } = createStubContext();
  const offscreenCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  renderer.renderTerrainBase({
    offscreenCanvas,
    map: { width, height } as MapState,
    terrainGrid: grid,
  } satisfies TerrainLayerParams);
  return calls;
}

describe('static terrain pass', () => {
  it('bakes each explored resource into the base layer exactly once', () => {
    const renderer = new MapRenderer(32);
    const tm = createFakeTextureManager();
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const grid: TerrainRenderGrid = [
      [
        { type: 'ocean', resource: 'Fish', explored: true, visible: true },
        { type: 'plains', resource: 'Horses', explored: true, visible: true },
      ],
      [
        { type: 'ocean', resource: null, explored: true, visible: true },
        // Never revealed — the resource must stay hidden.
        { type: 'ocean', resource: 'Fish', explored: false, visible: false },
      ],
    ];

    renderBase(renderer, grid, 2, 2);

    // One call per explored resource, at the 2× tile resolution (64px tiles).
    expect(tm.drawResource).toHaveBeenCalledTimes(2);
    expect(tm.drawResource).toHaveBeenCalledWith(expect.anything(), 'fish', 0, 0, 64, 0, 0);
    expect(tm.drawResource).toHaveBeenCalledWith(expect.anything(), 'horses', 64, 0, 64, 1, 0);
  });

  it('draws the Civ1 glyph when a resource has no artwork', () => {
    const renderer = new MapRenderer(32);
    const tm = createFakeTextureManager();
    tm.drawResource = vi.fn(() => false);
    renderer.textureManager = tm as unknown as TerrainTextureManager;

    const grid: TerrainRenderGrid = [
      [{ type: 'forest', resource: 'Game', explored: true, visible: true }],
    ];

    const calls = renderBase(renderer, grid, 1, 1);
    expect(calls.fillText).toEqual(['🦌']);
  });
});
