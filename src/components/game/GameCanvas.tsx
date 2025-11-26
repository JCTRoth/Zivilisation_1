import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { UNIT_TYPES } from '@/data/GameData';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { Constants } from '@/utils/Constants';
import { TERRAIN_TYPES, getTerrainInfo, TILE_SIZE } from '@/data/TerrainData';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES, ImprovementDisplayConfig } from '@/data/TileImprovementConstants';
import '../../styles/civ1GameCanvas.css';
import UnitActionsModal from './UnitActionsModal';
import { Pathfinding } from '../../game/engine/Pathfinding';

const GameCanvas = ({ minimap = false, onExamineHex, gameEngine }) => {
  const canvasRef = useRef(null);
  const terrainCanvasRef = useRef(null);
  const gameState = useGameStore(state => state.gameState);
  const mapData = useGameStore(state => state.map);
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const currentPlayer = useGameStore(state => state.civilizations[state.gameState.activePlayer] || null);
  const civilizations = useGameStore(state => state.civilizations);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [selectedHex, setSelectedHex] = useState({ col: 5, row: 5 });
  const [contextMenu, setContextMenu] = useState(null);
  const [terrain, setTerrain] = useState(null);
  const [gotoMode, setGotoMode] = useState(false);
  const [gotoUnit, setGotoUnit] = useState(null);
  const [unitPaths, setUnitPaths] = useState(new Map()); // unitId -> path array
  const animationFrameRef = useRef(null);
  const renderTimeoutRef = useRef(null);
  const lastRenderTime = useRef(0);
  const needsRender = useRef(true); // Flag to track if re-render is needed
  const lastGameState = useRef(null); // Track game state changes

  // Trigger re-render when game state changes (turn-based optimization)
  const triggerRender = () => {
    needsRender.current = true;
  };

  // Check if game state has changed significantly
  const hasGameStateChanged = () => {
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
  };

  // Generate terrain map (initialize once)
  const generateTerrain = (width, height) => {
    if (terrain) return terrain; // Return cached terrain
    
    const newTerrain = [];
    for (let row = 0; row < height; row++) {
      newTerrain[row] = [];
      for (let col = 0; col < width; col++) {
        // Create varied terrain with some logic
        const distance = Math.sqrt((col - width/2) ** 2 + (row - height/2) ** 2);
        const noise = Math.sin(col * 0.1) * Math.cos(row * 0.1);
        
        let terrainType;
        if (distance > width * 0.4) {
          terrainType = 'OCEAN';
        } else if (noise > 0.5) {
          terrainType = 'FOREST';
        } else if (noise > 0.2) {
          terrainType = 'HILLS';
        } else if (noise < -0.3) {
          terrainType = 'MOUNTAINS';
        } else {
          terrainType = Math.random() > 0.5 ? 'PLAINS' : 'GRASSLAND';
        }
        
        newTerrain[row][col] = {
          type: terrainType,
          hasRiver: Math.random() < 0.1 && terrainType !== 'OCEAN',
          hasRoad: false,
          improvement: null,
          city: null,
          unit: null
        };
      }
    }

    return newTerrain;
  };

  // Render static terrain (background + fog) to offscreen canvas
  const renderTerrainToOffscreen = (terrainGrid) => {
    if (!terrainGrid || !mapData) return;
    
    const offscreenCanvas = terrainCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;
    
    // Set offscreen canvas size to match map dimensions (scaled)
    const mapWidth = mapData.width * TILE_SIZE;
    const mapHeight = mapData.height * TILE_SIZE;
    if (offscreenCanvas.width !== mapWidth || offscreenCanvas.height !== mapHeight) {
      offscreenCanvas.width = mapWidth;
      offscreenCanvas.height = mapHeight;
    }
    
    // Clear offscreen canvas
    ctx.clearRect(0, 0, mapWidth, mapHeight);
    
    // Draw all tiles (static terrain + fog)
    for (let row = 0; row < mapData.height; row++) {
      for (let col = 0; col < mapData.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile) continue;
        
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        
        // Fog of War: Only render explored tiles
        if (!tile.explored) {
          // Draw completely black square for unexplored areas
          drawSquare(ctx, x, y, TILE_SIZE, '#000000', '#000000');
          continue;
        }
        
        const terrainInfo = TERRAIN_TYPES[tile.type] || TERRAIN_TYPES[tile.type?.toUpperCase()] || TERRAIN_TYPES.GRASSLAND;
        
        // Draw square background
        drawSquare(ctx, x, y, TILE_SIZE, terrainInfo.color, '#333');
        
        // Draw terrain details
        drawTerrainSymbol(ctx, x, y, tile);
        
        // Apply fog overlay for explored but not currently visible tiles
        if (!tile.visible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  };

  // Initialize terrain from game engine
  useEffect(() => {
    // Prefer authoritative store data (`mapData.tiles`) to avoid races where gameEngine.map
    // might be present but the store hasn't synchronized yet. Fall back to gameEngine.map
    // then to the procedural generator.
    if (mapData && Array.isArray(mapData.tiles) && mapData.tiles.length === mapData.width * mapData.height) {
      const terrainGrid = new Array(mapData.height);
      for (let row = 0; row < mapData.height; row++) {
        terrainGrid[row] = new Array(mapData.width);
        for (let col = 0; col < mapData.width; col++) {
          const tileIndex = row * mapData.width + col;
          const tile = mapData.tiles[tileIndex];
          if (!tile) continue;

          terrainGrid[row][col] = {
            type: tile.type,
            resource: tile.resource ?? null,
            improvement: tile.improvement ?? null,
            visible: mapData.visibility?.[tileIndex] ?? tile.visible ?? false,
            explored: mapData.revealed?.[tileIndex] ?? tile.explored ?? false
          };
        }
      }
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);

    } else if (gameEngine && gameEngine.map && Array.isArray(gameEngine.map.tiles) && gameEngine.map.tiles.length > 0) {
      // Older fallback: use engine's map if available
      const terrainGrid = [];
      for (let row = 0; row < mapData.height; row++) {
        terrainGrid[row] = [];
        for (let col = 0; col < mapData.width; col++) {
          const tileIndex = row * mapData.width + col;
          const tile = gameEngine.map.tiles[tileIndex];
          if (tile) {
            const visibleFromStore = mapData.visibility?.[tileIndex] ?? tile.visible ?? false;
            const exploredFromStore = mapData.revealed?.[tileIndex] ?? tile.explored ?? false;

            terrainGrid[row][col] = {
              type: tile.type,
              resource: tile.resource,
              improvement: tile.improvement,
              visible: visibleFromStore,
              explored: exploredFromStore
            };
          }
        }
      }
      setTerrain(terrainGrid);
      renderTerrainToOffscreen(terrainGrid);

    } else if (!terrain) {
      // Last-resort fallback to procedural generation
      const generatedTerrain = generateTerrain(mapData.width || Constants.MAP_WIDTH, mapData.height || Constants.MAP_HEIGHT);
      setTerrain(generatedTerrain);
      renderTerrainToOffscreen(generatedTerrain);
    }
  }, [gameEngine, gameEngine?.map, gameEngine?.units, mapData.width, mapData.height, mapData.tiles]);

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
    if (gameEngine && gameEngine.roundManager) {
      console.log('[GameCanvas] Syncing unit paths from RoundManager on turn change');
      const paths = gameEngine.roundManager.getAllUnitPaths();
      setUnitPaths(paths);
    }
  }, [gameState.currentTurn, gameEngine]);

  // Convert square coordinates to screen position
  const squareToScreen = (col, row) => {
    const x = (col * TILE_SIZE - camera.x) * camera.zoom;
    const y = (row * TILE_SIZE - camera.y) * camera.zoom;
    return { x, y };
  };

  // Convert screen position to square coordinates
  const screenToSquare = (screenX, screenY) => {
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
  };

  // Draw square
  const drawSquare = (ctx, centerX, centerY, size, fillColor, strokeColor = '#000') => {
    const halfSize = size / 2;
    ctx.beginPath();
    ctx.rect(centerX - halfSize, centerY - halfSize, size, size);

    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // Draw terrain symbols
  type DrawTerrainRenderOptions = {
    drawBase?: boolean;
    drawRivers?: boolean;
  };

  const drawTerrainSymbol = (ctx, centerX, centerY, terrain, options: DrawTerrainRenderOptions = {}) => {
    const { drawBase = true, drawRivers = true } = options;
    const terrainInfo = getTerrainInfo(terrain.type);
    if (!terrainInfo) return;
    // Defensive checks: ensure coordinates are finite and char is valid
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
    const char = terrainInfo.char ?? '';
    if (drawBase && (typeof char !== 'string' || char.length === 0)) return;

    if (drawBase) {
      ctx.fillStyle = '#000';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw terrain character (guard against runtime canvas exceptions)
      try {
        ctx.fillText(char, centerX, centerY - 8);
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText failed', { err, char, centerX, centerY });
      }
    }

    // Ensure alignment for subsequent overlay glyphs
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw river overlay unless suppressed (avoid double rendering when overlaying)
    if (drawRivers && terrain.hasRiver) {
      try {
        ctx.font = '16px monospace';
        ctx.fillStyle = '#0066FF';
        ctx.fillText('~', centerX + 8, centerY + 8);
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText river failed', err);
      }
    }
    
    const drawDisplayGlyph = (display?: ImprovementDisplayConfig | null): boolean => {
      if (!display || !display.glyph) return false;
      try {
        ctx.font = display.font ?? 'bold 14px monospace';
        ctx.fillStyle = display.color ?? '#8B4513';
        const dx = display.offsetX ?? 0;
        const dy = display.offsetY ?? 12;
        ctx.fillText(display.glyph, centerX + dx, centerY + dy);
        return true;
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText improvement glyph failed', err);
        return false;
      }
    };

    const drawLabelForImprovement = (impKey: string, display?: ImprovementDisplayConfig | null) => {
      if (display?.skipLabel) return;
      const impDef = IMPROVEMENT_PROPERTIES[impKey];
      const baseLabel = display?.label || impDef?.name?.[0] || impKey[0]?.toUpperCase();
      if (!baseLabel) return;

      try {
        ctx.font = display?.font ?? 'bold 12px monospace';
        ctx.fillStyle = display?.color ?? '#ff0000ff';
        const dx = display?.offsetX ?? 10;
        const dy = display?.offsetY ?? -10;
        ctx.fillText(baseLabel, centerX + dx, centerY + dy);
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText improvement label failed', err);
      }
    };

    const roadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD]?.display;
    const railroadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD]?.display;
    let roadDrawn = false;

    if (terrain?.hasRoad && roadDisplay) {
      roadDrawn = drawDisplayGlyph(roadDisplay);
    }

    const improvementKey = terrain?.improvement ? String(terrain.improvement) : null;
    if (improvementKey) {
      const improvementDef = IMPROVEMENT_PROPERTIES[improvementKey];
      const display = improvementDef?.display;

      if (improvementKey === IMPROVEMENT_TYPES.ROAD) {
        if (!roadDrawn) {
          roadDrawn = drawDisplayGlyph(display || roadDisplay);
        }
      } else if (improvementKey === IMPROVEMENT_TYPES.RAILROAD) {
        drawDisplayGlyph(display || railroadDisplay);
      } else {
        const glyphDrawn = drawDisplayGlyph(display);
        if (!glyphDrawn) {
          drawLabelForImprovement(improvementKey, display);
        } else if (!display?.skipLabel) {
          drawLabelForImprovement(improvementKey, display);
        }
      }
    }
  };

  // Draw city
  const drawCity = (ctx, centerX, centerY, city) => {
    // City background - use civilization color if available
    const civColor = (civilizations && civilizations[city.civilizationId] && civilizations[city.civilizationId].color) || (city.civilizationId === 0 ? '#FFD700' : '#FF6347');
    ctx.fillStyle = civColor;
    ctx.fillRect(centerX - 21, centerY - 21, 42, 42);
    
    // City border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - 21, centerY - 21, 42, 42);
    
    // City symbol
  ctx.fillStyle = '#000';
  ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏛️', centerX, centerY);
    
    // City name
    ctx.font = '10px monospace';
    ctx.fillStyle = '#000';
    ctx.fillText(city.name, centerX, centerY + 24);
  };

  // Draw unit
  const drawUnit = (ctx, centerX, centerY, unit, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Unit marker
    const zoomFactor = typeof camera?.zoom === 'number' ? Math.min(Math.max(camera.zoom, 0.5), 1.5) : 1;
    const baseRadius = 20;
    const radius = Math.round(baseRadius * zoomFactor);

    // Unit background - use civilization color if available
    const civIndex = unit.civilizationId ?? unit.owner;
    const civColor = (civilizations && civilizations[civIndex] && civilizations[civIndex].color) || (civIndex === 0 ? '#4169E1' : '#DC143C');

    // Draw civ-colored disc as unit marker (no outer halo)
    const innerRadius = Math.max(8, Math.round(radius * 0.95));
    ctx.beginPath();
    ctx.fillStyle = civColor;
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Determine icon color (contrast with civColor)
    const hexToRgb = (hex) => {
      if (!hex) return { r: 0, g: 0, b: 0 };
      const normalized = hex.replace('#', '');
      const bigint = parseInt(normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized, 16);
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    };
    const rgb = hexToRgb(civColor);
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    const iconColor = luminance > 0.6 ? '#111' : '#FFF';
    ctx.fillStyle = iconColor;

    // Resolve unit type definitions from multiple data sources.
    // unit.type in the engine is usually the id (e.g. 'settler', 'warrior').
    const unitTypeId = unit.type ? String(unit.type) : null;

    // Prefer a direct lookup into the exported UNIT_TYPES from gameData.
    // Keys in UNIT_TYPES may be inconsistent (pluralization), so match by the inner `id` where possible.
    let gameTypeDef = null;
    if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
      try {
        gameTypeDef = Object.values(UNIT_TYPES).find((t: any) => t && String(t.id).toLowerCase() === String(unitTypeId).toLowerCase()) || null;
      } catch (e) {
        gameTypeDef = null;
      }
    }

    // Fallback to UNIT_PROPERTIES (unitConstants) which uses lowercase ids as keys
    const typeDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;

    // Choose icon priority:
    // 1) explicit runtime unit.icon (engine may set this)
    // 2) game data UNIT_TYPES icon
    // 3) unit constants icon
    // 4) first letter of type name
    const icon = unit.icon || gameTypeDef?.icon || typeDef?.icon || (typeDef?.name ? typeDef.name[0] : (unit.type ? String(unit.type)[0].toUpperCase() : 'U')) || '⚔️';
    const fontSize = Math.max(10, Math.round(innerRadius * 1.1));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try {
      ctx.fillText(icon, centerX, centerY);
    } catch (err) {
      // Fallback to first letter if emoji/text can't be drawn
      const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
      ctx.fillText(fallback, centerX, centerY);
    }

    // Draw sleeping indicator (💤) at bottom center if unit is sleeping
    if (unit.isSleeping) {
      const sleepIcon = '💤';
      const sleepFontSize = Math.max(8, Math.round(innerRadius * 0.7));
      ctx.font = `${sleepFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = iconColor; // Use same color as main icon
      ctx.fillText(sleepIcon, centerX, centerY + 22);
    }

    ctx.restore();
  };

  // Draw unit path as red lines

  // Draw unit path as red lines
  const drawUnitPath = (ctx, unitId, path, units, gameState, squareToScreen) => {
    if (!path || path.length < 2) return;

    // Find the unit to check if it's selected
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // Only draw path for selected unit
    if (gameState.selectedUnit !== unitId) return;

    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    let first = true;
    for (const pos of path) {
      const { x, y } = squareToScreen(pos.col, pos.row);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw arrow at the end
    if (path.length >= 2) {
      const last = path[path.length - 1];
      const secondLast = path[path.length - 2];
      const { x: x1, y: y1 } = squareToScreen(secondLast.col, secondLast.row);
      const { x: x2, y: y2 } = squareToScreen(last.col, last.row);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const arrowLen = 10;
        const arrowAngle = Math.PI / 6; // 30 degrees
        const angle = Math.atan2(dy, dx);
        const leftAngle = angle - arrowAngle;
        const rightAngle = angle + arrowAngle;
        const leftX = x2 - arrowLen * Math.cos(leftAngle);
        const leftY = y2 - arrowLen * Math.sin(leftAngle);
        const rightX = x2 - arrowLen * Math.cos(rightAngle);
        const rightY = y2 - arrowLen * Math.sin(rightAngle);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(leftX, leftY);
        ctx.moveTo(x2, y2);
        ctx.lineTo(rightX, rightY);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  // Render minimap
  const renderMinimap = (ctx, canvas) => {
    const minimapWidth = canvas.width;
    const minimapHeight = canvas.height;
    
    // Calculate pixel size per tile
    const tileWidth = minimapWidth / mapData.width;
    const tileHeight = minimapHeight / mapData.height;
    
    // Draw all terrain as colored pixels
    let exploredCount = 0;
    let totalTiles = 0;
    for (let row = 0; row < mapData.height; row++) {
      for (let col = 0; col < mapData.width; col++) {
        const tile = terrain[row]?.[col];
        if (!tile) continue;
        
        totalTiles++;
        
        // Fog of War: Only render explored tiles
        if (!tile.explored) {
          // Draw completely black for unexplored areas
          ctx.fillStyle = '#000000';
          ctx.fillRect(
            col * tileWidth,
            row * tileHeight,
            tileWidth + 1,
            tileHeight + 1
          );
          continue;
        }
        
        exploredCount++;
  const terrainInfo = getTerrainInfo(tile.type) || { color: '#000000' };
  ctx.fillStyle = terrainInfo.color;
        ctx.fillRect(
          col * tileWidth,
          row * tileHeight,
          tileWidth + 1,
          tileHeight + 1
        );
        
        // Only show cities and units in currently visible areas
        const isVisible = tile.visible;
        
        // Draw cities as bright dots (only if visible)
        if (tile.city && isVisible) {
          ctx.fillStyle = tile.city.civilizationId === 0 ? '#FFD700' : '#FF6347';
          ctx.fillRect(
            col * tileWidth,
            row * tileHeight,
            tileWidth * 2,
            tileHeight * 2
          );
        }
        
        // Draw units as small dots (visible units or units with sight)
        if (tile.unit && isVisible) {
          ctx.fillStyle = tile.unit.owner === 0 ? '#FFFFFF' : '#FF0000';
          ctx.fillRect(
            col * tileWidth + tileWidth/3,
            row * tileHeight + tileHeight/3,
            tileWidth/3,
            tileHeight/3
          );
        }
        
        // Apply fog overlay for explored but not currently visible tiles
        if (!isVisible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(
            col * tileWidth,
            row * tileHeight,
            tileWidth + 1,
            tileHeight + 1
          );
        }
      }
    }
    
    // Draw viewport rectangle
    const viewportStartCol = Math.floor(camera.x / TILE_SIZE);
    const viewportStartRow = Math.floor(camera.y / TILE_SIZE);
    const viewportWidth = Math.ceil(canvas.width / camera.zoom / TILE_SIZE);
    const viewportHeight = Math.ceil(canvas.height / camera.zoom / TILE_SIZE);
    
    ctx.strokeStyle = '#FFFF00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      viewportStartCol * tileWidth,
      viewportStartRow * tileHeight,
      viewportWidth * tileWidth,
      viewportHeight * tileHeight
    );
    
    // Draw border around minimap
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, minimapWidth, minimapHeight);
  };

  // Render the map (optimized with throttling)
  const render = (currentTime = performance.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    
    // Set canvas size only if changed
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    
  // Clear canvas and allow CSS background to show through for the game area
  ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Use cached terrain
    if (!terrain) return;

    const hasOffscreenTerrain = Boolean(terrainCanvasRef.current);

    // Minimap rendering
    if (minimap) {
      renderMinimap(ctx, canvas);
      return;
    }
    
    // Calculate visible bounds for culling (performance optimization)
    const startCol = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 2);
    const endCol = Math.min(mapData.width, Math.ceil((camera.x + canvas.width / camera.zoom) / TILE_SIZE) + 2);
    const startRow = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 2);
    const endRow = Math.min(mapData.height, Math.ceil((camera.y + canvas.height / camera.zoom) / TILE_SIZE) + 2);

    // Copy visible portion of terrain from offscreen canvas
    if (hasOffscreenTerrain) {
      const terrainCanvas = terrainCanvasRef.current;
      const terrainCtx = terrainCanvas.getContext('2d');

      // Calculate source rectangle from offscreen canvas (world coordinates)
      const srcX = camera.x;
      const srcY = camera.y;
      const srcWidth = canvas.width / camera.zoom;
      const srcHeight = canvas.height / camera.zoom;

      // Destination rectangle on main canvas (screen coordinates)
      const destX = 0;
      const destY = 0;
      const destWidth = canvas.width;
      const destHeight = canvas.height;

      // Copy terrain layer
      ctx.drawImage(
        terrainCanvas,
        srcX, srcY, srcWidth, srcHeight,
        destX, destY, destWidth, destHeight
      );
    } else {
      // Fallback: draw terrain directly if offscreen canvas not available
      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const { x, y } = squareToScreen(col, row);

          // Additional viewport check
          if (x < -TILE_SIZE * 2 || x > canvas.width + TILE_SIZE * 2 ||
              y < -TILE_SIZE * 2 || y > canvas.height + TILE_SIZE * 2) {
            continue;
          }

          const tile = terrain[row]?.[col];
          if (!tile) continue;

          // Fog of War: Only render explored tiles
          if (!tile.explored) {
            // Draw completely black hex for unexplored areas
            drawSquare(
              ctx,
              x,
              y,
              TILE_SIZE * camera.zoom,
              '#000000',
              '#000000'
            );
            continue;
          }

          const terrainInfo = TERRAIN_TYPES[tile.type] || TERRAIN_TYPES[tile.type?.toUpperCase()] || TERRAIN_TYPES.GRASSLAND;
          const isSelected = selectedHex.col === col && selectedHex.row === row;

          // Draw hex background
          drawSquare(
            ctx,
            x,
            y,
            TILE_SIZE * camera.zoom,
            terrainInfo.color,
            isSelected ? '#FF0000' : '#333'
          );

          // Draw terrain details only at reasonable zoom levels
          if (camera.zoom > 0.5) {
            drawTerrainSymbol(ctx, x, y, tile);
          }

          // Apply fog overlay for explored but not currently visible tiles
          if (!tile.visible) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            const halfSize = TILE_SIZE * camera.zoom / 2;
            ctx.fillRect(x - halfSize, y - halfSize, TILE_SIZE * camera.zoom, TILE_SIZE * camera.zoom);
          }
        }
      }
    }

    // Draw dynamic elements on top (cities, units, selection highlights)
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const { x, y } = squareToScreen(col, row);

        // Additional viewport check
        if (x < -TILE_SIZE * 2 || x > canvas.width + TILE_SIZE * 2 ||
            y < -TILE_SIZE * 2 || y > canvas.height + TILE_SIZE * 2) {
          continue;
        }

        const tile = terrain[row]?.[col];
        if (!tile || !tile.explored) continue;

        // Overlay improvements/roads when using offscreen terrain to reflect latest map state
        if (hasOffscreenTerrain && camera.zoom > 0.5) {
          const tileIndex = row * mapData.width + col;
          const authoritativeTile = mapData.tiles && mapData.tiles[tileIndex] ? mapData.tiles[tileIndex] : null;

          // Merge authoritative improvement/road/river flags into the transient terrain tile
          const authority: any = authoritativeTile;
          const overlayTile = {
            ...tile,
            improvement: authority?.improvement ?? tile.improvement,
            hasRoad: authority?.hasRoad ?? (tile as any)?.hasRoad ?? false,
            hasRiver: authority?.hasRiver ?? (tile as any)?.hasRiver ?? false
          };

          drawTerrainSymbol(ctx, x, y, overlayTile, { drawBase: false, drawRivers: false });
        }

        // Only draw units and cities if tile is currently visible (not just explored)
        const isVisible = tile.visible;

        // Draw city from game engine
        if (gameEngine && camera.zoom > 0.3 && isVisible) {
          const city = cities.find(c => c.col === col && c.row === row);
          if (city) {
            drawCity(ctx, x, y, city);
          }
        }

        // Draw unit from game engine
        if (gameEngine && camera.zoom > 0.3 && isVisible) {
          const unit = units.find(u => u.col === col && u.row === row);
          if (unit) {
            // Determine if this unit should blink: belongs to active player and has moves remaining
            const isActivePlayersUnit = unit.civilizationId === gameState.activePlayer;
            const hasMoves = (unit.movesRemaining || 0) > 0;
            let alpha = 1;
            if (isActivePlayersUnit && hasMoves) {
              // Blink using a smooth sine wave based on currentTime
              const period = 2000; // ms per full cycle
              const t = (currentTime % period) / period; // 0..1
              const sine = Math.sin(t * Math.PI * 2); // -1..1
              // Map to [0.35, 1.0]
              alpha = 0.675 + 0.325 * (sine + 1) / 2; // between ~0.35 and 1.0
            }
            drawUnit(ctx, x, y, unit, alpha);
          }
        }

        // Draw selection highlight (red border) for selected units
        const selectedUnitId = gameState.selectedUnit;
        const unitAtTile = units.find(u => u.col === col && u.row === row);
        const isSelected = selectedUnitId && unitAtTile && unitAtTile.id === selectedUnitId;
        if (isSelected) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 3;
          ctx.strokeRect(x - TILE_SIZE * camera.zoom / 2, y - TILE_SIZE * camera.zoom / 2, TILE_SIZE * camera.zoom, TILE_SIZE * camera.zoom);
        }

        // Draw coordinates only when zoomed in
        if (camera.zoom > 1.5) {
          ctx.fillStyle = '#000';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${col},${row}`, x, y + TILE_SIZE);
        }
      }
    }

    // Draw unit paths for all units that have paths
    unitPaths.forEach((path, unitId) => {
      drawUnitPath(ctx, unitId, path, units, gameState, squareToScreen);
    });

  };

  // Handle mouse events
  const handleMouseDown = (e) => {
    // Don't allow dragging in Go To mode
    if (gotoMode) {
      return;
    }
    
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    triggerRender(); // Immediate render for visual feedback
  };

  const handleMouseMove = (e) => {
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

  const handleClick = (e) => {
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
              (col, row) => {
                // Get tile from terrain data
                const tileIndex = row * mapData.width + col;
                return mapData.tiles?.[tileIndex] || null;
              },
              gotoUnit.type,
              mapData.width,
              mapData.height
            );

            if (pathResult.success && pathResult.path.length > 1) {
              // Store the path (excluding the starting position)
              const pathToFollow = pathResult.path.slice(1);
              setUnitPaths(prev => new Map(prev).set(gotoUnit.id, pathToFollow));
              
              // Sync with RoundManager in GameEngine
              if (gameEngine && gameEngine.roundManager) {
                gameEngine.roundManager.setUnitPath(gotoUnit.id, pathToFollow);
                console.log(`[CLICK] Path synced to RoundManager for unit ${gotoUnit.id}`);
              }
              
              if (actions?.addNotification) actions.addNotification({
                type: 'success',
                message: `${gotoUnit.type} will go to (${hex.col}, ${hex.row})`
              });
              
              console.log(`[CLICK] Path calculated for unit ${gotoUnit.id}:`, pathToFollow);
              
              // Try to move to first step automatically
              if (pathToFollow.length > 0 && gotoUnit.movesRemaining > 0) {
                const nextPos = pathToFollow[0];
                try {
                  const moveResult = gameEngine.moveUnit(gotoUnit.id, nextPos.col, nextPos.row);
                  if (moveResult && moveResult.success) {
                    // Update path to remaining
                    const remainingPath = pathToFollow.slice(1);
                    setUnitPaths(prev => new Map(prev).set(gotoUnit.id, remainingPath));
                    
                    // Sync with RoundManager
                    if (gameEngine && gameEngine.roundManager) {
                      gameEngine.roundManager.setUnitPath(gotoUnit.id, remainingPath);
                    }
                    
                    console.log(`[CLICK] Unit ${gotoUnit.id} moved to (${nextPos.col}, ${nextPos.row}), remaining path:`, remainingPath);
                  } else {
                    console.log(`[CLICK] Automatic move failed for unit ${gotoUnit.id}`);
                  }
                } catch (e) {
                  console.log(`[CLICK] Automatic move error:`, e);
                }
              }
              
              // Trigger render to show the path immediately
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
              const moveResult = gameEngine.moveUnit(unitAt.id, nextPos.col, nextPos.row);
              if (moveResult && moveResult.success) {
                const remainingPath = existingPath.slice(1);
                setUnitPaths(prev => new Map(prev).set(unitAt.id, remainingPath));
                
                // Sync with RoundManager
                if (gameEngine && gameEngine.roundManager) {
                  gameEngine.roundManager.setUnitPath(unitAt.id, remainingPath);
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

  const handleRightClick = (e) => {
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

  const executeContextAction = (action: string, data = null) => {
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

  const handleWheel = (e) => {
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
        render(currentTime);
        needsRender.current = false; // Reset flag after rendering
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [camera, selectedHex, mapData, terrain, gameState, units, cities]);

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
          render(t);
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