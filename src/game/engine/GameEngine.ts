import { SquareGrid } from '../HexGrid';
import { Constants, TERRAIN_PROPS, UNIT_PROPS } from '@/utils/Constants';
import { CIVILIZATIONS, TECHNOLOGIES } from '@/data/GameData';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_REQUIREMENTS, IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';
import { TERRAIN_RESOURCES, TERRAIN_TYPES } from '@/data/TerrainConstants';
import {
  BARBARIAN_CIV_ID,
  VILLAGE_OUTCOME,
  VILLAGE_OUTCOMES,
  VILLAGE_FREE_BUILDINGS,
  VILLAGE_GOLD_AMOUNTS,
  VILLAGE_BARBARIAN_TYPES,
  VILLAGE_BARBARIAN_MIN,
  VILLAGE_BARBARIAN_MAX,
} from '@/data/VillageConstants';
import { ProductionManager } from './ProductionManager';
import { AutoProduction } from './AutoProduction';
import { UnitActionManager } from './UnitActionManager';
import { TurnManager } from './TurnManager';
import { VictoryManager } from './VictoryManager';
import { EnemySearcher, EnemyLocation, SearchResult } from './EnemySearcher';
import { ScoutMemory } from './ScoutMemory';
import { GoToManager } from './GoToManager';
import { AIManager } from './AIManager';
import { BarbarianManager } from './BarbarianManager';
import { UnitTurnQueue } from './UnitTurnQueue';
import { DiplomacyManager } from './DiplomacyManager';
import type { DiplomatAction } from './DiplomacyTypes';
import { canBuildUnit, getCivProductionProfile, getCivPersonality } from './AITypes';
import { EconomicManager } from './EconomicManager';
import { GovernmentManager } from './GovernmentManager';
import { ResearchManager } from './ResearchManager';
import { AIResearch } from './AIResearch';
import MapGenerator from './MapGenerator/MapGenerator';
import { MIN_CITY_CENTER_DISTANCE } from './SettlementEvaluator';
import type { GameActions, Unit, City, Civilization, VillageResult, Technology, ProductionItem, TradeRoute, SpecialistType } from '../../../types/game';


/** Civ1 "Bridge Building" tech — mapped to the existing Engineering tech. */
const BRIDGE_BUILDING_TECH = 'engineering';

/** Max permanent trade routes a city can hold (Civ1). */
export const MAX_TRADE_ROUTES = 3;


interface GameSettings {
  difficulty: string;
  mapType: string;
  numberOfCivilizations: number;
  playerCivilization: number;
  startingYear: number;
  startingGold: number;
  /** Civ1 map parameters [0-2]. */
  landMass?: number;
  temperature?: number;
  climate?: number;
  age?: number;
}

export interface MapTile {
  terrain: string;
  resource?: string;
  improvement?: string;
  /** Whether this tile contains a Civ1 village (goody hut). */
  village?: boolean;
  visible: boolean;
  explored: boolean;
  col: number;
  row: number;
  type?: string;
  /** Legacy improvement flags (some saves set these alongside `improvement`). */
  road?: boolean;
  railroad?: boolean;
  hasRoad?: boolean;
  hasRiver?: boolean;
}

interface MapData {
  width: number;
  height: number;
  tiles: MapTile[];
  // Fog-of-war arrays are only populated for some maps (the renderer reads
  // them with optional chaining); optional so generated maps that don't fill
  // them still type-check.
  visibility?: boolean[];
  revealed?: boolean[];
}

export interface PlayerTurnStorage {
  civilizationId: number;
  visibility: boolean[]; // Current visibility (fog of war)
  explored: boolean[]; // Permanently explored tiles
  lastKnownUnits: Map<string, Unit>; // Last known enemy unit positions
  lastKnownCities: Map<string, City>; // Last known enemy city positions
  enemyLocations: Map<number, EnemyLocation[]>; // Enemy locations per civilization [enemyCivId -> locations]
  scoutZones: Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }>; // Scout assignment zones
  turnData: Record<string, unknown>; // Custom per-turn data storage
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
  technologies: Technology[];
  gameSettings: GameSettings;
  isInitialized: boolean;
  currentTurn: number;
  currentYear: number;
  activePlayer: number;
  onStateChange: ((eventType: string, eventData?: Record<string, unknown>) => void) | null;
  productionManager: ProductionManager;
  autoProduction: AutoProduction;
  economicManager: EconomicManager;
  governmentManager: GovernmentManager;
  researchManager: ResearchManager;
  playerStorage: Map<number, PlayerTurnStorage>; // Per-player persistent storage
  devMode: boolean; // Developer mode flag
  roundManager: TurnManager; // kept property name for compatibility
  goToManager: GoToManager;
  victoryManager: VictoryManager;
  isGameOver: boolean;
  isPaused: boolean; // When true, turn processing and AI actions are halted
  scoutMemory: ScoutMemory; // Phase 3.1: Scout persistence across turns
  aiManager: AIManager;
  barbarianManager: BarbarianManager; // Dedicated aggressive AI for the phantom barbarian civ
  unitTurnQueue: UnitTurnQueue; // Unit turn queue for managing unit order
  /** Monotonic per-(civ,type) unit-id suffix counters. Kept so a unit id is
   *  NEVER reused after its unit dies — the old `${type}_${civ}_${count}` scheme
   *  reused ids once a unit was removed (count = live-array length shrank), so a
   *  removal-by-id could delete a brand-new unit that inherited the corpse's id
   *  (units silently going missing). */
  private unitIdCounters: Map<string, number> = new Map();
  diplomacyManager: DiplomacyManager; // Civ I–style diplomacy system

  // Human-readable recap of the most recent auto-end (what was skipped), used
  // for the post-end summary notification.
  lastAutoEndSummary: string | null = null;

  /** Monotonic sequence counter for checkAndEndTurnIfNoMoves calls, so the
   *  auto-end trace can be correlated across GameEngine → router → App. */
  private autoEndCheckCounter = 0;

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
    this.economicManager = new EconomicManager(this);
    this.governmentManager = new GovernmentManager(this);
    this.researchManager = new ResearchManager(this);
    this.roundManager = new TurnManager(this);
    this.goToManager = new GoToManager(this, this.roundManager);
    this.playerStorage = new Map();
    this.scoutMemory = new ScoutMemory(); // Phase 3.1: Initialize scout memory
    this.aiManager = new AIManager(this);
    this.barbarianManager = new BarbarianManager(this);
    this.unitTurnQueue = new UnitTurnQueue(this); // Initialize unit turn queue
    this.diplomacyManager = new DiplomacyManager(this);
    this.devMode = false;
    this.victoryManager = new VictoryManager(this);
    this.isGameOver = false;
    this.isPaused = false;
    this.victoryManager.syncStoreActions(this.storeActions);
  }

  /**
   * Spawn a barbarian unit (civ id BARBARIAN_CIV_ID) at a tile. Public so the
   * BarbarianManager can seed captured cities with new raiders.
   */
  public spawnBarbarianUnit(type: string, col: number, row: number): void {
    this.createUnit(BARBARIAN_CIV_ID, type, col, row);
  }

  /**
   * Ensure the barbarian faction exists in civilizations[] (id BARBARIAN_CIV_ID).
   * Called the moment barbarians hold a city so they count as a real faction:
   * they appear in the civ list and — crucially — the game is NOT won until
   * every barbarian unit and city is destroyed. Idempotent.
   */
  public ensureBarbarianCivilization(): Civilization {
    const existing = this.civilizations.find((c) => c.id === BARBARIAN_CIV_ID);
    if (existing) return existing;

    const barbarianCiv: Civilization = {
      id: BARBARIAN_CIV_ID,
      name: 'Barbarians',
      leader: 'Barbarian Chief',
      color: '#8a2b2b',
      isAlive: true,
      isHuman: false,
      isAI: true,
      resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
      technologies: [],
      currentResearch: null,
      researchProgress: 0,
      scienceRate: 0,
      taxRate: 100,
      luxuryRate: 0,
      government: 'despotism',
      productionProfile: 'military_expansion',
      personality: { aggression: 1, expansion: 0.5, science: 0, diplomacy: 0 },
      score: 0,
      cityNames: ['Barbarian Camp', 'Barbarian Horde', 'Barbarian Outpost'],
      nextCityNameIndex: 0,
    };
    this.civilizations.push(barbarianCiv);
    this.initializePlayerStorage(BARBARIAN_CIV_ID);
    this.storeActions?.updateCivilizations?.([...this.civilizations]);
    console.log('[BARB] Barbarians are now a faction in the game (they hold a city).');
    return barbarianCiv;
  }

  /**
   * Pause the game: halts turn processing, auto-end and AI actions until
   * resume() is called. The UI shows the pause screen while paused.
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused;
    console.log(`[GameEngine] ${paused ? '⏸️ Paused' : '▶ Resumed'}`);
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
      // Get unit sight range (minimum radius 2 so the map isn't a tiny peephole)
      let sightRange = 2; // Default
      if (UNIT_PROPS && UNIT_PROPS[unit.type]) {
        sightRange = Math.max(2, UNIT_PROPS[unit.type].sightRange || 2);
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
  setCityProduction(cityId: string, item: ProductionItem, queue: boolean = false) {
    return this.productionManager.setCityProduction(cityId, item, queue);
  }

  purchaseCityProduction(cityId: string, item: ProductionItem, civId?: number) {
    return this.productionManager.purchaseCityProduction(cityId, item, civId);
  }

  /**
   * Remove an item from a city's build queue by index.
   */
  removeCityQueueItem(cityId: string, index: number) {
    return this.productionManager.removeCityQueueItem(cityId, index);
  }

  /**
   * Move an item in a city's build queue from one index to another.
   */
  moveCityQueueItem(cityId: string, fromIndex: number, toIndex: number) {
    return this.productionManager.moveCityQueueItem(cityId, fromIndex, toIndex);
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
      city.autoProduction = enabled;
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
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Delay between AI unit moves (visual pacing only).
   * In AI-vs-AI auto mode there is no human watching, so moves run fast;
   * in normal games a short pause keeps the action readable without making
   * turns crawl when the AI fields many units.
   */
  getAIMoveDelay(): number {
    if (this.gameSettings?.mapType === 'AI_VS_AI' || this.gameSettings?.mapType === 'AI_VS_AI_SMALL') {
      return 5;
    }
    return 60;
  }

  /**
   * Delay before an AI turn starts (visual pacing only).
   */
  getAITurnStartDelay(): number {
    if (this.gameSettings?.mapType === 'AI_VS_AI' || this.gameSettings?.mapType === 'AI_VS_AI_SMALL') {
      return 10;
    }
    return 120;
  }

  /**
   * Execute a function while measuring its duration (used by AI subsystems).
   * Returns the function result (or null on error) and logs the elapsed ms.
   */
  measurePerformance<T>(label: string, fn: () => T): T | null {
    const start = performance.now();
    try {
      const result = fn();
      const elapsed = Math.round(performance.now() - start);
      console.log(`[PERF] ${label}: ${elapsed}ms`);
      return result;
    } catch (err) {
      console.warn(`[PERF] ${label} failed:`, err);
      return null;
    }
  }

  /**
   * Emit a structured log line (category + message + optional detail).
   * The GameLogger (via onStateChange 'GAME_LOG') persists it to disk.
   */
  log(category: string, message: string, detail: Record<string, unknown> = {}): void {
    console.log(`[${category}] ${message}`);
    if (this.onStateChange) {
      this.onStateChange('GAME_LOG', { category, message, ...detail });
    }
  }

  /**
   * Check and update the areTurnsDone flag for a unit
   * Sets to true if unit has no moves left OR is fortified OR is sleeping
   */
  private updateUnitTurnsDoneFlag(unit: Unit): void {
    const noMovesLeft = (unit.movesRemaining || 0) <= 0;
    const isFortified = unit.isFortified === true;
    const isSleeping = unit.isSleeping === true;
    
    unit.areTurnsDone = noMovesLeft || isFortified || isSleeping;
    
    if (unit.areTurnsDone) {
      console.log(`[GameEngine] Unit ${unit.id} turns done: movesRemaining=${unit.movesRemaining}, isFortified=${isFortified}, isSleeping=${isSleeping}`);
    }
  }

  // Legacy highlightAITarget and chooseAITarget removed — now in AIManager


  /**
   * Record enemy location in player's intelligence storage
   * Allows AI to make coordinated decisions based on known enemy positions
   *
   * @param civilizationId Civilization recording the location
   * @param enemy Search result from EnemySearcher
   */
  public recordEnemyLocation(civilizationId: number, enemy: SearchResult): void {
    const storage = this.getPlayerStorage(civilizationId);
    if (!storage || !enemy) return;

    const enemyCivId = this.getEnemyCivIdAt(enemy.col, enemy.row, civilizationId);
    // null = nothing hostile at that square (skip). The barbarian faction has
    // civilization id -1, which IS a valid enemy — so this guard must NOT
    // reject negative ids, or barbarian cities would never be recorded and the
    // AI could never plan an assault against them.
    if (enemyCivId === null) return;

    const round = this.roundManager?.getRoundNumber?.() ?? 0;
    const location: EnemyLocation = {
      col: enemy.col,
      row: enemy.row,
      type: enemy.targetType,
      id: enemy.targetId,
      discoveredRound: round,
      lastSeenRound: round,
    };

    const list = storage.enemyLocations.get(enemyCivId) ?? [];
    const existing = list.find(e => e.id === enemy.targetId);
    if (existing) {
      existing.col = enemy.col;
      existing.row = enemy.row;
      existing.lastSeenRound = round;
    } else {
      list.push(location);
      // Prune old enemy locations (keep last 30 per enemy civ)
      if (list.length > 30) {
        list.sort((a, b) => b.lastSeenRound - a.lastSeenRound);
        list.length = 30;
      }
      storage.enemyLocations.set(enemyCivId, list);
    }

    // Feed the scout memory so scouts re-visit areas that were not seen for
    // a long time ("long time no visits"). Without this the stale re-scout
    // logic always had an empty discovery store and never fired.
    this.scoutMemory?.recordDiscovery(enemyCivId, location);
  }

  /**
   * Resolve the civilization id of whatever hostile occupies a square, or null
   * if there is nothing belonging to another civ. Note the barbarian faction
   * uses id -1 — that is a legitimate enemy id and must be returned as-is
   * (only null signals "no enemy here").
   */
  private getEnemyCivIdAt(col: number, row: number, ownCivId: number): number | null {
    const unit = this.getUnitAt(col, row);
    if (unit && unit.civilizationId !== ownCivId) return unit.civilizationId;
    const city = this.getCityAt(col, row);
    if (city && city.civilizationId !== ownCivId) return city.civilizationId;
    return null;
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
    
    // Phase 4: Measure zone calculation performance
    const startTime = performance.now();
    storage.scoutZones = EnemySearcher.calculateScoutZones(scouts.length, this.map!.width, this.map!.height);
    const endTime = performance.now();
    
    if (this.devMode && (endTime - startTime) > 2) {
      console.log(`[PERF] Zone calculation took ${(endTime - startTime).toFixed(2)}ms`);
    }

    // Phase 1.2: Enhanced logging for scout coordination
    console.log(`[AI-COORDINATION] Assigned ${scouts.length} scouts with zones:`);
    storage.scoutZones.forEach((zone, idx) => {
      console.log(`  Scout ${idx + 1}: cols ${zone.minCol}-${zone.maxCol}, rows ${zone.minRow}-${zone.maxRow}`);
    });
  }

  /**
   * Phase 3.2: Dynamic Scout Reassignment - Called when a scout dies
   * Recalculates scout zones for remaining scouts
   */
  public onScoutDeath(scoutUnit: Unit): void {
    console.log(`[AI-COORDINATION] Scout ${scoutUnit.id} died, reassigning zones for civilization ${scoutUnit.civilizationId}`);
    
    // Recalculate zones for remaining scouts
    this.assignScoutZones(scoutUnit.civilizationId);
    
    // Log remaining scouts
    const remainingScouts = this.units.filter(u => 
      u.civilizationId === scoutUnit.civilizationId && 
      u.type === 'scout' && 
      u.id !== scoutUnit.id
    );
    console.log(`[AI-COORDINATION] ${remainingScouts.length} scouts remaining after reassignment`);
  }

  /**
   * Phase 3.2: Dynamic Scout Reassignment - Called when a scout is created
   * Re-initializes zones to include the new scout
   */
  public onScoutCreated(scoutUnit: Unit): void {
    console.log(`[AI-COORDINATION] Scout ${scoutUnit.id} created, reassigning zones for civilization ${scoutUnit.civilizationId}`);
    
    // Re-initialize zones to include new scout
    this.assignScoutZones(scoutUnit.civilizationId);
    
    // Log total scouts
    const totalScouts = this.units.filter(u => 
      u.civilizationId === scoutUnit.civilizationId && 
      u.type === 'scout'
    );
    console.log(`[AI-COORDINATION] ${totalScouts.length} scouts active after reassignment`);
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

  /**
   * Process AI turn for a civilization (public method for RoundManager)
   */
  processAITurn(civilizationId: number) {
    return this.aiManager.processAITurn(civilizationId);
  }

  // Legacy runAITurn removed — AI turn logic now lives in AIManager.processAITurn()


  /**
   * Initialize the game engine with settings
   */
  async initialize(settings: Partial<GameSettings> & { devMode?: boolean } = {}) {
    console.log('Initializing game engine...');
    
    // Merge custom settings
    this.gameSettings = { ...this.gameSettings, ...settings };

    // Fresh game setup resets victory checks and player visibility storage
    this.isGameOver = false;
    this.victoryManager.reset();
    this.victoryManager.syncStoreActions(this.storeActions);
    this.playerStorage.clear();
    
    // Phase 3.1: Reset scout memory for new game
    this.scoutMemory.clear();
    this.scoutMemory.setCurrentRound(0);
    
    // Reset diplomacy
    this.diplomacyManager.reset();
    
    // Set dev mode from settings
    this.devMode = settings.devMode || false;
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
    } else if (mapType === 'AI_VS_AI') {
      mapWidth = 40;
      mapHeight = 40;
      console.log(`[GameEngine] Using medium map size for ${mapType}: ${mapWidth}x${mapHeight}`);
    } else if (mapType === 'AI_VS_AI_SMALL') {
      mapWidth = 16;
      mapHeight = 26;
      console.log(`[GameEngine] Using small tall map for ${mapType}: ${mapWidth}x${mapHeight}`);
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

    // Initialize diplomacy between all civilizations
    this.diplomacyManager.initialize(this.civilizations.map((c: Civilization) => c.id));
    console.log('[GameEngine] Diplomacy initialized for', this.civilizations.length, 'civilizations');

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
   * Generate the game world with terrain.
   *
   * Delegates the heavy lifting to `MapGenerator` which implements the
   * Civ1-style multi-stage pipeline (continents → temperature → climate →
   * age → rivers → polar caps → resources → flood-fill → build sites).
   * The generator is seeded from `Date.now()` so every game gets a unique
   * but reproducible world.
   */
  async generateWorld(mapWidth: number = Constants.MAP_WIDTH, mapHeight: number = Constants.MAP_HEIGHT, mapType: string = 'NORMAL_SKIRMISH') {
    console.log(`[GameEngine] Generating world: ${mapWidth}x${mapHeight}, type: ${mapType}`);

    const generator = new MapGenerator({
      mapWidth,
      mapHeight,
      seed: Date.now(),
      landMass: this.gameSettings.landMass,
      temperature: this.gameSettings.temperature,
      climate: this.gameSettings.climate,
      age: this.gameSettings.age,
    });

    let tiles: ReturnType<MapGenerator['generate']>;

    if (mapType === 'NAVAL_CLOSEUP') {
      // Water-only map — no land, no rivers.
      tiles = generator.generateWaterOnly();
    } else {
      // Full Civ1-style terrain generation.
      tiles = generator.generate();
    }

    this.map = {
      width: mapWidth,
      height: mapHeight,
      tiles,
    };

    console.log(`[GameEngine] World generated: ${tiles.length} tiles (seed ${generator['seed']})`);
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
      
      // In AI_VS_AI mode every civilization is AI-controlled (no human player).
      const isHuman = i === 0 && mapType !== 'AI_VS_AI' && mapType !== 'AI_VS_AI_SMALL';
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
        taxRate: 50,
        luxuryRate: 0,
        government: 'despotism',
        productionProfile: getCivProductionProfile(i),
        personality: getCivPersonality(getCivProductionProfile(i)),
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

    // Scatter villages (goody huts) away from starting settler placements.
    this.placeVillages();
  }

  /**
   * Create starting units for a civilization based on map type
   */
  private createStartingUnits(civId: number, startPos: { col: number; row: number }, mapType: string) {
    console.log(`[UNITS] createStartingUnits called for civId ${civId}, mapType: ${mapType}, position: (${startPos.col},${startPos.row})`);
    switch (mapType) {
      case 'ALL_UNITS':
        // Create every single unit type on the board
        console.log(`[UNITS] Creating ALL unit types for civ ${civId}`);
        const allUnitTypes = Object.keys(UNIT_PROPS);
        let offsetCol = 0;
        let offsetRow = 0;
        const maxUnitsPerRow = 10; // Arrange units in a grid
        
        allUnitTypes.forEach((unitType, index) => {
          offsetCol = (index % maxUnitsPerRow) - Math.floor(maxUnitsPerRow / 2);
          offsetRow = Math.floor(index / maxUnitsPerRow);
          
          const col = startPos.col + offsetCol * 2; // Space units 2 tiles apart
          const row = startPos.row + offsetRow * 2;
          
          // Ensure the position is valid
          if (col >= 0 && col < Constants.MAP_WIDTH && row >= 0 && row < Constants.MAP_HEIGHT) {
            this.createUnit(civId, unitType, col, row);
          }
        });
        break;
        
      case 'NORMAL_SKIRMISH':
      case 'CLOSEUP_1V1':
      case 'AI_VS_AI':
      case 'AI_VS_AI_SMALL':
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
   * Generates a unique unit id for a civ/type in the `type_civId_index` format
   * used across the codebase. The index is monotonic per (civ, type) and always
   * greater than the highest index of any LIVE unit of that (civ, type) — so an
   * id is never reused after a unit dies (which would otherwise make
   * removal-by-id delete the corpse AND a newly spawned unit sharing the id).
   */
  private nextUnitId(civId: number, type: string): string {
    const key = `${civId}:${type}`;
    const prefix = `${type}_${civId}_`;
    let maxSuffix = -1;
    for (const u of this.units) {
      if (u.civilizationId !== civId || u.type !== type || typeof u.id !== 'string') continue;
      if (!u.id.startsWith(prefix)) continue;
      const n = parseInt(u.id.slice(prefix.length), 10);
      if (Number.isInteger(n) && n > maxSuffix) maxSuffix = n;
    }
    const next = Math.max(this.unitIdCounters.get(key) ?? -1, maxSuffix) + 1;
    this.unitIdCounters.set(key, next);
    return `${prefix}${next}`;
  }

  /**
   * Create a single unit
   */
  private createUnit(civId: number, type: string, col: number, row: number) {
    const unitProps: { movement: number; attack: number; defense: number; icon?: string; hitPoints?: number; name?: string; type?: string; maintenance?: number } = UNIT_PROPS[type] || { movement: 1, attack: 1, defense: 1, icon: '⚔️' };
    const unitId = this.nextUnitId(civId, type);
    
    const unit = {
      id: unitId,
      civilizationId: civId,
      type: type,
      name: unitProps.name || type,
      col: col,
      row: row,
      health: 100,
      hitPoints: unitProps.hitPoints ?? 2,
      maxHitPoints: unitProps.hitPoints ?? 2,
      movesRemaining: unitProps.movement || 1,
      maxMoves: unitProps.movement || 1,
      // Civ1: a newly created unit has not acted this turn, so the
      // Minimum-1-Move exception applies to its first move.
      hasMovedThisTurn: false,
      isVeteran: false,
      attack: unitProps.attack || 0,
      defense: unitProps.defense || 1,
      maintenance: 0,
      icon: unitProps.icon || '⚔️',
      orders: null,
      homeCityId: null,
      isNoneUnit: true,
      foodSupport: 0,
      shieldSupport: 0,
    };
    
    this.units.push(unit);
    console.log(`[UNIT] Created ${type} for civ ${civId} at (${col},${row})`);
    
    // Phase 3.2: If a scout was created, reassign zones
    if (type === 'scout') {
      this.onScoutCreated(unit);
    }
  }

  /**
   * Create starting cities for MANY_CITIES mode
   */
  private createStartingCities(civId: number, civ: Civilization, startPos: { col: number; row: number }) {
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
        // City name: sequential from the civ's list (civ may not be in
        // this.civilizations yet at init, so pass it explicitly).
        const cityName = this.getNextCityName(civId, civ);
        
        const cityId = `city_${civId}_${this.cities.length}`;
        const city = {
          id: cityId,
          name: cityName,
          civilizationId: civId,
          col: pos.col,
          row: pos.row,
          population: 1,
          food: 0,
          foodStored: 0,
          foodNeeded: 20,
          production: 0,
          productionStored: 0,
          productionProgress: 0,
          gold: 0,
          science: 0,
          culture: 0,
          happiness: 0,
          yields: { food: 2, production: 2, trade: 0 },
          currentProduction: civ.isAI ? this.pickInitialAIProduction(civ.id) : null,
          buildQueue: civ.isAI ? [] : [],
          buildings: [],
          tiles: [],
          autoProduction: true // New cities default to Auto Production ON
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
    
    // Only update the store (UI visibility) for the human player.
    // AI exploration is kept in per-player storage and must not leak to the minimap.
    if (this.storeActions && this.activePlayer === 0) {
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

    // Build the full researchable technology tree (deep-cloned from the data
    // table). This is REQUIRED for setResearch(): previously the tree stayed
    // empty for non-TECH_LEVEL_10 maps, so setResearch() could never find a
    // tech, civ.currentResearch stayed null, and the AI re-selected the same
    // tech every turn without ever completing it.
    this.technologies = TECHNOLOGIES_DATA.map((t) => ({
      ...t,
      researched: false,
      researching: false,
      // Root techs (no prerequisites) are immediately researchable.
      available: t.available === true || (t.prerequisites?.length ?? 0) === 0,
    }));

    // Mark each civ's starting technologies as researched on the shared tree.
    for (const civ of this.civilizations) {
      for (const techId of civ.technologies ?? []) {
        const tech = this.technologies.find((t) => t.id === String(techId));
        if (tech) tech.researched = true;
      }
    }

    // Unlock any techs whose prerequisites are already met (across all civs).
    this.updateTechnologyAvailability();

    console.log(`Technology tree initialized (${this.technologies.length} techs)`);
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
   * Get the next city name for a civilization.
   *
   * Civ1 behaviour: cities are named ONE AFTER ANOTHER from the civilization's
   * `cityNames` list (e.g. Berlin → Hamburg → Munich…), advancing the index as
   * each name is consumed. Names already in use (renamed cities, or an index
   * that drifted out of sync with the real city list) are skipped so no two
   * cities share a name; once the list is exhausted it falls back to
   * "<Civ> City N" with an unused number.
   */
  getNextCityName(civilizationId, civOverride = null) {
    const civ = civOverride || this.civilizations[civilizationId];
    if (!civ) return 'City';

    const cityNames = Array.isArray(civ.cityNames) ? civ.cityNames : [];
    const usedNames = new Set(
      this.cities
        .filter((c: City) => c.civilizationId === civilizationId)
        .map((c: City) => String(c.name)),
    );

    while (civ.nextCityNameIndex < cityNames.length) {
      const candidate = cityNames[civ.nextCityNameIndex];
      civ.nextCityNameIndex++;
      if (!usedNames.has(String(candidate))) {
        return candidate;
      }
    }

    let fallback = `${civ.name} City ${civ.nextCityNameIndex + 1}`;
    let n = civ.nextCityNameIndex + 1;
    while (usedNames.has(fallback)) {
      n++;
      fallback = `${civ.name} City ${n}`;
    }
    return fallback;
  }

  /**
   * Decide an AI city's first production item. A new capital first builds the
   * cheapest valid land defender, then expands. Subsequent cities build a
   * scout (once) for exploration or a defender.
   */
  private pickInitialAIProduction(civId: number): ProductionItem {
    const scoutCount = this.units.filter(
      (u) => u.civilizationId === civId && u.type === 'scout'
    ).length;
    const cityCount = this.cities.filter((c) => c.civilizationId === civId).length;

    // First two cities always builds a scout first if none exists yet — the scout
    // feeds the intelligence pipeline that drives war-planning, so it is
    // more valuable than an extra warrior in the early game.
    if (scoutCount === 0) {
      return { type: 'unit', itemType: 'scout', name: 'Scout', cost: 15 };
    }

    if (cityCount <= 2) {
      // Already has a scout — build the cheapest valid defender next.
      const civ = this.civilizations[civId];
      const defender = Object.entries(UNIT_PROPS)
        .filter(([unitType, props]) =>
          unitType !== 'scout' &&
          props.type === 'military' &&
          !props.naval &&
          (props.defense || 0) > 0 &&
          (!civ || canBuildUnit(civ, unitType))
        )
        .sort(([, a], [, b]) =>
          a.cost - b.cost || (b.defense || 0) - (a.defense || 0)
        )[0];
      const defenderType = defender?.[0] ?? 'warrior';
      const defenderProps = UNIT_PROPS[defenderType] ?? UNIT_PROPS.warrior;
      return {
        type: 'unit',
        itemType: defenderType,
        name: defenderProps.name,
        cost: defenderProps.cost,
      };
    }
    return { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 };
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
      currentProduction: { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }, // Start building a warrior
      productionQueue: [],
      autoProduction: true, // New cities default to Auto Production ON
      buildings: [],
      wonders: [],
      workingTiles: new Set<string>(), // Tiles being worked by citizens
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

    // First city (or a civ that lost its capital) becomes the seat of
    // government with a free Palace. The Palace building marks the capital.
    const civCapital = this.civilizations[civilizationId]?.capital;
    const capitalStillExists = civCapital && this.cities.some(c => c.id === civCapital.id);
    if (city.isCapital || !capitalStillExists) {
      this.governmentManager?.designateCapital(civilizationId, city);
    }

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

  private getTerrainKey(tile: { type?: string; terrain?: string } | null | undefined): string {
    return String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase();
  }

  private isWaterTerrain(tile: { type?: string; terrain?: string } | null | undefined): boolean {
    const terrainKey = this.getTerrainKey(tile);
    return terrainKey === 'ocean' || terrainKey === 'sea';
  }

  /**
   * Whether a tile is passable for land units (used by AI pathfinding).
   * Ocean and other impassable terrain return false.
   */
  isTilePassable(col: number, row: number): boolean {
    if (!this.squareGrid || !this.squareGrid.isValidSquare(col, row)) return false;
    const tile = this.getTileAt(col, row);
    if (!tile) return false;
    const terrainKey = this.getTerrainKey(tile);
    if (this.isWaterTerrain(tile)) return false;
    return TERRAIN_PROPS[terrainKey]?.passable !== false;
  }

  /** Passability callback for terrain-aware pathfinding (land units). */
  getPassabilityFilter(): (col: number, row: number) => boolean {
    return (col: number, row: number) => this.isTilePassable(col, row);
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
   * Whether a tile lies in a city's 20-tile Civ1 workable radius (the 5x5
   * diamond minus the center tile and the four extreme corners).
   */
  isTileInCityRadius(city: City, col: number, row: number): boolean {
    const dc = Math.abs(col - city.col);
    const dr = Math.abs(row - city.row);
    if (dc === 0 && dr === 0) return false;   // center tile
    if (dc > 2 || dr > 2) return false;       // outside the 5x5 diamond
    if (dc === 2 && dr === 2) return false;   // extreme corners are not workable
    return true;
  }

  /**
   * Manually move a citizen from one worked tile to an available tile inside
   * the city's radius ("pick up & drop"). The target tile is marked
   * user-assigned so the auto-assign algorithm never overrides it on the next
   * population growth. Yields are refreshed immediately for the current turn.
   * Returns true on success.
   */
  reassignCitizen(
    cityId: string,
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
  ): boolean {
    const city = this.cities.find((c: City) => c.id === cityId);
    if (!city) return false;

    const centerKey = `${city.col},${city.row}`;
    const fromKey = `${fromCol},${fromRow}`;
    const toKey = `${toCol},${toRow}`;
    if (fromKey === centerKey || toKey === centerKey) return false;
    if (!this.isTileInCityRadius(city, toCol, toRow)) return false;
    if (!this.squareGrid?.isValidSquare?.(toCol, toRow)) return false;

    const workingTiles = city.workingTiles ?? (city.workingTiles = new Set<string>());
    if (!workingTiles.has(fromKey)) return false; // must pick up a worked tile
    if (workingTiles.has(toKey)) return false;    // target must be unworked

    const tile = this.getTileAt(toCol, toRow);
    if (!tile) return false;

    // Move the citizen: free the origin, work the target.
    workingTiles.delete(fromKey);
    workingTiles.add(toKey);

    // Protect the target from auto-assign; drop the origin's protection if it
    // had been manually assigned.
    const userAssigned = city.userAssignedTiles ?? (city.userAssignedTiles = new Set<string>());
    userAssigned.delete(fromKey);
    userAssigned.add(toKey);

    // Refresh yields from the chosen layout for the rest of this turn.
    this.economicManager?.refreshYieldsFromWorkingTiles?.(city);

    // Persist the updated city to the store so the UI + map re-render.
    if (this.storeActions?.updateCities) {
      this.storeActions.updateCities([...this.cities]);
    }
    return true;
  }

  // ── Specialists ──────────────────────────────────────────────────────

  /**
   * Convert a tile citizen into a specialist. The citizen is removed from
   * the worst-yield worked tile (preserving manually-assigned tiles) and
   * added to the city's specialists list.
   *
   * @returns true on success.
   */
  promoteCitizenToSpecialist(cityId: string, specialistType: SpecialistType): boolean {
    const city = this.cities.find((c: City) => c.id === cityId);
    if (!city) return false;

    const workingTiles = city.workingTiles;
    if (!workingTiles || workingTiles.size === 0) return false;

    // Don't convert more citizens than the city has.
    const specCount = (city.specialists ?? []).length;
    if (specCount >= (city.population ?? 1)) return false;

    // Find the worst-yield worked tile to free (skip the city center and
    // player-assigned tiles to preserve intentional placements).
    const centerKey = `${city.col},${city.row}`;
    const userAssigned = city.userAssignedTiles ?? new Set<string>();
    let worstKey: string | null = null;
    let worstYield = Infinity;
    for (const key of workingTiles) {
      if (key === centerKey) continue;
      if (userAssigned.has(key)) continue;
      const sep = key.indexOf(',');
      const col = Number(key.slice(0, sep));
      const row = Number(key.slice(sep + 1));
      const tile = this.getTileAt(col, row);
      if (!tile) continue;
      const y = this.economicManager?.tileYields(tile);
      if (!y) continue;
      const total = y.food + y.production + y.trade;
      if (total < worstYield) {
        worstYield = total;
        worstKey = key;
      }
    }

    // If all remaining worked tiles are player-assigned, free the lowest-yield
    // one — the player explicitly chose to convert a citizen.
    if (!worstKey) {
      for (const key of workingTiles) {
        if (key === centerKey) continue;
        const sep = key.indexOf(',');
        const col = Number(key.slice(0, sep));
        const row = Number(key.slice(sep + 1));
        const tile = this.getTileAt(col, row);
        if (!tile) continue;
        const y = this.economicManager?.tileYields(tile);
        if (!y) continue;
        const total = y.food + y.production + y.trade;
        if (total < worstYield) {
          worstYield = total;
          worstKey = key;
        }
      }
    }

    if (!worstKey) return false;

    workingTiles.delete(worstKey);
    userAssigned.delete(worstKey);

    if (!city.specialists) city.specialists = [];
    city.specialists.push(specialistType);

    this.economicManager?.refreshYieldsFromWorkingTiles?.(city);
    if (this.storeActions?.updateCities) {
      this.storeActions.updateCities([...this.cities]);
    }
    return true;
  }

  /**
   * Demote a specialist back to a tile worker. The specialist is removed
   * from the list and the freed citizen is immediately reassigned to the
   * best available tile in the city's radius.
   *
   * @returns true on success.
   */
  demoteSpecialistToWorker(cityId: string, specialistIndex: number): boolean {
    const city = this.cities.find((c: City) => c.id === cityId);
    if (!city) return false;
    const specs = city.specialists;
    if (!specs || specialistIndex < 0 || specialistIndex >= specs.length) return false;

    specs.splice(specialistIndex, 1);

    // Immediately recompute yields — this calls cityWorkedTiles which
    // reassigns the freed citizen to the best available tile in the radius.
    this.economicManager?.recomputeCityYields?.(city);
    if (this.storeActions?.updateCities) {
      this.storeActions.updateCities([...this.cities]);
    }else {
      console.warn('Store actions not available to update cities after demoting specialist');
    }
    return true;
  }

  /**
   * Convenience: remove a citizen from a worked tile and make them a
   * specialist of the given type. Called from the city UI "Make Specialist"
   * button.
   *
   * @returns true on success.
   */
  removeCitizenFromTile(cityId: string, col: number, row: number, specialistType: SpecialistType = 'entertainer'): boolean {
    const city = this.cities.find((c: City) => c.id === cityId);
    if (!city) return false;
    const centerKey = `${city.col},${city.row}`;
    const key = `${col},${row}`;
    if (key === centerKey) return false;

    const workingTiles = city.workingTiles;
    if (!workingTiles || !workingTiles.has(key)) return false;

    workingTiles.delete(key);
    (city.userAssignedTiles ?? new Set<string>()).delete(key);

    if (!city.specialists) city.specialists = [];
    city.specialists.push(specialistType);

    this.economicManager?.refreshYieldsFromWorkingTiles?.(city);
    if (this.storeActions?.updateCities) {
      this.storeActions.updateCities([...this.cities]);
    }
    return true;
  }

  /**
   * Whether a Caravan is on a valid city tile and can establish a trade route.
   * Requires: a caravan unit, standing on a city, with a home city that differs
   * from the destination.
   */
  canEstablishTradeRoute(unitId: string): boolean {
    const unit = this.units.find((u: Unit) => u.id === unitId);
    if (!unit || unit.type !== 'caravan') return false;
    const dest = this.getCityAt(unit.col, unit.row);
    if (!dest) return false;
    const home = this.getCaravanHomeCity(unit);
    if (!home) return false;
    return home.id !== dest.id;
  }

  /**
   * Resolve the home city of a Caravan for trade-route math. Prefers the
   * caravan's `homeCityId` (set when the city produced it); a "NONE"-home
   * caravan (e.g. a hut mercenary) falls back to its nearest friendly city.
   */
  private getCaravanHomeCity(caravan: Unit): City | null {
    if (caravan.homeCityId) {
      const byId = this.cities.find((c: City) => c.id === caravan.homeCityId);
      if (byId) return byId;
    }
    let nearest: City | null = null;
    let best = Infinity;
    for (const c of this.cities) {
      if (c.civilizationId !== caravan.civilizationId) continue;
      const d = this.squareGrid?.squareDistance
        ? this.squareGrid.squareDistance(c.col, c.row, caravan.col, caravan.row)
        : Infinity;
      if (d < best) {
        best = d;
        nearest = c;
      }
    }
    return nearest;
  }

  /**
   * Civ1 trade route: a Caravan standing on a city tile delivers. The caravan
   * is consumed and the civ receives a lump sum of Gold AND Science scaled by
   * population and distance (foreign ×2, intercontinental ×2), and both cities
   * get a permanent per-turn trade route (max 3, weakest replaced).
   */
  establishTradeRoute(unitId: string): { success: boolean; gold?: number; science?: number; reason?: string } {
    const unit = this.units.find((u: Unit) => u.id === unitId);
    if (!unit) return { success: false, reason: 'unit_not_found' };
    if (unit.type !== 'caravan') return { success: false, reason: 'not_caravan' };
    const dest = this.getCityAt(unit.col, unit.row);
    if (!dest) return { success: false, reason: 'not_on_city' };
    const home = this.getCaravanHomeCity(unit);
    if (!home) return { success: false, reason: 'no_home_city' };
    if (home.id === dest.id) return { success: false, reason: 'same_city' };

    const distance = this.squareGrid?.squareDistance
      ? Math.max(1, this.squareGrid.squareDistance(home.col, home.row, dest.col, dest.row))
      : 1;
    const base = (home.population || 1) + (dest.population || 1);
    const foreign = dest.civilizationId !== unit.civilizationId;
    const intercontinental = this.pathCrossesWater(home.col, home.row, dest.col, dest.row);
    let multiplier = 1;
    if (foreign) multiplier *= 2;
    if (intercontinental) multiplier *= 2;
    const payout = Math.max(1, Math.round(base * (1 + distance / 4) * multiplier));
    const routeTrade = Math.max(1, Math.round(base / 4));

    // Lump-sum Gold + Science to the delivering civ.
    const civ = this.civilizations?.[unit.civilizationId];
    if (civ?.resources) {
      civ.resources.gold = (civ.resources.gold ?? 0) + payout;
      civ.resources.science = (civ.resources.science ?? 0) + payout;
    }

    this.addTradeRoute(home, {
      cityId: dest.id,
      cityName: dest.name,
      civilizationId: dest.civilizationId,
      trade: routeTrade,
      distance,
    });
    this.addTradeRoute(dest, {
      cityId: home.id,
      cityName: home.name,
      civilizationId: home.civilizationId,
      trade: routeTrade,
      distance,
    });

    // The caravan is consumed by the delivery.
    this.units = this.units.filter((u: Unit) => u.id !== unitId);
    this.unitTurnQueue?.removeUnit(unitId);

    console.log(`[TRADE] Caravan delivered: ${home.name} → ${dest.name} (+${payout} gold/science, ${distance} tiles, foreign:${foreign}, water:${intercontinental})`);
    if (this.onStateChange) {
      this.onStateChange('TRADE_ROUTE_ESTABLISHED', {
        caravan: unit,
        homeCity: home,
        destCity: dest,
        gold: payout,
        science: payout,
        foreign,
        intercontinental,
        distance,
      });
    }
    this.checkAndEndTurnIfNoMoves('trade-route-established');
    return { success: true, gold: payout, science: payout };
  }

  /**
   * Add a trade route to a city, capping at MAX_TRADE_ROUTES and replacing the
   * weakest existing route when the new one is stronger.
   */
  private addTradeRoute(city: City, route: TradeRoute): void {
    if (!Array.isArray(city.tradeRoutes)) city.tradeRoutes = [];
    const existing = city.tradeRoutes;
    if (existing.length < MAX_TRADE_ROUTES) {
      existing.push(route);
      return;
    }
    let weakestIdx = 0;
    for (let i = 1; i < existing.length; i++) {
      if ((existing[i].trade ?? 0) < (existing[weakestIdx].trade ?? 0)) weakestIdx = i;
    }
    if (route.trade > (existing[weakestIdx].trade ?? 0)) {
      existing[weakestIdx] = route;
    }
  }

  /**
   * Rough Civ1 intercontinental check: whether the straight line between the
   * two cities crosses any water tile (they are on different landmasses).
   */
  private pathCrossesWater(fromCol: number, fromRow: number, toCol: number, toRow: number): boolean {
    const dx = Math.abs(toCol - fromCol);
    const dy = Math.abs(toRow - fromRow);
    const sx = fromCol < toCol ? 1 : -1;
    const sy = fromRow < toRow ? 1 : -1;
    let err = dx - dy;
    let x = fromCol;
    let y = fromRow;
    for (let guard = 0; guard < 2000; guard++) {
      const tile = this.getTileAt(x, y);
      if (tile && this.isWaterTerrain(tile)) return true;
      if (x === toCol && y === toRow) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return false;
  }

  /**
   * Get all units
   */
  getAllUnits() {
    // Prefer units managed by the map/unitManager when available
    const unitMap = this.map as (MapData & { getAllUnits?: () => Unit[] }) | null;
    try {
      if (unitMap && typeof unitMap.getAllUnits === 'function') {
        return unitMap.getAllUnits();
      }
    } catch (e) {
      // fall back
      console.warn('[GameEngine] getAllUnits fallback triggered due to error:', e);
    }
    return [...this.units];
  }

  /**
   * Get all cities
   */
  getAllCities() {
    // Prefer cities managed by the map/cityManager when available
    const cityMap = this.map as (MapData & { getCities?: () => City[]; getAllCities?: () => City[] }) | null;
    try {
      if (cityMap && typeof cityMap.getCities === 'function') {
        return cityMap.getCities();
      }
      if (cityMap && typeof cityMap.getAllCities === 'function') {
        return cityMap.getAllCities();
      }
    } catch (e) {
      console.warn('[GameEngine] getAllCities fallback triggered due to error:', e);
    }
    return [...this.cities];
  }

  /** Civ1 zone of control: enemy military units make adjacent destination
   * squares unsafe for civilian settlers. */
  private settlerDestinationInEnemyZoC(unit: Unit, col: number, row: number): boolean {
    if (unit.type !== 'settler') return false;
    return this.units.some((enemy) => {
      if (enemy.civilizationId === unit.civilizationId || enemy.isDefeated) return false;
      const enemyAttack = enemy.attack ?? UNIT_PROPS[enemy.type]?.attack ?? 0;
      if (enemyAttack <= 0) return false;
      return this.squareGrid?.squareDistance(col, row, enemy.col, enemy.row) === 1;
    });
  }

  /**
   * Civ1 movement cost to ENTER a tile. Base terrain cost (1/2/3), discounted
   * to 1/3 when the tile carries a road, and to ~0 (tiny epsilon) when it
   * carries a railroad — railroads make movement effectively free. Mirrors
   * Pathfinding.getTileCost so the path the AI plans is charged the same way
   * a manual move is.
   */
  private getMoveCost(tile: MapTile | null): number {
    if (!tile) return 1;
    const t = tile as MapTile & { road?: boolean; railroad?: boolean; hasRoad?: boolean };
    if (t.railroad || t.improvement === IMPROVEMENT_TYPES.RAILROAD) {
      return IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD]?.movementCost ?? 0;
    }
    if (t.road || t.hasRoad || t.improvement === IMPROVEMENT_TYPES.ROAD) {
      return IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD]?.movementCost ?? 1 / 3;
    }
    return Math.max(1, TERRAIN_PROPS[this.getTerrainKey(tile)]?.movement || 1);
  }

  /**
   * Civ1 "Minimum 1 Move" rule: a unit that has performed no action yet this
   * turn (moves_current == moves_max) may always enter ONE adjacent tile, even
   * when that tile's movement cost exceeds its remaining movement points.
   * Such a move consumes all remaining movement points. Once the unit has
   * moved (or taken any action), the exception no longer applies and the
   * standard `moves_current >= cost` check governs.
   */
  canUnitAffordMove(unit: Unit, moveCost: number): boolean {
    const movesCurrent = unit.movesRemaining || 0;
    if (movesCurrent <= 0) return false;
    if (movesCurrent >= moveCost) return true;

    // Civ1 exception: a fresh unit (no action taken, full movement intact)
    // may always make its first move, even into heavy terrain.
    const movesMax = typeof unit.maxMoves === 'number' ? unit.maxMoves : movesCurrent;
    const isFresh = unit.hasMovedThisTurn !== true && movesCurrent >= movesMax;
    return isFresh;
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

    const targetTerrain = this.getTerrainKey(targetTile);
    const isTargetWater = this.isWaterTerrain(targetTile);
    const isUnitNaval = !!(UNIT_PROPS[unit.type]?.naval || unit.isNaval || (unit as { naval?: boolean }).naval);

    if (unit.type === 'settler' && isTargetWater) {
      return false;
    }
    if (isTargetWater && !isUnitNaval) {
      console.log(`[canUnitMoveTo] Target tile at (${targetCol}, ${targetRow}) is water and not passable for land unit ${unit.type}.`);
      return false;
    }
    if (!isTargetWater && isUnitNaval) {
      console.log(`[canUnitMoveTo] Naval unit ${unit.type} cannot enter land tile at (${targetCol}, ${targetRow}).`);
      return false;
    }
    if (TERRAIN_PROPS[targetTerrain]?.passable === false) {
      console.log(`[canUnitMoveTo] Target tile at (${targetCol}, ${targetRow}) is not passable.`);
      return false;
    }

    // Caravans may always enter a city tile (to establish a trade route),
    // even when a garrison defends it — they deliver, they don't fight.
    if (unit.type === 'caravan' && this.getCityAt(targetCol, targetRow)) {
      return true;
    }

    // Check if there's another unit at target (combat or stacking rules).
    // `getUnitAt` returns the FIRST unit on a tile, so when the attacker shares
    // its tile with an enemy the attacker itself may come back first and the
    // tile would be treated as "allied". For the same-tile case scan explicitly
    // for a stacked enemy so a same-tile attack is allowed.
    const targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetCol === unit.col && targetRow === unit.row) {
      const stackedEnemy = this.units.find(u => u.col === targetCol && u.row === targetRow
        && u.id !== unit.id && u.civilizationId !== unit.civilizationId && !u.isDefeated);
      if (stackedEnemy) {
        if (unit.type === 'settler') {
          return false;
        }
        console.log(`[canUnitMoveTo] Enemy stacked on same tile — allowing attack.`);
        return true;
      }
      // No enemy on our own tile — a unit cannot "move" onto itself.
      return false;
    }
    if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
      if (unit.type === 'settler') {
        // Attack 0 settlers cannot enter an enemy unit's square; this is the
        // fatal ZoC/combat outcome represented as a blocked civilian move.
        return false;
      }
      console.log(`[canUnitMoveTo] Target occupied by enemy unit. Allowing attack.`);
      return true;
    }

    if (this.settlerDestinationInEnemyZoC(unit, targetCol, targetRow)) {
      return false;
    }
    if (targetUnit && targetUnit.civilizationId === unit.civilizationId) {
      console.log(`[canUnitMoveTo] Target occupied by allied unit. Movement not allowed.`);
      return false;
    }

    // Calculate move cost (terrain, discounted by road/railroad — Civ1)
    const distance = this.squareGrid.chebyshevDistance(unit.col, unit.row, targetCol, targetRow);
    const moveCost = this.getMoveCost(targetTile);

    // Civ1: a fresh unit may always enter one adjacent tile (Minimum 1 Move),
    // even when the cost exceeds its remaining movement points.
    const hasEnoughMoves = this.canUnitAffordMove(unit, moveCost);
    if (!hasEnoughMoves) {
      console.log(`[canUnitMoveTo] Insufficient moves for unit ${unitId}. Distance: ${distance}, MoveCost: ${moveCost}, MovesRemaining: ${unit.movesRemaining}`);
    }
    return hasEnoughMoves;
  }

  /**
   * Checks if a unit can move to a specific tile without actually moving it.
   * Returns true if the move is valid and possible, false otherwise.
   */
  canMoveUnit(id: string, targetCol: number, targetRow: number): boolean {
    const unit = this.units.find(u => u.id === id);
    if (!unit) return false;

    if (!this.squareGrid.isValidSquare(targetCol, targetRow)) return false;

    // Check if unit has moves remaining
    if ((unit.movesRemaining || 0) <= 0) return false;

    // Check if target tile exists and is passable
    const targetTile = this.getTileAt(targetCol, targetRow);
    if (!targetTile) return false;

    const targetTerrain = this.getTerrainKey(targetTile);
    const isTargetWater = this.isWaterTerrain(targetTile);
    const isUnitNaval = !!(UNIT_PROPS[unit.type]?.naval || unit.isNaval || (unit as { naval?: boolean }).naval);

    if (unit.type === 'settler' && isTargetWater) return false;
    if (isTargetWater && !isUnitNaval) return false;
    if (!isTargetWater && isUnitNaval) return false;
    if (TERRAIN_PROPS[targetTerrain]?.passable === false) return false;

    // Check if the unit can afford the terrain cost
    const moveCost = this.getMoveCost(targetTile);
    if (!this.canUnitAffordMove(unit, moveCost)) {
      return false;
    }

    // Check if there's an enemy unit blocking the tile (combat is possible, so we return true)
    // If there is a friendly unit on the tile, assume we cannot move there (no stacking)
    const targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetUnit) {
      if (targetUnit.civilizationId === unit.civilizationId) {
        return false; // Friendly unit blocking
      }
      // If it's an enemy unit, it's a valid combat move
      return true; 
    }

    // Check for enemy city (valid attack target)
    const targetCity = this.getCityAt(targetCol, targetRow);
    if (targetCity && targetCity.civilizationId !== unit.civilizationId) {
      // Caravans can enter to deliver, Scouts can attempt rush, military can attack
      return true;
    }

    return true;
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

    const targetTerrain = this.getTerrainKey(targetTile);
    const isTargetWater = this.isWaterTerrain(targetTile);
    const isUnitNaval = !!(UNIT_PROPS[unit.type]?.naval || unit.isNaval || (unit as { naval?: boolean }).naval);

    if (unit.type === 'settler' && isTargetWater) {
      return { success: false, reason: 'settler_cannot_enter_ocean' };
    }
    if (isTargetWater && !isUnitNaval) {
      return { success: false, reason: 'terrain_impassable' };
    }
    if (!isTargetWater && isUnitNaval) {
      return { success: false, reason: 'terrain_impassable' };
    }
    if (TERRAIN_PROPS[targetTerrain]?.passable === false) return { success: false, reason: 'terrain_impassable' };

    // Check if there's another unit at target (combat or stacking rules).
    // `getUnitAt` returns the first unit on a tile — when the attacker shares
    // its tile with an enemy, scan explicitly for the stacked enemy so a
    // same-tile attack triggers combat (getUnitAt could return the attacker).
    let targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetCol === unit.col && targetRow === unit.row) {
      const stackedEnemy = this.units.find(u => u.col === targetCol && u.row === targetRow
        && u.id !== unit.id && u.civilizationId !== unit.civilizationId && !u.isDefeated);
      if (stackedEnemy) targetUnit = stackedEnemy;
    }

    // A Caravan entering a city tile delivers instead of fighting its garrison.
    if (unit.type === 'caravan' && this.getCityAt(targetCol, targetRow)) {
      targetUnit = null;
    }
    if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
      // Combat. combatUnit auto-declares war at its start, so we must NOT gate
      // on 'not_at_war' here — that pre-check made UI attacks impossible while
      // the civilizations were still at peace.
      const combatResult = this.combatUnit(unit, targetUnit);

      // The attacker is done after combat (moves spent, possibly destroyed).
      // Drop it from the turn queue so the queue can empty and auto-end-turn
      // can trigger. combatUnit ran its own auto-end check while the attacker
      // was still queued, so re-check once the queue is cleaned — guarded to
      // the same player's turn in case combat already ended it.
      if (this.unitTurnQueue) {
        this.unitTurnQueue.checkUnitStatus(unitId);
      }
      if (this.activePlayer === unit.civilizationId) {
        this.checkAndEndTurnIfNoMoves('combat-unit-done');
      }

      // combatUnit returns boolean success currently; normalize
      const success = !!combatResult;
      return { success, reason: success ? 'combat_victory' : 'combat_defeat' };
    }
    
    // Check if there's an enemy city at target. Caravans are EXCLUDED — they
    // may enter an enemy city to establish a trade route (they deliver and are
    // consumed); they never attack or capture.
    const targetCity = this.getCityAt(targetCol, targetRow);
    if (targetCity && targetCity.civilizationId !== unit.civilizationId && unit.type !== 'caravan') {
      // Civilian units (settlers, workers, diplomats, caravans) cannot
      // attack or capture cities. Block the move — otherwise a wandering
      // settler rolls a 50/50 capture against a size-1 city (resolveCityCombat
      // treated attack 0 as strength 1 via `attack || 1`) and can wipe out an
      // opponent's capital in the ancient era.
      //
      // EXCEPTION — Scouts may attempt a "rush" on an undefended city:
      // 30% chance to slip in and capture it.  If the rush fails, the move
      // is rejected and the scout stays put.
      const isScout = unit.type === 'scout';
      const civilianTypes = new Set(['settler', 'worker', 'caravan', 'diplomat']);
      // Caravans are allowed to enter enemy cities to establish trade routes
      // (they never capture — they deliver and are consumed).
      if (civilianTypes.has(unit.type) && unit.type !== 'caravan') {
        console.log(`[moveUnit] Civilian ${unit.type} cannot attack enemy city — blocked`);
        return { success: false, reason: 'civilian_cannot_attack_city' };
      }

      // Scout rush check: only works if the city has NO defending units.
      if (isScout) {
        const cityDefenders = this.units.filter(
          (u: Unit) => u.civilizationId === targetCity.civilizationId
            && u.col === targetCity.col
            && u.row === targetCity.row
            && u.isDefeated !== true
            && u.id !== unit.id,
        );
        if (cityDefenders.length > 0) {
          console.log(`[moveUnit] Scout rush blocked — city ${targetCity.name} is defended (${cityDefenders.length} unit(s))`);
          return { success: false, reason: 'city_defended' };
        }

        // 30% chance to capture an undefended city
        if (Math.random() < 0.30) {
          console.log(`[SCOUT RUSH] Scout ${unit.id} rushes ${targetCity.name} — success!`);

          // Declare war first
          if (this.diplomacyManager) {
            const dipStatus = this.diplomacyManager.getStatus(unit.civilizationId, targetCity.civilizationId);
            if (dipStatus !== 'war') {
              this.diplomacyManager.declareWar(unit.civilizationId, targetCity.civilizationId);
            }
          }

          const oldCiv = targetCity.civilizationId;

          // If city has pop ≤ 1 it's razed rather than captured.
          if ((targetCity.population || 1) <= 1) {
            this.destroyGarrisonOnCapture(targetCity, oldCiv);
            this.cities = this.cities.filter(c => c.id !== targetCity.id);
            console.log(`[SCOUT RUSH] City ${targetCity.name} destroyed by scout rush`);
            if (targetCity.isCapital === true) {
              this.governmentManager?.ensureCapital(oldCiv);
            }
            if (this.onStateChange) {
              this.onStateChange('CITY_DESTROYED', { city: targetCity, attacker: unit });
            }
          } else {
            // Capture the city
            targetCity.population -= 1;
            targetCity.civilizationId = unit.civilizationId;
            targetCity.buildings = targetCity.buildings ?? [];
            if (unit.civilizationId === BARBARIAN_CIV_ID) {
              // A barbarian-held city is auto-managed (military units only) and
              // the barbarians become a faction the moment they hold it.
              targetCity.autoProduction = true;
              this.ensureBarbarianCivilization();
            }
            this.destroyBuildingsOnCapture(targetCity);
            this.plunderCityGold(oldCiv, unit.civilizationId);
            this.destroyGarrisonOnCapture(targetCity, oldCiv);
            targetCity.currentProduction = null;
            if (Array.isArray(targetCity.buildQueue)) targetCity.buildQueue.length = 0;
            targetCity.productionStored = 0;
            targetCity.productionProgress = 0;
            targetCity.capturedTurns = 5;
            if (targetCity.isCapital === true) {
              targetCity.isCapital = false;
              const pIdx = targetCity.buildings.indexOf('palace');
              if (pIdx !== -1) targetCity.buildings.splice(pIdx, 1);
              this.governmentManager?.ensureCapital(oldCiv);
            }
            console.log(`[SCOUT RUSH] City ${targetCity.name} captured by civ ${unit.civilizationId} (pop ${targetCity.population})`);
          }

          // Spend the scout's moves
          unit.movesRemaining = 0;
          unit.hasMovedThisTurn = true;

          if (this.unitTurnQueue) {
            this.unitTurnQueue.removeUnit(unitId);
          }
          if (this.activePlayer === unit.civilizationId) {
            this.checkAndEndTurnIfNoMoves('scout-rush-captured');
          }
          if (this.onStateChange) {
            this.onStateChange('CITY_CAPTURED', {
              city: targetCity,
              capturedBy: unit.civilizationId,
              originalCiv: oldCiv,
            });
          }
          return { success: true, reason: 'scout_rush_captured' };
        }

        // Rush failed — scout cannot enter defended or contested cities
        console.log(`[SCOUT RUSH] Scout ${unit.id} rush failed on ${targetCity.name} (30% miss)`);
        return { success: false, reason: 'scout_rush_failed' };
      }

      // Attacking an enemy city declares war (mirrors combatUnit behavior).
      if (this.diplomacyManager) {
        const dipStatus = this.diplomacyManager.getStatus(unit.civilizationId, targetCity.civilizationId);
        if (dipStatus !== 'war') {
          this.diplomacyManager.declareWar(unit.civilizationId, targetCity.civilizationId);
        }
      }
      // City combat (native engine logic — the legacy Unit.attackCity API
      // is incompatible with engine plain-object units).
      const result = this.resolveCityCombat(unit, targetCity);

      // Drop the spent/destroyed attacker from the turn queue so the queue can
      // empty and auto-end-turn can trigger after attacking a city.
      if (this.unitTurnQueue) {
        if (result === 'captured' || result === 'city_destroyed') {
          this.unitTurnQueue.removeUnit(unitId); // attacker consumed
        } else {
          this.unitTurnQueue.checkUnitStatus(unitId); // attacker spent (moves 0)
        }
      }
      if (this.activePlayer === unit.civilizationId) {
        this.checkAndEndTurnIfNoMoves('city-combat-done');
      }

      if (result === 'captured') {
        // In this clone the attacker survives city capture.
        // Set moves to 0 so the unit is spent for this turn.
        unit.movesRemaining = 0;
        unit.hasMovedThisTurn = true;
        if (this.onStateChange) {
          this.onStateChange('CITY_CAPTURED', {
            city: targetCity,
            capturedBy: unit.civilizationId,
            originalCiv: targetCity.civilizationId,
          });
        }
        return { success: true, reason: 'city_captured' };
      }
      if (result === 'hit') {
        if (this.onStateChange) {
          this.onStateChange('CITY_ATTACKED', {
            city: targetCity,
            attacker: unit,
            result: { cityHit: true },
          });
        }
        return { success: true, reason: 'city_damaged' };
      }
      // Attacker survived (or city was destroyed by attacker — treat as captured)
      if (result === 'city_destroyed') {
        // Unit survives — just spend its moves for this turn.
        unit.movesRemaining = 0;
        unit.hasMovedThisTurn = true;
        if (this.onStateChange) {
          this.onStateChange('CITY_CAPTURED', {
            city: targetCity,
            capturedBy: unit.civilizationId,
            originalCiv: targetCity.civilizationId,
          });
        }
        return { success: true, reason: 'city_captured' };
      }
      return { success: false, reason: 'attack_failed' };
    }

    // Move the unit — Civ1 terrain cost, discounted by road (1/3) / railroad (~free).
    const moveCost = this.getMoveCost(targetTile);

    // Civ1 "Minimum 1 Move": a fresh unit may always make its first move even
    // into heavy terrain (cost > moves); that move consumes all its points.
    if (this.canUnitAffordMove(unit, moveCost)) {
      const fromCol = unit.col;
      const fromRow = unit.row;

      // A settler that walks away abandons any in-progress improvement work
      // (Civ1: construction requires the settler to stay on the tile).
      if (unit.workTarget) {
        console.log(`[GameEngine] Unit ${unit.id} abandoned ${unit.workTarget} work by moving`);
        unit.workTarget = null;
        unit.workTurns = 0;
      }

      unit.col = targetCol;
      unit.row = targetRow;
      // Moving breaks fortification (Civ1).
      unit.isFortified = false;
      // Standard case: subtract the tile cost. Civ1 exception case: the tile
      // cost more than we had left, so the (forced) move spends everything.
      unit.movesRemaining = (unit.movesRemaining || 0) >= moveCost
        ? (unit.movesRemaining || 0) - moveCost
        : 0;
      // The unit has now executed a move this turn — the Minimum-1-Move
      // exception no longer applies to subsequent moves.
      unit.hasMovedThisTurn = true;

      // Civ1 village (goody hut) resolution — a military unit entering the
      // tile claims the village and rolls an outcome.
      this.resolveVillage(unit, targetTile);

      // Civ1 trade route: a Caravan that reaches a city tile delivers now
      // (consumes the caravan, pays gold + science, opens a permanent route).
      if (unit.type === 'caravan' && this.canEstablishTradeRoute(unit.id)) {
        this.establishTradeRoute(unit.id);
      }

      // Update turn done status
      this.updateUnitTurnsDoneFlag(unit);

      // Log movement
      console.log(`[MOVEMENT] ${unit.type} (${unit.id}) moved from (${fromCol},${fromRow}) to (${targetCol},${targetRow}), moveCost: ${moveCost}, moves remaining: ${unit.movesRemaining}`);

      // Reveal area around the unit immediately after moving so automated moves explore
      try {
        // Determine sight range (unit may define it, otherwise check UNIT_PROPS, default to 1)
        let sightRange = 1; // Default to 1 tile radius
        if (typeof unit.sightRange === 'number') sightRange = unit.sightRange;
        else if (UNIT_PROPS && UNIT_PROPS[String(unit.type).toLowerCase()] && typeof UNIT_PROPS[String(unit.type).toLowerCase()].sightRange === 'number') {
          sightRange = UNIT_PROPS[String(unit.type).toLowerCase()].sightRange;
        }

        // Ensure sight range is valid (non-negative)
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

      // Check unit status in the turn queue (may advance to next unit)
      if (this.unitTurnQueue) {
        this.unitTurnQueue.checkUnitStatus(unitId);
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves('unit-moved');

      return { success: true };
    }

    return { success: false, reason: 'insufficient_moves' };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Civ1 villages (goody huts)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Scatter Civ1 villages (goody huts) across the map after civilizations have
   * been created. Villages never spawn on water, mountains, special-resource
   * tiles (oasis, gold, …), or within 2 tiles of a starting settler; at most
   * one village per tile.
   */
  private placeVillages(): void {
    if (!this.map || !this.map.tiles) return;
    const { width, height, tiles } = this.map;

    // Keep villages away from starting settler placements (2-tile radius).
    const protectedTiles = new Set<string>();
    for (const unit of this.units) {
      if (unit.type !== 'settler') continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const c = unit.col + dc;
          const r = unit.row + dr;
          if (c >= 0 && c < width && r >= 0 && r < height) protectedTiles.add(`${c},${r}`);
        }
      }
    }

    const target = Math.max(1, Math.floor((width * height) / 150));
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < target * 40) {
      attempts++;
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      if (!tile || tile.village) continue;
      const type = String(tile.type ?? tile.terrain);
      if (type === Constants.TERRAIN.OCEAN || type === Constants.TERRAIN.MOUNTAINS) continue;
      if (tile.resource) continue; // Civ1: never override special resource tiles (oasis, gold, …)
      if (protectedTiles.has(`${tile.col},${tile.row}`)) continue;
      tile.village = true;
      placed++;
    }
    console.log(`[VILLAGE] Placed ${placed} villages on ${width}x${height} map`);
  }

  /**
   * Resolve a village (goody hut) when a LAND unit enters its tile.
   *  - Any land unit triggers and consumes the hut: military, settler,
   *    worker, caravan, diplomat, even barbarians (Civ1 "any land unit").
   *  - Air units fly over untouched (they are not land units).
   *  - The outcome is rolled from the Civ1 pool (equal weight):
   *    Advanced Tribe, Scroll of Ancient Wisdom, Valuable Metals, Friendly
   *    Mercenaries, or Barbarian Ambush. Invalid rolls (city adjacency for
   *    Advanced Tribe, no researchable tech for Scroll) are re-rolled.
   *  - A village never turns into a city for a NON-settler unit: only a
   *    settler's hut can roll the Advanced Tribe (new settlement) outcome.
   *  - Civ1 "NONE" hack: when a SETTLER triggers the hut and rolls a new
   *    unit, the reward is a Settler with a NONE home city.
   */
  private resolveVillage(unit: Unit, tile: MapTile | null): void {
    if (!tile?.village) return;
    const props = UNIT_PROPS[String(unit.type)];
    const isAir = props?.type === 'air';

    // Civ1: only land units trigger a village — air units pass over untouched.
    if (isAir) return;

    // The hut is consumed — and disappears from the map — the instant it is
    // triggered. The result message still pops for the human player, but the
    // village graphic is already gone.
    tile.village = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      const outcome = VILLAGE_OUTCOMES[Math.floor(Math.random() * VILLAGE_OUTCOMES.length)];
      switch (outcome) {
        case VILLAGE_OUTCOME.ADVANCED_TRIBE: {
          // Only a SETTLER's hut can become a new city — a military or other
          // non-settler unit finding a village never founds a city, so re-roll
          // it into one of the other outcomes.
          if (String(unit.type) !== 'settler') continue;
          // Re-roll when on or adjacent to an existing city.
          if (this.isTileAdjacentToCity(unit.col, unit.row)) continue;
          const city = this.foundTribeCity(unit);
          this.emitVillageResult(unit, { outcome, cityName: city?.name });
          return;
        }
        case VILLAGE_OUTCOME.SCROLL_OF_ANCIENT_WISDOM: {
          const techId = this.pickFreeTech(unit.civilizationId);
          if (!techId) continue; // re-roll when no tech is available
          const techName = this.technologies.find((t) => t.id === techId)?.name ?? techId;
          this.grantTech(unit.civilizationId, techId);
          this.emitVillageResult(unit, { outcome, techId, techName });
          return;
        }
        case VILLAGE_OUTCOME.VALUABLE_METALS: {
          const goldAmount = this.rollVillageGold();
          this.addGoldToCiv(unit.civilizationId, goldAmount);
          this.emitVillageResult(unit, { outcome, goldAmount });
          return;
        }
        case VILLAGE_OUTCOME.FRIENDLY_MERCENARIES: {
          // Civ1 "NONE" hack: a settler that triggers a hut and rolls a new
          // unit is rewarded with a Settler that has a NONE home city (and
          // costs 0 food/shield maintenance).
          const isSettlerTrigger = String(unit.type) === 'settler';
          const unitType = isSettlerTrigger
            ? 'settler'
            : this.pickStrongestBuildableUnit(unit.civilizationId);
          const unitName = UNIT_PROPS[unitType]?.name ?? unitType;
          this.createUnit(unit.civilizationId, unitType, unit.col, unit.row);
          this.emitVillageResult(unit, { outcome, unitType, unitName });
          return;
        }
        case VILLAGE_OUTCOME.BARBARIANS: {
          const barbarianCount = this.spawnBarbarians(unit);
          this.emitVillageResult(unit, { outcome, barbarianCount });
          return;
        }
        default:
          continue;
      }
    }

    // Re-roll budget exhausted — grant gold as a safe fallback.
    const goldAmount = this.rollVillageGold();
    this.addGoldToCiv(unit.civilizationId, goldAmount);
    this.emitVillageResult(unit, { outcome: 'valuable_metals', goldAmount });
  }

  /** Roll a Civ1 Valuable Metals payout: 25, 50, or 100 gold. */
  private rollVillageGold(): number {
    return VILLAGE_GOLD_AMOUNTS[Math.floor(Math.random() * VILLAGE_GOLD_AMOUNTS.length)] ?? 50;
  }

  /** Whether the tile at (col,row) is on or adjacent to an existing city. */
  private isTileAdjacentToCity(col: number, row: number): boolean {
    return this.cities.some(
      (city) => !!this.squareGrid && this.squareGrid.squareDistance(col, row, city.col, city.row) <= 1,
    );
  }

  /**
   * Create a city from an Advanced Tribe village: 1 population plus a random
   * free building (Barracks, Granary, Temple, or nothing).
   */
  private foundTribeCity(unit: Unit): City | null {
    const civId = unit.civilizationId;
    const civ = this.civilizations[civId];
    if (!civ) return null;
    const cityName = this.getNextCityName(civId);
    const building = VILLAGE_FREE_BUILDINGS[Math.floor(Math.random() * VILLAGE_FREE_BUILDINGS.length)];
    const city: City = {
      id: `city_${civId}_${this.cities.length}`,
      name: cityName,
      civilizationId: civId,
      col: unit.col,
      row: unit.row,
      population: 1,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      isCapital: this.cities.filter((c) => c.civilizationId === civId).length === 0,
      buildings: building ? [building] : [],
      yields: { food: 2, production: 1, trade: 0 },
      foodStored: 0,
      foodNeeded: 20,
      productionStored: 0,
      productionProgress: 0,
      currentProduction: civ.isHuman
        ? { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }
        : this.pickInitialAIProduction(civId),
      buildQueue: [],
      autoProduction: true, // New cities default to Auto Production ON
    };
    this.cities.push(city);

    if (city.isCapital) {
      this.governmentManager?.designateCapital(civId, city);
    }
    if (this.autoProduction && city.autoProduction) {
      this.autoProduction.ensureProductionQueue(city.id);
    }
    if (this.onStateChange) {
      this.onStateChange('CITY_FOUNDED', { city, source: 'village' });
    }
    return city;
  }

  /**
   * Random tech the civ can research right now (prerequisites met, not yet
   * owned) — no prerequisite skipping. Null when nothing is available.
   */
  private pickFreeTech(civId: number): string | null {
    const civ = this.civilizations[civId];
    if (!civ) return null;
    const available = AIResearch.getAvailableTechnologies(civ);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  /** Add a researched tech to a civ (free from a village) and refresh the tree. */
  private grantTech(civId: number, techId: string): void {
    const civ = this.civilizations[civId];
    if (!civ) return;
    if (Array.isArray(civ.technologies) && !civ.technologies.includes(techId)) {
      civ.technologies.push(techId);
    }
    this.updateTechnologyAvailability();
    console.log(`[VILLAGE] Civ ${civId} granted free tech: ${techId}`);
  }

  /** Add gold to a civilization's treasury. */
  private addGoldToCiv(civId: number, amount: number): void {
    const civ = this.civilizations[civId];
    if (!civ) return;
    civ.resources = civ.resources ?? { food: 0, production: 0, trade: 0, science: 0, gold: 0 };
    civ.resources.gold = (civ.resources.gold ?? 0) + amount;
    console.log(`[VILLAGE] Civ ${civId} received ${amount} gold (total ${civ.resources.gold})`);
  }

  /**
   * Strongest military unit type the civ can currently build (highest attack,
   * tie-broken by defense). Air units and civilians are excluded.
   */
  private pickStrongestBuildableUnit(civId: number): string {
    const civ = this.civilizations[civId];
    const civTechs = new Set(civ && Array.isArray(civ.technologies) ? civ.technologies : []);
    const civilians = new Set(['settler', 'worker', 'caravan', 'diplomat', 'ferry']);
    let best: { type: string; attack: number; defense: number } | null = null;
    for (const [type, props] of Object.entries(UNIT_PROPS)) {
      if (!props) continue;
      if (props.type === 'air') continue;
      if (civilians.has(type)) continue;
      if ((props.attack || 0) <= 0) continue;
      const requires = (props as { requires?: string | null }).requires;
      if (requires && !civTechs.has(requires)) continue;
      const attack = props.attack || 0;
      const defense = props.defense || 0;
      if (!best || attack > best.attack || (attack === best.attack && defense > best.defense)) {
        best = { type, attack, defense };
      }
    }
    return best ? best.type : 'warrior';
  }

  /**
   * Spawn a Civ1 Barbarian Ambush: 1–3 barbarians (Warrior or Legion, equal
   * chance) on random adjacent land tiles, hostile to everyone. Each barbarian
   * that spawns adjacent to the triggering unit attacks it immediately (same
   * turn) — unless the trigger is itself a barbarian (the horde does not turn
   * on its own). Returns the number of barbarians spawned.
   */
  private spawnBarbarians(triggerUnit: Unit): number {
    const neighbors = this.squareGrid
      ? this.squareGrid.getNeighbors(triggerUnit.col, triggerUnit.row)
      : [];
    const spots: Array<{ col: number; row: number }> = [];
    for (const n of neighbors) {
      const tile = this.getTileAt(n.col, n.row);
      if (!tile) continue;
      const type = String(tile.type ?? tile.terrain);
      if (type === Constants.TERRAIN.OCEAN || type === Constants.TERRAIN.MOUNTAINS) continue;
      if (this.getUnitAt(n.col, n.row)) continue;
      if (this.getCityAt(n.col, n.row)) continue;
      spots.push({ col: n.col, row: n.row });
    }
    // Shuffle and pick 2–4 (or as many as are free).
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const count = Math.min(
      VILLAGE_BARBARIAN_MIN + Math.floor(Math.random() * (VILLAGE_BARBARIAN_MAX - VILLAGE_BARBARIAN_MIN + 1)),
      spots.length,
    );
    for (let i = 0; i < count; i++) {
      const type = VILLAGE_BARBARIAN_TYPES[Math.floor(Math.random() * VILLAGE_BARBARIAN_TYPES.length)];
      this.createUnit(BARBARIAN_CIV_ID, type, spots[i].col, spots[i].row);
    }

    // Barbarians act immediately: attack the triggering unit while it is still
    // on the village tile (they spawn adjacent to it). A barbarian trigger is
    // exempt — the horde never turns on its own kind.
    if (triggerUnit.civilizationId === BARBARIAN_CIV_ID) return count;
    const target = this.units.find((u) => u.id === triggerUnit.id);
    if (target) {
      const barbarians = this.units.filter((u) => u.civilizationId === BARBARIAN_CIV_ID);
      for (const barbarian of barbarians) {
        if ((target as { isDefeated?: boolean }).isDefeated) break; // triggering unit fell
        const dist = this.squareGrid
          ? this.squareGrid.squareDistance(barbarian.col, barbarian.row, target.col, target.row)
          : Infinity;
        if (dist === 1) {
          this.combatUnit(barbarian, target);
        }
      }
    }
    return count;
  }

  /** Emit a village encounter for the UI (human-only modal shown downstream). */
  private emitVillageResult(unit: Unit, result: Omit<VillageResult, 'civId' | 'col' | 'row'>): void {
    if (this.onStateChange) {
      this.onStateChange('VILLAGE_RESULT', {
        ...result,
        civId: unit.civilizationId,
        col: unit.col,
        row: unit.row,
      });
    }
  }

  /**
   * Combat between units
   */
  combatUnit(attacker: Unit, defender: Unit) {
    // Auto-declare war if not already at war. Barbarian units (phantom civ id
    // < 0) never participate in diplomacy — combat with them is always hostile
    // and must not create phantom war relations or UI events.
    if (this.diplomacyManager && attacker.civilizationId !== defender.civilizationId
        && attacker.civilizationId >= 0 && defender.civilizationId >= 0) {
      const status = this.diplomacyManager.getStatus(attacker.civilizationId, defender.civilizationId);
      if (status !== 'war') {
        this.diplomacyManager.declareWar(attacker.civilizationId, defender.civilizationId);
        if (this.onStateChange) {
          this.onStateChange('WAR_DECLARED', {
            aggressorId: attacker.civilizationId,
            targetId: defender.civilizationId,
          });
        }
      }

      // Alliance cascade: allies of the defender also declare war on the attacker
      const defenderAllies = this.diplomacyManager.getAllies(defender.civilizationId);
      for (const allyId of defenderAllies) {
        if (allyId === attacker.civilizationId) continue;
        if (!this.diplomacyManager.isAtWar(allyId, attacker.civilizationId)) {
          this.diplomacyManager.declareWar(allyId, attacker.civilizationId);
          const allyCiv = this.civilizations[allyId];
          if (this.onStateChange) {
            this.onStateChange('WAR_DECLARED', {
              aggressorId: allyId,
              targetId: attacker.civilizationId,
            });
            this.onStateChange('DIPLOMACY_EVENT', {
              message: `${allyCiv?.name ?? 'An ally'} honors their alliance and declares war!`,
            });
          }
        }
      }
    }

    const attackerStrength = attacker.attack * (attacker.health / 100);
    // Civ1: the defender's terrain defense bonus (mountains +200%, hills +100%,
    // forest/jungle/swamp/river +50%), fortification (x1.5), and fortress
    // (+100%, applied last) stack onto the defender's strength.
    const defenderTile = this.getTileAt(defender.col, defender.row);
    const defenderTerrain = defenderTile ? (defenderTile.type ?? defenderTile.terrain) : null;
    const terrainDefense = defenderTerrain ? TERRAIN_PROPS[defenderTerrain]?.defense ?? 1 : 1;
    let defenderStrength = defender.defense * (defender.health / 100) * Math.max(1, terrainDefense);
    // Units inside a city automatically gain +50% fortification bonus,
    // even without an explicit fortify order.
    const isInCity = this.getCityAt(defender.col, defender.row) !== null;
    const isFortified = (defender as { isFortified?: boolean }).isFortified || isInCity;
    if (isFortified) {
      defenderStrength *= 1.5;
    }
    const fortressDef = defenderTile?.improvement
      ? IMPROVEMENT_PROPERTIES[String(defenderTile.improvement)]?.defenseMultiplier
      : undefined;
    if (fortressDef) {
      defenderStrength *= fortressDef;
    }

    const attackerWins = Math.random() * (attackerStrength + defenderStrength) < attackerStrength;
    
    if (attackerWins) {
      // Attacker wins - move to defender's position
      const fromCol = attacker.col;
      const fromRow = attacker.row;

      attacker.col = defender.col;
      attacker.row = defender.row;
      attacker.movesRemaining = 0;
      attacker.hasMovedThisTurn = true;

      // Update turn done status for attacker
      this.updateUnitTurnsDoneFlag(attacker);

      // Log combat movement
      console.log(`[COMBAT MOVEMENT] ${attacker.type} (${attacker.id}) defeated ${defender.type} (${defender.id}) and moved from (${fromCol},${fromRow}) to (${defender.col},${defender.row})`);

      // Mark defender as defeated and delay removal (5 seconds to show black X)
      defender.isDefeated = true;
      defender.defeatTimestamp = Date.now();
      
      if (this.onStateChange) {
        this.onStateChange('UNIT_DEFEATED', { unit: defender });
      }
      setTimeout(() => {
        this.units = this.units.filter(u => u.id !== defender.id);

        // Sync the store so the defeated unit actually disappears (the engine
        // removed it here; without this the store would keep a stale copy).
        this.onStateChange?.('UNIT_REMOVED', { unit: defender });

        // Phase 3.2: If a scout died, reassign zones
        if (defender.type === 'scout') {
          this.onScoutDeath(defender);
        }
      }, 1200);

      if (this.onStateChange) {
        this.onStateChange('COMBAT_VICTORY', {
          attacker,
          defender,
          attackerFromCol: fromCol,
          attackerFromRow: fromRow,
          attackerSurvived: true,
          defenderSurvived: false,
        });
      }

      // Civ1: when the LAST defender inside a city falls, the city is captured
      // instantly — the attacker takes the city and any remaining garrison
      // (stacked units not yet fought) is destroyed. Without this, a
      // garrisoned city could never be taken: the attacker would just stand on
      // the tile after killing the defender and city combat would never run.
      const cityHere = this.getCityAt(defender.col, defender.row);
      if (cityHere && cityHere.civilizationId !== attacker.civilizationId) {
        const originalCiv = cityHere.civilizationId;
        const stillDefended = this.units.some(
          (u: Unit) => u.civilizationId === originalCiv
            && u.col === cityHere.col && u.row === cityHere.row
            && u.isDefeated !== true
            && u.id !== defender.id,
        );
        if (!stillDefended) {
          const captureResult = this.resolveCityCombat(attacker, cityHere);
          if (captureResult === 'captured' || captureResult === 'city_destroyed') {
            // Attacker survives city capture — spend its moves for this turn.
            attacker.movesRemaining = 0;
            attacker.hasMovedThisTurn = true;
            this.updateUnitTurnsDoneFlag(attacker);
            if (captureResult === 'captured' && this.onStateChange) {
              this.onStateChange('CITY_CAPTURED', {
                city: cityHere,
                capturedBy: attacker.civilizationId,
                originalCiv,
              });
            }
            return true;
          }
        }
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves('combat-win');
      
      return true;
    } else {
      // Defender wins - attacker is damaged or destroyed
      attacker.health -= 25;
      attacker.movesRemaining = 0;
      attacker.hasMovedThisTurn = true;

      // Update turn done status for attacker
      this.updateUnitTurnsDoneFlag(attacker);
      
      if (attacker.health <= 0) {
        // Mark attacker as defeated and delay removal (5 seconds to show black X)
        attacker.isDefeated = true;
        attacker.defeatTimestamp = Date.now();
        
        if (this.onStateChange) {
          this.onStateChange('UNIT_DEFEATED', { unit: attacker });
        }
        setTimeout(() => {
          this.units = this.units.filter(u => u.id !== attacker.id);

          // Sync the store so the defeated unit actually disappears.
          this.onStateChange?.('UNIT_REMOVED', { unit: attacker });

          // Phase 3.2: If a scout died, reassign zones
          if (attacker.type === 'scout') {
            this.onScoutDeath(attacker);
          }
        }, 1200);
      }
      
      if (this.onStateChange) {
        this.onStateChange('COMBAT_DEFEAT', {
          attacker,
          defender,
          attackerFromCol: attacker.col,
          attackerFromRow: attacker.row,
          attackerSurvived: attacker.health > 0,
          defenderSurvived: true,
        });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves('combat-defeat');
      
      return false;
    }
  }

  /**
   * Resolve an attack against an enemy city (native engine logic).
   * Returns 'captured' | 'hit' | 'city_destroyed' | 'defended'.
   * - The attacker's attack vs the city's defense (population, doubled with
   *   city walls). On success the attacker is removed and the city changes
   *   hands (or is destroyed if it had only 1 population).
   */
  private resolveCityCombat(attacker: Unit, city: City): 'captured' | 'hit' | 'city_destroyed' | 'defended' {
    // Find the garrison: living military units standing on the city tile.
    // Units inside a city die one by one — the garrison is fought
    // unit-by-unit, not all at once. The city only falls when the garrison
    // is empty AND the attacker wins the population-vs-attack roll.
    const garrison = this.units.filter(
      (u: Unit) => u.civilizationId === city.civilizationId
        && u.col === city.col && u.row === city.row
        && !u.isDefeated
        && u.id !== attacker.id,
    );

    // Attack 0 units (civilians) must have zero strength — `attack || 1` would
    // give a settler the same strength as a warrior and a 50/50 capture roll.
    const attackerStrength = (attacker.attack && attacker.attack > 0 ? attacker.attack : 0)
      * (attacker.health != null ? attacker.health / 100 : 1);

    // City defense: base = population. City walls TRIPLE the total defense
    // (Civ1) — but air units and siege artillery ignore the walls entirely.
    const hasWalls = (city.buildings?.includes?.('city_walls') ?? false)
      || (city.buildings?.includes?.('walls') ?? false);
    let defense = Math.max(1, city.population || 1);
    if (hasWalls && !this.unitIgnoresCityWalls(attacker)) {
      defense *= 3;
    }

    const total = attackerStrength + defense;
    const attackerWins = Math.random() * total < attackerStrength;

    // Spend the attacker's remaining movement either way.
    attacker.movesRemaining = 0;
    attacker.hasMovedThisTurn = true;
    this.updateUnitTurnsDoneFlag(attacker);

    if (attackerWins) {
      // No Stack death rule: city units die one by one ──
      // If the garrison has defenders, only ONE dies per combat round.
      // The attacker does not enter the city until the garrison is empty.
      if (garrison.length > 0) {
        const defender = garrison[0]; // Kill the first garrison unit
        defender.isDefeated = true;
        defender.defeatTimestamp = Date.now();
        if (this.onStateChange) {
          this.onStateChange('UNIT_DEFEATED', { unit: defender });
        }
        setTimeout(() => {
          this.units = this.units.filter(u => u.id !== defender.id);
          this.onStateChange?.('UNIT_REMOVED', { unit: defender });
          if (defender.type === 'scout') this.onScoutDeath(defender);
        }, 1200);
        console.log(`[COMBAT] ${attacker.type} defeated garrison ${defender.type} in ${city.name} (${garrison.length - 1} defenders remain)`);
        return 'hit'; // City damaged but not captured yet
      }

      // No garrison left — the city falls.
      const oldCiv = city.civilizationId;
      if ((city.population || 1) <= 1) {
        // City is razed rather than captured — every unit garrisoned on its
        // tile dies with it.
        const wasCapital = city.isCapital === true;
        this.destroyGarrisonOnCapture(city, oldCiv);
        this.cities = this.cities.filter(c => c.id !== city.id);
        console.log(`[COMBAT] City ${city.name} (civ ${oldCiv}) destroyed by ${attacker.type}`);
        if (wasCapital) {
          // Capital lost — the civ re-establishes a seat of government.
          this.governmentManager?.ensureCapital(oldCiv);
        }
        if (this.onStateChange) {
          this.onStateChange('CITY_DESTROYED', { city, attacker });
        }
        return 'city_destroyed';
      }

      // Population drop and capture.
      city.population -= 1;
      city.civilizationId = attacker.civilizationId;
      city.buildings = city.buildings ?? [];

      // A barbarian-captured city is auto-managed and produces military units
      // only (see AutoProduction). Barbarians become a real faction in the
      // game the moment they hold a city.
      if (attacker.civilizationId === BARBARIAN_CIV_ID) {
        city.barbarianScoutBuilt = false;
        city.autoProduction = true;
        this.ensureBarbarianCivilization();
      }

      // --- Civ1 capture aftermath ---
      // 1. Improvements are destroyed: city walls NEVER survive a capture, and
      //    one more random building is lost per point of population lost.
      this.destroyBuildingsOnCapture(city);
      // 2. The attacker plunders a share of the defender's treasury.
      this.plunderCityGold(oldCiv, attacker.civilizationId);
      // 3. The entire garrison on the tile is wiped out.
      this.destroyGarrisonOnCapture(city, oldCiv);
      // 4. Production is reset.
      city.currentProduction = null;
      if (Array.isArray(city.buildQueue)) city.buildQueue.length = 0;
      city.productionStored = 0;
      city.productionProgress = 0;
      // 5. Captured citizens are resentful — the city trends toward disorder
      //    for a few turns until garrisoned/managed.
      city.capturedTurns = 5;

      // A captured capital loses its Palace — the original civ must establish
      // a new seat of government (the new owner's capital is elsewhere).
      if (city.isCapital === true) {
        city.isCapital = false;
        const pIdx = city.buildings.indexOf('palace');
        if (pIdx !== -1) city.buildings.splice(pIdx, 1);
        this.governmentManager?.ensureCapital(oldCiv);
      }
      console.log(`[COMBAT] City ${city.name} captured by civ ${attacker.civilizationId} (pop ${city.population})`);
      return 'captured';
    }

    // Attacker defeated — damage or destroy it. A failed ground assault may
    // still cost the city a citizen UNLESS it has walls (Civ1: walls shield
    // the population from conventional ground attacks).
    attacker.health = Math.max(0, (attacker.health ?? 100) - 25);
    if (attacker.health <= 0) {
      attacker.isDefeated = true;
      attacker.defeatTimestamp = Date.now();
      if (this.onStateChange) {
        this.onStateChange('UNIT_DEFEATED', { unit: attacker });
      }
      setTimeout(() => {
        this.units = this.units.filter(u => u.id !== attacker.id);
        this.onStateChange?.('UNIT_REMOVED', { unit: attacker });
      }, 1200);
      console.log(`[COMBAT] ${attacker.type} destroyed attacking city ${city.name}`);
    }
    if (!hasWalls && (city.population || 1) > 1 && Math.random() < 0.5) {
      city.population -= 1;
      console.log(`[COMBAT] City ${city.name} lost a citizen to a failed attack (no city walls)`);
    }
    return 'defended';
  }

  /**
   * Civ1: air units (fighters/bombers) and siege artillery (cannon/artillery,
   * the local stand-ins for the Howitzer) ignore city walls entirely.
   */
  private unitIgnoresCityWalls(attacker: Unit): boolean {
    const type = String(attacker.type ?? '').toLowerCase();
    const props = UNIT_PROPS[type];
    if (props?.type === 'air') return true;
    return type === 'cannon' || type === 'artillery';
  }

  /**
   * Improvements destroyed when a city falls: city walls ALWAYS perish, plus
   * one random non-palace, non-wonder building per point of population lost
   * (capture costs exactly 1). Wonders and the palace survive.
   */
  private destroyBuildingsOnCapture(city: City): void {
    const buildings = Array.isArray(city.buildings) ? city.buildings : [];
    const wonders = new Set(Array.isArray(city.wonders) ? city.wonders : []);
    const removals: string[] = [];

    if (buildings.includes('city_walls') || buildings.includes('walls')) {
      removals.push('city_walls');
    }

    const candidates = buildings.filter(
      (b: string) => b !== 'city_walls' && b !== 'walls' && b !== 'palace' && !wonders.has(b),
    );
    if (candidates.length > 0) {
      removals.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    for (const removed of removals) {
      const idx = buildings.indexOf(removed);
      if (idx !== -1) buildings.splice(idx, 1);
    }
    const aliasIdx = buildings.indexOf('walls');
    if (aliasIdx !== -1) buildings.splice(aliasIdx, 1);
    if (removals.length > 0) {
      console.log(`[COMBAT] Capture destroyed improvements in ${city.name}: ${removals.join(', ')}`);
    }
  }

  /**
   * Plunder a share of the defender's treasury — the amount scales with the
   * civilization's treasury (Civ1), capped so a single city can't break the
   * game.
   */
  private plunderCityGold(oldCivId: number, newCivId: number): void {
    const oldCiv = this.civilizations?.[oldCivId];
    const newCiv = this.civilizations?.[newCivId];
    if (!oldCiv?.resources || !newCiv?.resources) return;
    const treasury = oldCiv.resources.gold ?? 0;
    if (treasury <= 0) return;
    const plunder = Math.min(Math.floor(treasury * 0.2), 100);
    oldCiv.resources.gold = treasury - plunder;
    newCiv.resources.gold = (newCiv.resources.gold ?? 0) + plunder;
    console.log(`[COMBAT] Plundered ${plunder} gold from civ ${oldCivId} to civ ${newCivId}`);
  }

  /**
   * Every unit of the old owner standing on the captured city's tile is
   * destroyed (Civ1: the garrison is wiped out when the city falls). Already
   * defeated units (e.g. the last defender killed in unit combat moments ago)
   * are left to their own removal to avoid double-removal/double-events.
   */
  private destroyGarrisonOnCapture(city: City, oldCivId: number): void {
    const killed = this.units.filter(
      (u: Unit) => u.civilizationId === oldCivId
        && u.col === city.col && u.row === city.row
        && u.isDefeated !== true,
    );
    for (const u of killed) {
      this.unitTurnQueue?.removeUnit?.(u.id);
      this.onStateChange?.('UNIT_DEFEATED', { unit: u });
      console.log(`[COMBAT] Garrison ${u.type} destroyed in captured city ${city.name}`);
    }
    if (killed.length > 0) {
      this.units = this.units.filter((u: Unit) => !killed.includes(u));
    }
  }

  /**
   * Civ1: city walls become obsolete once Metallurgy is discovered — they are
   * automatically scrapped in every city of this civilization.
   */
  scrapObsoleteCityWalls(civId: number): void {
    let scrapped = 0;
    for (const city of this.cities) {
      if (city.civilizationId !== civId) continue;
      if (!Array.isArray(city.buildings)) continue;
      const w = city.buildings.indexOf('city_walls');
      if (w !== -1) { city.buildings.splice(w, 1); scrapped += 1; continue; }
      const a = city.buildings.indexOf('walls');
      if (a !== -1) { city.buildings.splice(a, 1); scrapped += 1; }
    }
    if (scrapped > 0) {
      console.log(`[GameEngine] Metallurgy discovered — ${scrapped} city wall(s) scrapped for civ ${civId}`);
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

    // Civ1 tile overwrite: founding a city on a tile that still holds an
    // unvisited village consumes the village and evaluates the random roll
    // BEFORE the city is initialized — you can still hit a barbarian ambush
    // or get free gold/tech at the moment of founding. (A settler that walked
    // onto the hut already triggered it on entry, so this guard only fires in
    // edge cases such as a settler placed on a village tile.)
    if (tile.village) {
      this.resolveVillage(settler, tile);
      // The roll can spawn a barbarian ambush that kills the settler — if it
      // fell, abort founding (the settler is gone).
      if (!this.units.some((u) => u.id === settlerId)) return false;
    }

    // Civ1 uses the same build command to join an existing friendly city.
    const cityAtLocation = this.getCityAt(settler.col, settler.row);
    if (cityAtLocation) {
      if (cityAtLocation.civilizationId !== settler.civilizationId || cityAtLocation.population >= 10) {
        return false;
      }
      cityAtLocation.population += 1;
      cityAtLocation.foodNeeded = Math.max(20, cityAtLocation.population * 20);
      if (typeof cityAtLocation.hitPoints === 'number') {
        cityAtLocation.hitPoints = Math.min(cityAtLocation.population, cityAtLocation.hitPoints + 1);
      }
      settler.movesRemaining = 0;
      settler.hasMovedThisTurn = true;
      this.units = this.units.filter(u => u.id !== settlerId);
      this.unitTurnQueue?.removeUnit(settlerId);
      this.onStateChange?.('CITY_JOINED', { city: cityAtLocation, settler });
      this.checkAndEndTurnIfNoMoves('settler-joined-city');
      return true;
    }

    // Civ1 minimum city spacing (MIN_CITY_CENTER_DISTANCE) is enforced for AI
    // civilizations so they spread sensibly; the human player may found a
    // city directly adjacent to another one.
    const civIsAI = !!this.civilizations?.[settler.civilizationId]?.isAI;
    if (civIsAI) {
      for (const city of this.cities) {
        if (Math.max(Math.abs(settler.col - city.col), Math.abs(settler.row - city.row)) < MIN_CITY_CENTER_DISTANCE) {
          return false;
        }
      }
    }

    // Generate city name — sequential from the civ's city-name list (Civ1),
    // e.g. Berlin → Hamburg → Munich instead of "Germans City N".
    const civId = settler.civilizationId;
    const civ = this.civilizations[civId];
    const cityName = this.getNextCityName(civId);

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
      currentProduction: civ.isHuman
        ? { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }
        : this.pickInitialAIProduction(civId), // AI: scout for first city, defender otherwise
      buildQueue: [], // Empty: the Warrior is already the current production, never also queue it
      autoProduction: true // New cities default to Auto Production ON
    };

    this.cities.push(city);

    // First city (or a civ that lost its capital) becomes the seat of
    // government with a free Palace.
    const civCapitalRef = civ.capital;
    const capitalExists = civCapitalRef && this.cities.some(c => c.id === civCapitalRef.id);
    if (city.isCapital || !capitalExists) {
      this.governmentManager?.designateCapital(civId, city);
    }

    // Auto-production: line up follow-ups so the queue isn't empty right away.
    if (this.autoProduction && city.autoProduction) {
      this.autoProduction.ensureProductionQueue(city.id);
    }
    
    // Consume the settler's movement (founding a city costs one turn)
    settler.movesRemaining = 0;
    settler.hasMovedThisTurn = true;
    
    // Remove settler
    // NOT CHANGE THIS TO === THAN SETTLER NOT DISAPPEARS
    this.units = this.units.filter(u => u.id !== settlerId);

    // The settler is gone — remove it from the turn queue too, otherwise the
    // queue is never empty and auto-end-turn can never trigger.
    this.unitTurnQueue?.removeUnit(settlerId);

    // Log settler removal (effectively a movement off the map)
    console.log(`[SETTLER REMOVAL] ${settler.type} (${settlerId}) founded city "${cityName}" at (${settler.col},${settler.row}) and was removed from the map`);
    
    if (this.onStateChange) {
      this.onStateChange('CITY_FOUNDED', { city, settler });
    }

    // ── Settler rush capture: adjacent enemy settlers may steal the city ──
    // When a city is founded, any enemy settler standing on an adjacent tile
    // has a 50% chance to rush in and take it over — mirroring the scout
    // rush but with higher odds (the city is brand-new and completely
    // undefended). The capturing settler is consumed.
    this.checkSettlerRushCapture(city);

    // Check if turn should end automatically after founding city
    this.checkAndEndTurnIfNoMoves('city-founded');

    return true;
  }

  /**
   * After a city is founded, check if any enemy settler is adjacent. If so,
   * 50% chance the enemy settler rushes in and captures the brand-new city.
   * The capturing settler is consumed (removed from the map).
   */
  private checkSettlerRushCapture(city: City): void {
    if (!this.squareGrid) return;

    const neighbors = this.squareGrid.getNeighbors(city.col, city.row);
    for (const n of neighbors) {
      const unit = this.getUnitAt(n.col, n.row);
      if (!unit || unit.type !== 'settler' || unit.civilizationId === city.civilizationId) continue;

      // 50% chance to rush-capture
      if (Math.random() >= 0.50) {
        console.log(`[SETTLER RUSH] Enemy settler ${unit.id} (${unit.civilizationId}) adjacent to ${city.name} — rush failed (50% miss)`);
        continue;
      }

      // Rush succeeds — transfer the city
      const oldCiv = city.civilizationId;
      const capturingCiv = unit.civilizationId;
      console.log(`[SETTLER RUSH] Settler ${unit.id} (${capturingCiv}) rushes and captures ${city.name} from civ ${oldCiv}!`);

      city.civilizationId = capturingCiv;
      city.capturedTurns = 5;
      city.currentProduction = null;
      if (Array.isArray(city.buildQueue)) city.buildQueue.length = 0;
      city.productionStored = 0;
      city.productionProgress = 0;

      // A captured capital loses its Palace — original civ re-establishes.
      if (city.isCapital === true) {
        city.isCapital = false;
        const pIdx = (city.buildings ?? []).indexOf('palace');
        if (pIdx !== -1) city.buildings.splice(pIdx, 1);
        this.governmentManager?.ensureCapital(oldCiv);
      }

      // Consume the capturing settler — it "founded" the city.
      unit.movesRemaining = 0;
      this.units = this.units.filter(u => u.id !== unit.id);
      this.unitTurnQueue?.removeUnit(unit.id);

      if (this.onStateChange) {
        this.onStateChange('CITY_CAPTURED', {
          city,
          capturedBy: capturingCiv,
          originalCiv: oldCiv,
        });
      }
      break; // only one settler can rush per founding
    }
  }

  /**
   * Whether a settler could found a city on the tile it is standing on (land
   * tile, not too close to an existing city). Read-only — mirrors the checks
   * of `foundCityWithSettler`.
   */
  canFoundCity(settlerId: string): boolean {
    const settler = this.units.find((u) => u.id === settlerId);
    if (!settler || settler.type !== 'settler') return false;

    const tile = this.getTileAt(settler.col, settler.row);
    if (!tile || tile.type === Constants.TERRAIN.OCEAN) return false;

    // Minimum city spacing applies to AI civilizations only; the human player
    // may found a city directly adjacent to another one.
    const civIsAI = !!this.civilizations?.[settler.civilizationId]?.isAI;
    if (civIsAI) {
      for (const city of this.cities) {
        if (Math.max(Math.abs(settler.col - city.col), Math.abs(settler.row - city.row)) < MIN_CITY_CENTER_DISTANCE) {
          return false;
        }
      }
    }

    return true;
  }

  /** Whether the settler can use Build to add one citizen to its friendly city. */
  canJoinCity(settlerId: string): boolean {
    const settler = this.units.find((u) => u.id === settlerId);
    if (!settler || settler.type !== 'settler') return false;
    const city = this.getCityAt(settler.col, settler.row);
    return !!city && city.civilizationId === settler.civilizationId && city.population < 10;
  }

  /**
   * Check if current player has any units with moves remaining, and end turn if not
   * Only considers ACTIVE units (not sleeping or fortified) for auto-end turn
   */
  checkAndEndTurnIfNoMoves(reason = 'unknown') {
    const checkSeq = ++this.autoEndCheckCounter;
    console.log(`[TURN] ▶ checkAndEndTurnIfNoMoves #${checkSeq} (trigger: ${reason}, activePlayer: ${this.activePlayer})`);
    
    // Don't auto-end the turn while the game is paused — the player paused
    // because they want the action to stop, not to skip ahead.
    if (this.isPaused) {
      console.log('[TURN] ⏸️ Skipping auto-end check - game is paused');
      return;
    }
    
    // Don't trigger auto-end while GoTo paths are being processed
    if (this.roundManager?.isProcessingGoTo?.()) {
      console.log('[TURN] ⏸️ Skipping auto-end check - GoTo paths still being processed');
      return;
    }
    
    // Don't trigger auto-end while an AI turn is being processed — the AI's own
    // completion (runAIUnitMovementPhase) advances the phases. Auto-ending here
    // would start the NEXT player's turn mid-AI-turn, leaving a stale AI turn
    // running on the wrong player that freezes all unit movement.
    if (this.roundManager?.isAITurnInProgress?.()) {
      console.log('[TURN] ⏸️ Skipping auto-end check - AI turn in progress');
      return;
    }
    
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) {
      console.warn('[TURN] No civilization found for active player', this.activePlayer);
      return;
    }

    const playerUnits = this.units.filter(u => u.civilizationId === this.activePlayer);
    
    // Only count ACTIVE units that still have actions available. A unit is
    // considered done (and therefore does not block auto-end) when it has no
    // moves left, is sleeping, is fortified, was explicitly skipped, or has
    // already been flagged as turn-done.
    const activeUnitsWithMoves = playerUnits.filter(u => 
      (u.movesRemaining || 0) > 0 && 
      !u.isSleeping && 
      !u.isFortified && 
      !u.isSkipped && 
      !u.areTurnsDone
    );
    
    // Count inactive units (sleeping or fortified)
    const inactiveUnits = playerUnits.filter(u => u.isSleeping || u.isFortified);
    
    // Check if queue is empty (more reliable than counting units)
    const queueEmpty = this.unitTurnQueue ? this.unitTurnQueue.isQueueEmpty(this.activePlayer) : true;
    const queueLength = this.unitTurnQueue ? this.unitTurnQueue.getQueueLength(this.activePlayer) : 0;
    
    console.log(`[TURN] Player ${this.activePlayer} (${currentCiv.isHuman ? 'human' : 'AI'}): ${playerUnits.length} total units, ${activeUnitsWithMoves.length} active with moves, ${inactiveUnits.length} inactive (sleeping/fortified), queue: ${queueLength} units`);
    
    if (activeUnitsWithMoves.length > 0) {
      console.log('[TURN] Active units with moves:', activeUnitsWithMoves.map(u => ({
        id: u.id,
        type: u.type,
        pos: `(${u.col},${u.row})`,
        moves: u.movesRemaining
      })));
    }

    const hasActiveUnitsWithMoves = activeUnitsWithMoves.length > 0 || !queueEmpty;

    // A human player still has "stuff to build" when any MANUALLY-managed city
    // (Auto Production OFF) has a non-empty production queue — extra items the
    // player queued by hand, which they may want to review before ending the
    // turn. Cities with Auto Production ON are excluded: their queue is
    // auto-filled and there is nothing for the player to review, so an
    // auto-filled queue must NOT block auto-end-turn.
    const hasCitiesWithProductionQueued = this.cities.some(
      (c: City) => c.civilizationId === this.activePlayer
        && c.autoProduction !== true
        && Array.isArray(c.buildQueue)
        && c.buildQueue.length > 0
    );

    // For human players, check if auto turn ending should trigger
    if (currentCiv.isHuman) {
      // Only auto-end if NO active units have moves left AND queue is empty.
      // Sleeping/fortified/skipped units don't prevent auto-end. A player with
      // zero units (e.g. their last settler just founded a city) also auto-ends
      // — there is nothing left to do this turn — UNLESS a city still has
      // production queued to build this turn.
      if (!hasActiveUnitsWithMoves) {
        if (hasCitiesWithProductionQueued) {
          console.log('[TURN] ⏸️ Human player still has cities with production queued, not ending turn');
        } else {
          console.log('[TURN] All active human units have no moves and queue is empty - checking auto end turn setting');
          // Transparency: log which units the auto-end is skipping and remember
          // the summary for the post-end recap notification.
          const skipped = playerUnits
            .filter(u => (u.movesRemaining || 0) <= 0 || u.isSleeping || u.isFortified || u.isSkipped || u.areTurnsDone)
            .map(u => `${u.type}${u.isSleeping ? '(sleep)' : u.isFortified ? '(fort)' : u.isSkipped ? '(skip)' : ''}`);
          this.lastAutoEndSummary = skipped.length
            ? `${skipped.length} unit${skipped.length === 1 ? '' : 's'} skipped: ${skipped.join(', ')}`
            : 'No units with remaining actions';
          console.log(`[TURN] Auto-end summary — skipping turn, units skipped: ${skipped.length ? skipped.join(', ') : 'none'}`);
          if (this.onStateChange) {
            this.onStateChange('CHECK_AUTO_END_TURN', { civilizationId: this.activePlayer });
          }
        }
      } else if (hasActiveUnitsWithMoves) {
        console.log('[TURN] ⏸️ Human player still has active units with moves or queue not empty, not ending turn');
        
        // If queue has units, select the next one
        if (!queueEmpty && this.unitTurnQueue) {
          const currentQueueUnit = this.unitTurnQueue.getCurrentUnit(this.activePlayer);
          if (currentQueueUnit) {
            this.selectAndFocusUnit(currentQueueUnit);
          }
        }
      }
    } else {
      // For AI players: auto-end turn when queue is empty
      if (queueEmpty && !hasActiveUnitsWithMoves) {
        console.log('[TURN] 🤖 AI player queue is empty and no active units with moves - auto-ending turn');
        // Trigger AI turn end
        if (this.roundManager && typeof this.roundManager.nextPhase === 'function') {
          this.roundManager.nextPhase();
        }
      } else {
        console.log('[TURN] ⏸️ AI player still has active units with moves or queue not empty, continuing');
      }
    }
  }

  /**
   * Process end of turn for human player.
   * This properly advances through all remaining phases (CITY_PRODUCTION, RESEARCH, END)
   * before moving to the next player's turn.
   */
  processTurn() {
    console.log('[GameEngine] processTurn: Ending human turn via TurnManager.endHumanTurn()');

    if (this.isGameOver) {
      console.log('[GameEngine] processTurn: Ignored because the game has concluded');
      return;
    }

    if (this.isPaused) {
      console.log('[GameEngine] processTurn: Ignored because the game is paused');
      return;
    }
    
    // Delegate to TurnManager.endHumanTurn() which properly advances through all phases
    if (this.roundManager && typeof this.roundManager.endHumanTurn === 'function') {
      this.roundManager.endHumanTurn();
    } else {
      console.error('[GameEngine] processTurn: TurnManager not available or endHumanTurn method missing');
    }
  }

  /**
   * Calculate civilization's science output (rate-based via EconomicManager).
   */
  calculateCivScience(civId) {
    return this.economicManager?.civScience(civId) ?? 0;
  }

  /**
   * Calculate civilization's gold output (rate-based via EconomicManager).
   */
  calculateCivGold(civId) {
    return this.economicManager?.civGold(civId) ?? 0;
  }

  /**
   * Set the Tax/Science/Luxury rates for a civilization (sum always 100).
   */
  setRates(civId, tax, science, luxury) {
    this.economicManager?.setRates(civId, tax, science, luxury);
  }

  /**
   * Switch a civilization's government and re-apply rate caps/anarchy rules.
   */
  setGovernment(civId, government) {
    this.economicManager?.setGovernment(civId, government);
  }

  /**
   * Begin a revolution (anarchy for ANARCHY_TURNS) toward a new government.
   */
  startRevolution(civId, government) {
    return this.governmentManager?.startRevolution(civId, government) ?? false;
  }

  /**
   * Governments currently unlocked by a civ's researched technologies.
   */
  getAvailableGovernments(civ) {
    return this.governmentManager?.getAvailableGovernments(civ) ?? ['despotism'];
  }

  /**
   * Make a city the seat of government (moves the Palace, updates flags).
   */
  designateCapital(civId, city) {
    this.governmentManager?.designateCapital(civId, city);
  }

  /**
   * Ensure the civ has a capital (replaces one lost to capture/destruction).
   */
  ensureCapital(civId) {
    this.governmentManager?.ensureCapital(civId);
  }

  /**
   * Update technology availability based on prerequisites
   */
  updateTechnologyAvailability() {
    // Collect the union of all civilizations' researched techs so availability
    // unlocks correctly regardless of whose turn it is (the tree is shared
    // across civs and AI turns rotate).
    const researched = new Set<string>();
    for (const civ of this.civilizations) {
      for (const techId of civ.technologies ?? []) {
        researched.add(String(techId));
      }
    }

    this.technologies.forEach(tech => {
      // Mark techs any civ has completed as researched on the shared tree so
      // the UI (tech tree colors, research path, completion modal) stays in
      // sync when research finishes during a turn.
      if (researched.has(String(tech.id))) {
        tech.researched = true;
      }
      if (!tech.researched && !tech.available) {
        const prereqs = tech.prerequisites ?? [];
        const hasPrereqs = prereqs.length === 0 || prereqs.every(prereq => researched.has(prereq));
        if (hasPrereqs) {
          tech.available = true;
        }
      }
    });
  }

  /**
   * Set current research for civilization. `savedProgress` lets the UI restore
   * a tech's previously-saved progress when switching research (default 0).
   *
   * Each civilization researches independently (Civ1): the shared tree's
   * `researched` flag is the union across ALL civs and only drives UI
   * coloring — it must NOT gate what THIS civ can research. Otherwise a tech
   * the other civ discovered first would be silently rejected here while the
   * AI re-selected it every turn (research freeze).
   */
  setResearch(civId, techId, savedProgress = 0) {
    const civ = this.civilizations[civId];
    const tech = this.technologies.find(t => t.id === techId);

    if (civ && tech) {
      // Gate on THIS civ's own techs + prerequisites only.
      const civTechs = Array.isArray(civ.technologies) ? civ.technologies : [];
      const hasTech = (id: string): boolean => civTechs.includes(String(id));
      const prereqs = tech.prerequisites ?? [];
      const prereqsMet = prereqs.length === 0 || prereqs.every(hasTech);
      if (prereqsMet) {
        civ.currentResearch = tech;
        civ.researchProgress = savedProgress || 0;
      }
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

    // Reset subsystem state
    this.scoutMemory.clear();
    this.scoutMemory.setCurrentRound(0);
    this.diplomacyManager.reset();
    this.autoProduction?.reset?.();
    this.barbarianManager?.reset?.();
    this.roundManager?.reset?.();
    
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
    this.isPaused = false;
    this.victoryManager.reset();
    
    // Reset fog of war before reinitializing
    this.playerStorage.clear();
    if (actions?.resetFogOfWar) {
      actions.resetFogOfWar();
    }

    // Reset all game state arrays
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    this.currentTurn = 1;
    this.activePlayer = 0;

    // Reset subsystem state
    this.scoutMemory.clear();
    this.scoutMemory.setCurrentRound(0);
    this.diplomacyManager.reset();
    this.autoProduction?.reset?.();
    this.barbarianManager?.reset?.();
    this.roundManager?.reset?.();

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
      // The unit acted this turn — Minimum-1-Move no longer applies.
      unit.hasMovedThisTurn = true;

      // Mark unit as done in the queue and advance to next unit
      if (this.unitTurnQueue) {
        this.unitTurnQueue.unitDone(unit.civilizationId, unitId);
      }

      // Check if this was the last unit with moves, and end turn if so
      this.checkAndEndTurnIfNoMoves('unit-skipped');

      if (this.onStateChange) {
        this.onStateChange('UNIT_SKIPPED', { unit });
      }
    }

    return success;
  }

  /**
   * Make the current unit wait - move it to the end of the queue.
   * The unit keeps its turn later in this round.
   */
  waitUnit(unitId?: string): boolean {
    const civId = this.activePlayer;
    if (!this.unitTurnQueue) {
      console.warn('[GameEngine] waitUnit: No unit turn queue available');
      return false;
    }

    // Get the unit to wait (current queue unit or specified)
    const targetUnitId = unitId || this.unitTurnQueue.getCurrentUnitId(civId);
    if (!targetUnitId) {
      console.warn('[GameEngine] waitUnit: No unit to wait');
      return false;
    }

    const unit = this.units.find(u => u.id === targetUnitId);
    if (!unit) {
      console.warn(`[GameEngine] waitUnit: Unit ${targetUnitId} not found`);
      return false;
    }

    console.log(`[GameEngine] Unit ${targetUnitId} (${unit.type}) is waiting`);
    
    // Move unit to end of queue and advance to next unit
    const nextUnit = this.unitTurnQueue.waitUnit(civId);
    
    if (this.onStateChange) {
      this.onStateChange('UNIT_WAITING', { unit });
    }

    // Auto-select the next unit for human players
    const civ = this.civilizations[civId];
    if (civ?.isHuman && nextUnit) {
      this.selectAndFocusUnit(nextUnit);
    }

    return true;
  }

  /**
   * Advance to the next unit in the queue (for human players).
   * Called when manually cycling through units.
   */
  nextQueueUnit(): Unit | null {
    const civId = this.activePlayer;
    if (!this.unitTurnQueue) {
      return null;
    }

    const currentUnit = this.unitTurnQueue.getCurrentUnit(civId);
    if (currentUnit && (currentUnit.movesRemaining || 0) > 0) {
      // Current unit still has moves, use wait to move to next
      this.waitUnit(currentUnit.id);
    }

    return this.unitTurnQueue.getCurrentUnit(civId);
  }

  /**
   * Get the current unit in the turn queue for the active player.
   */
  getCurrentQueueUnit(): Unit | null {
    if (!this.unitTurnQueue) return null;
    return this.unitTurnQueue.getCurrentUnit(this.activePlayer);
  }

  /**
   * Get the current unit ID in the turn queue for the active player.
   */
  getCurrentQueueUnitId(): string | null {
    if (!this.unitTurnQueue) return null;
    return this.unitTurnQueue.getCurrentUnitId(this.activePlayer);
  }

  /**
   * Check if the unit queue is empty for the active player.
   */
  isQueueEmpty(): boolean {
    if (!this.unitTurnQueue) return true;
    return this.unitTurnQueue.isQueueEmpty(this.activePlayer);
  }

  /**
   * Get the number of units remaining in the queue.
   */
  getQueueLength(): number {
    if (!this.unitTurnQueue) return 0;
    return this.unitTurnQueue.getQueueLength(this.activePlayer);
  }

  /**
   * Select and focus on a unit (for queue transitions).
   */
  selectAndFocusUnit(unit: Unit): void {
    if (!unit) return;
    
    console.log(`[GameEngine] Selecting and focusing on unit ${unit.id} (${unit.type}) at (${unit.col}, ${unit.row})`);
    
    // Update store to select the unit
    if (this.storeActions) {
      this.storeActions.selectUnit(unit.id);
    }
    
    // Emit event for camera focus
    if (this.onStateChange) {
      this.onStateChange('FOCUS_UNIT', { unit });
    }
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

    // The unit acted this turn — Minimum-1-Move no longer applies.
    unit.hasMovedThisTurn = true;

    // Update turn done status
    this.updateUnitTurnsDoneFlag(unit);

    // Remove sleeping unit from turn queue and check if turn should auto-end
    if (this.unitTurnQueue) {
      this.unitTurnQueue.checkUnitStatus(unitId);
    }
    this.checkAndEndTurnIfNoMoves('unit-slept');

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

    // The unit acted this turn — Minimum-1-Move no longer applies.
    unit.hasMovedThisTurn = true;

    // Update turn done status
    this.updateUnitTurnsDoneFlag(unit);

    // Remove fortified unit from turn queue and check if turn should auto-end
    if (this.unitTurnQueue) {
      this.unitTurnQueue.checkUnitStatus(unitId);
    }
    this.checkAndEndTurnIfNoMoves('unit-fortified');

    if (this.onStateChange) {
      this.onStateChange('UNIT_FORTIFIED', { unit });
    }

    return true;
  }

  // ─── Diplomat unit actions ──────────────────────────────────────────

  /**
   * Initiate diplomacy with an adjacent enemy city or unit using a diplomat.
   * Returns the available actions for the UI to present.
   */
  getDiplomatActions(diplomatId: string): { targetCivId: number; actions: string[] } | null {
    const diplomat = this.units.find(u => u.id === diplomatId);
    if (!diplomat || diplomat.type !== 'diplomat') return null;
    if ((diplomat.movesRemaining || 0) <= 0) return null;

    // Find adjacent enemy unit or city
    const neighbors = this.squareGrid!.getNeighbors(diplomat.col, diplomat.row);
    for (const n of neighbors) {
      // Check for enemy city
      const city = this.getCityAt(n.col, n.row);
      if (city && city.civilizationId !== diplomat.civilizationId) {
        const status = this.diplomacyManager.getStatus(diplomat.civilizationId, city.civilizationId);
        const actions: string[] = ['gather_intelligence'];
        if (status === 'war') {
          actions.push('propose_ceasefire', 'propose_peace', 'demand_tribute');
        } else if (status === 'ceasefire') {
          actions.push('propose_peace');
        } else if (status === 'peace') {
          actions.push('propose_alliance', 'demand_tribute');
        }
        return { targetCivId: city.civilizationId, actions };
      }

      // Check for enemy unit
      const unit = this.getUnitAt(n.col, n.row);
      if (unit && unit.civilizationId !== diplomat.civilizationId) {
        const status = this.diplomacyManager.getStatus(diplomat.civilizationId, unit.civilizationId);
        const actions: string[] = ['gather_intelligence', 'bribe_unit'];
        if (status === 'war') {
          actions.push('propose_ceasefire', 'propose_peace');
        } else if (status === 'ceasefire') {
          actions.push('propose_peace');
        } else if (status === 'peace') {
          actions.push('propose_alliance');
        }
        return { targetCivId: unit.civilizationId, actions };
      }
    }

    return null;
  }

  /**
   * Execute a diplomat action. Consumes the diplomat's move.
   */
  executeDiplomatAction(diplomatId: string, action: string, targetCivId: number): { success: boolean; type?: string; report?: unknown; reason?: string; response?: unknown } {
    const diplomat = this.units.find(u => u.id === diplomatId);
    if (!diplomat || diplomat.type !== 'diplomat') return { success: false, reason: 'Not a diplomat' };
    if ((diplomat.movesRemaining || 0) <= 0) return { success: false, reason: 'No moves remaining' };

    let result: unknown;

    switch (action) {
      case 'gather_intelligence':
        result = this.diplomacyManager.gatherIntelligence(diplomat.civilizationId, targetCivId);
        diplomat.movesRemaining = 0;
        if (this.unitTurnQueue) this.unitTurnQueue.checkUnitStatus(diplomatId);
        if (this.activePlayer === diplomat.civilizationId) this.checkAndEndTurnIfNoMoves('diplomat-gather-intelligence');
        return { success: true, type: 'intelligence', report: result };

      case 'propose_peace':
      case 'propose_ceasefire':
      case 'propose_alliance':
      case 'demand_tribute':
        result = this.diplomacyManager.processProposal({
          fromCivId: diplomat.civilizationId,
          toCivId: targetCivId,
          action: action as DiplomatAction,
          goldAmount: action === 'demand_tribute' ? 50 : undefined,
        });
        diplomat.movesRemaining = 0;
        if (this.unitTurnQueue) this.unitTurnQueue.checkUnitStatus(diplomatId);
        if (this.activePlayer === diplomat.civilizationId) this.checkAndEndTurnIfNoMoves('diplomat-proposal');
        return { success: true, type: 'proposal', response: result };

      case 'bribe_unit': {
        // Find the adjacent enemy unit to bribe
        const neighbors = this.squareGrid!.getNeighbors(diplomat.col, diplomat.row);
        for (const n of neighbors) {
          const targetUnit = this.getUnitAt(n.col, n.row);
          if (targetUnit && targetUnit.civilizationId === targetCivId) {
            result = this.diplomacyManager.bribeUnit(diplomat.civilizationId, targetUnit.id);
            diplomat.movesRemaining = 0;
            // Diplomat is consumed after bribery attempt
            this.units = this.units.filter(u => u.id !== diplomatId);
            if (this.unitTurnQueue) this.unitTurnQueue.checkUnitStatus(diplomatId);
            if (this.activePlayer === diplomat.civilizationId) this.checkAndEndTurnIfNoMoves('diplomat-bribe');
            return { success: true, type: 'bribe', response: result };
          }
        }
        return { success: false, reason: 'No adjacent unit to bribe' };
      }

      default:
        return { success: false, reason: 'Unknown action' };
    }
  }

  /**
   * Start (or continue) building an improvement on the tile the settler stands
   * on. Civ I: construction takes a fixed number of worker-turns depending on
   * the improvement and the terrain; the settler stays on the tile and works
   * until the timer expires. Each call performs ONE turn of work and consumes
   * the settler's movement — the remaining turns are advanced by
   * `advanceUnitWork` at the start of each subsequent turn.
   */
  buildImprovement(unitId: string, improvementType: string): boolean {
    const type = GameEngine.canonicalImprovementType(improvementType);
    console.log(`[GameEngine] buildImprovement called: unitId=${unitId}, type=${type}`);

    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] Build: Unit ${unitId} not found`);
      return false;
    }

    // Feasibility (terrain construction-time table, tech prerequisites, river
    // bridge, irrigation water adjacency, upgrade prerequisite, existing
    // improvement). Read-only — mirrors canBuildImprovement.
    if (!this.canBuildImprovement(unitId, type)) {
      console.warn(`[GameEngine] Build: ${type} not feasible at (${unit.col},${unit.row})`);
      return false;
    }

    // Movement gating: the settler needs at least some movement to work the
    // turn (a working settler that already spent its turn cannot work again).
    const canPerform = UnitActionManager.canPerformAction(unit, 'build_improvement', 1);
    if (!canPerform) {
      console.warn(`[GameEngine] Build: Unit ${unit.id} cannot start work (no moves / fortified)`);
      return false;
    }

    const tile = this.getTileAt(unit.col, unit.row)!;
    const terrain = tile.terrain || tile.type || '';
    const requiredTurns = this.improvementBuildTurns(type, terrain);

    // Start work if not already working on this exact improvement; a settler
    // that is already working just spends another turn on the site. The turn
    // spent NOW is the first of the required worker-turns, so the remaining
    // count starts at requiredTurns - 1 (advanceUnitWork decrements the rest).
    if (unit.workTarget !== type) {
      unit.workTarget = type;
      unit.workTurns = requiredTurns - 1;
      console.log(`[GameEngine] Unit ${unit.id} starts ${type} on ${terrain} (${requiredTurns} worker-turns)`);
    } else {
      console.log(`[GameEngine] Unit ${unit.id} continues ${type} (${unit.workTurns} worker-turns left)`);
    }

    // The settler spends this turn working and cannot move.
    unit.movesRemaining = 0;
    unit.hasMovedThisTurn = true;
    this.updateUnitTurnsDoneFlag(unit);

    if (this.onStateChange) {
      this.onStateChange('IMPROVEMENT_WORK_STARTED', {
        unit, tile, improvementType: type, turns: unit.workTurns,
      });
    }

    if (this.unitTurnQueue) {
      this.unitTurnQueue.checkUnitStatus(unitId);
    }
    this.checkAndEndTurnIfNoMoves('improvement-work-started');
    return true;
  }

  /**
   * Map action-facing improvement ids to the canonical constant keys. The UI
   * and keyboard send 'mine' (singular) while TileImprovementConstants uses
   * 'mines'. Canonicalizing keeps terrain restrictions and stored ids correct.
   */
  private static canonicalImprovementType(type: string): string {
    return type === 'mine' ? IMPROVEMENT_TYPES.MINES : type;
  }

  /**
   * Whether a unit could currently build an improvement on the tile it is
   * standing on (terrain construction-time table, tech prerequisites, river
   * bridge, irrigation water adjacency, upgrade prerequisite, existing
   * improvement). Read-only — mirrors the feasibility checks of
   * `buildImprovement` without consuming movement. Movement is checked
   * separately via `hasMovesForImprovement`.
   */
  canBuildImprovement(unitId: string, improvementType: string): boolean {
    const type = GameEngine.canonicalImprovementType(improvementType);
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit || unit.type !== 'settler') return false;

    const tile = this.getTileAt(unit.col, unit.row);
    if (!tile) return false;

    const props = IMPROVEMENT_PROPERTIES[type];
    if (!props) return false;

    const terrain = tile.terrain || tile.type || '';

    // Civ1 construction-time table defines which terrains each improvement can
    // be built on (a missing per-terrain entry means "not buildable there").
    if (props.turnsByTerrain) {
      if (props.turnsByTerrain[terrain] === undefined) return false;
    } else if (props.terrainRestrictions && !props.terrainRestrictions.includes(terrain)) {
      return false;
    }

    // Tech prerequisites (railroad, fortress, bridge-building on rivers).
    if (props.requiredTech && !this.hasResearched(unit.civilizationId, props.requiredTech)) return false;
    if (props.riverBridgeRequired && terrain === TERRAIN_TYPES.RIVER) {
      if (!this.hasResearched(unit.civilizationId, BRIDGE_BUILDING_TECH)) return false;
    }

    // Civ1: irrigation requires fresh water (river/lake) or an already
    // irrigated tile orthogonally adjacent.
    if (type === IMPROVEMENT_TYPES.IRRIGATION) {
      if (!this.hasFreshWaterAdjacency(unit.col, unit.row)) return false;
    }

    // Terrain transformations (e.g. irrigate jungle -> grassland) are allowed
    // regardless of an existing road/railroad on the tile. Plain builds are
    // blocked by an existing improvement unless there is an upgrade path.
    const transformsTerrain = !!props.convertsToByTerrain && terrain in props.convertsToByTerrain;
    if (!transformsTerrain) {
      const requiredBase = (IMPROVEMENT_REQUIREMENTS as Record<string, string>)[type];
      if (requiredBase) {
        if (tile.improvement !== requiredBase) return false;
      } else if (tile.improvement) {
        return false;
      }
    }

    return true;
  }

  /**
   * Civ1 worker-turns required to build an improvement on a terrain type
   * (from the per-terrain construction-time table). Accepts both 'mine' and
   * 'mines' (the canonical constant key).
   */
  improvementBuildTurns(type: string, terrain: string): number {
    const canonical = GameEngine.canonicalImprovementType(type);
    const props = IMPROVEMENT_PROPERTIES[canonical];
    const perTerrain = props?.turnsByTerrain?.[terrain];
    if (perTerrain !== undefined) return perTerrain;
    return props?.turns || 1;
  }

  /**
   * Civ1 irrigation rule: a tile can only be irrigated when it is horizontally
   * or vertically adjacent to fresh water (a river or lake) or to another tile
   * that has already been irrigated.
   */
  private hasFreshWaterAdjacency(col: number, row: number): boolean {
    const directions = [
      { col: 0, row: -1 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: -1, row: 0 },
    ];
    for (const dir of directions) {
      const nc = col + dir.col;
      const nr = row + dir.row;
      if (!this.squareGrid?.isValidSquare(nc, nr)) continue;
      const tile = this.getTileAt(nc, nr);
      if (!tile) continue;
      const terrain = tile.terrain || tile.type || '';
      if (terrain === TERRAIN_TYPES.RIVER) return true;
      if (tile.improvement === IMPROVEMENT_TYPES.IRRIGATION) return true;
    }
    return false;
  }

  /**
   * Advance a settler's in-progress improvement by one worker-turn (called at
   * the start of the player's turn). Returns true when the improvement
   * completed this turn.
   */
  advanceUnitWork(unitId: string): boolean {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit || !unit.workTarget) return false;

    unit.workTurns = (unit.workTurns ?? 1) - 1;
    if (unit.workTurns <= 0) {
      this.completeImprovement(unit);
      return true;
    }

    // Still under construction — the settler stays on the site all turn.
    unit.movesRemaining = 0;
    this.updateUnitTurnsDoneFlag(unit);
    return false;
  }

  /**
   * Apply the finished improvement: terrain transformation (Civ1) or a plain
   * improvement placement. Clears the settler's work state.
   */
  private completeImprovement(unit: Unit): void {
    const type = unit.workTarget;
    const tile = this.getTileAt(unit.col, unit.row);
    unit.workTarget = null;
    unit.workTurns = 0;
    if (!tile) return;

    const props = IMPROVEMENT_PROPERTIES[type];
    const terrain = tile.terrain || tile.type || '';
    const convertedTo = props?.convertsToByTerrain?.[terrain];
    if (convertedTo) {
      this.convertTile(tile, convertedTo);
      console.log(`[GameEngine] Completed ${type} on ${terrain} -> ${convertedTo} at (${unit.col},${unit.row})`);
    } else {
      tile.improvement = type;
      console.log(`[GameEngine] Completed ${type} at (${unit.col},${unit.row})`);
    }

    if (this.onStateChange) {
      this.onStateChange('IMPROVEMENT_BUILT', { unit, tile, improvementType: type });
    }
  }

  /**
   * Whether a civilization has researched a technology. Falls back to the
   * shared tree's union flag when the civ has no tech list.
   */
  private hasResearched(civId: number, techId: string): boolean {
    const civ = this.civilizations?.find((c) => c.id === civId);
    if (civ && Array.isArray((civ as { technologies?: string[] }).technologies)) {
      return (civ as { technologies: string[] }).technologies.includes(techId);
    }
    const tech = this.technologies?.find((t) => t.id === techId);
    return !!tech?.researched;
  }

  /**
   * Transform a tile to a new terrain type, reassigning its special resource
   * per the Civ1 rule (the new terrain carries its own resource; grassland and
   * river have none). Road/railroad infrastructure is kept; other improvements
   * are removed (they cannot exist on the new terrain).
   */
  private convertTile(
    tile: { type?: string; terrain?: string; resource?: string | null; improvement?: string | null },
    toTerrain: string | undefined
  ): void {
    if (!toTerrain) return;
    const improvement = tile.improvement;
    tile.type = toTerrain;
    tile.terrain = toTerrain;
    tile.resource = TERRAIN_RESOURCES[toTerrain] ?? null;
    if (improvement && improvement !== IMPROVEMENT_TYPES.ROAD && improvement !== IMPROVEMENT_TYPES.RAILROAD) {
      tile.improvement = null;
    }
  }

  /**
   * Whether the unit can start/continue improvement work right now — it just
   * needs SOME movement (one worker-turn) and must not be fortified. Civ I:
   * construction spans multiple turns; each turn consumes the settler's move.
   */
  hasMovesForImprovement(unitId: string, _improvementType: string): boolean {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return false;
    return UnitActionManager.canPerformAction(unit, 'build_improvement', 1);
  }

  /**
   * Clean pollution from the tile the unit is standing on
   */
  cleanPollution(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] cleanPollution: Unit ${unitId} not found`);
      return false;
    }
    if (unit.type !== 'settler') return false;

    const canPerform = UnitActionManager.canPerformAction(unit, 'clean_pollution', 2);
    if (!canPerform) {
      return false;
    }

    const tile = this.getTileAt(unit.col, unit.row);
    if (!tile) {
      return false;
    }

    if (tile.improvement !== 'pollution') {
      console.warn(`[GameEngine] cleanPollution: No pollution at (${unit.col},${unit.row})`);
      return false;
    }

    tile.improvement = null;
    unit.movesRemaining = (unit.movesRemaining || 0) - 2;
    this.updateUnitTurnsDoneFlag(unit);

    console.log(`[GameEngine] Unit ${unit.id} cleaned pollution at (${unit.col},${unit.row})`);

    if (this.onStateChange) {
      this.onStateChange('POLLUTION_CLEANED', { unit, tile });
    }

    // Remove the worker from the turn queue if it spent all its moves, so the
    // queue can empty and auto-end-turn can trigger after cleaning.
    if (this.unitTurnQueue) {
      this.unitTurnQueue.checkUnitStatus(unitId);
    }

    this.checkAndEndTurnIfNoMoves('pollution-cleaned');
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

    // The attached unit is gone — remove it from the turn queue so the queue
    // can empty and auto-end-turn can trigger.
    this.unitTurnQueue?.removeUnit(unitId);
    
    // Phase 3.2: If a scout was disbanded, reassign zones
    if (unit.type === 'scout') {
      this.onScoutDeath(unit);
    }

    console.log(`[ATTACH] Unit ${unit.type} (${unitId}) attached to ${targetUnit.type} (${targetUnitId}) at (${targetUnit.col},${targetUnit.row}) and was deleted`);

    if (this.onStateChange) {
      this.onStateChange('UNIT_ATTACHED', { unit, targetUnit });
    }

    // Check if turn should end automatically
    this.checkAndEndTurnIfNoMoves('unit-attached');

    return true;
  }

  /**
   * Disband (permanently remove) a unit from the game
   */
  disbandUnit(unitId: string): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) {
      console.warn(`[GameEngine] disbandUnit: Unit ${unitId} not found`);
      return false;
    }

    // Only allow disbanding own units
    if (unit.civilizationId !== this.activePlayer) {
      console.warn(`[GameEngine] disbandUnit: Cannot disband enemy unit`);
      return false;
    }

    console.log(`[GameEngine] Disbanding unit ${unit.type} (${unitId}) at (${unit.col},${unit.row})`);

    // Remove from unit turn queue
    if (this.unitTurnQueue) {
      this.unitTurnQueue.unitDone(unit.civilizationId, unitId);
    }

    // Remove from units array
    this.units = this.units.filter(u => u.id !== unitId);

    // Handle scout death for AI zone reassignment
    if (unit.type === 'scout') {
      this.onScoutDeath(unit);
    }

    if (this.onStateChange) {
      this.onStateChange('UNIT_DISBANDED', { unit });
    }

    this.checkAndEndTurnIfNoMoves('unit-disbanded');
    return true;
  }

  /**
   * Rush production in a city by spending gold
   */
  rushCityProduction(cityId: string): boolean {
    const civ = this.civilizations[this.activePlayer];
    if (!civ?.isHuman) return false;

    const city = this.cities.find(c => c.id === cityId);
    if (!city || city.civilizationId !== this.activePlayer) {
      console.warn('[GameEngine] rushCityProduction: City not found or not owned');
      return false;
    }

    if (!city.currentProduction) {
      console.warn('[GameEngine] rushCityProduction: No production in progress');
      return false;
    }

    const totalCost = city.currentProduction.cost || 0;
    const stored = city.productionStored || city.productionProgress || 0;
    const remaining = Math.max(0, totalCost - stored);
    // Gold cost = 2x the remaining production shields
    const goldCost = remaining * 2;

    if (goldCost <= 0) {
      console.log('[GameEngine] rushCityProduction: Production already complete');
      return false;
    }

    const civResources = civ.resources || { gold: 0 };
    if ((civResources.gold || 0) < goldCost) {
      console.warn(`[GameEngine] rushCityProduction: Not enough gold (need ${goldCost}, have ${civResources.gold})`);
      return false;
    }

    // Deduct gold
    civResources.gold = (civResources.gold || 0) - goldCost;

    // Complete production
    city.productionStored = totalCost;
    if (city.productionProgress !== undefined) {
      city.productionProgress = totalCost;
    }

    console.log(`[GameEngine] Rushed production in ${city.name}: spent ${goldCost} gold`);

    if (this.onStateChange) {
      this.onStateChange('PRODUCTION_RUSHED', { city, goldCost });
    }

    return true;
  }

  /**
   * Cycle through units stacked on the same tile as the given unit
   */
  cycleUnitsInTile(unitId: string): string | null {
    const selectedUnit = this.units.find(u => u.id === unitId);
    if (!selectedUnit) return null;

    // Find all own units on the same tile
    const stackedUnits = this.units.filter(
      u => u.col === selectedUnit.col && u.row === selectedUnit.row
        && u.civilizationId === selectedUnit.civilizationId
    );

    if (stackedUnits.length <= 1) return null;

    // Find current index and pick next
    const currentIdx = stackedUnits.findIndex(u => u.id === unitId);
    const nextIdx = (currentIdx + 1) % stackedUnits.length;
    const nextUnit = stackedUnits[nextIdx];

    this.selectAndFocusUnit(nextUnit);
    console.log(`[GameEngine] Cycled to unit ${nextUnit.type} (${nextUnit.id})`);
    return nextUnit.id;
  }

  /**
   * Select a city by its index (0-based) among the current player's cities
   */
  selectCityByIndex(index: number): boolean {
    const playerCities = this.cities.filter(c => c.civilizationId === this.activePlayer);
    if (index < 0 || index >= playerCities.length) {
      return false;
    }

    const city = playerCities[index];
    if (this.storeActions) {
      this.storeActions.selectCity(city.id);
      this.storeActions.showDialog('city-details');
    }
    console.log(`[GameEngine] Selected city ${city.name} (index ${index})`);
    return true;
  }

  /**
   * Return the save game data as a JSON string (without side-effects).
   * Returns null if serialization fails.
   */
  /**
   * Serialize the entire game state to a JSON string.
   * Includes map, units, cities, civs, tech, diplomacy, scout memory,
   * player storage, and unit GoTo paths for full game restoration.
   */
  getSaveJSON(): string | null {
    try {
      // Serialize playerStorage (per-player visibility, explored, AI state)
      const playerStorageSerialized: Record<number, unknown> = {};
      for (const [civId, storage] of this.playerStorage.entries()) {
        playerStorageSerialized[civId] = {
          civilizationId: storage.civilizationId,
          visibility: Array.from(storage.visibility),
          explored: Array.from(storage.explored),
          lastKnownUnits: Array.from(storage.lastKnownUnits.entries()),
          lastKnownCities: Array.from(storage.lastKnownCities.entries()),
          enemyLocations: Array.from(storage.enemyLocations.entries()),
          scoutZones: storage.scoutZones.map(z => ({ ...z })),
          turnData: JSON.parse(JSON.stringify(storage.turnData))
        };
      }

      // Serialize scout memory discoveries
      const scoutDiscoveries: Record<number, unknown[]> = {};
      if (this.scoutMemory) {
        const allCivIds = this.civilizations.map(c => c.id);
        for (const civId of allCivIds) {
          const discoveries = this.scoutMemory.getDiscoveries(civId);
          if (discoveries.length > 0) {
            scoutDiscoveries[civId] = discoveries.map(d => ({ ...d }));
          }
        }
      }

      // Serialize diplomacy state
      const diplomacyRelations: Record<string, unknown>[] = [];
      const diplomacyEvents: Record<string, unknown>[] = [];
      if (this.diplomacyManager) {
        const rels = this.diplomacyManager.getAllRelations();
        for (const rel of rels) {
          diplomacyRelations.push({
            civA: rel.civA,
            civB: rel.civB,
            status: rel.status,
            since: rel.since,
            reputationModifier: rel.reputationModifier,
            treatiesBrokenByA: rel.treatiesBrokenByA,
            treatiesBrokenByB: rel.treatiesBrokenByB,
            activeTreaties: [...rel.activeTreaties],
            treatySince: { ...rel.treatySince },
            tradeGoldPerTurn: rel.tradeGoldPerTurn,
          });
        }
        const events = this.diplomacyManager.getEventLog();
        for (const evt of events) {
          diplomacyEvents.push({
            type: evt.type,
            fromCivId: evt.fromCivId,
            toCivId: evt.toCivId,
            details: evt.details,
            goldAmount: evt.goldAmount,
          });
        }
      }

      // Serialize unit GoTo paths from roundManager
      const unitPaths: Record<string, Array<{ col: number; row: number }>> = {};
      if (this.roundManager) {
        const allPaths = this.roundManager.getAllUnitPaths();
        for (const [unitId, path] of allPaths.entries()) {
          if (path.length > 0) {
            unitPaths[unitId] = path.map(p => ({ col: p.col, row: p.row }));
          }
        }
      }

      const saveData = {
        version: 2, // bumped from 1 to 2 with new fields
        timestamp: Date.now(),
        gameSettings: this.gameSettings,
        currentTurn: this.currentTurn,
        currentYear: this.currentYear,
        activePlayer: this.activePlayer,
        roundNumber: this.roundManager ? this.roundManager.getRoundNumber() : 0,
        map: this.map,
        units: this.units.map(u => ({ ...u })),
        cities: this.cities.map(c => ({ ...c })),
        civilizations: this.civilizations.map(c => ({ ...c })),
        technologies: this.technologies,
        // New fields for full state restoration
        playerStorage: playerStorageSerialized,
        scoutDiscoveries,
        diplomacyRelations,
        diplomacyEvents,
        unitPaths,
        scoutMemoryRound: this.scoutMemory ? this.scoutMemory.getCurrentRound() : 0,
      };
      return JSON.stringify(saveData);
    } catch (e) {
      console.error('[GameEngine] getSaveJSON failed:', e);
      return null;
    }
  }

  /**
   * Save game state to localStorage and trigger GAME_SAVED event.
   */
  saveGame(): boolean {
    try {
      const json = this.getSaveJSON();
      if (!json) return false;
      localStorage.setItem('civ1_savegame', json);
      console.log(`[GameEngine] Game saved (${(json.length / 1024).toFixed(1)} KB)`);

      if (this.onStateChange) {
        this.onStateChange('GAME_SAVED', { turn: this.currentTurn });
      }

      return true;
    } catch (e) {
      console.error('[GameEngine] Save failed:', e);
      return false;
    }
  }

  /**
   * Load game state from localStorage
   */
  async loadGame(): Promise<boolean> {
    try {
      const json = localStorage.getItem('civ1_savegame');
      if (!json) {
        console.warn('[GameEngine] No save game found');
        return false;
      }

      const saveData = JSON.parse(json);
      if (!saveData || (saveData.version !== 1 && saveData.version !== 2)) {
        console.warn('[GameEngine] Invalid or incompatible save data, version:', saveData?.version);
        return false;
      }

      // ── Full internal reset before loading ──
      // This prevents any old state from leaking into the loaded game
      this.isGameOver = true;
      this.isInitialized = false;
      this.map = null;
      this.units = [];
      this.cities = [];
      this.civilizations = [];
      this.technologies = [];
      this.squareGrid = null;

      // Reset all subsystems
      this.playerStorage.clear();
      this.scoutMemory.clear();
      this.diplomacyManager.reset();
      this.victoryManager.reset();
      this.victoryManager.syncStoreActions(this.storeActions);

      // ── Restore state from save ──
      this.gameSettings = saveData.gameSettings;
      this.currentTurn = saveData.currentTurn;
      this.currentYear = saveData.currentYear;
      this.activePlayer = saveData.activePlayer;
      this.map = saveData.map;
      this.units = saveData.units;
      this.cities = saveData.cities;
      this.civilizations = saveData.civilizations;
      this.technologies = saveData.technologies;
      this.isInitialized = true;
      this.isGameOver = false;

      // Recreate grid from saved map dimensions
      if (this.map) {
        this.squareGrid = new SquareGrid(this.map.width, this.map.height);
      }

      // ── Restore diplomacy state ──
      this.diplomacyManager.initialize(this.civilizations.map((c: Civilization) => c.id));
      if (saveData.version >= 2 && saveData.diplomacyRelations) {
        this.diplomacyManager.restoreRelations(saveData.diplomacyRelations);
      }
      if (saveData.version >= 2 && saveData.diplomacyEvents) {
        this.diplomacyManager.restoreEventLog(saveData.diplomacyEvents);
      }

      this.victoryManager.syncStoreActions(this.storeActions);

      // ── Restore player storage (per-player visibility, explored maps) ──
      if (saveData.version >= 2 && saveData.playerStorage) {
        for (const [civIdStr, stored] of Object.entries(saveData.playerStorage)) {
          const civId = Number(civIdStr);
          const storage = stored as {
            visibility?: boolean[];
            explored?: boolean[];
            lastKnownUnits?: Array<[string, Unit]>;
            lastKnownCities?: Array<[string, City]>;
            enemyLocations?: Array<[string, EnemyLocation[]]>;
            scoutZones?: Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }>;
            turnData?: unknown;
          };
          this.initializePlayerStorage(civId);
          const current = this.playerStorage.get(civId);
          if (current) {
            // Restore visibility/explored arrays
            if (Array.isArray(storage.visibility)) {
              for (let i = 0; i < storage.visibility.length; i++) {
                current.visibility[i] = storage.visibility[i];
              }
            }
            if (Array.isArray(storage.explored)) {
              for (let i = 0; i < storage.explored.length; i++) {
                current.explored[i] = storage.explored[i];
              }
            }
            // Restore last known units
            current.lastKnownUnits = new Map();
            if (Array.isArray(storage.lastKnownUnits)) {
              for (const [key, val] of storage.lastKnownUnits) {
                current.lastKnownUnits.set(key, val);
              }
            }
            // Restore last known cities
            current.lastKnownCities = new Map();
            if (Array.isArray(storage.lastKnownCities)) {
              for (const [key, val] of storage.lastKnownCities) {
                current.lastKnownCities.set(key, val);
              }
            }
            // Restore enemy locations
            current.enemyLocations = new Map();
            if (Array.isArray(storage.enemyLocations)) {
              for (const [key, val] of storage.enemyLocations) {
                current.enemyLocations.set(Number(key), val);
              }
            }
            // Restore scout zones
            current.scoutZones = Array.isArray(storage.scoutZones)
              ? storage.scoutZones.map((z: { minCol: number; maxCol: number; minRow: number; maxRow: number }) => ({ ...z }))
              : [];
            // Restore AI turn data
            current.turnData = storage.turnData
              ? JSON.parse(JSON.stringify(storage.turnData))
              : {};
          }
        }
      }

      // ── Restore scout memory discoveries ──
      if (saveData.version >= 2 && saveData.scoutDiscoveries) {
        // Restore round number first
        if (typeof saveData.scoutMemoryRound === 'number') {
          this.scoutMemory.setCurrentRound(saveData.scoutMemoryRound);
        }
        this.scoutMemory.restoreDiscoveries(saveData.scoutDiscoveries);
      }

      // ── Restore unit GoTo paths ──
      if (saveData.version >= 2 && saveData.unitPaths && this.roundManager) {
        for (const [unitId, path] of Object.entries(saveData.unitPaths)) {
          const typedPath = path as Array<{ col: number; row: number }>;
          if (typedPath.length > 0) {
            this.roundManager.setUnitPath(unitId, typedPath);
          }
        }
      }

      // ── Restore round number ──
      if (saveData.version >= 2 && typeof saveData.roundNumber === 'number') {
        // The round number is restored via the TurnManager
        // It will be set when advanceTurn recalculates
      }

      // ── Rebuild unit turn queue for the active player ──
      if (this.unitTurnQueue) {
        this.unitTurnQueue.initializeQueue(this.activePlayer);
        for (const unit of this.units) {
          if (unit.civilizationId === this.activePlayer) {
            this.unitTurnQueue.addUnit(unit.civilizationId, unit.id);
          }
        }
      }

      // ── Sync restored state to the Zustand store ──
      if (this.storeActions) {
        this.storeActions.clearGameResult?.();
        this.storeActions.updateMap(this.map);
        this.storeActions.updateUnits([...this.units]);
        this.storeActions.updateCities([...this.cities]);
        this.storeActions.updateCivilizations([...this.civilizations]);
        this.storeActions.updateTechnologies(this.technologies);
        this.storeActions.updateGameState({
          currentTurn: this.currentTurn,
          currentYear: this.currentYear,
          isLoading: false,
          gamePhase: 'playing',
          mapGenerated: true,
          selectedHex: null,
          selectedUnit: null,
          activeUnit: null,
          selectedCity: null,
          gameResult: null,
          winner: null,
        });
        this.storeActions.updateVisibility();
      }

      console.log(`[GameEngine] Game loaded — Turn ${this.currentTurn}, Year ${this.currentYear}`);

      if (this.onStateChange) {
        this.onStateChange('GAME_LOADED', { turn: this.currentTurn });
      }

      return true;
    } catch (e) {
      console.error('[GameEngine] Load failed:', e);
      return false;
    }
  }
}
