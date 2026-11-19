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
