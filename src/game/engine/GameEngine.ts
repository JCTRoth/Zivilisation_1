import { SquareGrid } from '../HexGrid';
import { Constants, TERRAIN_PROPS, UNIT_PROPS } from '@/utils/Constants';
import { CIVILIZATIONS, TECHNOLOGIES } from '@/data/GameData';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';
import { ProductionManager } from './ProductionManager';
import { AutoProduction } from './AutoProduction';
import { AIUtility } from './AIUtility';
import { UnitActionManager } from './UnitActionManager';
import { TurnManager } from './TurnManager';
import { VictoryManager } from './VictoryManager';
import { SettlementEvaluator } from './SettlementEvaluator';
import { EnemySearcher, EnemyLocation } from './EnemySearcher';
import { GoToManager } from './GoToManager';
import type { GameActions, Unit, City, Civilization } from '../../../types/game';

interface GameSettings {
  difficulty: string;
  mapType: string;
  numberOfCivilizations: number;
  playerCivilization: number;
  startingYear: number;
  startingGold: number;
}

interface MapTile {
  terrain: string;
  resource?: string;
  improvement?: string;
  visible: boolean;
  explored: boolean;
  col: number;
  row: number;
  type?: string;
}

interface MapData {
  width: number;
  height: number;
  tiles: MapTile[];
}

interface PlayerTurnStorage {
  civilizationId: number;
  visibility: boolean[]; // Current visibility (fog of war)
  explored: boolean[]; // Permanently explored tiles
  lastKnownUnits: Map<string, Unit>; // Last known enemy unit positions
  lastKnownCities: Map<string, City>; // Last known enemy city positions
  enemyLocations: Map<number, EnemyLocation[]>; // Enemy locations per civilization [enemyCivId -> locations]
  scoutZones: Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }>; // Scout assignment zones
  turnData: Record<string, any>; // Custom per-turn data storage
}

/**
 * Main Game Engine for React Civilization Clone
 * Manages all game systems and state
 */
export default class GameEngine {
  // Static references for TurnManager to access
  static UNIT_PROPS = UNIT_PROPS;
  static TECHNOLOGIES = TECHNOLOGIES;
  
  storeActions: GameActions | null;
  squareGrid: SquareGrid | null;
  map: MapData | null;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  technologies: any[];
  gameSettings: GameSettings;
  isInitialized: boolean;
  currentTurn: number;
  currentYear: number;
  activePlayer: number;
  onStateChange: ((eventType: string, eventData?: any) => void) | null;
  productionManager: ProductionManager;
  autoProduction: AutoProduction;
  playerStorage: Map<number, PlayerTurnStorage>; // Per-player persistent storage
  devMode: boolean; // Developer mode flag
  roundManager: TurnManager; // kept property name for compatibility
  goToManager: GoToManager;
  victoryManager: VictoryManager;
  isGameOver: boolean;

  // Getter for turnManager (alias for roundManager)
  get turnManager() {
    return this.roundManager;
  }

  constructor(storeActions: GameActions | null = null) {
    this.storeActions = storeActions;
    this.squareGrid = null;
    this.map = null;
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    
    // Game settings
    this.gameSettings = {
      difficulty: 'PRINCE',
      mapType: 'EARTH',
      numberOfCivilizations: 4,
      playerCivilization: 0,
      startingYear: -4000, // 4000 BC
      startingGold: 50
    };
    
    // Game state
    this.isInitialized = false;
    this.currentTurn = 1;
    this.currentYear = -4000; // 4000 BC
    this.activePlayer = 0;
    
    // Callbacks for React state updates
    this.onStateChange = null;
    this.productionManager = new ProductionManager(this);
    this.autoProduction = new AutoProduction(this);
    this.roundManager = new TurnManager(this);
    this.goToManager = new GoToManager(this, this.roundManager);
    this.playerStorage = new Map();
    this.devMode = false;
    this.victoryManager = new VictoryManager(this);
    this.isGameOver = false;
    this.victoryManager.syncStoreActions(this.storeActions);
  }

  /**
   * Initialize player storage for a civilization
   */
  private initializePlayerStorage(civilizationId: number): void {
    if (!this.playerStorage.has(civilizationId)) {
      this.playerStorage.set(civilizationId, {
        civilizationId,
        visibility: new Array(Constants.MAP_WIDTH * Constants.MAP_HEIGHT).fill(false),
        explored: new Array(Constants.MAP_WIDTH * Constants.MAP_HEIGHT).fill(false),
        lastKnownUnits: new Map(),
        lastKnownCities: new Map(),
        enemyLocations: new Map(), // Map from enemy civId to EnemyLocation[]
        scoutZones: [], // Scout zone assignments
        turnData: {}
      });
      console.log(`[PlayerStorage] Initialized storage for civilization ${civilizationId}`);
    }
  }

  /**
   * Get player storage for a civilization
   */
  getPlayerStorage(civilizationId: number): PlayerTurnStorage | undefined {
    return this.playerStorage.get(civilizationId);
  }

  /**
   * Update visibility for a player at a specific tile
   */
  setPlayerVisibility(civilizationId: number, col: number, row: number, visible: boolean, explored: boolean = false): void {
    const storage = this.playerStorage.get(civilizationId);
    if (!storage) return;
    
    const index = row * Constants.MAP_WIDTH + col;
    storage.visibility[index] = visible;
    if (explored) {
      storage.explored[index] = true;
    }
  }

  /**
   * Check if a tile is visible to a player
   */
  isVisibleToPlayer(civilizationId: number, col: number, row: number): boolean {
    // Dev mode: everything is visible
    if (this.devMode) return true;
    
    const storage = this.playerStorage.get(civilizationId);
    if (!storage) return false;
    
    const index = row * Constants.MAP_WIDTH + col;
    return storage.visibility[index] || false;
  }

  /**
   * Check if a tile has been explored by a player
   */
  isExploredByPlayer(civilizationId: number, col: number, row: number): boolean {
    // Dev mode: everything is explored
    if (this.devMode) return true;
    
    const storage = this.playerStorage.get(civilizationId);
    if (!storage) return false;
    
    const index = row * Constants.MAP_WIDTH + col;
    return storage.explored[index] || false;
  }

  /**
   * Get all units visible to a player (respects fog of war)
   */
  getVisibleUnits(civilizationId: number): Unit[] {
    // Dev mode: see all units
    if (this.devMode) return this.units;
    
    return this.units.filter(unit => {
      // Always see own units
      if (unit.civilizationId === civilizationId) return true;
      
      // See enemy units only if their tile is currently visible
      return this.isVisibleToPlayer(civilizationId, unit.col, unit.row);
    });
  }

  /**
   * Get all cities visible to a player (respects fog of war)
   */
  getVisibleCities(civilizationId: number): City[] {
    // Dev mode: see all cities
    if (this.devMode) return this.cities;
    
    return this.cities.filter(city => {
      // Always see own cities
      if (city.civilizationId === civilizationId) return true;
      
      // See enemy cities only if their tile has been explored
      return this.isExploredByPlayer(civilizationId, city.col, city.row);
    });
  }

  /**
   * Update visibility for all tiles based on current player's unit positions
   */
  updatePlayerVisibility(civilizationId: number): void {
    const storage = this.playerStorage.get(civilizationId);
    if (!storage) return;
    
    console.log(`[Visibility] Updating visibility for civilization ${civilizationId}`);
    
    // Dev mode: reveal everything
    if (this.devMode) {
      storage.visibility.fill(true);
      storage.explored.fill(true);
      console.log(`[Visibility] Dev mode: All tiles visible and explored`);
      return;
    }
    
    // Reset current visibility (but keep explored)
    storage.visibility.fill(false);
    
    // Calculate visibility from all player units
    const playerUnits = this.units.filter(u => u.civilizationId === civilizationId);
    
    for (const unit of playerUnits) {
      // Get unit sight range
      let sightRange = 1; // Default
      if (UNIT_PROPS && UNIT_PROPS[unit.type]) {
        sightRange = UNIT_PROPS[unit.type].sightRange || 1;
      }
      
      // Reveal tiles around unit
      for (let dr = -sightRange; dr <= sightRange; dr++) {
        for (let dc = -sightRange; dc <= sightRange; dc++) {
          const targetCol = unit.col + dc;
          const targetRow = unit.row + dr;
          
          if (this.isValidHex(targetCol, targetRow)) {
            const distance = Math.max(Math.abs(dc), Math.abs(dr));
            if (distance <= sightRange) {
              const index = targetRow * Constants.MAP_WIDTH + targetCol;
              storage.visibility[index] = true;
              storage.explored[index] = true;
            }
          }
        }
      }
    }
    
    // Calculate visibility from all player cities
    const playerCities = this.cities.filter(c => c.civilizationId === civilizationId);
    const citySightRange = 2; // Cities can see 2 tiles
    
    for (const city of playerCities) {
      for (let dr = -citySightRange; dr <= citySightRange; dr++) {
        for (let dc = -citySightRange; dc <= citySightRange; dc++) {
          const targetCol = city.col + dc;
          const targetRow = city.row + dr;
          
          if (this.isValidHex(targetCol, targetRow)) {
            const distance = Math.max(Math.abs(dc), Math.abs(dr));
            if (distance <= citySightRange) {
              const index = targetRow * Constants.MAP_WIDTH + targetCol;
              storage.visibility[index] = true;
              storage.explored[index] = true;
            }
          }
        }
      }
    }
    
    const visibleCount = storage.visibility.filter(v => v).length;
    const exploredCount = storage.explored.filter(e => e).length;
    console.log(`[Visibility] Civilization ${civilizationId}: ${visibleCount} visible, ${exploredCount} explored`);
  }

  /**
   * Set or queue production for a city by id.
   * If queue=true the item will be added to city's build queue, otherwise it will become current production.
   */
  setCityProduction(cityId: string, item: any, queue: boolean = false) {
    return this.productionManager.setCityProduction(cityId, item, queue);
  }

  purchaseCityProduction(cityId: string, item: any, civId?: number) {
    return this.productionManager.purchaseCityProduction(cityId, item, civId);
  }

  /**
   * Remove an item from a city's build queue by index.
   */
  removeCityQueueItem(cityId: string, index: number) {
    return this.productionManager.removeCityQueueItem(cityId, index);
  }

  /**
   * Remove current production from a city
   */
  removeCurrentProduction(cityId: string) {
    return this.productionManager.removeCurrentProduction(cityId);
  }

  /**
   * Toggle auto-production for a city
   */
  toggleAutoProduction(cityId: string, enabled: boolean) {
    const city = this.cities.find(c => c.id === cityId);
    if (city) {
      (city as any).autoProduction = enabled;
      console.log(`[GameEngine] Auto-production ${enabled ? 'enabled' : 'disabled'} for city ${cityId}`);
      
      // If enabling and city has no current production, set one immediately
      if (enabled && !city.currentProduction) {
        this.autoProduction.setAutoProduction(cityId);
      }
      
      if (this.onStateChange) {
        this.onStateChange('CITY_AUTO_PRODUCTION_CHANGED', { cityId, enabled });
      }
      return true;
    }
    return false;
  }

  // Small helper: sleep for ms milliseconds
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check and update the areTurnsDone flag for a unit
   * Sets to true if unit has no moves left OR is fortified OR is sleeping
   */
  private updateUnitTurnsDoneFlag(unit: any): void {
    const noMovesLeft = (unit.movesRemaining || 0) <= 0;
    const isFortified = unit.isFortified === true;
    const isSleeping = unit.isSleeping === true;
    
    unit.areTurnsDone = noMovesLeft || isFortified || isSleeping;
    
    if (unit.areTurnsDone) {
      console.log(`[GameEngine] Unit ${unit.id} turns done: movesRemaining=${unit.movesRemaining}, isFortified=${isFortified}, isSleeping=${isSleeping}`);
    }
  }

  // Emit event for AI target highlighting (UI decides how to render)
  private highlightAITarget(col: number, row: number, color: string = 'rgba(255,0,0,0.4)') {
    // Emit event for UI layer to handle highlighting
    this.onStateChange && this.onStateChange('AI_TARGET_HIGHLIGHT', { col, row, color });
  }

  // Choose a target for AI unit: prefer unexplored nearby tiles, then enemy units, then random neighbor
  private chooseAITarget(unit: any): { col: number; row: number } | null {
    if (!this.map || !this.squareGrid) return null;

    // Special handling for settlers: use SettlementEvaluator to find best city location
    if (unit.type === 'settler') {
      console.log(`[AI-SETTLER] Settler detected at (${unit.col}, ${unit.row}), using SettlementEvaluator`);
      
      try {
        const bestLocation = this.findBestSettlementForSettler(unit);
        if (bestLocation) {
          console.log(`[AI-SETTLER] SettlementEvaluator found best location at (${bestLocation.col}, ${bestLocation.row}) with score ${bestLocation.score}`);
          return { col: bestLocation.col, row: bestLocation.row };
        } else {
          console.log(`[AI-SETTLER] SettlementEvaluator found no suitable location, settler will explore randomly`);
        }
      } catch (error) {
        console.error(`[AI-SETTLER] Error calling SettlementEvaluator:`, error);
      }
    }

    // Special handling for scouts: use EnemySearcher to find enemies
    if (unit.type === 'scout') {
      console.log(`[AI-SCOUT] Scout detected at (${unit.col}, ${unit.row}), checking for enemies`);
      
      try {
        // Check if scout already found an enemy (stored in unit state)
        if (unit.enemyFound) {
          console.log(`[AI-SCOUT] Scout ${unit.id} has found enemy, returning to nearest city`);
          const nearestCity = this.findNearestOwnCity(unit);
          if (nearestCity) {
            // Check if scout reached the city
            if (unit.col === nearestCity.col && unit.row === nearestCity.row) {
              console.log(`[AI-SCOUT] Scout ${unit.id} reached city, fortifying`);
              unit.fortified = true;
              unit.movesRemaining = 0;
              
              // Trigger warrior production at this city
              this.triggerWarriorProduction(nearestCity, unit.enemyLocation);
              
              return null; // Scout is done
            }
            console.log(`[AI-SCOUT] Scout returning to city at (${nearestCity.col}, ${nearestCity.row})`);
            return { col: nearestCity.col, row: nearestCity.row };
          }
        }

        // Get visibility check function - use per-player visibility storage
        const playerStorage = this.getPlayerStorage(unit.civilizationId);
        const isVisible = (col: number, row: number) => {
          if (playerStorage) {
            const idx = row * this.map!.width + col;
            return playerStorage.visibility[idx] || playerStorage.explored[idx] || false;
          }
          // Fallback to tile visibility if storage not available
          const tile = this.getTileAt(col, row);
          return tile && (tile.visible || tile.explored);
        };

        // Search for enemies using Archimedean spiral with city prioritization
        const enemyResult = EnemySearcher.findNearestEnemy(
          unit.col,
          unit.row,
          this.map.width,
          this.map.height,
          (col, row) => this.getUnitAt(col, row),
          (col, row) => this.getCityAt(col, row),
          isVisible,
          unit.civilizationId
        );
        
        if (enemyResult) {
          console.log(`[AI-SCOUT] Enemy ${enemyResult.targetType} found at (${enemyResult.col}, ${enemyResult.row}), distance: ${enemyResult.distance}`);
          
          // Store enemy location in player storage for civilization-wide decision making
          this.recordEnemyLocation(unit.civilizationId, enemyResult);
          
          // Mark that scout found enemy
          unit.enemyFound = true;
          unit.enemyLocation = { col: enemyResult.col, row: enemyResult.row };
          
          // Start returning to nearest city
          const nearestCity = this.findNearestOwnCity(unit);
          if (nearestCity) {
            console.log(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
            return { col: nearestCity.col, row: nearestCity.row };
          }
        } else {
          console.log(`[AI-SCOUT] No enemy found near (${unit.col}, ${unit.row}), continuing exploration`);
        }
      } catch (error) {
        console.error(`[AI-SCOUT] Error using EnemySearcher:`, error);
      }
    }

    // 1) Nearby unexplored tile
    const unexplored = this.findNearbyUnexplored(unit);
    if (unexplored) {
      console.log(`[AI] Chose unexplored tile at (${unexplored.col},${unexplored.row})`);
      return { col: unexplored.col, row: unexplored.row };
    }

    // 2) Nearby enemy unit
    const enemy = this.findNearbyEnemy(unit);
    if (enemy) {
      console.log(`[AI] Chose enemy unit at (${enemy.col},${enemy.row})`);
      return { col: enemy.col, row: enemy.row };
    }

    // 3) Choose best neighbor based on terrain cost
    console.log(`[AI] No unexplored or enemy targets found, choosing best neighbor`);

    const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
    const terrainAnalysis = AIUtility.analyzeSurroundingTerrain(
      unit.col,
      unit.row,
      neighbors,
      (col, row) => this.getTileAt(col, row),
      (col, row) => this.getUnitAt(col, row),
      (col, row) => this.squareGrid!.isValidSquare(col, row)
    );

    if (terrainAnalysis.passableMoves.length > 0) {
      console.log(`[AI] Terrain analysis: ${terrainAnalysis.passableMoves.length} passable tiles, min cost: ${terrainAnalysis.minCost}, avg cost: ${terrainAnalysis.averageCost.toFixed(1)}`);

      const bestMove = AIUtility.chooseBestMove(terrainAnalysis);
      if (bestMove) {
        const terrainName = AIUtility.getTerrainName(bestMove.terrainType);
        console.log(`[AI] Chose best neighbor at (${bestMove.col},${bestMove.row}) - ${terrainName} (cost: ${bestMove.moveCost})`);
        return { col: bestMove.col, row: bestMove.row };
      }
    }

    console.log(`[AI] No valid target found for unit ${unit.id}`);
    return null;
  }

  // Find nearest own city for a unit
  private findNearestOwnCity(unit: any): City | null {
    if (!this.squareGrid) return null;
    
    const ownCities = this.cities.filter(c => c.civilizationId === unit.civilizationId);
    if (ownCities.length === 0) return null;
    
    let nearestCity: City | null = null;
    let minDistance = Infinity;
    
    for (const city of ownCities) {
      const distance = this.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
      if (distance < minDistance) {
        minDistance = distance;
        nearestCity = city;
      }
    }
    
    console.log(`[AI-SCOUT] Nearest city for unit ${unit.id} is at (${nearestCity?.col}, ${nearestCity?.row}), distance: ${minDistance}`);
    return nearestCity;
  }

  /**
   * Record enemy location in player's intelligence storage
   * Allows AI to make coordinated decisions based on known enemy positions
   * 
   * @param civilizationId Civilization recording the location
   * @param enemy Enemy search result from EnemySearcher
   */
  private recordEnemyLocation(civilizationId: number, enemy: any): void {
    const storage = this.getPlayerStorage(civilizationId);
    if (!storage) return;

    const round = this.roundManager.getRoundNumber();
    const location: EnemyLocation = {
      col: enemy.col,
      row: enemy.row,
      type: enemy.targetType,
      id: enemy.targetId,
      discoveredRound: round,
      lastSeenRound: round
    };

    // Get enemy civilization ID from the actual unit/city
    let enemyCivId = -1;
    if (enemy.targetType === 'unit') {
      const unit = this.getUnitAt(enemy.col, enemy.row);
      if (unit) enemyCivId = unit.civilizationId;
    } else if (enemy.targetType === 'city') {
      const city = this.getCityAt(enemy.col, enemy.row);
      if (city) enemyCivId = city.civilizationId;
    }

    if (enemyCivId < 0) return;

    // Initialize enemy list if needed
    if (!storage.enemyLocations.has(enemyCivId)) {
      storage.enemyLocations.set(enemyCivId, []);
    }

    // Update existing location or add new one
    const enemyList = storage.enemyLocations.get(enemyCivId)!;
    const existingIdx = enemyList.findIndex(e => e.id === enemy.targetId);
    
    if (existingIdx >= 0) {
      // Update last seen
      enemyList[existingIdx].lastSeenRound = round;
    } else {
      // Add new location
      enemyList.push(location);
    }

    console.log(`[AI] Recorded ${enemy.targetType} at (${enemy.col}, ${enemy.row}) for civ ${civilizationId}`);
  }

  /**
   * Get known enemy locations for a civilization
   * Used by AI to make coordinated decisions
   */
  public getKnownEnemyLocations(civilizationId: number, enemyCivId: number): EnemyLocation[] {
    const storage = this.getPlayerStorage(civilizationId);
    return storage?.enemyLocations.get(enemyCivId) || [];
  }

  /**
   * Initialize and assign scout zones for a civilization
   * Scouts coordinate by being assigned different zones to search
   */
  public assignScoutZones(civilizationId: number): void {
    const storage = this.getPlayerStorage(civilizationId);
    if (!storage) return;

    // Count scouts for this civilization
    const scouts = this.units.filter(u => u.civilizationId === civilizationId && u.type === 'scout');
    
    // Calculate zones based on scout count and map size
    storage.scoutZones = EnemySearcher.calculateScoutZones(scouts.length, this.map!.width, this.map!.height);

    if (this.devMode) {
      console.log(`[AI-COORDINATION] Assigned ${scouts.length} scouts with ${storage.scoutZones.length} zones`);
    }
  }

  /**
   * Check if position is in scout's assigned zone
   * Helps scouts coordinate and avoid searching same areas
   */
  public isInScoutZone(civilizationId: number, scoutIndex: number, col: number, row: number): boolean {
    const storage = this.getPlayerStorage(civilizationId);
    if (!storage || !storage.scoutZones[scoutIndex]) return true; // No zone restriction
    
    return EnemySearcher.isInZone(col, row, storage.scoutZones[scoutIndex]);
  }

  // Trigger warrior production at city and set target
  private triggerWarriorProduction(city: City, enemyLocation: { col: number; row: number } | undefined) {
    console.log(`[AI-CITY] Triggering warrior production at city ${city.name}`);
    
    // Set city production to warrior
    city.currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 };
    city.buildQueue = [{ type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }];
    
    // Store enemy location for when warrior is built (using any cast to extend type)
    if (enemyLocation) {
      (city as any).enemyTarget = enemyLocation;
      console.log(`[AI-CITY] Enemy target stored at (${enemyLocation.col}, ${enemyLocation.row})`);
    }
  }

  // Find best settlement location for a settler using SettlementEvaluator
  private findBestSettlementForSettler(unit: any): { col: number; row: number; score: number } | null {
    console.log(`[AI-SETTLER] Evaluating settlement locations for settler at (${unit.col}, ${unit.row})`);
    
    // Track position history to detect oscillation
    if (!(unit as any)._positionHistory) {
      (unit as any)._positionHistory = [];
    }
    const history = (unit as any)._positionHistory;
    const currentPos = `${unit.col},${unit.row}`;
    
    // Add current position to history
    history.push(currentPos);
    
    // Keep only last 6 positions
    if (history.length > 6) {
      history.shift();
    }
    
    // Detect oscillation: if we've visited the same position 3+ times in last 6 moves, we're oscillating
    const positionCounts = history.reduce((acc: Record<string, number>, pos: string) => {
      acc[pos] = (acc[pos] || 0) + 1;
      return acc;
    }, {});
    
    const isOscillating = Object.values(positionCounts).some((count: number) => count >= 3);
    
    // First, check if current location is a good settlement spot
    const currentTile = this.getTileAt(unit.col, unit.row);
    const currentCity = this.getCityAt(unit.col, unit.row);
    
    // Check if current position is valid for settling
    const currentPosValid = currentTile && 
        currentTile.type !== Constants.TERRAIN.OCEAN && 
        currentTile.type !== Constants.TERRAIN.MOUNTAINS && 
        !currentCity;
    
    if (currentPosValid && isOscillating) {
      console.log(`[AI-SETTLER] 🔄 Oscillation detected! Position history: ${history.join(' -> ')}`);
      console.log(`[AI-SETTLER] Founding city at current location to break oscillation`);
      // Directly found city here instead of returning target
      this.foundCityWithSettler(unit.id);
      return null;
    }
    
    // Choose appropriate weights based on game state
    const weights = SettlementEvaluator.balancedGrowthWeights();
    console.log(`[AI-SETTLER] Using strategy: Balanced Growth with weights:`, weights);
    
    // Use SettlementEvaluator to find best location
    const bestLocation = SettlementEvaluator.findBestSettlementLocation(
      unit.col,
      unit.row,
      (col, row) => this.getTileAt(col, row),
      (col, row) => this.getCityAt(col, row),
      (col, row) => this.getUnitAt(col, row),
      weights,
      3, // minDistanceFromOtherCities
      unit.civilizationId,
      (col, row) => {
        // Check visibility - AI can only settle on visible tiles
        const tile = this.getTileAt(col, row);
        return tile && (tile.visible || tile.explored);
      },
      (fromCol, fromRow, toCol, toRow) => {
        // Check if settler can reach the location (simple path check)
        if (!this.squareGrid) return false;
        const path = this.squareGrid.findPath(fromCol, fromRow, toCol, toRow, new Set());
        return path.length > 0;
      }
    );
    
    if (bestLocation) {
      console.log(`[AI-SETTLER] Best settlement location found: (${bestLocation.col}, ${bestLocation.row})`);
      console.log(`[AI-SETTLER] Score: ${bestLocation.score}, Yields:`, bestLocation.yields);
      console.log(`[AI-SETTLER] Water access: ${bestLocation.hasWaterAccess}`);
      
      // If we have a pathfinding grid available, precompute and store a path
      try {
        if (this.squareGrid && this.roundManager) {
          const path = this.squareGrid.findPath(unit.col, unit.row, bestLocation.col, bestLocation.row, new Set());
          if (path && path.length > 0) {
            console.log(`[AI-SETTLER] Precomputed path for settler ${unit.id} with ${path.length} steps`);
            this.roundManager.setUnitPath(unit.id, path);
          } else {
            console.log(`[AI-SETTLER] No path found to best location for settler ${unit.id}`);
          }
        }
      } catch (e) {
        console.error('[AI-SETTLER] Error while precomputing path for settler:', e);
      }

      // Check if settler is already at the best location
      if (bestLocation.col === unit.col && bestLocation.row === unit.row) {
        console.log(`[AI-SETTLER] Settler is already at best location, will found city`);
        // Found city immediately
        this.foundCityWithSettler(unit.id);
        return null; // No need to move
      }
      
      // Store target to detect oscillation on next evaluation
      (unit as any)._lastSettlementTarget = { col: bestLocation.col, row: bestLocation.row };
      
      return bestLocation;
    }
    
    console.log(`[AI-SETTLER] No suitable settlement location found`);
    return null;
  }

  // Find nearby unexplored tile (uses GameEngine's map representation)
  private findNearbyUnexplored(unit: any): any {
    if (!this.map || !this.squareGrid) return null;
    const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
    for (const tilePos of neighbors) {
      const tile = this.getTileAt(tilePos.col, tilePos.row);
      if (tile && !tile.explored) {
        return tilePos;
      }
    }
    return null;
  }

  // Find nearby enemy unit
  private findNearbyEnemy(unit: any): any {
    if (!this.squareGrid) return null;
    const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
    for (const tilePos of neighbors) {
      const enemyUnit = this.getUnitAt(tilePos.col, tilePos.row);
      if (enemyUnit && enemyUnit.civilizationId !== unit.civilizationId) {
        return enemyUnit;
      }
    }
    return null;
  }

  /**
   * Process AI turn for a civilization (public method for RoundManager)
   */
  processAITurn(civilizationId: number) {
    const civ = this.civilizations[civilizationId];
    if (!civ) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} not found`);
      return;
    }
    if (civ.isHuman) {
      console.log(`[AI] processAITurn: Skipping civilization ${civilizationId} - is human player`);
      return;
    }
    // CRITICAL: Only allow AI to act during its own turn
    if (this.activePlayer !== civilizationId) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} attempted to act outside its turn (active player: ${this.activePlayer})`);
      return;
    }
    // Return promise so RoundManager can coordinate timeouts/end-of-turn
    return this.runAITurn(civilizationId).catch(err => console.error('AI turn error', err));
  }

  // Run an asynchronous AI turn for civilizationId
  async runAITurn(civilizationId: number) {
    const civ = this.civilizations[civilizationId];
    if (!civ || civ.isHuman) {
      console.log(`[AI] runAITurn: Skipping civilization ${civilizationId} - not AI or is human`);
      return;
    }
    // CRITICAL: Verify this is still the active player before proceeding
    if (this.activePlayer !== civilizationId) {
      console.warn(`[AI] runAITurn: Turn changed before AI could act (expected: ${civilizationId}, actual: ${this.activePlayer})`);
      return;
    }
    console.log(`[AI] 🤖 Starting AI turn for civilization ${civilizationId} (${civ.name})`);
    
    // Timing now coordinated by RoundManager; this method focuses only on AI logic
    
    // Small delay before AI starts so player can observe
    await this.sleep(250);

    const aiUnits = this.units.filter(u => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0);
    console.log(`[AI] Found ${aiUnits.length} units with moves remaining for civilization ${civilizationId}`);

    for (const unit of aiUnits) {
      
      console.log(`[AI] Processing unit ${unit.id} (${unit.type}) at (${unit.col},${unit.row}) with ${unit.movesRemaining} moves remaining`);
      
      // Safety: Prevent infinite loops by limiting iterations per unit
      let movementAttempts = 0;
      const MAX_MOVEMENT_ATTEMPTS = 50; // Reasonable limit for movement attempts
      let previousMoves = unit.movesRemaining;
      let stuckCounter = 0;
      const MAX_STUCK_ITERATIONS = 3; // If moves don't change for 3 iterations, unit is stuck
      
      // While this unit can move, pick targets and attempt actions
      while ((unit.movesRemaining || 0) > 0) {
        movementAttempts++;
        
        // Check if unit is stuck (moves not decreasing)
        if (unit.movesRemaining === previousMoves) {
          stuckCounter++;
          if (stuckCounter >= MAX_STUCK_ITERATIONS) {
            console.warn(`[AI] ⚠️ Unit ${unit.id} stuck - moves not decreasing after ${stuckCounter} iterations, forcing skip`);
            this.skipUnit(unit.id);
            break;
          }
        } else {
          stuckCounter = 0; // Reset stuck counter if moves changed
        }
        previousMoves = unit.movesRemaining;
        
        if (movementAttempts > MAX_MOVEMENT_ATTEMPTS) {
          console.warn(`[AI] ⚠️ Unit ${unit.id} exceeded maximum movement attempts (${MAX_MOVEMENT_ATTEMPTS}), forcing skip`);
          this.skipUnit(unit.id);
          break;
        }
        
        const target = this.chooseAITarget(unit);
        if (!target) {
          // No valid target, skip the unit's turn
          console.log(`[AI] No target found for unit ${unit.id}, skipping`);
          this.skipUnit(unit.id);
          break;
        }

        // Highlight chosen target
        this.highlightAITarget(target.col, target.row);

        // Special handling for settlers: found city when at target location
        if (unit.type === 'settler' && unit.col === target.col && unit.row === target.row) {
          console.log(`[AI-SETTLER] Settler ${unit.id} has reached settlement location (${target.col}, ${target.row}), founding city`);
          const result = this.foundCityWithSettler(unit.id);
          if (result) {
            console.log(`[AI-SETTLER] City founded successfully`);
            break; // Settler consumed, end this unit's processing
          } else {
            console.log(`[AI-SETTLER] Failed to found city, continuing movement`);
          }
        }

        // If target is adjacent, try to move or attack
        const dist = this.squareGrid.squareDistance(unit.col, unit.row, target.col, target.row);
        console.log(`[AI] Target distance: ${dist} for unit ${unit.id} to (${target.col},${target.row})`);
        if (dist === 1) {
          const targetUnit = this.getUnitAt(target.col, target.row);
          if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
            // Attack
            console.log(`[AI] Unit ${unit.id} attacking unit at (${target.col},${target.row})`);
            // Check move cost before attempting attack
            const tt = this.getTileAt(target.col, target.row);
            const attackCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) >= attackCost) {
              console.log(`[AI] Attack cost: ${attackCost}, unit has ${unit.movesRemaining} moves - proceeding with attack`);
              this.moveUnit(unit.id, target.col, target.row);
            } else {
              console.log(`[AI] Not enough moves for attack (cost: ${attackCost}, has: ${unit.movesRemaining})`);
              // Not enough movement points to attack, break out for this unit
              break;
            }
          } else {
            // Move into the tile
            const tt = this.getTileAt(target.col, target.row);
            const moveCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) >= moveCost) {
              console.log(`[AI] Moving to adjacent tile (${target.col},${target.row}), cost: ${moveCost}, remaining moves: ${unit.movesRemaining}`);
              this.moveUnit(unit.id, target.col, target.row);
            } else {
              console.log(`[AI] Not enough moves for adjacent move (cost: ${moveCost}, has: ${unit.movesRemaining})`);
              break;
            }
          }
        } else {
          // Pathfind towards target and take next step
          console.log(`[AI] Pathfinding to non-adjacent target (${target.col},${target.row})`);
          const path = this.squareGrid.findPath(unit.col, unit.row, target.col, target.row, new Set());
          if (path.length > 1) {
            const next = path[1];
            console.log(`[AI] Path found, next step to (${next.col},${next.row}), path length: ${path.length}`);
            // Check move cost for next step
            const tt = this.getTileAt(next.col, next.row);
            const nextCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) < nextCost) {
              console.log(`[AI] Not enough moves for path step (cost: ${nextCost}, has: ${unit.movesRemaining})`);
              // Not enough movement for next step — end this unit's moves
              break;
            }

            console.log(`[AI] Moving along path to (${next.col},${next.row}), cost: ${nextCost}`);
            // Attempt the move and inspect structured result
            const result = this.moveUnit(unit.id, next.col, next.row);
            if (!result || !result.success) {
              const reason = result?.reason || 'unknown';
              // Treat certain reasons as terminal for this unit for this turn
              const terminalReasons = new Set(['insufficient_moves', 'no_moves_left', 'terrain_impassable', 'invalid_target']);
              if (terminalReasons.has(reason)) {
                console.log(`[AI] Path step failed with terminal reason: ${reason}, ending unit movement`);
                break;
              }
              // Non-terminal failure, try fallback to any valid neighbor
              console.log(`[AI] Path step failed with non-terminal reason: ${reason}, trying fallback`);

              const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);

              const terrainAnalysis = AIUtility.analyzeSurroundingTerrain(
                unit.col,
                unit.row,
                neighbors,
                (col, row) => this.getTileAt(col, row),
                (col, row) => this.getUnitAt(col, row),
                (col, row) => this.squareGrid!.isValidSquare(col, row)
              );

              if (terrainAnalysis.passableMoves.length > 0) {
                // Prefer moves we can afford with current moves remaining
                const affordableMoves = terrainAnalysis.passableMoves.filter(m =>
                  AIUtility.canAffordMove(unit.movesRemaining || 0, m.moveCost)
                );

                if (affordableMoves.length > 0) {
                  // Pick cheapest affordable move
                  const moveOption = affordableMoves.reduce((best, current) =>
                    current.moveCost < best.moveCost ? current : best
                  );
                  console.log(`[AI] Found affordable fallback move to (${moveOption.col},${moveOption.row}) - cost: ${moveOption.moveCost}, remaining: ${unit.movesRemaining}`);
                  const r = this.moveUnit(unit.id, moveOption.col, moveOption.row);
                  if (!r || !r.success) {
                    console.log(`[AI] Fallback move failed, ending unit movement`);
                    break;
                  }
                } else {
                  console.log(`[AI] Cannot afford any neighbor move, ending unit movement`);
                  break;
                }
              } else {
                console.log(`[AI] No passable moves available, ending unit movement`);
                break;
              }
            }
          } else {
            console.log(`[AI] No path found to target, trying fallback to any valid neighbor`);
            // No path found, try moving to any valid neighbor as fallback
            const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
            const terrainAnalysis = AIUtility.analyzeSurroundingTerrain(
              unit.col,
              unit.row,
              neighbors,
              (col, row) => this.getTileAt(col, row),
              (col, row) => this.getUnitAt(col, row),
              (col, row) => this.squareGrid!.isValidSquare(col, row)
            );
            if (terrainAnalysis.passableMoves.length > 0) {
              // Prefer moves we can afford with current moves remaining
              const affordableMoves = terrainAnalysis.passableMoves.filter(m =>
                AIUtility.canAffordMove(unit.movesRemaining || 0, m.moveCost)
              );

              if (affordableMoves.length > 0) {
                // Pick cheapest affordable move
                const moveOption = affordableMoves.reduce((best, current) =>
                  current.moveCost < best.moveCost ? current : best
                );
                console.log(`[AI] Found affordable fallback move to (${moveOption.col},${moveOption.row}) - cost: ${moveOption.moveCost}, remaining: ${unit.movesRemaining}`);
                const r = this.moveUnit(unit.id, moveOption.col, moveOption.row);
                if (!r || !r.success) {
                  console.log(`[AI] Fallback move failed, ending unit movement`);
                  break;
                }
              } else {
                console.log(`[AI] Cannot afford any neighbor move, ending unit movement`);
                break;
              }
            } else {
              console.log(`[AI] No passable moves available, ending unit movement`);
              break;
            }
          }
        }

        // Wait a little so moves are visible
        await this.sleep(200);
      }
      console.log(`[AI] Finished processing unit ${unit.id}, final moves remaining: ${unit.movesRemaining}`);
    }

    console.log(`[AI] Finished all units for civilization ${civilizationId}`);
    // Emit event to clear highlights (UI decides how to handle)
    this.onStateChange && this.onStateChange('AI_CLEAR_HIGHLIGHTS', { civilizationId });

    // Process auto-production for AI cities
    console.log(`[AI] Processing auto-production for civilization ${civilizationId}`);
    this.autoProduction.processAutoProductionForCivilization(civilizationId);

    // Signal AI finished (for UI updates)
    console.log(`[AI] AI turn completed for civilization ${civilizationId}`);
    this.onStateChange && this.onStateChange('AI_FINISHED', { civilizationId });

    // RoundManager now responsible for evaluating end-of-turn and timeouts
  }


  /**
   * Initialize the game engine with settings
   */
  async initialize(settings = {}) {
    console.log('Initializing game engine...');
    
    // Merge custom settings
    this.gameSettings = { ...this.gameSettings, ...settings };

    // Fresh game setup resets victory checks and player visibility storage
    this.isGameOver = false;
    this.victoryManager.reset();
    this.victoryManager.syncStoreActions(this.storeActions);
    this.playerStorage.clear();
    
    // Set dev mode from settings
    this.devMode = (settings as any).devMode || false;
    console.log(`[GameEngine] Developer mode: ${this.devMode ? 'ENABLED' : 'DISABLED'}`);
    
    // Validate playerCivilization index
    if (this.gameSettings.playerCivilization < 0 || 
        this.gameSettings.playerCivilization >= CIVILIZATIONS.length) {
      console.error('Invalid playerCivilization index:', this.gameSettings.playerCivilization);
      this.gameSettings.playerCivilization = 0; // Default to first civilization
    }
    
    // Determine map size based on map type
    const mapType = this.gameSettings.mapType || 'NORMAL_SKIRMISH';
    let mapWidth = Constants.MAP_WIDTH;
    let mapHeight = Constants.MAP_HEIGHT;
    
    if (['CLOSEUP_1V1', 'CLOSEUP_BEATUP', 'NAVAL_CLOSEUP'].includes(mapType)) {
      mapWidth = 20;
      mapHeight = 20;
      console.log(`[GameEngine] Using small map size for ${mapType}: ${mapWidth}x${mapHeight}`);
    }
    
    // Create hex grid system with appropriate size
    this.squareGrid = new SquareGrid(mapWidth, mapHeight);
    
    // Generate initial game state
    await this.generateWorld(mapWidth, mapHeight, mapType);
    await this.createCivilizations(mapType);
    await this.initializeTechnologies(mapType);

    // Push freshly generated state into the store if available before computing visibility
    if (this.storeActions) {
      this.storeActions.clearGameResult?.();
      this.storeActions.updateMap(this.map);
      this.storeActions.updateUnits(this.units);
      this.storeActions.updateCities(this.cities);
      this.storeActions.updateCivilizations(this.civilizations);
      this.storeActions.updateTechnologies(this.technologies);
    }

    // Initialize fog of war visibility
    this.updateVisibility();
    
    this.isInitialized = true;
    console.log('Game engine initialized successfully');
    console.log(`Starting year: ${this.formatYear(this.currentYear)}`);
    console.log(`Player civilization: ${this.civilizations[0].name}`);
    
    // Start the first turn for the active player (human player 0)
    console.log('[GameEngine] Starting first turn for player', this.activePlayer);
    this.roundManager.startTurn(this.activePlayer);
  }

  /**
   * Generate the game world with terrain
   */
  async generateWorld(mapWidth: number = Constants.MAP_WIDTH, mapHeight: number = Constants.MAP_HEIGHT, mapType: string = 'NORMAL_SKIRMISH') {
    const tiles = [];
    
    console.log(`[GameEngine] Generating world: ${mapWidth}x${mapHeight}, type: ${mapType}`);
    
    // Naval Close up - water-only map
    if (mapType === 'NAVAL_CLOSEUP') {
      for (let row = 0; row < mapHeight; row++) {
        for (let col = 0; col < mapWidth; col++) {
          tiles.push({
            col,
            row,
            type: Constants.TERRAIN.OCEAN,
            resource: Math.random() < 0.2 ? 'fish' : null, // 20% chance of fish
            visible: false,
            explored: false
          });
        }
      }
    } else {
      // Standard terrain generation for other modes
      for (let row = 0; row < mapHeight; row++) {
        for (let col = 0; col < mapWidth; col++) {
          let terrainType: string = Constants.TERRAIN.GRASSLAND;
          
          // Ocean around edges (except for small maps)
          if (mapWidth >= 40 && mapHeight >= 40) {
            if (row === 0 || row === mapHeight - 1 ||
                col === 0 || col === mapWidth - 1) {
              terrainType = Constants.TERRAIN.OCEAN;
            }
          }
          
          // Random terrain generation
          if (terrainType !== Constants.TERRAIN.OCEAN) {
            const rand = Math.random();
            if (rand < 0.05) terrainType = Constants.TERRAIN.MOUNTAINS;
            else if (rand < 0.2) terrainType = Constants.TERRAIN.HILLS;
            else if (rand < 0.3) terrainType = Constants.TERRAIN.FOREST;
            else if (rand < 0.4) terrainType = Constants.TERRAIN.DESERT;
            else if (rand < 0.5) terrainType = Constants.TERRAIN.PLAINS;
            else if (rand < 0.6) terrainType = Constants.TERRAIN.TUNDRA;
            else terrainType = Constants.TERRAIN.GRASSLAND;
          }

          tiles.push({
            col,
            row,
            type: terrainType,
            resource: Math.random() < 0.1 ? 'bonus' : null,
            visible: false,
            explored: false
          });
        }
      }
    }
    
    this.map = {
      width: mapWidth,
      height: mapHeight,
      tiles
    };
    
    console.log('World generated with', tiles.length, 'tiles');
  }

  /**
   * Create civilizations and place starting units
   */
  async createCivilizations(mapType: string = 'NORMAL_SKIRMISH') {
    const numCivs = Math.min(this.gameSettings.numberOfCivilizations, CIVILIZATIONS.length);
    const selectedCivs = [];
    
    // Always include player's chosen civilization first
    selectedCivs.push(CIVILIZATIONS[this.gameSettings.playerCivilization]);
    
    // Add other random civilizations
    const availableCivs = CIVILIZATIONS.filter((_, idx) => idx !== this.gameSettings.playerCivilization);
    for (let i = 1; i < numCivs; i++) {
      const randomIdx = Math.floor(Math.random() * availableCivs.length);
      selectedCivs.push(availableCivs.splice(randomIdx, 1)[0]);
    }

    this.civilizations = [];
    this.units = [];
    this.cities = [];

    for (let i = 0; i < selectedCivs.length; i++) {
      const civData = selectedCivs[i];
      
      const isHuman = i === 0;
      const civ = {
        id: i,
        name: civData.name,
        leader: civData.leader,
        color: civData.color,
        cityNames: [...civData.cityNames],
        nextCityNameIndex: 0,
        isAlive: true,
        isHuman: isHuman,
        isAI: !isHuman,
        resources: {
          food: 0,
          production: 0,
          trade: 0,
          science: 0,
          gold: this.gameSettings.startingGold
        },
        technologies: ['irrigation', 'mining', 'roads'],
        currentResearch: null,
        researchProgress: 0,
        scienceRate: 50,
        taxRate: 0,
        luxuryRate: 50,
        government: 'despotism',
        score: 0
      };

      // Find starting position
      let startPos = null;
      let attempts = 0;
      const mapWidth = this.map?.width || Constants.MAP_WIDTH;
      const mapHeight = this.map?.height || Constants.MAP_HEIGHT;
      const minDist = mapWidth <= 20 ? 5 : 12; // Smaller distance for small maps
      
      while (!startPos && attempts < 100) {
        const col = Math.floor(Math.random() * (mapWidth - 4)) + 2;
        const row = Math.floor(Math.random() * (mapHeight - 4)) + 2;
        
        const tile = this.getTileAt(col, row);
        if (tile && tile.type !== Constants.TERRAIN.OCEAN &&
            tile.type !== Constants.TERRAIN.MOUNTAINS) {
          // Check if position is far enough from other civs
          let validPosition = true;
          for (const otherCiv of this.civilizations) {
            const otherUnits = this.units.filter(u => u.civilizationId === otherCiv.id);
            for (const unit of otherUnits) {
              if (this.squareGrid.squareDistance(col, row, unit.col, unit.row) < minDist) {
                validPosition = false;
                break;
              }
            }
          }
          
          if (validPosition) {
            startPos = { col, row };
          }
        }
        attempts++;
      }

      if (startPos) {
        // Create starting units based on map type
        console.log(`[INIT] Creating starting units for civ ${i} (${civData.name}) at (${startPos.col},${startPos.row}), mapType: ${mapType}`);
        this.createStartingUnits(i, startPos, mapType);
        
        // Create starting cities for MANY_CITIES mode
        if (mapType === 'MANY_CITIES') {
          this.createStartingCities(i, civ, startPos);
        }
      } else {
        console.warn(`[INIT] Failed to find valid starting position for civ ${i} (${civData.name}) after ${attempts} attempts`);
      }

      this.civilizations.push(civ);
    }

    console.log('Created', this.civilizations.length, 'civilizations');
    console.log('Player civilization:', this.civilizations[0].name, 'led by', this.civilizations[0].leader);
    console.log(`Map type: ${mapType}`);
    
    // Initialize player storage for each civilization
    for (let i = 0; i < this.civilizations.length; i++) {
      this.initializePlayerStorage(i);
    }
  }

  /**
   * Create starting units for a civilization based on map type
   */
  private createStartingUnits(civId: number, startPos: { col: number; row: number }, mapType: string) {
    console.log(`[UNITS] createStartingUnits called for civId ${civId}, mapType: ${mapType}, position: (${startPos.col},${startPos.row})`);
    const militaryUnits = ['warriors', 'phalanx', 'legion', 'musketeers', 'riflemen'];
    
    switch (mapType) {
      case 'NORMAL_SKIRMISH':
      case 'CLOSEUP_1V1':
      case 'TECH_LEVEL_10':
        // Standard: 1 settler
        console.log(`[UNITS] Creating 1 settler for civ ${civId}`);
        this.createUnit(civId, 'settler', startPos.col, startPos.row);
        break;
        
      case 'CLOSEUP_BEATUP':
        // 1 settler + variety of military units
        this.createUnit(civId, 'settler', startPos.col, startPos.row);
        this.createUnit(civId, 'warriors', startPos.col + 1, startPos.row);
        this.createUnit(civId, 'phalanx', startPos.col - 1, startPos.row);
        this.createUnit(civId, 'legion', startPos.col, startPos.row + 1);
        this.createUnit(civId, 'musketeers', startPos.col, startPos.row - 1);
        this.createUnit(civId, 'riflemen', startPos.col + 1, startPos.row + 1);
        break;
        
      case 'NAVAL_CLOSEUP':
        // Naval units only
        this.createUnit(civId, 'trireme', startPos.col, startPos.row);
        this.createUnit(civId, 'trireme', startPos.col + 1, startPos.row);
        break;
        
      case 'NO_SETTLERS':
        // Variety of military units, no settlers
        this.createUnit(civId, 'warriors', startPos.col, startPos.row);
        this.createUnit(civId, 'warriors', startPos.col + 1, startPos.row);
        this.createUnit(civId, 'phalanx', startPos.col - 1, startPos.row);
        this.createUnit(civId, 'legion', startPos.col, startPos.row + 1);
        this.createUnit(civId, 'musketeers', startPos.col, startPos.row - 1);
        break;
        
      case 'MANY_CITIES':
        // 2 warriors (cities created separately)
        this.createUnit(civId, 'warriors', startPos.col, startPos.row);
        this.createUnit(civId, 'warriors', startPos.col + 1, startPos.row);
        break;
        
      default:
        this.createUnit(civId, 'settler', startPos.col, startPos.row);
    }
  }

  /**
   * Create a single unit
   */
  private createUnit(civId: number, type: string, col: number, row: number) {
    const unitProps = UNIT_PROPS[type] || { movement: 1, attack: 1, defense: 1, icon: '⚔️' };
    const unitId = `${type}_${civId}_${this.units.filter(u => u.civilizationId === civId).length}`;
    
    const unit = {
      id: unitId,
      civilizationId: civId,
      type: type,
      name: (unitProps as any).name || type,
      col: col,
      row: row,
      health: 100,
      movesRemaining: unitProps.movement || 1,
      maxMoves: unitProps.movement || 1,
      isVeteran: false,
      attack: unitProps.attack || 0,
      defense: unitProps.defense || 1,
      icon: unitProps.icon || '⚔️',
      orders: null
    };
    
    this.units.push(unit);
    console.log(`[UNIT] Created ${type} for civ ${civId} at (${col},${row})`);
  }

  /**
   * Create starting cities for MANY_CITIES mode
   */
  private createStartingCities(civId: number, civ: any, startPos: { col: number; row: number }) {
    const cityPositions = [
      { col: startPos.col, row: startPos.row },
      { col: startPos.col + 5, row: startPos.row },
      { col: startPos.col, row: startPos.row + 5 },
      { col: startPos.col - 5, row: startPos.row }
    ];
    
    for (let i = 0; i < 4; i++) {
      const pos = cityPositions[i];
      const tile = this.getTileAt(pos.col, pos.row);
      
      if (tile && tile.type !== Constants.TERRAIN.OCEAN && tile.type !== Constants.TERRAIN.MOUNTAINS) {
        // Get city name
        const cityName = civ.cityNames[civ.nextCityNameIndex] || `City ${civ.nextCityNameIndex + 1}`;
        civ.nextCityNameIndex++;
        
        const cityId = `city_${civId}_${this.cities.length}`;
        const city = {
          id: cityId,
          name: cityName,
          civilizationId: civId,
          col: pos.col,
          row: pos.row,
          population: 1,
          food: 0,
          foodRequired: 20,
          production: 0,
          gold: 0,
          science: 0,
          currentProduction: null,
          productionProgress: 0,
          buildings: [],
          tiles: [],
          culture: 0,
          happiness: 0
        };
        
        this.cities.push(city);
        console.log(`[CITY] Created ${cityName} for civ ${civId} at (${pos.col},${pos.row})`);
        
        // Add improvements around city (roads and irrigation)
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const tileCol = pos.col + dc;
            const tileRow = pos.row + dr;
            const targetTile = this.getTileAt(tileCol, tileRow);
            
            if (targetTile && targetTile.type !== Constants.TERRAIN.OCEAN) {
              targetTile.improvement = (dr === 0 || dc === 0) ? 'road' : 'irrigation';
            }
          }
        }
      }
    }
  }

  /**
   * Reveal map tiles around a position for the active player
   */
  revealArea(centerCol, centerRow, radius) {
    // Update player storage
    const storage = this.playerStorage.get(this.activePlayer);
    if (storage) {
      for (let row = centerRow - radius; row <= centerRow + radius; row++) {
        for (let col = centerCol - radius; col <= centerCol + radius; col++) {
          if (this.isValidHex(col, row)) {
            const distance = Math.max(Math.abs(col - centerCol), Math.abs(row - centerRow));
            if (distance <= radius) {
              const index = row * Constants.MAP_WIDTH + col;
              storage.visibility[index] = true;
              storage.explored[index] = true;
            }
          }
        }
      }
    }
    
    if (this.storeActions) {
      this.storeActions.revealArea(centerCol, centerRow, radius);
    }
  }

  /**
   * Update fog of war visibility for all tiles
   * Delegates to store actions for centralized visibility management
   */
  updateVisibility() {
    // Update store visibility for UI rendering
    if (this.storeActions) {
      this.storeActions.updateVisibility();
    }

    // Update per-player visibility storage for game logic (EnemySearcher, AI decisions, etc.)
    for (const civ of this.civilizations) {
      this.updatePlayerVisibility(civ.id);
    }
  }

  /**
   * Set visibility (but not explored) for an area
   */
  setVisibilityArea(centerCol, centerRow, radius) {
    if (!this.map) return;
    
    for (let row = centerRow - radius; row <= centerRow + radius; row++) {
      for (let col = centerCol - radius; col <= centerCol + radius; col++) {
        const tile = this.getTileAt(col, row);
        if (tile && this.squareGrid.squareDistance(centerCol, centerRow, col, row) <= radius) {
          tile.visible = true;
          // Also mark as explored when first seen
          if (!tile.explored) {
            tile.explored = true;
          }
        }
      }
    }
  }

  /**
   * Initialize technology tree
   */
  async initializeTechnologies(mapType: string = 'NORMAL_SKIRMISH') {
    // For TECH_LEVEL_10 mode, grant all technologies to all civilizations
    if (mapType === 'TECH_LEVEL_10') {
      console.log('[TECH] Granting all technologies for TECH_LEVEL_10 mode');
      const allTechs = Object.keys(TECHNOLOGIES);
      
      for (const civ of this.civilizations) {
        civ.technologies = [...allTechs];
        console.log(`[TECH] Civilization ${civ.name} received ${allTechs.length} technologies`);
      }
    }
    // Standard starting technologies are already set in createCivilizations
    
    console.log('Technology tree initialized');
  }

  /**
   * Format year for display (4000 BC, 1000 AD, etc.)
   */
  formatYear(year) {
    if (year < 0) {
      return `${Math.abs(year)} BC`;
    } else if (year > 0) {
      return `${year} AD`;
    } else {
      return '1 BC'; // Year 0 doesn't exist historically
    }
  }

  /**
   * Get next city name for a civilization
   */
  getNextCityName(civilizationId) {
    const civ = this.civilizations[civilizationId];
    if (!civ) return 'City';
    
    const name = civ.cityNames[civ.nextCityNameIndex] || `${civ.name} City ${civ.nextCityNameIndex + 1}`;
    civ.nextCityNameIndex++;
    return name;
  }

  /**
   * Found a new city
   */
  foundCity(col: number, row: number, civilizationId: number, customName = null) {
    const civ = this.civilizations[civilizationId];
    if (!civ) return null;

    const cityId = `city_${civilizationId}_${this.cities.length}`;
    const cityName = customName || this.getNextCityName(civilizationId);

    const city = {
      id: cityId,
      name: cityName,
      civilizationId: civilizationId,
      col: col,
      row: row,
      population: 1,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      foodStored: 0,
      foodRequired: 20, // Food needed for next population
      shields: 0, // Production shields
      currentProduction: 'warrior', // Start building a settler
      productionQueue: [],
      buildings: [],
      wonders: [],
      workingTiles: [], // Tiles being worked by citizens
      isCapital: this.cities.filter(c => c.civilizationId === civilizationId).length === 0,
      happiness: {
        happy: 0,
        content: 1,
        unhappy: 0
      },
      // Resource output per turn
      output: {
        food: 0,
        production: 0,
        trade: 0,
        science: 0,
        gold: 0
      }
    };

    this.cities.push(city);
    
    // Remove settler unit that founded the city
    const settlerIdx = this.units.findIndex(u => 
      u.col === col && u.row === row && u.civilizationId === civilizationId && u.type === 'settler'
    );
    if (settlerIdx !== -1) {
      this.units.splice(settlerIdx, 1);
    }

    console.log(`${civ.name} founded ${cityName} at (${col}, ${row})`);
    return city;
  }
  async createTechnologies() {
    this.technologies = [
      {
        id: 'pottery',
        name: 'Pottery',
        description: 'Allows granary construction',
        cost: 20,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'bronze_working',
        name: 'Bronze Working',
        description: 'Enables bronze weapons and tools',
        cost: 30,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'alphabet',
        name: 'Alphabet',
        description: 'Enables library construction',
        cost: 40,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'iron_working',
        name: 'Iron Working',
        description: 'Enables iron weapons',
        cost: 50,
        prerequisites: ['bronze_working'],
        available: false,
        researched: false
      }
    ];
  }

  /**
   * Convert screen coordinates to hex coordinates
   */
  screenToHex(screenX, screenY) {
    return this.squareGrid.getSquareAtPosition(screenX, screenY);
  }

  /**
   * Check if hex coordinates are valid
   */
  isValidHex(col: number, row: number) {
    return this.squareGrid.isValidSquare(col, row);
  }

  /**
   * Get tile at coordinates
   */
  getTileAt(col: number, row: number) {
    if (!this.squareGrid.isValidSquare(col, row)) return null;
    const index = row * this.map.width + col;
    return this.map.tiles[index] || null;
  }

  /**
   * Get unit at coordinates
   */
  getUnitAt(col: number, row: number) {
    return this.units.find(unit => unit.col === col && unit.row === row) || null;
  }

  /**
   * Get city at coordinates
   */
  getCityAt(col: number, row: number) {
    return this.cities.find(city => city.col === col && city.row === row) || null;
  }

  /**
   * Get all units
   */
  getAllUnits() {
    // Prefer units managed by the map/unitManager when available
    try {
      if ((this as any).map && typeof (this as any).map.getAllUnits === 'function') {
        return (this as any).map.getAllUnits();
      }
    } catch (e) {
      // fall back
    }
    return [...this.units];
  }

  /**
   * Get all cities
   */
  getAllCities() {
    // Prefer cities managed by the map/cityManager when available
    try {
      if ((this as any).map && typeof (this as any).map.getCities === 'function') {
        return (this as any).map.getCities();
      }
      if ((this as any).map && typeof (this as any).map.getAllCities === 'function') {
        return (this as any).map.getAllCities();
      }
    } catch (e) {
      // fall back
    }
    return [...this.cities];
  }

  /**
   * Check if a unit can move to a specific position
   */
  canUnitMoveTo(unitId: string, targetCol: number, targetRow: number) {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.log(`[canUnitMoveTo] Invalid unitId: ${unitId}`);
      return false;
    }
    if (!this.squareGrid.isValidSquare(targetCol, targetRow)) {
      console.log(`[canUnitMoveTo] Invalid target square: (${targetCol}, ${targetRow})`);
      return false;
    }

    // Check if unit has moves remaining
    if ((unit.movesRemaining || 0) <= 0) {
      console.log(`[canUnitMoveTo] Unit ${unitId} has no moves remaining.`);
      return false;
    }

    // Check if target tile is passable
    const targetTile = this.getTileAt(targetCol, targetRow);
    if (!targetTile) {
      console.log(`[canUnitMoveTo] Target tile does not exist at (${targetCol}, ${targetRow}).`);
      return false;
    }
    if (TERRAIN_PROPS[targetTile.type]?.passable === false) {
      console.log(`[canUnitMoveTo] Target tile at (${targetCol}, ${targetRow}) is not passable.`);
      return false;
    }

    // Check if there's another unit at target (combat or stacking rules)
    const targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
      console.log(`[canUnitMoveTo] Target occupied by enemy unit. Allowing attack.`);
      return true;
    }
    if (targetUnit && targetUnit.civilizationId === unit.civilizationId) {
      console.log(`[canUnitMoveTo] Target occupied by allied unit. Movement not allowed.`);
      return false;
    }

    // Calculate move cost
    const distance = this.squareGrid.chebyshevDistance(unit.col, unit.row, targetCol, targetRow);
    const moveCost = Math.max(1, TERRAIN_PROPS[targetTile.type]?.movement || 1);

    // Check if unit has enough moves (only check moveCost since pathfinding gives adjacent tiles)
    const hasEnoughMoves = (unit.movesRemaining || 0) >= moveCost;
    if (!hasEnoughMoves) {
      console.log(`[canUnitMoveTo] Insufficient moves for unit ${unitId}. Distance: ${distance}, MoveCost: ${moveCost}, MovesRemaining: ${unit.movesRemaining}`);
    }
    return hasEnoughMoves;
  }

  /**
   * Move unit to new position
   */
  moveUnit(unitId: string, targetCol: number, targetRow: number) {
    // First check if the move is possible
    if (!this.canUnitMoveTo(unitId, targetCol, targetRow)) {
      return { success: false, reason: 'cannot_move' };
    }

    const unit = this.units.find(u => u.id === unitId);
    if (!unit) return { success: false, reason: 'unit_not_found' };
    if (!this.squareGrid.isValidSquare(targetCol, targetRow)) return { success: false, reason: 'invalid_target' };

    // Check if unit has moves remaining
    if ((unit.movesRemaining || 0) <= 0) return { success: false, reason: 'no_moves_left' };

    // Check if target tile is passable
    const targetTile = this.getTileAt(targetCol, targetRow);
    if (!targetTile) return { success: false, reason: 'invalid_target' };
    if (TERRAIN_PROPS[targetTile.type]?.passable === false) return { success: false, reason: 'terrain_impassable' };

    // Check if there's another unit at target (combat or stacking rules)
    const targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
      // Combat logic here
      const combatResult = this.combatUnit(unit, targetUnit);
      // combatUnit returns boolean success currently; normalize
      const success = !!combatResult;
      return { success, reason: success ? 'combat_victory' : 'combat_defeat' };
    }

    // Move the unit
    const distance = this.squareGrid.chebyshevDistance(unit.col, unit.row, targetCol, targetRow);
    const moveCost = Math.max(1, TERRAIN_PROPS[targetTile.type]?.movement || 1);

    // Require that unit has enough remaining moves to cover the move cost
    // Note: pathfinding always gives adjacent tiles, so distance is 1
    if ((unit.movesRemaining || 0) >= moveCost) {
      const fromCol = unit.col;
      const fromRow = unit.row;

      unit.col = targetCol;
      unit.row = targetRow;
      unit.movesRemaining = (unit.movesRemaining || 0) - moveCost;

      // Update turn done status
      this.updateUnitTurnsDoneFlag(unit);

      // Log movement
      console.log(`[MOVEMENT] ${unit.type} (${unit.id}) moved from (${fromCol},${fromRow}) to (${targetCol},${targetRow}), moveCost: ${moveCost}, moves remaining: ${unit.movesRemaining}`);

      // Reveal area around the unit immediately after moving so automated moves explore
      try {
        // Determine sight range (unit may define it, otherwise check UNIT_PROPS)
        let sightRange = 0;
        if (typeof (unit as any).sightRange === 'number') sightRange = (unit as any).sightRange;
        else if (UNIT_PROPS && UNIT_PROPS[String(unit.type).toLowerCase()] && typeof UNIT_PROPS[String(unit.type).toLowerCase()].sightRange === 'number') {
          sightRange = UNIT_PROPS[String(unit.type).toLowerCase()].sightRange;
        }

        // Ensure at least reveal the tile itself (radius 0 will reveal center only)
        if (sightRange < 0) sightRange = 0;

        if (this.revealArea) {
          this.revealArea(unit.col, unit.row, sightRange);
        }
      } catch (e) {
        // Non-fatal: continue movement even if reveal fails
        console.warn('[GameEngine] revealArea after move failed', e);
      }

      // Trigger state update
      if (this.onStateChange) {
        this.onStateChange('UNIT_MOVED', { unit, targetCol, targetRow });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();

      return { success: true };
    }

    return { success: false, reason: 'insufficient_moves' };
  }

  /**
   * Combat between units
   */
  combatUnit(attacker: Unit, defender: Unit) {
    const attackerStrength = attacker.attack * (attacker.health / 100);
    const defenderStrength = defender.defense * (defender.health / 100);
    
    const attackerWins = Math.random() * (attackerStrength + defenderStrength) < attackerStrength;
    
    if (attackerWins) {
      // Attacker wins - move to defender's position
      const fromCol = attacker.col;
      const fromRow = attacker.row;

      attacker.col = defender.col;
      attacker.row = defender.row;
      attacker.movesRemaining = 0;

      // Update turn done status for attacker
      this.updateUnitTurnsDoneFlag(attacker);

      // Log combat movement
      console.log(`[COMBAT MOVEMENT] ${attacker.type} (${attacker.id}) defeated ${defender.type} (${defender.id}) and moved from (${fromCol},${fromRow}) to (${defender.col},${defender.row})`);

      // Mark defender as defeated and delay removal (5 seconds to show black X)
      (defender as any).isDefeated = true;
      (defender as any).defeatTimestamp = Date.now();
      
      if (this.onStateChange) {
        this.onStateChange('UNIT_DEFEATED', { unit: defender });
      }
      setTimeout(() => {
        this.units = this.units.filter(u => u.id !== defender.id);
      }, 5000);

      if (this.onStateChange) {
        this.onStateChange('COMBAT_VICTORY', { attacker, defender });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();
      
      return true;
    } else {
      // Defender wins - attacker is damaged or destroyed
      attacker.health -= 25;
      attacker.movesRemaining = 0;
      
      // Update turn done status for attacker
      this.updateUnitTurnsDoneFlag(attacker);
      
      if (attacker.health <= 0) {
        // Mark attacker as defeated and delay removal (5 seconds to show black X)
        (attacker as any).isDefeated = true;
        (attacker as any).defeatTimestamp = Date.now();
        
        if (this.onStateChange) {
          this.onStateChange('UNIT_DEFEATED', { unit: attacker });
        }
        setTimeout(() => {
          this.units = this.units.filter(u => u.id !== attacker.id);
        }, 5000);
      }
      
      if (this.onStateChange) {
        this.onStateChange('COMBAT_DEFEAT', { attacker, defender });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();
      
      return false;
    }
  }

  /**
   * Found a city with settler
   */
  foundCityWithSettler(settlerId: string) {
    const settler = this.units.find(u => u.id === settlerId);
    if (!settler || settler.type !== 'settler') return false;

    // Check if location is valid for city
    const tile = this.getTileAt(settler.col, settler.row);
    if (!tile || tile.type === Constants.TERRAIN.OCEAN) return false;

    // Check if too close to another city
    for (const city of this.cities) {
      if (this.squareGrid.squareDistance(settler.col, settler.row, city.col, city.row) < 3) {
        return false;
      }
    }

    // Generate city name
    const civId = settler.civilizationId;
    const civ = this.civilizations[civId];
    const cityNumber = this.cities.filter(c => c.civilizationId === civId).length + 1;
    const cityName = `${civ.name} City ${cityNumber}`;

    // Create new city
    const city = {
      id: `city_${civId}_${this.cities.length}`,
      name: cityName,
      civilizationId: civId,
      col: settler.col,
      row: settler.row,
      population: 1,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      isCapital: this.cities.filter(c => c.civilizationId === civId).length === 0,
      buildings: [],
      yields: { food: 2, production: 1, trade: 0 },
      foodStored: 0,
      foodNeeded: 20,
      productionStored: 0,
      productionProgress: 0, // Initialize production display
      currentProduction: civ.isHuman ? { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 } : { type: 'unit', itemType: 'scout', name: 'Scout', cost: 15 }, // AI builds scout first
      buildQueue: civ.isHuman ? [{ type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }] : [{ type: 'unit', itemType: 'scout', name: 'Scout', cost: 15 }], // AI builds scout first
      autoProduction: civ.isAI || civ.isHuman === false // Enable auto-production for AI cities by default
    };

    this.cities.push(city);
    
    // Consume the settler's movement (founding a city costs one turn)
    settler.movesRemaining = 0;
    
    // Remove settler
    // NOT CHANGE THIS TO === THAN SETTLER NOT DISAPPEARS
    this.units = this.units.filter(u => u.id !== settlerId);

    // Log settler removal (effectively a movement off the map)
    console.log(`[SETTLER REMOVAL] ${settler.type} (${settlerId}) founded city "${cityName}" at (${settler.col},${settler.row}) and was removed from the map`);
    
    if (this.onStateChange) {
      this.onStateChange('CITY_FOUNDED', { city, settler });
    }

    // Check if turn should end automatically after founding city
    this.checkAndEndTurnIfNoMoves();

    return true;
  }

  /**
   * Check if current player has any units with moves remaining, and end turn if not
   * Only considers ACTIVE units (not sleeping or fortified) for auto-end turn
   */
  checkAndEndTurnIfNoMoves() {
    console.log('[TURN] checkAndEndTurnIfNoMoves: Checking active player', this.activePlayer);
    
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) {
      console.warn('[TURN] No civilization found for active player', this.activePlayer);
      return;
    }

    const playerUnits = this.units.filter(u => u.civilizationId === this.activePlayer);
    
    // Only count ACTIVE units (not sleeping, not fortified) that have moves remaining
    const activeUnitsWithMoves = playerUnits.filter(u => 
      (u.movesRemaining || 0) > 0 && 
      !u.isSleeping && 
      !u.isFortified
    );
    
    // Count inactive units (sleeping or fortified)
    const inactiveUnits = playerUnits.filter(u => u.isSleeping || u.isFortified);
    
    console.log(`[TURN] Player ${this.activePlayer} (${currentCiv.isHuman ? 'human' : 'AI'}): ${playerUnits.length} total units, ${activeUnitsWithMoves.length} active with moves, ${inactiveUnits.length} inactive (sleeping/fortified)`);
    
    if (activeUnitsWithMoves.length > 0) {
      console.log('[TURN] Active units with moves:', activeUnitsWithMoves.map(u => ({
        id: u.id,
        type: u.type,
        pos: `(${u.col},${u.row})`,
        moves: u.movesRemaining
      })));
    }

    const hasActiveUnitsWithMoves = activeUnitsWithMoves.length > 0;
    
    // For human players, check if auto turn ending should trigger
    if (currentCiv.isHuman) {
      // Only auto-end if NO active units have moves left
      // Sleeping/fortified units don't prevent auto-end
      if (!hasActiveUnitsWithMoves && playerUnits.length > 0) {
        console.log('[TURN] All active human units have no moves - checking auto end turn setting');
        if (this.onStateChange) {
          this.onStateChange('CHECK_AUTO_END_TURN', { civilizationId: this.activePlayer });
        }
      } else if (hasActiveUnitsWithMoves) {
        console.log('[TURN] ⏸️ Human player still has active units with moves, not ending turn');
      }
    } else {
      // For AI players: TurnManager owns turn flow
      if (!hasActiveUnitsWithMoves) {
        console.log('[TURN] 🤖 AI player has no active units with moves (TurnManager will handle end-of-turn)');
      } else {
        console.log('[TURN] ⏸️ AI player still has active units with moves, continuing');
      }
    }
  }

  /**
   * Process end of turn
   * @deprecated This method now delegates to TurnManager.advanceTurn()
   * TurnManager owns all turn logic in the new architecture
   */
  processTurn() {
    console.log('[GameEngine] processTurn: Delegating to TurnManager.advanceTurn()');

    if (this.isGameOver) {
      console.log('[GameEngine] processTurn: Ignored because the game has concluded');
      return;
    }
    
    // Delegate to TurnManager which now owns all turn logic
    if (this.roundManager && typeof this.roundManager.advanceTurn === 'function') {
      this.roundManager.advanceTurn();
    } else {
      console.error('[GameEngine] processTurn: TurnManager not available or advanceTurn method missing');
    }
  }

  /**
   * Calculate civilization's science output
   */
  calculateCivScience(civId) {
    const cities = this.cities.filter(c => c.civilizationId === civId);
    return cities.reduce((total, city) => total + (city.yields.trade * 0.5), 0);
  }

  /**
   * Calculate civilization's gold output  
   */
  calculateCivGold(civId) {
    const cities = this.cities.filter(c => c.civilizationId === civId);
    return cities.reduce((total, city) => total + (city.yields.trade * 0.5), 0);
  }

  /**
   * Update technology availability based on prerequisites
   */
  updateTechnologyAvailability() {
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) return;

    this.technologies.forEach(tech => {
      if (!tech.researched && !tech.available) {
        const hasPrereqs = tech.prerequisites.every(prereq => 
          currentCiv.technologies.includes(prereq)
        );
        if (hasPrereqs) {
          tech.available = true;
        }
      }
    });
  }

  /**
   * Set current research for civilization
   */
  setResearch(civId, techId) {
    const civ = this.civilizations[civId];
    const tech = this.technologies.find(t => t.id === techId);
    
    if (civ && tech && tech.available && !tech.researched) {
      civ.currentResearch = tech;
      civ.researchProgress = 0;
    }
}

  /**
   * Start a new game
   */
  async newGame() {
    console.log('Starting new game...');
    
    // Reset all state
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    this.currentTurn = 1;
    this.activePlayer = 0;
    this.isGameOver = false;
    this.victoryManager.reset();
    
    // Reset fog of war and player storage
    this.playerStorage.clear();
    if (this.storeActions?.resetFogOfWar) {
      this.storeActions.resetFogOfWar();
    }
    
    // Regenerate world
    await this.generateWorld();
    await this.createCivilizations();
    await this.createTechnologies();
    
    if (this.storeActions) {
      this.storeActions.updateMap(this.map);
      this.storeActions.updateUnits(this.units);
      this.storeActions.updateCities(this.cities);
      this.storeActions.updateCivilizations(this.civilizations);
      this.storeActions.updateTechnologies(this.technologies);
    }

    // Initialize fog of war visibility
    this.updateVisibility();
  }

  async restartCurrentGame(): Promise<void> {
    console.log('[GameEngine] Restarting current game with identical settings');
    const actions = this.storeActions;
    actions?.clearGameResult();
    actions?.updateGameState({
      isLoading: true,
      gamePhase: 'loading',
      winner: null
    });

    this.isGameOver = false;
    this.victoryManager.reset();
    
    // Reset fog of war before reinitializing
    this.playerStorage.clear();
    if (actions?.resetFogOfWar) {
      actions.resetFogOfWar();
    }

    await this.initialize({ ...this.gameSettings });

    actions?.updateGameState({
      isLoading: false,
      gamePhase: 'playing',
      mapGenerated: true,
      winner: null,
      currentTurn: this.currentTurn,
      currentYear: this.currentYear
    });
  }

  shutdownToMenu(): void {
    console.log('[GameEngine] Shutting down current game and returning to menu');
    this.isGameOver = true;
    this.isInitialized = false;
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    this.map = null;
    this.playerStorage.clear();
    this.storeActions?.clearGameResult();
  }

  /**
   * Skip a unit's turn - sets movement to 0
   */
  skipUnit(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Skip: Unit ${unitId} not found`);
      return false;
    }

    const success = UnitActionManager.skipUnit(unit);

    if (success) {
      // Check if this was the last unit with moves, and end turn if so
      this.checkAndEndTurnIfNoMoves();

      if (this.onStateChange) {
        this.onStateChange('UNIT_SKIPPED', { unit });
      }
    }

    return success;
  }

  /**
   * Put a unit to sleep
   */
  unitSleep(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Sleep: Unit ${unitId} not found`);
      return false;
    }

    UnitActionManager.sleepUnit(unit);

    // Update turn done status
    this.updateUnitTurnsDoneFlag(unit);

    if (this.onStateChange) {
      this.onStateChange('UNIT_SLEPT', { unit });
    }

    return true;
  }

  /**
   * Wake up a sleeping unit
   */
  unitWake(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Wake: Unit ${unitId} not found`);
      return false;
    }

    UnitActionManager.wakeUnit(unit);

    if (this.onStateChange) {
      this.onStateChange('UNIT_WOKE', { unit });
    }

    return true;
  }

  /**
   * Fortify a unit
   */
  unitFortify(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Fortify: Unit ${unitId} not found`);
      return false;
    }

    UnitActionManager.fortifyUnit(unit);

    // Update turn done status
    this.updateUnitTurnsDoneFlag(unit);

    if (this.onStateChange) {
      this.onStateChange('UNIT_FORTIFIED', { unit });
    }

    return true;
  }

  /**
   * Build an improvement (road, farm, etc.)
   */
  buildImprovement(unitId: string, improvementType: string): boolean {
    console.log(`[GameEngine] buildImprovement called: unitId=${unitId}, type=${improvementType}`);
    
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Build: Unit ${unitId} not found`);
      return false;
    }

    console.log(`[GameEngine] Build: Unit found:`, {
      id: unit.id,
      type: unit.type,
      col: unit.col,
      row: unit.row,
      movesRemaining: unit.movesRemaining
    });

    // Get improvement properties to determine build time
    const improvementProps = IMPROVEMENT_PROPERTIES[improvementType];
    const buildTurns = improvementProps?.turns || 1; // Default to 1 if not found
    console.log(`[GameEngine] Build: Improvement props:`, improvementProps, 'turns:', buildTurns);

    // Check if unit can perform this action
    const canPerform = UnitActionManager.canPerformAction(unit, 'build_improvement', buildTurns);
    console.log(`[GameEngine] Build: Can perform action:`, canPerform);
    
    if (!canPerform) {
      console.warn(`[GameEngine] Build: Unit cannot perform this action`);
      return false;
    }

    const tile = this.getTileAt(unit.col, unit.row);
    if (!tile) {
      console.warn(`[GameEngine] Build: No tile at (${unit.col},${unit.row})`);
      return false;
    }

    console.log(`[GameEngine] Build: Tile found:`, {
      col: tile.col,
      row: tile.row,
      terrain: tile.terrain,
      improvement: tile.improvement
    });

    // Check if improvement already exists
    if (tile.improvement) {
      console.log(`[GameEngine] Build: Tile already has improvement: ${tile.improvement}`);
      return false;
    }

    // Build the improvement
    tile.improvement = improvementType;
    unit.movesRemaining = (unit.movesRemaining || 0) - buildTurns;

    // Update turn done status
    this.updateUnitTurnsDoneFlag(unit);

    console.log(`[GameEngine] Unit ${unit.id} built ${improvementType} at (${unit.col},${unit.row}) in ${buildTurns} turns. Moves remaining: ${unit.movesRemaining}`);

    if (this.onStateChange) {
      this.onStateChange('IMPROVEMENT_BUILT', { unit, tile, improvementType });
    }

    // Check if turn should end
    this.checkAndEndTurnIfNoMoves();

    return true;
  }

  /**
   * Attach a unit to another unit (deletes the attaching unit)
   */
  attachUnit(unitId: string, targetUnitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Attach: Unit ${unitId} not found`);
      return false;
    }

    const targetUnit = this.units.find(u => u.id === targetUnitId);
    if (!targetUnit) {
      console.warn(`[GameEngine] Attach: Target unit ${targetUnitId} not found`);
      return false;
    }

    if (unit.civilizationId !== targetUnit.civilizationId) {
      console.warn(`[GameEngine] Attach: Cannot attach to enemy unit`);
      return false;
    }

    if (unit.id === targetUnit.id) {
      console.warn(`[GameEngine] Attach: Cannot attach to self`);
      return false;
    }

    // Move the unit to the target's position and delete it
    unit.col = targetUnit.col;
    unit.row = targetUnit.row;
    this.units = this.units.filter(u => u.id !== unitId);

    console.log(`[ATTACH] Unit ${unit.type} (${unitId}) attached to ${targetUnit.type} (${targetUnitId}) at (${targetUnit.col},${targetUnit.row}) and was deleted`);

    if (this.onStateChange) {
      this.onStateChange('UNIT_ATTACHED', { unit, targetUnit });
    }

    // Check if turn should end automatically
    this.checkAndEndTurnIfNoMoves();

    return true;
  }
}
