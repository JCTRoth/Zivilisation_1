/**
 * The Aegean Campaign must actually be a naval map.
 *
 * The scenario is the point: a human admiral on one shore, AI civs on the
 * rest, and no way to reach anybody except across water. These are hard
 * invariants, learned the hard way on the naval archipelago:
 *
 *   - one home island per civ, every one coastal (an AI that cannot reach
 *     water never fields a fleet and the whole naval game is dead);
 *   - home islands big enough to found an empire on;
 *   - a water channel between every pair of home islands, so two civs never
 *     share ground and never walk to each other;
 *   - small islets, or getColonizableIslands() returns nothing and the whole
 *     ferry-a-settler-to-a-rock feature is unreachable;
 *   - a "crown" island that is genuinely mountainous and genuinely rich, since
 *     that is the prize the scenario is supposed to fight over.
 */
import { describe, it, expect } from 'vitest';
import { validateStaticMap, terrainIdForChar } from '@/data/maps/types';
import { STATIC_MAPS, staticMapForMapType } from '@/data/maps';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import { SMALL_ISLAND_MAX_TILES } from '@/data/GameConstants';

/** Cardinal neighbours — the landmass notion the test suite pins. */
const NAV4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const def = staticMapForMapType('AEGEAN_CAMPAIGN');
const map = def!;

const WATER = new Set<string>([TERRAIN_TYPES.OCEAN, TERRAIN_TYPES.LAKE]);
const isLand = (col: number, row: number) => !WATER.has(terrainIdForChar(map.rows[row]?.[col] ?? ' '));

function landmasses(): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  const { width, height } = map;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!isLand(col, row) || seen.has(row * width + col)) continue;
      const comp: number[] = [];
      const queue = [[col, row]];
      seen.add(row * width + col);
      while (queue.length > 0) {
        const [c, r] = queue.pop()!;
        comp.push(r * width + c);
        for (const [dc, dr] of NAV4) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
          const k = nr * width + nc;
          if (seen.has(k) || !isLand(nc, nr)) continue;
          seen.add(k);
          queue.push([nc, nr]);
        }
      }
      out.push(comp);
    }
  }
  return out;
}

/** Which landmass a tile belongs to, indexed by `row * width + col`. */
function componentIndex(): Int32Array {
  const { width } = map;
  const ids = new Int32Array(width * map.height).fill(-1);
  landmasses().forEach((comp, i) => comp.forEach((k) => { ids[k] = i; }));
  return ids;
}

const touchesWater = (col: number, row: number) => {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= map.width || nr < 0 || nr >= map.height) continue;
      if (!isLand(nc, nr)) return true;
    }
  }
  return false;
};

const starts = map.startPositions ?? [];

describe('aegean campaign map', () => {
  it('is a valid static map file, registered under its map type', () => {
    expect(validateStaticMap(map)).toEqual([]);
    expect(STATIC_MAPS[map.id]).toBeDefined();
  });

  it('offers at least one start per civ, each on a different coastal island', () => {
    // Seven home islands: Thrace, the Greek mainland, Anatolia, Euboea, Crete,
    // the Dodecanese and the Crown of Naxos.
    expect(starts.length).toBeGreaterThanOrEqual(7);
    const ids = componentIndex();
    const startIslands = new Set(starts.map((s) => ids[s.row * map.width + s.col]));
    expect(startIslands.size).toBe(starts.length);
    expect(startIslands.has(-1)).toBe(false);
    for (const s of starts) {
      expect(touchesWater(s.col, s.row)).toBe(true);
    }
  });

  it('gives every civ a home island big enough to found an empire on', () => {
    const islands = landmasses();
    const home = starts.map((s) => islands[componentIndex()[s.row * map.width + s.col]]);
    for (const island of home) {
      expect(island.length).toBeGreaterThanOrEqual(110);
    }
  });

  it('leaves a sea channel between every pair of home islands', () => {
    const ids = componentIndex();
    for (const s of starts) {
      const mine = ids[s.row * map.width + s.col];
      for (const [dc, dr] of NAV4) {
        const nc = s.col + dc;
        const nr = s.row + dr;
        if (nc < 0 || nc >= map.width || nr < 0 || nr >= map.height) continue;
        const other = ids[nr * map.width + nc];
        if (other >= 0) expect(other).toBe(mine);
      }
    }
  });

  it('has small islets the AI can actually colonise by sea', () => {
    const islands = landmasses();
    const islets = islands.filter((island) => island.length <= SMALL_ISLAND_MAX_TILES);
    // Without these, getColonizableIslands() can never return anything and the
    // ferry-a-settler-to-an-island feature is unreachable dead code.
    expect(islets.length).toBeGreaterThanOrEqual(10);
    for (const islet of islets) {
      expect(islet.some((k) => touchesWater(k % map.width, Math.floor(k / map.width)))).toBe(true);
      // No mountains: a settler has to be able to found a city on it.
      expect(islet.some((k) => map.rows[Math.floor(k / map.width)][k % map.width] === 'm')).toBe(false);
    }
  });

  it('keeps the sea open at the map edge, so no land welds the rim into a ring', () => {
    for (let col = 0; col < map.width; col++) {
      expect(isLand(col, 0)).toBe(false);
      expect(isLand(col, map.height - 1)).toBe(false);
    }
    for (let row = 0; row < map.height; row++) {
      expect(isLand(0, row)).toBe(false);
      expect(isLand(map.width - 1, row)).toBe(false);
    }
  });

  it('has a "crown" island that is mountainous and resource-rich', () => {
    // The Crown of Naxos is the prize the whole campaign is about: the biggest
    // mountain core on the map, and bonus resources stamped on it.
    const islands = landmasses();
    const crown = islands
      .filter((island) => island.length > SMALL_ISLAND_MAX_TILES)
      .sort((a, b) => b.length - a.length)
      .map((island, i) => ({ island, i }))
      .find(({ island }) => island.some((k) => map.rows[Math.floor(k / map.width)][k % map.width] === 'm'));
    expect(crown).toBeDefined();
    const mountains = crown!.island.filter((k) => map.rows[Math.floor(k / map.width)][k % map.width] === 'm').length;
    const resources = crown!.island.filter((k) => (map.specials?.[Math.floor(k / map.width)]?.[k % map.width] ?? '0') !== '0').length;
    expect(mountains).toBeGreaterThanOrEqual(10);
    expect(resources).toBeGreaterThanOrEqual(20);
  });

  it('is sea, not land: the campaign is about crossing water', () => {
    let land = 0;
    for (const row of map.rows) land += row.split('').filter((c) => c !== ' ').length;
    const ratio = land / (map.width * map.height);
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.5);
  });

  it('is decorated with varied Mediterranean terrain, not one biome', () => {
    const counts: Record<string, number> = {};
    for (const row of map.rows) for (const ch of row) counts[ch] = (counts[ch] ?? 0) + 1;
    // Hills, mountains, forest, plains and desert all have to appear: a green
    // carpet with rocks on it is not the Aegean. The mountains stay rare on
    // purpose — they are the spine of the big islands and the core of the
    // crown, and a colonisable islet must never contain one.
    for (const ch of ['h', 'm', 'f', 'p', 'g']) {
      expect(counts[ch] ?? 0, `terrain '${ch}' is missing or too rare`).toBeGreaterThan(ch === 'm' ? 30 : 50);
    }
  });
});
