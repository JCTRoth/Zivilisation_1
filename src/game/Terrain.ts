// Terrain and Tile System - Legacy Implementation (Converted to TypeScript)

import { Constants } from '../utils/Constants';
import { ArrayUtils, MathUtils } from '../utils/Helpers';

// Type definitions
interface Improvement {
    type: string;
    turns: number;
    complete: boolean;
}

interface Resource {
    type?: string;
    food: number;
    production: number;
    trade: number;
    terrain: string[];
}

interface ImprovementProperties {
    name: string;
    food: number;
    production: number;
    trade: number;
    buildTurns: number;
    allowedTerrain: string[] | null;
    requiresResource: string | null;
    prerequisite?: string;
    defenseBonus?: number;
    convertsTo?: string;
}

interface TerrainConstants {
    TERRAIN_PROPS: Record<string, any>;
    RESOURCE_PROPS: Record<string, any>;
    IMPROVEMENT_PROPS: Record<string, ImprovementProperties>;
}

// Extend Constants with terrain-specific properties
const TERRAIN_CONSTANTS: TerrainConstants = {
    TERRAIN_PROPS: Constants.TERRAIN_PROPS,
    RESOURCE_PROPS: Constants.RESOURCE_PROPS,
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
        },
        // Terrain conversion improvements
        convertToGrassland: {
            name: 'Convert to Grassland',
            food: 0,
            production: 0,
            trade: 0,
            buildTurns: 8,
            allowedTerrain: ['jungle', 'swamp'],
            requiresResource: null,
            convertsTo: 'grassland'
        },
        convertToForest: {
            name: 'Convert to Forest',
            food: 0,
            production: 0,
            trade: 0,
            buildTurns: 8,
            allowedTerrain: ['jungle', 'swamp', 'grassland'],
            requiresResource: null,
            convertsTo: 'forest'
        },
        convertToPlains: {
            name: 'Convert to Plains',
            food: 0,
            production: 0,
            trade: 0,
            buildTurns: 8,
            allowedTerrain: ['forest'],
            requiresResource: null,
            convertsTo: 'plains'
        }
    }
};

// Terrain and Tile System
export class Tile {
    public col: number;
    public row: number;
    public terrain: string;
    public improvements: Improvement[];
    public resources: Resource | null;
    public visibility: Record<string, boolean>;
    public explored: Record<string, boolean>;
    public pollution: boolean;

    public baseFood: number;
    public baseProduction: number;
    public baseTrade: number;
    public movementCost: number;
    public defenseBonus: number;

    constructor(col: number, row: number, terrain: string) {
        this.col = col;
        this.row = row;
        this.terrain = terrain;
        this.improvements = [];
        this.resources = null;
        this.visibility = {};
        this.explored = {};
        this.pollution = false;

        // Calculate base yields
        this.calculateYields();

        // Generate special resources
        this.generateSpecialResource();
    }

    // Generate special resources based on terrain type
    generateSpecialResource(): void {
        // Check each resource type to see if it can appear on this terrain
        for (const [resourceType, resourceProps] of Object.entries(TERRAIN_CONSTANTS.RESOURCE_PROPS)) {
            if (resourceProps.terrain.includes(this.terrain)) {
                // Random chance for resource to appear (adjust probability as needed)
                const probability = 0.15; // 15% chance for any resource
                if (Math.random() < probability) {
                    this.resources = {
                        type: resourceType,
                        food: resourceProps.food,
                        production: resourceProps.production,
                        trade: resourceProps.trade,
                        terrain: resourceProps.terrain
                    };
                    break; // Only one special resource per tile
                }
            }
        }
    }

    calculateYields(): void {
        const terrainProps = TERRAIN_CONSTANTS.TERRAIN_PROPS[this.terrain];
        if (!terrainProps) {
            console.warn(`Unknown terrain type: ${this.terrain}`);
            return;
        }

        this.baseFood = terrainProps.food;
        this.baseProduction = terrainProps.production;
        this.baseTrade = terrainProps.trade;
        this.movementCost = terrainProps.movement;
        this.defenseBonus = terrainProps.defense;
    }

    // Get effective yields considering improvements and resources
    getYields(): { food: number; production: number; trade: number } {
        let food = this.baseFood;
        let production = this.baseProduction;
        let trade = this.baseTrade;

        // Apply resource bonuses
        if (this.resources) {
            food += this.resources.food || 0;
            production += this.resources.production || 0;
            trade += this.resources.trade || 0;
        }

        // Apply improvement bonuses
        this.improvements.forEach(improvement => {
            const improvementProps = TERRAIN_CONSTANTS.IMPROVEMENT_PROPS[improvement.type];
            if (improvementProps) {
                food += improvementProps.food || 0;
                production += improvementProps.production || 0;
                trade += improvementProps.trade || 0;
            }
        });

        // Apply pollution penalty
        if (this.pollution) {
            food = Math.max(0, food - 1);
            production = Math.max(0, production - 1);
        }

        return { food, production, trade };
    }

    // Check if tile can be improved
    canImprove(improvementType: string): boolean {
        const improvement = TERRAIN_CONSTANTS.IMPROVEMENT_PROPS[improvementType];
        if (!improvement) return false;

        // Check if already has this improvement
        if (this.hasImprovement(improvementType)) return false;

        // Check terrain compatibility
        if (improvement.allowedTerrain &&
            !improvement.allowedTerrain.includes(this.terrain)) {
            return false;
        }

        // Check resource compatibility
        if (improvement.requiresResource &&
            (!this.resources || this.resources.type !== improvement.requiresResource)) {
            return false;
        }

        return true;
    }

    // Add improvement to tile
    addImprovement(improvementType: string): boolean {
        if (!this.canImprove(improvementType)) return false;

        const improvement: Improvement = {
            type: improvementType,
            turns: 0,
            complete: false
        };

        this.improvements.push(improvement);
        return true;
    }

    // Complete an improvement on this tile
    completeImprovement(improvementType: string): boolean {
        const improvement = this.improvements.find(imp => imp.type === improvementType && !imp.complete);
        if (!improvement) return false;

        improvement.complete = true;
        improvement.turns = TERRAIN_CONSTANTS.IMPROVEMENT_PROPS[improvementType].buildTurns;

        // Handle terrain conversion if this is a conversion improvement
        const improvementProps = TERRAIN_CONSTANTS.IMPROVEMENT_PROPS[improvementType];
        if (improvementProps.convertsTo) {
            this.convertTerrain(improvementProps.convertsTo);
        }

        return true;
    }

    // Convert terrain to a new type
    convertTerrain(newTerrainType: string): void {
        // Check if the new terrain type exists
        if (!TERRAIN_CONSTANTS.TERRAIN_PROPS[newTerrainType]) {
            console.warn(`Unknown terrain type for conversion: ${newTerrainType}`);
            return;
        }

        // Store old terrain for potential resource loss
        const oldTerrain = this.terrain;

        // Convert terrain
        this.terrain = newTerrainType;

        // Recalculate yields for new terrain
        this.calculateYields();

        // Check if special resource is still valid on new terrain
        if (this.resources) {
            const resourceProps = TERRAIN_CONSTANTS.RESOURCE_PROPS[this.resources.type!];
            if (!resourceProps.terrain.includes(newTerrainType)) {
                // Resource is lost when terrain is converted
                this.resources = null;
            }
        }

        // Remove incompatible improvements
        this.improvements = this.improvements.filter(improvement => {
            const improvementProps = TERRAIN_CONSTANTS.IMPROVEMENT_PROPS[improvement.type];
            if (!improvementProps.allowedTerrain) return true; // Improvement works on any terrain
            return improvementProps.allowedTerrain.includes(newTerrainType);
        });
    }

    // Check if tile has specific improvement
    hasImprovement(improvementType: string): boolean {
        return this.improvements.some(imp => imp.type === improvementType && imp.complete);
    }

    // Remove improvement from tile
    removeImprovement(improvementType: string): void {
        this.improvements = this.improvements.filter(imp => imp.type !== improvementType);
    }

    // Set tile visibility for civilization
    setVisibility(civId: string, visible: boolean): void {
        this.visibility[civId] = visible;
    }

    // Check if tile is visible to civilization
    isVisible(civId: string): boolean {
        return this.visibility[civId] || false;
    }

    // Set tile exploration status for civilization
    setExplored(civId: string, explored: boolean): void {
        this.explored[civId] = explored;
    }

    // Check if tile is explored by civilization
    isExplored(civId: string): boolean {
        return this.explored[civId] || false;
    }

    // Get movement cost for unit
    getMovementCost(unit: any): number {
        let cost = this.movementCost;

        // Apply unit-specific modifiers
        const unitProps = Constants.UNIT_PROPS[unit.type];
        if (unitProps.naval && this.terrain !== Constants.TERRAIN.OCEAN) {
            return Infinity; // Naval units can't enter land
        }

        if (!unitProps.naval && this.terrain === Constants.TERRAIN.OCEAN) {
            return Infinity; // Land units can't enter ocean
        }

        // Roads reduce movement cost
        if (this.hasImprovement('road')) {
            cost = Math.min(cost, 1/3);
        }

        return cost;
    }

    // Get defense bonus for unit on this tile
    getDefenseBonus(): number {
        let bonus = this.defenseBonus;

        // City walls provide additional defense
        if (this.hasImprovement('walls')) {
            bonus += 2;
        }

        // Fortifications provide defense bonus
        if (this.hasImprovement('fortress')) {
            bonus += 1;
        }

        return bonus;
    }
}

// Resource types and properties
export const RESOURCE_TYPES = {
    WHEAT: 'wheat',
    CATTLE: 'cattle',
    FISH: 'fish',
    COAL: 'coal',
    IRON: 'iron',
    GOLD: 'gold',
    GEMS: 'gems',
    SILK: 'silk',
    SPICES: 'spices',
    WHALES: 'whales'
};

export const RESOURCE_PROPS: Record<string, Resource> = {
    wheat: { food: 1, production: 0, trade: 0, terrain: ['grassland', 'plains'] },
    cattle: { food: 1, production: 0, trade: 0, terrain: ['grassland', 'plains'] },
    fish: { food: 2, production: 0, trade: 0, terrain: ['ocean'] },
    coal: { food: 0, production: 1, trade: 0, terrain: ['hills', 'mountains'] },
    iron: { food: 0, production: 1, trade: 0, terrain: ['hills', 'mountains'] },
    gold: { food: 0, production: 0, trade: 3, terrain: ['hills', 'mountains'] },
    gems: { food: 0, production: 0, trade: 4, terrain: ['hills', 'mountains'] },
    silk: { food: 0, production: 0, trade: 2, terrain: ['forest', 'grassland'] },
    spices: { food: 0, production: 0, trade: 3, terrain: ['grassland', 'plains'] },
    whales: { food: 1, production: 0, trade: 2, terrain: ['ocean'] }
};

// Improvement types
export const IMPROVEMENT_TYPES = {
    ROAD: 'road',
    RAILROAD: 'railroad',
    IRRIGATION: 'irrigation',
    MINE: 'mine',
    FORTRESS: 'fortress',
    AIRBASE: 'airbase'
};

// Terrain Generator
export class TerrainGenerator {
    private width: number;
    private height: number;
    private seed: number;
    private noise: SimplexNoise;

    constructor(width: number, height: number, seed: number | null = null) {
        this.width = width;
        this.height = height;
        this.seed = seed || Math.random();
        this.noise = new SimplexNoise(this.seed);
    }

    generateTerrain(): Tile[][] {
        const tiles: Tile[][] = ArrayUtils.create2D(this.width, this.height) as Tile[][];

        // Generate base terrain using noise
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const terrain = this.getTerrainAtPosition(col, row);
                tiles[row][col] = new Tile(col, row, terrain);
            }
        }

        // Post-process to ensure realistic terrain distribution
        this.postProcessTerrain(tiles);

        // Add resources
        this.addResources(tiles);

        return tiles;
    }

    private getTerrainAtPosition(col: number, row: number): string {
        const scale = 0.05;
        const elevation = this.noise.noise2D(col * scale, row * scale);
        const temperature = this.noise.noise2D((col + 1000) * scale, (row + 1000) * scale);
        const humidity = this.noise.noise2D((col + 2000) * scale, (row + 2000) * scale);

        // Ocean (lowest elevation)
        if (elevation < -0.3) {
            return Constants.TERRAIN.OCEAN;
        }

        // Mountains (highest elevation)
        if (elevation > 0.4) {
            return Constants.TERRAIN.MOUNTAINS;
        }

        // Hills (high elevation)
        if (elevation > 0.2) {
            return Constants.TERRAIN.HILLS;
        }

        // Temperature and humidity based terrain
        if (temperature < -0.2) {
            return Constants.TERRAIN.TUNDRA;
        }

        if (temperature > 0.3 && humidity < -0.2) {
            return Constants.TERRAIN.DESERT;
        }

        // Forest (moderate temperature and high humidity)
        if (humidity > 0.2 && temperature > -0.1 && temperature < 0.3) {
            return Constants.TERRAIN.FOREST;
        }

        // Plains (moderate conditions)
        if (humidity < 0.1) {
            return Constants.TERRAIN.PLAINS;
        }

        // Default to grassland
        return Constants.TERRAIN.GRASSLAND;
    }

    private postProcessTerrain(tiles: Tile[][]): void {
        // Ensure continents are formed properly
        this.smoothCoastlines(tiles);

        // Add some rivers (simplified)
        this.addRivers(tiles);
    }

    private smoothCoastlines(tiles: Tile[][]): void {
        const newTiles: Tile[][] = ArrayUtils.create2D(this.width, this.height) as Tile[][];

        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const currentTile = tiles[row][col];
                let oceanNeighbors = 0;
                let landNeighbors = 0;

                // Count ocean vs land neighbors
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const newRow = row + dr;
                        const newCol = col + dc;

                        if (newRow >= 0 && newRow < this.height &&
                            newCol >= 0 && newCol < this.width) {
                            if (tiles[newRow][newCol].terrain === Constants.TERRAIN.OCEAN) {
                                oceanNeighbors++;
                            } else {
                                landNeighbors++;
                            }
                        }
                    }
                }

                // Smooth isolated tiles
                if (currentTile.terrain === Constants.TERRAIN.OCEAN && oceanNeighbors < 3) {
                    newTiles[row][col] = new Tile(col, row, Constants.TERRAIN.GRASSLAND);
                } else if (currentTile.terrain !== Constants.TERRAIN.OCEAN && landNeighbors < 3) {
                    newTiles[row][col] = new Tile(col, row, Constants.TERRAIN.OCEAN);
                } else {
                    newTiles[row][col] = currentTile;
                }
            }
        }

        // Copy smoothed tiles back
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                tiles[row][col] = newTiles[row][col];
            }
        }
    }

    private addRivers(tiles: Tile[][]): void {
        // Simple river generation - find paths from mountains to ocean
        const riverSources: { col: number; row: number }[] = [];

        // Find potential river sources (mountains)
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                if (tiles[row][col].terrain === Constants.TERRAIN.MOUNTAINS) {
                    riverSources.push({ col, row });
                }
            }
        }

        // Generate rivers from some sources
        const riverCount = Math.floor(riverSources.length * 0.1);
        for (let i = 0; i < riverCount; i++) {
            const source = MathUtils.randomChoice(riverSources);
            this.generateRiver(tiles, source.col, source.row);
        }
    }

    private generateRiver(tiles: Tile[][], startCol: number, startRow: number): void {
        // Simple river generation - not implemented in detail for this demo
        // Would involve pathfinding toward lower elevation or ocean
    }

    private addResources(tiles: Tile[][]): void {
        const resourceChance = 0.15; // 15% of tiles get resources

        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const tile = tiles[row][col];

                if (Math.random() < resourceChance) {
                    const compatibleResources = this.getCompatibleResources(tile.terrain);
                    if (compatibleResources.length > 0) {
                        const resourceType = MathUtils.randomChoice(compatibleResources);
                        tile.resources = {
                            type: resourceType,
                            ...RESOURCE_PROPS[resourceType]
                        };
                    }
                }
            }
        }
    }

    private getCompatibleResources(terrain: string): string[] {
        const compatible: string[] = [];

        for (const [resourceType, props] of Object.entries(RESOURCE_PROPS)) {
            if (props.terrain.includes(terrain)) {
                compatible.push(resourceType);
            }
        }

        return compatible;
    }
}

// Simplified Simplex Noise implementation
class SimplexNoise {
    private p: number[];
    private perm: number[];

    constructor(seed: number) {
        this.p = [];
        this.perm = [];

        // Initialize permutation table with seed
        for (let i = 0; i < 256; i++) {
            this.p[i] = Math.floor(Math.random() * 256);
        }

        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
        }
    }

    noise2D(x: number, y: number): number {
        // Simplified noise function
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;

        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);

        const u = MathUtils.fade(xf);
        const v = MathUtils.fade(yf);

        const aa = this.perm[this.perm[xi] + yi];
        const ab = this.perm[this.perm[xi] + yi + 1];
        const ba = this.perm[this.perm[xi + 1] + yi];
        const bb = this.perm[this.perm[xi + 1] + yi + 1];

        const x1 = MathUtils.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
        const x2 = MathUtils.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);

        return MathUtils.lerp(x1, x2, v);
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private grad(hash: number, x: number, y: number): number {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
}