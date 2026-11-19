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
    effects: Record<string, number>;
    terrainRestrictions?: string[];
    requiredTech?: string;
    display?: ImprovementDisplayConfig;
    /** Terrain the tile converts to when built on a `convertibleTerrains` tile (e.g. jungle -> grassland). */
    convertsTo?: string;
    /** Terrains on which building this transforms the tile instead of leaving an improvement. */
    convertibleTerrains?: string[];
    /** Terrain the tile clears to (e.g. forest -> plains). */
    clearsTo?: string;
    /** Terrains on which building this clears the tile. */
    clearableTerrains?: string[];
    /**
     * Civ1 construction time in worker-turns, per terrain type (the source of
     * truth for both buildability — a missing entry means the improvement
     * cannot be built there — and how long a settler works on the tile).
     */
    turnsByTerrain?: Record<string, number>;
    /**
     * Civ1 terrain transformation: terrain -> new terrain. Applied when the
     * improvement completes (e.g. irrigating grassland becomes forest).
     */
    convertsToByTerrain?: Record<string, string>;
    /** Per-terrain yield effects (Civ1 mines: hills +3 production, mountains +1). */
    effectsByTerrain?: Record<string, Record<string, number>>;
    /** Terrains on which this improvement grants +1 trade (Civ1 road on grassland/plains/desert). */
    tradeBonusTerrains?: string[];
    /** Movement cost to enter a tile carrying this improvement (Civ1 road = 1/3, railroad = free). */
    movementCost?: number;
    /** Roads on rivers require the bridge-building tech. */
    riverBridgeRequired?: boolean;
    /** Final multiplicative defense bonus in combat (Civ1 fortress = 2 -> +100%). */
    defenseMultiplier?: number;
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
        // Civ1 settler actions: normal irrigation is for fertile land and the
        // three listed terrain conversions are explicit exceptions.
        turnsByTerrain: {
            desert: 5,
            grassland: 5,
            plains: 5,
            river: 5,
            forest: 15,
            jungle: 15,
            swamp: 15,
        },
        terrainRestrictions: ['desert', 'forest', 'grassland', 'jungle', 'plains', 'river', 'swamp'],
        // Civ1 terrain transformation: forest -> plains, swamp/jungle -> grassland.
        convertsToByTerrain: {
            forest: 'plains',
            jungle: 'grassland',
            swamp: 'grassland',
        },
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
            trade: 0
        },
        // Civ1 construction times by terrain. Settlers cannot improve water.
        turnsByTerrain: {
            arctic: 6,
            desert: 2,
            forest: 4,
            grassland: 2,
            hills: 4,
            jungle: 4,
            mountains: 6,
            plains: 2,
            river: 2,
            swamp: 4,
            tundra: 2,
        },
        // Civ1: roads give +1 trade only on grassland/plains/desert (never on rivers).
        tradeBonusTerrains: ['grassland', 'plains', 'desert'],
        // Civ1: moving road-to-road costs 1/3 of a movement point.
        movementCost: 1 / 3,
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
        // Railroads always require an existing road and remain land-only.
        turnsByTerrain: {
            desert: 4,
            forest: 8,
            grassland: 4,
            hills: 8,
            jungle: 8,
            mountains: 12,
            plains: 4,
            river: 4,
            swamp: 8,
            tundra: 4,
        },
        // Civ1: moving railroad-to-road costs no movement point (tiny epsilon for A*).
        movementCost: 0.05,
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
        turns: 5,
        effects: {
            production: 0
        },
        // Civ1 mine actions: hills/mountains/desert are mineable; plains and
        // grassland are the terrain-transformation exceptions.
        turnsByTerrain: {
            desert: 5,
            grassland: 10,
            hills: 10,
            mountains: 10,
            plains: 15,
        },
        terrainRestrictions: ['desert', 'grassland', 'hills', 'mountains', 'plains'],
        // Civ1 terrain transformation: plains/grassland -> forest.
        effectsByTerrain: {
            mountains: { production: 1 },
            hills: { production: 3 }
        },
        convertsToByTerrain: {
            grassland: 'forest',
            plains: 'forest',
        },
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
            defense: 0,
        },
        // Civ1 construction times by terrain (no fortress on arctic).
        turnsByTerrain: {
            desert: 5,
            forest: 6,
            grassland: 5,
            hills: 6,
            jungle: 6,
            mountains: 7,
            plains: 5,
            river: 5,
            swamp: 6,
            tundra: 5,
        },
        // Civ1: +100% defense, applied last in the combat calculation.
        defenseMultiplier: 2,
        requiredTech: 'construction',
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
    },
};


export const IMPROVEMENT_REQUIREMENTS = {
    [IMPROVEMENT_TYPES.RAILROAD]: IMPROVEMENT_TYPES.ROAD,
} as const;
