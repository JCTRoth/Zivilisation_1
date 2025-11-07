// Main constants file - imports and re-exports all game constants
// This file maintains backward compatibility while organizing constants into logical modules

// Game Constants
export * from './gameConstants';

// Terrain Constants
export * from './terrainConstants';

// Unit Constants
export * from './unitConstants';

// Building Constants
export * from './buildingConstants';

// Improvement Constants
export * from './improvementConstants';

// Legacy CONSTANTS object for backward compatibility
import { GAME_CONSTANTS } from './gameConstants';
import { TERRAIN_TYPES as T_TYPES, TERRAIN_PROPERTIES as T_PROPS, SPECIAL_RESOURCES as S_RESOURCES } from './terrainConstants';
import { UNIT_TYPES as U_TYPES, UNIT_PROPERTIES as U_PROPS } from './unitConstants';
import { BUILDING_TYPES as B_TYPES, BUILDING_PROPERTIES as B_PROPS } from './buildingConstants';
import { IMPROVEMENT_TYPES as I_TYPES, IMPROVEMENT_PROPERTIES as I_PROPS } from './improvementConstants';

export const CONSTANTS = {
    // Hex Grid Configuration
    HEX_SIZE: GAME_CONSTANTS.HEX_SIZE,
    HEX_WIDTH: GAME_CONSTANTS.HEX_WIDTH,
    HEX_HEIGHT: GAME_CONSTANTS.HEX_HEIGHT,

    // Map Dimensions
    MAP_WIDTH: GAME_CONSTANTS.MAP_WIDTH,
    MAP_HEIGHT: GAME_CONSTANTS.MAP_HEIGHT,

    // Terrain Types (legacy format)
    TERRAIN: {
        OCEAN: T_TYPES.OCEAN,
        GRASSLAND: T_TYPES.GRASSLAND,
        PLAINS: T_TYPES.PLAINS,
        DESERT: T_TYPES.DESERT,
        TUNDRA: T_TYPES.TUNDRA,
        HILLS: T_TYPES.HILLS,
        MOUNTAINS: T_TYPES.MOUNTAINS,
        FOREST: T_TYPES.FOREST
    },

    // Terrain Properties (legacy format)
    TERRAIN_PROPS: T_PROPS,

    // Special Resources (legacy format)
    RESOURCE_PROPS: S_RESOURCES.reduce((acc, resource) => {
        acc[resource.name.toLowerCase()] = {
            name: resource.name,
            food: resource.food,
            production: resource.production,
            trade: resource.trade,
            terrain: [resource.terrain],
            description: resource.description,
            icon: '📦' // Default icon
        };
        return acc;
    }, {} as Record<string, any>),

    // Unit Types (legacy format)
    UNIT_TYPES: {
        SETTLER: U_TYPES.SETTLER,
        MILITIA: U_TYPES.WARRIOR,
        PHALANX: U_TYPES.ARCHER,
        LEGION: U_TYPES.LEGION,
        CATAPULT: U_TYPES.CANNON,
        TRIREME: U_TYPES.GALLEY,
        CAVALRY: U_TYPES.CAVALRY,
        CHARIOT: U_TYPES.CHARIOT
    },

    // Unit Properties (legacy format)
    UNIT_PROPS: U_PROPS,

    // City Buildings (legacy format)
    BUILDINGS: {
        GRANARY: B_TYPES.GRANARY,
        BARRACKS: B_TYPES.BARRACKS,
        TEMPLE: B_TYPES.TEMPLE,
        MARKETPLACE: B_TYPES.MARKETPLACE,
        LIBRARY: B_TYPES.LIBRARY,
        WALLS: B_TYPES.CITY_WALLS,
        AQUEDUCT: B_TYPES.AQUEDUCT,
        BANK: B_TYPES.BANK
    },

    // Building Properties (legacy format)
    BUILDING_PROPS: B_PROPS,

    // Improvement Properties (legacy format)
    IMPROVEMENT_PROPS: {
        road: {
            name: 'Road',
            food: 0,
            production: 0,
            trade: 1,
            buildTurns: 3,
            allowedTerrain: null,
            requiresResource: null
        },
        railroad: {
            name: 'Railroad',
            food: 0,
            production: 1,
            trade: 0,
            buildTurns: 6,
            allowedTerrain: null,
            requiresResource: null,
            prerequisite: 'road'
        },
        irrigation: {
            name: 'Irrigation',
            food: 1,
            production: 0,
            trade: 0,
            buildTurns: 5,
            allowedTerrain: ['grassland', 'plains', 'desert'],
            requiresResource: null
        },
        mine: {
            name: 'Mine',
            food: 0,
            production: 1,
            trade: 0,
            buildTurns: 5,
            allowedTerrain: ['hills', 'mountains'],
            requiresResource: null
        },
        fortress: {
            name: 'Fortress',
            food: 0,
            production: 0,
            trade: 0,
            buildTurns: 8,
            allowedTerrain: null,
            requiresResource: null,
            defenseBonus: 2
        },
        airbase: {
            name: 'Airbase',
            food: 0,
            production: 0,
            trade: 0,
            buildTurns: 10,
            allowedTerrain: null,
            requiresResource: null
        }
    },

    // Game Settings
    INITIAL_GOLD: GAME_CONSTANTS.INITIAL_GOLD,
    INITIAL_SCIENCE: GAME_CONSTANTS.INITIAL_SCIENCE,
    TURNS_PER_YEAR: GAME_CONSTANTS.TURNS_PER_YEAR,
    STARTING_YEAR: GAME_CONSTANTS.STARTING_YEAR,

    // Colors
    COLORS: GAME_CONSTANTS.COLORS
};

// Export individual constants for convenience (legacy)
export const {
    TERRAIN,
    TERRAIN_PROPS,
    RESOURCE_PROPS,
    UNIT_TYPES: LEGACY_UNIT_TYPES,
    UNIT_PROPS,
    BUILDINGS,
    BUILDING_PROPS,
    IMPROVEMENT_PROPS
} = CONSTANTS;

// Re-export with legacy names to avoid conflicts
export { LEGACY_UNIT_TYPES as UNIT_TYPES };

export { CONSTANTS as default };