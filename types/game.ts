// Game types for Civ1Browser

export type VictoryReason = 'elimination' | 'moonshot' | 'domination';

/**
 * Civ1 specialist types. When a citizen is pulled off a tile they become one
 * of these, trading raw tile yields (Food/Shields/Trade) for city-specific
 * yields (Luxury/Gold/Science).
 */
export type SpecialistType = 'entertainer' | 'taxman' | 'scientist';

export interface EnemyLocation {
  col: number;
  row: number;
  type: 'unit' | 'city';
  id: string;
  discoveredRound: number;
  lastSeenRound: number;
}

export interface PlayerTurnStorage {
  civilizationId: number;
  visibility: boolean[];
  explored: boolean[];
  lastKnownUnits: Map<string, Unit>;
  lastKnownCities: Map<string, City>;
  enemyLocations: Map<number, EnemyLocation[]>;
  scoutZones: Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }>;
  turnData: Record<string, unknown>;
}

export class GameResult {
  outcome: 'victory' | 'defeat';
  civilizationId: number;
  civName: string;
  reason: VictoryReason;
  isHuman: boolean;
  timestamp: number;

  constructor(params: {
    outcome: 'victory' | 'defeat';
    civilizationId: number;
    civName: string;
    reason: VictoryReason;
    isHuman: boolean;
    timestamp?: number;
  }) {
    this.outcome = params.outcome;
    this.civilizationId = params.civilizationId;
    this.civName = params.civName;
    this.reason = params.reason;
    this.isHuman = params.isHuman;
    this.timestamp = params.timestamp ?? Date.now();
  }
}

export interface GameState {
  isLoading: boolean;
  isGameStarted: boolean;
  currentTurn: number;
  gamePhase: 'menu' | 'loading' | 'playing' | 'paused' | 'completed';
  selectedHex: { col: number; row: number } | null;
  selectedUnit: string | null;
  activeUnit: string | null;
  selectedCity: string | null;
  // The city the player last opened/selected (e.g. its details modal). Unlike
  // `selectedCity`, this marker is NOT cleared by transient selection changes
  // (selecting a unit, clicking a field, right-click, ESC), so the map keeps
  // the city highlighted until the turn ends or another city is chosen.
  focusedCity?: string | null;
  activePlayer: number;
  mapGenerated: boolean;
  winner: string | null;
  currentYear?: number;
  gameResult: GameResult | null;
}

export interface MapState {
  width: number;
  height: number;
  tiles: Tile[];
  // Fog-of-war arrays are only populated for some maps (the engine's MapData
  // mirrors this, so generated maps that don't fill them still type-check).
  visibility?: boolean[];
  revealed?: boolean[];
  getTile?(col: number, row: number): Tile | undefined;
  getUnitAt?(col: number, row: number): unknown;
  grid?: { getNeighbors(col: number, row: number): Array<{ col: number; row: number }> };
  unitManager?: { addUnit(unit: unknown): void; getUnit(id: string): unknown; removeUnit(id: string): boolean };
}

interface Tile {
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
  /** Legacy flags: some maps/saves set these alongside `improvement`. */
  hasRoad?: boolean;
  hasRiver?: boolean;
}

/** Outcome of a Civ1 village (goody hut) encounter. */
export type VillageOutcome =
  | 'advanced_tribe'
  | 'scroll_of_ancient_wisdom'
  | 'valuable_metals'
  | 'friendly_mercenaries'
  | 'barbarians'
  | 'destroyed';

/** Data shown by the village-result modal. */
export interface VillageResult {
  outcome: VillageOutcome;
  civId: number;
  col: number;
  row: number;
  cityName?: string;
  techId?: string;
  techName?: string;
  goldAmount?: number;
  unitType?: string;
  unitName?: string;
  barbarianCount?: number;
  /** True when an air or barbarian unit destroyed the village with no effect. */
  destroyed?: boolean;
}

/**
 * Data shown by the upkeep-disbanded modal: a unit was scrapped because the
 * treasury could not cover its upkeep (bankruptcy).
 */
export interface DisbandNotice {
  civId: number;
  unitType: string;
  unitName: string;
}

/**
 * A permanent Civ1 trade route connecting this city to another city.
 * Established when a Caravan delivers; adds per-turn trade to the city. A city
 * holds at most MAX_TRADE_ROUTES (3); a better new route replaces the weakest.
 */
export interface TradeRoute {
  /** Id of the OTHER city this route connects to. */
  cityId: string;
  /** Name of the other city. */
  cityName: string;
  /** Civilization of the other city. */
  civilizationId: number;
  /** Per-turn trade points this route adds to this city. */
  trade: number;
  /** Tile distance between the two cities. */
  distance: number;
  /** Round the route was established. */
  round?: number;
}

/** Shown after a Caravan establishes a trade route (lump-sum payout). */
export interface TradeRouteResult {
  homeCityName: string;
  destCityName: string;
  destCivId: number;
  gold: number;
  science: number;
  foreign: boolean;
  intercontinental: boolean;
  distance: number;
}

/**
 * An AI-initiated diplomatic proposal (ceasefire, peace, alliance, tribute)
 * awaiting the human player's accept/reject decision in the negotiation
 * screen. Surfaced via `showIncomingDiplomacyOffer`; cleared once the player
 * responds.
 */
export interface IncomingDiplomacyOffer {
  /** Civilization that made the offer. */
  fromCivId: number;
  /** Diplomatic action being proposed (e.g. 'propose_peace'). */
  action: string;
  /** Gold demanded/offered (tribute demands). */
  goldAmount?: number;
  /** Human-readable message describing the offer. */
  message?: string;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

/** A production item that can be queued in a city's build queue. */
export interface ProductionItem {
  // Production items are built dynamically throughout the codebase with a
  // `string` type value (often from a unit-type variable), so the field is
  // intentionally broad — the literal union was too strict and made every
  // un-annotated city literal fail to assign.
  type: string;
  itemType: string;
  name: string;
  cost: number;
  shields?: number;
}

export interface Unit {
  id: string;
  /** Position history for oscillation detection (AI units). */
  positionHistory?: [col: number, row: number][];
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  movesRemaining: number;
  health: number;
  /** Civ1 hit points; `health` is retained as the engine's combat percentage. */
  hitPoints?: number;
  maxHitPoints?: number;
  icon: string;
  status?: string;
  name?: string;
  isVeteran?: boolean;
  maxMoves?: number;
  movement?: number;
  /** Civ1: true once the unit has executed any movement or action this turn.
   *  Controls whether the "Minimum 1 Move" exception still applies. */
  hasMovedThisTurn?: boolean;
  attack?: number;
  defense?: number;
  maintenance?: number;
  orders?: { type: string; target?: { col: number; row: number } } | null;
  isFortified?: boolean;
  isSkipped?: boolean;
  isSleeping?: boolean;
  homeCityId?: string | null;
  /** Units without a home city (e.g. hut/start units or a last-city settler). */
  isNoneUnit?: boolean;
  foodSupport?: number;
  shieldSupport?: number;
  plannedPath?: { col: number; row: number }[];
  areTurnsDone?: boolean; // Set to true when unit has no moves left or is fortified/sleeping
  /** Civ1 multi-turn improvement construction: improvement being worked on. */
  workTarget?: string | null;
  /** Civ1 multi-turn improvement construction: worker-turns remaining. */
  workTurns?: number;
  /** Whether this unit has been defeated (killed) but still needs visual cleanup. */
  isDefeated?: boolean;
  /** When the unit was defeated (performance.now()), used to delay visual removal. */
  defeatTimestamp?: number;
  /** Whether this unit is a naval unit. */
  isNaval?: boolean;
  /** Unit sight range for fog of war. */
  sightRange?: number;
  // AI-specific runtime state (set dynamically by AIManager)
  _aiSettlement?: { col: number; row: number; score: number } | null;
  _blockedSettlementTargets?: Set<string>;
  _lastSettlementTarget?: { col: number; row: number };
  _positionHistory?: string[];
  _probeTarget?: { col: number; row: number };
  _exploreTarget?: { col: number; row: number };
  _exploreBearing?: { dx: number; dy: number };
  _blockedScoutTargets?: Set<string>;
  _aiCommittedTarget?: { target: { col: number; row: number }; round: number };
  /** Scout: found an enemy city — return to friendly city to report. */
  enemyFound?: boolean;
  /** Scout: coordinates of the last enemy discovered. */
  enemyLocation?: { col: number; row: number };
}

export interface City {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  hitPoints?: number;
  production: number;
  food: number;
  gold: number;
  science: number;
  // Per-turn economic outputs derived from the civ's Tax/Science/Luxury rates
  tax?: number;      // gold to treasury from this city's commerce
  luxury?: number;   // commerce spent on happiness
  scienceBonus?: number; // direct science bonus from buildings (e.g. library)
  // Happiness points (luxury + building effects). The legacy `foundCity` path
  // used an object form { happy, content, unhappy } — kept for compatibility.
  happiness?: number | { happy: number; content: number; unhappy: number };
  unhappiness?: number; // unhappiness points (population-based)
  disorder?: boolean;   // true when unhappiness > happiness (halts production/growth)
  capturedTurns?: number; // remaining turns of post-capture unrest (resentful citizens)
  // Current production progress (0..1 or absolute depending on implementation)
  productionProgress?: number;
  // Queue of production items (units/buildings)
  buildQueue?: ProductionItem[];
  // Currently active production item
  currentProduction?: ProductionItem | null;
  // Production carried over from previous completed item
  carriedOverProgress?: number;
  isCapital?: boolean;
  yields?: {
    food: number;
    production: number;
    trade: number;
  };
  foodStored?: number;
  foodNeeded?: number;
  foodRequired?: number;
  productionStored?: number;
  buildings?: string[];
  /** Built world-wonders (ids). */
  wonders?: string[];
  /** Whether the city was in disorder on the previous turn (transition tracking). */
  disorderLastTurn?: boolean;
  shields?: number;
  productionQueue?: ProductionItem[];
  autoProduction?: boolean; // When true, the engine auto-selects production for this city
  output?: { food: number; production: number; trade: number };
  processTurn?: (gameMap: MapState, turn: number) => void;
  /**
   * Specialists: citizens pulled off tiles that now generate fixed city yields
   * instead of tile yields. Each entry is one specialist citizen.
   * - 'entertainer': +2 Luxury (helps prevent disorder)
   * - 'taxman':      +2 Gold (straight to treasury)
   * - 'scientist':   +2 Science (toward current research)
   *
   * Invariant: `workingTiles.size + specialists.length === population`.
   */
  specialists?: SpecialistType[];
  /** Tile keys (e.g. "col,row") that citizens are currently working. */
  workingTiles?: Set<string>;
  /** Tile keys (e.g. "col,row") the player manually assigned. The auto-assign
   *  algorithm never overrides these, so manual assignments survive growth. */
  userAssignedTiles?: Set<string>;
  /** Items purchased this turn (queued for next turn creation). */
  purchasedThisTurn?: Array<{ type?: string; itemType?: string; name?: string; cost?: number }>;
  /** Whether barbarian scout has been built from this city. */
  barbarianScoutBuilt?: boolean;
  /** Method to queue production (if available on city instance). */
  queueProduction?: (item: ProductionItem) => void;
  /** Method to set production (if available on city instance). */
  setProduction?: (item: ProductionItem) => void;
  /** Set of unit IDs supported by this city (used by City.ts legacy class). */
  supportedUnitIds?: Set<string>;
  /** Permanent Civ1 trade routes (from delivered Caravans); max 3. */
  tradeRoutes?: TradeRoute[];
  /** Max population cap (used by City.ts legacy class). */
  maxPopulation?: number;
  /** Civilization object (used by City.ts legacy class). */
  civilization?: unknown;
  /** Trade output (used by City.ts legacy class). */
  trade?: number;
  /** Food storage amount (used by City.ts legacy class). */
  foodStorage?: number;
  /** Max food storage (used by City.ts legacy class). */
  maxFoodStorage?: number;
}

/**
 * Fixed per-civilization AI identity that drives production (and later
 * research). See CIV_PRODUCTION_PROFILES in src/game/engine/AITypes.ts.
 */
export type AIProductionProfile =
  | 'military_expansion'
  | 'science_focus'
  | 'balanced_growth'
  | 'defensive_turtle'
  | 'wonder_rush'
  | 'early_expansion';

export interface Civilization {
  id: number;
  name: string;
  color: string;
  isAlive: boolean;
  capital?: City | null; // Reference to the capital city
  resources: {
    food: number;
    production: number;
    trade: number;
    science: number;
    gold: number;
  };
  // Economic rates (percentages; taxRate + scienceRate + luxuryRate must equal 100)
  taxRate?: number;
  scienceRate?: number;
  luxuryRate?: number;
  government?: string;
  // Revolution: >0 means the civ is in anarchy, counting down each turn before
  // the pendingGovernment takes effect. 0/undefined means no revolution.
  revolutionTurns?: number;
  pendingGovernment?: string;
  /** Set of civilization ids this civ is currently at war with. */
  warWith?: Set<number>;
  leader?: string;
  leaderName?: string;
  cityNames?: string[];
  nextCityNameIndex?: number;
  currentResearch?: Technology | null;
  researchProgress?: number;
  technologies?: string[];
  score?: number;
  isHuman?: boolean;
  isAI?: boolean;
  /** Fixed per-civ AI identity — drives AutoProduction (and seeds research). */
  productionProfile?: AIProductionProfile;
  icon?: string;
  /** AI personality traits (optional, set by AI systems). */
  personality?: {
    aggression?: number;
    expansion?: number;
    science?: number;
    diplomacy?: number;
    military?: number;
    economy?: number;
  };
  /** AI priorities / strategy state (set by AI systems at runtime). */
  priorities?: Record<string, unknown>;
}

/**
 * A tile where one turn of a multi-turn movement preview ends.
 * Used to draw the turn number on the hovered destination path (Civ-style).
 */
export interface TurnMarker {
  col: number;
  row: number;
  /** 1-based turn number in which the unit reaches this tile. */
  turn: number;
}

/**
 * A movement-range preview for a unit (shown while hovering a unit or while a
 * unit is selected). Carries the unit type so the renderer can colour the
 * overlay correctly (land = blue, naval = red) without a second lookup.
 */
export interface MovementReachable {
  unitId: string;
  unitType: string;
  /** Reachable tiles within the current turn: "col,row" -> movement cost. */
  tiles: Map<string, number>;
}

export interface UIState {
  showMinimap: boolean;
  showUnitPanel: boolean;
  showCityPanel: boolean;
  showTechTree: boolean;
  showDiplomacy: boolean;
  showGameMenu: boolean;
  activeDialog: 'city' | 'tech' | 'diplomacy' | 'diplomacy-report' | 'game-menu' | 'help' | 'pause' | 'city-production' | 'city-purchase' | 'city-citizens' | 'city-details' | 'hex-details' | 'rates' | 'government' | 'statistics' | 'village' | 'upkeep-disbanded' | 'trade-route-result' | 'research-required' | null;
  sidebarCollapsed: boolean;
  notifications: Notification[];
  /** Active citizen pick-up origin ({cityId, col, row}) while reassigning. Null when idle. */
  citizenReassign: { cityId: string; col: number; row: number } | null;
  turnButtonDisabled: boolean;
  currentQueueUnitId: string | null; // Current unit in the turn queue (only this unit pulses)
  turnFlashTrigger: number; // Incremented on each turn start to trigger top-bar flash animation
}

interface Notification {
  id: number;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface Settings {
  uiScale: number;
  menuFontSize: number;
  sidebarWidth: number;
  minimapHeight: number;
  civListFontSize: number;
  skipEndTurnConfirmation: boolean;
  autoEndTurn: boolean; // Automatically end turn when all units are done
  devMode: boolean; // Developer mode: see all players on minimap and switch between them
  /** Master switch for all movement/combat/camera animations. When false, durations are 0 (instant). */
  enableAnimations: boolean;
  /** Animation speed multiplier (0..3). 0 = instant, 1 = normal, higher = slower. */
  animationSpeed: number;
  /** Camera glide speed multiplier (0..3). 0 = instant, 1 = normal, higher = slower. */
  cameraGlideSpeed: number;
}

export interface Technology {
  id: string;
  name: string;
  researched: boolean;
  researching?: boolean;
  available?: boolean;
  description?: string;
  cost?: number;
  prerequisites?: string[];
  /** Emoji/icon shown on research-complete notifications (fallback 🧪). */
  icon?: string;
}

export interface GameStoreState {
  gameState: GameState;
  map: MapState;
  camera: CameraState;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  uiState: UIState;
  settings: Settings;
  technologies: Technology[];
  /** Ordered tech ids the human player selected to research (the "path"). */
  researchPath: string[];
  /** Saved research progress per tech id (kept when switching research). */
  techProgress: Record<string, number>;
  /** Tech that just finished researching — drives the notification modal. */
  lastResearchedTech: Technology | null;
  actions: GameActions;
  currentPlayer: Civilization | null;
  playerResources: {
    food: number;
    production: number;
    trade: number;
    science: number;
    gold: number;
  };
  selectedUnit: Unit | null;
  selectedCity: City | null;
  playerUnits: Unit[];
  playerCities: City[];
  visibleTiles: { x: number; y: number }[];
  gameStats: {
    turn: number;
    totalCities: number;
    totalUnits: number;
    aliveCivilizations: number;
    gameStarted: boolean;
  };
  /** Active combat animations (cloud + unit hide/fade effects). */
  combatAnimations: CombatAnimation[];
  /** Active unit-movement glides (position interpolation between tiles). */
  movementAnimations: MovementAnimation[];
  /** True while a human-initiated move/attack animation is playing (blocks input & turn end). */
  isUnitAnimating: boolean;
  /** Requested camera pan target; consumed by the camera-pan effect in GameCanvas. */
  cameraPanRequest: CameraPanRequest | null;
  /** Last village (goody hut) outcome for the village-result modal. */
  villageResult: VillageResult | null;
  /** Info for the "unit disbanded to cover upkeep" modal. */
  disbandNotice: DisbandNotice | null;
  /** Info for the "trade route established" modal. */
  tradeRouteResult: TradeRouteResult | null;
  /** Civ auto-selected when the diplomacy screen opens (diplomat contact / AI offer). */
  diplomacyFocusCivId: number | null;
  /** Pending AI→player proposal awaiting a response in the diplomacy screen. */
  incomingDiplomacyOffer: IncomingDiplomacyOffer | null;
  // Internal state for preventing rapid focus calls
  _lastFocusCall?: number;
}

/**
 * A unit gliding from one tile to another during movement (or a combat lunge).
 * The renderer interpolates the drawn position from (fromCol,fromRow) to
 * (toCol,toRow) over `duration` ms starting at `startTime`.
 */
export interface MovementAnimation {
  id: string;
  unitId: string;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  /** performance.now() timestamp when the animation started. */
  startTime: number;
  /** Glide duration in ms. */
  duration: number;
}

/**
 * A request to smoothly pan the camera to a tile (consumed by GameCanvas).
 */
export interface CameraPanRequest {
  col: number;
  row: number;
  /** Keep the current zoom (true) or also animate zoom to a target (false). */
  keepZoom: boolean;
  /** Unique id so a newer request supersedes an older one. */
  requestId: string;
}

/**
 * A combat animation: during its window the two involved units are hidden and
 * a cloud emoji is drawn at the defender's tile; afterwards the surviving unit
 * fades back in and the destroyed unit stays hidden.
 */
export interface CombatAnimation {
  id: string;
  attackerId: string;
  defenderId: string;
  /** Attacker's tile at the moment combat started. */
  attackerCol: number;
  attackerRow: number;
  /** Defender's tile (where the cloud is drawn). */
  defenderCol: number;
  defenderRow: number;
  /** True when the attacker survived (won) the fight. */
  attackerSurvived: boolean;
  /** True when the defender survived the fight. */
  defenderSurvived: boolean;
  /** performance.now() timestamp when the animation started. */
  startTime: number;
  /** Cloud duration in ms (units stay visible, cloud blinks). */
  duration: number;
  /** How long the dead unit blinks after the cloud disappears (ms). */
  deathBlinkDuration: number;
  /** Whether this is a city attack (draws 💥 instead of 🫯). */
  cityAttack?: boolean;
  /** Attacker health (%) at combat start (for HP bar tween). */
  attackerHealthBefore?: number;
  /** Attacker health (%) after combat (for HP bar tween). */
  attackerHealthAfter?: number;
  /** Defender health (%) at combat start (for HP bar tween). */
  defenderHealthBefore?: number;
  /** Defender health (%) after combat (for HP bar tween). */
  defenderHealthAfter?: number;
  /** For city attacks: city id whose HP bar should tween. */
  cityId?: string;
  /** City HP at combat start (for city HP bar tween). */
  cityHealthBefore?: number;
  /** City HP after combat (for city HP bar tween). */
  cityHealthAfter?: number;
}

export interface GameActions {
  startGame: () => void;
  selectHex: (hex: { col: number; row: number }) => void;
  selectUnit: (unitId: string | null) => void;
  selectCity: (cityId: string | null) => void;
  nextTurn: () => void;
  focusOnNextUnit: () => void;
  updateCamera: (cameraUpdate: Partial<CameraState>) => void;
  toggleUI: (key: keyof UIState) => void;
  setCurrentQueueUnitId: (unitId: string | null) => void;
  showDialog: (dialog: UIState['activeDialog']) => void;
  hideDialog: () => void;
  /** Show the village (goody hut) result modal. */
  showVillageResult: (result: VillageResult) => void;
  /** Dismiss the village result modal. */
  clearVillageResult: () => void;
  /** Show the "unit disbanded to cover upkeep" modal. */
  showUpkeepDisbanded: (notice: DisbandNotice) => void;
  /** Dismiss the upkeep-disbanded modal. */
  clearUpkeepDisbanded: () => void;
  /** Show the "trade route established" modal (Caravan delivery). */
  showTradeRouteResult: (result: TradeRouteResult) => void;
  /** Dismiss the trade-route-result modal. */
  clearTradeRouteResult: () => void;
  /** Open the Civ I–style negotiation screen, optionally focused on a civ. */
  openDiplomacy: (focusCivId?: number | null) => void;
  /** Consume the diplomacy focus hint without changing the open dialog. */
  clearDiplomacyFocus: () => void;
  /** Surface an AI-initiated proposal and open the negotiation screen. */
  showIncomingDiplomacyOffer: (offer: IncomingDiplomacyOffer) => void;
  /** Dismiss the pending AI proposal (accepted or rejected). */
  clearIncomingDiplomacyOffer: () => void;
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: number) => void;
  /** Enter citizen pick-up mode (origin tile grabbed) or clear it when null. */
  setCitizenReassign: (origin: { cityId: string; col: number; row: number } | null) => void;
  /** Exit citizen pick-up mode (cancels the grab without changing any tile). */
  endCitizenReassign: () => void;
  setLoading: (isLoading: boolean) => void;
  updateMap: (mapUpdate: Partial<MapState>) => void;
  updateVisibility: () => void;
  revealArea: (centerCol: number, centerRow: number, radius: number) => void;
  updateUnits: (units: Unit[]) => void;
  updateCities: (cities: City[]) => void;
  updateCivilizations: (civilizations: Civilization[]) => void;
  updateTechnologies: (technologies: Technology[]) => void;
  setResearchPath: (path: string[]) => void;
  saveTechProgress: (techId: string, progress: number) => void;
  notifyTechResearched: (tech: Technology) => void;
  dismissTechNotification: () => void;
  updateGameState: (updates: Partial<GameState>) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  setGameResult: (result: GameResult | null) => void;
  clearGameResult: () => void;
  resetGameState: () => void;
  resetFogOfWar: () => void;
  setTurnButtonDisabled: (disabled: boolean) => void;
  incrementTurnFlash: () => void;
  addCombatAnimation: (animation: CombatAnimation) => void;
  removeCombatAnimation: (id: string) => void;
  addMovementAnimation: (animation: MovementAnimation) => void;
  removeMovementAnimation: (id: string) => void;
  clearMovementAnimations: () => void;
  setUnitAnimating: (isAnimating: boolean) => void;
  focusCameraOnTile: (col: number, row: number, keepZoom?: boolean) => void;
  clearCameraPanRequest: () => void;
}

export interface GameEngine {
  isInitialized: boolean;
  map: MapState | null;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  technologies: Technology[];
  onStateChange: ((eventType: string, eventData?: Record<string, unknown>) => void) | null;
  goToManager: { setUnitPath(unitId: string, path: Array<{ col: number; row: number }>): void; getUnitPath(unitId: string): Array<{ col: number; row: number }> | undefined; clearUnitPath(unitId: string): void; executePathWithAnimation?(unitId: string, delayMs: number): Promise<{ success: boolean; stepsCompleted: number }> } | null;
  /** Log a game event with category, message, and optional detail object. */
  log(category: string, message: string, detail?: Record<string, unknown>): void;
  newGame(): void;
  processTurn(): void;
  moveUnit(unitId: string, col: number, row: number): { success: boolean; reason?: string };
  canUnitMoveTo: (unitId: string, col: number, row: number) => boolean;
  /** End the current player's turn automatically if every unit is done/skipped. */
  checkAndEndTurnIfNoMoves(): void;
  foundCity(col: number, row: number, civilizationId: number, customName?: string | null): City | null;
  foundCityWithSettler(settlerId: string): boolean;
  setResearch(civId: number, techId: string, savedProgress?: number): void;
  /** Set Tax/Science/Luxury rates (sum always 100). */
  setRates(civId: number, tax: number, science: number, luxury: number): void;
  /** Switch a civilization's government and re-apply rate caps/anarchy rules. */
  setGovernment(civId: number, government: string): void;
  /** Begin a revolution (anarchy for several turns) toward a new government. */
  startRevolution(civId: number, government: string): boolean;
  /** Governments currently unlocked by a civ's researched technologies. */
  getAvailableGovernments(civ: Civilization): string[];
  /** Make a city the seat of government (moves the Palace, updates flags). */
  designateCapital(civId: number, city: City): void;
  /** Ensure the civ has a capital (replaces one lost to capture/destruction). */
  ensureCapital(civId: number): void;
  calculateCivScience(civId: number): number;
  calculateCivGold(civId: number): number;
  unitSleep(unitId: string): void;
  unitWake(unitId: string): void;
  unitFortify(unitId: string): void;
  skipUnit(unitId: string): void;
  buildImprovement(unitId: string, improvement: string): boolean;
  /** Whether a unit could build this improvement on its current tile (ignores moves). */
  canBuildImprovement(unitId: string, improvementType: string): boolean;
  /** Whether the unit can start/continue improvement work this turn (has moves, not fortified). */
  hasMovesForImprovement(unitId: string, improvementType: string): boolean;
  /** Civ1 worker-turns to build an improvement on a terrain type. */
  improvementBuildTurns(type: string, terrain: string): number;
  /** Advance an in-progress improvement by one worker-turn; true when completed. */
  advanceUnitWork(unitId: string): boolean;
  /** Whether a settler can found a city on its current tile. */
  canFoundCity(settlerId: string): boolean;
  cleanPollution(unitId: string): boolean;
  disbandUnit(unitId: string): boolean;
  rushCityProduction(cityId: string): boolean;
  cycleUnitsInTile(unitId: string): string | null;
  selectCityByIndex(index: number): boolean;
  saveGame(): boolean;
  getSaveJSON(): string | null;
  loadGame(): Promise<boolean>;
  getDiplomatActions(diplomatId: string): { targetCivId: number; actions: string[] } | null;
  executeDiplomatAction(diplomatId: string, action: string, targetCivId: number): { success: boolean; type?: string; report?: unknown; reason?: string; response?: unknown; message?: string };
  diplomacyManager: {
    getStatus(civA: number, civB: number): string;
    declareWar(attacker: number, defender: number): void;
    getEnemies(civId: number): number[];
    acceptOffer(proposal: { fromCivId: number; toCivId: number; action: string; goldAmount?: number }): { accepted: boolean; reason?: string; goldTransferred?: number };
    processProposal(proposal: { fromCivId: number; toCivId: number; action: string; gold?: number; [key: string]: unknown }): { accepted?: boolean; counterProposal?: { fromCivId: number; toCivId: number; action: string; goldAmount?: number }; reason?: string; goldTransferred?: number };
    cancelTreaty(civA: number, civB: number, treaty: string): void;
    getAttitude(civA: number, civB: number): string;
    getRelation(civA: number, civB: number): { status: string; reputationModifier?: number; since?: number; treatiesBrokenByA?: number; treatiesBrokenByB?: number };
    getActiveTreaties(civA: number, civB: number): string[];
    getEventLog(): Array<{ type: string; fromCivId: number; toCivId: number; goldAmount?: number; details?: string }>;
    estimateMilitaryStrength(civId: number): number;
    isAtWar(civA: number, civB: number): boolean;
    processAIDiplomacy(civId: number): void;
    presentOffer(fromCivId: number, toCivId: number, action: string, gold: number, message: string): void;
    reset(): void;
    processTurn(roundNumber: number): void;
  };
  /** Auto-production manager for AI/human city queues. */
  autoProduction: { processAutoProductionForCivilization(civId: number): void };
  /** Production manager for city build queues. */
  productionManager: { setCityProduction(cityId: string, item: ProductionItem, queue?: boolean): { success: boolean; reason?: string; city?: City }; purchaseCityProduction(cityId: string, item: ProductionItem, civId?: number): { success: boolean; reason?: string }; removeCurrentProduction(cityId: string): { success: boolean; reason?: string; removed?: ProductionItem }; removeCityQueueItem(cityId: string, index: number): { success: boolean; reason?: string; removed?: ProductionItem }; moveCityQueueItem(cityId: string, fromIndex: number, toIndex: number): { success: boolean; reason?: string; moved?: ProductionItem } };
  /** Economic manager for tax/science/luxury rates and upkeep. */
  economicManager: { setGovernment(civId: number, government: string): void; calculateCityTrade?(city: City): number; processTurn?(civ: Civilization): { upkeep: number; deficit: number; disbanded: number }; recomputeCityYields?(city: City): void; applyCityOutputs?(city: City, civ: Civilization): void; totalUpkeep?(civId: number): number };
  /** Civ I–style research manager (tech cost, beaker modifiers, turn caps). */
  researchManager: { processTurn(): void; effectiveTechCost?(civ: Civilization, techId: string | Technology): number; estimatedTurns?(civ: Civilization, techId: string | Technology, perTurnScience: number): number; advanceResearch?(civ: Civilization, techId: string, totalScience: number): string | null };
  /** Per-civilization persistent turn storage (AI state, explored tiles…). */
  getPlayerStorage(civilizationId: number): PlayerTurnStorage;
  /** Square grid backing the map (null until a game is initialized). */
  squareGrid: {
    isValidSquare(col: number, row: number): boolean;
    squareDistance(col1: number, row1: number, col2: number, row2: number): number;
    findPath(fromCol: number, fromRow: number, toCol: number, toRow: number, obstacles?: Set<string>, passabilityFn?: (col: number, row: number) => boolean): Array<{ col: number; row: number }>;
    getNeighbors(col: number, row: number): Array<{ col: number; row: number }>;
  } | null;
  /** Get the map tile at a grid position (null when out of bounds). */
  getTileAt(col: number, row: number): Tile | null;
  /** Get the unit at a grid position (null if empty). */
  getUnitAt(col: number, row: number): Unit | null;
  /** Get the city at a grid position (null if empty). */
  getCityAt(col: number, row: number): City | null;
  /** Whether a tile has been permanently explored by a player. */
  isExploredByPlayer(civId: number, col: number, row: number): boolean;
  /** Whether a tile is currently visible (in fog of war) for a player. */
  isVisibleToPlayer(civId: number, col: number, row: number): boolean;
  /** Whether a tile is passable by ground units. */
  isTilePassable(col: number, row: number): boolean;
  /** Returns a passability filter function for pathfinding. */
  getPassabilityFilter(): (col: number, row: number) => boolean;
  /** Resolve combat between two units. */
  combatUnit(attacker: Unit, defender: Unit): void;
  /** Whether a unit can afford to move (enough movement points). */
  canUnitAffordMove(unit: Unit, moveCost: number): boolean;
  /** Whether a settler can join an adjacent city. */
  canJoinCity(unitId: string): boolean;
  /** Async sleep for AI delays. */
  sleep(ms: number): Promise<void>;
  /** Measure execution time of a function (debug). */
  measurePerformance<T>(label: string, fn: () => T): T;
  /** Record an enemy location for AI intelligence. */
  recordEnemyLocation(civId: number, enemy: EnemyLocation): void;
  /** Assign exploration zones to scouts. */
  assignScoutZones(civId: number): void;
  /** Check if a tile is within a scout's assigned zone. */
  isInScoutZone(civId: number, scoutIdx: number, col: number, row: number): boolean;
  /** Turn/phase manager. */
  roundManager: { setUnitPath(unitId: string, path: Array<{ col: number; row: number }>): void; getPhase(): string; getCurrentPlayer(): number | null; getRoundNumber(): number; isAITurnInProgress(): boolean; clearUnitPath(unitId: string): void; getAllUnitPaths(): Map<string, Array<{ col: number; row: number }>> };
  /** Current in-game year (negative = BC). */
  currentYear: number;
  /** Current game settings (difficulty, map type, civilizations…). */
  gameSettings: { difficulty: string; mapType: string; numberOfCivilizations: number; playerCivilization: number; startingYear: number; startingGold: number };
  /** Remove the active production item from a city. */
  removeCurrentProduction(cityId: string): void;
  getAllUnits(): Unit[];
  getAllCities(): City[];
  restartCurrentGame(): Promise<void>;
  shutdownToMenu(): void;
  isGameOver: boolean;
  /** Toggle auto-production for a city. */
  toggleAutoProduction?(cityId: string, enabled: boolean): boolean;
  /** Purchase city production. */
  purchaseCityProduction?(cityId: string, item: ProductionItem): { success: boolean; reason?: string };
  /** Active player index. */
  activePlayer: number;
  /** Store actions for UI updates. */
  storeActions: GameActions | null;
  /** Whether the game is paused. */
  isPaused?: boolean;
  /** Current game turn number. */
  currentTurn?: number;
  /** Unit turn queue for managing unit order. */
  unitTurnQueue?: { initializeQueue(civId: number): void; clearQueue(civId: number): void };
  /** Scout memory for persistence across turns. */
  scoutMemory?: { setCurrentRound(round: number): void; getNearestStaleTarget?(fromCol: number, fromRow: number, seekerCivId: number, maxAge?: number): EnemyLocation | null };
  /** Barbarian manager for aggressive AI. */
  barbarianManager?: { processBarbarians(): void };
  /** Victory manager for end-game detection. */
  victoryManager?: { evaluateEndOfTurn(): boolean };
  /** Government manager for revolution and capital. */
  governmentManager?: { processTurn(civ: Civilization): void; ensureCapital?(civId: number): void; designateCapital?(civId: number, city: City): void; isInRevolution(civ: Civilization): boolean; bestGovernmentForCiv(civ: Civilization): string | null };
  /** Called when a scout is created. */
  onScoutCreated?(unit: Unit): void;
  /** Process AI turn for a civilization. */
  processAITurn?(civilizationId: number): Promise<void>;
  /** Scrap obsolete city walls when metallurgy is discovered. */
  scrapObsoleteCityWalls?(civId: number): void;
  /** Update technology availability based on researched techs. */
  updateTechnologyAvailability?(): void;
}
