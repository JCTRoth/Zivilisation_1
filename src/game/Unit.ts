// Unit System - Legacy Implementation (Converted to TypeScript)

import { Constants } from '../utils/Constants';
import { GameUtils, EventEmitter } from '../utils/Helpers';
import { TERRAIN_PROPERTIES } from '../data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES } from '../data/TileImprovementConstants';
import type { Civilization } from './Civilization';

// Type definitions
interface Position {
    col: number;
    row: number;
}

interface CombatResult {
    attackerWins: boolean;
    attackStrength: number;
    defenseStrength: number;
    attackerWinChance: number;
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

interface AttackData {
    attacker: Unit;
    defender: Unit;
    result: CombatResult;
}

interface SettleData {
    unit: Unit;
    city: any; // Would be City type
}

interface WorkData {
    unit: Unit;
    improvementType?: string;
    turns?: number;
}

interface DestroyData {
    unit: Unit;
}

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
export class Unit extends EventEmitter {
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
    public orders: any;
    public workTurns: number;
    public workTarget: string | null;

    // Status flags
    public active: boolean;
    public moved: boolean;

    constructor(type: string, civilization: Civilization, col: number, row: number) {
        super();

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
    }

    // Move unit to new position
    moveTo(col: number, row: number, gameMap: any): boolean {
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

        // Emit movement event
        this.emit('moved', {
            unit: this,
            from: { col: oldCol, row: oldRow },
            to: { col, row },
            moveCost
        } as MoveData);

        return true;
    }

    // Check if unit can move to position
    canMoveTo(col: number, row: number, gameMap: any): boolean {
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
    getPossibleMoves(gameMap: any, grid: any): Position[] {
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

    // Attack another unit
    attackUnit(target: Unit, gameMap: any): CombatResult | null {
        if (!this.canAttack(target, gameMap)) {
            return null;
        }

        const distance = gameMap.grid.distance(this.col, this.row, target.col, target.row);
        if (distance > 1) {
            return null; // Can only attack adjacent units
        }

        const result = this.resolveCombat(target, gameMap);

        // Handle unit destruction
        if (result.attackerWins) {
            target.destroy();

            // Attacker moves into defender's tile if victorious
            this.col = target.col;
            this.row = target.row;
        } else {
            this.destroy();
        }

        // Gain experience
        this.addExperience(20);
        target.addExperience(10);

        // End movement for attacker
        this.movement = 0;
        this.moved = true;

        this.emit('attacked', { attacker: this, defender: target, result } as AttackData);

        return result;
    }

    // Check if this unit can attack target
    canAttack(target: Unit, gameMap: any): boolean {
        if (!target || target.civilization.id === this.civilization.id) {
            return false;
        }

        if (this.attackPoints === 0) {
            return false; // Non-combat units can't attack
        }

        const distance = gameMap.grid.distance(this.col, this.row, target.col, target.row);
        return distance <= 1;
    }

    // Resolve combat between this unit and target
    resolveCombat(target: Unit, gameMap: any): CombatResult {
        let attackStrength = this.attackPoints;
        let defenseStrength = target.defensePoints;

        // Apply veteran bonuses
        if (this.veteran) attackStrength = Math.floor(attackStrength * 1.5);
        if (target.veteran) defenseStrength = Math.floor(defenseStrength * 1.5);

        // Apply terrain defense bonus
        const targetTile = gameMap.getTile(target.col, target.row);
        const terrainBonus = targetTile.getDefenseBonus();
        defenseStrength += terrainBonus;

        // Apply city defense bonus
        const city = gameMap.getCityAt(target.col, target.row);
        if (city) {
            const cityDefense = city.population >= 8 ? 2.7 : 1.8;
            defenseStrength += cityDefense;
        }

        // Apply fortification bonus
        if (target.fortified) {
            defenseStrength = Math.floor(defenseStrength * 1.5);
        }

        // Calculate combat odds
        const totalStrength = attackStrength + defenseStrength;
        const attackerWinChance = attackStrength / totalStrength;

        // Determine winner
        const random = Math.random();
        const attackerWins = random < attackerWinChance;

        return {
            attackerWins,
            attackStrength,
            defenseStrength,
            attackerWinChance
        };
    }

    // Settle a city (for settler units)
    settle(gameMap: any): any {
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
            this.emit('settled', { unit: this, city } as SettleData);
        }

        return city;
    }
    destroy() {
        throw new Error('Method not implemented.');
    }

    // Check if unit can settle at current location
    canSettleAt(tile: any, gameMap: any): boolean {
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
    startWork(improvementType: string, gameMap: any): boolean {
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

        this.emit('startedWork', { unit: this, improvementType, turns: this.workTurns } as WorkData);

        return true;
    }

    // Continue work on current project
    doWork(gameMap: any): boolean {
        if (!this.workTarget || this.workTurns <= 0) {
            return false;
        }

        this.workTurns--;

        if (this.workTurns === 0) {
            // Complete the improvement
            const tile = gameMap.getTile(this.col, this.row);
            tile.addImprovement(this.workTarget);

            this.emit('completedWork', {
                unit: this,
                improvementType: this.workTarget
            } as WorkData);

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

        this.emit('fortified', { unit: this, fortified: this.fortified });

        return true;
    }

    // Add experience and check for promotion
    addExperience(amount: number): void {
        this.experience += amount;

        if (!this.veteran && this.experience >= 100) {
            this.veteran = true;
            this.emit('promoted', { unit: this } as PromotionData);
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

        this.emit('turnStarted', { unit: this } as TurnData);
    }

    // End turn for this unit
    endTurn(): void {
        this.movement = 0;
        this.emit('turnEnded', { unit: this } as TurnData);
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

// Unit Manager - handles collections of units
export class UnitManager extends EventEmitter {
    private units: Map<string, Unit>;
    private unitsByPosition: Map<string, Unit[]>;
    private unitsByCivilization: Map<string, Unit[]>;

    constructor() {
        super();
        this.units = new Map();
        this.unitsByPosition = new Map();
        this.unitsByCivilization = new Map();
    }

    // Add unit to manager
    addUnit(unit: Unit): void {
        this.units.set(unit.id, unit);
        this.updatePositionIndex(unit);
        this.updateCivilizationIndex(unit);

        // Listen to unit events
        unit.on('moved', (data: MoveData) => {
            this.updatePositionIndex(unit);
            this.emit('unitMoved', data);
        });

        unit.on('destroyed', (data: DestroyData) => {
            this.removeUnit(unit.id);
            this.emit('unitDestroyed', data);
        });

        this.emit('unitAdded', { unit });
    }

    // Remove unit from manager
    removeUnit(unitId: string): boolean {
        const unit = this.units.get(unitId);
        if (!unit) return false;

        this.units.delete(unitId);
        this.removeFromPositionIndex(unit);
        this.removeFromCivilizationIndex(unit);

        this.emit('unitRemoved', { unit });

        return true;
    }

    // Get unit by ID
    getUnit(unitId: string): Unit | undefined {
        return this.units.get(unitId);
    }

    // Get unit at position
    getUnitAt(col: number, row: number): Unit | null {
        const key = `${col},${row}`;
        const unitsAtPosition = this.unitsByPosition.get(key);
        return unitsAtPosition ? unitsAtPosition[0] : null;
    }

    // Get all units at position
    getUnitsAt(col: number, row: number): Unit[] {
        const key = `${col},${row}`;
        return this.unitsByPosition.get(key) || [];
    }

    // Get units by civilization
    getUnitsByCivilization(civilizationId: string): Unit[] {
        return this.unitsByCivilization.get(civilizationId) || [];
    }

    // Get all units
    getAllUnits(): Unit[] {
        return Array.from(this.units.values());
    }

    // Update position index
    private updatePositionIndex(unit: Unit): void {
        // Remove from old position
        this.removeFromPositionIndex(unit);

        // Add to new position
        const key = `${unit.col},${unit.row}`;
        if (!this.unitsByPosition.has(key)) {
            this.unitsByPosition.set(key, []);
        }
        this.unitsByPosition.get(key)!.push(unit);
    }

    // Remove from position index
    private removeFromPositionIndex(unit: Unit): void {
        for (const [key, units] of this.unitsByPosition.entries()) {
            const index = units.indexOf(unit);
            if (index !== -1) {
                units.splice(index, 1);
                if (units.length === 0) {
                    this.unitsByPosition.delete(key);
                }
                break;
            }
        }
    }

    // Update civilization index
    private updateCivilizationIndex(unit: Unit): void {
        const civId = unit.civilization.id;
        if (!this.unitsByCivilization.has(civId)) {
            this.unitsByCivilization.set(civId, []);
        }

        const civUnits = this.unitsByCivilization.get(civId)!;
        if (!civUnits.includes(unit)) {
            civUnits.push(unit);
        }
    }

    // Remove from civilization index
    private removeFromCivilizationIndex(unit: Unit): void {
        const civId = unit.civilization.id;
        const civUnits = this.unitsByCivilization.get(civId);

        if (civUnits) {
            const index = civUnits.indexOf(unit);
            if (index !== -1) {
                civUnits.splice(index, 1);

                if (civUnits.length === 0) {
                    this.unitsByCivilization.delete(civId);
                }
            }
        }
    }

    // Start turn for all units of civilization
    startTurnForCivilization(civilizationId: string): void {
        const units = this.getUnitsByCivilization(civilizationId);
        units.forEach(unit => unit.startTurn());
    }

    // End turn for all units of civilization
    endTurnForCivilization(civilizationId: string): void {
        const units = this.getUnitsByCivilization(civilizationId);
        units.forEach(unit => unit.endTurn());
    }
}