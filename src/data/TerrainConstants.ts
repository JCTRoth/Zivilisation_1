// Terrain logic constants (yields, movement, resources) — game-facing data

import { TerrainProperties } from './GameConstants';

export interface SpecialResource {
    name: string;
    terrain: string;
    terrains?: string; // CSV of terrain types where this resource is usable
    food: number;
    production: number;
    trade: number;
    description: string;
}

export interface ResourceYields {
    food: number;
    production: number;
    trade: number;
    description?: string;
}

export const TERRAIN_TYPES = {
    OCEAN: 'ocean',
    GRASSLAND: 'grassland',
    PLAINS: 'plains',
    TUNDRA: 'tundra',
    DESERT: 'desert',
    FOREST: 'forest',
    JUNGLE: 'jungle',
    MOUNTAINS: 'mountains',
    HILLS: 'hills',
    SWAMP: 'swamp',
    ARCTIC: 'arctic',
    RIVER: 'river',
    LAKE: 'lake'
} as const;

/** Water terrain keys (ocean, the legacy 'sea' alias, and inland lakes). */
export const WATER_TERRAIN_TYPES: readonly string[] = [
    TERRAIN_TYPES.OCEAN,
    TERRAIN_TYPES.LAKE,
    'sea',
];

export const TERRAIN_PROPERTIES: Record<string, TerrainProperties> = {
    [TERRAIN_TYPES.OCEAN]: {
        movement: 1,
        defense: 1,
        food: 1,
        production: 0,
        trade: 2,
        color: '#1e3a8a',
        passable: false,
        description: 'Deep ocean waters',
        buildModifier: 1
    },
    [TERRAIN_TYPES.RIVER]: {
        movement: 1,
        defense: 1.5,
        food: 2,
        production: 0,
        trade: 1,
        color: '#38bdf8',
        passable: true,
        description: 'River valley',
        buildModifier: 1
    },
    // A lake has the same yields/defense as a river (fresh water) but is NOT
    // passable — a lake is an inland obstacle, not navigable ocean.
    [TERRAIN_TYPES.LAKE]: {
        movement: 1,
        defense: 1.5,
        food: 2,
        production: 0,
        trade: 1,
        color: '#60a5fa',
        passable: false,
        description: 'Inland lake (fresh water, not navigable)',
        buildModifier: 1
    },
    [TERRAIN_TYPES.GRASSLAND]: {
        movement: 1,
        defense: 1,
        food: 2,
        production: 1,
        trade: 0,
        color: '#7dc850',
        passable: true,
        description: 'Fertile grassland',
        buildModifier: 1
    },
    [TERRAIN_TYPES.PLAINS]: {
        movement: 1,
        defense: 1,
        food: 1,
        production: 1,
        trade: 0,
        color: '#eab308',
        passable: true,
        description: 'Open plains',
        buildModifier: 1
    },
    [TERRAIN_TYPES.TUNDRA]: {
        movement: 1,
        defense: 1,
        food: 1,
        production: 0,
        trade: 0,
        color: '#94a3b8',
        passable: true,
        description: 'Cold tundra',
        buildModifier: 1
    },
    [TERRAIN_TYPES.DESERT]: {
        movement: 1,
        defense: 1,
        food: 0,
        production: 1,
        trade: 0,
        color: '#f59e0b',
        passable: true,
        description: 'Arid desert',
        buildModifier: 1
    },
    [TERRAIN_TYPES.FOREST]: {
        movement: 2,
        defense: 1.5,
        food: 1,
        production: 2,
        trade: 0,
        color: '#166534',
        passable: true,
        description: 'Dense forest',
        buildModifier: 2
    },
    [TERRAIN_TYPES.JUNGLE]: {
        movement: 2,
        defense: 1.5,
        food: 1,
        production: 0,
        trade: 0,
        color: '#15803d',
        passable: true,
        description: 'Dense jungle',
        buildModifier: 2
    },
    [TERRAIN_TYPES.MOUNTAINS]: {
        movement: 3,
        defense: 3,
        food: 0,
        production: 1,
        trade: 0,
        color: '#78716c',
        passable: true,
        description: 'Rugged mountains',
        buildModifier: 3
    },
    [TERRAIN_TYPES.HILLS]: {
        movement: 2,
        defense: 2,
        food: 1,
        production: 0,
        trade: 0,
        color: '#a39071',
        passable: true,
        description: 'Rolling hills',
        buildModifier: 2
    },
    [TERRAIN_TYPES.SWAMP]: {
        movement: 2,
        defense: 1.5,
        food: 1,
        production: 0,
        trade: 0,
        color: '#7c2d12',
        passable: true,
        description: 'Muddy swamp',
        buildModifier: 3
    },
    [TERRAIN_TYPES.ARCTIC]: {
        movement: 2,
        defense: 1,
        food: 0,
        production: 0,
        trade: 0,
        color: '#f1f5f9',
        passable: true,
        description: 'Frozen arctic',
        buildModifier: 1
    }
};

export const SPECIAL_RESOURCES: SpecialResource[] = [
    {
        name: 'Seal',
        terrain: TERRAIN_TYPES.ARCTIC,
        terrains: `${TERRAIN_TYPES.ARCTIC}`,
        food: 2,
        production: 0,
        trade: 0,
        description: 'Increases food production (Arctic)'
    },
    {
        name: 'Gems',
        terrain: TERRAIN_TYPES.JUNGLE,
        terrains: `${TERRAIN_TYPES.JUNGLE}`,
        food: 0,
        production: 0,
        trade: 4,
        description: 'High trade value (Jungle)'
    },
    {
        name: 'Horses',
        terrain: TERRAIN_TYPES.PLAINS,
        terrains: `${TERRAIN_TYPES.PLAINS}`,
        food: 0,
        production: 2,
        trade: 0,
        description: 'Increases production (Plains)'
    },
    {
        name: 'Gold',
        terrain: TERRAIN_TYPES.MOUNTAINS,
        terrains: `${TERRAIN_TYPES.MOUNTAINS}`,
        food: 0,
        production: 0,
        trade: 6,
        description: 'Very high trade value (Mountains)'
    },
    {
        name: 'Coal',
        terrain: TERRAIN_TYPES.HILLS,
        terrains: `${TERRAIN_TYPES.HILLS}`,
        food: 0,
        production: 2,
        trade: 0,
        description: 'Increases production (Hills)'
    },
    {
        name: 'Fish',
        terrain: TERRAIN_TYPES.OCEAN,
        // Rivers can also hold fish (Civ1: at half the ocean rate).
        terrains: `${TERRAIN_TYPES.OCEAN},${TERRAIN_TYPES.RIVER}`,
        food: 2,
        production: 0,
        trade: 0,
        description: 'Food from the water (Ocean and River)'
    },
    {
        name: 'Oil',
        terrain: TERRAIN_TYPES.SWAMP,
        terrains: `${TERRAIN_TYPES.SWAMP}`,
        food: 0,
        production: 4,
        trade: 0,
        description: 'High production value (Swamp)'
    },
    {
        name: 'Game',
        terrain: TERRAIN_TYPES.FOREST,
        terrains: `${TERRAIN_TYPES.FOREST},${TERRAIN_TYPES.TUNDRA}`,
        food: 2,
        production: 0,
        trade: 0,
        description: 'Increases food production (Forest)'
    },
    {
        name: 'Oasis',
        terrain: TERRAIN_TYPES.DESERT,
        terrains: `${TERRAIN_TYPES.DESERT}`,
        food: 3,
        production: 0,
        trade: 0,
        description: 'Increases food production (Desert)'
    }
];

/**
 * Default special resource for each terrain type (Civ1: exactly one per
 * terrain; Grassland has none). Used by map generation and by
 * terrain-conversion rules (the new terrain carries its own resource).
 */
export const TERRAIN_RESOURCES: Record<string, string | null> = {
    [TERRAIN_TYPES.ARCTIC]: 'Seal',
    [TERRAIN_TYPES.JUNGLE]: 'Gems',
    [TERRAIN_TYPES.PLAINS]: 'Horses',
    [TERRAIN_TYPES.MOUNTAINS]: 'Gold',
    [TERRAIN_TYPES.HILLS]: 'Coal',
    [TERRAIN_TYPES.OCEAN]: 'Fish',
    [TERRAIN_TYPES.SWAMP]: 'Oil',
    [TERRAIN_TYPES.FOREST]: 'Game',
    [TERRAIN_TYPES.TUNDRA]: 'Game',
    [TERRAIN_TYPES.GRASSLAND]: null,
    [TERRAIN_TYPES.DESERT]: 'Oasis',
    // Rivers can carry fish, but only at half the ocean spawn rate.
    [TERRAIN_TYPES.RIVER]: 'Fish',
    [TERRAIN_TYPES.LAKE]: null
};

/**
 * Rivers hold fish at HALF the rate of an ocean tile (design rule). The
 * per-tile spawn chance below is the single tunable point for resource
 * density on generated maps.
 */
export const RIVER_FISH_CHANCE_MULTIPLIER = 0.5;

/** Base per-tile chance that a non-special tile carries its default resource. */
export const DEFAULT_RESOURCE_SPAWN_CHANCE = 0.15;

/** Per-terrain override of {@link DEFAULT_RESOURCE_SPAWN_CHANCE}. */
export const RESOURCE_SPAWN_CHANCE: Record<string, number> = {
    [TERRAIN_TYPES.OCEAN]: DEFAULT_RESOURCE_SPAWN_CHANCE,
    [TERRAIN_TYPES.RIVER]: DEFAULT_RESOURCE_SPAWN_CHANCE * RIVER_FISH_CHANCE_MULTIPLIER,
};

/** Resolve a resource's Civ1 yield bonus for the terrain it occupies. */
export function getResourceYields(
    resource: string | null | undefined,
    terrain: string | null | undefined,
): ResourceYields {
    if (!resource || !terrain) return { food: 0, production: 0, trade: 0 };
    const definition = SPECIAL_RESOURCES.find(
        (candidate) => candidate.name.toLowerCase() === resource.toLowerCase()
            && candidate.terrains?.split(',').includes(terrain),
    );
    if (!definition) return { food: 0, production: 0, trade: 0 };
    // Civ1's tundra Game is +3 food; forest Game is +2.
    if (definition.name === 'Game' && terrain === TERRAIN_TYPES.TUNDRA) {
        return { food: 3, production: 0, trade: 0, description: definition.description };
    }
    return {
        food: definition.food,
        production: definition.production,
        trade: definition.trade,
        description: definition.description,
    };
}

export default {
    TERRAIN_TYPES,
    TERRAIN_PROPERTIES,
    SPECIAL_RESOURCES,
    TERRAIN_RESOURCES,
    getResourceYields
};
