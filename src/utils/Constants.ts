// Legacy Constants object for backward compatibility
import { GAME_CONSTANTS } from '../data/GameConstants';
import { TERRAIN_TYPES as T_TYPES, TERRAIN_PROPERTIES as T_PROPS, SPECIAL_RESOURCES as S_RESOURCES } from '../data/TerrainConstants';
import { UNIT_TYPES as U_TYPES, UNIT_PROPERTIES as U_PROPS } from '../data/UnitConstants';
import { BUILDING_TYPES as B_TYPES, BUILDING_PROPERTIES as B_PROPS } from '../data/BuildingConstants';
import { IMPROVEMENT_TYPES as I_TYPES, IMPROVEMENT_PROPERTIES as I_PROPS } from '../data/TileImprovementConstants';

// Main constants file - imports and re-exports all game constants
// This file maintains backward compatibility while organizing constants into logical modules

// Game Constants
export * from '../data/GameConstants';

// Terrain Constants (canonical)
export * from '../data/TerrainConstants';

// Unit Constants
export * from '../data/UnitConstants';

// Building Constants
export * from '../data/BuildingConstants';

// Improvement Constants
export * from '../data/TileImprovementConstants';

export const Constants = {
    // Hex Grid Configuration
    HEX_SIZE: GAME_CONSTANTS.HEX_SIZE,
    HEX_WIDTH: GAME_CONSTANTS.HEX_WIDTH,
    HEX_HEIGHT: GAME_CONSTANTS.HEX_HEIGHT,

    // Map Dimensions
    MAP_WIDTH: GAME_CONSTANTS.MAP_WIDTH,
    MAP_HEIGHT: GAME_CONSTANTS.MAP_HEIGHT,

    // Game Settings
    INITIAL_GOLD: GAME_CONSTANTS.INITIAL_GOLD,
    INITIAL_SCIENCE: GAME_CONSTANTS.INITIAL_SCIENCE,
    TURNS_PER_YEAR: GAME_CONSTANTS.TURNS_PER_YEAR,
    STARTING_YEAR: GAME_CONSTANTS.STARTING_YEAR,

    // Colors
    COLORS: GAME_CONSTANTS.COLORS,

    // Terrain Types and Properties
    TERRAIN: T_TYPES,
    TERRAIN_PROPS: T_PROPS,

    // Unit Types and Properties
    UNIT_TYPES: U_TYPES,
    UNIT_PROPS: U_PROPS,

    // Building Types and Properties
    BUILDINGS: B_TYPES,
    BUILDING_PROPS: B_PROPS,

    // Improvement Types and Properties
    IMPROVEMENT_TYPES: I_TYPES,
    IMPROVEMENT_PROPS: I_PROPS,

    // Special Resources
    RESOURCE_PROPS: S_RESOURCES
};

// Legacy exports for backward compatibility
export const TERRAIN_PROPS = T_PROPS;
export const UNIT_PROPS = U_PROPS;
export const BUILDING_PROPS = B_PROPS;
export const IMPROVEMENT_PROPS = I_PROPS;

// Legacy exports for backward compatibility
export { Constants as default };