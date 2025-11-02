// City System - Legacy Implementation (Converted to TypeScript)

import { CONSTANTS } from '../utils/constants';
import { GameUtils, MathUtils, EventEmitter } from '../utils/helpers';
import type { Civilization } from './civilization';

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

interface Building {
    name: string;
    cost: number;
    maintenance: number;
    effects: BuildingEffects;
}

interface ProductionItem {
    type: 'unit' | 'building';
    itemType: string;
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
    workingTiles: string[];
    founded: number;
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

    // Storage
    public foodStorage: number;
    public maxFoodStorage: number;

    // Buildings and improvements
    public buildings: Set<string>;
    public buildQueue: ProductionItem[];
    public currentProduction: ProductionItem | null;
    public productionProgress: number;

    // Working tiles
    public workingTiles: Set<string>;
    public assignedTiles: Map<string, string>;

    // City state
    public founded: number;
    public happiness: number;
    public unhappiness: number;
    public disorder: boolean;

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

        // Storage
        this.foodStorage = 10;
        this.maxFoodStorage = 20;

        // Buildings and improvements
        this.buildings = new Set();
        this.buildQueue = [];
        this.currentProduction = null;
        this.productionProgress = 0;

        // Working tiles
        this.workingTiles = new Set();
        this.assignedTiles = new Map();

        // City state
        this.founded = 0;
        this.happiness = 50;
        this.unhappiness = 0;
        this.disorder = false;

        // Initialize with city center
        this.workingTiles.add(`${col},${row}`);
    }

    // Process city turn
    processTurn(gameMap: any, turn: number): void {
        // Calculate yields from worked tiles
        this.calculateYields(gameMap);

        // Process food
        this.processFood();

        // Process production
        this.processProduction();

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
            const building = CONSTANTS.BUILDING_PROPS[buildingType];
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
    processFood(): void {
        const foodNeeded = this.population * 2;
        const foodSurplus = this.food - foodNeeded;

        if (foodSurplus > 0) {
            // City is growing
            this.foodStorage += foodSurplus;

            const growthThreshold = this.getGrowthThreshold();
            if (this.foodStorage >= growthThreshold && this.population < this.maxPopulation) {
                this.grow();
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
    grow(): void {
        this.population++;
        this.foodStorage = 0;

        // Update max population based on buildings
        this.updateMaxPopulation();

        // Automatically assign new citizen to work best available tile
        this.autoAssignWorker();

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
            return CONSTANTS.UNIT_PROPS[item.itemType].cost;
        } else if (item.type === 'building') {
            return CONSTANTS.BUILDING_PROPS[item.itemType].cost;
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

        // Carry over excess production
        this.productionProgress = excessProduction;

        // Start next item in queue
        this.startNextProduction();

        this.emit('productionCompleted', { city: this, item });
    }

    // Produce a unit
    produceUnit(unitType: string): void {
        const unit = new (require('./unit').Unit)(unitType, this.civilization, this.col, this.row);

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
        const building = CONSTANTS.BUILDING_PROPS[buildingType];
        if (building && building.effects) {
            if ((building.effects as any).maxPopulation) {
                this.maxPopulation += (building.effects as any).maxPopulation;
            }
            if ((building.effects as any).foodStorage) {
                this.maxFoodStorage += (building.effects as any).foodStorage;
            }
        }

        this.emit('buildingCompleted', { city: this, buildingType });
    }

    // Start next production from queue
    startNextProduction(): void {
        if (this.buildQueue.length > 0) {
            this.currentProduction = this.buildQueue.shift()!;
        } else {
            this.currentProduction = null;
        }
    }

    // Set production target
    setProduction(item: ProductionItem): void {
        this.currentProduction = item;
        this.productionProgress = 0;
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
            const building = CONSTANTS.BUILDING_PROPS[buildingType];
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
            const building = CONSTANTS.BUILDING_PROPS[buildingType];
            if (building && building.effects && (building.effects as any).maxPopulation) {
                this.maxPopulation += (building.effects as any).maxPopulation;
            }
        }
    }

    // Auto-assign worker to best available tile
    autoAssignWorker(): void {
        const availableTiles = this.getAvailableTiles();
        if (availableTiles.length === 0) return;

        // Find tile with best food yield
        let bestTile = availableTiles[0];
        let bestScore = this.getTileScore(bestTile);

        for (const tile of availableTiles) {
            const score = this.getTileScore(tile);
            if (score > bestScore) {
                bestTile = tile;
                bestScore = score;
            }
        }

        this.assignWorker(bestTile);
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

    // Get available tiles for working
    getAvailableTiles(): any[] {
        const availableTiles: any[] = [];
        const cityRadius = 2;

        // This would need gameMap parameter in real implementation
        // const tilesInRange = gameMap.grid.getHexesInRange(this.col, this.row, cityRadius);
        // for (const tilePos of tilesInRange) {
        //     const tile = gameMap.getTile(tilePos.col, tilePos.row);
        //     const tileKey = `${tilePos.col},${tilePos.row}`;
        //
        //     if (tile && !this.workingTiles.has(tileKey) && tile.isExplored(this.civilization.id)) {
        //         availableTiles.push(tile);
        //     }
        // }

        return availableTiles;
    }

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
            civilization: this.civilization.name
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
            workingTiles: Array.from(this.workingTiles),
            founded: this.founded
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
        city.workingTiles = new Set(data.workingTiles);
        city.founded = data.founded;
        return city;
    }
}

// City Names for different civilizations
export const CITY_NAMES: Record<string, string[]> = {
    romans: ['Rome', 'Antium', 'Cumae', 'Neapolis', 'Ravenna', 'Arretium', 'Mediolanum', 'Arpinum'],
    babylonians: ['Babylon', 'Ur', 'Nineveh', 'Ashur', 'Ellipi', 'Akkad', 'Eridu', 'Kish'],
    germans: ['Berlin', 'Leipzig', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Nuremberg', 'Dresden'],
    egyptians: ['Thebes', 'Memphis', 'Oryx', 'Elephantine', 'Alexandria', 'Cairo', 'Coptos', 'Edfu'],
    americans: ['Washington', 'New York', 'Boston', 'Philadelphia', 'Atlanta', 'Chicago', 'Seattle', 'San Francisco'],
    greeks: ['Athens', 'Sparta', 'Corinth', 'Thebes', 'Argos', 'Delphi', 'Olympia', 'Mycenae'],
    indians: ['Delhi', 'Bombay', 'Madras', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Calcutta', 'Lucknow'],
    russians: ['Moscow', 'St. Petersburg', 'Kiev', 'Minsk', 'Smolensk', 'Odessa', 'Sevastopol', 'Tula'],
    zuluids: ['Zimbabwe', 'Ulundi', 'Bapedi', 'Hlobane', 'Isandhlwana', 'Intombe', 'Mpondo', 'Ngome'],
    french: ['Paris', 'Orleans', 'Lyon', 'Tours', 'Marseilles', 'Chartres', 'Avignon', 'Rouen'],
    aztecs: ['Tenochtitlan', 'Texcoco', 'Tlatelolco', 'Teotihuacan', 'Tlaxcala', 'Calixtlahuaca', 'Xochicalco', 'Tula'],
    chinese: ['Beijing', 'Shanghai', 'Guangzhou', 'Xian', 'Nanjing', 'Chengdu', 'Luoyang', 'Tianjin'],
    english: ['London', 'York', 'Nottingham', 'Hastings', 'Canterbury', 'Coventry', 'Warwick', 'Dover'],
    mongols: ['Samarkand', 'Bokhara', 'Nishapur', 'Karakorum', 'Kashgar', 'Tabriz', 'Otrar', 'Bukhara']
};

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