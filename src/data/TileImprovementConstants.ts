// Improvement Constants - Terrain improvements and their properties

export interface ImprovementProperties {
    name: string;
    turns: number;
    effects: Record<string, any>;
    terrainRestrictions?: string[];
    requiredTech?: string;
}

export const IMPROVEMENT_TYPES = {
    // Basic Improvements
    IRRIGATION: 'irrigation',
    ROAD: 'road',
    RAILROAD: 'railroad',
    MINES: 'mines',
    FORTRESS: 'fortress',
    POLLUTION: 'pollution',

    // Advanced Improvements
    FARMLAND: 'farmland',
    AIRPORT: 'airport',
    PORT: 'port',
    SUPERHIGHWAYS: 'superhighways'
} as const;

export const IMPROVEMENT_PROPERTIES: Record<string, ImprovementProperties> = {
    [IMPROVEMENT_TYPES.IRRIGATION]: {
        name: 'Irrigation',
        turns: 2,
        effects: {
            food: 1,
        },
        terrainRestrictions: ['grassland', 'plains', 'desert']
    },
    [IMPROVEMENT_TYPES.ROAD]: {
        name: 'Road',
        turns: 1,
        effects: {
            trade: 0.5
        }
    },
    [IMPROVEMENT_TYPES.RAILROAD]: {
        name: 'Railroad',
        turns: 1,
        effects: {
            movement: 0,
            food: 0.5,
            production: 0.5,
            trade: 0.5
        },
        requiredTech: 'railroad'
    },
    [IMPROVEMENT_TYPES.MINES]: {
        name: 'Mines',
        turns: 8,
        effects: {
            production: 1
        },
        terrainRestrictions: ['mountains', 'hills']
    },
    [IMPROVEMENT_TYPES.FORTRESS]: {
        name: 'Fortress',
        turns: 6,
        effects: {
            defense: 1.8,
        }
    },
    [IMPROVEMENT_TYPES.POLLUTION]: {
        name: 'Pollution',
        turns: 0,
        effects: {
            food: -1,
            production: -1,
            trade: -1,
            health: -1
        }
    }
};

export const IMPROVEMENT_UPGRADES = {
    [IMPROVEMENT_TYPES.ROAD]: IMPROVEMENT_TYPES.RAILROAD,
    [IMPROVEMENT_TYPES.IRRIGATION]: IMPROVEMENT_TYPES.FARMLAND
} as const;

export const IMPROVEMENT_REQUIREMENTS = {
    [IMPROVEMENT_TYPES.RAILROAD]: IMPROVEMENT_TYPES.ROAD,
    [IMPROVEMENT_TYPES.FARMLAND]: IMPROVEMENT_TYPES.IRRIGATION
} as const;