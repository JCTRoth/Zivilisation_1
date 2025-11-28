// City System - Legacy Implementation (Converted to TypeScript)

import { Constants } from '../utils/Constants';
import type { Civilization } from './Civilization';
import { CIVILIZATIONS } from '../data/GameData';
import EventEmitter from "node:events";
import {GameUtils} from "@/utils/GameUtils";
import {MathUtils} from "@/utils/MathUtils";

// Type definitions

interface BuildingEffects {
    foodBonus?: number;
    productionBonus?: number;
    tradeBonus?: number;
    goldBonus?: number;
    scienceBonus?: number;
    foodStorage?: number;
    unitExperience?: number;
    happiness?: number;
    defense?: number;
    maxPopulation?: number;
}

// Provide a CITY_NAMES export for legacy modules. Prefer names from `CIVILIZATIONS` data if present.
export const CITY_NAMES: Record<string, string[]> = (() => {
    const mapping: Record<string, string[]> = {};
    try {
        if (Array.isArray(CIVILIZATIONS) && CIVILIZATIONS.length > 0) {
            CIVILIZATIONS.forEach((civ, idx) => {
                const names = Array.isArray(civ.cityNames) ? civ.cityNames : [];
                // numeric key (stringified index)
                mapping[String(idx)] = names;
                // key by civilization name lowercased
                if (civ.name) mapping[civ.name.toLowerCase()] = names;
            });
        }
    } catch (e) {
        // ignore and return whatever mapping we have
    }
    return mapping;
})();

interface Building {
    name: string;
    cost: number;
    maintenance: number;
    effects: BuildingEffects;
}

interface ProductionItem {
    type: 'unit' | 'building';
    itemType: string;
    name?: string;
    cost?: number;
}

interface CityInfo {
    id: string;
    name: string;
    position: { col: number; row: number };
    population: number;
    maxPopulation: number;
    food: number;
    production: number;
    trade: number;
    science: number;
    gold: number;
    buildings: string[];
    civilization: string;
    supportedUnits: string[];
}

interface SerializedCity {
    id: string;
    name: string;
    civilizationId: string;
    col: number;
    row: number;
    population: number;
    foodStorage: number;
    buildings: string[];
    buildQueue: ProductionItem[];
    currentProduction: ProductionItem | null;
    productionProgress: number;
    carriedOverProgress: number;
    workingTiles: string[];
    founded: number;
    supportedUnitIds: string[];
}

// City System
export class City extends EventEmitter {
    public id: string;
    public name: string;
    public civilization: Civilization;
    public col: number;
    public row: number;

    // City stats
    public population: number;
    public maxPopulation: number;
    public food: number;
    public production: number;
    public trade: number;
    public science: number;
    public gold: number;
    public yields: { food: number; production: number; trade: number };

    // Storage
    public foodStorage: number;
    public maxFoodStorage: number;

    // Buildings and improvements
    public buildings: Set<string>;
    public buildQueue: ProductionItem[];
    public currentProduction: ProductionItem | null;
    public productionProgress: number;
    public carriedOverProgress: number;
    public purchasedThisTurn: ProductionItem[];

    // Working tiles
    public workingTiles: Set<string>;
    public assignedTiles: Map<string, string>;

    // City state
    public founded: number;
    public happiness: number;
    public unhappiness: number;
    public disorder: boolean;

    // Unit support and garrison
    public supportedUnitIds: Set<string>;

    constructor(name: string, civilization: Civilization, col: number, row: number) {
        super();

        this.id = GameUtils.generateId();
        this.name = name;
        this.civilization = civilization;
        this.col = col;
        this.row = row;

        // City stats
        this.population = 1;
        this.maxPopulation = 4;
        this.food = 0;
        this.production = 0;
        this.trade = 0;
        this.science = 0;
        this.gold = 0;
        this.yields = { food: 0, production: 0, trade: 0 };

        // Storage
        this.foodStorage = 10;
        this.maxFoodStorage = 20;

        // Buildings and improvements
        this.buildings = new Set();
        this.buildQueue = [];
        this.currentProduction = null;
        this.productionProgress = 0;
        this.carriedOverProgress = 0;
        this.purchasedThisTurn = [];

        // Working tiles
        this.workingTiles = new Set();
        this.assignedTiles = new Map();

        // City state
        this.founded = 0;
        this.happiness = 50;
        this.unhappiness = 0;
        this.disorder = false;

        // Unit support and garrison
        this.supportedUnitIds = new Set();

        // Initialize with city center
        this.workingTiles.add(`${col},${row}`);
    }

    // Process city turn
    processTurn(gameMap: any, turn: number): void {
        // Calculate yields from worked tiles
        this.calculateYields(gameMap);

        // Check if we need to start production from queue
        if (!this.currentProduction && this.buildQueue.length > 0) {
            this.startNextProduction();
        }

        // Process food
        this.processFood(gameMap);

        // Process production
        this.processProduction();

        // Process unit support and maintenance
        this.processUnitSupport(gameMap);

        // Calculate happiness
        this.calculateHappiness();

        // Update city state
        this.updateCityState();

        this.emit('turnProcessed', { city: this, turn });
    }

    // Calculate yields from all worked tiles
    calculateYields(gameMap: any): void {
        let totalFood = 0;
        let totalProduction = 0;
        let totalTrade = 0;

        for (const tileKey of this.workingTiles) {
            const [col, row] = tileKey.split(',').map(Number);
            const tile = gameMap.getTile(col, row);

            if (tile) {
                const yields = tile.getYields();
                totalFood += yields.food;
                totalProduction += yields.production;
                totalTrade += yields.trade;
            }
        }

        // Apply building bonuses
        totalFood = this.applyBuildingBonuses('food', totalFood);
        totalProduction = this.applyBuildingBonuses('production', totalProduction);
        totalTrade = this.applyBuildingBonuses('trade', totalTrade);

        // Calculate derived values
        this.food = totalFood;
        this.production = totalProduction;
        this.trade = totalTrade;

        // Set yields object for external access
        this.yields = {
            food: totalFood,
            production: totalProduction,
            trade: totalTrade
        };

        // Split trade between gold and science
        this.gold = Math.floor(totalTrade * 0.5);
        this.science = Math.floor(totalTrade * 0.5);

        // Apply building effects to gold and science
        this.gold = this.applyBuildingBonuses('gold', this.gold);
        this.science = this.applyBuildingBonuses('science', this.science);
    }

    // Apply building bonuses to yields
    applyBuildingBonuses(yieldType: string, baseYield: number): number {
        let modifiedYield = baseYield;

        for (const buildingType of this.buildings) {
            const building = Constants.BUILDING_PROPS[buildingType];
            if (!building || !building.effects) continue;

            switch (yieldType) {
                case 'food':
                    if ((building.effects as any).foodBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + (building.effects as any).foodBonus));
                    }
                    break;
                case 'production':
                    if ((building.effects as any).productionBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + (building.effects as any).productionBonus));
                    }
                    break;
                case 'trade':
                    if ((building.effects as any).tradeBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + (building.effects as any).tradeBonus));
                    }
                    break;
                case 'gold':
                    if ((building.effects as any).goldBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + (building.effects as any).goldBonus));
                    }
                    break;
                case 'science':
                    if ((building.effects as any).scienceBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + (building.effects as any).scienceBonus));
                    }
                    break;
            }
        }

        return modifiedYield;
    }

    // Process food consumption and growth
    processFood(gameMap: any): void {
        const foodNeeded = this.population * 2;
        const foodSurplus = this.food - foodNeeded;

        if (foodSurplus > 0) {
            // City is growing
            this.foodStorage += foodSurplus;

            const growthThreshold = this.getGrowthThreshold();
            if (this.foodStorage >= growthThreshold && this.population < this.maxPopulation) {
                this.grow(gameMap);
            }
        } else if (foodSurplus < 0) {
            // City is starving
            this.foodStorage += foodSurplus;

            if (this.foodStorage < 0) {
                this.starve();
            }
        }

        // Clamp food storage
        this.foodStorage = MathUtils.clamp(this.foodStorage, 0, this.maxFoodStorage);
    }

    // Get food needed to grow to next population level
    getGrowthThreshold(): number {
        return this.population * 10;
    }

    // Grow city population
    grow(gameMap: any): void {
        this.population++;
        this.foodStorage = 0;

        // Update max population based on buildings
        this.updateMaxPopulation();

        // Automatically assign new citizen to work best available tile
        this.autoAssignWorker(gameMap);

        this.emit('grown', { city: this, newPopulation: this.population });
    }

    // Handle starvation
    starve(): void {
        if (this.population > 1) {
            this.population--;
            this.foodStorage = 0;

            // Remove a worker from the least productive tile
            this.removeWorker();

            this.emit('starved', { city: this, newPopulation: this.population });
        }
    }

    // Process production
    processProduction(): void {
        if (!this.currentProduction) return;

        this.productionProgress += this.production;

        const cost = this.getProductionCost(this.currentProduction);
        if (this.productionProgress >= cost) {
            this.completeProduction();
        }
    }

    // Get production cost for item
    getProductionCost(item: ProductionItem): number {
        if (item.type === 'unit') {
            return Constants.UNIT_PROPS[item.itemType].cost;
        } else if (item.type === 'building') {
            return Constants.BUILDING_PROPS[item.itemType].cost;
        }
        return 0;
    }

    // Complete current production
    completeProduction(): void {
        if (!this.currentProduction) return;

        const item = this.currentProduction;
        const excessProduction = this.productionProgress - this.getProductionCost(item);

        if (item.type === 'unit') {
            this.produceUnit(item.itemType);
        } else if (item.type === 'building') {
            this.buildBuilding(item.itemType);
        }

        // Store excess production for next item
        this.carriedOverProgress = Math.max(0, excessProduction);

        // Start next item in queue
        this.startNextProduction();

        this.emit('productionCompleted', { city: this, item });
    }

    // Produce a unit
    produceUnit(unitType: string): void {
        const unit = new (require('./Unit').Unit)(unitType, this.civilization, this.col, this.row);

        // Set veteran status if city has barracks
        if (this.buildings.has('barracks')) {
            unit.veteran = true;
        }

        // Set this city as the unit's home city
        unit.homeCityId = this.id;
        this.supportedUnitIds.add(unit.id);

        const gameMap = this.civilization.gameMap;
        const existingUnit = gameMap.getUnitAt(this.col, this.row);

        if (existingUnit) {
            // Find adjacent tile for new unit
            const neighbors = gameMap.grid.getNeighbors(this.col, this.row);
            for (const neighbor of neighbors) {
                if (!gameMap.getUnitAt(neighbor.col, neighbor.row)) {
                    unit.col = neighbor.col;
                    unit.row = neighbor.row;
                    break;
                }
            }
        }

        gameMap.unitManager.addUnit(unit);
        this.emit('unitProduced', { city: this, unit });
    }

    // Build a building
    buildBuilding(buildingType: string): void {
        this.buildings.add(buildingType);

        // Apply building effects
        const building = Constants.BUILDING_PROPS[buildingType];
        if (building && building.effects) {
            if ((building.effects as any).maxPopulation) {
                this.maxPopulation += (building.effects as any).maxPopulation;
            }
            if ((building.effects as any).foodStorage) {
                this.maxFoodStorage += (building.effects as any).foodStorage;
            }
        }

        this.startNextProduction();
    }

    // Process unit support and maintenance costs
    processUnitSupport(gameMap: any): void {
        const maintenanceCost = this.calculateUnitMaintenanceCost(gameMap);

        // Check if city can afford to support all units
        if (this.production < maintenanceCost) {
            // City cannot support all units - disband excess units
            this.disbandUnits(gameMap, maintenanceCost);
        }
    }

    // Calculate total maintenance cost for all supported units
    calculateUnitMaintenanceCost(gameMap: any): number {
        let totalCost = 0;

        for (const unitId of this.supportedUnitIds) {
            const unit = gameMap.unitManager.getUnit(unitId);
            if (unit && unit.homeCityId === this.id) {
                totalCost += unit.maintenance;
            }
        }

        return totalCost;
    }

    // Disband units when city cannot afford maintenance
    disbandUnits(gameMap: any, maxAffordableCost: number): void {
        let currentCost = 0;
        const unitsToKeep: string[] = [];
        const unitsToDisband: string[] = [];

        // Sort units by distance from city (farthest first to disband)
        const supportedUnits = Array.from(this.supportedUnitIds)
            .map(unitId => gameMap.unitManager.getUnit(unitId))
            .filter(unit => unit && unit.homeCityId === this.id)
            .sort((a, b) => {
                const distA = gameMap.grid.squareDistance(this.col, this.row, a!.col, a!.row);
                const distB = gameMap.grid.squareDistance(this.col, this.row, b!.col, b!.row);
                return distB - distA; // Farthest first
            });

        for (const unit of supportedUnits) {
            if (unit && currentCost + unit.maintenance <= maxAffordableCost) {
                currentCost += unit.maintenance;
                unitsToKeep.push(unit.id);
            } else {
                unitsToDisband.push(unit.id);
            }
        }

        // Update supported units list
        this.supportedUnitIds = new Set(unitsToKeep);

        // Disband excess units
        for (const unitId of unitsToDisband) {
            const unit = gameMap.unitManager.getUnit(unitId);
            if (unit) {
                gameMap.unitManager.removeUnit(unitId);
                this.emit('unitDisbanded', { city: this, unit });
            }
        }
    }

    // Re-home a unit to this city
    rehomeUnit(unitId: string, gameMap: any): boolean {
        const unit = gameMap.unitManager.getUnit(unitId);
        if (!unit || unit.civilization.id !== this.civilization.id) {
            return false; // Can only re-home own civilization's units
        }

        // Remove from old home city
        if (unit.homeCityId) {
            // Find old home city in civilization's cities
            const oldHomeCity = this.civilization.cities.find((city: any) => city.id === unit.homeCityId);
            if (oldHomeCity && oldHomeCity !== this) {
                oldHomeCity.supportedUnitIds.delete(unitId);
            }
        }

        // Set new home city
        unit.homeCityId = this.id;
        this.supportedUnitIds.add(unitId);

        this.emit('unitRehomed', { city: this, unit, oldHomeCityId: unit.homeCityId });
        return true;
    }

    // Start next production from queue
    startNextProduction(): void {
        if (this.buildQueue.length > 0) {
            this.currentProduction = this.buildQueue.shift()!;
            this.productionProgress = this.carriedOverProgress;
            this.carriedOverProgress = 0;
        } else {
            this.currentProduction = null;
            this.productionProgress = 0;
        }
    }

    // Set production target
    setProduction(item: ProductionItem): void {
        this.currentProduction = item;
        this.productionProgress = this.carriedOverProgress;
        this.carriedOverProgress = 0;
        this.emit('productionChanged', { city: this, item });
    }

    // Add item to production queue
    queueProduction(item: ProductionItem): void {
        this.buildQueue.push(item);
        this.emit('productionQueued', { city: this, item });
    }

    // Calculate happiness
    calculateHappiness(): void {
        // Base happiness from buildings
        let happiness = 0;
        let unhappiness = this.population; // 1 unhappiness per citizen

        for (const buildingType of this.buildings) {
            const building = Constants.BUILDING_PROPS[buildingType];
            if (building && building.effects && (building.effects as any).happiness) {
                happiness += (building.effects as any).happiness;
            }
        }

        this.happiness = happiness;
        this.unhappiness = unhappiness;
    }

    // Update city state based on happiness
    updateCityState(): void {
        this.disorder = this.unhappiness > this.happiness;
    }

    // Update max population based on buildings
    updateMaxPopulation(): void {
        this.maxPopulation = 4; // Base

        for (const buildingType of this.buildings) {
            const building = Constants.BUILDING_PROPS[buildingType];
            if (building && building.effects && (building.effects as any).maxPopulation) {
                this.maxPopulation += (building.effects as any).maxPopulation;
            }
        }
    }

    // Auto-assign worker to best available tile
    autoAssignWorker(gameMap: any): void {
        this.optimizeWorkerAssignment(gameMap);
    }

    // Remove worker from least productive tile
    removeWorker(): void {
        if (this.workingTiles.size <= 1) return; // Keep at least city center

        const cityCenter = `${this.col},${this.row}`;
        const workedTiles = Array.from(this.workingTiles).filter(key => key !== cityCenter);

        if (workedTiles.length === 0) return;

        // Find tile with lowest score
        let worstTile = workedTiles[0];
        let worstScore = this.getTileScoreByKey(worstTile);

        for (const tileKey of workedTiles) {
            const score = this.getTileScoreByKey(tileKey);
            if (score < worstScore) {
                worstTile = tileKey;
                worstScore = score;
            }
        }

        this.unassignWorker(worstTile);
    }

    // Get available tiles for working (tiles in radius that aren't already worked)
    getAvailableTiles(gameMap: any): any[] {
        const availableTiles: any[] = [];
        const radiusTiles = this.getCityRadiusTiles(gameMap);

        for (const { col, row, tile } of radiusTiles) {
            const tileKey = `${col},${row}`;

            // Check if tile can be worked and isn't already assigned
            if (this.canWorkTile(col, row, gameMap) && !this.workingTiles.has(tileKey)) {
                availableTiles.push(tile);
            }
        }

        return availableTiles;
    }

    // Get all tiles within city radius (2 squares in every direction except diagonally)
    getCityRadiusTiles(gameMap: any): Array<{col: number, row: number, tile: any}> {
        const radiusTiles: Array<{col: number, row: number, tile: any}> = [];

        // City radius extends 2 squares in every direction except diagonally
        // This creates a diamond-shaped area around the city
        for (let dCol = -2; dCol <= 2; dCol++) {
            for (let dRow = -2; dRow <= 2; dRow++) {
                // Skip diagonals (only orthogonal and diagonal-adjacent tiles)
                const manhattanDistance = Math.abs(dCol) + Math.abs(dRow);
                if (manhattanDistance > 2 || manhattanDistance === 0) continue;

                const tileCol = this.col + dCol;
                const tileRow = this.row + dRow;

                // Check bounds
                if (tileCol >= 0 && tileCol < Constants.MAP_WIDTH &&
                    tileRow >= 0 && tileRow < Constants.MAP_HEIGHT) {

                    const tile = gameMap.getTile(tileCol, tileRow);
                    if (tile) {
                        radiusTiles.push({ col: tileCol, row: tileRow, tile });
                    }
                }
            }
        }

        return radiusTiles;
    }

    // Check if a tile can be worked by this city
    canWorkTile(tileCol: number, tileRow: number, gameMap: any): boolean {
        const tile = gameMap.getTile(tileCol, tileRow);
        if (!tile) return false;

        // Check if tile is within city radius
        const radiusTiles = this.getCityRadiusTiles(gameMap);
        const isInRadius = radiusTiles.some(t => t.col === tileCol && t.row === tileRow);
        if (!isInRadius) return false;

        // Check if tile is already worked by another city
        const tileKey = `${tileCol},${tileRow}`;
        if (this.workingTiles.has(tileKey)) return false;

        // Check if tile is explored by this civilization
        if (!tile.explored) return false;

        // Ocean tiles can only be worked if they have fish or are coastal
        const terrainType = tile.type;
        if (terrainType === 'ocean') {
            return tile.resource === 'fish' || this.isCoastalTile(tileCol, tileRow, gameMap);
        }

        return true;
    }

    // Check if a tile is coastal (adjacent to land)
    private isCoastalTile(tileCol: number, tileRow: number, gameMap: any): boolean {
        const neighbors = gameMap.grid.getNeighbors(tileCol, tileRow);
        return neighbors.some((neighbor: any) => {
            const neighborTile = gameMap.getTile(neighbor.col, neighbor.row);
            return neighborTile && neighborTile.type !== 'ocean';
        });
    }

    // Evaluate city site quality based on resources and terrain
    evaluateCitySite(gameMap: any): {
        foodPotential: number;
        productionPotential: number;
        tradePotential: number;
        resourceScore: number;
        riverBonus: boolean;
        overallScore: number;
    } {
        const radiusTiles = this.getCityRadiusTiles(gameMap);
        let foodPotential = 0;
        let productionPotential = 0;
        let tradePotential = 0;
        let resourceScore = 0;
        let hasRiver = false;

        for (const { tile } of radiusTiles) {
            const yields = tile.getYields();

            // Accumulate yields
            foodPotential += yields.food;
            productionPotential += yields.production;
            tradePotential += yields.trade;

            // Check for special resources
            if (tile.resource) {
                const resourceValue = this.getResourceValue(tile.resource);
                resourceScore += resourceValue;
            }

            // Check for river
            if (tile.hasRiver) {
                hasRiver = true;
                tradePotential += 1; // Rivers provide trade bonus
            }

            // Bonus for hills and forests (important resources)
            if (tile.type === 'hills' || tile.type === 'forest') {
                productionPotential += 0.5;
            }
        }

        // Calculate overall score
        // Cities need food to grow, production for buildings/units, trade for gold/science
        const overallScore = (foodPotential * 2) + productionPotential + (tradePotential * 1.5) + (resourceScore * 3) + (hasRiver ? 2 : 0);

        return {
            foodPotential,
            productionPotential,
            tradePotential,
            resourceScore,
            riverBonus: hasRiver,
            overallScore
        };
    }

    // Get value of special resource
    private getResourceValue(resource: string): number {
        const resourceValues: Record<string, number> = {
            'wheat': 1,
            'fish': 2,
            'game': 1,
            'gems': 3,
            'gold': 4,
            'horses': 2,
            'coal': 3,
            'oil': 3,
            'iron': 1,
            'silk': 2
        };

        return resourceValues[resource] || 0;
    }

    // Get tiles that can be worked (considering population limit)
    getWorkableTiles(gameMap: any): Array<{col: number, row: number, tile: any, yields: any}> {
        const workableTiles: Array<{col: number, row: number, tile: any, yields: any}> = [];
        const radiusTiles = this.getCityRadiusTiles(gameMap);

        for (const { col, row, tile } of radiusTiles) {
            if (this.canWorkTile(col, row, gameMap)) {
                const yields = tile.getYields();
                workableTiles.push({ col, row, tile, yields });
            }
        }

        // Sort by food production (most important for growth)
        workableTiles.sort((a, b) => b.yields.food - a.yields.food);

        return workableTiles;
    }

    // Auto-assign workers to best available tiles
    optimizeWorkerAssignment(gameMap: any): void {
        // Reset all assignments except city center
        const cityCenter = `${this.col},${this.row}`;
        this.workingTiles.clear();
        this.workingTiles.add(cityCenter);

        const workableTiles = this.getWorkableTiles(gameMap);
        const maxWorkers = Math.min(this.population, workableTiles.length + 1); // +1 for city center

        // Assign workers to best tiles (prioritize food for growth)
        for (let i = 0; i < maxWorkers - 1; i++) { // -1 because city center is already assigned
            if (i < workableTiles.length) {
                const tile = workableTiles[i];
                const tileKey = `${tile.col},${tile.row}`;
                this.workingTiles.add(tileKey);
            }
        }
    }

    // Serialize city for saving

    // Get score for tile (food priority for growth)
    getTileScore(tile: any): number {
        const yields = tile.getYields();
        return yields.food * 2 + yields.production + yields.trade;
    }

    // Get score for tile by key
    getTileScoreByKey(tileKey: string): number {
        // This would need gameMap parameter
        return 0;
    }

    // Assign worker to tile
    assignWorker(tile: any): void {
        const tileKey = `${tile.col},${tile.row}`;
        this.workingTiles.add(tileKey);
    }

    // Unassign worker from tile
    unassignWorker(tileKey: string): void {
        this.workingTiles.delete(tileKey);
    }

    // Get city information for UI
    getInfo(): CityInfo {
        return {
            id: this.id,
            name: this.name,
            position: { col: this.col, row: this.row },
            population: this.population,
            maxPopulation: this.maxPopulation,
            food: this.food,
            production: this.production,
            trade: this.trade,
            science: this.science,
            gold: this.gold,
            buildings: Array.from(this.buildings),
            civilization: this.civilization.name,
            supportedUnits: Array.from(this.supportedUnitIds)
        };
    }

    // Serialize city for saving
    serialize(): SerializedCity {
        return {
            id: this.id,
            name: this.name,
            civilizationId: this.civilization.id,
            col: this.col,
            row: this.row,
            population: this.population,
            foodStorage: this.foodStorage,
            buildings: Array.from(this.buildings),
            buildQueue: this.buildQueue,
            currentProduction: this.currentProduction,
            productionProgress: this.productionProgress,
            carriedOverProgress: this.carriedOverProgress,
            workingTiles: Array.from(this.workingTiles),
            founded: this.founded,
            supportedUnitIds: Array.from(this.supportedUnitIds)
        };
    }

    // Deserialize city from save data
    static deserialize(data: SerializedCity, civilization: Civilization): City {
        const city = new City(data.name, civilization, data.col, data.row);
        city.id = data.id;
        city.population = data.population;
        city.foodStorage = data.foodStorage;
        city.buildings = new Set(data.buildings);
        city.buildQueue = data.buildQueue;
        city.currentProduction = data.currentProduction;
        city.productionProgress = data.productionProgress;
        city.carriedOverProgress = data.carriedOverProgress || 0;
        city.workingTiles = new Set(data.workingTiles);
        city.founded = data.founded;
        city.supportedUnitIds = new Set(data.supportedUnitIds || []);
        return city;
    }
}


// City Manager - handles collections of cities
export class CityManager extends EventEmitter {
    private cities: Map<string, City>;
    private citiesByPosition: Map<string, City>;
    private citiesByCivilization: Map<string, City[]>;

    constructor() {
        super();
        this.cities = new Map();
        this.citiesByPosition = new Map();
        this.citiesByCivilization = new Map();
    }

    // Add city to manager
    addCity(city: City): void {
        this.cities.set(city.id, city);
        this.updatePositionIndex(city);
        this.updateCivilizationIndex(city);

        // Listen to city events
        city.on('grown', (data) => this.emit('cityGrown', data));
        city.on('starved', (data) => this.emit('cityStarved', data));
        city.on('productionCompleted', (data) => this.emit('cityProductionCompleted', data));
        city.on('buildingCompleted', (data) => this.emit('cityBuildingCompleted', data));
        city.on('unitProduced', (data) => this.emit('cityUnitProduced', data));

        this.emit('cityAdded', { city });
    }

    // Remove city from manager
    removeCity(cityId: string): boolean {
        const city = this.cities.get(cityId);
        if (!city) return false;

        this.cities.delete(cityId);
        this.removeFromPositionIndex(city);
        this.removeFromCivilizationIndex(city);

        this.emit('cityRemoved', { city });

        return true;
    }

    // Get city by ID
    getCity(cityId: string): City | undefined {
        return this.cities.get(cityId);
    }

    // Get city at position
    getCityAt(col: number, row: number): City | null {
        const key = `${col},${row}`;
        return this.citiesByPosition.get(key) || null;
    }

    // Get cities by civilization
    getCitiesByCivilization(civilizationId: string): City[] {
        return this.citiesByCivilization.get(civilizationId) || [];
    }

    // Get all cities
    getAllCities(): City[] {
        return Array.from(this.cities.values());
    }

    // Update position index
    private updatePositionIndex(city: City): void {
        this.removeFromPositionIndex(city);
        const key = `${city.col},${city.row}`;
        this.citiesByPosition.set(key, city);
    }

    // Remove from position index
    private removeFromPositionIndex(city: City): void {
        for (const [key, cityAtPos] of this.citiesByPosition.entries()) {
            if (cityAtPos === city) {
                this.citiesByPosition.delete(key);
                break;
            }
        }
    }

    // Update civilization index
    private updateCivilizationIndex(city: City): void {
        const civId = city.civilization.id;
        if (!this.citiesByCivilization.has(civId)) {
            this.citiesByCivilization.set(civId, []);
        }

        const civCities = this.citiesByCivilization.get(civId)!;
        if (!civCities.includes(city)) {
            civCities.push(city);
        }
    }

    // Remove from civilization index
    private removeFromCivilizationIndex(city: City): void {
        const civId = city.civilization.id;
        const civCities = this.citiesByCivilization.get(civId);

        if (civCities) {
            const index = civCities.indexOf(city);
            if (index !== -1) {
                civCities.splice(index, 1);

                if (civCities.length === 0) {
                    this.citiesByCivilization.delete(civId);
                }
            }
        }
    }

    // Process turn for all cities of civilization
    processTurnForCivilization(civilizationId: string, gameMap: any, turn: number): void {
        const cities = this.getCitiesByCivilization(civilizationId);
        cities.forEach(city => city.processTurn(gameMap, turn));
    }

    // Get next city name for civilization
    getNextCityName(civilizationId: string): string {
        const civCities = this.getCitiesByCivilization(civilizationId);
        const usedNames = new Set(civCities.map(city => city.name));

        const availableNames = CITY_NAMES[civilizationId] || CITY_NAMES.romans;

        for (const name of availableNames) {
            if (!usedNames.has(name)) {
                return name;
            }
        }

        // If all names used, generate numbered names
        const baseName = availableNames[0];
        let counter = 2;
        while (usedNames.has(`${baseName} ${counter}`)) {
            counter++;
        }

        return `${baseName} ${counter}`;
    }
}