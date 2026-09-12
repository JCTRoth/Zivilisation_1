/// <reference types="vite/client" />

import { create } from 'zustand';
import { Constants } from '../utils/Constants';
import { SquareGrid } from '../game/HexGrid';
import { UNIT_TYPES } from '../data/GameData';
import { UNIT_PROPERTIES } from '../data/UnitConstants';
import type { GameStoreState, GameState, MapState, CameraState, UIState, GameResult } from '../../types/game';

// Internal store property types for cached/computed state
type StoreWithInternals = GameStoreState & {
  _cachedPlayerResources: { food: number; production: number; trade: number; science: number; gold: number };
  _cachedGameStats: { turn: number; totalCities: number; totalUnits: number; aliveCivilizations: number; gameStarted: boolean };
};
/** Shape of each entry in UNIT_DATA_MAP / UNIT_TYPES */
type UnitTypeDef = {
  id: string;
  name: string;
  cost: number;
  attack: number;
  defense: number;
  movement: number;
  sightRange?: number;
  icon: string;
  requires?: string | null;
  description?: string;
};

const createInitialGameState = (): GameState => ({
  isLoading: false,
  isGameStarted: false,
  currentTurn: 1,
  gamePhase: 'menu',
  selectedHex: null,
  selectedUnit: null,
  activeUnit: null,
  selectedCity: null,
  focusedCity: null,
  activePlayer: 0,
  mapGenerated: false,
  winner: null,
  currentYear: -4000,
  gameResult: null
});

const createInitialMapState = (): MapState => ({
  width: Constants.MAP_WIDTH,
  height: Constants.MAP_HEIGHT,
  tiles: [],
  visibility: [],
  revealed: []
});

const createInitialCameraState = (): CameraState => ({
  x: 0,
  y: 0,
  zoom: 2.0,
  minZoom: 0.5,
  maxZoom: 3.0
});

const createInitialUIState = (): UIState => ({
  showMinimap: true,
  showUnitPanel: false,
  showCityPanel: false,
  showTechTree: false,
  showDiplomacy: false,
  showGameMenu: false,
  activeDialog: null,
  // The info panel is a slide-in drawer on phones (starts closed so the map
  // is immediately visible) and a static sidebar on desktop (starts open).
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 992 : true,
  notifications: [],
  // Active citizen pick-up ("1 citizen selected for reassignment"). Null when idle.
  citizenReassign: null,
  turnButtonDisabled: false,
  currentQueueUnitId: null,
  turnFlashTrigger: 0
});

// Helper function for visibility calculations
const setVisibilityAreaInternal = (visibility, revealed, centerCol, centerRow, radius, mapWidth, mapHeight) => {
  const squareGrid = new SquareGrid(mapWidth, mapHeight);

  for (let row = centerRow - radius; row <= centerRow + radius; row++) {
    for (let col = centerCol - radius; col <= centerCol + radius; col++) {
      if (row >= 0 && row < mapHeight && col >= 0 && col < mapWidth) {
        const index = row * mapWidth + col;
        if (squareGrid.squareDistance(centerCol, centerRow, col, row) <= radius) {
          visibility[index] = true;
          // Also mark as explored when first seen
          revealed[index] = true;
        }
      }
    }
  }
};

// The human player is always civilization 0. The UI's fog of war
// (map.visibility) reflects this player's perspective, and the camera may only
// follow units the human can actually see.
const HUMAN_PLAYER_ID = 0;

// Zustand store replacing Jotai atoms
export const useGameStore = create<GameStoreState>((set, get) => ({
  // Game State
  gameState: createInitialGameState(),

  // Map State
  map: createInitialMapState(),

  // Camera State
  camera: createInitialCameraState(),

  // Units State
  units: [],

  // Cities State
  cities: [],

  // Civilizations State
  civilizations: [],

  // UI State
  uiState: createInitialUIState(),

  // Combat animations (cloud + hide/fade effects)
  combatAnimations: [],

  // Movement glides (position interpolation between tiles)
  movementAnimations: [],

  // True while a human-initiated move/attack animation is playing
  isUnitAnimating: false,

  // Requested camera pan target (consumed by GameCanvas)
  cameraPanRequest: null,

  // Last village (goody hut) outcome, shown by the village-result modal
  villageResult: null,

  // Info for the "unit disbanded to cover upkeep" modal
  disbandNotice: null,

  // Info for the "trade route established" modal (Caravan delivery)
  tradeRouteResult: null,

  // Civ auto-selected when the diplomacy negotiation screen opens (set by
  // diplomat contact or an AI-initiated offer).
  diplomacyFocusCivId: null,

  // Pending AI→player proposal awaiting a response in the diplomacy screen.
  incomingDiplomacyOffer: null,

  // Settings
  settings: {
    uiScale: 1.0,        // Overall UI scale multiplier (0.5 to 2.0)
    menuFontSize: 12,    // Top menu font size in pixels
    sidebarWidth: 140,   // Left sidebar width in pixels
    minimapHeight: 120,  // Minimap height in pixels
    civListFontSize: 10, // Civilization list font size
    skipEndTurnConfirmation: false, // Skip showing end turn confirmation modal
    autoEndTurn: false, // Automatically end turn when all human player units are done (default disabled)
    devMode: false,     // Developer mode: see all players on minimap and switch between them
    enableAnimations: true, // Master switch for movement/combat/camera animations
    animationSpeed: 1,  // Animation speed multiplier (0 = instant, 1 = normal)
    enemyAnimationSpeed: 1, // Enemy (AI) movement animation speed multiplier (0 = instant)
    cameraGlideSpeed: 1 // Camera glide speed multiplier (0 = instant, 1 = normal)
  },

  // Technology State
  technologies: [],

  // Research state (human player): selected path + saved per-tech progress +
  // the tech that just completed (drives the research-complete notification).
  researchPath: [],
  techProgress: {},
  lastResearchedTech: null,

  // Actions
  actions: {
    startGame: () => set(state => ({
      gameState: { ...state.gameState, isGameStarted: true, gamePhase: 'playing' }
    })),

    selectHex: (hex) => set(state => ({
      gameState: { ...state.gameState, selectedHex: hex }
    })),

    selectUnit: (unitId) => set(state => ({
      gameState: { ...state.gameState, selectedUnit: unitId, activeUnit: unitId, selectedCity: null },
      uiState: { 
        ...state.uiState, 
        showUnitPanel: !!unitId, 
        showCityPanel: false
      }
    })),

    selectCity: (cityId) => set(state => ({
      // Selecting/deselecting a city updates the transient selection. When a
      // real city is picked, it also becomes the persistent "focused" city so
      // the map keeps it marked; deselecting (null) leaves the marker in place.
      gameState: {
        ...state.gameState,
        selectedCity: cityId,
        selectedUnit: null,
        focusedCity: cityId ?? state.gameState.focusedCity ?? null
      },
      uiState: { ...state.uiState, showCityPanel: !!cityId, showUnitPanel: false }
    })),

    nextTurn: () => set(state => {
      // Get only active (alive) civilizations for turn cycling
      const activeCivs = state.civilizations.filter(civ => civ.isAlive !== false);
      const currentActiveIndex = activeCivs.findIndex(civ => civ.id === state.gameState.activePlayer);
      const nextActiveIndex = (currentActiveIndex + 1) % activeCivs.length;
      const nextPlayer = activeCivs[nextActiveIndex]?.id ?? 0;
      
      // A new round starts when we wrap back to the first active player
      const isNewRound = nextActiveIndex === 0 && currentActiveIndex !== -1;
      const nextTurn = isNewRound ? state.gameState.currentTurn + 1 : state.gameState.currentTurn;
      
      // Use era-based year progression (only advance on new round)
      const currentYear = state.gameState.currentYear || -4000;
      let nextYear = currentYear;
      if (isNewRound) {
        // Era-based increments
        if (currentYear < 1000) {
          nextYear = currentYear + 20;
        } else if (currentYear < 1500) {
          nextYear = currentYear + 10;
        } else if (currentYear < 1750) {
          nextYear = currentYear + 5;
        } else if (currentYear < 1850) {
          nextYear = currentYear + 2;
        } else {
          nextYear = currentYear + 1;
        }
        // Skip year 0 (1 BC -> 1 AD)
        if (currentYear < 0 && nextYear >= 0) {
          nextYear = nextYear === 0 ? 1 : nextYear;
        }
      }

      return {
        gameState: {
          ...state.gameState,
          activePlayer: nextPlayer,
          currentTurn: nextTurn,
          currentYear: nextYear,
          selectedUnit: null,
          selectedCity: null,
          focusedCity: null,
          selectedHex: null
        },
        uiState: {
          ...state.uiState,
          showUnitPanel: false,
          showCityPanel: false
        }
      };
    }),

    focusOnNextUnit: () => set(state => {
      // AI-vs-AI mode: every civilization is AI-controlled, so nobody needs
      // the camera to follow the "active" player or the UI to auto-open the
      // unit / city panel between AI turns.
      if (state.civilizations.length > 0 && state.civilizations.every(civ => !civ.isHuman)) {
        return state;
      }

      // Prevent multiple calls in quick succession
      const now = Date.now();
      if (state._lastFocusCall && now - state._lastFocusCall < 100) {
        return state;
      }

      // Find next unit belonging to active player that still has moves and is not sleeping
      const activeId = state.gameState.activePlayer;
      const devMode = !!state.settings?.devMode;

      // Camera-follow rule: only focus on the human player's own units, or on
      // enemy/AI units whose tile the human can currently see (fog of war), so
      // the camera never trails hidden AI movement. Dev mode overrides this.
      const shouldFocus = (unit: { civilizationId: number; col: number; row: number }): boolean => {
        if (devMode) return true;
        if (unit.civilizationId === HUMAN_PLAYER_ID) return true;
        const mapWidth = state.map?.width ?? 0;
        if (!mapWidth) return false;
        return !!state.map?.visibility?.[unit.row * mapWidth + unit.col];
      };

      const candidate = state.units.find(u => u.civilizationId === activeId && (u.movesRemaining || 0) > 0 && !u.isSleeping);

      if (candidate) {
        // Only select/follow the unit when the human player should see it.
        if (!shouldFocus(candidate)) {
          return state;
        }

        return {
          ...state,
          _lastFocusCall: now,
          gameState: { ...state.gameState, selectedUnit: candidate.id, activeUnit: candidate.id, selectedCity: null },
          cameraPanRequest: {
            col: candidate.col,
            row: candidate.row,
            keepZoom: true,
            requestId: `focus-${now}-${Math.random().toString(36).slice(2, 8)}`,
          }
        };
      } else {
        // No unit found. Only bring the camera to a city when the player still
        // has production left to manage — this mirrors the engine's auto-end
        // turn gate (`hasCitiesWithNoProductionQueued`): a city with an empty
        // build queue means "no production queued", so the player needs to
        // review/queue something and we land on the capital. Otherwise let the
        // turn end without snapping the camera to a city.
        const hasProductionLeft = state.cities.some(
          (c) => c.civilizationId === activeId
            && Array.isArray(c.buildQueue)
            && c.buildQueue.length === 0
        );
        if (!hasProductionLeft) {
          return state;
        }

        // Focus on the capital city of the active player
        const activeCivilization = state.civilizations.find(c => c.id === activeId);
        const capitalCity = activeCivilization?.capital;

        if (capitalCity) {
          // Same rule for capitals: only follow the human's own or a visible one.
          if (!shouldFocus({ civilizationId: capitalCity.civilizationId, col: capitalCity.col, row: capitalCity.row })) {
            return state;
          }

          return {
            ...state,
            _lastFocusCall: now,
            gameState: { ...state.gameState, selectedUnit: null, activeUnit: null, selectedCity: capitalCity.id },
            cameraPanRequest: {
              col: capitalCity.col,
              row: capitalCity.row,
              keepZoom: true,
              requestId: `focus-${now}-${Math.random().toString(36).slice(2, 8)}`,
            }
          };
        }
      }

      // No unit or capital found, return unchanged state
      return state;
    }),

    updateCamera: (cameraUpdate: Partial<CameraState>) => set(state => ({
      camera: { ...state.camera, ...cameraUpdate }
    })),

    toggleUI: (key) => set(state => ({
      uiState: { ...state.uiState, [key]: !state.uiState[key] }
    })),

    setTurnButtonDisabled: (disabled: boolean) => set(state => ({
      uiState: { ...state.uiState, turnButtonDisabled: disabled }
    })),

    setCurrentQueueUnitId: (unitId: string | null) => set(state => ({
      uiState: { ...state.uiState, currentQueueUnitId: unitId }
    })),

    incrementTurnFlash: () => set(state => ({
      uiState: { ...state.uiState, turnFlashTrigger: state.uiState.turnFlashTrigger + 1 }
    })),

    addCombatAnimation: (animation) => set(state => ({
      combatAnimations: [...state.combatAnimations, animation]
    })),

    removeCombatAnimation: (id) => set(state => ({
      combatAnimations: state.combatAnimations.filter(a => a.id !== id)
    })),

    addMovementAnimation: (animation) => set(state => ({
      movementAnimations: [...state.movementAnimations, animation]
    })),

    removeMovementAnimation: (id) => set(state => ({
      movementAnimations: state.movementAnimations.filter(a => a.id !== id)
    })),

    clearMovementAnimations: () => set(() => ({
      movementAnimations: []
    })),

    setUnitAnimating: (isAnimating) => set(() => ({
      isUnitAnimating: isAnimating
    })),

    focusCameraOnTile: (col, row, keepZoom = true) => set(() => ({
      cameraPanRequest: {
        col,
        row,
        keepZoom,
        requestId: `camera-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }
    })),

    clearCameraPanRequest: () => set(() => ({
      cameraPanRequest: null
    })),

    showDialog: (dialog) => set(state => ({
      uiState: { ...state.uiState, activeDialog: dialog }
    })),

    hideDialog: () => set(state => ({
      uiState: { ...state.uiState, activeDialog: null }
    })),

    showVillageResult: (result) => set(state => ({
      villageResult: result,
      uiState: { ...state.uiState, activeDialog: 'village' }
    })),

    clearVillageResult: () => set(state => ({
      villageResult: null,
      uiState: { ...state.uiState, activeDialog: null }
    })),

    showUpkeepDisbanded: (notice) => set(state => ({
      disbandNotice: notice,
      uiState: { ...state.uiState, activeDialog: 'upkeep-disbanded' }
    })),

    clearUpkeepDisbanded: () => set(state => ({
      disbandNotice: null,
      uiState: { ...state.uiState, activeDialog: null }
    })),

    showTradeRouteResult: (result) => set(state => ({
      tradeRouteResult: result,
      uiState: { ...state.uiState, activeDialog: 'trade-route-result' }
    })),

    clearTradeRouteResult: () => set(state => ({
      tradeRouteResult: null,
      uiState: { ...state.uiState, activeDialog: null }
    })),

    openDiplomacy: (focusCivId = null) => set(state => ({
      uiState: { ...state.uiState, activeDialog: 'diplomacy' },
      diplomacyFocusCivId: focusCivId
    })),

    clearDiplomacyFocus: () => set(() => ({
      diplomacyFocusCivId: null
    })),

    showIncomingDiplomacyOffer: (offer) => set(state => ({
      uiState: { ...state.uiState, activeDialog: 'diplomacy' },
      diplomacyFocusCivId: offer.fromCivId,
      incomingDiplomacyOffer: offer
    })),

    clearIncomingDiplomacyOffer: () => set(() => ({
      incomingDiplomacyOffer: null
    })),

    addNotification: (notification) => {
      const id = Date.now();
      set(state => ({
        uiState: {
          ...state.uiState,
          notifications: [
            ...state.uiState.notifications,
            { id, ...notification }
          ]
        }
      }));
      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        set(state => ({
          uiState: {
            ...state.uiState,
            notifications: state.uiState.notifications.filter(n => n.id !== id)
          }
        }));
      }, 5000);
    },

    removeNotification: (id) => set(state => ({
      uiState: {
        ...state.uiState,
        notifications: state.uiState.notifications.filter(n => n.id !== id)
      }
    })),

    setLoading: (isLoading) => set(state => ({
      gameState: { ...state.gameState, isLoading }
    })),

    updateMap: (mapUpdate) => set(state => {
      const newMap = { ...state.map, ...mapUpdate };
      // Clone tiles to ensure React detects changes when individual tiles are updated
      if (mapUpdate.tiles) {
        newMap.tiles = mapUpdate.tiles.map(tile => ({ ...tile }));
      }
      // For development-only forced fog disable, read from env (Vite exposes VITE_* vars)
      // disableFog check removed (unused)
      const tilesArray = Array.isArray(mapUpdate.tiles) && mapUpdate.tiles.length > 0
        ? mapUpdate.tiles
        : Array.isArray(newMap.tiles) ? newMap.tiles : [];
      const totalTiles = tilesArray.length;

      // Initialize visibility arrays if tiles are provided and arrays don't exist or are wrong size
      if (totalTiles > 0) {
        if (!newMap.visibility || newMap.visibility.length !== totalTiles) {
          newMap.visibility = new Array(totalTiles).fill(false);
        }
        if (!newMap.revealed || newMap.revealed.length !== totalTiles) {
          newMap.revealed = new Array(totalTiles).fill(false);
        }

        // No development-only mutations here; visibility arrays will be updated independently
      }

      // Minimal logging for map initialization
      console.log('[Store] updateMap: Map updated', { width: newMap.width, height: newMap.height });

      return {
        map: newMap
      };
    }),

    // Visibility management actions
    updateVisibility: () => set(state => {
      const { map, units, cities, settings } = state;
      const disableFog = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DISABLE_FOG === 'true') || settings.devMode;

      if (!map.tiles || map.tiles.length === 0) {
        return state;
      }

      if (disableFog) {
        // If developer mode enabled or fog disabled via env var, mark everything visible
        const totalTiles = map.tiles.length;
        return {
          ...state,
          map: {
            ...map,
            visibility: new Array(totalTiles).fill(true),
            revealed: new Array(totalTiles).fill(true),
            tiles: Array.isArray(map.tiles) ? map.tiles.map(t => t ? { ...t, visible: true, explored: true } : t) : map.tiles
          }
        };
      }

      // The store's visibility always reflects the human player's perspective (player 0).
      // The game engine maintains per-player visibility separately for AI decision-making.
      // This ensures the UI (minimap, main canvas) never reveals what other players see.

      // Create new visibility arrays
      const newVisibility = new Array(map.tiles.length).fill(false);
      const newRevealed = [...(map.revealed || new Array(map.tiles.length).fill(false))];

      // Clear current visibility (but keep revealed status)
      // Revealed tiles stay permanently visible
      // Only reveal around the human player's units
      for (const unit of units) {
        if (unit.civilizationId !== HUMAN_PLAYER_ID) {
          continue;
        }

        // Resolve unit sight range robustly. Unit.type is usually an id like 'warrior' or 'scout'.
        const unitTypeId = unit.type ? String(unit.type).toLowerCase() : null;

        // Try to find the game data UNIT_TYPES entry by matching its inner `id` field
        let gameTypeDef: UnitTypeDef | null = null;
        if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
          try {
            // First try exact match
            gameTypeDef = (Object.values(UNIT_TYPES).find((t: UnitTypeDef) => t && String(t.id).toLowerCase() === unitTypeId) as UnitTypeDef | undefined) || null;
            
            // If not found and ends with 's', try singular form
            if (!gameTypeDef && unitTypeId.endsWith('s')) {
              const singularType = unitTypeId.slice(0, -1);
              gameTypeDef = (Object.values(UNIT_TYPES).find((t: UnitTypeDef) => t && String(t.id).toLowerCase() === singularType) as UnitTypeDef | undefined) || null;
            }
          } catch {
            gameTypeDef = null;
          }
        }

        const sightRange = Math.max(2, (typeof (unit as { sightRange?: number }).sightRange === 'number')
          ? (unit as { sightRange?: number }).sightRange
          : (gameTypeDef?.sightRange ?? 2)); // Minimum radius 2 so the map isn't a tiny peephole

        if (sightRange > 0) {
          setVisibilityAreaInternal(newVisibility, newRevealed, unit.col, unit.row, sightRange, map.width, map.height);
        }
      }

      // Reveal around the human player's cities
      for (const city of cities) {
        if (city.civilizationId === HUMAN_PLAYER_ID) {
          const cityViewRadius = 2; // Cities can see 2 tiles away
          setVisibilityAreaInternal(newVisibility, newRevealed, city.col, city.row, cityViewRadius, map.width, map.height);
        }
      }

      return {
        ...state,
        map: {
          ...map,
          visibility: newVisibility,
          revealed: newRevealed
        }
      };
    }),

    revealArea: (centerCol, centerRow, radius) => set(state => {
      const disableFog = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DISABLE_FOG === 'true') || state.settings.devMode;
      if (disableFog) {
        return state;
      }

      const { map } = state;
      if (!map.tiles || map.tiles.length === 0) {
        return state;
      }

      const newVisibility = [...(map.visibility || new Array(map.tiles.length).fill(false))];
      const newRevealed = [...(map.revealed || new Array(map.tiles.length).fill(false))];

      setVisibilityAreaInternal(newVisibility, newRevealed, centerCol, centerRow, radius, map.width, map.height);

      // Also mark as explored (revealed)
      for (let row = centerRow - radius; row <= centerRow + radius; row++) {
        for (let col = centerCol - radius; col <= centerCol + radius; col++) {
          if (row >= 0 && row < map.height && col >= 0 && col < map.width) {
            const index = row * map.width + col;
            // Simple distance check (could be improved with hex distance)
            const distance = Math.sqrt((col - centerCol) ** 2 + (row - centerRow) ** 2);
            if (distance <= radius) {
              newRevealed[index] = true;
            }
          }
        }
      }

      return {
        ...state,
        map: {
          ...map,
          visibility: newVisibility,
          revealed: newRevealed
        }
      };
    }),

    updateUnits: (units) => set(_state => {
      // Enrich units with canonical data (icon, attack, defense, movement) when engine
      // provides only a minimal unit object. Prefer engine values when present.
      const enriched = (units || []).map(u => {
        const unitTypeId = u.type ? String(u.type) : null;

        // Try to find gameData UNIT_TYPES entry by its inner `id` field
        let gameTypeDef: UnitTypeDef | null = null;
        if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
          try {
            gameTypeDef = (Object.values(UNIT_TYPES).find((t: UnitTypeDef) => t && String(t.id).toLowerCase() === String(unitTypeId).toLowerCase()) as UnitTypeDef | undefined) || null;
          } catch {
            gameTypeDef = null;
          }
        }

        // Fallback to UNIT_PROPERTIES (unitConstants) keyed by lowercase id
        const constDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;

        const icon = u.icon || gameTypeDef?.icon || constDef?.icon || '🔸';
        const attack = (typeof u.attack === 'number') ? u.attack : (gameTypeDef?.attack ?? constDef?.attack ?? 0);
        const defense = (typeof u.defense === 'number') ? u.defense : (gameTypeDef?.defense ?? constDef?.defense ?? 0);
        const movesRemaining = (typeof u.movesRemaining === 'number') ? u.movesRemaining : (typeof (u as { movement?: number }).movement === 'number' ? (u as { movement?: number }).movement : (constDef?.movement ?? 0));
        const maxMoves = (typeof u.maxMoves === 'number') ? u.maxMoves : (constDef?.movement ?? gameTypeDef?.movement ?? movesRemaining);

        return { ...u, icon, attack, defense, movesRemaining, maxMoves };
      });
      return { units: enriched };
    }),

    updateCities: (cities) => set({ cities }),

    updateCivilizations: (civilizations) => set(_state => ({ civilizations })),

    updateTechnologies: (technologies) => set({ technologies }),

    setResearchPath: (path) => set({ researchPath: path }),

    saveTechProgress: (techId, progress) => set(state => ({
      techProgress: { ...state.techProgress, [techId]: progress }
    })),

    notifyTechResearched: (tech) => set({ lastResearchedTech: tech }),

    dismissTechNotification: () => set({ lastResearchedTech: null }),

    updateGameState: (updates) => set(state => ({
      gameState: { ...state.gameState, ...updates }
    })),

    updateSettings: (updates) => set(state => ({
      settings: { ...state.settings, ...updates }
    })),
    // Enter/exit citizen pick-up mode. Stores the origin tile being picked up
    // so the map renderer + side panel can reflect the "grabbed" citizen.
    setCitizenReassign: (origin: { cityId: string; col: number; row: number } | null) => set(state => ({
      uiState: { ...state.uiState, citizenReassign: origin }
    })),
    endCitizenReassign: () => set(state => ({
      uiState: { ...state.uiState, citizenReassign: null }
    })),

    setGameResult: (result: GameResult | null) => set(state => ({
      gameState: {
        ...state.gameState,
        gameResult: result,
        winner: result && result.outcome === 'victory' ? result.civName : null,
        gamePhase: result ? 'completed' : state.gameState.gamePhase
      }
    })),

    clearGameResult: () => set(state => ({
      gameState: {
        ...state.gameState,
        gameResult: null
      }
    })),

    resetGameState: () => set(_state => ({
      gameState: createInitialGameState(),
      map: createInitialMapState(),
      camera: createInitialCameraState(),
      units: [],
      cities: [],
      civilizations: [],
      technologies: [],
      researchPath: [],
      techProgress: {},
      lastResearchedTech: null,
      uiState: createInitialUIState(),
      combatAnimations: [],
      disbandNotice: null,
      tradeRouteResult: null
    })),

    resetFogOfWar: () => set(state => {
      const { map } = state;
      if (!map.tiles || map.tiles.length === 0) {
        console.log('[Store] resetFogOfWar: No tiles to reset');
        return state;
      }

      const totalTiles = map.tiles.length;
      console.log(`[Store] resetFogOfWar: Resetting fog of war for ${totalTiles} tiles`);

      // Reset all visibility and revealed arrays to false
      const newVisibility = new Array(totalTiles).fill(false);
      const newRevealed = new Array(totalTiles).fill(false);

      // Also reset tile-level visibility flags
      const newTiles = map.tiles.map(tile => ({
        ...tile,
        visible: false,
        explored: false
      }));

      return {
        ...state,
        map: {
          ...map,
          tiles: newTiles,
          visibility: newVisibility,
          revealed: newRevealed
        }
      };
    })
  },

  // Computed selectors (equivalent to derived atoms)
  get currentPlayer() {
    const { gameState, civilizations } = get();
    return civilizations[gameState.activePlayer] || null;
  },

  // Cached player resources to avoid new object references on every access
  _cachedPlayerResources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },

  get playerResources() {
    const currentPlayer = get().currentPlayer;
    const res = currentPlayer?.resources;
    const food = res?.food || 0;
    const production = res?.production || 0;
    const trade = res?.trade || 0;
    const science = res?.science || 0;
    const gold = res?.gold || 0;
    
    const cached = (get() as StoreWithInternals)._cachedPlayerResources;
    if (cached.food === food && cached.production === production && cached.trade === trade && cached.science === science && cached.gold === gold) {
      return cached;
    }
    const newRes = { food, production, trade, science, gold };
    (get() as StoreWithInternals)._cachedPlayerResources = newRes;
    return newRes;
  },

  get selectedUnit() {
    const { gameState, units } = get();
    if (!gameState.selectedUnit) return null;
    return units.find(unit => unit.id === gameState.selectedUnit) || null;
  },

  get selectedCity() {
    const { gameState, cities } = get();
    if (!gameState.selectedCity) return null;
    return cities.find(city => city.id === gameState.selectedCity) || null;
  },

  get playerUnits() {
    const { currentPlayer, units } = get();
    if (!currentPlayer) return [];
    return units.filter(unit => unit.civilizationId === currentPlayer.id);
  },

  get playerCities() {
    const { currentPlayer, cities } = get();
    if (!currentPlayer) return [];
    return cities.filter(city => city.civilizationId === currentPlayer.id);
  },

  get visibleTiles() {
    const { map } = get();

    // Calculate which tiles are visible based on camera position and zoom
    const viewportTiles = [];

    // Simple implementation - in a real game you'd calculate the actual viewport
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height; y++) {
        viewportTiles.push({ x, y });
      }
    }

    return viewportTiles;
  },

  // Cached game stats
  _cachedGameStats: { turn: 0, totalCities: 0, totalUnits: 0, aliveCivilizations: 0, gameStarted: false },

  get gameStats() {
    const { gameState, civilizations, cities, units } = get();
    const turn = gameState.currentTurn;
    const totalCities = cities.length;
    const totalUnits = units.length;
    const aliveCivilizations = civilizations.filter(civ => civ.isAlive).length;
    const gameStarted = gameState.isGameStarted;

    const cached = (get() as StoreWithInternals)._cachedGameStats;
    if (cached.turn === turn && cached.totalCities === totalCities && cached.totalUnits === totalUnits && cached.aliveCivilizations === aliveCivilizations && cached.gameStarted === gameStarted) {
      return cached;
    }
    const newStats = { turn, totalCities, totalUnits, aliveCivilizations, gameStarted };
    (get() as StoreWithInternals)._cachedGameStats = newStats;
    return newStats;
  }
}));

// Dev-only test hook: expose the store so Playwright/console can drive and
// inspect game state (combat animations, units, camera, etc.).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__gameStore = useGameStore;
}