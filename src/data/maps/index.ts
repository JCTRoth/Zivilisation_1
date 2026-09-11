/**
 * Registry of every static map shipped with the game, keyed by id.
 *
 * Add extracted maps here (see `scripts/extract-freeciv-map.mjs`) to make them
 * selectable; the "Earth" world map uses `WORLD_MAP_ID`.
 */
import earth180x90 from './earth-180x90.json';
import type { StaticMapDefinition } from './types';

export * from './types';

/** All static maps, keyed by their id. */
export const STATIC_MAPS: Record<string, StaticMapDefinition> = {
  'earth-180x90': earth180x90 as StaticMapDefinition,
};

/** Id of the map used for the in-game world map ("Earth" map type). */
export const WORLD_MAP_ID = 'earth-180x90';

/** The static world map (undefined when the data file is missing). */
export const WORLD_MAP: StaticMapDefinition | undefined = STATIC_MAPS[WORLD_MAP_ID];
