// Game Constants - Legacy JavaScript Implementation (Converted to TypeScript)
interface TerrainProperties {
    movement: number;
    defense: number;
    food: number;
    production: number;
    trade: number;
    color: string;
    passable: boolean;
}

interface UnitProperties {
    name: string;
    attack: number;
    defense: number;
    movement: number;
    cost: number;
    canSettle: boolean;
    canWork: boolean;
    naval?: boolean;
    icon?: string;
    type?: 'civilian' | 'military' | 'siege' | 'naval';
}

interface BuildingProperties {
    name: string;
    cost: number;
    maintenance: number;
    effects: Record<string, any>;
}

interface GameConstants {
    // Hex Grid Configuration
    HEX_SIZE: number;
    HEX_WIDTH: number;
    HEX_HEIGHT: number;

    // Map Dimensions
    MAP_WIDTH: number;
    MAP_HEIGHT: number;

    // Terrain Types
    TERRAIN: {
        OCEAN: string;
        GRASSLAND: string;
        PLAINS: string;
        DESERT: string;
        TUNDRA: string;
        HILLS: string;
        MOUNTAINS: string;
        FOREST: string;
    };

    // Terrain Properties
    TERRAIN_PROPS: Record<string, any>;

    // Unit Types
    UNIT_TYPES: {
        SETTLER: string;
        MILITIA: string;
        PHALANX: string;
        LEGION: string;
        CATAPULT: string;
        TRIREME: string;
        CAVALRY: string;
        CHARIOT: string;
    };

    // Unit Properties
    UNIT_PROPS: Record<string, any>;

    // City Buildings
    BUILDINGS: {
        GRANARY: string;
        BARRACKS: string;
        TEMPLE: string;
        MARKETPLACE: string;
        LIBRARY: string;
        WALLS: string;
        AQUEDUCT: string;
        BANK: string;
    };

    // Building Properties
    BUILDING_PROPS: Record<string, any>;

    // Improvement Properties
    IMPROVEMENT_PROPS: Record<string, any>;

    // Game Settings
    INITIAL_GOLD: number;
    INITIAL_SCIENCE: number;
    TURNS_PER_YEAR: number;
    STARTING_YEAR: number;

    // Colors
    COLORS: {
        PLAYER: string;
        AI_1: string;
        AI_2: string;
        AI_3: string;
        AI_4: string;
        AI_5: string;
        NEUTRAL: string;
        SELECTED: string;
        HIGHLIGHT: string;
    };
}

export const CONSTANTS: GameConstants = {
    // Hex Grid Configuration
    HEX_SIZE: 32,
    HEX_WIDTH: 56,  // HEX_SIZE * Math.sqrt(3)
    HEX_HEIGHT: 64, // HEX_SIZE * 2

    // Map Dimensions
    MAP_WIDTH: 80,
    MAP_HEIGHT: 50,

    // Terrain Types
    TERRAIN: {
        OCEAN: 'ocean',
        GRASSLAND: 'grassland',
        PLAINS: 'plains',
        DESERT: 'desert',
        TUNDRA: 'tundra',
        HILLS: 'hills',
        MOUNTAINS: 'mountains',
        FOREST: 'forest'
    },

    // Terrain Properties
    TERRAIN_PROPS: {
        ocean: {
            movement: 1,
            defense: 0,
            food: 1,
            production: 0,
            trade: 2,
            color: '#1e3a8a',
            passable: false
        },
        grassland: {
            movement: 1,
            defense: 0,
            food: 2,
            production: 0,
            trade: 0,
            color: '#22c55e',
            passable: true
        },
        plains: {
            movement: 1,
            defense: 0,
            food: 1,
            production: 1,
            trade: 0,
            color: '#84cc16',
            passable: true
        },
        desert: {
            movement: 1,
            defense: 0,
            food: 0,
            production: 1,
            trade: 0,
            color: '#f59e0b',
            passable: true
        },
        tundra: {
            movement: 1,
            defense: 0,
            food: 1,
            production: 0,
            trade: 0,
            color: '#64748b',
            passable: true
        },
        hills: {
            movement: 2,
            defense: 2,
            food: 1,
            production: 0,
            trade: 0,
            color: '#a3a3a3',
            passable: true
        },
        mountains: {
            movement: 3,
            defense: 3,
            food: 0,
            production: 1,
            trade: 0,
            color: '#525252',
            passable: true
        },
        forest: {
            movement: 2,
            defense: 1,
            food: 1,
            production: 1,
            trade: 0,
            color: '#166534',
            passable: true
        }
    },

    // Unit Types
    UNIT_TYPES: {
        SETTLER: 'settler',
        MILITIA: 'militia',
        PHALANX: 'phalanx',
        LEGION: 'legion',
        CATAPULT: 'catapult',
        TRIREME: 'trireme',
        CAVALRY: 'cavalry',
        CHARIOT: 'chariot'
    },

    // Unit Properties
    UNIT_PROPS: {
        settler: {
            name: 'Settler',
            attack: 0,
            defense: 1,
            movement: 1,
            cost: 40,
            canSettle: true,
            canWork: true,
            type: 'civilian',
            icon: '🏘️'
        },
        militia: {
            name: 'Militia',
            attack: 1,
            defense: 2,
            movement: 1,
            cost: 10,
            canSettle: false,
            canWork: false,
            type: 'military',
            icon: '⚔️'
        },
        phalanx: {
            name: 'Phalanx',
            attack: 1,
            defense: 2,
            movement: 1,
            cost: 20,
            canSettle: false,
            canWork: false,
            type: 'military',
            icon: '🛡️'
        },
        legion: {
            name: 'Legion',
            attack: 3,
            defense: 2,
            movement: 1,
            cost: 40,
            canSettle: false,
            canWork: false,
            type: 'military',
            icon: '⚔️'
        },
        catapult: {
            name: 'Catapult',
            attack: 4,
            defense: 1,
            movement: 1,
            cost: 40,
            canSettle: false,
            canWork: false,
            type: 'siege',
            icon: '💥'
        },
        trireme: {
            name: 'Trireme',
            attack: 1,
            defense: 1,
            movement: 3,
            cost: 40,
            canSettle: false,
            canWork: false,
            naval: true,
            type: 'naval',
            icon: '⛵'
        },
        cavalry: {
            name: 'Cavalry',
            attack: 2,
            defense: 1,
            movement: 2,
            cost: 30,
            canSettle: false,
            canWork: false,
            type: 'military',
            icon: '🐎'
        },
        chariot: {
            name: 'Chariot',
            attack: 3,
            defense: 1,
            movement: 2,
            cost: 30,
            canSettle: false,
            canWork: false,
            type: 'military',
            icon: '🏇'
        }
    },

    // City Buildings
    BUILDINGS: {
        GRANARY: 'granary',
        BARRACKS: 'barracks',
        TEMPLE: 'temple',
        MARKETPLACE: 'marketplace',
        LIBRARY: 'library',
        WALLS: 'walls',
        AQUEDUCT: 'aqueduct',
        BANK: 'bank'
    },

    // Building Properties
    BUILDING_PROPS: {
        granary: {
            name: 'Granary',
            cost: 60,
            maintenance: 1,
            effects: { foodStorage: 2 }
        },
        barracks: {
            name: 'Barracks',
            cost: 40,
            maintenance: 1,
            effects: { unitExperience: 1 }
        },
        temple: {
            name: 'Temple',
            cost: 40,
            maintenance: 1,
            effects: { happiness: 1 }
        },
        marketplace: {
            name: 'Marketplace',
            cost: 80,
            maintenance: 1,
            effects: { tradeBonus: 0.5 }
        },
        library: {
            name: 'Library',
            cost: 80,
            maintenance: 1,
            effects: { scienceBonus: 0.5 }
        },
        walls: {
            name: 'City Walls',
            cost: 80,
            maintenance: 2,
            effects: { defense: 3 }
        },
        aqueduct: {
            name: 'Aqueduct',
            cost: 80,
            maintenance: 2,
            effects: { maxPopulation: 8 }
        },
        bank: {
            name: 'Bank',
            cost: 120,
            maintenance: 3,
            effects: { goldBonus: 0.5 }
        }
    },

    // Improvement Properties
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
    INITIAL_GOLD: 50,
    INITIAL_SCIENCE: 2,
    TURNS_PER_YEAR: 20,
    STARTING_YEAR: -4000,

    // Colors
    COLORS: {
        PLAYER: '#ff0000',
        AI_1: '#0000ff',
        AI_2: '#00ff00',
        AI_3: '#ffff00',
        AI_4: '#ff00ff',
        AI_5: '#00ffff',
        NEUTRAL: '#808080',
        SELECTED: '#ffffff',
        HIGHLIGHT: '#ffff80'
    }
};

// Export individual constants for convenience
export const {
    TERRAIN,
    TERRAIN_PROPS,
    UNIT_TYPES,
    UNIT_PROPS,
    BUILDINGS,
    BUILDING_PROPS,
    IMPROVEMENT_PROPS
} = CONSTANTS;

export type { UnitProperties, BuildingProperties };

export { CONSTANTS as default };