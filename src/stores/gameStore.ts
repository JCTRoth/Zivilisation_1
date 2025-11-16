/// <reference types="vite/client" />

import { create } from 'zustand';
import { CONSTANTS } from '../utils/constants';
import { SquareGrid } from '../game/hexGrid';
import { UNIT_TYPES } from '../data/gameData';
import { UNIT_PROPERTIES } from '../data/unitConstants';
import type { GameStoreState, GameState, MapState, CameraState, Unit, City, Civilization, UIState, Settings, Technology, GameActions } from '../../types/game';

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

// Zustand store replacing Jotai atoms
export const useGameStore = create<GameStoreState>((set, get) => ({
  // Game State
  gameState: {
    isLoading: false,
    isGameStarted: false,
    currentTurn: 1,
    gamePhase: 'menu', // 'menu', 'loading', 'playing', 'paused'
    selectedHex: null,
    selectedUnit: null,
    activeUnit: null,
    selectedCity: null,
    activePlayer: 0,
    mapGenerated: false,
    winner: null
  },

  // Map State
  map: {
    width: CONSTANTS.MAP_WIDTH,
    height: CONSTANTS.MAP_HEIGHT,
    tiles: [],
    visibility: [], // Fog of war
    revealed: []    // Permanently revealed tiles
  },

  // Camera State
  camera: {
    x: 0,
    y: 0,
    zoom: 2.0,
    minZoom: 0.5,
    maxZoom: 3.0
  },

  // Units State
  units: [],

  // Cities State
  cities: [],

  // Civilizations State
  civilizations: [],

  // UI State
  uiState: {
    showMinimap: true,
    showUnitPanel: false,
    showCityPanel: false,
    showTechTree: false,
    showDiplomacy: false,
    showGameMenu: false,
    activeDialog: null, // 'city', 'tech', 'diplomacy', 'game-menu', null
    sidebarCollapsed: false,
    notifications: []
  },

  // Settings
  settings: {
    uiScale: 1.0,        // Overall UI scale multiplier (0.5 to 2.0)
    menuFontSize: 12,    // Top menu font size in pixels
    sidebarWidth: 140,   // Left sidebar width in pixels
    minimapHeight: 120,  // Minimap height in pixels
    civListFontSize: 10, // Civilization list font size
    skipEndTurnConfirmation: false // Skip showing end turn confirmation modal
  },

  // Technology State
  technologies: [],

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
      uiState: { ...state.uiState, showUnitPanel: !!unitId, showCityPanel: false }
    })),

    selectCity: (cityId) => set(state => ({
      gameState: { ...state.gameState, selectedCity: cityId, selectedUnit: null },
      uiState: { ...state.uiState, showCityPanel: !!cityId, showUnitPanel: false }
    })),

    nextTurn: () => set(state => {
      const nextPlayer = (state.gameState.activePlayer + 1) % state.civilizations.length;
      const nextTurn = nextPlayer === 0 ? state.gameState.currentTurn + 1 : state.gameState.currentTurn;

      return {
        gameState: {
          ...state.gameState,
          activePlayer: nextPlayer,
          currentTurn: nextTurn,
          selectedUnit: null,
          selectedCity: null,
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
      // Prevent multiple calls in quick succession
      const now = Date.now();
      if (state._lastFocusCall && now - state._lastFocusCall < 100) {
        console.log('[Store] focusOnNextUnit: Throttled call, ignoring');
        return state;
      }

      // Find next unit belonging to active player that still has moves
      const activeId = state.gameState.activePlayer;
      const candidate = state.units.find(u => u.civilizationId === activeId && (u.movesRemaining || 0) > 0);

      if (candidate) {
        // Focus on the unit
        const TILE_SIZE = CONSTANTS.HEX_SIZE || 32; // world pixels per tile
        const zoom = Math.max(0.1, state.camera.zoom || 2.0); // Prevent division by zero

        // Safe window dimension access with fallbacks
        const windowWidth = (typeof window !== 'undefined' && window.innerWidth) || 800;
        const windowHeight = (typeof window !== 'undefined' && window.innerHeight) || 600;

        const startX = candidate.col * TILE_SIZE;
        const startY = candidate.row * TILE_SIZE;

        // Calculate camera position with bounds checking
        const centerOffsetX = windowWidth / 2 / zoom;
        const centerOffsetY = windowHeight / 2 / zoom;

        const newCameraX = startX - centerOffsetX;
        const newCameraY = startY - centerOffsetY;

        // Ensure camera position is valid (not NaN or infinite)
        const safeCameraX = isFinite(newCameraX) ? newCameraX : 0;
        const safeCameraY = isFinite(newCameraY) ? newCameraY : 0;

        const newCamera = {
          x: safeCameraX,
          y: safeCameraY,
          zoom: zoom
        };

        console.log('[Store] focusOnNextUnit: Focusing camera on unit', {
          unitId: candidate.id,
          col: candidate.col,
          row: candidate.row,
          camera: newCamera
        });

        return {
          ...state,
          _lastFocusCall: now,
          gameState: { ...state.gameState, selectedUnit: candidate.id, activeUnit: candidate.id, selectedCity: null },
          camera: { ...state.camera, ...newCamera }
        };
      } else {
        // No unit found, focus on the capital city of the active player
        const activeCivilization = state.civilizations.find(c => c.id === activeId);
        const capitalCity = activeCivilization?.capital;

        if (capitalCity) {
          const TILE_SIZE = CONSTANTS.HEX_SIZE || 32; // world pixels per tile
          const zoom = Math.max(0.1, state.camera.zoom || 2.0); // Prevent division by zero

          // Safe window dimension access with fallbacks
          const windowWidth = (typeof window !== 'undefined' && window.innerWidth) || 800;
          const windowHeight = (typeof window !== 'undefined' && window.innerHeight) || 600;

          const startX = capitalCity.col * TILE_SIZE;
          const startY = capitalCity.row * TILE_SIZE;

          // Calculate camera position with bounds checking
          const centerOffsetX = windowWidth / 2 / zoom;
          const centerOffsetY = windowHeight / 2 / zoom;

          const newCameraX = startX - centerOffsetX;
          const newCameraY = startY - centerOffsetY;

          // Ensure camera position is valid (not NaN or infinite)
          const safeCameraX = isFinite(newCameraX) ? newCameraX : 0;
          const safeCameraY = isFinite(newCameraY) ? newCameraY : 0;

          const newCamera = {
            x: safeCameraX,
            y: safeCameraY,
            zoom: zoom
          };

          console.log('[Store] focusOnNextUnit: No units available, focusing camera on capital city', {
            cityId: capitalCity.id,
            col: capitalCity.col,
            row: capitalCity.row,
            camera: newCamera
          });

          return {
            ...state,
            _lastFocusCall: now,
            gameState: { ...state.gameState, selectedUnit: null, activeUnit: null, selectedCity: capitalCity.id },
            camera: { ...state.camera, ...newCamera }
          };
        }
      }

      // No unit or capital found, return unchanged state
      return state;
    }),

    updateCamera: (cameraUpdate) => set(state => ({
      camera: { ...state.camera, ...cameraUpdate }
    })),

    toggleUI: (key) => set(state => ({
      uiState: { ...state.uiState, [key]: !state.uiState[key] }
    })),

    showDialog: (dialog) => set(state => ({
      uiState: { ...state.uiState, activeDialog: dialog }
    })),

    hideDialog: () => set(state => ({
      uiState: { ...state.uiState, activeDialog: null }
    })),

    addNotification: (notification) => set(state => ({
      uiState: {
        ...state.uiState,
        notifications: [
          ...state.uiState.notifications,
          { id: Date.now(), ...notification }
        ]
      }
    })),

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
  // For development-only forced fog disable, read from env (Vite exposes VITE_* vars)
  const disableFog = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DISABLE_FOG === 'true';
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
      console.log('[Store] updateMap: Final map state', { width: newMap.width, height: newMap.height, tilesLength: newMap.tiles?.length || 0 });

      return {
        map: newMap
      };
    }),

    // Visibility management actions
    updateVisibility: () => set(state => {
      const { map, units, cities } = state;
      const disableFog = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DISABLE_FOG === 'true';

      if (!map.tiles || map.tiles.length === 0) {
        console.log('[Store] updateVisibility: No tiles to update visibility for');
        return state;
      }

      if (disableFog) {
        // If developer requested fog disabled via env var, mark everything visible
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

      console.log('[Store] updateVisibility: Starting visibility update', { unitsCount: units.length, citiesCount: cities.length, mapSize: `${map.width}x${map.height}` });

      // Create new visibility arrays
      const newVisibility = new Array(map.tiles.length).fill(false);
      const newRevealed = [...(map.revealed || new Array(map.tiles.length).fill(false))];

      // Clear current visibility (but keep revealed status)
      // Revealed tiles stay permanently visible

      // Reveal around all of the active player's units only
      for (const unit of units) {
        if (unit.civilizationId !== state.gameState.activePlayer) {
          continue;
        }

        // Resolve unit sight range robustly. Unit.type is usually an id like 'warrior' or 'militia'.
        const unitTypeId = unit.type ? String(unit.type).toLowerCase() : null;

        // Try to find the game data UNIT_TYPES entry by matching its inner `id` field
        let gameTypeDef: any = null;
        if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
          try {
            gameTypeDef = Object.values(UNIT_TYPES).find((t: any) => t && String(t.id).toLowerCase() === unitTypeId) || null;
          } catch (e) {
            gameTypeDef = null;
          }
        }

        // Fallback to UNIT_PROPERTIES (unitConstants) keyed by lowercase id
        const constDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;

  const sightRange = (typeof (unit as any).sightRange === 'number') ? (unit as any).sightRange : (gameTypeDef?.sightRange ?? 0);
        
        if (sightRange > 0) {
          console.log('[Store] updateVisibility: Processing unit with sight', {
            unitType: unit.type,
            sightRange,
            position: `${unit.col},${unit.row}`,
            civilizationId: unit.civilizationId
          });
          setVisibilityAreaInternal(newVisibility, newRevealed, unit.col, unit.row, sightRange, map.width, map.height);
        }
      }

      // Reveal around all player cities (civilizationId === active player)
      for (const city of cities) {
        if (city.civilizationId === state.gameState.activePlayer) {
          const cityViewRadius = 2; // Cities can see 2 tiles away
          console.log('[Store] updateVisibility: Processing player city', {
            cityName: city.name,
            position: `${city.col},${city.row}`,
            viewRadius: cityViewRadius
          });
          setVisibilityAreaInternal(newVisibility, newRevealed, city.col, city.row, cityViewRadius, map.width, map.height);
        }
      }

      console.log('[Store] updateVisibility: Final visibility state', {
        visibilityTrueCount: newVisibility.filter(v => v).length,
        revealedTrueCount: newRevealed.filter(r => r).length,
        totalTiles: map.tiles.length
      });

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
      const disableFog = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DISABLE_FOG === 'true';
      if (disableFog) {
        return state;
      }

      const { map } = state;
      if (!map.tiles || map.tiles.length === 0) {
        console.log('[Store] revealArea: No tiles to reveal');
        return state;
      }

      const newVisibility = [...map.visibility];
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

      console.log('[Store] revealArea: Revealed area', {
        centerCol, centerRow, radius,
        visibilityTrueCount: newVisibility.filter(v => v).length,
        revealedTrueCount: newRevealed.filter(r => r).length
      });

      return {
        ...state,
        map: {
          ...map,
          visibility: newVisibility,
          revealed: newRevealed
        }
      };
    }),

    updateUnits: (units) => set(state => {
      // Enrich units with canonical data (icon, attack, defense, movement) when engine
      // provides only a minimal unit object. Prefer engine values when present.
      const enriched = (units || []).map(u => {
        const unitTypeId = u.type ? String(u.type) : null;

        // Try to find gameData UNIT_TYPES entry by its inner `id` field
        let gameTypeDef: any = null;
        if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
          try {
            gameTypeDef = Object.values(UNIT_TYPES).find((t: any) => t && String(t.id).toLowerCase() === String(unitTypeId).toLowerCase()) || null;
          } catch (e) {
            gameTypeDef = null;
          }
        }

        // Fallback to UNIT_PROPERTIES (unitConstants) keyed by lowercase id
        const constDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;

        const icon = u.icon || gameTypeDef?.icon || constDef?.icon || '🔸';
        const attack = (typeof u.attack === 'number') ? u.attack : (gameTypeDef?.attack ?? constDef?.attack ?? 0);
        const defense = (typeof u.defense === 'number') ? u.defense : (gameTypeDef?.defense ?? constDef?.defense ?? 0);
      const movesRemaining = (typeof u.movesRemaining === 'number') ? u.movesRemaining : (typeof (u as any).movement === 'number' ? (u as any).movement : (constDef?.movement ?? 0));
  const maxMoves = (typeof u.maxMoves === 'number') ? u.maxMoves : (constDef?.movement ?? gameTypeDef?.movement ?? movesRemaining);

        return { ...u, icon, attack, defense, movesRemaining, maxMoves };
      });
      return { units: enriched };
    }),

    updateCities: (cities) => set({ cities }),

    updateCivilizations: (civilizations) => set({ civilizations }),

    updateTechnologies: (technologies) => set({ technologies }),

    updateGameState: (updates) => set(state => ({
      gameState: { ...state.gameState, ...updates }
    })),

    updateSettings: (updates) => set(state => ({
      settings: { ...state.settings, ...updates }
    }))
  },

  // Computed selectors (equivalent to derived atoms)
  get currentPlayer() {
    const { gameState, civilizations } = get();
    return civilizations[gameState.activePlayer] || null;
  },

  get playerResources() {
    const currentPlayer = get().currentPlayer;
    if (!currentPlayer) {
      return { food: 0, production: 0, trade: 0, science: 0, gold: 0 };
    }
    return {
      food: currentPlayer.resources?.food || 0,
      production: currentPlayer.resources?.production || 0,
      trade: currentPlayer.resources?.trade || 0,
      science: currentPlayer.resources?.science || 0,
      gold: currentPlayer.resources?.gold || 0
    };
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
    const { map, camera } = get();

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

  get gameStats() {
    const { gameState, civilizations, cities, units } = get();

    return {
      turn: gameState.currentTurn,
      totalCities: cities.length,
      totalUnits: units.length,
      aliveCivilizations: civilizations.filter(civ => civ.isAlive).length,
      gameStarted: gameState.isGameStarted
    };
  }
}));