// City System - Refactored to remove EventEmitter pattern

import { Constants } from '../utils/Constants';
import type { Civilization } from './Civilization';
import {GameUtils} from "@/utils/GameUtils";
import {MathUtils} from "@/utils/MathUtils";
import { BUILDING_TYPES } from '@/data/BuildingConstants';

// Type definitions

// BuildingEffects interface removed (unused)
// CITY_NAMES constant removed (unused)
// Building interface removed (unused)

/** Yields produced by a tile (food/production/trade) */
interface TileYields {
    food: number;
    production: number;
    trade: number;
}

/** A tile within the game map */
interface GameTile {
    type: string;
    resource?: string;
    hasRiver?: boolean;
    explored?: boolean;
    getYields(): TileYields;
    col: number;
    row: number;
}

/** Grid neighbor position */
interface GridNeighbor {
    col: number;
    row: number;
}

/** Building effects that modify city attributes */
interface BuildingEffects {
    foodBonus?: number;
    productionBonus?: number;
    tradeBonus?: number;
    goldBonus?: number;
    scienceBonus?: number;
    happiness?: number;
    maxPopulation?: number;
    foodStorage?: number;
}

/** A unit within the game engine (used by GameMap) */
interface GameUnit {
    id: string;
    type: string;
    civilization: Civilization;
    civilizationId: string;
    col: number;
    row: number;
    veteran?: boolean;
    homeCityId?: string;
    maintenance?: number;
    attackPoints?: number;
}

/** The game map object providing tile/unit access */
interface GameMap {
    getTile(col: number, row: number): GameTile | null;
    getUnitAt(col: number, row: number): GameUnit | null;
    grid: {
        getNeighbors(col: number, row: number): GridNeighbor[];
        squareDistance(col1: number, row1: number, col2: number, row2: number): number;
    };
    unitManager: {
        addUnit(unit: GameUnit): void;
        getUnit(unitId: string): GameUnit | undefined;
        removeUnit(unitId: string): boolean;
    };
}

interface ProductionItem {
    // Matches types/game.ProductionItem — built dynamically with string types.
    type: string;
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
    userAssignedTiles?: string[];
    governor?: string;
    governorDirty?: boolean;
    founded: number;
    supportedUnitIds: string[];
    hitPoints: number;
}

// City System
export class City {
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
    /** Tile keys ("col,row") the player manually assigned — never auto-overridden. */
    public userAssignedTiles: Set<string>;

    // City state
    public founded: number;
    public happiness: number;
    public unhappiness: number;
    public disorder: boolean;

    // Unit support and garrison
    public supportedUnitIds: Set<string>;
    
    // City combat properties
    public hitPoints: number;
    public maxHitPoints: number;
    
    // Callback for state changes (replaces EventEmitter)
    public onStateChange: ((eventType: string, data: unknown) => void) | null;

    constructor(name: string, civilization: Civilization, col: number, row: number) {
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
        this.userAssignedTiles = new Set();

        // City state
        this.founded = 0;
        this.happiness = 50;
        this.unhappiness = 0;
        this.disorder = false;

        // Unit support and garrison
        this.supportedUnitIds = new Set();
        
        // City combat properties - HP = population (1-20)
        this.maxHitPoints = 20;
        this.hitPoints = this.population;

        // Initialize with city center
        this.workingTiles.add(`${col},${row}`);
        
        // Initialize callback
        this.onStateChange = null;
    }

    // Process city turn
    processTurn(gameMap: GameMap, turn: number): void {
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

        if (this.onStateChange) { this.onStateChange('turnProcessed', { city: this, turn }); }
    }

    // Calculate yields from all worked tiles
    calculateYields(gameMap: GameMap): void {
        let totalFood = 0;
        let totalProduction = 0;
        let totalTrade = 0;

        for (const tileKey of this.workingTiles) {
            const [col, row] = tileKey.split(',').map(Number);
            const tile = gameMap.getTile(col, row);

            if (tile) {
                let yields = tile.getYields();
                
                // City center always produces minimum 2 food, 1 production, 1 trade
                if (col === this.col && row === this.row) {
                    yields = {
                        food: Math.max(yields.food, 2),
                        production: Math.max(yields.production, 1),
                        trade: Math.max(yields.trade, 1)
                    };
                    
                    // Rivers on city center add +1 trade
                    if (tile.hasRiver) {
                        yields.trade += 1;
                    }
                }
                
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

            const effects = building.effects as BuildingEffects;

            switch (yieldType) {
                case 'food':
                    if (effects.foodBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + effects.foodBonus));
                    }
                    break;
                case 'production':
                    if (effects.productionBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + effects.productionBonus));
                    }
                    break;
                case 'trade':
                    if (effects.tradeBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + effects.tradeBonus));
                    }
                    break;
                case 'gold':
                    if (effects.goldBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + effects.goldBonus));
                    }
                    break;
                case 'science':
                    if (effects.scienceBonus) {
                        modifiedYield = Math.floor(modifiedYield * (1 + effects.scienceBonus));
                    }
                    break;
            }
        }

        return modifiedYield;
    }

    // Process food consumption and growth
    processFood(gameMap: GameMap): void {
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
    // Civ1 formula: (current_population + 1) × 10
    // Size 1 → 20, Size 2 → 30, Size 3 → 40, etc.
    getGrowthThreshold(): number {
        return (this.population + 1) * 10;
    }

    // Grow city population
    // Civ1: a Granary only HALF empties the food box on growth; without a
    // granary the whole box empties (excess food beyond the threshold is lost).
    grow(gameMap: GameMap): void {
        const storedBeforeGrowth = this.foodStorage;
        this.population++;

        this.foodStorage = this.buildings.has(BUILDING_TYPES.GRANARY)
            ? Math.floor(storedBeforeGrowth / 2)
            : 0;

        // Update max population based on buildings
        this.updateMaxPopulation();
        
        // Update HP to match new population (restore 1 HP when growing)
        this.hitPoints = Math.min(this.population, this.hitPoints + 1);

        // Automatically assign new citizen to work best available tile
        this.autoAssignWorker(gameMap);

        if (this.onStateChange) { this.onStateChange('grown', { city: this, newPopulation: this.population }); }
    }

    // Handle starvation
    starve(): void {
        if (this.population > 1) {
            this.population--;
            this.foodStorage = 0;
            
            // HP also decreases with population
            this.hitPoints = this.population;

            // Remove a worker from the least productive tile
            this.removeWorker();

            if (this.onStateChange) { this.onStateChange('starved', { city: this, newPopulation: this.population }); }
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

        if (this.onStateChange) { this.onStateChange('productionCompleted', { city: this, item }); }
    }

    // Produce a unit
    produceUnit(unitType: string): void {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const UnitCtor: new (type: string, civilization: Civilization, col: number, row: number) => GameUnit = require('./Unit').Unit;
        const unit: GameUnit = new UnitCtor(unitType, this.civilization, this.col, this.row);

        // Set veteran status if city has barracks
        if (this.buildings.has(BUILDING_TYPES.BARRACKS)) {
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
        if (this.onStateChange) { this.onStateChange('unitProduced', { city: this, unit }); }
    }

    // Build a building
    buildBuilding(buildingType: string): void {
        this.buildings.add(buildingType);

        // Apply building effects
        const building = Constants.BUILDING_PROPS[buildingType];
        if (building && building.effects) {
            const effects = building.effects as BuildingEffects;
            if (effects.maxPopulation) {
                this.maxPopulation += effects.maxPopulation;
            }
            if (effects.foodStorage) {
                this.maxFoodStorage += effects.foodStorage;
            }
        }

        this.startNextProduction();
    }

    // Process unit support and maintenance costs
    processUnitSupport(gameMap: GameMap): void {
        const maintenanceCost = this.calculateUnitMaintenanceCost(gameMap);

        // Check if city can afford to support all units
        if (this.production < maintenanceCost) {
            // City cannot support all units - disband excess units
            this.disbandUnits(gameMap, maintenanceCost);
        }
    }

    // Calculate total maintenance cost for all supported units
    calculateUnitMaintenanceCost(gameMap: GameMap): number {
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
    disbandUnits(gameMap: GameMap, maxAffordableCost: number): void {
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
                if (this.onStateChange) { this.onStateChange('unitDisbanded', { city: this, unit }); }
            }
        }
    }

    // Re-home a unit to this city
    rehomeUnit(unitId: string, gameMap: GameMap): boolean {
        const unit = gameMap.unitManager.getUnit(unitId);
        if (!unit || unit.civilization.id !== this.civilization.id) {
            return false; // Can only re-home own civilization's units
        }

        // Remove from old home city
        if (unit.homeCityId) {
            // Find old home city in civilization's cities
            const oldHomeCity = this.civilization.cities.find(city => city.id === unit.homeCityId);
            if (oldHomeCity && oldHomeCity !== this as unknown) {
                (oldHomeCity as unknown as { supportedUnitIds: Set<string> }).supportedUnitIds.delete(unitId);
            }
        }

        // Set new home city
        unit.homeCityId = this.id;
        this.supportedUnitIds.add(unitId);

        if (this.onStateChange) { this.onStateChange('unitRehomed', { city: this, unit, oldHomeCityId: unit.homeCityId }); }
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
        if (this.onStateChange) { this.onStateChange('productionChanged', { city: this, item }); }
    }

    // Add item to production queue
    queueProduction(item: ProductionItem): void {
        this.buildQueue.push(item);
        if (this.onStateChange) { this.onStateChange('productionQueued', { city: this, item }); }
    }

    // Calculate happiness
    calculateHappiness(): void {
        // Base happiness from buildings
        let happiness = 0;
        const unhappiness = this.population; // 1 unhappiness per citizen

        for (const buildingType of this.buildings) {
            const building = Constants.BUILDING_PROPS[buildingType];
            if (building && building.effects) {
                const effects = building.effects as BuildingEffects;
                if (effects.happiness) {
                    happiness += effects.happiness;
                }
            }
        }

        this.happiness = happiness;
        this.unhappiness = unhappiness;
    }

    // Update city state based on happiness
    updateCityState(): void {
        this.disorder = this.unhappiness > this.happiness;
    }

    // Get city defense value (base defense = population, doubled with walls)
    getDefenseValue(): number {
        let defense = this.population;
        if (this.buildings.has(BUILDING_TYPES.CITY_WALLS)) {
            defense *= 2;
        }
        return defense;
    }

    // Get defending units at this city
    getDefendingUnits(gameMap: GameMap): GameUnit[] {
        const defendingUnits: GameUnit[] = [];
        const neighbors = gameMap.grid.getNeighbors(this.col, this.row);
        
        for (const neighbor of neighbors) {
            const unit = gameMap.getUnitAt(neighbor.col, neighbor.row);
            if (unit && unit.civilizationId === this.civilization.id && unit.attackPoints > 0) {
                defendingUnits.push(unit);
            }
        }
        
        return defendingUnits;
    }

    // City takes damage from attack
    takeDamage(amount: number): void {
        this.hitPoints = Math.max(0, this.hitPoints - amount);
    }

    // Check if city is captured (HP = 0)
    isCaptured(): boolean {
        return this.hitPoints <= 0;
    }

    // Reset HP to full (at start of turn or after being captured)
    resetHitPoints(): void {
        this.hitPoints = this.population;
    }

    // Update max HP when population changes
    updateMaxHitPoints(): void {
        // HP equals population (capped at maxHitPoints)
        if (this.hitPoints > this.population) {
            this.hitPoints = this.population;
        }
    }

    // Update max population based on buildings
    updateMaxPopulation(): void {
        this.maxPopulation = 4; // Base

        for (const buildingType of this.buildings) {
            const building = Constants.BUILDING_PROPS[buildingType];
            if (building && building.effects) {
                const effects = building.effects as BuildingEffects;
                if (effects.maxPopulation) {
                    this.maxPopulation += effects.maxPopulation;
                }
            }
        }
    }

    // Auto-assign worker to best available tile
    autoAssignWorker(gameMap: GameMap): void {
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
    getAvailableTiles(gameMap: GameMap): GameTile[] {
        const availableTiles: GameTile[] = [];
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
    getCityRadiusTiles(gameMap: GameMap): Array<{col: number, row: number, tile: GameTile}> {
        const radiusTiles: Array<{col: number, row: number, tile: GameTile}> = [];
        // City radius is a diamond-shaped 5x5 area centered on the city
        // We include all tiles with Chebyshev distance <= 2, but exclude the four corner tiles
        // and exclude the city center itself. That yields exactly 20 workable tiles.
        for (let dCol = -2; dCol <= 2; dCol++) {
            for (let dRow = -2; dRow <= 2; dRow++) {
                // Skip center
                if (dCol === 0 && dRow === 0) continue;

                // Exclude the four extreme corners of the 5x5 square
                if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;

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
    canWorkTile(tileCol: number, tileRow: number, gameMap: GameMap): boolean {
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
            return String(tile.resource ?? '').toLowerCase() === 'fish' || this.isCoastalTile(tileCol, tileRow, gameMap);
        }

        return true;
    }

    // Check if a tile is coastal (adjacent to land). A lake is water, not
    // land, so it does not make an ocean tile workable.
    private isCoastalTile(tileCol: number, tileRow: number, gameMap: GameMap): boolean {
        const neighbors = gameMap.grid.getNeighbors(tileCol, tileRow);
        return neighbors.some((neighbor: GridNeighbor) => {
            const neighborTile = gameMap.getTile(neighbor.col, neighbor.row);
            return neighborTile && neighborTile.type !== 'ocean' && neighborTile.type !== 'lake';
        });
    }

    // Evaluate city site quality based on resources and terrain
    evaluateCitySite(gameMap: GameMap): {
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
    getWorkableTiles(gameMap: GameMap): Array<{col: number, row: number, tile: GameTile, yields: TileYields}> {
        const workableTiles: Array<{col: number, row: number, tile: GameTile, yields: TileYields}> = [];
        const radiusTiles = this.getCityRadiusTiles(gameMap);

        for (const { col, row, tile } of radiusTiles) {
            if (this.canWorkTile(col, row, gameMap)) {
                const yields = tile.getYields();
                workableTiles.push({ col, row, tile, yields });
            }
        }

        // Civ1 4-tier tile priority system
        workableTiles.sort((a, b) => {
            const priorityA = this.getTilePriority(a.yields);
            const priorityB = this.getTilePriority(b.yields);
            
            if (priorityA !== priorityB) {
                return priorityA - priorityB; // Lower priority number = higher priority
            }
            
            // Within same tier, sort by total yield value
            const totalA = a.yields.food * 2 + a.yields.production + a.yields.trade;
            const totalB = b.yields.food * 2 + b.yields.production + b.yields.trade;
            return totalB - totalA;
        });

        return workableTiles;
    }
    
    // Civ1 tile priority tiers
    private getTilePriority(yields: TileYields): number {
        // Tier 1: Food-rich tiles (prevent famine) - food >= 3
        if (yields.food >= 3) return 1;
        
        // Tier 2: Balanced tiles (food + production) - food >= 2 and production >= 1
        if (yields.food >= 2 && yields.production >= 1) return 2;
        
        // Tier 3: Production-rich tiles - production >= 2
        if (yields.production >= 2) return 3;
        
        // Tier 4: Trade-rich or other tiles
        return 4;
    }

    // Auto-assign workers to best available tiles
    optimizeWorkerAssignment(gameMap: GameMap): void {
        // Reset all assignments except city center
        const cityCenter = `${this.col},${this.row}`;
        this.workingTiles.clear();
        this.workingTiles.add(cityCenter);

        const workableTiles = this.getWorkableTiles(gameMap);
        // Civ1: the city centre is worked for free; every citizen works ONE
        // additional tile. (Counting the centre as a citizen's tile made a
        // size-1 city work only the centre → 0 surplus, no growth.)
        const maxWorkers = Math.min(this.population + 1, workableTiles.length + 1);

        // Re-add manually assigned tiles first so growth never discards them;
        // the auto-assigner only fills the remaining slots with good tiles.
        const assigned = new Set<string>([cityCenter]);
        if (this.userAssignedTiles && this.userAssignedTiles.size > 0) {
            for (const tile of workableTiles) {
                if (assigned.size >= maxWorkers) break;
                const tileKey = `${tile.col},${tile.row}`;
                if (this.userAssignedTiles.has(tileKey) && !assigned.has(tileKey)) {
                    this.workingTiles.add(tileKey);
                    assigned.add(tileKey);
                }
            }
        }

        // Auto-fill the remaining worker slots with the best available tiles.
        for (const tile of workableTiles) {
            if (assigned.size >= maxWorkers) break;
            const tileKey = `${tile.col},${tile.row}`;
            if (assigned.has(tileKey)) continue;
            this.workingTiles.add(tileKey);
            assigned.add(tileKey);
        }
    }

    // Serialize city for saving

    // Get score for tile (food priority for growth)
    getTileScore(tile: GameTile): number {
        const yields = tile.getYields();
        return yields.food * 2 + yields.production + yields.trade;
    }

    // Get score for tile by key
    getTileScoreByKey(_tileKey: string): number {
        // This would need gameMap parameter
        return 0;
    }

    // Assign worker to tile
    assignWorker(tile: GameTile): void {
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
            userAssignedTiles: this.userAssignedTiles.size > 0 ? Array.from(this.userAssignedTiles) : undefined,
            governor: (this as unknown as { governor?: string }).governor,
            governorDirty: (this as unknown as { governorDirty?: boolean }).governorDirty,
            founded: this.founded,
            supportedUnitIds: Array.from(this.supportedUnitIds),
            hitPoints: this.hitPoints
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
        city.userAssignedTiles = data.userAssignedTiles ? new Set(data.userAssignedTiles) : new Set();
        const withGovernor = city as unknown as { governor?: string; governorDirty?: boolean };
        withGovernor.governor = data.governor;
        withGovernor.governorDirty = data.governorDirty;
        city.founded = data.founded;
        city.supportedUnitIds = new Set(data.supportedUnitIds || []);
        city.hitPoints = data.hitPoints || data.population;
        return city;
    }
}


// CityManager class removed (unused)