// Civilization System - Legacy Implementation (Converted to TypeScript)

import { Constants } from '../utils/Constants';
import { MathUtils, EventEmitter } from '../utils/Helpers';
import { CITY_NAMES } from './City';

// Type definitions
interface Personality {
    aggression: number;
    expansion: number;
    diplomacy: number;
    science: number;
    military: number;
    economy: number;
}

interface Priorities {
    militaryUnits: number;
    settlers: number;
    infrastructure: number;
    wonders: number;
    exploration: number;
}

interface Technology {
    name: string;
    cost: number;
    prerequisites: string[];
    category: string;
    effects: any;
}

interface CivilizationTemplate {
    name: string;
    leaderName: string;
    color: string;
    cityNames: string[];
    bonuses: Record<string, number>;
}

interface CivilizationInfo {
    id: string;
    name: string;
    leaderName: string;
    color: string;
    isHuman: boolean;
    gold: number;
    science: number;
    technologies: string[];
    currentResearch: string | null;
    researchProgress: number;
    cities: number;
    units: number;
    alive: boolean;
    warWith: string[];
}

// Civilization class
export class Civilization extends EventEmitter {
    public id: string;
    public name: string;
    public leaderName: string;
    public color: string;
    public isHuman: boolean;

    // Resources
    public gold: number;
    public science: number;

    // Technologies
    public technologies: Set<string>;
    public currentResearch: string | null;
    public researchProgress: number;

    // Diplomacy
    public relations: Map<string, number>; // civId -> relation level
    public treaties: Map<string, string>; // civId -> treaty type
    public warWith: Set<string>; // Set of civilization IDs at war with

    // Game state
    public alive: boolean;
    public turnActive: boolean;
    public capital: any; // First city becomes capital

    // AI properties
    public personality: Personality;
    public priorities: Priorities;

    // Game reference
    public gameMap: any;

    // Units and cities (will be managed by game map)
    public units: any[];
    public cities: any[];

    constructor(id: string, name: string, leaderName: string, color: string, isHuman: boolean = false) {
        super();

        this.id = id;
        this.name = name;
        this.leaderName = leaderName;
        this.color = color;
        this.isHuman = isHuman;

        // Resources
        this.gold = Constants.INITIAL_GOLD;
        this.science = Constants.INITIAL_SCIENCE;

        // Technologies
        this.technologies = new Set();
        this.currentResearch = null;
        this.researchProgress = 0;

        // Diplomacy
        this.relations = new Map(); // civId -> relation level
        this.treaties = new Map(); // civId -> treaty type
        this.warWith = new Set(); // Set of civilization IDs at war with

        // Game state
        this.alive = true;
        this.turnActive = false;
        this.capital = null; // First city becomes capital

        // AI properties
        this.personality = this.generatePersonality();
        this.priorities = this.generatePriorities();

        // Units and cities (will be managed by game map)
        this.units = [];
        this.cities = [];

        // Initialize starting technologies
        this.initializeStartingTech();
    }

    // Generate AI personality traits
    generatePersonality(): Personality {
        return {
            aggression: MathUtils.randomInt(1, 10),
            expansion: MathUtils.randomInt(1, 10),
            diplomacy: MathUtils.randomInt(1, 10),
            science: MathUtils.randomInt(1, 10),
            military: MathUtils.randomInt(1, 10),
            economy: MathUtils.randomInt(1, 10)
        };
    }

    // Generate AI priorities
    generatePriorities(): Priorities {
        return {
            militaryUnits: MathUtils.randomInt(20, 40),
            settlers: MathUtils.randomInt(10, 30),
            infrastructure: MathUtils.randomInt(20, 50),
            wonders: MathUtils.randomInt(5, 20),
            exploration: MathUtils.randomInt(10, 30)
        };
    }

    // Initialize starting technologies
    initializeStartingTech(): void {
        // All civilizations start with basic technologies
        this.technologies.add('pottery');
        this.technologies.add('ceremonial_burial');

        // Set initial research
        this.currentResearch = 'alphabet';
    }

    // Start civilization's turn
    startTurn(gameMap: any, turn: number): void {
        this.turnActive = true;

        // Calculate total resources from cities
        this.calculateResources(gameMap);

        // Process research
        this.processResearch();

        // AI decision making
        if (!this.isHuman) {
            this.makeAIDecisions(gameMap, turn);
        }

        this.emit('turnStarted', { civilization: this, turn });
    }

    // End civilization's turn
    endTurn(): void {
        this.turnActive = false;
        this.emit('turnEnded', { civilization: this });
    }

    // Calculate resources from all cities
    calculateResources(gameMap: any): void {
        let totalGold = 0;
        let totalScience = 0;

        for (const city of this.cities) {
            totalGold += city.gold;
            totalScience += city.science;

            // Subtract building maintenance
            for (const buildingType of city.buildings) {
                const building = Constants.BUILDING_PROPS[buildingType];
                if (building && building.maintenance) {
                    totalGold -= building.maintenance;
                }
            }
        }

        this.gold += Math.max(0, totalGold);
        this.science += Math.max(0, totalScience);
    }

    // Process technology research
    processResearch(): void {
        if (!this.currentResearch) {
            this.selectNextResearch();
        }

        if (this.currentResearch && this.science > 0) {
            this.researchProgress += this.science;

            const techCost = this.getTechnologyCost(this.currentResearch);
            if (this.researchProgress >= techCost) {
                this.completeTechnology(this.currentResearch);
            }
        }
    }

    // Get cost of technology research
    getTechnologyCost(techId: string): number {
        const baseCost = TECHNOLOGY_TREE[techId]?.cost || 40;
        const techCount = this.technologies.size;
        return baseCost + (techCount * 2); // Cost increases with each tech
    }

    // Complete technology research
    completeTechnology(techId: string): void {
        this.technologies.add(techId);
        this.researchProgress = 0;
        this.currentResearch = null;

        // Apply technology effects
        this.applyTechnologyEffects(techId);

        this.emit('technologyCompleted', { civilization: this, technology: techId });

        // Auto-select next research if AI
        if (!this.isHuman) {
            this.selectNextResearch();
        }
    }

    // Apply effects of completed technology
    applyTechnologyEffects(techId: string): void {
        const tech = TECHNOLOGY_TREE[techId];
        if (!tech || !tech.effects) return;

        // Apply various technology effects
        // This would include enabling new units, buildings, improvements, etc.
    }

    // Select next technology to research
    selectNextResearch(): void {
        const availableTechs = this.getAvailableTechnologies();
        if (availableTechs.length === 0) return;

        if (this.isHuman) {
            // Human player will select manually
            return;
        }

        // AI selection based on personality
        let bestTech: string | null = null;
        let bestScore = -1;

        for (const techId of availableTechs) {
            const score = this.evaluateTechnology(techId);
            if (score > bestScore) {
                bestScore = score;
                bestTech = techId;
            }
        }

        this.currentResearch = bestTech;
    }

    // Get technologies available for research
    getAvailableTechnologies(): string[] {
        const available: string[] = [];

        for (const [techId, tech] of Object.entries(TECHNOLOGY_TREE)) {
            if (this.technologies.has(techId)) continue;

            // Check prerequisites
            let canResearch = true;
            if (tech.prerequisites) {
                for (const prereq of tech.prerequisites) {
                    if (!this.technologies.has(prereq)) {
                        canResearch = false;
                        break;
                    }
                }
            }

            if (canResearch) {
                available.push(techId);
            }
        }

        return available;
    }

    // Evaluate technology for AI selection
    evaluateTechnology(techId: string): number {
        const tech = TECHNOLOGY_TREE[techId];
        if (!tech) return 0;

        let score = 10; // Base score

        // Adjust based on personality
        if (tech.category === 'military') {
            score += this.personality.military * 2;
        } else if (tech.category === 'economy') {
            score += this.personality.economy * 2;
        } else if (tech.category === 'science') {
            score += this.personality.science * 2;
        }

        // Prefer cheaper technologies early
        const cost = this.getTechnologyCost(techId);
        score -= Math.floor(cost / 10);

        return score;
    }

    // Make AI decisions for the turn
    makeAIDecisions(gameMap: any, turn: number): void {
        // City production decisions
        this.makeProductionDecisions(gameMap);

        // Unit movement and actions
        this.makeUnitDecisions(gameMap);

        // Diplomatic actions
        this.makeDiplomaticDecisions(gameMap);

        // Exploration priorities
        this.makeExplorationDecisions(gameMap);
    }

    // AI city production decisions
    makeProductionDecisions(gameMap: any): void {
        for (const city of this.cities) {
            if (!city.currentProduction && city.buildQueue.length === 0) {
                const production = this.selectCityProduction(city, gameMap);
                if (production) {
                    city.addToQueue(production);
                }
            }
        }
    }

    // Select what city should produce
    selectCityProduction(city: any, gameMap: any): any {
        const priorities: any[] = [];

        // Evaluate military needs
        const militaryNeed = this.evaluateMilitaryNeed(gameMap);
        if (militaryNeed > 50) {
            priorities.push({ type: 'unit', unitType: this.getBestMilitaryUnit(), priority: militaryNeed });
        }

        // Evaluate expansion needs
        const expansionNeed = this.evaluateExpansionNeed(gameMap);
        if (expansionNeed > 30) {
            priorities.push({ type: 'unit', unitType: Constants.UNIT_TYPES.SETTLER, priority: expansionNeed });
        }

        // Evaluate infrastructure needs
        const infrastructureNeed = this.evaluateInfrastructureNeed(city);
        for (const [building, need] of infrastructureNeed) {
            if (need > 20) {
                priorities.push({ type: 'building', buildingType: building, priority: need });
            }
        }

        // Select highest priority
        if (priorities.length > 0) {
            priorities.sort((a, b) => b.priority - a.priority);
            return priorities[0];
        }

        // Default to basic military unit
        return { type: 'unit', unitType: Constants.UNIT_TYPES.MILITIA };
    }

    // Evaluate military strength needs
    evaluateMilitaryNeed(gameMap: any): number {
        const myUnits = this.units.filter((unit: any) => unit.attack > 0).length;
        const myCities = this.cities.length;

        // Base need on cities to units ratio
        let need = Math.max(0, (myCities * 2) - myUnits) * 20;

        // Increase if at war
        if (this.warWith.size > 0) {
            need += 50;
        }

        // Increase based on aggression personality
        need += this.personality.aggression * 3;

        return Math.min(100, need);
    }

    // Evaluate expansion needs
    evaluateExpansionNeed(gameMap: any): number {
        const cityCount = this.cities.length;
        const settlers = this.units.filter((unit: any) => unit.canSettle).length;

        // Base expansion desire
        let need = this.personality.expansion * 5;

        // Reduce if already have many cities
        need -= cityCount * 10;

        // Reduce if already have settlers
        need -= settlers * 30;

        // Increase if have good expansion spots
        const expansionSpots = this.findGoodExpansionSpots(gameMap);
        need += expansionSpots * 10;

        return Math.max(0, Math.min(100, need));
    }

    // Find good spots for expansion
    findGoodExpansionSpots(gameMap: any): number {
        // Simplified - just count suitable tiles near existing cities
        let spots = 0;
        const searchRadius = 8;

        for (const city of this.cities) {
            const nearbyTiles = gameMap.grid.getHexesInRange(city.col, city.row, searchRadius);

            for (const tilePos of nearbyTiles) {
                const tile = gameMap.getTile(tilePos.col, tilePos.row);
                if (tile && this.isGoodSettlementSite(tilePos.col, tilePos.row, gameMap)) {
                    spots++;
                }
            }
        }

        return Math.min(5, spots); // Cap at 5 for scoring
    }

    // Check if location is good for settlement
    isGoodSettlementSite(col: number, row: number, gameMap: any): boolean {
        const tile = gameMap.getTile(col, row);
        if (!tile || tile.terrain === Constants.TERRAIN.OCEAN) return false;

        // Check minimum distance from other cities
        const minDistance = 3;
        const allCities = gameMap.getCities();

        for (const city of allCities) {
            if (gameMap.grid.distance(col, row, city.col, city.row) < minDistance) {
                return false;
            }
        }

        // Prefer tiles with good yields nearby
        const nearbyTiles = gameMap.grid.getNeighbors(col, row);
        let totalYield = 0;

        for (const neighbor of nearbyTiles) {
            const neighborTile = gameMap.getTile(neighbor.col, neighbor.row);
            if (neighborTile) {
                const yields = neighborTile.getYields();
                totalYield += yields.food + yields.production + yields.trade;
            }
        }

        return totalYield >= 8; // Minimum threshold for good site
    }

    // Evaluate infrastructure needs for city
    evaluateInfrastructureNeed(city: any): Map<string, number> {
        const needs = new Map<string, number>();

        // Granary for growing cities
        if (!city.hasBuilding(Constants.BUILDINGS.GRANARY) && city.population >= 3) {
            needs.set(Constants.BUILDINGS.GRANARY, 40);
        }

        // Barracks for military production
        if (!city.hasBuilding(Constants.BUILDINGS.BARRACKS) && this.personality.military > 5) {
            needs.set(Constants.BUILDINGS.BARRACKS, 30);
        }

        // Temple for happiness
        if (!city.hasBuilding(Constants.BUILDINGS.TEMPLE) && city.unhappiness > 20) {
            needs.set(Constants.BUILDINGS.TEMPLE, 35);
        }

        // Marketplace for trade
        if (!city.hasBuilding(Constants.BUILDINGS.MARKETPLACE) && city.trade > 3) {
            needs.set(Constants.BUILDINGS.MARKETPLACE, 25);
        }

        return needs;
    }

    // Get best available military unit
    getBestMilitaryUnit(): string {
        // Check what units are available based on tech
        const availableUnits: string[] = [Constants.UNIT_TYPES.MILITIA];

        if (this.technologies.has('bronze_working')) {
            availableUnits.push(Constants.UNIT_TYPES.PHALANX);
        }

        if (this.technologies.has('iron_working')) {
            availableUnits.push(Constants.UNIT_TYPES.LEGION);
        }

        if (this.technologies.has('horseback_riding')) {
            availableUnits.push(Constants.UNIT_TYPES.CAVALRY);
        }

        // Return strongest available unit
        return availableUnits[availableUnits.length - 1];
    }

    // AI unit decisions
    makeUnitDecisions(gameMap: any): void {
        for (const unit of this.units) {
            if (!unit.active || unit.movement <= 0) continue;

            this.makeUnitDecision(unit, gameMap);
        }
    }

    // Make decision for specific unit
    makeUnitDecision(unit: any, gameMap: any): void {
        // Settlers should found cities
        if (unit.canSettle) {
            const goodSite = this.findNearbySettlementSite(unit, gameMap);
            if (goodSite) {
                this.moveUnitTowards(unit, goodSite.col, goodSite.row, gameMap);

                // Settle if at the site
                if (unit.col === goodSite.col && unit.row === goodSite.row) {
                    unit.settle(gameMap);
                }
            }
            return;
        }

        // Military units
        if (unit.attack > 0) {
            // Look for enemies to attack
            const enemy = this.findNearbyEnemy(unit, gameMap);
            if (enemy) {
                if (gameMap.grid.distance(unit.col, unit.row, enemy.col, enemy.row) === 1) {
                    unit.attack(enemy, gameMap);
                } else {
                    this.moveUnitTowards(unit, enemy.col, enemy.row, gameMap);
                }
                return;
            }

            // Patrol or explore
            this.exploreWithUnit(unit, gameMap);
        }
    }

    // Find nearby settlement site for unit
    findNearbySettlementSite(unit: any, gameMap: any): any {
        const searchRadius = 10;
        const nearbyTiles = gameMap.grid.getHexesInRange(unit.col, unit.row, searchRadius);

        let bestSite = null;
        let bestScore = 0;

        for (const tilePos of nearbyTiles) {
            if (this.isGoodSettlementSite(tilePos.col, tilePos.row, gameMap)) {
                const distance = gameMap.grid.distance(unit.col, unit.row, tilePos.col, tilePos.row);
                const score = 100 - distance; // Prefer closer sites

                if (score > bestScore) {
                    bestScore = score;
                    bestSite = tilePos;
                }
            }
        }

        return bestSite;
    }

    // Find nearby enemy unit
    findNearbyEnemy(unit: any, gameMap: any): any {
        const searchRadius = 5;
        const nearbyTiles = gameMap.grid.getHexesInRange(unit.col, unit.row, searchRadius);

        for (const tilePos of nearbyTiles) {
            const enemyUnit = gameMap.getUnitAt(tilePos.col, tilePos.row);
            if (enemyUnit && this.isEnemy(enemyUnit.civilization)) {
                return enemyUnit;
            }
        }

        return null;
    }

    // Move unit towards target
    moveUnitTowards(unit: any, targetCol: number, targetRow: number, gameMap: any): void {
        const path = gameMap.grid.findPath(
            unit.col, unit.row,
            targetCol, targetRow,
            (col: number, row: number) => {
                const tile = gameMap.getTile(col, row);
                return tile ? tile.getMovementCost(unit) : Infinity;
            }
        );

        if (path.length > 1) {
            const nextStep = path[1]; // Skip current position
            unit.moveTo(nextStep.col, nextStep.row, gameMap);
        }
    }

    // Explore with unit (random movement)
    exploreWithUnit(unit: any, gameMap: any): void {
        const possibleMoves = unit.getPossibleMoves(gameMap, gameMap.grid);

        if (possibleMoves.length > 0) {
            const randomMove = MathUtils.randomChoice(possibleMoves) as any;
            unit.moveTo(randomMove.col, randomMove.row, gameMap);
        }
    }

    // Check if civilization is enemy
    isEnemy(otherCiv: any): boolean {
        return this.warWith.has(otherCiv.id);
    }

    // Diplomatic decisions
    makeDiplomaticDecisions(gameMap: any): void {
        // Simplified diplomacy - declare war on weak neighbors sometimes
        if (this.personality.aggression > 7 && Math.random() < 0.1) {
            const weakNeighbor = this.findWeakNeighbor(gameMap);
            if (weakNeighbor && !this.isEnemy(weakNeighbor)) {
                this.declareWar(weakNeighbor);
            }
        }
    }

    // Find weak neighboring civilization
    findWeakNeighbor(gameMap: any): any {
        // Find civilizations with cities near ours
        const neighbors = new Set();

        for (const myCity of this.cities) {
            const nearbyTiles = gameMap.grid.getHexesInRange(myCity.col, myCity.row, 8);

            for (const tilePos of nearbyTiles) {
                const city = gameMap.getCityAt(tilePos.col, tilePos.row);
                if (city && city.civilization.id !== this.id) {
                    neighbors.add(city.civilization);
                }
            }
        }

        // Find weakest neighbor
        let weakest = null;
        let minStrength = Infinity;

        for (const neighbor of neighbors) {
            const strength = this.evaluateCivilizationStrength(neighbor);
            if (strength < minStrength && strength < this.evaluateCivilizationStrength(this) * 0.7) {
                minStrength = strength;
                weakest = neighbor;
            }
        }

        return weakest;
    }

    // Evaluate military/economic strength of civilization
    evaluateCivilizationStrength(civ: any): number {
        const cityCount = civ.cities.length;
        const unitCount = civ.units.length;
        const militaryUnits = civ.units.filter((unit: any) => unit.attack > 0).length;

        return cityCount * 10 + unitCount * 2 + militaryUnits * 3;
    }

    // Declare war on another civilization
    declareWar(otherCiv: any): void {
        this.warWith.add(otherCiv.id);
        otherCiv.warWith.add(this.id);

        this.emit('warDeclared', { aggressor: this, target: otherCiv });
    }

    // Make peace with another civilization
    makePeace(otherCiv: any): void {
        this.warWith.delete(otherCiv.id);
        otherCiv.warWith.delete(this.id);

        this.emit('peaceMade', { civ1: this, civ2: otherCiv });
    }

    // Exploration decisions
    makeExplorationDecisions(gameMap: any): void {
        // Send idle military units to explore
        const idleUnits = this.units.filter((unit: any) =>
            unit.active && unit.attack > 0 && unit.movement > 0
        );

        for (const unit of idleUnits) {
            const unexploredTile = this.findNearbyUnexplored(unit, gameMap);
            if (unexploredTile) {
                this.moveUnitTowards(unit, unexploredTile.col, unexploredTile.row, gameMap);
            }
        }
    }

    // Find nearby unexplored tile
    findNearbyUnexplored(unit: any, gameMap: any): any {
        const searchRadius = 8;
        const nearbyTiles = gameMap.grid.getHexesInRange(unit.col, unit.row, searchRadius);

        for (const tilePos of nearbyTiles) {
            const tile = gameMap.getTile(tilePos.col, tilePos.row);
            if (tile && !tile.isExplored(this.id)) {
                return tilePos;
            }
        }

        return null;
    }

    // Check if civilization is defeated
    checkDefeat(): void {
        if (this.cities.length === 0 && this.units.length === 0) {
            this.alive = false;
            this.emit('defeated', { civilization: this });
        }
    }

    // Get civilization information for UI
    getInfo(): CivilizationInfo {
        return {
            id: this.id,
            name: this.name,
            leaderName: this.leaderName,
            color: this.color,
            isHuman: this.isHuman,
            gold: this.gold,
            science: this.science,
            technologies: Array.from(this.technologies),
            currentResearch: this.currentResearch,
            researchProgress: this.researchProgress,
            cities: this.cities.length,
            units: this.units.length,
            alive: this.alive,
            warWith: Array.from(this.warWith)
        };
    }
}

// Technology Tree
export const TECHNOLOGY_TREE: Record<string, Technology> = {
    // Ancient Era
    pottery: {
        name: 'Pottery',
        cost: 40,
        prerequisites: [],
        category: 'economy',
        effects: { enables: ['granary'] }
    },
    ceremonial_burial: {
        name: 'Ceremonial Burial',
        cost: 40,
        prerequisites: [],
        category: 'culture',
        effects: { enables: ['temple'] }
    },
    alphabet: {
        name: 'Alphabet',
        cost: 60,
        prerequisites: [],
        category: 'science',
        effects: { enables: ['library'] }
    },
    bronze_working: {
        name: 'Bronze Working',
        cost: 80,
        prerequisites: [],
        category: 'military',
        effects: { enables: ['phalanx'] }
    },
    iron_working: {
        name: 'Iron Working',
        cost: 100,
        prerequisites: ['bronze_working'],
        category: 'military',
        effects: { enables: ['legion'] }
    },
    horseback_riding: {
        name: 'Horseback Riding',
        cost: 80,
        prerequisites: [],
        category: 'military',
        effects: { enables: ['cavalry', 'chariot'] }
    },
    wheel: {
        name: 'The Wheel',
        cost: 60,
        prerequisites: [],
        category: 'transport',
        effects: { enables: ['chariot'] }
    },
    masonry: {
        name: 'Masonry',
        cost: 80,
        prerequisites: [],
        category: 'construction',
        effects: { enables: ['walls'] }
    },
    construction: {
        name: 'Construction',
        cost: 120,
        prerequisites: ['masonry'],
        category: 'construction',
        effects: { enables: ['aqueduct'] }
    },
    currency: {
        name: 'Currency',
        cost: 100,
        prerequisites: ['bronze_working'],
        category: 'economy',
        effects: { enables: ['marketplace'] }
    },
    mathematics: {
        name: 'Mathematics',
        cost: 100,
        prerequisites: ['alphabet'],
        category: 'science',
        effects: { enables: ['catapult'] }
    },
    map_making: {
        name: 'Map Making',
        cost: 90,
        prerequisites: ['alphabet'],
        category: 'exploration',
        effects: { enables: ['trireme'] }
    }
};

// Civilization Templates
export const CIVILIZATION_TEMPLATES: Record<string, CivilizationTemplate> = {
    romans: {
        name: 'Romans',
        leaderName: 'Caesar',
        color: Constants.COLORS.PLAYER,
        cityNames: CITY_NAMES.romans,
        bonuses: { military: 1, construction: 1 }
    },
    babylonians: {
        name: 'Babylonians',
        leaderName: 'Hammurabi',
        color: Constants.COLORS.AI_1,
        cityNames: CITY_NAMES.babylonians,
        bonuses: { science: 1, agriculture: 1 }
    },
    germans: {
        name: 'Germans',
        leaderName: 'Frederick',
        color: Constants.COLORS.AI_2,
        cityNames: CITY_NAMES.germans,
        bonuses: { production: 1, military: 1 }
    },
    egyptians: {
        name: 'Egyptians',
        leaderName: 'Cleopatra',
        color: Constants.COLORS.AI_3,
        cityNames: CITY_NAMES.egyptians,
        bonuses: { construction: 1, trade: 1 }
    },
    americans: {
        name: 'Americans',
        leaderName: 'Lincoln',
        color: Constants.COLORS.AI_4,
        cityNames: CITY_NAMES.americans,
        bonuses: { expansion: 1, democracy: 1 }
    },
    greeks: {
        name: 'Greeks',
        leaderName: 'Alexander',
        color: Constants.COLORS.AI_5,
        cityNames: CITY_NAMES.greeks,
        bonuses: { military: 1, philosophy: 1 }
    }
};