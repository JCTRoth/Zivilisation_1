import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGameStore } from "@/stores/GameStore";
import { useShallow } from "zustand/react/shallow";
import { TILE_SIZE } from "@/data/TerrainData";
import {
  MapRenderer,
  TerrainRenderGrid,
  TerrainTileRenderInfo,
  UnitPathStep,
} from "@/game/rendering/MapRenderer";
import MoveAnimator from "@/game/engine/MoveAnimator";
import { MathUtils } from "@/utils/MathUtils";
import { centerCameraOnTile } from "@/utils/CameraUtils";
import { MiniMapRenderer } from "@/game/rendering/MiniMapRenderer";
import { TerrainTextureManager } from "@/game/rendering/TerrainTextureManager";
import type {
  City,
  GameState,
  MapState,
  MovementReachable,
  TurnMarker,
  Unit,
} from "../../../types/game";
import GameEngine from "@/game/engine/GameEngine";
import "../../styles/civ1GameCanvas.css";
import UnitActionsModal from "./UnitActionsModal";
import { Pathfinding } from "@/game/engine/Pathfinding";
import {
  computeMovementPreview,
  type TileLookup,
} from "@/utils/MovementPreview";
import { KeyboardHandler } from "@/game/engine/KeyboardHandler";

/**
 * Frame rate of the single render loop that drives the map. Animations are
 * capped here on purpose: a turn-based map does not need display-refresh rate,
 * and a lower cap keeps the main thread free for input and UI.
 */
const ANIMATION_FPS = 30;

type HexCoordinates = { col: number; row: number };

/** Civilization id of the human player (matches GameStore/EngineEventHandlers). */
const HUMAN_PLAYER_ID = 0;

interface GameCanvasProps {
  minimap?: boolean;
  onExamineHex?: (
    hex: HexCoordinates,
    tile: TerrainTileRenderInfo | null,
  ) => void;
  gameEngine?: GameEngine | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  hex: HexCoordinates;
  tile: TerrainTileRenderInfo | null;
  unit: Unit | null;
  city: City | null;
}

const GameCanvas: React.FC<GameCanvasProps> = ({
  minimap = false,
  onExamineHex,
  gameEngine = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainTypesHashRef = useRef<string>("");
  const mapRendererRef = useRef<MapRenderer>(new MapRenderer());
  const miniMapRendererRef = useRef<MiniMapRenderer>(new MiniMapRenderer());
  const textureManagerRef = useRef<TerrainTextureManager | null>(null);
  const gameState = useGameStore(useShallow((state) => state.gameState));
  const mapData = useGameStore((state) => state.map);
  const camera = useGameStore((state) => state.camera);
  const actions = useGameStore((state) => state.actions);
  const cities = useGameStore((state) => state.cities);
  const units = useGameStore((state) => state.units);
  const currentPlayer = useGameStore(
    (state) => state.civilizations[state.gameState.activePlayer] || null,
  );
  const civilizations = useGameStore((state) => state.civilizations);
  const devMode = useGameStore((state) => !!state.settings?.devMode);
  const currentQueueUnitId = useGameStore(
    (state) => state.uiState.currentQueueUnitId,
  );
  const combatAnimations = useGameStore((state) => state.combatAnimations);
  const movementAnimations = useGameStore((state) => state.movementAnimations);
  const cameraPanRequest = useGameStore((state) => state.cameraPanRequest);
  const moveAnimator = useMemo(
    () => (gameEngine ? new MoveAnimator(gameEngine) : null),
    [gameEngine],
  );
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [lastMousePos, setLastMousePos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [selectedHex, setSelectedHex] = useState<HexCoordinates>({
    col: 5,
    row: 5,
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terrain, setTerrain] = useState<TerrainRenderGrid | null>(null);
  // Ref mirroring the latest terrain grid so the build/visibility effects below
  // can read the current grid WITHOUT depending on `terrain` state. Depending on
  // `terrain` while calling setTerrain() with a fresh array each run caused an
  // infinite render loop (and 100% CPU) once the game started.
  const terrainRef = useRef<TerrainRenderGrid | null>(null);
  const citizenReassign = useGameStore(
    (state) => state.uiState.citizenReassign,
  );
  // Selection is derived from the store so manual clicks and auto-selection
  // (turn queue / focusOnNextUnit / unit-moved events) share one source of truth.
  const selectedUnit = useMemo<Unit | null>(() => {
    const id = gameState.selectedUnit;
    return id ? (units.find((u) => u.id === id) ?? null) : null;
  }, [gameState.selectedUnit, units]);
  const isUnitSelectionMode =
    !!selectedUnit &&
    selectedUnit.civilizationId === HUMAN_PLAYER_ID &&
    gameState.activePlayer === HUMAN_PLAYER_ID;
  const [unitPaths, setUnitPaths] = useState<Map<string, UnitPathStep[]>>(
    new Map(),
  );
  const [reachableTiles, setReachableTiles] = useState<Map<string, number>>(
    new Map(),
  );
  // ---- Hover preview state ----
  //
  // Deliberately held in refs, NOT React state. A hover changes on every mouse
  // move; routing it through `useState` re-rendered this (large) component and
  // re-created `renderStaticContent`, which then redrew the whole map. The render
  // loop just reads these and composites, so hovering now costs no React work.
  const hoveredHexRef = useRef<HexCoordinates | null>(null);
  const hoverReachableRef = useRef<MovementReachable | null>(null);
  const previewPathRef = useRef<UnitPathStep[] | null>(null);
  const previewTurnMarkersRef = useRef<TurnMarker[]>([]);
  const lastHoverKeyRef = useRef<string>("");
  /** Pending deferred path-preview computation (see `handleMouseMove`). */
  const previewTimerRef = useRef<number | null>(null);
  const reachableCacheRef = useRef<Map<string, Map<string, number>>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const needsRender = useRef<boolean>(true);
  const lastGameState = useRef<Record<string, unknown> | null>(null);
  /** Transparent canvas layered above the map for above-unit animations. */
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Viewport-sized cache of the expensive terrain pass. Rebuilt only when the
   * camera, viewport size or terrain data changes (see `terrainVersionRef`).
   */
  const groundCacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Bumped whenever the composited terrain offscreen canvas is rebuilt. */
  const terrainVersionRef = useRef<number>(0);
  /**
   * In-flight camera glide. Stepped by the render loop; while it is set the
   * ground cache is bypassed (the camera changes every frame, so caching the
   * terrain would only add a second full-canvas blit per frame).
   */
  const cameraTweenRef = useRef<{
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    startTime: number;
    duration: number;
  } | null>(null);
  const terrainRebuildNeededRef = useRef<boolean>(false);
  // Tracks whether the starting settler has already been auto-selected for the
  // current game. Prevents the "select starting settler" effect from re-running
  // on every `units` change (load, unit movement, turn processing).
  const initialSettlerSelectionDoneRef = useRef<boolean>(false);
  const [, setTexturesLoaded] = useState(false);

  // Cached canvas bounding rect, refreshed on resize/scroll/renders so the hot
  // `handleMouseMove` path never calls `getBoundingClientRect()` (which forces a
  // synchronous layout) on every mouse event.
  const canvasRectRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  const syncCanvasRectRef = useRef<() => void>(() => {});

  // ---- Touch / gesture state (mobile support) ----
  const touchStartRef = useRef<{ x: number; y: number; id: number } | null>(
    null,
  );
  const touchMovedRef = useRef<boolean>(false);
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const lastTouchEndRef = useRef<number>(0);
  const TOUCH_TAP_SLOP = 10;
  const LONG_PRESS_MS = 500;
  const DOUBLE_TAP_MS = 300;

  // Trigger re-render when game state changes (turn-based optimization)
  const triggerRender = useCallback(() => {
    needsRender.current = true;
  }, []);

  /** Refresh the cached canvas rect (cheap, but not per-mouse-event). */
  const syncCanvasRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvasRectRef.current = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  useEffect(() => {
    syncCanvasRectRef.current = syncCanvasRect;
  }, [syncCanvasRect]);

  // Drop a pending deferred hover-preview computation when the canvas unmounts.
  useEffect(() => {
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, []);

  // Cancel a citizen pick-up with the ESC key.
  useEffect(() => {
    if (!citizenReassign) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        actions.endCitizenReassign();
        triggerRender();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [citizenReassign, actions, triggerRender]);

  // Check if game state has changed significantly
  const hasGameStateChanged = useCallback(() => {
    const currentState = {
      activePlayer: gameState.activePlayer,
      currentTurn: gameState.currentTurn,
      units: units.length,
      cities: cities.length,
      selectedHex: selectedHex ? `${selectedHex.col},${selectedHex.row}` : null,
      selectedCity: gameState.selectedCity || null,
      selectedUnit: gameState.selectedUnit || null,
      reachableTilesSize: reachableTiles.size,
      cameraX: Math.round(camera.x),
      cameraY: Math.round(camera.y),
      cameraZoom: camera.zoom,
    };

    if (!lastGameState.current) {
      lastGameState.current = currentState;
      return true;
    }

    // Compare each property individually to avoid expensive JSON.stringify
    const changed =
      currentState.activePlayer !== lastGameState.current.activePlayer ||
      currentState.currentTurn !== lastGameState.current.currentTurn ||
      currentState.units !== lastGameState.current.units ||
      currentState.cities !== lastGameState.current.cities ||
      currentState.selectedHex !== lastGameState.current.selectedHex ||
      currentState.selectedCity !== lastGameState.current.selectedCity ||
      currentState.selectedUnit !== lastGameState.current.selectedUnit ||
      currentState.reachableTilesSize !==
        lastGameState.current.reachableTilesSize ||
      currentState.cameraX !== lastGameState.current.cameraX ||
      currentState.cameraY !== lastGameState.current.cameraY ||
      currentState.cameraZoom !== lastGameState.current.cameraZoom;

    if (changed) {
      lastGameState.current = currentState;
      return true;
    }
    return false;
  }, [
    camera,
    cities.length,
    gameState.activePlayer,
    gameState.currentTurn,
    gameState.selectedCity,
    gameState.selectedUnit,
    reachableTiles.size,
    selectedHex,
    units.length,
  ]);

  /** Build a cheap hash of terrain types + exploration (not visibility). */
  const hashTerrainTypes = useCallback((grid: TerrainRenderGrid): string => {
    let h = 0;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const t = row[c];
        if (!t) continue;
        // Simple hash: type char codes + explored flag
        const s = t.type + (t.explored ? "1" : "0");
        for (let i = 0; i < s.length; i++) {
          h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
      }
    }
    return String(h);
  }, []);

  const renderTerrainToOffscreen = useCallback(
    (terrainGrid: TerrainRenderGrid | null) => {
      if (!terrainGrid || !mapData) return;
      const offscreenCanvas = terrainCanvasRef.current;
      const baseCanvas = terrainBaseCanvasRef.current;
      if (!offscreenCanvas || !baseCanvas) return;

      const mr = mapRendererRef.current;
      const newHash = hashTerrainTypes(terrainGrid);
      const typesChanged = newHash !== terrainTypesHashRef.current;

      if (typesChanged) {
        // Expensive path: terrain types or exploration changed — rebuild base
        terrainTypesHashRef.current = newHash;
        mr.renderTerrainBase({
          offscreenCanvas: baseCanvas,
          map: mapData,
          terrainGrid,
        });
      }

      // Always composite: base canvas + fog overlay (cheap)
      const mapWidth = mapData.width * (TILE_SIZE * 2);
      const mapHeight = mapData.height * (TILE_SIZE * 2);
      if (
        offscreenCanvas.width !== mapWidth ||
        offscreenCanvas.height !== mapHeight
      ) {
        offscreenCanvas.width = mapWidth;
        offscreenCanvas.height = mapHeight;
      }
      const ctx = offscreenCanvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, mapWidth, mapHeight);
      ctx.drawImage(baseCanvas, 0, 0);
      mr.renderFogOverlay(ctx, mapData, terrainGrid);
      // The terrain layer changed — invalidate the ground-cache key so the next
      // render rebuilds the cached viewport-sized terrain blit.
      terrainVersionRef.current += 1;
    },
    [mapData, hashTerrainTypes],
  );

  useEffect(() => {
    if (!terrainCanvasRef.current && typeof document !== "undefined") {
      terrainCanvasRef.current = document.createElement("canvas");
    }
    if (!terrainBaseCanvasRef.current && typeof document !== "undefined") {
      terrainBaseCanvasRef.current = document.createElement("canvas");
    }
    if (!groundCacheCanvasRef.current && typeof document !== "undefined") {
      groundCacheCanvasRef.current = document.createElement("canvas");
    }
    // Initialize texture manager once and attach to renderer
    if (!textureManagerRef.current) {
      const tm = new TerrainTextureManager(() => {
        // Textures finished loading — force base canvas rebuild and re-render
        terrainTypesHashRef.current = ""; // invalidate cached base
        terrainRebuildNeededRef.current = true;
        needsRender.current = true;
        setTexturesLoaded(true);
      });
      textureManagerRef.current = tm;
      mapRendererRef.current.textureManager = tm;
    }
  }, []);

  const createTerrainGrid = useCallback(
    (
      tiles:
        | Array<{
            type?: string;
            resource?: string;
            improvement?: string;
            visible?: boolean;
            explored?: boolean;
            hasRoad?: boolean;
            hasRiver?: boolean;
            village?: boolean;
          }>
        | undefined,
      width: number,
      height: number,
      visibility?: boolean[],
      revealed?: boolean[],
    ): TerrainRenderGrid => {
      const grid: TerrainRenderGrid = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => null),
      );
      if (!tiles) {
        return grid;
      }

      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const idx = row * width + col;
          const tile = tiles[idx];
          if (!tile) continue;
          grid[row][col] = {
            type: tile.type,
            resource: tile.resource ?? null,
            improvement: tile.improvement ?? null,
            visible: visibility?.[idx] ?? tile.visible ?? false,
            explored: revealed?.[idx] ?? tile.explored ?? false,
            hasRoad: tile.hasRoad ?? false,
            hasRiver: tile.hasRiver ?? false,
            village: tile.village ?? false,
          };
        }
      }

      return grid;
    },
    [],
  );

  // Keep a ref in sync with the terrain state so the build/visibility effects
  // can read the latest grid without depending on `terrain` state.
  useEffect(() => {
    terrainRef.current = terrain;
  }, [terrain]);

  useEffect(() => {
    if (!mapData?.width || !mapData?.height) {
      return;
    }

    const totalTiles = mapData.width * mapData.height;

    if (Array.isArray(mapData.tiles) && mapData.tiles.length === totalTiles) {
      const terrainGrid = createTerrainGrid(
        mapData.tiles,
        mapData.width,
        mapData.height,
        mapData.visibility,
        mapData.revealed,
      );
      terrainRef.current = terrainGrid;
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);
      return;
    }

    const engineTiles = gameEngine?.map?.tiles;
    if (Array.isArray(engineTiles) && engineTiles.length >= totalTiles) {
      const terrainGrid = createTerrainGrid(
        engineTiles,
        mapData.width,
        mapData.height,
        mapData.visibility,
        mapData.revealed,
      );
      terrainRef.current = terrainGrid;
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);
      return;
    }

    if (!terrainRef.current) {
      const generatedTerrain = MapRenderer.generateFallbackTerrain(
        mapData.width || 20,
        mapData.height || 20,
      );
      terrainRef.current = generatedTerrain;
      setTerrain(generatedTerrain);
      renderTerrainToOffscreen(generatedTerrain);
    }
  }, [
    createTerrainGrid,
    gameEngine,
    mapData.height,
    mapData.revealed,
    mapData.tiles,
    mapData.visibility,
    mapData.width,
    renderTerrainToOffscreen,
  ]);

  // Note: Improvements (roads, etc.) are now rendered directly from mapData.tiles
  // in MapRenderer.drawDynamicContent, so we don't need to update the terrain grid
  // or re-render the offscreen canvas when improvements change. This avoids
  // expensive re-renders and prevents infinite loops.

  // Update terrain visibility when game state changes
  useEffect(() => {
    console.log("[GameCanvas] Updating terrain visibility", {
      hasTerrain: !!terrainRef.current,
      hasVisibility: !!mapData.visibility,
      hasRevealed: !!mapData.revealed,
      visibilityLength: mapData.visibility?.length || 0,
      revealedLength: mapData.revealed?.length || 0,
      visibilityTrueCount: mapData.visibility?.filter((v) => v).length || 0,
      revealedTrueCount: mapData.revealed?.filter((r) => r).length || 0,
    });

    // Defensive check: ensure terrain grid matches map dimensions
    const ensureTerrainMatchesMap = () => {
      const current = terrainRef.current;
      if (!current) return false;
      if (!mapData || !mapData.width || !mapData.height) return false;
      if (current.length !== mapData.height) return false;
      for (let r = 0; r < mapData.height; r++) {
        if (!current[r] || current[r].length !== mapData.width) return false;
      }
      return true;
    };

    // Track current terrain (either existing or newly rebuilt)
    let currentTerrain = terrainRef.current;

    if (!ensureTerrainMatchesMap()) {
      console.warn(
        "[GameCanvas] Terrain grid mismatch detected. Rebuilding terrain from mapData.tiles",
      );
      // Rebuild terrain synchronously from mapData.tiles (best-effort)
      if (
        mapData &&
        Array.isArray(mapData.tiles) &&
        mapData.tiles.length === mapData.width * mapData.height
      ) {
        const rebuilt = new Array(mapData.height);
        for (let row = 0; row < mapData.height; row++) {
          rebuilt[row] = new Array(mapData.width);
          for (let col = 0; col < mapData.width; col++) {
            const idx = row * mapData.width + col;
            const tile =
              (mapData.tiles[idx] as {
                type?: string;
                resource?: string;
                improvement?: string;
                visible?: boolean;
                explored?: boolean;
              }) || {};
            rebuilt[row][col] = {
              type: tile.type || "OCEAN",
              resource: tile.resource ?? null,
              improvement: tile.improvement ?? null,
              visible: mapData.visibility?.[idx] ?? tile.visible ?? false,
              explored: mapData.revealed?.[idx] ?? tile.explored ?? false,
            };
          }
        }
        // Use rebuilt terrain immediately
        currentTerrain = rebuilt;
        terrainRef.current = rebuilt;
        setTerrain(rebuilt);
        console.log("[GameCanvas] Terrain rebuilt from mapData");
      } else {
        console.warn(
          "[GameCanvas] Cannot rebuild terrain: invalid mapData.tiles length",
        );
      }
    }

    // Update visibility using current terrain (either existing or just rebuilt)
    if (currentTerrain && mapData.visibility && mapData.revealed) {
      // Update visibility without recreating the entire grid
      const updatedTerrain = [...currentTerrain];
      for (let row = 0; row < mapData.height; row++) {
        if (!updatedTerrain[row]) updatedTerrain[row] = [];
        for (let col = 0; col < mapData.width; col++) {
          const tileIndex = row * mapData.width + col;
          if (updatedTerrain[row][col]) {
            updatedTerrain[row][col] = {
              ...updatedTerrain[row][col],
              visible: mapData.visibility[tileIndex] || false,
              explored: mapData.revealed[tileIndex] || false,
            };
          }
        }
      }
      // Always update terrain visibility - don't use expensive JSON comparison
      terrainRef.current = updatedTerrain;
      renderTerrainToOffscreen(updatedTerrain);
      setTerrain(updatedTerrain);
      console.log("[GameCanvas] Terrain visibility updated");
    } else {
      console.log(
        "[GameCanvas] Skipping terrain visibility update - missing data",
      );
    }
  }, [
    mapData.visibility,
    mapData.revealed,
    mapData.height,
    mapData.width,
    mapData.tiles,
    mapData,
    renderTerrainToOffscreen,
  ]);

  // Select player's starting settler when a game starts.
  // This runs ONLY once per new game. Without the guard it re-fires on every
  // `units` change (loading a save, each unit move, turn processing), which
  // re-selects the starting settler mid-game and overrides the unit-turn-queue's
  // correct selection while the camera stays on the queue unit — the
  // "settler is selected but the camera moves to another unit" bug.
  useEffect(() => {
    // Reset the one-time flag whenever no game is active (fresh game / quit),
    // so a newly started game can re-run the initial settler selection.
    if (!gameState.isGameStarted) {
      initialSettlerSelectionDoneRef.current = false;
      return;
    }
    // Only auto-select the starting settler once, and only on the first turn of
    // a game. Loading a mid-game save (currentTurn > 1) must NOT re-select the
    // settler — the unit-turn-queue owns unit selection from then on.
    if (initialSettlerSelectionDoneRef.current || gameState.currentTurn !== 1) {
      return;
    }
    if (units && units.length > 0) {
      const playerSettler = units.find(
        (u) => u.civilizationId === HUMAN_PLAYER_ID && u.type === "settler",
      );
      if (playerSettler) {
        initialSettlerSelectionDoneRef.current = true;
        setSelectedHex({ col: playerSettler.col, row: playerSettler.row });
        // Selecting the unit is enough to enter movement mode: the selected-unit
        // effect computes the reachable range, and the cursor derives from
        // `gameState.selectedUnit` (single source of truth).
        if (actions && typeof actions.selectUnit === "function") {
          actions.selectUnit(playerSettler.id);
        }
      }
    }
  }, [units, gameState.isGameStarted, gameState.currentTurn, actions]);

  // Focus the canvas when game engine is available for keyboard controls
  useEffect(() => {
    if (gameEngine && canvasRef.current && !minimap) {
      canvasRef.current.focus();
    }
  }, [gameEngine, minimap]);

  // Keyboard event handler for unit actions using KeyboardHandler class
  useEffect(() => {
    if (minimap) {
      console.log("[GameCanvas] Skipping keyboard handler - minimap mode");
      return;
    }

    if (!gameEngine || !actions) {
      console.log(
        "[GameCanvas] Skipping keyboard handler - no gameEngine or actions",
      );
      return;
    }

    console.log("[GameCanvas] Creating KeyboardHandler");

    const keyboardHandler = new KeyboardHandler(
      gameEngine,
      actions,
      () => {
        const selectedUnitId = gameState?.selectedUnit;
        return selectedUnitId
          ? units.find((u) => u.id === selectedUnitId) || null
          : null;
      },
      () => getAllUnitsFromEngine(),
      () => minimap,
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore unit-action keys while the game is paused.
      if (useGameStore.getState().uiState.activeDialog === "pause") {
        return;
      }
      const handled = keyboardHandler.handleKeyDown(event);
      if (handled) {
        triggerRender();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      keyboardHandler.dispose();
    };
  }, [
    gameState?.selectedUnit,
    units,
    currentPlayer,
    minimap,
    gameEngine,
    actions,
    triggerRender,
  ]);

  // Sync unit paths from RoundManager when turn changes
  useEffect(() => {
    const roundManager = gameEngine?.roundManager;
    if (roundManager && typeof roundManager.getAllUnitPaths === "function") {
      console.log(
        "[GameCanvas] Syncing unit paths from RoundManager on turn change",
      );
      const paths = roundManager.getAllUnitPaths();
      if (paths instanceof Map) {
        setUnitPaths(paths as Map<string, UnitPathStep[]>);
      }
    }
  }, [gameState.currentTurn, gameEngine]);

  // Shared tile lookup for pathfinding and movement previews.
  const getTileAt = useCallback<TileLookup>(
    (col: number, row: number) => {
      if (!mapData) return null;
      if (row < 0 || row >= mapData.height || col < 0 || col >= mapData.width)
        return null;
      return mapData.tiles?.[row * mapData.width + col] ?? null;
    },
    [mapData],
  );

  // Calculate reachable tiles when selected unit changes. This is the ONLY
  // source for the selected unit's movement range, so auto-selection (turn
  // queue, focusOnNextUnit, unit-moved events) behaves exactly like a click.
  useEffect(() => {
    const selectedUnitId = gameState.selectedUnit;

    // Clear reachable tiles if no unit selected or not human player's turn
    if (!selectedUnitId || gameState.activePlayer !== HUMAN_PLAYER_ID) {
      setReachableTiles(new Map());
      return;
    }

    // Only show for the human player's own units
    const unit = units.find((u) => u.id === selectedUnitId);
    if (!unit || unit.civilizationId !== HUMAN_PLAYER_ID) {
      setReachableTiles(new Map());
      return;
    }

    if (mapData && terrain) {
      setReachableTiles(
        Pathfinding.getReachableTiles(
          unit.col,
          unit.row,
          unit.movesRemaining || 0,
          getTileAt,
          unit.type,
          mapData.width,
          mapData.height,
          unit,
        ),
      );
    }
  }, [
    gameState.selectedUnit,
    gameState.activePlayer,
    units,
    mapData,
    terrain,
    getTileAt,
  ]);

  // Selection can change without any mouse movement (auto-select at turn start,
  // unit-moved events). Drop the stale hover-path preview; it is recomputed on
  // the next mouse move.
  useEffect(() => {
    lastHoverKeyRef.current = "";
    previewPathRef.current = null;
    previewTurnMarkersRef.current = [];
  }, [gameState.selectedUnit]);

  const squareToScreen = useCallback(
    (col: number, row: number): { x: number; y: number } => {
      // Return the center of the tile, not the top-left corner
      const x = ((col + 0.5) * TILE_SIZE - camera.x) * camera.zoom;
      const y = ((row + 0.5) * TILE_SIZE - camera.y) * camera.zoom;
      return { x, y };
    },
    [camera.x, camera.y, camera.zoom],
  );

  const screenToSquare = useCallback(
    (screenX: number, screenY: number): HexCoordinates => {
      // Adjust for camera position and zoom
      const worldX = screenX / camera.zoom + camera.x;
      const worldY = screenY / camera.zoom + camera.y;

      // Simple square coordinate conversion - use floor so clicks map
      // to the tile that contains the point (avoid rounding at corners)
      let col = Math.floor(worldX / TILE_SIZE);
      let row = Math.floor(worldY / TILE_SIZE);

      // Clamp to map bounds
      col = Math.max(0, Math.min(mapData.width - 1, col));
      row = Math.max(0, Math.min(mapData.height - 1, row));

      return { col, row };
    },
    [camera.x, camera.y, camera.zoom, mapData.height, mapData.width],
  );

  // Helper accessors: support multiple engine shapes (engine.getUnitAt or engine.map.getUnitAt or fallback to engine.units[])
  const getUnitAtFromEngine = (col: number, row: number): Unit | null => {
    if (!gameEngine) return null;
    try {
      if (typeof gameEngine.getUnitAt === "function")
        return gameEngine.getUnitAt(col, row);
      const mapObj = gameEngine.map as {
        getUnitAt?: (c: number, r: number) => Unit | null;
      } | null;
      if (mapObj && typeof mapObj.getUnitAt === "function")
        return mapObj.getUnitAt(col, row);
      const unitsArr = gameEngine.units;
      if (Array.isArray(unitsArr))
        return (
          unitsArr.find((u: Unit) => u && u.col === col && u.row === row) ||
          null
        );
    } catch (err) {
      console.error("[GameCanvas] getUnitAtFromEngine error", err);
    }
    return null;
  };

  const getCityAtFromEngine = (col: number, row: number): City | null => {
    if (!gameEngine) return null;
    try {
      if (typeof gameEngine.getCityAt === "function")
        return gameEngine.getCityAt(col, row);
      const mapObj = gameEngine.map as {
        getCityAt?: (c: number, r: number) => City | null;
      } | null;
      if (mapObj && typeof mapObj.getCityAt === "function")
        return mapObj.getCityAt(col, row);
      const citiesArr = gameEngine.cities;
      if (Array.isArray(citiesArr))
        return (
          citiesArr.find((c: City) => c && c.col === col && c.row === row) ||
          null
        );
    } catch (err) {
      console.error("[GameCanvas] getCityAtFromEngine error", err);
    }
    return null;
  };

  const getAllUnitsFromEngine = (): Unit[] => {
    if (!gameEngine) return [];
    try {
      if (typeof gameEngine.getAllUnits === "function")
        return gameEngine.getAllUnits();
      const unitsArr = gameEngine.units;
      if (Array.isArray(unitsArr)) return unitsArr;
      const mapObj = gameEngine.map as { getAllUnits?: () => Unit[] } | null;
      if (mapObj && typeof mapObj.getAllUnits === "function")
        return mapObj.getAllUnits();
    } catch (err) {
      console.error("[GameCanvas] getAllUnitsFromEngine error", err);
    }
    return [];
  };

  const getAllCitiesFromEngine = (): City[] => {
    if (!gameEngine) return [];
    try {
      if (typeof gameEngine.getAllCities === "function")
        return gameEngine.getAllCities();
      const citiesArr = gameEngine.cities;
      if (Array.isArray(citiesArr)) return citiesArr;
      const mapObj = gameEngine.map as { getAllCities?: () => City[] } | null;
      if (mapObj && typeof mapObj.getAllCities === "function")
        return mapObj.getAllCities();
    } catch (err) {
      console.error("[GameCanvas] getAllCitiesFromEngine error", err);
    }
    return [];
  };

  // Compute the reachable tiles for a unit (pure; returns a fresh map).
  const getReachableForUnit = useCallback(
    (unit: Unit): Map<string, number> => {
      if (!unit || !mapData || !terrain) return new Map();
      try {
        return Pathfinding.getReachableTiles(
          unit.col,
          unit.row,
          unit.movesRemaining || 0,
          getTileAt,
          unit.type,
          mapData.width,
          mapData.height,
          unit,
        );
      } catch (e) {
        console.error("[GameCanvas] getReachableForUnit error", e);
        return new Map();
      }
    },
    [mapData, terrain, getTileAt],
  );

  /**
   * Whether a unit may be previewed by the UI: the human player's own units, or
   * an enemy/AI unit on a tile the human can currently see (fog of war). Dev
   * mode reveals everything.
   */
  const isUnitVisibleToHuman = useCallback(
    (unit: Unit): boolean => {
      if (devMode) return true;
      if (unit.civilizationId === HUMAN_PLAYER_ID) return true;
      const width = mapData?.width ?? 0;
      if (!width) return false;
      return !!mapData?.visibility?.[unit.row * width + unit.col];
    },
    [devMode, mapData],
  );

  const renderStaticContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Rebuild offscreen terrain canvas if textures just loaded
    if (terrainRebuildNeededRef.current) {
      terrainRebuildNeededRef.current = false;
      renderTerrainToOffscreen(terrain);
    }

    // Keep the cached rect fresh (used by the hot mouse-move path) and reuse it
    // here instead of calling getBoundingClientRect() a second time.
    syncCanvasRect();
    const rect = canvasRectRef.current;
    // Round the fractional CSS size to match the integer backing store: writing
    // a fractional value truncates and never matches `clientWidth`, which made
    // the size watchdog below re-render (and re-allocate the bitmap) forever.
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);
    if (canvas.width !== cssWidth || canvas.height !== cssHeight) {
      canvas.width = cssWidth;
      canvas.height = cssHeight;
    }

    if (minimap) {
      miniMapRendererRef.current.renderMinimap({
        ctx,
        map: mapData as MapState,
        cssWidth: rect.width,
        cssHeight: rect.height,
        camera,
        units,
        cities,
        civilizations,
      });
      return;
    }

    // Render static content (terrain, cities, units without animation)
    mapRendererRef.current.renderStaticFrame({
      ctx,
      canvas,
      map: mapData as MapState,
      terrainGrid: terrain,
      camera,
      selectedHex,
      citizenReassign,
      gameState: gameState as GameState,
      units,
      cities,
      civilizations,
      unitPaths,
      offscreenCanvas: terrainCanvasRef.current,
      // Bypass the ground cache while the camera is gliding: the camera changes
      // every frame, so caching would only add a second full-canvas blit.
      groundCacheCanvas: cameraTweenRef.current
        ? null
        : groundCacheCanvasRef.current,
      groundCacheKey: cameraTweenRef.current
        ? undefined
        : [
            camera.x,
            camera.y,
            camera.zoom,
            cssWidth,
            cssHeight,
            terrainVersionRef.current,
          ].join("|"),
      squareToScreen,
      cameraZoom: camera.zoom,
      reachableTiles: hoverReachableRef.current
        ? hoverReachableRef.current.tiles
        : reachableTiles,
      reachableUnitType: hoverReachableRef.current
        ? hoverReachableRef.current.unitType
        : (selectedUnit?.type ?? null),
      hoveredHex: hoveredHexRef.current,
      previewPath: previewPathRef.current,
      previewTurnMarkers: previewTurnMarkersRef.current,
      combatAnimations,
      movementAnimations,
    });
  }, [
    minimap,
    mapData,
    terrain,
    camera,
    selectedHex,
    citizenReassign,
    gameState,
    units,
    cities,
    civilizations,
    unitPaths,
    squareToScreen,
    reachableTiles,
    selectedUnit,
    combatAnimations,
    movementAnimations,
    renderTerrainToOffscreen,
    syncCanvasRect,
  ]);

  /**
   * Redraws the transparent overlay canvas that sits **above** the units.
   *
   * It is fully cleared every frame, so a pulsing circle can never smear or
   * leave a trail — unlike the old "restore a small rect from a full-canvas
   * snapshot" scheme, which had to guess at the drawn footprint (and got it
   * wrong for the 💤 icon and the glow) and mismatched the restored regions
   * against the drawn set.
   */
  const renderOverlayLayer = useCallback(
    (currentTime: number) => {
      const overlay = overlayCanvasRef.current;
      const mainCanvas = canvasRef.current;
      if (!overlay || !mainCanvas) return;

      const cssWidth =
        Math.round(canvasRectRef.current.width) || mainCanvas.width;
      const cssHeight =
        Math.round(canvasRectRef.current.height) || mainCanvas.height;
      if (overlay.width !== cssWidth || overlay.height !== cssHeight) {
        overlay.width = cssWidth;
        overlay.height = cssHeight;
      }
      const overlayCtx = overlay.getContext("2d");
      if (!overlayCtx) return;

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

      // The current turn-queue unit always pulses; the manually selected unit
      // pulses too (when it belongs to the active player and can still move).
      const selectedUnitId = gameState.selectedUnit ?? null;
      const hasPulsingUnit =
        !!currentQueueUnitId ||
        (selectedUnitId !== null &&
          units.some(
            (u) =>
              u.id === selectedUnitId &&
              u.civilizationId === gameState.activePlayer &&
              (u.movesRemaining || 0) > 0,
          ));
      if (!hasPulsingUnit) return;

      mapRendererRef.current.renderPulsingUnits({
        ctx: overlayCtx,
        map: mapData as MapState,
        units,
        gameState: gameState as GameState,
        civilizations,
        currentTime,
        squareToScreen,
        cameraZoom: camera.zoom,
        currentQueueUnitId: currentQueueUnitId ?? undefined,
        selectedUnitId,
        combatAnimations,
        movementAnimations,
      });
    },
    [
      camera.zoom,
      civilizations,
      combatAnimations,
      currentQueueUnitId,
      gameState,
      mapData,
      movementAnimations,
      squareToScreen,
      units,
    ],
  );

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Cancel any in-progress camera glide when the user interacts directly.
    cameraTweenRef.current = null;
    actions.clearCameraPanRequest();

    // Only the primary (left) button starts a drag-pan. Right/middle clicks
    // open the context menu instead — starting a drag for them would leave
    // `isDragging` stuck as true (the context menu's backdrop swallows the
    // matching mouseup), fixating the cursor on the "grabbing" hand.
    if (e.button !== 0) {
      return;
    }
    // While a unit is selected the map is in movement mode: a left-drag would
    // otherwise also fire a click and issue a move order.
    if (isUnitSelectionMode) {
      return;
    }

    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    triggerRender(); // Immediate render for visual feedback
  };

  /** Clear all hover-preview state. */
  const clearHoverPreview = useCallback(() => {
    lastHoverKeyRef.current = "";
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    hoveredHexRef.current = null;
    hoverReachableRef.current = null;
    previewPathRef.current = null;
    previewTurnMarkersRef.current = [];
  }, []);

  // Hover: preview a unit's movement range, or the selected unit's shortest
  // path to the hovered destination (with turn numbers for multi-turn moves).
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && !isUnitSelectionMode) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      actions.updateCamera({
        x: camera.x - dx / camera.zoom,
        y: camera.y - dy / camera.zoom,
      });
      setLastMousePos({ x: e.clientX, y: e.clientY });
      // Camera changes will trigger render via useEffect
      return;
    }

    const rect = canvasRectRef.current;
    if (!rect.width || !rect.height) return;
    const hex = screenToSquare(e.clientX - rect.left, e.clientY - rect.top);

    const hoverUnit = getUnitAtFromEngine(hex.col, hex.row);
    const hoverUnitVisible = hoverUnit
      ? isUnitVisibleToHuman(hoverUnit)
      : false;
    const selId = gameState.selectedUnit;
    const selUnit = selId ? (units.find((u) => u.id === selId) ?? null) : null;

    // Cheap key so we only recompute when the hovered tile or units changed.
    const hoverKey = [
      hex.col,
      hex.row,
      hoverUnitVisible && hoverUnit ? hoverUnit.id : "-",
      selId ?? "-",
      selUnit
        ? `${selUnit.col},${selUnit.row},${selUnit.movesRemaining},${selUnit.hasMovedThisTurn ? 1 : 0}`
        : "-",
    ].join("|");
    if (hoverKey === lastHoverKeyRef.current) return;
    lastHoverKeyRef.current = hoverKey;

    // Any hover change cancels a pending deferred preview computation.
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    hoveredHexRef.current = hex;

    if (hoverUnit && hoverUnitVisible) {
      // Show the hovered unit's movement capabilities.
      const cacheKey = `${hoverUnit.id}:${hoverUnit.col},${hoverUnit.row}:${hoverUnit.movesRemaining}:${hoverUnit.hasMovedThisTurn ? 1 : 0}`;
      let tiles = reachableCacheRef.current.get(cacheKey);
      if (!tiles) {
        tiles = getReachableForUnit(hoverUnit);
        reachableCacheRef.current.set(cacheKey, tiles);
        // Bound the cache so it can't grow without limit.
        if (reachableCacheRef.current.size > 64) {
          const oldest = reachableCacheRef.current.keys().next().value;
          if (oldest !== undefined) reachableCacheRef.current.delete(oldest);
        }
      }
      hoverReachableRef.current = {
        unitId: hoverUnit.id,
        unitType: hoverUnit.type,
        tiles,
      };
      previewPathRef.current = null;
      previewTurnMarkersRef.current = [];
      triggerRender();
      return;
    }

    // No visible unit under the cursor: preview the selected unit's path here.
    hoverReachableRef.current = null;
    const onSelectedTile =
      !!selUnit && selUnit.col === hex.col && selUnit.row === hex.row;
    const wantsPreview =
      isUnitSelectionMode && !!selUnit && !onSelectedTile && !!mapData;

    if (!wantsPreview) {
      previewPathRef.current = null;
      previewTurnMarkersRef.current = [];
      triggerRender();
      return;
    }

    // Draw the plain hover outline immediately, then compute the (comparatively
    // expensive) shortest path on a later tick. Sweeping the mouse across the map
    // dispatches many mousemoves but only the tile the pointer comes to rest on
    // ever runs A* — previously every intermediate tile blocked the main thread
    // inside the event handler, which is what made the *last* hovered tile feel
    // like it registered late.
    previewPathRef.current = null;
    previewTurnMarkersRef.current = [];
    triggerRender();

    const previewUnit = selUnit;
    const previewMap = mapData;
    const targetCol = hex.col;
    const targetRow = hex.row;
    const requestedKey = hoverKey;
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      // Bail out if the pointer moved on while this was queued.
      if (lastHoverKeyRef.current !== requestedKey) return;
      const preview = computeMovementPreview(
        previewUnit,
        targetCol,
        targetRow,
        getTileAt,
        previewMap.width,
        previewMap.height,
      );
      if (lastHoverKeyRef.current !== requestedKey) return;
      previewPathRef.current = preview ? preview.steps : null;
      previewTurnMarkersRef.current = preview ? preview.turnMarkers : [];
      triggerRender();
    }, 0);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    triggerRender(); // Render to update cursor state
  };

  const handleMouseLeave = () => {
    clearHoverPreview();
    setIsDragging(false);
    triggerRender();
  };

  // ---- Citizen reassignment (pick up & drop) ----
  // A left-click while a citizen is being carried: DROP it on an available
  // (unworked, in-radius) tile, or ABORT when clicking far outside the city's
  // workable radius. Clicking the origin/another worked tile keeps the grab.
  const handleCitizenDrop = (hex: HexCoordinates) => {
    const re = citizenReassign;
    if (!re) return;
    const city = cities.find((c) => c.id === re.cityId);
    if (!city) {
      actions.endCitizenReassign();
      triggerRender();
      return;
    }
    const inRadius =
      gameEngine?.isTileInCityRadius?.(city, hex.col, hex.row) ?? false;
    const isCenter = hex.col === city.col && hex.row === city.row;
    const worked = city.workingTiles ?? new Set<string>();
    const key = `${hex.col},${hex.row}`;
    if (!isCenter && inRadius && !worked.has(key)) {
      const ok = !!gameEngine?.reassignCitizen?.(
        re.cityId,
        re.col,
        re.row,
        hex.col,
        hex.row,
      );
      actions.endCitizenReassign();
      triggerRender();
      if (!ok && actions.addNotification) {
        actions.addNotification({
          type: "warning",
          message: "Cannot move citizen to that tile",
        });
      }
    } else if (!inRadius) {
      // Abort: clicked well outside the city's workable radius.
      actions.endCitizenReassign();
      triggerRender();
    }
    // Clicking the origin / another worked tile / the center keeps the grab.
  };

  /** Remove a unit's assigned GoTo path (engine + local render state). */
  const cancelUnitPath = useCallback(
    (unitId: string, unitType?: string) => {
      gameEngine?.goToManager?.clearUnitPath(unitId);
      setUnitPaths((prev) => {
        if (!prev.has(unitId)) return prev;
        const next = new Map(prev);
        next.delete(unitId);
        return next;
      });
      if (unitType && actions?.addNotification) {
        actions.addNotification({
          type: "info",
          message: `GoTo cancelled for ${unitType}`,
        });
      }
      triggerRender();
    },
    [gameEngine, actions, triggerRender],
  );

  /**
   * Assign a GoTo path to a unit and move it as far as it can this turn.
   * The remaining steps stay in the engine so `TurnManager.processAutomatedMovements`
   * continues the journey on the following turns.
   */
  const assignUnitPath = useCallback(
    (unit: Unit, targetCol: number, targetRow: number) => {
      const goToManager = gameEngine?.goToManager;
      if (!goToManager || !mapData) {
        if (actions?.addNotification)
          actions.addNotification({
            type: "error",
            message: "GoTo system unavailable",
          });
        return;
      }

      const pathResult = goToManager.calculatePath(
        unit,
        targetCol,
        targetRow,
        getTileAt,
        mapData.width,
        mapData.height,
      );

      if (!pathResult.success || pathResult.path.length === 0) {
        if (actions?.addNotification) {
          actions.addNotification({
            type: "warning",
            message: "Cannot reach destination",
          });
        }
        return;
      }

      goToManager.setUnitPath(unit.id, pathResult.path);
      setUnitPaths((prev) => {
        const next = new Map(prev);
        next.set(unit.id, pathResult.path);
        return next;
      });
      // The hover preview is now committed; clear it until the mouse moves again.
      previewPathRef.current = null;
      previewTurnMarkersRef.current = [];

      if (actions?.addNotification) {
        actions.addNotification({
          type: "success",
          message: `${unit.type} will go to (${targetCol}, ${targetRow})`,
        });
      }
      triggerRender();

      if ((unit.movesRemaining || 0) > 0) {
        setTimeout(() => {
          goToManager
            .executePathWithAnimation(unit.id, 300, () => {
              const remaining = goToManager.getUnitPath(unit.id);
              setUnitPaths((prev) => {
                const next = new Map(prev);
                if (remaining && remaining.length > 0) {
                  next.set(unit.id, remaining);
                } else {
                  next.delete(unit.id);
                }
                return next;
              });
              triggerRender();
            })
            .then(() => triggerRender());
        }, 100);
      }
    },
    [gameEngine, mapData, getTileAt, actions, triggerRender],
  );

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Minimap click - jump to location
      if (minimap) {
        const canvas = canvasRef.current;
        const tileWidth = canvas.width / mapData.width;
        const tileHeight = canvas.height / mapData.height;

        const clickedCol = Math.floor(x / tileWidth);
        const clickedRow = Math.floor(y / tileHeight);

        console.log(`[CLICK] Minimap click at (${clickedCol}, ${clickedRow})`);

        // Center camera on clicked position
        actions.updateCamera({
          x: clickedCol * TILE_SIZE - canvas.width / camera.zoom / 2,
          y: clickedRow * TILE_SIZE - canvas.height / camera.zoom / 2,
        });
      } else {
        const hex = screenToSquare(x, y);

        // Citizen reassignment takes priority over normal click handling: if
        // we are carrying a citizen, this click is a drop or an abort.
        if (citizenReassign) {
          handleCitizenDrop(hex);
          return;
        }

        // Pick-up: with a city selected, left-clicking one of its WORKED tiles
        // (green border, no player unit standing on it) grabs a citizen so it
        // can be dropped on another tile in the city's radius.
        // Uses selectedCity OR focusedCity (the persistent marker that keeps
        // the yellow net visible after the modal is closed / unit is selected).
        const activeCityId = gameState.selectedCity ?? gameState.focusedCity;
        if (!citizenReassign && gameEngine && activeCityId) {
          const selCity = cities.find((c) => c.id === activeCityId);
          const onTileUnit = gameEngine.getUnitAt?.(hex.col, hex.row);
          const isCityCenter =
            selCity !== undefined &&
            hex.col === selCity.col &&
            hex.row === selCity.row;
          const worked = selCity?.workingTiles ?? new Set<string>();
          const isWorked = worked.has(`${hex.col},${hex.row}`);
          const inRadius = selCity
            ? (gameEngine.isTileInCityRadius?.(selCity, hex.col, hex.row) ??
              false)
            : false;
          const ownUnitOnTile = !!(
            onTileUnit &&
            currentPlayer &&
            onTileUnit.civilizationId === currentPlayer.id
          );
          if (
            selCity &&
            !isCityCenter &&
            isWorked &&
            inRadius &&
            !ownUnitOnTile
          ) {
            actions.setCitizenReassign({
              cityId: selCity.id,
              col: hex.col,
              row: hex.row,
            });
            setSelectedHex(hex);
            triggerRender();
            return;
          }
        }

        // Resolve what is at this location once; all branches below use it.
        let unitAt = null;
        let cityAt: { id: string; name: string; civilizationId: number } | null;
        try {
          unitAt = getUnitAtFromEngine(hex.col, hex.row);
          cityAt = getCityAtFromEngine(hex.col, hex.row);
        } catch {
          unitAt = null;
          cityAt = undefined;
        }

        // Clicking an already-selected *empty* hex clears the selection. Unit
        // and city tiles are handled below — re-clicking a unit must NOT
        // deselect it (it cancels its GoTo path instead).
        if (
          !unitAt &&
          selectedHex.col === hex.col &&
          selectedHex.row === hex.row &&
          !isUnitSelectionMode &&
          !gameState.selectedUnit
        ) {
          console.log(
            `[CLICK] Deselecting selected hex (${hex.col}, ${hex.row})`,
          );
          if (actions && typeof actions.selectUnit === "function") {
            actions.selectUnit(null);
          }
          if (actions && typeof actions.selectCity === "function") {
            actions.selectCity(null);
          }
          setSelectedHex({ col: -1, row: -1 });
          return;
        }

        setSelectedHex(hex);
        setContextMenu(null); // Hide context menu on left click

        console.log(`[CLICK] Map click at hex (${hex.col}, ${hex.row})`);

        // Select the hex in the global store
        if (actions && typeof actions.selectHex === "function") {
          actions.selectHex(hex);
        }

        if (
          unitAt &&
          currentPlayer &&
          unitAt.civilizationId === currentPlayer.id
        ) {
          if (gameState.selectedUnit === unitAt.id) {
            // Re-clicking the selected unit orders it to its own tile, which
            // cancels any assigned GoTo path. The unit stays selected.
            console.log(
              `[CLICK] Re-clicked selected unit ${unitAt.id} - cancelling its path`,
            );
            cancelUnitPath(unitAt.id, unitAt.type);
            return;
          }

          if (actions && typeof actions.selectUnit === "function") {
            actions.selectUnit(unitAt.id);
          }
          console.log(`[CLICK] Selected unit ${unitAt.id} (${unitAt.type})`);
          triggerRender();
        } else if (
          unitAt &&
          currentPlayer &&
          unitAt.civilizationId !== currentPlayer.id
        ) {
          // Enemy unit - check if we have a selected unit that can attack
          console.log(`[CLICK] Enemy unit at (${hex.col}, ${hex.row})`);
          if (selectedUnit) {
            if (selectedUnit.civilizationId === currentPlayer?.id) {
              // Check if adjacent or use pathfinding to get there and attack
              const isAdjacent =
                Math.abs(selectedUnit.col - hex.col) <= 1 &&
                Math.abs(selectedUnit.row - hex.row) <= 1;

              if (isAdjacent && (selectedUnit.movesRemaining || 0) > 0) {
                console.log(
                  `[CLICK] Adjacent attack - attempting to move/attack`,
                );
                try {
                  // MoveAnimator lunges toward the defender, then commits combat.
                  moveAnimator?.attack(selectedUnit.id, hex.col, hex.row);
                } catch (e) {
                  console.log(`[CLICK] Attack error:`, e);
                }
              } else {
                console.log(
                  `[CLICK] Unit not adjacent to enemy - cannot attack`,
                );
                if (actions?.addNotification) {
                  actions.addNotification({
                    type: "warning",
                    message: "Unit must be adjacent to attack",
                  });
                }
              }
            }
          } else {
            console.log(`[CLICK] No unit selected to attack with`);
          }
        } else if (isUnitSelectionMode && selectedUnit) {
          // Moving a selected unit takes precedence over city selection: while
          // a unit is selected, clicking a tile issues a GoTo order.
          assignUnitPath(selectedUnit, hex.col, hex.row);
        } else if (cityAt) {
          console.log(
            `[CLICK] Selected city ${cityAt.id} (${cityAt.name}) at (${hex.col}, ${hex.row})`,
          );
          if (actions && typeof actions.selectCity === "function") {
            actions.selectCity(cityAt.id);
          }
          if (
            currentPlayer &&
            cityAt.civilizationId === currentPlayer.id &&
            actions &&
            typeof actions.showDialog === "function"
          ) {
            actions.showDialog("city-details");
          }
          triggerRender();
        } else {
          console.log(`[CLICK] Empty hex clicked at (${hex.col}, ${hex.row})`);
          triggerRender();
        }
      }
    }
  };

  const handleRightClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Right-click never starts a drag — ensure any stale drag state is cleared
    // so the cursor doesn't stay stuck on the "grabbing" hand.
    setIsDragging(false);

    // Right-click aborts a citizen pick-up (cancel the grab without altering
    // any tile) before opening the unit context menu.
    if (citizenReassign) {
      console.log("[RightClick] Cancelling citizen reassignment");
      actions.endCitizenReassign();
      triggerRender();
      return;
    }

    // Right-click always ends unit selection mode. The context menu below is
    // independent of selection (the unit is not re-selected by it).
    if (gameState.selectedUnit) {
      console.log("[RightClick] Clearing unit selection");
      clearHoverPreview();
      setReachableTiles(new Map());
      if (actions && typeof actions.selectUnit === "function") {
        actions.selectUnit(null);
      }
      triggerRender();
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hex = screenToSquare(x, y);

    if (!terrain) return;

    // Get unit at this location from gameEngine first (most reliable)
    let unitAtHex = null;
    try {
      unitAtHex = getUnitAtFromEngine(hex.col, hex.row);
    } catch (e) {
      console.error("[ContextMenu] Error getting unit from gameEngine:", e);
    }

    // Check if it's a player's unit
    if (!unitAtHex || unitAtHex.civilizationId !== currentPlayer?.id) {
      console.log("[ContextMenu] Not player unit, skipping menu");
      return;
    }

    console.log(
      `[ContextMenu] Right-clicked player unit ${unitAtHex.id} (${unitAtHex.type})`,
    );

    // Get city at this location
    let cityAtHex = null;
    try {
      cityAtHex = getCityAtFromEngine(hex.col, hex.row);
    } catch {
      // City not found, that's OK
    }

    const tile = terrain[hex.row]?.[hex.col];

    // Set context menu with the actual unit/city objects
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      hex: hex,
      tile: tile,
      unit: unitAtHex,
      city: cityAtHex,
    });
  };

  // ---- Touch gestures (mobile) ----
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchLongPress = (clientX: number, clientY: number) => {
    // Reuse the right-click context menu flow for long-press
    handleRightClick({
      clientX,
      clientY,
      preventDefault: () => {},
    } as React.MouseEvent<HTMLCanvasElement>);
  };

  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (isUnitSelectionMode) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const newZoom = Math.min(camera.zoom * 1.5, 2.5);
    const worldXBefore = x / camera.zoom + camera.x;
    const worldYBefore = y / camera.zoom + camera.y;
    const worldXAfter = x / newZoom + camera.x;
    const worldYAfter = y / newZoom + camera.y;
    actions.updateCamera({
      zoom: newZoom,
      x: camera.x - (worldXAfter - worldXBefore),
      y: camera.y - (worldYAfter - worldYBefore),
    });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touches = e.touches;

    if (touches.length === 1) {
      const t = touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, id: t.identifier };
      touchMovedRef.current = false;
      pinchStartRef.current = null;
      clearLongPressTimer();

      // Long-press opens the unit context menu
      longPressTimerRef.current = window.setTimeout(() => {
        if (!touchMovedRef.current && touchStartRef.current) {
          if (navigator.vibrate) {
            try {
              navigator.vibrate(20);
            } catch {
              /* unsupported */
            }
          }
          handleTouchLongPress(
            touchStartRef.current.x,
            touchStartRef.current.y,
          );
          touchMovedRef.current = true; // suppress tap on release
        }
      }, LONG_PRESS_MS);
    } else if (touches.length === 2) {
      // Begin pinch zoom
      clearLongPressTimer();
      touchStartRef.current = null;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      pinchStartRef.current = {
        distance: Math.hypot(dx, dy),
        zoom: camera.zoom,
      };
      setIsDragging(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touches = e.touches;

    if (touches.length === 1 && touchStartRef.current) {
      const t = touches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;

      if (Math.abs(dx) > TOUCH_TAP_SLOP || Math.abs(dy) > TOUCH_TAP_SLOP) {
        touchMovedRef.current = true;
        clearLongPressTimer();
      }

      // One-finger pan (skip while a unit is selected so taps place the destination)
      if (touchMovedRef.current && !isUnitSelectionMode) {
        actions.updateCamera({
          x: camera.x - dx / camera.zoom,
          y: camera.y - dy / camera.zoom,
        });
        touchStartRef.current = {
          x: t.clientX,
          y: t.clientY,
          id: t.identifier,
        };
      }
    } else if (touches.length === 2 && pinchStartRef.current) {
      clearLongPressTimer();
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const distance = Math.hypot(dx, dy);
      const scale = distance / pinchStartRef.current.distance;
      const newZoom = Math.max(
        0.3,
        Math.min(2.5, pinchStartRef.current.zoom * scale),
      );
      actions.updateCamera({ zoom: newZoom });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    clearLongPressTimer();

    if (e.touches.length === 0) {
      const now = Date.now();
      const wasTap =
        !!touchStartRef.current &&
        !touchMovedRef.current &&
        !pinchStartRef.current;

      if (wasTap && touchStartRef.current) {
        const { x, y } = touchStartRef.current;
        // Double-tap zoom, otherwise a plain tap acts like a click
        if (now - lastTouchEndRef.current < DOUBLE_TAP_MS) {
          handleDoubleTap(x, y);
          lastTouchEndRef.current = 0;
        } else {
          lastTouchEndRef.current = now;
          handleClick({
            clientX: x,
            clientY: y,
            preventDefault: () => {},
          } as React.MouseEvent<HTMLCanvasElement>);
        }
      }

      touchStartRef.current = null;
      pinchStartRef.current = null;
      touchMovedRef.current = false;
    } else if (e.touches.length === 1) {
      // One finger remains after a pinch — reset the pan base
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, id: t.identifier };
      touchMovedRef.current = false;
      pinchStartRef.current = null;
    }
  };

  const handleTouchCancel = () => {
    clearLongPressTimer();
    touchStartRef.current = null;
    pinchStartRef.current = null;
    touchMovedRef.current = false;
  };

  /** "Road construction started (2 turns)" — Civ1 multi-turn construction feedback. */
  const buildStartedMessage = (
    engine: GameEngine,
    unit: Unit,
    improvement: string,
  ): string => {
    const tile = engine.getTileAt(unit.col, unit.row) as
      | { terrain?: string; type?: string }
      | undefined;
    const terrain = tile?.terrain || tile?.type || "";
    const turns = engine.improvementBuildTurns?.(improvement, terrain) ?? 1;
    const label =
      improvement === "mines"
        ? "Mine"
        : improvement.charAt(0).toUpperCase() + improvement.slice(1);
    return `${label} construction started (${turns} turn${turns > 1 ? "s" : ""})`;
  };

  const executeContextAction = (action: string) => {
    console.log(`[ContextMenu] Executing action: ${action}`, { contextMenu });

    if (!contextMenu) return;

    const unit = contextMenu.unit;
    const city = contextMenu.city;

    switch (action) {
      // ===== UNIT ACTIONS =====
      case "fortify":
        if (unit && gameEngine?.unitFortify) {
          console.log(`[ContextMenu] Fortifying unit ${unit.id}`);
          gameEngine.unitFortify(unit.id);
          if (actions?.updateUnits)
            actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification)
            actions.addNotification({
              type: "success",
              message: `${unit.type} fortified`,
            });
        }
        break;

      case "sleep":
        if (unit && gameEngine) {
          if (unit.isSleeping && gameEngine.unitWake) {
            console.log(`[ContextMenu] Wake action for unit ${unit.id}`);
            gameEngine.unitWake(unit.id);
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: `${unit.type} woke up`,
              });
          } else if (gameEngine.unitSleep) {
            console.log(`[ContextMenu] Sleep action for unit ${unit.id}`);
            gameEngine.unitSleep(unit.id);
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: `${unit.type} sleeping`,
              });
          }
        }
        break;

      case "skip_turn":
        if (unit && gameEngine?.skipUnit) {
          console.log(`[ContextMenu] Skipping turn for unit ${unit.id}`);
          gameEngine.skipUnit(unit.id);
          if (actions?.updateUnits)
            actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification)
            actions.addNotification({
              type: "info",
              message: `${unit.type} turn skipped`,
            });
          if (actions?.selectUnit) actions.selectUnit(null);
        }
        break;

      case "goto":
        if (unit) {
          console.log(
            `[ContextMenu] Entering unit movement mode for ${unit.id}`,
          );
          // Selecting the unit enters movement mode (cursor + range + hover
          // path preview all derive from `gameState.selectedUnit`).
          if (actions?.selectUnit) actions.selectUnit(unit.id);
          setContextMenu(null); // Close the context menu
          if (actions?.addNotification)
            actions.addNotification({
              type: "info",
              message: `Click destination for ${unit.type} to go to`,
            });
        }
        break;

      case "goto_cancel":
        if (unit && gameEngine?.goToManager) {
          console.log(`[ContextMenu] Canceling Go To for unit ${unit.id}`);
          gameEngine.goToManager.clearUnitPath(unit.id);

          // Clear the path from local state to remove the rendered GoTo line
          setUnitPaths((prev) => {
            const next = new Map(prev);
            next.delete(unit.id);
            return next;
          });

          if (actions?.updateUnits)
            actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification)
            actions.addNotification({
              type: "info",
              message: `GoTo cancelled for ${unit.type}`,
            });
        }
        break;

      case "found_city":
        if (unit && gameEngine?.foundCityWithSettler) {
          console.log(`[ContextMenu] Found city action for unit ${unit.id}`);
          const result = gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            if (actions?.updateCities)
              actions.updateCities(getAllCitiesFromEngine());
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: "City founded!",
              });
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "Cannot found city here",
              });
          }
        }
        break;

      case "build_road":
        if (unit && gameEngine?.buildImprovement) {
          console.log(`[ContextMenu] Build road action for unit ${unit.id}`);
          const result = gameEngine.buildImprovement(unit.id, "road");
          if (result) {
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: buildStartedMessage(gameEngine, unit, "road"),
              });
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "Cannot build road here",
              });
          }
        }
        break;

      case "build_irrigation":
        if (unit && gameEngine?.buildImprovement) {
          console.log(
            `[ContextMenu] Build irrigation action for unit ${unit.id}`,
          );
          const result = gameEngine.buildImprovement(unit.id, "irrigation");
          if (result) {
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: buildStartedMessage(gameEngine, unit, "irrigation"),
              });
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "Cannot build irrigation here",
              });
          }
        }
        break;

      case "build_mine":
        if (unit && gameEngine?.buildImprovement) {
          console.log(`[ContextMenu] Build mine action for unit ${unit.id}`);
          const result = gameEngine.buildImprovement(unit.id, "mine");
          if (result) {
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: buildStartedMessage(gameEngine, unit, "mines"),
              });
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "Cannot build mine here",
              });
          }
        }
        break;

      case "build_railroad":
        if (unit && gameEngine?.buildImprovement) {
          console.log(
            `[ContextMenu] Build railroad action for unit ${unit.id}`,
          );
          const result = gameEngine.buildImprovement(unit.id, "railroad");
          if (result) {
            if (actions?.updateUnits)
              actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
            if (actions?.addNotification)
              actions.addNotification({
                type: "success",
                message: buildStartedMessage(gameEngine, unit, "railroad"),
              });
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "Cannot build railroad here",
              });
          }
        }
        break;

      // ===== CITY ACTIONS =====
      case "viewProduction":
        if (city) {
          console.log(`[ContextMenu] View production for city ${city.id}`);
          if (actions?.selectCity) actions.selectCity(city.id);
          if (actions?.showDialog) actions.showDialog("city-production");
        }
        break;

      case "cityInfo":
        if (city) {
          console.log(`[ContextMenu] View info for city ${city.id}`);
          if (actions?.selectCity) actions.selectCity(city.id);
          if (actions?.showDialog) actions.showDialog("city-details");
        }
        break;

      // ===== UNIT DISBAND =====
      case "disband_unit": {
        if (unit) {
          console.log(
            `[ContextMenu] Disbanding unit ${unit.id} (${unit.type})`,
          );
          if (gameEngine && typeof gameEngine.disbandUnit === "function") {
            gameEngine.disbandUnit(unit.id);
          } else if (actions?.updateUnits) {
            // Fallback: remove unit directly from store
            const allUnits = getAllUnitsFromEngine();
            actions.updateUnits(
              allUnits.filter((u: { id: string }) => u.id !== unit.id),
            );
          }
          if (actions?.addNotification) {
            actions.addNotification({
              type: "info",
              message: `Unit ${unit.type} disbanded`,
            });
          }
        }
        break;
      }

      // ===== DIPLOMAT ACTIONS =====
      case "diplomat_propose_peace":
      case "diplomat_propose_alliance":
      case "diplomat_demand_tribute":
      case "diplomat_bribe":
      case "diplomat_gather_intel": {
        if (
          unit &&
          gameEngine?.getDiplomatActions &&
          gameEngine?.executeDiplomatAction
        ) {
          const diplomatInfo = gameEngine.getDiplomatActions(unit.id);
          if (!diplomatInfo) {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: "No adjacent foreign unit or city for diplomacy",
              });
            break;
          }
          const actionMap: Record<string, string> = {
            diplomat_propose_peace: "propose_peace",
            diplomat_propose_alliance: "propose_alliance",
            diplomat_demand_tribute: "demand_tribute",
            diplomat_bribe: "bribe_unit",
            diplomat_gather_intel: "gather_intelligence",
          };
          const result = gameEngine.executeDiplomatAction(
            unit.id,
            actionMap[action],
            diplomatInfo.targetCivId,
          );
          if (actions?.updateUnits)
            actions.updateUnits(getAllUnitsFromEngine());
          // Civ I behaviour: a diplomat's contact opens the negotiation screen
          // focused on the foreign civ so the player can continue bargaining.
          if (actions?.openDiplomacy && diplomatInfo?.targetCivId != null) {
            actions.openDiplomacy(diplomatInfo.targetCivId);
          }
          if (result?.success) {
            if (result.type === "intelligence") {
              const r = result.report as Record<string, unknown> | undefined;
              if (actions?.addNotification) {
                actions.addNotification({
                  type: "info",
                  message: `📜 Intel on ${r?.civName ?? "Unknown"}: ${r?.numCities ?? "?"} cities, ${r?.numMilitaryUnits ?? "?"} military units, ${r?.gold ?? "?"} gold, researching ${r?.currentResearch ?? "nothing"}, govt: ${r?.government ?? "?"}, attitude: ${r?.attitude ?? "?"}`,
                });
              }
            } else if (result.type === "proposal") {
              const resp = result.response as
                | Record<string, unknown>
                | undefined;
              const accepted = resp?.accepted;
              if (actions?.addNotification)
                actions.addNotification({
                  type: accepted ? "success" : "warning",
                  message: accepted
                    ? `Proposal accepted!`
                    : `Proposal rejected: ${resp?.reason || "unknown"}`,
                });
            } else if (result.type === "bribe") {
              const resp = result.response as
                | Record<string, unknown>
                | undefined;
              if (actions?.addNotification)
                actions.addNotification({
                  type: resp?.success ? "success" : "warning",
                  message: resp?.success
                    ? "Unit bribed!"
                    : `Bribe failed: ${resp?.reason || "not enough gold"}`,
                });
            }
          } else {
            if (actions?.addNotification)
              actions.addNotification({
                type: "warning",
                message: result?.reason || "Diplomat action failed",
              });
          }
        }
        break;
      }

      // ===== GENERAL ACTIONS =====
      case "centerView":
        console.log(
          `[ContextMenu] Centering view on (${contextMenu.hex.col}, ${contextMenu.hex.row})`,
        );
        actions.updateCamera({
          x:
            contextMenu.hex.col * TILE_SIZE -
            canvasRef.current.width / (2 * camera.zoom),
          y:
            contextMenu.hex.row * TILE_SIZE -
            canvasRef.current.height / (2 * camera.zoom),
        });
        break;

      case "examineHex":
        console.log(
          `[ContextMenu] Examining hex (${contextMenu.hex.col}, ${contextMenu.hex.row})`,
        );
        if (onExamineHex) {
          onExamineHex(contextMenu.hex, contextMenu.tile);
        }
        break;

      default:
        console.warn(`[ContextMenu] Unknown action: ${action}`);
    }

    setContextMenu(null);
    triggerRender();
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Smoother zoom with smaller increments
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.max(0.3, Math.min(2.5, camera.zoom * zoomFactor));

    // Get mouse position for zoom centering
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate world position before zoom
    const worldXBefore = mouseX / camera.zoom + camera.x;
    const worldYBefore = mouseY / camera.zoom + camera.y;

    // Calculate world position after zoom
    const worldXAfter = mouseX / newZoom + camera.x;
    const worldYAfter = mouseY / newZoom + camera.y;

    // Adjust camera to keep mouse position stable
    actions.updateCamera({
      zoom: newZoom,
      x: camera.x - (worldXAfter - worldXBefore),
      y: camera.y - (worldYAfter - worldYBefore),
    });
  };

  // ── Single render loop (30 FPS) ─────────────────────────────────────────
  //
  // One loop drives everything: dirty static composites, movement/combat
  // re-renders, the camera glide and the above-unit overlay animation.
  //
  // It is mounted once for the whole game and never restarted — the previous
  // implementation had four separate rAF loops whose effects depended on
  // `renderStaticContent`, so they were torn down and recreated on almost every
  // state change (resetting their frame accumulators) and could render the same
  // frame two or three times over. Everything the loop needs is read through
  // refs instead of effect dependencies.
  const renderStaticRef = useRef<() => void>(() => {});
  const renderOverlayRef = useRef<(currentTime: number) => void>(() => {});
  const hasGameStateChangedRef = useRef<() => boolean>(() => false);
  const movementAnimationsRef = useRef(movementAnimations);
  const combatAnimationsRef = useRef(combatAnimations);
  const overlayActiveRef = useRef<boolean>(false);

  useEffect(() => {
    renderStaticRef.current = renderStaticContent;
    renderOverlayRef.current = renderOverlayLayer;
    hasGameStateChangedRef.current = hasGameStateChanged;
  }, [renderStaticContent, renderOverlayLayer, hasGameStateChanged]);

  // Active glides / combat animations need a fresh composite every tick. Kept in
  // refs (evaluated inside the loop) so the loop itself never restarts and stops
  // ticking as soon as the last animation's duration has elapsed.
  useEffect(() => {
    movementAnimationsRef.current = movementAnimations;
  }, [movementAnimations]);
  useEffect(() => {
    combatAnimationsRef.current = combatAnimations;
  }, [combatAnimations]);

  // The above-unit overlay only needs clearing/redrawing while something in it
  // is actually animating.
  useEffect(() => {
    const selectedUnitId = gameState.selectedUnit ?? null;
    const queueUnitCanPulse = currentQueueUnitId
      ? units.some((u) => u.id === currentQueueUnitId)
      : false;
    const selectedUnitCanPulse =
      selectedUnitId !== null &&
      units.some(
        (u) =>
          u.id === selectedUnitId &&
          u.civilizationId === gameState.activePlayer &&
          (u.movesRemaining || 0) > 0,
      );
    overlayActiveRef.current =
      queueUnitCanPulse ||
      selectedUnitCanPulse ||
      (citizenReassign !== null && citizenReassign !== undefined);
  }, [
    units,
    currentQueueUnitId,
    gameState.selectedUnit,
    gameState.activePlayer,
    citizenReassign,
  ]);

  useEffect(() => {
    if (minimap || !gameState.isGameStarted) return;

    let raf = 0;
    let lastFrame = 0;
    let overlayWasActive = false;
    const interval = 1000 / ANIMATION_FPS;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastFrame < interval) return;
      lastFrame = now - ((now - lastFrame) % interval);

      // 1. Camera glide — stepped from this loop so a pan never needs its own
      //    rAF chain and never composites the scene twice in one frame.
      const tween = cameraTweenRef.current;
      if (tween) {
        const t = Math.min(1, (now - tween.startTime) / tween.duration);
        const eased = MathUtils.fade(t);
        if (t >= 1) {
          cameraTweenRef.current = null;
          actions.updateCamera({ x: tween.targetX, y: tween.targetY });
          actions.clearCameraPanRequest();
        } else {
          actions.updateCamera({
            x: MathUtils.lerp(tween.startX, tween.targetX, eased),
            y: MathUtils.lerp(tween.startY, tween.targetY, eased),
          });
        }
      }

      // 2. Static composite — only when something invalidated it, the tracked
      //    game state moved on, or a glide/combat animation is in flight.
      const nowMs = performance.now();
      const animatingNow =
        movementAnimationsRef.current.some(
          (a) => nowMs - a.startTime < a.duration,
        ) ||
        combatAnimationsRef.current.some(
          (a) =>
            nowMs - a.startTime < a.duration + (a.deathBlinkDuration ?? 1000),
        );
      if (
        needsRender.current ||
        animatingNow ||
        hasGameStateChangedRef.current()
      ) {
        renderStaticRef.current();
        needsRender.current = false;
      }

      // 3. Above-unit overlay (pulse rings, …), redrawn from scratch every
      //    tick so nothing can smear.
      const overlayActive = overlayActiveRef.current;
      if (overlayActive || overlayWasActive) {
        renderOverlayRef.current(now);
      }
      overlayWasActive = overlayActive;
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      animationFrameRef.current = null;
    };
  }, [minimap, gameState.isGameStarted, actions]);

  // Resolve a camera-pan request into a glide target. The loop above performs
  // the actual tween; when animations are disabled the camera is committed
  // immediately instead.
  useEffect(() => {
    if (minimap || !gameState.isGameStarted) return;
    if (!cameraPanRequest) return;

    const state = useGameStore.getState();
    const cam = state.camera;
    const map = state.map;
    const canvas = canvasRef.current;
    const viewportWidth =
      canvasRectRef.current.width || canvas?.clientWidth || window.innerWidth;
    const viewportHeight =
      canvasRectRef.current.height ||
      canvas?.clientHeight ||
      window.innerHeight;
    const target = centerCameraOnTile({
      col: cameraPanRequest.col,
      row: cameraPanRequest.row,
      zoom: cam.zoom,
      viewportWidth,
      viewportHeight,
      mapWidth: map?.width ?? 0,
      mapHeight: map?.height ?? 0,
    });
    if (!isFinite(target.x) || !isFinite(target.y)) {
      cameraTweenRef.current = null;
      actions.clearCameraPanRequest();
      return;
    }

    const settings = state.settings;
    const duration =
      !settings.enableAnimations || settings.cameraGlideSpeed <= 0
        ? 0
        : Math.round(400 * settings.cameraGlideSpeed);

    if (duration <= 0) {
      // Animations disabled / set to instant: commit and finish immediately.
      cameraTweenRef.current = null;
      actions.updateCamera({ x: target.x, y: target.y });
      actions.clearCameraPanRequest();
      return;
    }

    cameraTweenRef.current = {
      startX: cam.x,
      startY: cam.y,
      targetX: target.x,
      targetY: target.y,
      startTime: performance.now(),
      duration,
    };
  }, [cameraPanRequest, minimap, gameState.isGameStarted, actions]);

  // Trigger render when camera changes (pan/zoom)
  useEffect(() => {
    // console.log('[GameCanvas] Camera changed, triggering render');
    triggerRender();
  }, [camera.x, camera.y, camera.zoom, triggerRender]);

  // Trigger render when selection changes
  useEffect(() => {
    triggerRender();
  }, [selectedHex, gameState.selectedCity, triggerRender]);

  // Trigger render when terrain changes
  useEffect(() => {
    triggerRender();
  }, [terrain, triggerRender]);

  // Trigger render when game state changes significantly
  useEffect(() => {
    triggerRender();
  }, [
    gameState.activePlayer,
    gameState.currentTurn,
    units.length,
    cities.length,
    triggerRender,
  ]);

  // Keep the canvas in sync with its container: when the window is resized
  // (desktop) or the layout changes, re-sync the backing store size and redraw
  // so the map is never stretched/blurry or left stale. We call the latest
  // render function directly (via a ref) so a plain CSS resize — which React
  // state doesn't see — still redraws immediately.
  useEffect(() => {
    if (minimap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Redraw only when the CSS size no longer matches the backing store. Both
    // sides are integers now that the backing store is rounded, so this
    // converges after a single redraw instead of firing forever.
    const check = () => {
      const c = canvasRef.current;
      if (!c) return;
      if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
        syncCanvasRectRef.current();
        renderStaticRef.current();
      }
    };

    // Fast path: real browsers fire these on window/layout changes.
    const ro = new ResizeObserver(check);
    ro.observe(canvas);
    window.addEventListener("resize", check);

    // The canvas can move without resizing (scrolling), which would stale the
    // cached rect used by the mouse-move path — refresh it on any scroll.
    const onScroll = () => syncCanvasRectRef.current();
    window.addEventListener("scroll", onScroll, true);

    // Reliable fallback for environments where resize events / ResizeObserver
    // are suppressed. Slow: it exists only to catch a lost layout change.
    const interval = window.setInterval(check, 2000);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", check);
      window.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
    };
  }, [minimap]);

  return (
    <div className="position-relative w-100 h-100">
      <canvas
        ref={canvasRef}
        className="w-100 h-100 game-canvas-input"
        style={{
          cursor: minimap
            ? "pointer"
            : citizenReassign
              ? "grabbing"
              : isUnitSelectionMode
                ? "crosshair"
                : isDragging
                  ? "grabbing"
                  : "grab",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        }}
        tabIndex={minimap ? -1 : 0}
        onMouseDown={minimap ? null : handleMouseDown}
        onMouseMove={minimap ? null : handleMouseMove}
        onMouseUp={minimap ? null : handleMouseUp}
        onMouseLeave={minimap ? null : handleMouseLeave}
        onClick={handleClick}
        onContextMenu={minimap ? null : handleRightClick}
        onWheel={minimap ? null : handleWheel}
        onTouchStart={minimap ? null : handleTouchStart}
        onTouchMove={minimap ? null : handleTouchMove}
        onTouchEnd={minimap ? null : handleTouchEnd}
        onTouchCancel={minimap ? null : handleTouchCancel}
      />

      {/*
        Overlay layer for animations that must be drawn *above* units (pulsing
        selection circle, glow). It is transparent and click-through, and is
        cleared and redrawn from scratch by the render loop — so nothing can
        smear or leave a trail. Ground-level visuals (hover outline, reachable
        range, preview path) stay on the main canvas below the units.
      */}
      {!minimap && (
        <canvas
          ref={overlayCanvasRef}
          className="w-100 h-100"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      )}

      {/* Context Menu (not shown on minimap) */}
      {!minimap && (
        <UnitActionsModal
          contextMenu={contextMenu}
          onExecuteAction={executeContextAction}
          onClose={() => setContextMenu(null)}
          gameEngine={gameEngine}
        />
      )}
    </div>
  );
};

export default GameCanvas;
