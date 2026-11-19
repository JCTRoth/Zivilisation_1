/**
 * Static (predefined) maps — hand-crafted world/map layouts that ship with the
 * game instead of being procedurally generated.
 *
 * Data files (e.g. `earth-180x90.json`) keep the RAW Freeciv characters: one
 * character per tile in `rows` plus an optional `specials` layer. Use
 * `scripts/extract-freeciv-map.mjs` to (re)generate them from a Freeciv
 * savegame. New maps only need to be dropped into this folder and registered
 * in `index.ts`.
 */
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

export interface StaticMapDefinition {
  /** Stable id used by the registry (also the file name). */
  id: string;
  /** Human-readable name (shown in the UI / logs). */
  name: string;
  /** Source map the data was extracted from (credits + regeneration hint). */
  source?: string;
  width: number;
  height: number;
  /** Raw Freeciv terrain characters — one string per row, `width` long. */
  rows: string[];
  /** Raw Freeciv "special" flags per tile ('0' = none) — optional layer. */
  specials?: string[];
  /** Hand-placed start positions (Freeciv r#sx/r#sy) for fair spawns. */
  startPositions?: Array<{ col: number; row: number }>;
}

/**
 * Freeciv 1.x terrain character → this game's terrain id.
 * ' ' = ocean, a = arctic, t = tundra, d = desert, p = plains, g = grassland,
 * f = forest, j = jungle, s = swamp, h = hills, m = mountains.
 */
export const FREECIV_TERRAIN_LEGEND: Record<string, string> = {
  ' ': TERRAIN_TYPES.OCEAN,
  'a': TERRAIN_TYPES.ARCTIC,
  't': TERRAIN_TYPES.TUNDRA,
  'd': TERRAIN_TYPES.DESERT,
  'p': TERRAIN_TYPES.PLAINS,
  'g': TERRAIN_TYPES.GRASSLAND,
  'f': TERRAIN_TYPES.FOREST,
  'j': TERRAIN_TYPES.JUNGLE,
  's': TERRAIN_TYPES.SWAMP,
  'h': TERRAIN_TYPES.HILLS,
  'm': TERRAIN_TYPES.MOUNTAINS,
};

/** Terrain id for a raw map character (unknown characters fall back to ocean). */
export function terrainIdForChar(ch: string | undefined): string {
  return FREECIV_TERRAIN_LEGEND[ch ?? ' '] ?? TERRAIN_TYPES.OCEAN;
}

/** Whether a raw "special" flag marks a bonus resource ('0' = none). */
export function hasSpecialResource(flag: string | undefined): boolean {
  return !!flag && flag !== '0';
}

/** Validate that a map's rows/specials match its declared size. */
export function validateStaticMap(map: StaticMapDefinition): string[] {
  const errors: string[] = [];
  if (!map.id) errors.push('missing id');
  if (!(map.width > 0) || !(map.height > 0)) errors.push(`bad size ${map.width}x${map.height}`);
  if (map.rows?.length !== map.height) {
    errors.push(`expected ${map.height} terrain rows, got ${map.rows?.length ?? 0}`);
  } else {
    map.rows.forEach((line, row) => {
      if (line.length !== map.width) {
        errors.push(`terrain row ${row} has ${line.length} tiles, expected ${map.width}`);
      }
      for (const ch of line) {
        if (!(ch in FREECIV_TERRAIN_LEGEND)) errors.push(`row ${row}: unknown terrain char '${ch}'`);
      }
    });
  }
  if (map.specials && map.specials.length !== map.height) {
    errors.push(`expected ${map.height} special rows, got ${map.specials.length}`);
  }
  return [...new Set(errors)];
}
