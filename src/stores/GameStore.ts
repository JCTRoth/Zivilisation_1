/// <reference types="vite/client" />

import { create } from 'zustand';
import { Constants } from '../utils/Constants';
import { SquareGrid } from '../game/SquareGrid';
import { UNIT_TYPES } from '../data/GameData';
import { UNIT_PROPERTIES } from '../data/UnitConstants';
import { HUMAN_PLAYER_ID } from '../utils/PlayerConstants';
import {
  clampGameSpeedStep,
  fasterGameSpeedStep,
  slowerGameSpeedStep,
} from '../data/GameConstants';
import { beginCameraGlide } from '../game/rendering/CameraGlideGate';
import { MIN_ZOOM, MAX_ZOOM, clampZoom } from '../utils/CameraUtils';
import type { GameStoreState, GameState, MapState, CameraState, UIState, GameResult, City } from '../../types/game';

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
  selectedUnitIds: [],
  focusedCity: null,
  selectionOrigin: null,
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
  revealed: [],
  knownCities: {}
});

const createInitialCameraState = (): CameraState => ({
  x: 0,
  y: 0,
  // Games open fully zoomed in — the maximum the camera can reach — so the
  // player starts close to their units instead of looking at a distant map.
  zoom: MAX_ZOOM,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM
});

const createInitialUIState = (): UIState => ({
  showMinimap: true,
  showUnitPanel: false,
  showCityPanel: false,
  showTechTree: false,
  showGameMenu: false,
  activeDialog: null,
  /**
   * Whether the game is actually paused. This is the authoritative pause flag
   * and is deliberately independent of `activeDialog`: the pause screen is one
   * way to show that a game is paused, but a spectator slowing an AI-vs-AI run
   * wants the map itself to stay visible, so that pause shows no dialog.
   */
  isGamePaused: false,
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

/** City dialogs that a user-initiated unit selection closes (one selection at a time). */
const CITY_DIALOGS: ReadonlySet<string> = new Set<string>([
  'city',
  'city-details',
  'city-production',
  'city-purchase',
  'city-citizens',
]);

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

/**
 * Merge the last-seen snapshot of cities the human can currently see into the
 * previous snapshot, dropping cities that no longer exist. Cities stay drawn on
 * explored tiles afterwards; their details only refresh when seen again.
 */
const mergeKnownCities = (
  previous: Record<string, City> | undefined,
  cities: City[],
  visibility: boolean[],
  mapWidth: number
): Record<string, City> => {
  const alive = new Set(cities.map(city => city.id));
  const known: Record<string, City> = {};
  for (const [id, snapshot] of Object.entries(previous ?? {})) {
    if (alive.has(id)) known[id] = snapshot;
  }
  for (const city of cities) {
    const index = city.row * mapWidth + city.col;
    if (index >= 0 && index < visibility.length && visibility[index]) {
      known[city.id] = { ...city };
    }
  }
  return known;
};

// Zustand store replacing Jotai atoms
// Monotonic counter for unique notification IDs (avoids Date.now() collisions
// when multiple notifications fire in the same millisecond).
let _notificationCounter = 0;

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

  // Info for the "city starved" modal
  starvationNotice: null,

  // Info for the "city disorder" modal
  disorderNotice: null,

  // Info for the "trade route established" modal (Caravan delivery)
  tradeRouteResult: null,

  // FIFO queue of world-wonder dialogs (completion screen / production conflict)
  wonderDialogQueue: [],

  // Civ auto-selected when the diplomacy negotiation screen opens (set by
  // diplomat contact or an AI-initiated offer).
  diplomacyFocusCivId: null,

  // Pending AI→player proposal awaiting a response in the diplomacy screen.
  incomingDiplomacyOffer: null,

  // Settings
  settings: {
    uiScale: 1.0,        // Overall UI scale multiplier (0.5 to 2.0)
    skipEndTurnConfirmation: false, // Skip showing end turn confirmation modal
    autoEndTurn: false, // Automatically end turn when all human player units are done (default disabled)
    autoCamera: true,   // Automatically move camera to focused unit / event
    devMode: false,     // Developer mode: see all players on minimap and switch between them
    enableAnimations: true, // Master switch for movement/combat/camera animations
    animationSpeed: 1,  // Animation speed multiplier (0 = instant, 1 = normal)
    enemyAnimationSpeed: 1, // Enemy (AI) movement animation speed multiplier (0 = instant)
    cameraGlideSpeed: 1, // Camera glide speed multiplier (0 = instant, 1 = normal)
    gameSpeedStep: 0 // Spectator speed: 0 = full speed, higher = one step slower each time
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

    selectUnit: (unitId, origin = 'auto') => set(state => {
      const currentOrigin = state.gameState.selectionOrigin ?? null;
      // A selection the player made by hand (origin 'user') wins over the
      // engine's automatic selection. This is what previously made a unit pop
      // up right after the player had clicked a city: the deferred move/queue
      // advance auto-selected the next unit while the city panel was open.
      if (origin === 'auto' && currentOrigin === 'user') {
        return state;
      }

      const isUserSelectingUnit = origin === 'user' && unitId !== null;
      const nextDialog =
        isUserSelectingUnit && CITY_DIALOGS.has(state.uiState.activeDialog ?? '')
          ? null
          : state.uiState.activeDialog;

      return {
        gameState: {
          ...state.gameState,
          selectedUnit: unitId,
          activeUnit: unitId,
          selectedCity: null,
          // Selecting a unit clears the city marker: only one thing is
          // selected at a time (the city net and the unit panel never coexist).
          focusedCity: isUserSelectingUnit ? null : state.gameState.focusedCity ?? null,
          selectionOrigin: unitId === null ? null : origin,
        },
        uiState: {
          ...state.uiState,
          showUnitPanel: !!unitId,
          showCityPanel: false,
          activeDialog: nextDialog,
        }
      };
    }),

    selectCity: (cityId, origin = 'auto') => set(state => {
      const currentOrigin = state.gameState.selectionOrigin ?? null;
      // Same rule as selectUnit: never override an explicit player selection.
      if (origin === 'auto' && currentOrigin === 'user') {
        return state;
      }

      // Selecting/deselecting a city updates the transient selection. When a
      // real city is picked, it also becomes the persistent "focused" city so
      // the map keeps it marked; deselecting (null) leaves the marker in place
      // unless the player explicitly dismissed the selection.
      return {
        gameState: {
          ...state.gameState,
          selectedCity: cityId,
          selectedUnit: null,
          activeUnit: null,
          focusedCity: cityId ?? (origin === 'user' ? null : state.gameState.focusedCity ?? null),
          selectionOrigin: cityId === null ? null : origin,
        },
        uiState: { ...state.uiState, showCityPanel: !!cityId, showUnitPanel: false }
      };
    }),

    setSelectedUnitIds: (ids: string[]) => set(state => ({
      gameState: { ...state.gameState, selectedUnitIds: [...ids] }
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

      // Keep a unit the player selected by hand selected across the turn
      // boundary: the auto turn manager should not deselect it when it rolls
      // into the next turn (the player keeps their focus and can continue
      // moving it once its turn comes back around). Only the human's own,
      // still-alive units are kept; everything else clears as before.
      const previousSelectionId = state.gameState.selectedUnit;
      const keepSelection =
        (state.gameState.selectionOrigin ?? null) === 'user' && previousSelectionId
          ? state.units.find(
              (u) => u.id === previousSelectionId
                && u.civilizationId === HUMAN_PLAYER_ID
                && u.isDefeated !== true,
            ) ?? null
          : null;

      return {
        gameState: {
          ...state.gameState,
          activePlayer: nextPlayer,
          currentTurn: nextTurn,
          currentYear: nextYear,
          selectedUnit: keepSelection ? keepSelection.id : null,
          selectedUnitIds: [],
          selectedCity: null,
          focusedCity: null,
          selectionOrigin: keepSelection ? 'user' : null,
          selectedHex: keepSelection ? { col: keepSelection.col, row: keepSelection.row } : null
        },
        uiState: {
          ...state.uiState,
          showUnitPanel: !!keepSelection,
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

      // Auto-camera disabled: still select the unit for keyboard/gameplay,
      // but do NOT pan the camera.
      const autoCamera = state.settings?.autoCamera !== false;

      // The player is looking at something they picked themselves (a city they
      // opened, a unit they clicked). Don't jump the camera away or replace it.
      if ((state.gameState.selectionOrigin ?? null) === 'user') {
        return state;
      }

      // Prevent multiple calls in quick succession
      const now = Date.now();
      if (state._lastFocusCall && now - state._lastFocusCall < 100) {
        return state;
      }

      // Auto-selection follows the *active* player's units: the human's own
      // during their turn, and an AI unit only while the human can see its tile
      // (fog of war). Hidden AI movement must never be followed.
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

        if (state.settings?.enableAnimations && state.settings.cameraGlideSpeed > 0 && autoCamera) {
          beginCameraGlide();
        }

        return {
          ...state,
          _lastFocusCall: now,
          gameState: {
            ...state.gameState,
            selectedUnit: candidate.id,
            activeUnit: candidate.id,
            selectedCity: null,
            focusedCity: null,
            selectionOrigin: 'auto',
          },
          ...(autoCamera ? {
            cameraPanRequest: {
              col: candidate.col,
              row: candidate.row,
              keepZoom: true,
              requestId: `focus-${now}-${Math.random().toString(36).slice(2, 8)}`,
            }
          } : {}),
        };
      } else {
        // No unit found. Only bring the camera to a city when the player still
        // has production left to manage — this mirrors the engine's auto-end
        // turn gate: a city with nothing in production means the player needs
        // to review/queue something, so we land on the capital. Otherwise let
        // the turn end without snapping the camera to a city.
        const hasProductionLeft = state.cities.some(
          (c) => c.civilizationId === activeId
            && !c.currentProduction
            && (!Array.isArray(c.buildQueue) || c.buildQueue.length === 0)
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

          if (state.settings?.enableAnimations && state.settings.cameraGlideSpeed > 0 && autoCamera) {
            beginCameraGlide();
          }

          return {
            ...state,
            _lastFocusCall: now,
            gameState: {
              ...state.gameState,
              selectedUnit: null,
              activeUnit: null,
              selectedCity: capitalCity.id,
              focusedCity: capitalCity.id,
              selectionOrigin: 'auto',
            },
            ...(autoCamera ? {
              cameraPanRequest: {
                col: capitalCity.col,
                row: capitalCity.row,
                keepZoom: true,
                requestId: `focus-${now}-${Math.random().toString(36).slice(2, 8)}`,
              }
            } : {}),
          };
        }
      }

      // No unit or capital found, return unchanged state
      return state;
    }),

    // Zoom is clamped here as a safety net so no caller can leave the camera
    // outside the playable range (previously this merged blindly).
    updateCamera: (cameraUpdate: Partial<CameraState>) => set(state => ({
      camera: {
        ...state.camera,
        ...cameraUpdate,
        ...(cameraUpdate.zoom !== undefined
          ? { zoom: clampZoom(cameraUpdate.zoom) }
          : null),
      }
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

    focusCameraOnTile: (col, row, keepZoom = true, force = false) => set(state => {
      // When autoCamera is off, skip automated camera pans (unit moves, AI
      // events, turn transitions).  Pass force=true to override (user clicks).
      if (!force && state.settings?.autoCamera === false) {
        return state;
      }
      // Tell the engine a pan is in flight: any animation triggered while the
      // camera travels waits for it (see CameraGlideGate / awaitCameraGlide).
      if (state.settings?.enableAnimations && state.settings.cameraGlideSpeed > 0) {
        beginCameraGlide();
      }
      return {
        cameraPanRequest: {
          col,
          row,
          keepZoom,
          requestId: `camera-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        }
      };
    }),

    clearCameraPanRequest: () => set(() => ({
      cameraPanRequest: null
    })),

    showDialog: (dialog) => set(state => ({
      uiState: { ...state.uiState, activeDialog: dialog }
    })),

    setGamePaused: (paused) => set(state => ({
      uiState: { ...state.uiState, isGamePaused: paused }
    })),

    toggleGamePaused: () => set(state => ({
      uiState: { ...state.uiState, isGamePaused: !state.uiState.isGamePaused }
    })),

    setGameSpeedStep: (step) => set(state => ({
      settings: { ...state.settings, gameSpeedStep: clampGameSpeedStep(step) }
    })),

    slowerGameSpeed: () => set(state => ({
      settings: {
        ...state.settings,
        gameSpeedStep: slowerGameSpeedStep(state.settings.gameSpeedStep ?? 0),
      }
    })),

    fasterGameSpeed: () => set(state => ({
      settings: {
        ...state.settings,
        gameSpeedStep: fasterGameSpeedStep(state.settings.gameSpeedStep ?? 0),
      }
    })),

    hideDialog: () => set(state => ({
      // Closing a dialog means the player is done with that decision screen:
      // release the hand-made selection lock so the turn queue can auto-select
      // the next unit again. The city marker (`focusedCity`) stays.
      uiState: { ...state.uiState, activeDialog: null },
      gameState: { ...state.gameState, selectionOrigin: null }
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

    showCityStarved: (notice) => set(state => ({
      starvationNotice: notice,
      uiState: { ...state.uiState, activeDialog: 'city-starved' }
    })),

    clearCityStarved: () => set(state => ({
      starvationNotice: null,
      uiState: { ...state.uiState, activeDialog: null }
    })),

    showCityDisorder: (notice) => set(state => ({
      disorderNotice: notice,
      uiState: { ...state.uiState, activeDialog: 'city-disorder' }
    })),

    clearCityDisorder: () => set(state => ({
      disorderNotice: null,
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

    queueWonderDialog: (entry) => set(state => {
      const queue = [...state.wonderDialogQueue, entry];
      const active = state.uiState.activeDialog;
      const wonderShowing = active === 'wonder-completed' || active === 'wonder-conflict';
      // Open the first entry immediately; if a wonder dialog is already up the
      // new entry simply waits its turn behind it.
      const dialog = wonderShowing
        ? active
        : entry.kind === 'completed' ? 'wonder-completed' : 'wonder-conflict';
      return {
        wonderDialogQueue: queue,
        uiState: { ...state.uiState, activeDialog: dialog }
      };
    }),

    dequeueWonderDialog: () => set(state => {
      const queue = state.wonderDialogQueue.slice(1);
      if (queue.length > 0) {
        const next = queue[0];
        return {
          wonderDialogQueue: queue,
          uiState: {
            ...state.uiState,
            activeDialog: next.kind === 'completed' ? 'wonder-completed' : 'wonder-conflict'
          }
        };
      }
      return {
        wonderDialogQueue: [],
        uiState: { ...state.uiState, activeDialog: null },
        gameState: { ...state.gameState, selectionOrigin: null }
      };
    }),

    clearWonderDialogs: () => set(state => ({
      wonderDialogQueue: [],
      uiState: {
        ...state.uiState,
        activeDialog:
          state.uiState.activeDialog === 'wonder-completed' || state.uiState.activeDialog === 'wonder-conflict'
            ? null
            : state.uiState.activeDialog
      }
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
      // AI-vs-AI spectator games have no human to read the toasts, and an
      // unattended duel emits dozens per second ("Queued Harbor" ×N). They
      // piled up in the store and re-rendered the whole notification list on
      // every update, so drop them at the source — including the auto-dismiss
      // timer below, which would otherwise churn the state for an entry that
      // was never added.
      const civs = get().civilizations;
      if (civs.length > 0 && civs.every(c => !c.isHuman)) {
        return;
      }

      const id = ++_notificationCounter;
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
        // This runs on every visibility update, i.e. after every unit move.
        // With dev mode on (the naval AI maps auto-enable it) it used to
        // rebuild fresh 5760-entry arrays plus 5760 tile objects each time and
        // hand React a new map identity — enough garbage to dominate the CPU
        // profile in an AI-vs-AI game. Once everything is already lit there is
        // nothing to recompute, and returning the same state is zustand's
        // no-op (no notification, no re-render).
        const totalTiles = map.tiles.length;
        const alreadyLit =
          Array.isArray(map.visibility) &&
          map.visibility.length === totalTiles &&
          map.visibility.every(Boolean) &&
          Array.isArray(map.revealed) &&
          map.revealed.length === totalTiles &&
          map.revealed.every(Boolean) &&
          (!Array.isArray(map.tiles) || map.tiles.every(t => !t || (t.visible && t.explored)));
        if (alreadyLit) {
          return state;
        }

        // If developer mode enabled or fog disabled via env var, mark everything visible
        const allVisible = new Array(totalTiles).fill(true);
        return {
          ...state,
          map: {
            ...map,
            visibility: allVisible,
            revealed: new Array(totalTiles).fill(true),
            knownCities: mergeKnownCities(map.knownCities, cities, allVisible, map.width),
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

      // Fog frequently ends up exactly where it was (an AI-only turn, or the
      // human's units did not move). Reusing the previous state keeps the map
      // object stable so nothing downstream re-renders for a no-op update.
      const visibilityUnchanged =
        Array.isArray(map.visibility) &&
        map.visibility.length === newVisibility.length &&
        newVisibility.every((v, i) => v === map.visibility![i]);
      const revealedUnchanged =
        Array.isArray(map.revealed) &&
        map.revealed.length === newRevealed.length &&
        newRevealed.every((v, i) => v === map.revealed![i]);
      if (visibilityUnchanged && revealedUnchanged) {
        return state;
      }

      return {
        ...state,
        map: {
          ...map,
          visibility: newVisibility,
          revealed: newRevealed,
          knownCities: mergeKnownCities(map.knownCities, cities, newVisibility, map.width)
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
          revealed: newRevealed,
          knownCities: mergeKnownCities(map.knownCities, state.cities, newVisibility, map.width)
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

    // New Game. `settings` is kept so display preferences (scale, fonts, minimap
    // height, animation speed) survive — but the end-turn behaviour is reset,
    // because auto-ending a turn is opt-in and must never be inherited from a
    // previous game: a player who once ticked "don't ask again" would otherwise
    // start every later game with turns ending on their own.
    resetGameState: () => set(state => ({
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
      starvationNotice: null,
      disorderNotice: null,
      tradeRouteResult: null,
      wonderDialogQueue: [],
      settings: {
        ...state.settings,
        autoEndTurn: false,
        skipEndTurnConfirmation: false,
      },
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