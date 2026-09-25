/**
 * A computer-vs-computer map must be one landmass.
 *
 * `landMass: 1` (Standard) draws up to one horizontal and one vertical strait.
 * On a 40x40 map one strait is enough to cut a continent in half, and the two
 * halves then never meet: a 465-round AI-vs-AI run had the Huns on a 341-tile
 * island and everyone else on a 1101-tile mainland — 17 wars, 3 attacks, and a
 * game nobody could win. With no human there is nobody to build a boat.
 */
import { describe, it, expect } from 'vitest';
import MapGenerator from '@/game/engine/MapGenerator/MapGenerator';

const WATER = new Set(['ocean', 'lake', 'coast', 'sea']);

/** Cardinal-neighbour landmass sizes. */
type GeneratedTile = { col: number; row: number; type?: string; terrain?: string };

function landmasses(tiles: GeneratedTile[]): number[] {
  const w = Math.max(...tiles.map((t) => t.col)) + 1;
  const grid = new Map<number, boolean>();
  for (const t of tiles) {
    const key = t.row * w + t.col;
    grid.set(key, !WATER.has(String(t.type ?? t.terrain ?? '').toLowerCase()));
  }
  const seen = new Set<number>();
  const sizes: number[] = [];
  for (const [start, isLand] of grid) {
    if (!isLand || seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cur = queue.pop()!;
      size++;
      const col = cur % w;
      const row = Math.floor(cur / w);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0) continue;
        const key = nr * w + nc;
        if (grid.get(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

describe('MapGenerator single-landmass guarantee', () => {
  it('produces one landmass for every seed when requireSingleLandmass is set', () => {
    // The failing map came from Standard (landMass 1) on 40x40.
    for (let seed = 1; seed <= 12; seed++) {
      const tiles = new MapGenerator({
        mapWidth: 40,
        mapHeight: 40,
        seed,
        landMass: 1,
        requireSingleLandmass: true,
      }).generate();
      const sizes = landmasses(tiles);
      expect(
        sizes.length,
        `seed ${seed} produced ${sizes.length} landmasses (sizes ${sizes.join('/')})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('still splits the world when the guarantee is not requested', () => {
    // Sanity check that the repair is not silently doing the generator's job
    // for every map: naval/sparse maps must keep their islands.
    let splitSomewhere = false;
    for (let seed = 1; seed <= 12 && !splitSomewhere; seed++) {
      const tiles = new MapGenerator({
        mapWidth: 40,
        mapHeight: 40,
        seed,
        landMass: 1,
      }).generate();
      if (landmasses(tiles).length > 1) splitSomewhere = true;
    }
    expect(splitSomewhere).toBe(true);
  });

  it('guarantees connectivity on the small corridor map too', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const tiles = new MapGenerator({
        mapWidth: 16,
        mapHeight: 26,
        seed,
        landMass: 1,
        requireSingleLandmass: true,
      }).generate();
      const sizes = landmasses(tiles);
      expect(sizes.length, `seed ${seed}: ${sizes.length} landmasses (${sizes.join('/')})`)
        .toBeLessThanOrEqual(1);
    }
  });
});
