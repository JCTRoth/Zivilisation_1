// Unit System - Refactored to remove EventEmitter pattern

import { Constants } from '@/utils/Constants';
import { TERRAIN_PROPERTIES } from '@/data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES } from '@/data/TileImprovementConstants';
import type { Civilization } from './Civilization';
import {GameUtils} from "@/utils/GameUtils";

// Type definitions
interface Position {
    col: number;
    row: number;
}

interface UnitInfo {
    id: string;
    name: string;
    type: string;
    position: Position;
    movement: number;
    maxMovement: number;
    attack: number;
    defense: number;
    experience: number;
    veteran: boolean;
    fortified: boolean;
    workTarget: string | null;
    workTurns: number;
    civilization: string;
    homeCityId: string | null;
}

interface SerializedUnit {
    id: string;
    type: string;
    civilizationId: string;
    col: number;
    row: number;
    movement: number;
    experience: number;
    veteran: boolean;
    fortified: boolean;
    workTarget: string | null;
    workTurns: number;
    moved: boolean;
    active: boolean;
    homeCityId: string | null;
}

interface MoveData {
    unit: Unit;
    from: Position;
    to: Position;
    moveCost: number;
}

/** Minimal city-like interface for methods called by Unit */
interface CityLike {
  civilization: { id: string };
  population: number;
  hitPoints: number;
  col: number;
  row: number;
  getDefendingUnits(gameMap: GameMap): Array<{ destroy(): void; addExperience(n: number): void; col: number; row: number }>;
  getDefenseValue(): number;
  takeDamage(n: number): void;
  isCaptured(): boolean;
  updateMaxHitPoints(): void;
}

/** Minimal game-map interface for methods called by Unit */
interface GameMap {
  grid: { distance(c1: number, r1: number, c2: number, r2: number): number };
  getTile(col: number, row: number): {
    getMovementCost(unit: { type: string; isNaval: boolean }): number;
    hasImprovement(type: string): boolean;
    getDefenseBonus(): number;
    canImprove(type: string): boolean;
    addImprovement(type: string): boolean;
    terrain: string;
  } | null;
  getUnitAt(col: number, row: number): { civilization: { id: string } } | null;
  getCityAt(col: number, row: number): CityLike | null;
  getCities(): Array<{ col: number; row: number; civilization: { id: string } }>;
  foundCity(col: number, row: number, civilization: Civilization): unknown;
}

interface SettleData {
    unit: Unit;
    city: unknown; // City type would require circular import
}

interface WorkData {
    unit: Unit;
    improvementType?: string;
    turns?: number;
}

// DestroyData interface removed (unused)

interface PromotionData {
    unit: Unit;
}

interface TurnData {
    unit: Unit;
}

interface TurnData {
    unit: Unit;
}

// Unit System
class Unit {
    public id: string;
    public type: string;
    public civilization: Civilization;
    public col: number;
    public row: number;

    // Properties from constants
    public name: string;
    public attackPoints: number;
    public attackVeteranPoints: number;
    public defensePoints: number;
    /** Civ1 hit points (the engine record uses the same metadata). */
    public hitPoints: number;
    public maxHitPoints: number;
    public maxMovement: number;
    public cost: number;
    public maintenanceCost: number;
    public canSettle: boolean;
    public canWork: boolean;
    public isNaval: boolean;
    public isFlying: boolean;

    // City relationship
    public homeCityId: string | null;

    // Current state
    public movement: number;
    public experience: number;
    public veteran: boolean;
    public fortified: boolean;
    public orders: unknown | null;
    public workTurns: number;
    public workTarget: string | null;

    // Status flags
    public active: boolean;
    public moved: boolean;
    
    // Callback for state changes (replaces EventEmitter)
    public onStateChange: ((eventType: string, data: unknown) => void) | null;

    // Tracking: Used to detect if a unit is oscillating back and forth
    public positionHistory?: string[];

    constructor(type: string, civilization: Civilization, col: number, row: number) {
        this.id = GameUtils.generateId();
        this.type = type;
        this.civilization = civilization;
        this.col = col;
        this.row = row;

        // Initialize unit properties from constants
        const unitProps = Constants.UNIT_PROPS[type];
        if (!unitProps) {
            throw new Error(`Unknown unit type: ${type}`);
        }

        this.name = unitProps.name;
        this.attackPoints = unitProps.attack;
        this.defensePoints = unitProps.defense;
        this.hitPoints = unitProps.hitPoints ?? 2;
        this.maxHitPoints = this.hitPoints;
        this.maxMovement = unitProps.movement;
        this.cost = unitProps.cost;
        this.maintenanceCost = unitProps.maintenance || 0;
        this.canSettle = unitProps.canSettle || false;
        this.canWork = unitProps.canWork || false;
        this.isNaval = unitProps.naval || false;

        // City relationship
        this.homeCityId = null; // Will be set when produced by a city

        // Current state
        this.movement = this.maxMovement;
        this.experience = 0;
        this.veteran = false;
        this.fortified = false;
        this.orders = null;
        this.workTurns = 0;
        this.workTarget = null;

        // Status flags
        this.active = true;
        this.moved = false;
        
        // Initialize callback as null
        this.onStateChange = null;
    }

    // Move unit to new position
    moveTo(col: number, row: number, gameMap: GameMap): boolean {
        if (!this.canMoveTo(col, row, gameMap)) {
            return false;
        }

        const tile = gameMap.getTile(col, row);
        let moveCost = tile.getMovementCost(this);

        // Railroad to railroad movement is free
        const currentTile = gameMap.getTile(this.col, this.row);
        if (currentTile.hasImprovement('railroad') && tile.hasImprovement('railroad')) {
            moveCost = 0;
        }

        if (this.movement < moveCost) {
            return false;
        }

        // Store old position
        const oldCol = this.col;
        const oldRow = this.row;

        // Update position
        this.col = col;
        this.row = row;
        this.movement -= moveCost;
        this.moved = true;

        // Clear fortification
        this.fortified = false;

        // Notify state change via callback
        if (this.onStateChange) {
            this.onStateChange('moved', {
                unit: this,
                from: { col: oldCol, row: oldRow },
                to: { col, row },
                moveCost
            } as MoveData);
        }

        return true;
    }

    // Check if unit can move to position
    canMoveTo(col: number, row: number, gameMap: GameMap): boolean {
        const tile = gameMap.getTile(col, row);
        if (!tile) return false;

        const moveCost = tile.getMovementCost(this);
        if (moveCost === Infinity) return false;

        // Check if there's a friendly unit already there
        const existingUnit = gameMap.getUnitAt(col, row);
        if (existingUnit && existingUnit.civilization.id === this.civilization.id) {
            return false;
        }

        return true;
    }

    // Get possible moves for this unit
    getPossibleMoves(gameMap: GameMap, grid: { getNeighbors(col: number, row: number): Array<{ col: number; row: number }> }): Position[] {
        const moves: Position[] = [];
        const visited = new Set<string>();
        const queue = [{ col: this.col, row: this.row, movement: this.movement }];

        while (queue.length > 0) {
            const current = queue.shift()!;
            const key = `${current.col},${current.row}`;

            if (visited.has(key)) continue;
            visited.add(key);

            if (current.col !== this.col || current.row !== this.row) {
                moves.push({ col: current.col, row: current.row });
            }

            // Get neighbors
            const neighbors = grid.getNeighbors(current.col, current.row);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.col},${neighbor.row}`;
                if (visited.has(neighborKey)) continue;

                if (this.canMoveTo(neighbor.col, neighbor.row, gameMap)) {
                    const tile = gameMap.getTile(neighbor.col, neighbor.row);
                    const moveCost = tile.getMovementCost(this);
                    const remainingMovement = current.movement - moveCost;

                    if (remainingMovement >= 0) {
                        queue.push({
                            col: neighbor.col,
                            row: neighbor.row,
                            movement: remainingMovement
                        });
                    }
                }
            }
        }

        return moves;
    }

    // Combat lives in the engine-level CombatSystem (src/game/engine/CombatSystem.ts).

    // Settle a city (for settler units)
    settle(gameMap: GameMap): unknown {
        if (!this.canSettle) {
            return null;
        }

        const tile = gameMap.getTile(this.col, this.row);
        if (!tile || !this.canSettleAt(tile, gameMap)) {
            return null;
        }

        // Create new city
        const city = gameMap.foundCity(this.col, this.row, this.civilization);

        if (city) {
            // Remove settler unit
            this.destroy();
            if (this.onStateChange) {
                this.onStateChange('settled', { unit: this, city } as SettleData);
            }
        }

        return city;
    }
    destroy() {
        throw new Error('Method not implemented.');
    }

    // Check if unit can settle at current location
    canSettleAt(tile: { terrain: string }, gameMap: GameMap): boolean {
        if (!tile || tile.terrain === Constants.TERRAIN.OCEAN) {
            return false;
        }

        // Check if there's already a city nearby
        const minDistance = 2;
        const cities = gameMap.getCities();

        for (const city of cities) {
            const distance = gameMap.grid.distance(this.col, this.row, city.col, city.row);
            if (distance < minDistance) {
                return false;
            }
        }

        return true;
    }

    // Start working on tile improvement
    startWork(improvementType: string, gameMap: GameMap): boolean {
        if (!this.canWork) {
            return false;
        }

        const tile = gameMap.getTile(this.col, this.row);
        if (!tile || !tile.canImprove(improvementType)) {
            return false;
        }

        const improvementProps = Constants.IMPROVEMENT_PROPS[improvementType];
        if (!improvementProps) {
            return false;
        }

        // Calculate build time based on Civ1 mechanics
        const baseTurns = this.getBaseBuildTurns(improvementType);
        const terrainModifier = this.getTerrainBuildModifier(tile.terrain);
        this.workTurns = Math.ceil(baseTurns * terrainModifier);

        this.workTarget = improvementType;

        if (this.onStateChange) {
            this.onStateChange('startedWork', { unit: this, improvementType, turns: this.workTurns } as WorkData);
        }

        return true;
    }

    // Continue work on current project
    doWork(gameMap: GameMap): boolean {
        if (!this.workTarget || this.workTurns <= 0) {
            return false;
        }

        this.workTurns--;

        if (this.workTurns === 0) {
            // Complete the improvement
            const tile = gameMap.getTile(this.col, this.row);
            const completedImprovement = this.workTarget;

            if (tile && completedImprovement) {
                tile.addImprovement(completedImprovement);
            }

            if (this.onStateChange) {
                this.onStateChange('completedWork', {
                    unit: this,
                    improvementType: completedImprovement,
                    tile
                } as WorkData);
            }

            this.workTarget = null;
        }

        return true;
    }

    // Fortify unit for defense bonus
    fortify(): boolean {
        if (this.moved) {
            return false;
        }

        this.fortified = !this.fortified;
        this.movement = 0;

        if (this.onStateChange) {
            this.onStateChange('fortified', { unit: this, fortified: this.fortified });
        }

        return true;
    }

    // Add experience and check for promotion
    addExperience(amount: number): void {
        this.experience += amount;

        if (!this.veteran && this.experience >= 100) {
            this.veteran = true;
            if (this.onStateChange) {
                this.onStateChange('promoted', { unit: this } as PromotionData);
            }
        }
    }

    // Get base build turns for improvement type (Civ1 mechanics)
    getBaseBuildTurns(improvementType: string): number {
        const props = IMPROVEMENT_PROPERTIES[improvementType];
        return props ? props.turns : 1;
    }

    // Get terrain modifier for build time (Civ1 mechanics)
    getTerrainBuildModifier(terrain: string): number {
        const terrainProps = TERRAIN_PROPERTIES[terrain];
        return terrainProps?.buildModifier ?? 1;
    }

    // Reset movement points for new turn
    startTurn(): void {
        this.movement = this.maxMovement;
        this.moved = false;

        // Continue work if working
        if (this.workTarget) {
            this.doWork(null); // gameMap would be passed in real implementation
        }

        if (this.onStateChange) {
            this.onStateChange('turnStarted', { unit: this } as TurnData);
        }
    }

    // End turn for this unit
    endTurn(): void {
        this.movement = 0;
        if (this.onStateChange) {
            this.onStateChange('turnEnded', { unit: this } as TurnData);
        }
    }

    // Get unit information for UI
    getInfo(): UnitInfo {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            position: { col: this.col, row: this.row },
            movement: this.movement,
            maxMovement: this.maxMovement,
            attack: this.attackPoints,
            defense: this.defensePoints,
            experience: this.experience,
            veteran: this.veteran,
            fortified: this.fortified,
            workTarget: this.workTarget,
            workTurns: this.workTurns,
            civilization: this.civilization.name,
            homeCityId: this.homeCityId
        };
    }

    // Serialize unit for saving
    serialize(): SerializedUnit {
        return {
            id: this.id,
            type: this.type,
            civilizationId: this.civilization.id,
            col: this.col,
            row: this.row,
            movement: this.movement,
            experience: this.experience,
            veteran: this.veteran,
            fortified: this.fortified,
            workTarget: this.workTarget,
            workTurns: this.workTurns,
            moved: this.moved,
            active: this.active,
            homeCityId: this.homeCityId
        };
    }

    // Deserialize unit from save data
    static deserialize(data: SerializedUnit, civilization: Civilization): Unit {
        const unit = new Unit(data.type, civilization, data.col, data.row);
        unit.id = data.id;
        unit.movement = data.movement;
        unit.experience = data.experience;
        unit.veteran = data.veteran;
        unit.fortified = data.fortified;
        unit.workTarget = data.workTarget;
        unit.workTurns = data.workTurns;
        unit.moved = data.moved;
        unit.active = data.active;
        unit.homeCityId = data.homeCityId;
        return unit;
    }
}

// UnitManager class removed (unused)
