/**
 * Partial base-layer repaints must touch only the requested tile window.
 *
 * The cached terrain base is painted once and then kept current with partial
 * repaints, so a repaint that reached outside its window would smear the wrong
 * tiles into the map, and one that reached too little would leave stale pixels
 * behind. These tests pin the window down on the drawing coordinates: a region
 * repaint must write only inside its region, and must cover all of it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MapRenderer } from '@/game/rendering/MapRenderer';

const W = 12;
const H = 10;

interface Write {
  op: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Records every drawing call that writes pixels. */
function recordingCanvas(writes: Write[], width = 0, height = 0): HTMLCanvasElement {
  const ctx = new Proxy(
    {
      canvas: null as unknown,
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      lineWidth: 1,
      fillStyle: '#000',
      strokeStyle: '#000',
      font: '10px sans-serif',
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillText: () => {},
      strokeText: () => {},
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      drawImage: (_img: unknown, x: number, y: number, w = 1, h = 1) => {
        writes.push({ op: 'drawImage', x, y, w, h });
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        writes.push({ op: 'fillRect', x, y, w, h });
      },
      clearRect: (x: number, y: number, w: number, h: number) => {
        writes.push({ op: 'clearRect', x, y, w, h });
      },
    },
    {
      get(target, prop: string) {
        if (prop === 'canvas') return canvas;
        return (target as Record<string, unknown>)[prop];
      },
    },
  );

  const canvas = {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return canvas;
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 64;
  complete = true;
  private _src = '';
  get src(): string { return this._src; }
  set src(value: string) {
    this._src = value;
    const name = value.split('/').pop() ?? '';
    // Only primary textures decode; numbered variants 404.
    this.complete = !/_\d+\.png$/.test(name);
    queueMicrotask(() => (this.complete ? this.onload?.() : this.onerror?.()));
  }
}

function makeGrid(): never {
  const grid = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const sum = r + c;
      row.push({
        type: sum % 4 === 0 ? 'ocean' : sum % 3 === 0 ? 'forest' : 'grassland',
        resource: sum % 13 === 0 ? 'fish' : null,
        improvement: sum % 9 === 0 ? 'mine' : null,
        visible: true,
        explored: true,
        hasRoad: sum % 7 === 0,
        hasRiver: (r * c) % 5 === 0,
        village: sum % 11 === 0,
      });
    }
    grid.push(row);
  }
  return grid as never;
}

const map = { width: W, height: H, tiles: new Array(W * H) } as never;

beforeEach(() => {
  (globalThis as unknown as { Image: unknown }).Image = StubImage;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
});

function tileSize(renderer: MapRenderer): number {
  return (renderer as unknown as { tileSize: number }).tileSize * 2;
}

/**
 * A renderer plus a canvas already sized for the map. A region repaint only
 * runs on an already-correct canvas (a resize means every pixel must be laid
 * down again), so the canvas has to start out the right size.
 */
function sizedRendererAndCanvas(): { renderer: MapRenderer; canvas: HTMLCanvasElement; writes: Write[] } {
  const renderer = new MapRenderer();
  renderer.textureManager = null;
  const tile = tileSize(renderer);
  const writes: Write[] = [];
  const canvas = recordingCanvas(writes, W * tile, H * tile);
  return { renderer, canvas, writes };
}

describe('renderTerrainBase region repaint', () => {
  it('writes only inside a padded window (features bleed one tile)', () => {
    const { renderer, canvas, writes } = sizedRendererAndCanvas();
    // Feature sprites are drawn from a canvas wider than one tile, so a window
    // can legitimately spill one tile over. Callers pass a 3x3 neighbourhood for
    // exactly this reason; the spill must stay within that padding.
    const region = { startRow: 2, endRow: 7, startCol: 3, endCol: 9 };

    renderer.renderTerrainBase({
      offscreenCanvas: canvas,
      map,
      terrainGrid: makeGrid(),
      region,
    });

    const tile = tileSize(renderer);
    const x0 = region.startCol * tile;
    const y0 = region.startRow * tile;
    const x1 = region.endCol * tile;
    const y1 = region.endRow * tile;

    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.x, `${w.op} x`).toBeGreaterThanOrEqual(x0);
      expect(w.y, `${w.op} y`).toBeGreaterThanOrEqual(y0);
      expect(w.x + w.w, `${w.op} right edge`).toBeLessThanOrEqual(x1);
      expect(w.y + w.h, `${w.op} bottom edge`).toBeLessThanOrEqual(y1);
    }
  });

  it('covers every tile of the window at least once', () => {
    const { renderer, canvas, writes } = sizedRendererAndCanvas();
    const region = { startRow: 3, endRow: 6, startCol: 4, endCol: 8 };

    renderer.renderTerrainBase({
      offscreenCanvas: canvas,
      map,
      terrainGrid: makeGrid(),
      region,
    });

    const tile = tileSize(renderer);
    const painted = new Set<string>();
    for (const w of writes) {
      // Which tile columns/rows does this write overlap?
      for (let c = Math.floor(w.x / tile); c < Math.ceil((w.x + w.w) / tile); c++) {
        for (let r = Math.floor(w.y / tile); r < Math.ceil((w.y + w.h) / tile); r++) {
          painted.add(`${r},${c}`);
        }
      }
    }
    for (let r = region.startRow; r < region.endRow; r++) {
      for (let c = region.startCol; c < region.endCol; c++) {
        expect(painted.has(`${r},${c}`), `tile ${r},${c} was painted`).toBe(true);
      }
    }
  });

  it('does far less drawing than a full repaint', () => {
    const count = (region?: { startRow: number; endRow: number; startCol: number; endCol: number }) => {
      const { renderer, canvas, writes } = sizedRendererAndCanvas();
      renderer.renderTerrainBase({
        offscreenCanvas: canvas, map, terrainGrid: makeGrid(), region,
      });
      return writes.length;
    };

    const full = count();
    // The 3x3 window a caller uses for one changed tile on this 120-tile map.
    const part = count({ startRow: 4, endRow: 7, startCol: 4, endCol: 7 });

    expect(part).toBeLessThan(full / 4);
  });

  it('repaints the whole map when no region is given', () => {
    const { renderer, canvas, writes } = sizedRendererAndCanvas();
    renderer.renderTerrainBase({
      offscreenCanvas: canvas,
      map,
      terrainGrid: makeGrid(),
    });

    const tile = tileSize(renderer);
    const corners = [
      `${0},${0}`,
      `${0},${W - 1}`,
      `${H - 1},${0}`,
      `${H - 1},${W - 1}`,
    ];
    for (const corner of corners) {
      const [r, c] = corner.split(',').map(Number);
      const hit = writes.some((w) =>
        w.x < (c + 1) * tile && w.x + w.w > c * tile &&
        w.y < (r + 1) * tile && w.y + w.h > r * tile,
      );
      expect(hit, `corner tile ${corner} painted`).toBe(true);
    }
  });
});