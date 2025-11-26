// Improvement Constants - Terrain improvements and their properties

export interface ImprovementDisplayConfig {
    glyph?: string;
    label?: string;
    color?: string;
    font?: string;
    offsetX?: number;
    offsetY?: number;
    skipLabel?: boolean;
}

export interface TileImprovementConstants {
    name: string;
    turns: number;
    effects: Record<string, any>;
    terrainRestrictions?: string[];
    requiredTech?: string;
    display?: ImprovementDisplayConfig;
}

export const IMPROVEMENT_TYPES = {
    // Basic Improvements
    IRRIGATION: 'irrigation',
    ROAD: 'road',
    RAILROAD: 'railroad',
    MINES: 'mines',
    FORTRESS: 'fortress',
    POLLUTION: 'pollution',
} as const;

export const IMPROVEMENT_PROPERTIES: Record<string, TileImprovementConstants> = {
    [IMPROVEMENT_TYPES.IRRIGATION]: {
        name: 'Irrigation',
        turns: 2,
        effects: {
            food: 1,
        },
        terrainRestrictions: ['grassland', 'plains', 'desert'],
        display: {
            label: 'I',
            color: '#00ff77ff',
            font: 'bold 12px monospace',
            offsetX: 10,
            offsetY: -10
        }
    },
    [IMPROVEMENT_TYPES.ROAD]: {
        name: 'Road',
        turns: 1,
        effects: {
            trade: 0.5
        },
        display: {
            glyph: 'R',
            color: '#ff0000ff',
            font: 'bold 14px monospace',
            offsetX: 0,
            offsetY: 12,
            skipLabel: true
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
        requiredTech: 'railroad',
        display: {
            glyph: 'RR',
            color: '#830000ff',
            font: 'bold 14px monospace',
            offsetX: 0,
            offsetY: 12,
            skipLabel: true
        }
    },
    [IMPROVEMENT_TYPES.MINES]: {
        name: 'Mines',
        turns: 8,
        effects: {
            production: 1
        },
        terrainRestrictions: ['mountains', 'hills'],
        display: {
            label: 'M',
            color: '#444444',
            font: 'bold 12px monospace',
            offsetX: 10,
            offsetY: -10
        }
    },
    [IMPROVEMENT_TYPES.FORTRESS]: {
        name: 'Fortress',
        turns: 6,
        effects: {
            defense: 1.8,
        },
        display: {
            label: 'F',
            color: '#ffffffff',
            font: 'bold 12px monospace',
            offsetX: 10,
            offsetY: -10
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
        },
        display: {
            label: 'P',
            color: '#000000ff',
            font: 'bold 12px monospace',
            offsetX: 10,
            offsetY: -10
        }
    }
};


export const IMPROVEMENT_REQUIREMENTS = {
    [IMPROVEMENT_TYPES.RAILROAD]: IMPROVEMENT_TYPES.ROAD,
} as const;