/**
 * Resource artwork as a dynamic overlay — the SVGs (fish, horses ×2 poses) are
 * decoded in the background by ResourceIconLoader and drawn on top of the
 * terrain each render, exactly like units and emoji glyphs. Terrain boot never
 * waits for them. These tests lock in:
 *
 *  - every mapped resource ships an SVG in src/assets/resources,
 *  - lookups are case-insensitive, fail soft while loading, and pick a stable
 *    per-tile variant (no flicker, neighbours spread over the poses),
 *  - MapRenderer draws the SVG inside the tile once it is decoded and falls
 *    back to the Civ1 glyph until then,
 *  - the overlay is drawn without shadowBlur (the expensive canvas effect).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MapRenderer, type TerrainTileRenderInfo } from '@/game/rendering/MapRenderer';
import {
  RESOURCE_ICON_URLS,
  getResourceIcon,
  getResourceVariantCount,
  hasResourceArtwork,
  normalizeResourceKey,
  preloadResourceIcon,
} from '@/utils/ResourceIconLoader';

/** Vite emits a URL for `new URL(...)`; resolve it back to a file path. */
function assetFilePath(url: string): string {
  if (url.startsWith('file:')) return fileURLToPath(url);
  const path = url.split(/[?#]/)[0];
  return join(process.cwd(), path.startsWith('/') ? path.slice(1) : path);
}

interface DrawCalls {
  drawImage: Array<{ x: number; y: number; w: number; h: number }>;
  fillText: string[];
  shadowBlurUsed: boolean;
}

function createStubContext(): { ctx: CanvasRenderingContext2D; calls: DrawCalls } {
  const calls: DrawCalls = { drawImage: [], fillText: [], shadowBlurUsed: false };
  const ctx = {
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      calls.drawImage.push({ x, y, w, h });
    },
    fillText: (text: string) => {
      calls.fillText.push(text);
    },
    save: () => {},
    restore: () => {},
    get shadowBlur(): number {
      return 0;
    },
    set shadowBlur(_value: number) {
      calls.shadowBlurUsed = true;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function drawTile(resource: string | null, zoom = 2, seed = 0): DrawCalls {
  const renderer = new MapRenderer(32);
  const { ctx, calls } = createStubContext();
  const tile: TerrainTileRenderInfo = { type: 'ocean', resource, explored: true };
  // The symbol painter is internal; the test reaches it deliberately to assert
  // what lands on the tile (SVG artwork vs. fallback glyph).
  (
    renderer as unknown as {
      drawTerrainSymbol: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        tile: TerrainTileRenderInfo,
        options: Record<string, unknown>
      ) => void;
    }
  ).drawTerrainSymbol(ctx, 100, 100, tile, {
    drawBase: false,
    drawRivers: false,
    zoom,
    dynamicOverlays: true,
    variantSeed: seed,
  });
  return calls;
}

/** Natural sizes of the cropped SVG artwork. */
const REAL_SIZES: Record<string, [number, number]> = {
  'fish.svg': [390, 274],
  'horses.svg': [449, 441],
  'horses_2.svg': [414, 344],
};

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
    const size = REAL_SIZES[name];
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

beforeEach(() => {
  (globalThis as unknown as { Image: unknown }).Image = StubImage;
});

describe('resource artwork loader', () => {
  it('ships an SVG for every mapped resource', () => {
    expect(Object.keys(RESOURCE_ICON_URLS).sort()).toEqual(['fish', 'horses']);
    for (const [key, urls] of Object.entries(RESOURCE_ICON_URLS)) {
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(existsSync(assetFilePath(url)), `${key} → ${url}`).toBe(true);
        expect(assetFilePath(url)).toMatch(/\.svg$/);
      }
    }
    // Horses ships two poses.
    expect(getResourceVariantCount('Horses')).toBe(2);
  });

  it('normalizes names and reports artwork only for mapped resources', () => {
    expect(normalizeResourceKey('Fish')).toBe('fish');
    expect(normalizeResourceKey('  HORSES ')).toBe('horses');
    expect(normalizeResourceKey(null)).toBe('');
    expect(hasResourceArtwork('Fish')).toBe(true);
    expect(hasResourceArtwork('Gold')).toBe(false);
    expect(getResourceVariantCount('Gold')).toBe(0);
  });

  it('returns null while the artwork is still decoding', () => {
    // Nothing is preloaded yet in this file, so the map must draw glyphs.
    expect(getResourceIcon('Fish', 0)).toBeNull();
    expect(drawTile('Fish').fillText).toEqual(['F']);
    expect(drawTile('Gold').fillText).toEqual(['💰']);
  });

  it('decodes the SVGs and picks a stable variant per tile', async () => {
    await preloadResourceIcon('fish');
    await preloadResourceIcon('horses');

    expect(getResourceIcon('Fish', 0)).not.toBeNull();
    expect(getResourceIcon('HORSES', 0)).not.toBeNull();

    const poses = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const first = getResourceIcon('Horses', seed);
      expect(first).not.toBeNull();
      // Same tile, same category — no flicker between frames.
      expect(getResourceIcon('Horses', seed)).toBe(first);
      expect(first!.src).toMatch(/(horses|horses_2)\.svg$/);
      poses.add(first!.src);
    }
    expect(poses.size).toBe(2);
  });
});

describe('overlay drawing', () => {
  it('draws the SVG, not the glyph, once the artwork is decoded', () => {
    const calls = drawTile('Fish');
    expect(calls.fillText).toEqual([]);
    expect(calls.drawImage).toHaveLength(1);
  });

  it('keeps the sprite inside the tile, scales with zoom and never uses shadowBlur', () => {
    const zoomed = drawTile('Fish', 2).drawImage[0];
    const wide = drawTile('Fish', 4).drawImage[0];

    const halfTile = (32 * 2) / 2;
    expect(zoomed.x).toBeGreaterThanOrEqual(100 - halfTile - 0.001);
    expect(zoomed.y).toBeGreaterThanOrEqual(100 - halfTile - 0.001);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(100 + halfTile + 0.001);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(100 + halfTile + 0.001);
    // Aspect ratio of fish.svg (390×274) is preserved.
    expect(zoomed.w / zoomed.h).toBeCloseTo(390 / 274, 2);
    // Doubling the zoom doubles the sprite.
    expect(wide.w / zoomed.w).toBeCloseTo(2, 1);
    // The expensive canvas blur is never armed.
    expect(drawTile('Fish', 2).shadowBlurUsed).toBe(false);
  });

  it('uses the variant picked for the tile seed', () => {
    const first = drawTile('Horses', 2, 0).drawImage[0];
    const second = drawTile('Horses', 2, 1).drawImage[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The two poses have different aspect ratios (449/441 vs 414/344).
    expect(first.w / first.h).not.toBeCloseTo(second.w / second.h, 1);
  });

  it('falls back to the glyph for resources without artwork', () => {
    const calls = drawTile('Gold');
    expect(calls.drawImage).toEqual([]);
    expect(calls.fillText).toEqual(['💰']);
  });

  it('draws nothing extra when the tile has no resource', () => {
    const calls = drawTile(null);
    expect(calls.drawImage).toEqual([]);
    expect(calls.fillText).toEqual([]);
  });

  it('does not overlay resources in the cached terrain base pass', () => {
    const calls = drawTile('Fish');
    const renderer = new MapRenderer(32);
    const { ctx, calls: baseCalls } = createStubContext();
    (
      renderer as unknown as {
        drawTerrainSymbol: (
          ctx: CanvasRenderingContext2D,
          x: number,
          y: number,
          tile: TerrainTileRenderInfo,
          options: Record<string, unknown>
        ) => void;
      }
    ).drawTerrainSymbol(ctx, 100, 100, { type: 'ocean', resource: 'Fish', explored: true }, {
      drawBase: false,
      drawRivers: false,
      dynamicOverlays: false,
    });
    expect(calls.drawImage).toHaveLength(1); // sanity: artwork is loaded
    expect(baseCalls.drawImage).toEqual([]);
    expect(baseCalls.fillText).toEqual([]);
  });
});
