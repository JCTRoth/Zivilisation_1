// Centralized terrain presentation data used by UI components
export type TerrainInfo = {
  color: string;
  char: string;
  name: string;
};

export const TILE_SIZE = 32;

export const TERRAIN_TYPES: Record<string, TerrainInfo> = {
  OCEAN: { color: '#4169E1', char: '~', name: 'Ocean' },
  PLAINS: { color: '#90EE90', char: '=', name: 'Plains' },
  GRASSLAND: { color: '#32CD32', char: '"', name: 'Grassland' },
  FOREST: { color: '#228B22', char: '♦', name: 'Forest' },
  HILLS: { color: '#8FBC8F', char: '^', name: 'Hills' },
  MOUNTAINS: { color: '#696969', char: '▲', name: 'Mountains' },
  DESERT: { color: '#F4A460', char: '~', name: 'Desert' },
  TUNDRA: { color: '#B0C4DE', char: '.', name: 'Tundra' },
  ARCTIC: { color: '#F0F8FF', char: '*', name: 'Arctic' },
  RIVER: { color: '#0000FF', char: '~', name: 'River' }
};

/**
 * Resolve a terrain descriptor from a variety of possible tile.type values.
 * Accepts keys like 'OCEAN' or 'ocean' or the display name 'Ocean'.
 */
export function getTerrainInfo(type?: string | null): TerrainInfo | null {
  if (!type) return null;
  if (typeof type !== 'string') return null;
  // direct key
  if ((TERRAIN_TYPES as any)[type]) return (TERRAIN_TYPES as any)[type];
  const up = type.toUpperCase();
  if ((TERRAIN_TYPES as any)[up]) return (TERRAIN_TYPES as any)[up];
  const low = type.toLowerCase();
  if ((TERRAIN_TYPES as any)[low]) return (TERRAIN_TYPES as any)[low];
  // try to match by display name
  const found = Object.values(TERRAIN_TYPES).find(t => t.name && t.name.toLowerCase() === type.toLowerCase());
  return found || null;
}

export default {
  TILE_SIZE,
  TERRAIN_TYPES,
  getTerrainInfo
};
