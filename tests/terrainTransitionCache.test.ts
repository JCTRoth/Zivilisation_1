/**
 * Terrain edge/corner transitions are cached.
 *
 * The whole-map terrain pass draws a gradient-masked neighbour texture at every
 * tile edge and corner. The mask depends only on the direction/corner, the fade
 * distance and the tile size — never on which texture is masked — so building
 * one per call meant, on the 96x60 archipelago:
 *
 *   2766 edge transitions + 5526 corner transitions = 8292 gradients, composites
 *   and clips per pass, and the pass ran ~9x during one map load. A CDP profile
 *   of the tropical map showed 79,417 clip() calls, 33,235 linear and 52,637
 *   radial gradients, with the five longest stalls (500-750ms each) all inside
 *   this code.
 *
 * These tests lock in that repeated transitions over the same map cost no extra
 * gradient work, that distinct neighbours/directions still get their own mask,
 * and that corner transitions are skipped entirely when the current tile wins.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainTextureManager } from '@/game/rendering/TerrainTextureManager';

interface StubCtx {
  gradients: number;
  drawImage: number;
  clip: number;
}

let counters: StubCtx;
let createdCanvases: number;

/** Every offscreen canvas the manager makes reports this shared stub context. */
function stubContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 64, height: 64 },
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    imageSmoothingEnabled: true,
    clearRect: () => {},
    drawImage: () => { counters.drawImage++; },
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    clip: () => { counters.clip++; },
    beginPath: () => {},
    rect: () => {},
    createLinearGradient: () => { counters.gradients++; return gradient(); },
    createRadialGradient: () => { counters.gradients++; return gradient(); },
  } as unknown as CanvasRenderingContext2D;
}

function gradient() {
  return { addColorStop: () => {} } as unknown as CanvasGradient;
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  _src = '';
  get src() { return this._src; }
  set src(value: string) {
    this._src = value;
    const name = value.split('/').pop()?.split(/[?#]/)[0] ?? '';
    // Every terrain texture decodes; only the optional fish variants 404.
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    this.complete = true;
    queueMicrotask(() => {
      if (/_\d+\.png$/.test(name) && !/terrain_(ocean|river|plains)_/.test(name)) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
}

async function readyManager(): Promise<TerrainTextureManager> {
  const manager = new TerrainTextureManager();
  await manager.ready;
  return manager;
}

const TILE = 64;

beforeEach(() => {
  counters = { gradients: 0, drawImage: 0, clip: 0 };
  createdCanvases = 0;
  (globalThis as unknown as { Image: unknown }).Image = StubImage;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      createdCanvases++;
      return { width: 0, height: 0, getContext: () => stubContext() };
    },
  };
});

describe('terrain transition caching', () => {
  it('builds one mask per edge, not one per tile edge drawn', async () => {
    const tm = await readyManager();
    const ctx = stubContext();

    // 500 grass tiles each bleeding into an ocean neighbour on the north edge:
    // the same texture, direction and fade every time.
    tm.drawTextureTransition(ctx, 'OCEAN', 0, 0, TILE, 'N', 1);
    const afterFirst = counters.gradients;
    expect(afterFirst).toBe(1);

    for (let i = 1; i < 500; i++) {
      tm.drawTextureTransition(ctx, 'OCEAN', i * TILE, 0, TILE, 'N', 1);
    }

    // One mask, reused 500 times: still a single gradient.
    expect(counters.gradients).toBe(afterFirst);
    // ...and each draw is a single plain blit: no clip, no composite.
    expect(counters.clip).toBe(0);
    expect(counters.drawImage).toBeGreaterThanOrEqual(500);
  });

  it('still separates masks per direction and per neighbour', async () => {
    const tm = await readyManager();
    const ctx = stubContext();

    tm.drawTextureTransition(ctx, 'OCEAN', 0, 0, TILE, 'N', 1);
    tm.drawTextureTransition(ctx, 'OCEAN', 0, 0, TILE, 'S', 1);
    tm.drawTextureTransition(ctx, 'MOUNTAINS', 0, 0, TILE, 'N', 1);
    expect(counters.gradients).toBe(3);

    // A different priority difference means a different fade distance.
    tm.drawTextureTransition(ctx, 'OCEAN', 0, 0, TILE, 'N', 4);
    expect(counters.gradients).toBe(4);

    // Re-drawing an existing combination adds nothing.
    tm.drawTextureTransition(ctx, 'OCEAN', 0, 0, TILE, 'N', 1);
    tm.drawTextureTransition(ctx, 'MOUNTAINS', 0, 0, TILE, 'N', 1);
    expect(counters.gradients).toBe(4);
  });

  it('builds one mask per corner combination', async () => {
    const tm = await readyManager();
    const ctx = stubContext();

    // Only a HIGHER-priority neighbour produces a transition: mountains (7)
    // beats grassland (1), ocean (0) does not.
    tm.drawCornerTransition4(ctx, 0, 0, TILE, 'NW', 'GRASSLAND', 'MOUNTAINS', null, null);
    const afterFirst = counters.gradients;
    expect(afterFirst).toBe(1);

    for (let i = 1; i < 2000; i++) {
      tm.drawCornerTransition4(ctx, 0, 0, TILE, 'NW', 'GRASSLAND', 'MOUNTAINS', null, null);
    }
    expect(counters.gradients).toBe(afterFirst);
    expect(counters.clip).toBe(0);

    // A different corner needs its own mask (the gradient is anchored there).
    tm.drawCornerTransition4(ctx, 0, 0, TILE, 'SE', 'GRASSLAND', 'MOUNTAINS', null, null);
    expect(counters.gradients).toBe(afterFirst + 1);

    // A lower-priority neighbour draws nothing at all.
    const before = counters.gradients;
    // Ocean (0) and forest (1, equal) never outrank grassland (1).
    tm.drawCornerTransition4(ctx, 0, 0, TILE, 'NW', 'GRASSLAND', 'OCEAN', 'FOREST', null);
    expect(counters.gradients).toBe(before);
  });

  it('draws nothing at all when the current tile outranks its neighbours', async () => {
    const tm = await readyManager();
    const ctx = stubContext();

    // Mountains (7) beat ocean (0) and grass (1): the current tile wins.
    for (let i = 0; i < 5000; i++) {
      tm.drawCornerTransition4(ctx, 0, 0, TILE, 'NW', 'MOUNTAINS', 'OCEAN', 'GRASSLAND', null);
    }

    // No mask built and nothing blitted — this is the common case (23036 corner
    // calls per whole-map pass on the 96x60 map, most of them no-ops).
    expect(counters.gradients).toBe(0);
    expect(counters.drawImage).toBe(0);
  });

  it('does no mask work for a terrain with no texture', async () => {
    const tm = await readyManager();
    const ctx = stubContext();

    // Unknown terrain: no texture, no blend colour. Must not throw and must not
    // build a mask.
    expect(() => tm.drawTextureTransition(ctx, 'MARSH', 0, 0, TILE, 'N', 1)).not.toThrow();
    expect(counters.gradients).toBe(0);
  });
});