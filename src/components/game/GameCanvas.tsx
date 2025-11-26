import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { TILE_SIZE } from '@/data/TerrainData';
import { MapRenderer, TerrainRenderGrid, TerrainTileRenderInfo, UnitPathStep } from '@/game/rendering/MapRenderer';
import type { City, Civilization, GameEngine, GameState, MapState, Unit } from '../../../types/game';
import '../../styles/civ1GameCanvas.css';
import UnitActionsModal from './UnitActionsModal';
import { Pathfinding } from '../../game/engine/Pathfinding';

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
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [lastMousePos, setLastMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedHex, setSelectedHex] = useState<HexCoordinates>({ col: 5, row: 5 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terrain, setTerrain] = useState<TerrainRenderGrid | null>(null);
  const [gotoMode, setGotoMode] = useState<boolean>(false);
  const [gotoUnit, setGotoUnit] = useState<Unit | null>(null);
  const [unitPaths, setUnitPaths] = useState<Map<string, UnitPathStep[]>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const renderTimeoutRef = useRef<number | null>(null);
  const lastRenderTime = useRef<number>(0);
  const needsRender = useRef<boolean>(true);
  const lastGameState = useRef<any>(null);

  // Trigger re-render when game state changes (turn-based optimization)
  const triggerRender = useCallback(() => {
    needsRender.current = true;
  }, []);

  // Check if game state has changed significantly
  const hasGameStateChanged = useCallback(() => {
    const currentState = {
      activePlayer: gameState.activePlayer,
      currentTurn: gameState.currentTurn,
      units: units.length,
      cities: cities.length,
      selectedHex: selectedHex,
      camera: camera
    };

    if (!lastGameState.current ||
        JSON.stringify(currentState) !== JSON.stringify(lastGameState.current)) {
      lastGameState.current = currentState;
      return true;
    }
    return false;
  }, [camera, cities.length, gameState.activePlayer, gameState.currentTurn, selectedHex, units.length]);

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
  }, [createTerrainGrid, gameEngine, mapData.height, mapData.revealed, mapData.tiles, mapData.visibility, mapData.width, renderTerrainToOffscreen, terrain]);

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
        setTerrain(rebuilt);
      } else {
        console.warn('[GameCanvas] Cannot rebuild terrain: invalid mapData.tiles length');
      }
    }

    if (terrain && mapData.visibility && mapData.revealed) {
      // Update visibility without recreating the entire grid
      const updatedTerrain = [...terrain];
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
      setTerrain(updatedTerrain);
      renderTerrainToOffscreen(updatedTerrain);
      console.log('[GameCanvas] Terrain visibility updated');
    } else {
      console.log('[GameCanvas] Skipping terrain visibility update - missing data');
    }
  }, [gameState.currentTurn, mapData.visibility, mapData.revealed]);

  // Select player's starting settler when game starts
  useEffect(() => {
    if (units && units.length > 0 && gameState.isGameStarted) {
      const playerSettler = units.find(u => u.civilizationId === 0 && u.type === 'settlers');
      if (playerSettler) {
        setSelectedHex({ col: playerSettler.col, row: playerSettler.row });
      }
    }
  }, [units, gameState.isGameStarted]);

  // Focus the canvas when game engine is available for keyboard controls
  useEffect(() => {
    if (gameEngine && canvasRef.current && !minimap) {
      canvasRef.current.focus();
    }
  }, [gameEngine, minimap]);

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

  const squareToScreen = useCallback((col: number, row: number): { x: number; y: number } => {
    const x = (col * TILE_SIZE - camera.x) * camera.zoom;
    const y = (row * TILE_SIZE - camera.y) * camera.zoom;
    return { x, y };
  }, [camera.x, camera.y, camera.zoom]);

  const screenToSquare = useCallback((screenX: number, screenY: number): HexCoordinates => {
    // Adjust for camera position and zoom
    const worldX = (screenX / camera.zoom) + camera.x;
    const worldY = (screenY / camera.zoom) + camera.y;

    // Simple square coordinate conversion
    let col = Math.round(worldX / TILE_SIZE);
    let row = Math.round(worldY / TILE_SIZE);

    // Clamp to map bounds
    col = Math.max(0, Math.min(mapData.width - 1, col));
    row = Math.max(0, Math.min(mapData.height - 1, row));

    return { col, row };
  }, [camera.x, camera.y, camera.zoom, mapData.height, mapData.width]);

  const renderFrame = useCallback((currentTime: number = performance.now()) => {
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

    mapRendererRef.current.renderFrame({
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
      currentTime,
      offscreenCanvas: terrainCanvasRef.current,
      squareToScreen,
      cameraZoom: camera.zoom
    });
  }, [camera, canvasRef, civilizations, cities, gameState, mapData, minimap, squareToScreen, selectedHex, terrain, unitPaths, units]);

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
          
          // Calculate path using Pathfinding
          try {
            const pathResult = Pathfinding.findPath(
              gotoUnit.col,
              gotoUnit.row,
              hex.col,
              hex.row,
              (col: number, row: number) => {
                const tileIndex = row * mapData.width + col;
                return mapData.tiles?.[tileIndex] || null;
              },
              gotoUnit.type,
              mapData.width,
              mapData.height
            );

            if (pathResult.success && pathResult.path.length > 1) {
              const pathToFollow: UnitPathStep[] = pathResult.path.slice(1).map((step: any) => ({
                col: step.col,
                row: step.row
              }));

              setUnitPaths(prev => {
                const next = new Map(prev);
                next.set(gotoUnit.id, pathToFollow);
                return next;
              });

              const roundManager = (gameEngine as any)?.roundManager;
              if (roundManager && typeof roundManager.setUnitPath === 'function') {
                roundManager.setUnitPath(gotoUnit.id, pathToFollow);
                console.log(`[CLICK] Path synced to RoundManager for unit ${gotoUnit.id}`);
              }

              if (actions?.addNotification) actions.addNotification({
                type: 'success',
                message: `${gotoUnit.type} will go to (${hex.col}, ${hex.row})`
              });

              console.log(`[CLICK] Path calculated for unit ${gotoUnit.id}:`, pathToFollow);

              if (pathToFollow.length > 0 && gotoUnit.movesRemaining > 0) {
                const nextPos = pathToFollow[0];
                try {
                  const moveResult = gameEngine?.moveUnit?.(gotoUnit.id, nextPos.col, nextPos.row);
                  if (moveResult && moveResult.success) {
                    const remainingPath = pathToFollow.slice(1);
                    setUnitPaths(prev => {
                      const next = new Map(prev);
                      next.set(gotoUnit.id, remainingPath);
                      return next;
                    });

                    if (roundManager && typeof roundManager.setUnitPath === 'function') {
                      roundManager.setUnitPath(gotoUnit.id, remainingPath);
                    }

                    console.log(`[CLICK] Unit ${gotoUnit.id} moved to (${nextPos.col}, ${nextPos.row}), remaining path:`, remainingPath);
                  } else {
                    console.log(`[CLICK] Automatic move failed for unit ${gotoUnit.id}`);
                  }
                } catch (err) {
                  console.log(`[CLICK] Automatic move error:`, err);
                }
              }

              triggerRender();
            } else {
              if (actions?.addNotification) actions.addNotification({
                type: 'warning',
                message: 'Cannot reach destination'
              });
            }
          } catch (e) {
            console.log(`[CLICK] Pathfinding error:`, e);
            if (actions?.addNotification) actions.addNotification({
              type: 'error',
              message: 'Pathfinding failed'
            });
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
        let cityAt = null;
        try {
          if (gameEngine && typeof gameEngine.getUnitAt === 'function') {
            unitAt = gameEngine.getUnitAt(hex.col, hex.row);
          }
          if (gameEngine && typeof gameEngine.getCityAt === 'function') {
            cityAt = gameEngine.getCityAt(hex.col, hex.row);
          }
        } catch (e) {
          unitAt = null;
          cityAt = null;
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
            return; // Don't proceed with normal selection
          }
          
          if (actions && typeof actions.selectUnit === 'function') {
            actions.selectUnit(unitAt.id);
          }
          
          // If the unit has a path and moves, continue following
          const existingPath = unitPaths.get(unitAt.id);
          if (existingPath && existingPath.length > 0 && unitAt.movesRemaining > 0) {
            const nextPos = existingPath[0];
            try {
              const moveResult = gameEngine?.moveUnit?.(unitAt.id, nextPos.col, nextPos.row);
              if (moveResult && moveResult.success) {
                const remainingPath = existingPath.slice(1);
                setUnitPaths(prev => {
                  const next = new Map(prev);
                  next.set(unitAt.id, remainingPath);
                  return next;
                });
                
                const roundManager = (gameEngine as any)?.roundManager;
                if (roundManager && typeof roundManager.setUnitPath === 'function') {
                  roundManager.setUnitPath(unitAt.id, remainingPath);
                }
                
                console.log(`[CLICK] Unit ${unitAt.id} continued path to (${nextPos.col}, ${nextPos.row}), remaining:`, remainingPath);
              }
            } catch (e) {
              console.log(`[CLICK] Continue path error:`, e);
            }
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
            try {
              if (gameEngine && typeof gameEngine.moveUnit === 'function') {
                const result = gameEngine.moveUnit(selectedUnitId, hex.col, hex.row);
                if (!result || !result.success) {
                  const reason = result?.reason || 'unknown';
                  console.log(`[CLICK] Move failed: ${reason}`);
                  if (actions && typeof actions.addNotification === 'function') {
                    let msg = 'Move failed';
                    switch (reason) {
                      case 'no_moves_left': msg = 'Move failed: no moves left'; break;
                      case 'terrain_impassable': msg = 'Move failed: terrain is impassable'; break;
                      case 'insufficient_moves': msg = 'Move failed: insufficient movement points'; break;
                      default: msg = 'Move failed';
                    }
                    actions.addNotification({ type: 'warning', message: msg });
                  }
                }
              }
            } catch (e) {
              console.log(`[CLICK] Move error:`, e);
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
      if (gameEngine && typeof gameEngine.getUnitAt === 'function') {
        unitAtHex = gameEngine.getUnitAt(hex.col, hex.row);
      }
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
      if (gameEngine && typeof gameEngine.getCityAt === 'function') {
        cityAtHex = gameEngine.getCityAt(hex.col, hex.row);
      }
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

  const executeContextAction = (action: string, data: unknown = null) => {
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
          if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
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
            if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
            if (actions?.addNotification) actions.addNotification({
              type: 'success',
              message: `${unit.type} woke up`
            });
          } else if (gameEngine.unitSleep) {
            console.log(`[ContextMenu] Sleep action for unit ${unit.id}`);
            gameEngine.unitSleep(unit.id);
            if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
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
          if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
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

      case 'found_city':
        if (unit && gameEngine?.foundCityWithSettler) {
          console.log(`[ContextMenu] Found city action for unit ${unit.id}`);
          const result = gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            if (actions?.updateCities) actions.updateCities(gameEngine.cities);
            if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
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
            if (actions?.updateUnits) actions.updateUnits(gameEngine.units);
            if (actions?.updateMap) actions.updateMap(gameEngine.map);
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

  // Optimized animation loop for turn-based game (always 10 FPS)
  useEffect(() => {
    let lastFrameTime = 0;
    const targetFPS = 10; // Always 10 FPS for turn-based game
    const frameInterval = 1000 / targetFPS;

    const animate = (currentTime) => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Check if game state changed (trigger immediate render)
      if (hasGameStateChanged()) {
        needsRender.current = true;
      }

      // Always render at 10 FPS for turn-based gameplay
      const elapsed = currentTime - lastFrameTime;
      if (elapsed > frameInterval) {
        lastFrameTime = currentTime - (elapsed % frameInterval);
        renderFrame(currentTime);
        needsRender.current = false; // Reset flag after rendering
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [camera, selectedHex, mapData, terrain, gameState, units, cities, hasGameStateChanged, renderFrame]);

  // Trigger render when camera changes (pan/zoom)
  useEffect(() => {
    // Reset render state to avoid stale/overly-large draws after zoom/pan
    needsRender.current = true;
    lastRenderTime.current = 0;
    // Clear last known game state so hasGameStateChanged will re-evaluate fully
    lastGameState.current = null;

    // Cancel any pending render timeout that may have been scheduled
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }

    // Force a quick refresh on the next animation frame (safe no-op if render not ready)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame((t) => {
        try {
          renderFrame(t);
        } catch (e) {
          // swallow errors here - render will run in the main loop as well
          // console.debug('[GameCanvas] render() initial call failed after camera change', e);
        }
      });
    }
  }, [camera.x, camera.y, camera.zoom]);

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
        />
      )}
    </div>
  );
};

export default GameCanvas;