/**
 * The naval archipelago must actually be a naval map.
 *
 * A static scenario world is only worth shipping if its shape is what the
 * scenario is about, so these are hard invariants: real islands (not one blob
 * or confetti), every civ able to start on its own, a start tile that is
 * actually coastal — otherwise a civ begins boxed in and never sails — and
 * small islets for the AI to colonise by sea, which is the whole point.
 */
import { describe, it, expect } from 'vitest';
import { validateStaticMap } from '@/data/maps/types';
import { STATIC_MAPS, staticMapForMapType } from '@/data/maps';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import { terrainIdForChar } from '@/data/maps/types';
import { SMALL_ISLAND_MAX_TILES } from '@/data/GameConstants';

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
    // Every HOME island must be big enough to found a small empire and pay for
    // a ferry — the first cut used 52-133 tile islands and no civ could ever
    // finish Sailing. Small islets are excluded here and covered below.
    const home = islands.filter((island) => island.length > SMALL_ISLAND_MAX_TILES);
    expect(home.length).toBeGreaterThanOrEqual(6);
    for (const island of home) {
      expect(island.length).toBeGreaterThanOrEqual(60);
    }
  });

  it('has small islets the AI can actually colonise by sea', () => {
    const islands = landmasses();
    const islets = islands.filter((island) => island.length <= SMALL_ISLAND_MAX_TILES);
    // Without these, getColonizableIslands() can never return anything and the
    // whole ferry-a-settler-to-an-island feature is unreachable dead code: a
    // 417-round game on the old map produced 0 colony missions.
    expect(islets.length).toBeGreaterThanOrEqual(4);
    for (const islet of islets) {
      // A colonisable islet needs a landing tile and a beach to unload from.
      expect(islet.some(([c, r]) => touchesWater(c, r))).toBe(true);
      // No mountains: a settler has to be able to found a city on it.
      expect(islet.some(([c, r]) => def.rows[r][c] === 'm')).toBe(false);
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
