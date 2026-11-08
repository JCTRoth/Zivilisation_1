import type { Preset } from './types';

export const TERRAIN_PRESETS: Record<string, Preset> = {
  ocean: {
    name: 'Ocean',
    color: '#4169E1',
    file: 'terrain_ocean',
    w: 256, h: 256,
  },
  plains: {
    name: 'Plains',
    color: '#90EE90',
    file: 'terrain_plains',
    w: 256, h: 256,
  },
  grassland: {
    name: 'Grassland',
    color: '#32CD32',
    file: 'terrain_grassland',
    w: 256, h: 256,
  },
  forest: {
    name: 'Forest',
    color: '#228B22',
    file: 'terrain_forest',
    w: 256, h: 256,
  },
  jungle: {
    name: 'Jungle',
    color: '#1B7A3D',
    file: 'terrain_jungle',
    w: 256, h: 256,
  },
  hills: {
    name: 'Hills',
    color: '#8FBC8F',
    file: 'terrain_hills',
    w: 256, h: 256,
  },
  mountains: {
    name: 'Mountains',
    color: '#696969',
    file: 'terrain_mountains',
    w: 256, h: 256,
  },
  desert: {
    name: 'Desert',
    color: '#F4A460',
    file: 'terrain_desert',
    w: 256, h: 256,
  },
  swamp: {
    name: 'Swamp',
    color: '#5B3A1E',
    file: 'terrain_swamp',
    w: 256, h: 256,
  },
  tundra: {
    name: 'Tundra',
    color: '#B0C4DE',
    file: 'terrain_tundra',
    w: 256, h: 256,
  },
  arctic: {
    name: 'Arctic',
    color: '#F0F8FF',
    file: 'terrain_arctic',
    w: 256, h: 256,
  },
  river: {
    name: 'River',
    color: '#3b82f6',
    file: 'terrain_river',
    w: 256, h: 256,
  },
};

export const FEATURE_PRESETS: Record<string, Preset> = {
  forest: {
    name: 'Forest',
    color: '#228B22',
    file: 'terrain_forest_feature',
    w: 256, h: 384,
  },
  jungle: {
    name: 'Jungle',
    color: '#1B7A3D',
    file: 'terrain_jungle_feature',
    w: 256, h: 384,
  },
  hills: {
    name: 'Hills',
    color: '#8FBC8F',
    file: 'terrain_hills_feature',
    w: 256, h: 384,
  },
  mountains: {
    name: 'Mountains',
    color: '#696969',
    file: 'terrain_mountains_feature',
    w: 256, h: 384,
  },
  swamp: {
    name: 'Swamp',
    color: '#5B3A1E',
    file: 'terrain_swamp_feature',
    w: 256, h: 384,
  },
};
