/**
 * Static maps (`src/data/maps`) — data integrity plus the loader used by the
 * "Earth" world map (`MapGenerator.generateEarth`).
 *
 * The world map is extracted from the Freeciv "Earth 180x90 v1.4" savegame by
 * `scripts/extract-freeciv-map.mjs`; the data file keeps the raw Freeciv
 * characters and the game translates them via `FREECIV_TERRAIN_LEGEND`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapGenerator from '@/game/engine/MapGenerator/MapGenerator';
import type { GenTile } from '@/game/engine/MapGenerator/MapGeneratorHelper';
import { TERRAIN_RESOURCES, TERRAIN_TYPES } from '@/data/TerrainConstants';
import {
  FREECIV_TERRAIN_LEGEND,
  STATIC_MAPS,
  WORLD_MAP,
  WORLD_MAP_ID,
  hasSpecialResource,
  terrainIdForChar,
  validateStaticMap,
} from '@/data/maps';

const EARTH_WIDTH = 180;
const EARTH_HEIGHT = 90;

/** MapGenerator steps that modify the layout AFTER it has been loaded. */
function disableWorldMapPostProcessing(): void {
  const proto = MapGenerator.prototype as unknown as Record<string, () => void>;
  vi.spyOn(proto, 'stage5_Rivers').mockImplementation(() => {});
  vi.spyOn(proto, 'fillIsolatedOceanHoles').mockImplementation(() => {});
}

let cachedWorldMap: GenTile[] | null = null;
/** Full pipeline output (rivers, groups, build sites included) — cached. */
function generatedWorldMap(): GenTile[] {
  if (!cachedWorldMap) {
    cachedWorldMap = new MapGenerator({
      mapWidth: EARTH_WIDTH,
      mapHeight: EARTH_HEIGHT,
      seed: 20260911,
    }).generateEarth();
  }
  return cachedWorldMap;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('static maps registry', () => {
  it('registers the extracted world map', () => {
    expect(WORLD_MAP_ID).toBe('earth-180x90');
    expect(WORLD_MAP).toBeDefined();
    expect(WORLD_MAP?.width).toBe(EARTH_WIDTH);
    expect(WORLD_MAP?.height).toBe(EARTH_HEIGHT);
  });

  it('every registered map is well-formed (size, legend, rows)', () => {
    for (const map of Object.values(STATIC_MAPS)) {
      expect(validateStaticMap(map)).toEqual([]);
    }
  });

  it('keeps the Freeciv source fingerprints (39.9% land, 342 specials)', () => {
    const chars = WORLD_MAP!.rows.join('');
    const land = [...chars].filter((ch) => ch !== ' ').length;
    const specials = [...(WORLD_MAP!.specials ?? []).join('')].filter((ch) => ch !== '0').length;
    expect(land).toBe(6471);
    expect(specials).toBe(342);
  });

  it('maps every Freeciv character to a game terrain', () => {
    const terrains = new Set(Object.values(FREECIV_TERRAIN_LEGEND));
    // Every terrain except river (rivers are added procedurally) must be
    // reachable from the Freeciv legend.
    for (const type of Object.values(TERRAIN_TYPES)) {
      if (type === TERRAIN_TYPES.RIVER) continue;
      expect(terrains.has(type), `no map character maps to '${type}'`).toBe(true);
    }
  });

  it('ships hand-placed start positions on habitable land', () => {
    const starts = WORLD_MAP!.startPositions ?? [];
    expect(starts.length).toBe(30);
    for (const { col, row } of starts) {
      const ch = WORLD_MAP!.rows[row]?.[col];
      // Ocean (' ') or arctic ('a') spawns would be unplayable.
      expect(ch, `start (${col},${row}) is off the map`).toBeDefined();
      expect(ch, `start (${col},${row}) is on water/ice`).not.toBe(' ');
      expect(ch, `start (${col},${row}) is on water/ice`).not.toBe('a');
    }
  });
});

describe('MapGenerator.generateEarth', () => {
  it('loads the static map tile for tile', () => {
    disableWorldMapPostProcessing();
    const tiles = new MapGenerator({
      mapWidth: EARTH_WIDTH,
      mapHeight: EARTH_HEIGHT,
      seed: 42,
    }).generateEarth();

    expect(tiles).toHaveLength(EARTH_WIDTH * EARTH_HEIGHT);
    const map = WORLD_MAP!;
    let mismatches = 0;
    for (let row = 0; row < EARTH_HEIGHT; row++) {
      for (let col = 0; col < EARTH_WIDTH; col++) {
        const tile = tiles[row * EARTH_WIDTH + col];
        if (tile.type !== terrainIdForChar(map.rows[row][col])) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('turns the map’s special flags into bonus resources', () => {
    disableWorldMapPostProcessing();
    const tiles = new MapGenerator({
      mapWidth: EARTH_WIDTH,
      mapHeight: EARTH_HEIGHT,
      seed: 42,
    }).generateEarth();

    const map = WORLD_MAP!;
    let expected = 0;
    let missing = 0;
    for (let row = 0; row < EARTH_HEIGHT; row++) {
      for (let col = 0; col < EARTH_WIDTH; col++) {
        const flagged = hasSpecialResource(map.specials?.[row]?.[col]);
        const terrain = terrainIdForChar(map.rows[row][col]);
        // Only terrain with a resource definition can carry one.
        if (!flagged || !TERRAIN_RESOURCES[terrain]) continue;
        expected++;
        const tile = tiles[row * EARTH_WIDTH + col];
        if (!tile.resource) missing++;
      }
    }
    expect(expected).toBeGreaterThan(100);
    expect(missing).toBe(0);
  });

  it('runs the normal pipeline on top (rivers, build sites, passability)', () => {
    const tiles = generatedWorldMap();
    expect(tiles).toHaveLength(EARTH_WIDTH * EARTH_HEIGHT);

    const count = (type: string): number => tiles.filter((t) => t.type === type).length;
    // The source map has no rivers — they are added procedurally.
    expect(count(TERRAIN_TYPES.RIVER)).toBeGreaterThan(0);
    // Polar caps and major oceans survive the pipeline.
    expect(count(TERRAIN_TYPES.ARCTIC)).toBeGreaterThan(2500);
    expect(count(TERRAIN_TYPES.OCEAN)).toBeGreaterThan(9000);
    expect(count(TERRAIN_TYPES.OCEAN)).toBeLessThanOrEqual(9729);
    // Every land biome of the source map is still present.
    for (const type of [
      TERRAIN_TYPES.DESERT, TERRAIN_TYPES.FOREST, TERRAIN_TYPES.GRASSLAND,
      TERRAIN_TYPES.HILLS, TERRAIN_TYPES.JUNGLE, TERRAIN_TYPES.MOUNTAINS,
      TERRAIN_TYPES.PLAINS, TERRAIN_TYPES.SWAMP, TERRAIN_TYPES.TUNDRA,
    ]) {
      expect(count(type), `expected ${type} tiles on the world map`).toBeGreaterThan(0);
    }
  });
});
