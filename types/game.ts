// Game types for Civ1Browser

export interface GameState {
  isLoading: boolean;
  isGameStarted: boolean;
  currentTurn: number;
  gamePhase: 'menu' | 'loading' | 'playing' | 'paused';
  selectedHex: { col: number; row: number } | null;
  selectedUnit: string | null;
  activeUnit: string | null;
  selectedCity: string | null;
  activePlayer: number;
  mapGenerated: boolean;
  winner: string | null;
  currentYear?: number;
}

export interface MapState {
  width: number;
  height: number;
  tiles: Tile[];
  visibility: boolean[];
  revealed: boolean[];
}

export interface Tile {
  terrain: string;
  resource?: string;
  improvement?: string;
  visible: boolean;
  explored: boolean;
  col: number;
  row: number;
  type?: string;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

export interface Unit {
  id: string;
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  movesRemaining: number;
  health: number;
  icon: string;
  status?: string;
  name?: string;
  isVeteran?: boolean;
  maxMoves?: number;
  attack?: number;
  defense?: number;
  orders?: any;
  isFortified?: boolean;
  isSkipped?: boolean;
  isSleeping?: boolean;
}

export interface City {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  production: number;
  food: number;
  gold: number;
  science: number;
  // Current production progress (0..1 or absolute depending on implementation)
  productionProgress?: number;
  // Queue of production items (units/buildings)
  buildQueue?: Array<any>;
  // Currently active production item
  currentProduction?: any | null;
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
  buildings?: any[];
  shields?: number;
  productionQueue?: any[];
  output?: any;
  processTurn?: (gameMap: any, turn: number) => void;
}

export interface Civilization {
  id: number;
  name: string;
  color: string;
  isAlive: boolean;
  capital?: any; // Reference to the capital city
  resources: {
    food: number;
    production: number;
    trade: number;
    science: number;
    gold: number;
  };
  leader?: string;
  cityNames?: string[];
  nextCityNameIndex?: number;
  currentResearch?: any;
  researchProgress?: number;
  technologies?: any[];
  score?: number;
  isHuman?: boolean;
}

export interface UIState {
  showMinimap: boolean;
  showUnitPanel: boolean;
  showCityPanel: boolean;
  showTechTree: boolean;
  showDiplomacy: boolean;
  showGameMenu: boolean;
  activeDialog: 'city' | 'tech' | 'diplomacy' | 'game-menu' | 'help' | 'city-production' | 'city-purchase' | 'city-citizens' | 'city-details' | 'hex-details' | null;
  sidebarCollapsed: boolean;
  notifications: Notification[];
}

export interface Notification {
  id: number;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface Settings {
  uiScale: number;
  menuFontSize: number;
  sidebarWidth: number;
  minimapHeight: number;
  civListFontSize: number;
  skipEndTurnConfirmation: boolean;
}

export interface Technology {
  id: string;
  name: string;
  researched: boolean;
  researching: boolean;
  available?: boolean;
  description?: string;
  cost?: number;
  prerequisites?: string[];
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
  // Internal state for preventing rapid focus calls
  _lastFocusCall?: number;
}

export interface GameActions {
  startGame: () => void;
  selectHex: (hex: { col: number; row: number }) => void;
  selectUnit: (unitId: string) => void;
  selectCity: (cityId: string) => void;
  nextTurn: () => void;
  focusOnNextUnit: () => void;
  updateCamera: (cameraUpdate: Partial<CameraState>) => void;
  toggleUI: (key: keyof UIState) => void;
  showDialog: (dialog: UIState['activeDialog']) => void;
  hideDialog: () => void;
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: number) => void;
  setLoading: (isLoading: boolean) => void;
  updateMap: (mapUpdate: Partial<MapState>) => void;
  updateVisibility: () => void;
  revealArea: (centerCol: number, centerRow: number, radius: number) => void;
  updateUnits: (units: Unit[]) => void;
  updateCities: (cities: City[]) => void;
  updateCivilizations: (civilizations: Civilization[]) => void;
  updateTechnologies: (technologies: Technology[]) => void;
  updateGameState: (updates: Partial<GameState>) => void;
  updateSettings: (updates: Partial<Settings>) => void;
}

export interface GameEngine {
  isInitialized: boolean;
  map: any; // TODO: type properly
  units: Unit[];
  civilizations: Civilization[];
  technologies: Technology[];
  onStateChange: ((eventType: string, eventData: any) => void) | null;
  newGame(): void;
  processTurn(): void;
  moveUnit(unitId: string, col: number, row: number): { success: boolean; reason?: string };
  foundCity(col: number, row: number, civilizationId: number, customName?: string | null): any;
  foundCityWithSettler(settlerId: string): boolean;
  setResearch(civId: number, techId: string): void;
  unitSleep(unitId: string): void;
  unitWake(unitId: string): void;
  unitFortify(unitId: string): void;
  skipUnit(unitId: string): void;
  buildImprovement(unitId: string, improvement: string): void;
  getAllUnits(): Unit[];
  getAllCities(): City[];
}