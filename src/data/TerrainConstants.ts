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

export const TERRAIN_TYPES = {
    OCEAN: 'ocean',
    COAST: 'coast',
    GRASSLAND: 'grassland',
    PLAINS: 'plains',
    TUNDRA: 'tundra',
    DESERT: 'desert',
    FOREST: 'forest',
    JUNGLE: 'jungle',
    MOUNTAINS: 'mountains',
    HILLS: 'hills',
    SWAMP: 'swamp',
    ARCTIC: 'arctic'
} as const;

export const TERRAIN_PROPERTIES: Record<string, TerrainProperties> = {
    [TERRAIN_TYPES.OCEAN]: {
        movement: 0.8,
        defense: 0,
        food: 1,
        production: 0,
        trade: 2,
        color: '#1e3a8a',
        passable: false,
        description: 'Deep ocean waters',
        buildModifier: 1
    },
    [TERRAIN_TYPES.COAST]: {
        movement: 0.8,
        defense: 0,
        food: 2,
        production: 0,
        trade: 1,
        color: '#3b82f6',
        passable: false,
        description: 'Coastal waters',
        buildModifier: 1
    },
    [TERRAIN_TYPES.GRASSLAND]: {
        movement: 0.8,
        defense: 0,
        food: 3,
        production: 0,
        trade: 0,
        color: '#22c55e',
        passable: true,
        description: 'Fertile grassland',
        buildModifier: 1
    },
    [TERRAIN_TYPES.PLAINS]: {
        movement: 0.8,
        defense: 0,
        food: 1,
        production: 1,
        trade: 0,
        color: '#eab308',
        passable: true,
        description: 'Open plains',
        buildModifier: 1
    },
    [TERRAIN_TYPES.TUNDRA]: {
        movement: 0.8,
        defense: 0,
        food: 1,
        production: 0,
        trade: 0,
        color: '#94a3b8',
        passable: true,
        description: 'Cold tundra',
        buildModifier: 1
    },
    [TERRAIN_TYPES.DESERT]: {
        movement: 0.8,
        defense: 0,
        food: 0,
        production: 1,
        trade: 0,
        color: '#f59e0b',
        passable: true,
        description: 'Arid desert',
        buildModifier: 1
    },
    [TERRAIN_TYPES.FOREST]: {
        movement: 0.9,
        defense: 1.35,
        food: 1,
        production: 2,
        trade: 0,
        color: '#166534',
        passable: true,
        description: 'Dense forest',
        buildModifier: 2
    },
    [TERRAIN_TYPES.JUNGLE]: {
        movement: 1.0,
        defense: 1.35,
        food: 0,
        production: 0,
        trade: 0,
        color: '#15803d',
        passable: true,
        description: 'Impassable jungle',
        buildModifier: 2
    },
    [TERRAIN_TYPES.MOUNTAINS]: {
        movement: 1.0,
        defense: 2.5,
        food: 0,
        production: 1,
        trade: 0,
        color: '#78716c',
        passable: true,
        description: 'Rugged mountains',
        buildModifier: 3
    },
    [TERRAIN_TYPES.HILLS]: {
        movement: 0.9,
        defense: 1.5,
        food: 0,
        production: 1,
        trade: 0,
        color: '#a3a3a3',
        passable: true,
        description: 'Rolling hills',
        buildModifier: 2
    },
    [TERRAIN_TYPES.SWAMP]: {
        movement: 0.9,
        defense: 1.35,
        food: 0,
        production: 0,
        trade: 0,
        color: '#7c2d12',
        passable: true,
        description: 'Muddy swamp',
        buildModifier: 3
    },
    [TERRAIN_TYPES.ARCTIC]: {
        movement: 0.8,
        defense: 0,
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
        name: 'Wheat',
        terrain: TERRAIN_TYPES.PLAINS,
        terrains: `${TERRAIN_TYPES.PLAINS}`,
        food: 1,
        production: 0,
        trade: 0,
        description: 'Increases food production'
    },
    {
        name: 'Silk',
        terrain: TERRAIN_TYPES.JUNGLE,
        terrains: `${TERRAIN_TYPES.JUNGLE}`,
        food: 0,
        production: 0,
        trade: 2,
        description: 'Increases trade'
    },
    {
        name: 'Gems',
        terrain: TERRAIN_TYPES.JUNGLE,
        terrains: `${TERRAIN_TYPES.JUNGLE}`,
        food: 0,
        production: 0,
        trade: 3,
        description: 'High trade value'
    },
    {
        name: 'Gold',
        terrain: TERRAIN_TYPES.MOUNTAINS,
        terrains: `${TERRAIN_TYPES.MOUNTAINS}`,
        food: 0,
        production: 0,
        trade: 4,
        description: 'Very high trade value'
    },
    {
        name: 'Iron',
        terrain: TERRAIN_TYPES.HILLS,
        terrains: `${TERRAIN_TYPES.HILLS}`,
        food: 0,
        production: 1,
        trade: 0,
        description: 'Increases production'
    },
    {
        name: 'Coal',
        terrain: TERRAIN_TYPES.MOUNTAINS,
        terrains: `${TERRAIN_TYPES.MOUNTAINS}`,
        food: 0,
        production: 2,
        trade: 0,
        description: 'Increases production'
    },
    {
        name: 'Oil',
        terrain: TERRAIN_TYPES.DESERT,
        terrains: `${TERRAIN_TYPES.DESERT}`,
        food: 0,
        production: 3,
        trade: 0,
        description: 'High production value'
    },
    {
        name: 'Fish',
        terrain: TERRAIN_TYPES.OCEAN,
        terrains: `${TERRAIN_TYPES.OCEAN},${TERRAIN_TYPES.COAST}`,
        food: 2,
        production: 0,
        trade: 1,
        description: 'Food and trade from sea'
    }
];

export const TERRAIN_CONVERSIONS = {
    [TERRAIN_TYPES.FOREST]: TERRAIN_TYPES.PLAINS,
    [TERRAIN_TYPES.JUNGLE]: TERRAIN_TYPES.PLAINS,
    [TERRAIN_TYPES.SWAMP]: TERRAIN_TYPES.GRASSLAND,
    [TERRAIN_TYPES.TUNDRA]: TERRAIN_TYPES.PLAINS,
    [TERRAIN_TYPES.ARCTIC]: TERRAIN_TYPES.TUNDRA
} as const;

export default {
    TERRAIN_TYPES,
    TERRAIN_PROPERTIES,
    SPECIAL_RESOURCES,
    TERRAIN_CONVERSIONS
};
