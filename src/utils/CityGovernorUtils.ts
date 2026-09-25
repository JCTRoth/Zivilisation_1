/**
 * Shared presentation data for the city governor and worked-tile lists.
 * Used by the Citizens tab, the side panel and the map tooltip.
 */

import type { CityGovernorMode } from '../../types/game';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

export interface GovernorOption {
  mode: CityGovernorMode;
  name: string;
  icon: string;
  /** One-line summary shown under the switcher. */
  description: string;
}

/** The four governors, in the order they are offered in the UI. */
export const CITY_GOVERNOR_OPTIONS: GovernorOption[] = [
  {
    mode: 'growth',
    name: 'Growth',
    icon: '🌾',
    description: 'Feeds the city first. Everyone works food until the food box is full, then surplus shifts to production.',
  },
  {
    mode: 'production',
    name: 'Production',
    icon: '⛏️',
    description: 'Keeps enough food to avoid starvation, then puts every spare citizen on shields.',
  },
  {
    mode: 'commerce',
    name: 'Commerce',
    icon: '💰',
    description: 'Keeps enough food to avoid starvation, then maximises trade and funds it with Taxmen and Scientists.',
  },
  {
    mode: 'balanced',
    name: 'Balanced',
    icon: '⚖️',
    description: 'A safe food surplus, then a steady mix of shields and trade.',
  },
];

export const GOVERNOR_BY_MODE: Record<CityGovernorMode, GovernorOption> = CITY_GOVERNOR_OPTIONS.reduce(
  (acc, option) => {
    acc[option.mode] = option;
    return acc;
  },
  {} as Record<CityGovernorMode, GovernorOption>,
);

export function governorOption(mode: CityGovernorMode | undefined | null): GovernorOption {
  return GOVERNOR_BY_MODE[(mode ?? 'balanced') as CityGovernorMode] ?? GOVERNOR_BY_MODE.balanced;
}

const TERRAIN_ICONS: Record<string, string> = {
  [TERRAIN_TYPES.GRASSLAND]: '🌱',
  [TERRAIN_TYPES.PLAINS]: '🌾',
  [TERRAIN_TYPES.TUNDRA]: '🍂',
  [TERRAIN_TYPES.DESERT]: '🏜️',
  [TERRAIN_TYPES.FOREST]: '🌳',
  [TERRAIN_TYPES.JUNGLE]: '🌴',
  [TERRAIN_TYPES.MOUNTAINS]: '⛰️',
  [TERRAIN_TYPES.HILLS]: '🗻',
  [TERRAIN_TYPES.SWAMP]: '🪾',
  [TERRAIN_TYPES.ARCTIC]: '❄️',
  [TERRAIN_TYPES.OCEAN]: '🌊',
  [TERRAIN_TYPES.RIVER]: '🏞️',
  [TERRAIN_TYPES.LAKE]: '🏞️',
};

const TERRAIN_LABELS: Record<string, string> = {
  [TERRAIN_TYPES.GRASSLAND]: 'Grassland',
  [TERRAIN_TYPES.PLAINS]: 'Plains',
  [TERRAIN_TYPES.TUNDRA]: 'Tundra',
  [TERRAIN_TYPES.DESERT]: 'Desert',
  [TERRAIN_TYPES.FOREST]: 'Forest',
  [TERRAIN_TYPES.JUNGLE]: 'Jungle',
  [TERRAIN_TYPES.MOUNTAINS]: 'Mountains',
  [TERRAIN_TYPES.HILLS]: 'Hills',
  [TERRAIN_TYPES.SWAMP]: 'Swamp',
  [TERRAIN_TYPES.ARCTIC]: 'Arctic',
  [TERRAIN_TYPES.OCEAN]: 'Ocean',
  [TERRAIN_TYPES.RIVER]: 'River',
  [TERRAIN_TYPES.LAKE]: 'Lake',
};

/** Icon + readable name for a terrain key, e.g. "🌳 Forest". */
export function terrainLabel(terrain: string | undefined | null): string {
  const key = terrain ?? '';
  const icon = TERRAIN_ICONS[key] ?? '🟫';
  const name = TERRAIN_LABELS[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : 'Terrain');
  return `${icon} ${name}`;
}
