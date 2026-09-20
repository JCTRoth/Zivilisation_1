// Centralized terrain presentation data used by UI components
export type TerrainInfo = {
  color: string;
  char: string;
  name: string;
};

export const TILE_SIZE = 32;

export const TERRAIN_TYPES: Record<string, TerrainInfo> = {
  OCEAN: { color: '#4169E1', char: '~~', name: 'Ocean' },
  PLAINS: { color: '#90EE90', char: '=', name: 'Plains' },
  GRASSLAND: { color: '#32CD32', char: '', name: 'Grassland' },
  FOREST: { color: '#228B22', char: '🌲', name: 'Forest' },
  JUNGLE: { color: '#1B7A3D', char: '🌿', name: 'Jungle' },
  HILLS: { color: '#8FBC8F', char: '^', name: 'Hills' },
  MOUNTAINS: { color: '#696969', char: '⛰︎', name: 'Mountains' },
  DESERT: { color: '#F4A460', char: '🌵', name: 'Desert' },
  SWAMP: { color: '#5B3A1E', char: '≈', name: 'Swamp' },
  TUNDRA: { color: '#B0C4DE', char: '_', name: 'Tundra' },
  ARCTIC: { color: '#F0F8FF', char: '*', name: 'Arctic' },
  RIVER: { color: '#3b82f6', char: '~', name: 'River' },
  LAKE: { color: '#60a5fa', char: '≈', name: 'Lake' }
};

/**
 * Resolve a terrain descriptor from a variety of possible tile.type values.
 * Accepts keys like 'OCEAN' or 'ocean' or the display name 'Ocean'.
 */
export function getTerrainInfo(type?: string | null): TerrainInfo | null {
  if (!type) return null;
  if (typeof type !== 'string') return null;
  // direct key
  const entry = TERRAIN_TYPES[type];
  if (entry) return entry;
  const up = type.toUpperCase();
  const entryUp = TERRAIN_TYPES[up];
  if (entryUp) return entryUp;
  const low = type.toLowerCase();
  const entryLow = TERRAIN_TYPES[low];
  if (entryLow) return entryLow;
  // try to match by display name
  const found = Object.values(TERRAIN_TYPES).find(t => t.name && t.name.toLowerCase() === type.toLowerCase());
  return found || null;
}
