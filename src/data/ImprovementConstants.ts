// Improvement Constants - Terrain improvements and their properties

export interface ImprovementProperties {
    name: string;
    cost: number;
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
        cost: 2,
        turns: 5,
        effects: {
            food: 1,
            movement: 0.5
        },
        terrainRestrictions: ['grassland', 'plains', 'desert']
    },
    [IMPROVEMENT_TYPES.ROAD]: {
        name: 'Road',
        cost: 1,
        turns: 3,
        effects: {
            movement: 0.5,
            trade: 0.5
        }
    },
    [IMPROVEMENT_TYPES.RAILROAD]: {
        name: 'Railroad',
        cost: 3,
        turns: 6,
        effects: {
            movement: 0.25,
            trade: 1
        },
        requiredTech: 'railroad'
    },
    [IMPROVEMENT_TYPES.MINES]: {
        name: 'Mines',
        cost: 3,
        turns: 8,
        effects: {
            production: 1
        },
        terrainRestrictions: ['mountains', 'hills']
    },
    [IMPROVEMENT_TYPES.FORTRESS]: {
        name: 'Fortress',
        cost: 4,
        turns: 6,
        effects: {
            defense: 1.8,
            movement: 0.5
        }
    },
    [IMPROVEMENT_TYPES.POLLUTION]: {
        name: 'Pollution',
        cost: 0,
        turns: 0,
        effects: {
            food: -1,
            production: -1,
            trade: -1,
            health: -1
        }
    },
    [IMPROVEMENT_TYPES.FARMLAND]: {
        name: 'Farmland',
        cost: 4,
        turns: 10,
        effects: {
            food: 2,
            production: -1
        },
        terrainRestrictions: ['grassland', 'plains'],
        requiredTech: 'agriculture'
    },
    [IMPROVEMENT_TYPES.AIRPORT]: {
        name: 'Airport',
        cost: 5,
        turns: 8,
        effects: {
            airbase: true,
            movement: 0.5
        },
        requiredTech: 'flight'
    },
    [IMPROVEMENT_TYPES.PORT]: {
        name: 'Port',
        cost: 4,
        turns: 8,
        effects: {
            navalBase: true,
            trade: 1
        },
        terrainRestrictions: ['coast'],
        requiredTech: 'navigation'
    },
    [IMPROVEMENT_TYPES.SUPERHIGHWAYS]: {
        name: 'Superhighways',
        cost: 6,
        turns: 12,
        effects: {
            movement: 0.1,
            trade: 2,
            pollution: 1
        },
        requiredTech: 'automobile'
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