import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { TILE_SIZE } from '@/data/TerrainData';
import { MapRenderer, TerrainRenderGrid, TerrainTileRenderInfo, UnitPathStep } from '@/game/rendering/MapRenderer';
import type { City, GameEngine, GameState, MapState, Unit } from '../../../types/game';
import '../../styles/civ1GameCanvas.css';
import UnitActionsModal from './UnitActionsModal';
import { Pathfinding } from '@/game/engine/Pathfinding';
import { KeyboardHandler } from '@/game/engine/KeyboardHandler';

type HexCoordinates = { col: number; row: number };

interface GameCanvasProps {
  minimap?: boolean;
  onExamineHex?: (hex: HexCoordinates, tile: TerrainTileRenderInfo | null) => void;
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

const GameCanvas: React.FC<GameCanvasProps> = ({ minimap = false, onExamineHex, gameEngine = null }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRendererRef = useRef<MapRenderer>(new MapRenderer());
  const gameState = useGameStore(state => state.gameState);
  const mapData = useGameStore(state => state.map);
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const currentPlayer = useGameStore(state => state.civilizations[state.gameState.activePlayer] || null);
  const civilizations = useGameStore(state => state.civilizations);
  const currentQueueUnitId = useGameStore(state => state.uiState.currentQueueUnitId);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [lastMousePos, setLastMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedHex, setSelectedHex] = useState<HexCoordinates>({ col: 5, row: 5 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terrain, setTerrain] = useState<TerrainRenderGrid | null>(null);
  const storeGotoMode = useGameStore(state => state.uiState.goToMode);
  const storeGotoUnitId = useGameStore(state => state.uiState.goToUnit);
  const [gotoMode, setGotoMode] = useState<boolean>(false);
  const [gotoUnit, setGotoUnit] = useState<Unit | null>(null);
  const [unitPaths, setUnitPaths] = useState<Map<string, UnitPathStep[]>>(new Map());
  const [reachableTiles, setReachableTiles] = useState<Map<string, number>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const renderTimeoutRef = useRef<number | null>(null);
  const lastRenderTime = useRef<number>(0);
  const needsRender = useRef<boolean>(true);
  const lastGameState = useRef<any>(null);
  const animationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticRenderedRef = useRef<boolean>(false);

  // Trigger re-render when game state changes (turn-based optimization)
  const triggerRender = useCallback(() => {
    needsRender.current = true;
    staticRenderedRef.current = false;
  }, []);

  // Sync local GoTo state with store to ensure UI cursor updates correctly
  useEffect(() => {
    setGotoMode(!!storeGotoMode);
    if (storeGotoUnitId) {
      const unit = units.find(u => u.id === storeGotoUnitId) || null;
      setGotoUnit(unit);
    } else {
      setGotoUnit(null);
    }
  }, [storeGotoMode, storeGotoUnitId, units]);

  // Check if game state has changed significantly
  const hasGameStateChanged = useCallback(() => {
    const currentState = {
      activePlayer: gameState.activePlayer,
      currentTurn: gameState.currentTurn,
      units: units.length,
      cities: cities.length,
      selectedHex: selectedHex ? `${selectedHex.col},${selectedHex.row}` : null,
      selectedUnit: gameState.selectedUnit || null,
      reachableTilesSize: reachableTiles.size,
      cameraX: Math.round(camera.x),
      cameraY: Math.round(camera.y),
      cameraZoom: camera.zoom
    };

    if (!lastGameState.current) {
      lastGameState.current = currentState;
      return true;
    }

    // Compare each property individually to avoid expensive JSON.stringify
    const changed = currentState.activePlayer !== lastGameState.current.activePlayer ||
                    currentState.currentTurn !== lastGameState.current.currentTurn ||
                    currentState.units !== lastGameState.current.units ||
                    currentState.cities !== lastGameState.current.cities ||
                    currentState.selectedHex !== lastGameState.current.selectedHex ||
                    currentState.selectedUnit !== lastGameState.current.selectedUnit ||
                    currentState.reachableTilesSize !== lastGameState.current.reachableTilesSize ||
                    currentState.cameraX !== lastGameState.current.cameraX ||
                    currentState.cameraY !== lastGameState.current.cameraY ||
                    currentState.cameraZoom !== lastGameState.current.cameraZoom;

    if (changed) {
      lastGameState.current = currentState;
      return true;
    }
    return false;
  }, [camera, cities.length, gameState.activePlayer, gameState.currentTurn, gameState.selectedUnit, reachableTiles.size, selectedHex, units.length]);

  const renderTerrainToOffscreen = useCallback((terrainGrid: TerrainRenderGrid | null) => {
    if (!terrainGrid || !mapData) return;
    const offscreenCanvas = terrainCanvasRef.current;
    if (!offscreenCanvas) return;
    mapRendererRef.current.renderTerrainLayer({
      offscreenCanvas,
      map: mapData,
      terrainGrid
    });
  }, [mapData]);

  useEffect(() => {
    if (!terrainCanvasRef.current && typeof document !== 'undefined') {
      terrainCanvasRef.current = document.createElement('canvas');
    }
    if (!animationCanvasRef.current && typeof document !== 'undefined') {
      animationCanvasRef.current = document.createElement('canvas');
    }
  }, []);

  const createTerrainGrid = useCallback((
    tiles: any[] | undefined,
    width: number,
    height: number,
    visibility?: boolean[],
    revealed?: boolean[]
  ): TerrainRenderGrid => {
    const grid: TerrainRenderGrid = Array.from({ length: height }, () => Array.from({ length: width }, () => null));
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
          hasRiver: tile.hasRiver ?? false
        };
      }
    }

    return grid;
  }, []);

  useEffect(() => {
    if (!mapData?.width || !mapData?.height) {
      return;
    }

    const totalTiles = mapData.width * mapData.height;

    if (Array.isArray(mapData.tiles) && mapData.tiles.length === totalTiles) {
      const terrainGrid = createTerrainGrid(mapData.tiles, mapData.width, mapData.height, mapData.visibility, mapData.revealed);
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);
      return;
    }

    const engineTiles = (gameEngine as any)?.map?.tiles;
    if (Array.isArray(engineTiles) && engineTiles.length >= totalTiles) {
      const terrainGrid = createTerrainGrid(engineTiles, mapData.width, mapData.height, mapData.visibility, mapData.revealed);
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);
      return;
    }

    if (!terrain) {
      const generatedTerrain = MapRenderer.generateFallbackTerrain(mapData.width || 20, mapData.height || 20);
      setTerrain(generatedTerrain);
      renderTerrainToOffscreen(generatedTerrain);
    }
  }, [createTerrainGrid, gameEngine, mapData.height, mapData.revealed, mapData.tiles, mapData.visibility, mapData.width, renderTerrainToOffscreen]);

  // Note: Improvements (roads, etc.) are now rendered directly from mapData.tiles
  // in MapRenderer.drawDynamicContent, so we don't need to update the terrain grid
  // or re-render the offscreen canvas when improvements change. This avoids
  // expensive re-renders and prevents infinite loops.

  // Update terrain visibility when game state changes
  useEffect(() => {
    console.log('[GameCanvas] Updating terrain visibility', {
      hasTerrain: !!terrain,
      hasVisibility: !!mapData.visibility,
      hasRevealed: !!mapData.revealed,
      visibilityLength: mapData.visibility?.length || 0,
      revealedLength: mapData.revealed?.length || 0,
      visibilityTrueCount: mapData.visibility?.filter(v => v).length || 0,
      revealedTrueCount: mapData.revealed?.filter(r => r).length || 0
    });

    // Defensive check: ensure terrain grid matches map dimensions
    const ensureTerrainMatchesMap = () => {
      if (!terrain) return false;
      if (!mapData || !mapData.width || !mapData.height) return false;
      if (terrain.length !== mapData.height) return false;
      for (let r = 0; r < mapData.height; r++) {
        if (!terrain[r] || terrain[r].length !== mapData.width) return false;
      }
      return true;
    };

    // Track current terrain (either existing or newly rebuilt)
    let currentTerrain = terrain;

    if (!ensureTerrainMatchesMap()) {
      console.warn('[GameCanvas] Terrain grid mismatch detected. Rebuilding terrain from mapData.tiles');
      // Rebuild terrain synchronously from mapData.tiles (best-effort)
      if (mapData && Array.isArray(mapData.tiles) && mapData.tiles.length === mapData.width * mapData.height) {
        const rebuilt = new Array(mapData.height);
        for (let row = 0; row < mapData.height; row++) {
          rebuilt[row] = new Array(mapData.width);
          for (let col = 0; col < mapData.width; col++) {
            const idx = row * mapData.width + col;
            const tile: any = (mapData.tiles[idx] as any) || {};
            rebuilt[row][col] = {
              type: tile.type || 'OCEAN',
              resource: tile.resource ?? null,
              improvement: tile.improvement ?? null,
              visible: mapData.visibility?.[idx] ?? tile.visible ?? false,
              explored: mapData.revealed?.[idx] ?? tile.explored ?? false
            };
          }
        }
        // Use rebuilt terrain immediately
        currentTerrain = rebuilt;
        setTerrain(rebuilt);
        console.log('[GameCanvas] Terrain rebuilt from mapData');
      } else {
        console.warn('[GameCanvas] Cannot rebuild terrain: invalid mapData.tiles length');
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
              explored: mapData.revealed[tileIndex] || false
            };
          }
        }
      }
      // Always update terrain visibility - don't use expensive JSON comparison
      renderTerrainToOffscreen(updatedTerrain);
      setTerrain(updatedTerrain);
      console.log('[GameCanvas] Terrain visibility updated');
    } else {
      console.log('[GameCanvas] Skipping terrain visibility update - missing data');
    }
  }, [mapData.visibility, mapData.revealed, mapData.height, mapData.width, mapData.tiles]);

  // Select player's starting settler when game starts
  useEffect(() => {
    if (units && units.length > 0 && gameState.isGameStarted) {
      const playerSettler = units.find(u => u.civilizationId === 0 && u.type === 'settler');
      if (playerSettler) {
        setSelectedHex({ col: playerSettler.col, row: playerSettler.row });
        // Also select the unit in the store
        if (actions && typeof actions.selectUnit === 'function') {
          actions.selectUnit(playerSettler.id);
        }
        // Auto-enter GoTo mode if unit has moves
        if ((playerSettler.movesRemaining || 0) > 0) {
          setGotoMode(true);
          setGotoUnit(playerSettler);
          if (actions?.addNotification) {
            actions.addNotification({
              type: 'info',
              message: `Click destination for ${playerSettler.type} to go to`
            });
          }
        }
        // Calculate reachable tiles for initial blue marking
        if (mapData && terrain) {
          const getTileAt = (col: number, row: number) => {
            if (row < 0 || row >= mapData.height || col < 0 || col >= mapData.width) {
              return null;
            }
            const tileIndex = row * mapData.width + col;
            return mapData.tiles?.[tileIndex] || null;
          };
          
          const reachable = Pathfinding.getReachableTiles(
            playerSettler.col,
            playerSettler.row,
            playerSettler.movesRemaining || 0,
            getTileAt,
            playerSettler.type,
            mapData.width,
            mapData.height
          );
          
          setReachableTiles(reachable);
        }
      }
    }
  }, [units, gameState.isGameStarted, actions, mapData, terrain]);

  // Focus the canvas when game engine is available for keyboard controls
  useEffect(() => {
    if (gameEngine && canvasRef.current && !minimap) {
      canvasRef.current.focus();
    }
  }, [gameEngine, minimap]);

  // Keyboard event handler for unit actions using KeyboardHandler class
  useEffect(() => {
    if (minimap) {
      console.log('[GameCanvas] Skipping keyboard handler - minimap mode');
      return;
    }

    if (!gameEngine || !actions) {
      console.log('[GameCanvas] Skipping keyboard handler - no gameEngine or actions');
      return;
    }

    console.log('[GameCanvas] Creating KeyboardHandler');

    const keyboardHandler = new KeyboardHandler(
      gameEngine,
      actions,
      () => {
        const selectedUnitId = gameState?.selectedUnit;
        return selectedUnitId ? units.find(u => u.id === selectedUnitId) || null : null;
      },
      () => getAllUnitsFromEngine(),
      () => minimap
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      const handled = keyboardHandler.handleKeyDown(event);
      if (handled) {
        triggerRender();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      keyboardHandler.dispose();
    };
  }, [gameState?.selectedUnit, units, currentPlayer, minimap, gameEngine, actions, triggerRender]);

  // Sync unit paths from RoundManager when turn changes
  useEffect(() => {
    const roundManager = (gameEngine as any)?.roundManager;
    if (roundManager && typeof roundManager.getAllUnitPaths === 'function') {
      console.log('[GameCanvas] Syncing unit paths from RoundManager on turn change');
      const paths = roundManager.getAllUnitPaths();
      if (paths instanceof Map) {
        setUnitPaths(paths as Map<string, UnitPathStep[]>);
      }
    }
  }, [gameState.currentTurn, gameEngine]);

  // Calculate reachable tiles when selected unit changes
  useEffect(() => {
    const selectedUnitId = gameState.selectedUnit;
    
    // Clear reachable tiles if no unit selected or not human player's turn
    if (!selectedUnitId || gameState.activePlayer !== 0) {
      setReachableTiles(new Map());
      return;
    }
    
    // Find the selected unit
    const selectedUnit = units.find(u => u.id === selectedUnitId);
    if (!selectedUnit || selectedUnit.civilizationId !== 0) {
      // Only show for human player (civilization 0)
      setReachableTiles(new Map());
      return;
    }
    
    // Calculate reachable tiles
    if (mapData && terrain) {
      const getTileAt = (col: number, row: number) => {
        if (row < 0 || row >= mapData.height || col < 0 || col >= mapData.width) {
          return null;
        }
        const tileIndex = row * mapData.width + col;
        return mapData.tiles?.[tileIndex] || null;
      };
      
      const reachable = Pathfinding.getReachableTiles(
        selectedUnit.col,
        selectedUnit.row,
        selectedUnit.movesRemaining || 0,
        getTileAt,
        selectedUnit.type,
        mapData.width,
        mapData.height
      );
      
      setReachableTiles(reachable);
    }
  }, [gameState.selectedUnit, gameState.activePlayer, units, mapData, terrain]);

  const squareToScreen = useCallback((col: number, row: number): { x: number; y: number } => {
    // Return the center of the tile, not the top-left corner
    const x = ((col + 0.5) * TILE_SIZE - camera.x) * camera.zoom;
    const y = ((row + 0.5) * TILE_SIZE - camera.y) * camera.zoom;
    return { x, y };
  }, [camera.x, camera.y, camera.zoom]);

  const screenToSquare = useCallback((screenX: number, screenY: number): HexCoordinates => {
    // Adjust for camera position and zoom
    const worldX = (screenX / camera.zoom) + camera.x;
    const worldY = (screenY / camera.zoom) + camera.y;

    // Simple square coordinate conversion - use floor so clicks map
    // to the tile that contains the point (avoid rounding at corners)
    let col = Math.floor(worldX / TILE_SIZE);
    let row = Math.floor(worldY / TILE_SIZE);

    // Clamp to map bounds
    col = Math.max(0, Math.min(mapData.width - 1, col));
    row = Math.max(0, Math.min(mapData.height - 1, row));

    return { col, row };
  }, [camera.x, camera.y, camera.zoom, mapData.height, mapData.width]);

  // Helper accessors: support multiple engine shapes (engine.getUnitAt or engine.map.getUnitAt or fallback to engine.units[])
  const getUnitAtFromEngine = (col: number, row: number) => {
    if (!gameEngine) return null as any;
    try {
      const direct = (gameEngine as any).getUnitAt;
      if (typeof direct === 'function') return direct.call(gameEngine, col, row);
      const mapObj = (gameEngine as any).map;
      if (mapObj && typeof mapObj.getUnitAt === 'function') return mapObj.getUnitAt(col, row);
      const unitsArr = (gameEngine as any).units;
      if (Array.isArray(unitsArr)) return unitsArr.find((u: any) => u && u.col === col && u.row === row) || null;
    } catch (err) {
      console.error('[GameCanvas] getUnitAtFromEngine error', err);
    }
    return null as any;
  };

  const getCityAtFromEngine = (col: number, row: number) => {
    if (!gameEngine) return null as any;
    try {
      const direct = (gameEngine as any).getCityAt;
      if (typeof direct === 'function') return direct.call(gameEngine, col, row);
      const mapObj = (gameEngine as any).map;
      if (mapObj && typeof mapObj.getCityAt === 'function') return mapObj.getCityAt(col, row);
      const citiesArr = (gameEngine as any).cities;
      if (Array.isArray(citiesArr)) return citiesArr.find((c: any) => c && c.col === col && c.row === row) || null;
    } catch (err) {
      console.error('[GameCanvas] getCityAtFromEngine error', err);
    }
    return null as any;
  };

  const getAllUnitsFromEngine = () => {
    if (!gameEngine) return [] as any[];
    try {
      const directAll = (gameEngine as any).getAllUnits;
      if (typeof directAll === 'function') return directAll.call(gameEngine);
      const unitsArr = (gameEngine as any).units;
      if (Array.isArray(unitsArr)) return unitsArr;
      const mapObj = (gameEngine as any).map;
      if (mapObj && typeof mapObj.getAllUnits === 'function') return mapObj.getAllUnits();
    } catch (err) {
      console.error('[GameCanvas] getAllUnitsFromEngine error', err);
    }
    return [] as any[];
  };

  const getAllCitiesFromEngine = () => {
    if (!gameEngine) return [] as any[];
    try {
      const directAll = (gameEngine as any).getAllCities;
      if (typeof directAll === 'function') return directAll.call(gameEngine);
      const citiesArr = (gameEngine as any).cities;
      if (Array.isArray(citiesArr)) return citiesArr;
      const mapObj = (gameEngine as any).map;
      if (mapObj && typeof mapObj.getAllCities === 'function') return mapObj.getAllCities();
    } catch (err) {
      console.error('[GameCanvas] getAllCitiesFromEngine error', err);
    }
    return [] as any[];
  };

  const renderStaticContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    if (minimap) {
      mapRendererRef.current.renderMinimap({
        ctx,
        map: mapData as MapState,
        cssWidth: rect.width,
        cssHeight: rect.height,
        camera,
        units,
        cities,
        civilizations
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
      gameState: gameState as GameState,
      units,
      cities,
      civilizations,
      unitPaths,
      offscreenCanvas: terrainCanvasRef.current,
      squareToScreen,
      cameraZoom: camera.zoom,
      reachableTiles
    });

    // Save the static content to animation canvas for efficient restoration
    if (animationCanvasRef.current) {
      const animCanvas = animationCanvasRef.current;
      if (animCanvas.width !== canvas.width || animCanvas.height !== canvas.height) {
        animCanvas.width = canvas.width;
        animCanvas.height = canvas.height;
      }
      const animCtx = animCanvas.getContext('2d');
      if (animCtx) {
        animCtx.clearRect(0, 0, animCanvas.width, animCanvas.height);
        animCtx.drawImage(canvas, 0, 0);
      }
    }

    staticRenderedRef.current = true;
    // console.log('[GameCanvas] Static content rendered and saved');
  }, [camera, canvasRef, civilizations, cities, gameState, mapData, minimap, squareToScreen, selectedHex, terrain, unitPaths, units]);

  const renderAnimationLayer = useCallback((currentTime: number) => {
    if (!canvasRef.current || !animationCanvasRef.current) return;

    const canvas = canvasRef.current;
    const animCanvas = animationCanvasRef.current;
    const mainCtx = canvas.getContext('2d');
    if (!mainCtx || !staticRenderedRef.current) return;

    // Get units that need animation
    const activePlayerUnits = units.filter(u => 
      u.civilizationId === gameState.activePlayer && 
      (u.movesRemaining || 0) > 0
    );

    if (activePlayerUnits.length === 0) return;

    // Instead of redrawing the entire canvas, only update the unit regions
    // Calculate the size of unit circles
    const unitRadius = Math.round(20 * camera.zoom * 1.2); // Add margin for glow

    activePlayerUnits.forEach(unit => {
      const { x, y } = squareToScreen(unit.col, unit.row);
      
      // Only restore and redraw this specific region
      const regionSize = unitRadius * 2;
      const regionX = x - unitRadius;
      const regionY = y - unitRadius;

      // Restore static content for this unit's region only
      mainCtx.drawImage(
        animCanvas,
        regionX, regionY, regionSize, regionSize,
        regionX, regionY, regionSize, regionSize
      );
    });

    // Draw only pulsing units on top (in their small regions)
    mapRendererRef.current.renderPulsingUnits({
      ctx: mainCtx,
      map: mapData as MapState,
      units,
      gameState: gameState as GameState,
      civilizations,
      currentTime,
      squareToScreen,
      cameraZoom: camera.zoom,
      currentQueueUnitId: currentQueueUnitId ?? undefined
    });
  }, [camera.zoom, civilizations, currentQueueUnitId, gameState, mapData, squareToScreen, units]);

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Don't allow dragging in Go To mode
    if (gotoMode) {
      return;
    }
    
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    triggerRender(); // Immediate render for visual feedback
  };

  // Always show context menu when mouse is over a player unit
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && !gotoMode) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      actions.updateCamera({
        x: camera.x - dx / camera.zoom,
        y: camera.y - dy / camera.zoom
      });
      setLastMousePos({ x: e.clientX, y: e.clientY });
      // Camera changes will trigger render via useEffect
      return;
    }

    // Show context menu if mouse is over a player unit
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hex = screenToSquare(x, y);
    let unitAtHex = null;
    try {
      unitAtHex = getUnitAtFromEngine(hex.col, hex.row);
    } catch (e) {
      unitAtHex = null;
    }
    if (unitAtHex && currentPlayer && unitAtHex.civilizationId === currentPlayer.id) {
      // Only show if not already open for this unit
      if (!contextMenu || contextMenu.unit?.id !== unitAtHex.id) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          hex: hex,
          tile: terrain?.[hex.row]?.[hex.col] || null,
          unit: unitAtHex,
          city: null
        });
      }
    } else {
      // Hide context menu if not over a player unit
      if (contextMenu) setContextMenu(null);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    triggerRender(); // Render to update cursor state
  };

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
          x: clickedCol * TILE_SIZE - (canvas.width / camera.zoom) / 2,
          y: clickedRow * TILE_SIZE - (canvas.height / camera.zoom) / 2
        });
      } else {
        const hex = screenToSquare(x, y);
        
        // Check if clicking on already selected hex - deselect everything
        if (selectedHex.col === hex.col && selectedHex.row === hex.row) {
          console.log(`[CLICK] Deselecting selected hex (${hex.col}, ${hex.row})`);
          if (actions && typeof actions.selectUnit === 'function') {
            actions.selectUnit(null);
          }
          if (actions && typeof actions.selectCity === 'function') {
            actions.selectCity(null);
          }
          setSelectedHex({ col: -1, row: -1 });
          return;
        }
        
        setSelectedHex(hex);
        setContextMenu(null); // Hide context menu on left click

        console.log(`[CLICK] Map click at hex (${hex.col}, ${hex.row})`);

        // Handle Go To mode
        if (gotoMode && gotoUnit) {
          console.log(`[CLICK] Go To destination set for unit ${gotoUnit.id} to (${hex.col}, ${hex.row})`);
          
          // Use GoToManager to calculate and execute path
          const goToManager = (gameEngine as any)?.goToManager;
          if (goToManager) {
            const pathResult = goToManager.calculatePath(
              gotoUnit,
              hex.col,
              hex.row,
              (col: number, row: number) => {
                const tileIndex = row * mapData.width + col;
                return mapData.tiles?.[tileIndex] || null;
              },
              mapData.width,
              mapData.height
            );

            if (pathResult.success && pathResult.path.length > 0) {
              // Set the path using GoToManager
              goToManager.setUnitPath(gotoUnit.id, pathResult.path);
              
              // Update local state for rendering
              setUnitPaths(prev => {
                const next = new Map(prev);
                next.set(gotoUnit.id, pathResult.path);
                return next;
              });

              if (actions?.addNotification) {
                actions.addNotification({
                  type: 'success',
                  message: `${gotoUnit.type} will go to (${hex.col}, ${hex.row})`
                });
              }

              console.log(`[CLICK] Path calculated for unit ${gotoUnit.id}:`, pathResult.path);

              // Execute ALL steps until moves are exhausted using animation
              if (gotoUnit.movesRemaining > 0) {
                console.log(`[CLICK] Starting full path execution for unit ${gotoUnit.id}`);
                triggerRender();
                
                // Execute path with animation, moving until all moves are used
                setTimeout(() => {
                  goToManager.executePathWithAnimation(
                    gotoUnit.id,
                    300,
                    (remainingSteps: number) => {
                      // Update UI after each step
                      const path = goToManager.getUnitPath(gotoUnit.id);
                      setUnitPaths(prev => {
                        const next = new Map(prev);
                        if (path && path.length > 0) {
                          next.set(gotoUnit.id, path);
                        } else {
                          next.delete(gotoUnit.id);
                        }
                        return next;
                      });
                      triggerRender();
                      console.log(`[CLICK] Unit ${gotoUnit.id} continuing, ${remainingSteps} steps remaining`);
                    }
                  ).then(result => {
                    console.log(`[CLICK] Unit ${gotoUnit.id} completed GoTo movement, ${result.stepsCompleted} steps taken`);
                    triggerRender();
                  });
                }, 100);
              } else {
                triggerRender();
              }
            } else {
              if (actions?.addNotification) {
                actions.addNotification({
                  type: 'warning',
                  message: 'Cannot reach destination'
                });
              }
            }
          } else {
            console.error('[CLICK] GoToManager not available');
            if (actions?.addNotification) {
              actions.addNotification({
                type: 'error',
                message: 'GoTo system unavailable'
              });
            }
          }
          
          // Exit Go To mode
          setGotoMode(false);
          setGotoUnit(null);
          return;
        }

        // Select the hex in the global store
        if (actions && typeof actions.selectHex === 'function') {
          actions.selectHex(hex);
        }

        // Check for unit or city at this location
        let unitAt = null;
        let cityAt: { id: string; name: any; civilizationId: number; };
         try {
           unitAt = getUnitAtFromEngine(hex.col, hex.row);
           cityAt = getCityAtFromEngine(hex.col, hex.row);
         } catch (e) {
          unitAt = null;
          cityAt = undefined;
         }

        if (unitAt && currentPlayer && unitAt.civilizationId === currentPlayer.id) {
          console.log(`[CLICK] Selected unit ${unitAt.id} (${unitAt.type}) at (${hex.col}, ${hex.row})`);
          
          // Check if this unit is already selected - if so, deselect it
          const currentlySelectedUnitId = gameState?.selectedUnit;
          if (currentlySelectedUnitId === unitAt.id) {
            console.log(`[CLICK] Deselecting unit ${unitAt.id}`);
            if (actions && typeof actions.selectUnit === 'function') {
              actions.selectUnit(null);
            }
            // Exit GoTo mode when deselecting
            setGotoMode(false);
            setGotoUnit(null);
            return; // Don't proceed with normal selection
          }
          
          if (actions && typeof actions.selectUnit === 'function') {
            actions.selectUnit(unitAt.id);
          }
          
          // Automatically enter GoTo mode when unit is selected
          console.log(`[CLICK] Unit selected, entering GoTo mode`);
          setGotoMode(true);
          setGotoUnit(unitAt);
          if (actions?.addNotification) {
            actions.addNotification({
              type: 'info',
              message: `Click destination for ${unitAt.type} to go to`
            });
          }
          
          // If the unit has a path and moves, continue following using GoToManager
          const goToManager = (gameEngine as any)?.goToManager;
          if (goToManager && goToManager.hasPath(unitAt.id) && unitAt.movesRemaining > 0) {
            try {
              const moveResult = goToManager.executeFirstStep(unitAt.id);
              if (moveResult.success) {
                setUnitPaths(prev => {
                  const next = new Map(prev);
                  if (moveResult.remainingPath.length > 0) {
                    next.set(unitAt.id, moveResult.remainingPath);
                  } else {
                    next.delete(unitAt.id);
                  }
                  return next;
                });
                console.log(`[CLICK] Unit ${unitAt.id} continued path, ${moveResult.remainingPath.length} steps remaining`);
              }
            } catch (e) {
              console.log(`[CLICK] Continue path error:`, e);
            }
          }
        } else if (unitAt && !currentPlayer || (unitAt && unitAt.civilizationId !== currentPlayer.id)) {
          // Enemy unit - check if we have a selected unit that can attack
          console.log(`[CLICK] Enemy unit at (${hex.col}, ${hex.row})`);
          const selectedUnitId = gameState?.selectedUnit;
          if (selectedUnitId) {
            const selectedUnit = units.find(u => u.id === selectedUnitId);
            if (selectedUnit && selectedUnit.civilizationId === currentPlayer?.id) {
              // Check if adjacent or use pathfinding to get there and attack
              const isAdjacent = Math.abs(selectedUnit.col - hex.col) <= 1 && Math.abs(selectedUnit.row - hex.row) <= 1;
              
              if (isAdjacent && (selectedUnit.movesRemaining || 0) > 0) {
                console.log(`[CLICK] Adjacent attack - attempting to move/attack`);
                try {
                  // moveUnit handles combat automatically
                  gameEngine?.moveUnit?.(selectedUnit.id, hex.col, hex.row);
                } catch (e) {
                  console.log(`[CLICK] Attack error:`, e);
                }
              } else {
                console.log(`[CLICK] Unit not adjacent to enemy - cannot attack`);
                if (actions?.addNotification) {
                  actions.addNotification({ type: 'warning', message: 'Unit must be adjacent to attack' });
                }
              }
            }
          } else {
            console.log(`[CLICK] No unit selected to attack with`);
          }
        } else if (cityAt) {
          console.log(`[CLICK] Selected city ${cityAt.id} (${cityAt.name}) at (${hex.col}, ${hex.row})`);
          console.log(`[CLICK] City debug - currentPlayer:`, currentPlayer, `cityAt.civilizationId:`, cityAt.civilizationId);
          if (actions && typeof actions.selectCity === 'function') {
            actions.selectCity(cityAt.id);
          }
          // Only open modal for player cities
          console.log(`[CLICK] Modal check - currentPlayer exists:`, !!currentPlayer, `civilizationId match:`, currentPlayer?.id === cityAt.civilizationId, `actions.showDialog exists:`, !!(actions && typeof actions.showDialog === 'function'));
          if (currentPlayer && cityAt.civilizationId === currentPlayer.id && actions && typeof actions.showDialog === 'function') {
            console.log(`[CLICK] Opening city modal for player city`);
            actions.showDialog('city-details');
          } else {
            console.log(`[CLICK] Not opening city modal - condition not met`);
          }
        } else {
          // Check if we have a selected unit and try to move it
          const selectedUnitId = gameState?.selectedUnit;
          if (selectedUnitId) {
            console.log(`[CLICK] Attempting to move selected unit ${selectedUnitId} to (${hex.col}, ${hex.row})`);

            // Find unit object
            const selectedUnit = units.find(u => u.id === selectedUnitId);

            // If we have reachableTiles computed, prefer using it to validate click
            const key = `${hex.col},${hex.row}`;
            const isReachable = reachableTiles && reachableTiles.has(key);

            if (!selectedUnit) {
              console.log('[CLICK] Selected unit not found in units array');
              return;
            }

            if (!isReachable) {
              // Not reachable within current movement points
              console.log('[CLICK] Destination not reachable with current moves');
              if (actions && typeof actions.addNotification === 'function') {
                actions.addNotification({ type: 'warning', message: 'Cannot reach destination with current movement points' });
              }
              return;
            }

            try {
              // Calculate path using Pathfinding
              const pathResult = Pathfinding.findPath(
                selectedUnit.col,
                selectedUnit.row,
                hex.col,
                hex.row,
                (col: number, row: number) => {
                  const tileIndex = row * mapData.width + col;
                  return mapData.tiles?.[tileIndex] || null;
                },
                selectedUnit.type,
                mapData.width,
                mapData.height
              );

              if (pathResult.success && pathResult.path.length > 1) {
                const pathToFollow: UnitPathStep[] = pathResult.path.slice(1).map((step: any) => ({ col: step.col, row: step.row }));

                // Use GoToManager to set the path and execute with animation
                const goToManager = (gameEngine as any)?.goToManager;
                if (goToManager) {
                  goToManager.setUnitPath(selectedUnit.id, pathToFollow);
                  
                  // Update local state for rendering
                  setUnitPaths(prev => {
                    const next = new Map(prev);
                    next.set(selectedUnit.id, pathToFollow);
                    return next;
                  });

                  if (actions?.addNotification) {
                    actions.addNotification({ 
                      type: 'success', 
                      message: `${selectedUnit.type} will go to (${hex.col}, ${hex.row})` 
                    });
                  }

                  triggerRender();

                  // Then, if unit has moves, start moving along the path using GoToManager
                  if (pathToFollow.length > 0 && (selectedUnit.movesRemaining || 0) > 0) {
                    console.log(`[CLICK] Starting automatic movement along path for unit ${selectedUnit.id}`);
                    
                    // Use a small delay to ensure path is rendered first
                    setTimeout(() => {
                      goToManager.executePathWithAnimation(
                        selectedUnit.id,
                        300,
                        (remainingSteps: number) => {
                          // Update UI after each step
                          const path = goToManager.getUnitPath(selectedUnit.id);
                          setUnitPaths(prev => {
                            const next = new Map(prev);
                            if (path && path.length > 0) {
                              next.set(selectedUnit.id, path);
                            } else {
                              next.delete(selectedUnit.id);
                            }
                            return next;
                          });
                          triggerRender();
                        }
                      );
                    }, 100);
                  }
                } else {
                  console.error('[CLICK] GoToManager not available, falling back to old method');
                  // Fallback to old method if GoToManager not available
                  setUnitPaths(prev => {
                    const next = new Map(prev);
                    next.set(selectedUnit.id, pathToFollow);
                    return next;
                  });
                  
                  const roundManager = (gameEngine as any)?.roundManager;
                  if (roundManager && typeof roundManager.setUnitPath === 'function') {
                    roundManager.setUnitPath(selectedUnit.id, pathToFollow);
                  }
                  
                  if (actions?.addNotification) {
                    actions.addNotification({ 
                      type: 'success', 
                      message: `${selectedUnit.type} will go to (${hex.col}, ${hex.row})` 
                    });
                  }
                  
                  triggerRender();
                }
              } else {
                if (actions?.addNotification) actions.addNotification({ type: 'warning', message: 'Cannot reach destination' });
              }
            } catch (e) {
              console.log(`[CLICK] Pathfinding error:`, e);
              if (actions?.addNotification) actions.addNotification({ type: 'error', message: 'Pathfinding failed' });
            }
          } else {
            console.log(`[CLICK] Empty hex clicked at (${hex.col}, ${hex.row})`);
          }
        }
      }
    }
  };

  const handleRightClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    // Don't show context menu in Go To mode
    if (gotoMode) {
      return;
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
      console.error('[ContextMenu] Error getting unit from gameEngine:', e);
    }

    // Check if it's a player's unit
    if (!unitAtHex || unitAtHex.civilizationId !== currentPlayer?.id) {
      console.log('[ContextMenu] Not player unit, skipping menu');
      return;
    }

    console.log(`[ContextMenu] Right-clicked player unit ${unitAtHex.id} (${unitAtHex.type})`);

    // Select the unit
    if (actions && typeof actions.selectUnit === 'function') {
      actions.selectUnit(unitAtHex.id);
    }

    // Get city at this location
    let cityAtHex = null;
    try {
      cityAtHex = getCityAtFromEngine(hex.col, hex.row);
    } catch (e) {
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
      city: cityAtHex
    });
  };

  const executeContextAction = (action: string) => {
    console.log(`[ContextMenu] Executing action: ${action}`, { contextMenu });

    if (!contextMenu) return;

    const unit = contextMenu.unit;
    const city = contextMenu.city;

    switch (action) {
      // ===== UNIT ACTIONS =====
      case 'fortify':
        if (unit && gameEngine?.unitFortify) {
          console.log(`[ContextMenu] Fortifying unit ${unit.id}`);
          gameEngine.unitFortify(unit.id);
          if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification) actions.addNotification({
            type: 'success',
            message: `${unit.type} fortified`
          });
        }
        break;

      case 'sleep':
        if (unit && gameEngine) {
          if (unit.isSleeping && gameEngine.unitWake) {
            console.log(`[ContextMenu] Wake action for unit ${unit.id}`);
            gameEngine.unitWake(unit.id);
            if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.addNotification) actions.addNotification({
              type: 'success',
              message: `${unit.type} woke up`
            });
          } else if (gameEngine.unitSleep) {
            console.log(`[ContextMenu] Sleep action for unit ${unit.id}`);
            gameEngine.unitSleep(unit.id);
            if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.addNotification) actions.addNotification({
              type: 'success',
              message: `${unit.type} sleeping`
            });
          }
        }
        break;

      case 'skip_turn':
        if (unit && gameEngine?.skipUnit) {
          console.log(`[ContextMenu] Skipping turn for unit ${unit.id}`);
          gameEngine.skipUnit(unit.id);
          if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification) actions.addNotification({
            type: 'info',
            message: `${unit.type} turn skipped`
          });
          if (actions?.selectUnit) actions.selectUnit(null);
        }
        break;

      case 'goto':
        if (unit) {
          console.log(`[ContextMenu] Entering Go To mode for unit ${unit.id}`);
          setGotoMode(true);
          setGotoUnit(unit);
          if (actions?.selectUnit) actions.selectUnit(unit.id); // Ensure unit is selected
          setContextMenu(null); // Close the context menu
          if (actions?.addNotification) actions.addNotification({
            type: 'info',
            message: `Click destination for ${unit.type} to go to`
          });
        }
        break;

      case 'goto_cancel':
        if (unit && gameEngine?.goToManager) {
          console.log(`[ContextMenu] Canceling Go To for unit ${unit.id}`);
          gameEngine.goToManager.clearUnitPath(unit.id);
          
          // Clear the path from local state to remove the rendered GoTo line
          setUnitPaths(prev => {
            const next = new Map(prev);
            next.delete(unit.id);
            return next;
          });
          
          if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
          if (actions?.addNotification) actions.addNotification({
            type: 'info',
            message: `GoTo cancelled for ${unit.type}`
          });
        }
        break;

      case 'found_city':
        if (unit && gameEngine?.foundCityWithSettler) {
          console.log(`[ContextMenu] Found city action for unit ${unit.id}`);
          const result = gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            if (actions?.updateCities) actions.updateCities(getAllCitiesFromEngine());
            if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap((gameEngine as any).map);
            if (actions?.addNotification) actions.addNotification({
              type: 'success',
              message: 'City founded!'
            });
          } else {
            if (actions?.addNotification) actions.addNotification({
              type: 'warning',
              message: 'Cannot found city here'
            });
          }
        }
        break;

      case 'build_road':
        if (unit && gameEngine?.buildImprovement) {
          console.log(`[ContextMenu] Build road action for unit ${unit.id}`);
          const result = gameEngine.buildImprovement(unit.id, 'road');
          if (result) {
            if (actions?.updateUnits) actions.updateUnits(getAllUnitsFromEngine());
            if (actions?.updateMap) actions.updateMap((gameEngine as any).map);
            if (actions?.addNotification) actions.addNotification({
              type: 'success',
              message: 'Road built'
            });
          } else {
            if (actions?.addNotification) actions.addNotification({
              type: 'warning',
              message: 'Cannot build road here'
            });
          }
        }
        break;

      // ===== CITY ACTIONS =====
      case 'viewProduction':
        if (city) {
          console.log(`[ContextMenu] View production for city ${city.id}`);
          if (actions?.selectCity) actions.selectCity(city.id);
          if (actions?.showDialog) actions.showDialog('city-production');
        }
        break;

      case 'cityInfo':
        if (city) {
          console.log(`[ContextMenu] View info for city ${city.id}`);
          if (actions?.selectCity) actions.selectCity(city.id);
          if (actions?.showDialog) actions.showDialog('city-details');
        }
        break;

      // ===== GENERAL ACTIONS =====
      case 'centerView':
        console.log(`[ContextMenu] Centering view on (${contextMenu.hex.col}, ${contextMenu.hex.row})`);
        actions.updateCamera({
          x: contextMenu.hex.col * TILE_SIZE - canvasRef.current.width / (2 * camera.zoom),
          y: contextMenu.hex.row * TILE_SIZE - canvasRef.current.height / (2 * camera.zoom)
        });
        break;

      case 'examineHex':
        console.log(`[ContextMenu] Examining hex (${contextMenu.hex.col}, ${contextMenu.hex.row})`);
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
    
    // Don't allow zooming in Go To mode
    if (gotoMode) {
      return;
    }
    
    // Smoother zoom with smaller increments
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.max(0.3, Math.min(2.5, camera.zoom * zoomFactor));
    
    // Get mouse position for zoom centering
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate world position before zoom
    const worldXBefore = (mouseX / camera.zoom) + camera.x;
    const worldYBefore = (mouseY / camera.zoom) + camera.y;
    
    // Calculate world position after zoom
    const worldXAfter = (mouseX / newZoom) + camera.x;
    const worldYAfter = (mouseY / newZoom) + camera.y;
    
    // Adjust camera to keep mouse position stable
    actions.updateCamera({
      zoom: newZoom,
      x: camera.x - (worldXAfter - worldXBefore),
      y: camera.y - (worldYAfter - worldYBefore)
    });
  };

  // Render static content only when needed
  useEffect(() => {
    if (needsRender.current || hasGameStateChanged()) {
      console.log('[GameCanvas] Rendering static content due to changes');
      renderStaticContent();
      needsRender.current = false;
    }
  }, [hasGameStateChanged, renderStaticContent]);

  // Separate animation loop only for pulsing units (only runs when needed)
  useEffect(() => {
    if (minimap || !gameState.isGameStarted) return;

    // Check if there are any units that need pulsing animation
    const hasUnitsWithMoves = units.some(u => 
      u.civilizationId === gameState.activePlayer && 
      (u.movesRemaining || 0) > 0
    );

    // Only start animation loop if there are units to animate
    if (!hasUnitsWithMoves) {
      // console.log('[GameCanvas] No units need animation, skipping animation loop');
      return;
    }

    // console.log('[GameCanvas] Starting animation loop for pulsing units');

    let lastAnimTime = 0;
    let frameCount = 0;
    let lastFPSLog = 0;
    const animFPS = 5; // 5 FPS for pulsing (turn-based game doesn't need high FPS)
    const animInterval = 1000 / animFPS;

    const animate = (currentTime: number) => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Check if we need to render static content
      if (needsRender.current || hasGameStateChanged()) {
        renderStaticContent();
        needsRender.current = false;
      }

      // Render animation layer for pulsing units
      const elapsed = currentTime - lastAnimTime;
      if (elapsed > animInterval) {
        lastAnimTime = currentTime - (elapsed % animInterval);
        renderAnimationLayer(currentTime);
        
        // Log FPS every 5 seconds
        frameCount++;
        if (currentTime - lastFPSLog > 5000) {
          const actualFPS = frameCount / 5;
          // console.log(`[GameCanvas] Animation FPS: ${actualFPS.toFixed(1)} (target: ${animFPS})`);
          frameCount = 0;
          lastFPSLog = currentTime;
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        // console.log('[GameCanvas] Stopped animation loop');
      }
    };
  }, [minimap, gameState.isGameStarted, gameState.activePlayer, units, hasGameStateChanged, renderStaticContent, renderAnimationLayer]);

  // Trigger render when camera changes (pan/zoom)
  useEffect(() => {
    // console.log('[GameCanvas] Camera changed, triggering render');
    triggerRender();
  }, [camera.x, camera.y, camera.zoom, triggerRender]);

  // Trigger render when selection changes
  useEffect(() => {
    triggerRender();
  }, [selectedHex]);

  // Trigger render when terrain changes
  useEffect(() => {
    triggerRender();
  }, [terrain]);

  // Trigger render when game state changes significantly
  useEffect(() => {
    triggerRender();
  }, [gameState.activePlayer, gameState.currentTurn, units.length, cities.length]);


  return (
    <div className="position-relative w-100 h-100">
      <canvas
        ref={canvasRef}
        className="w-100 h-100"
        style={{ 
          cursor: minimap ? 'pointer' : 
                  gotoMode ? 'crosshair' : 
                  (isDragging ? 'grabbing' : 'grab') 
        }}
        tabIndex={minimap ? -1 : 0}
        onMouseDown={minimap ? null : handleMouseDown}
        onMouseMove={minimap ? null : handleMouseMove}
        onMouseUp={minimap ? null : handleMouseUp}
        onClick={handleClick}
        onContextMenu={minimap ? null : handleRightClick}
        onWheel={minimap ? null : handleWheel}
      />
      
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
