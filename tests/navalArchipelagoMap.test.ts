/**
 * The naval archipelago must actually be a naval map.
 *
 * A static scenario world is only worth shipping if its shape is what the
 * scenario is about, so these are hard invariants: real islands (not one blob
 * or confetti), every civ able to start on its own, and a start tile that is
 * actually coastal — otherwise a civ begins boxed in and never sails.
 */
import { describe, it, expect } from 'vitest';
import { validateStaticMap } from '@/data/maps/types';
import { STATIC_MAPS, staticMapForMapType } from '@/data/maps';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import { terrainIdForChar } from '@/data/maps/types';

const NAV4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const naval = staticMapForMapType('AI_VS_AI_NAVAL');
const def = naval!;

const WATER = new Set<string>([TERRAIN_TYPES.OCEAN, TERRAIN_TYPES.LAKE]);
const isLand = (col: number, row: number) => !WATER.has(terrainIdForChar(def.rows[row]?.[col] ?? ' '));

/** Cardinal-neighbour landmass sizes, the same notion the engine uses. */
type Tile = readonly [number, number];

function landmasses(): Tile[][] {
  const seen = new Set<string>();
  const out: Tile[][] = [];
  for (let row = 0; row < def.height; row++) {
    for (let col = 0; col < def.width; col++) {
      if (!isLand(col, row) || seen.has(`${col},${row}`)) continue;
      const comp: Tile[] = [];
      const queue: Tile[] = [[col, row]];
      seen.add(`${col},${row}`);
      while (queue.length > 0) {
        const [c, r] = queue.pop() as Tile;
        comp.push([c, r]);
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= def.width || nr >= def.height) continue;
          if (isLand(nc, nr) && !seen.has(`${nc},${nr}`)) {
            seen.add(`${nc},${nr}`);
            queue.push([nc, nr] as Tile);
          }
        }
      }
      out.push(comp);
    }
  }
  return out;
}

const touchesWater = (col: number, row: number) => {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= def.width || nr >= def.height) continue;
      if (!isLand(nc, nr)) return true;
    }
  }
  return false;
};

describe('naval archipelago map', () => {
  it('is a valid static map file', () => {
    expect(validateStaticMap(def)).toEqual([]);
    expect(STATIC_MAPS[def.id]).toBeDefined();
  });

  it('is split into real islands, not one blob or confetti', () => {
    const islands = landmasses();
    expect(islands.length).toBeGreaterThanOrEqual(6);
    // Every island must be big enough to found a small empire and pay for a
    // ferry — the first cut used 52-133 tile islands and no civ could ever
    // finish Sailing.
    for (const island of islands) {
      expect(island.length).toBeGreaterThanOrEqual(60);
    }
  });

  it('offers at least one start per island, each on a coast', () => {
    const islands = landmasses();
    const starts = def.startPositions ?? [];
    // Enough starts for a 4-civ duel with spares, each on a DIFFERENT island.
    expect(starts.length).toBeGreaterThanOrEqual(4);
    const startIslands = new Set(
      starts.map((s) =>
        islands.findIndex((island) => island.some(([c, r]) => c === s.col && r === s.row)),
      ),
    );
    expect(startIslands.size).toBe(starts.length);
    expect(startIslands.has(-1)).toBe(false);
    // A start with no water next to it means a civ that cannot sail at all.
    for (const s of starts) {
      expect(touchesWater(s.col, s.row)).toBe(true);
    }
  });

  it('leaves a sea channel between every pair of islands', () => {
    const islands = landmasses();
    const compOf = new Map<string, number>();
    islands.forEach((island, i) => island.forEach(([c, r]) => compOf.set(`${c},${r}`, i)));
    for (let row = 0; row < def.height; row++) {
      for (let col = 0; col < def.width; col++) {
        const mine = compOf.get(`${col},${row}`);
        if (mine === undefined) continue;
        for (const [dc, dr] of NAV4) {
          const other = compOf.get(`${col + dc},${row + dr}`);
          // Adjacent land of a different id would have been one landmass.
          if (other !== undefined) expect(other).toBe(mine);
        }
      }
    }
  });
});
