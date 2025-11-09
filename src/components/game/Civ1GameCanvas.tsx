import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { UNIT_TYPES } from '../../game/gameData.js';
import { CONSTANTS } from '../../utils/constants';
import { TERRAIN_TYPES, getTerrainInfo, TILE_SIZE } from '../../game/terrain/terrainData';
import type { Tile } from '../../../types/game';
import '../../styles/civ1GameCanvas.css';

const Civ1GameCanvas = ({ minimap = false, onExamineHex, gameEngine }) => {
  const canvasRef = useRef(null);
  const terrainCanvasRef = useRef(null);
  const gameState = useGameStore(state => state.gameState);
  const mapData = useGameStore(state => state.map);
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [selectedHex, setSelectedHex] = useState({ col: 5, row: 5 });
  const [contextMenu, setContextMenu] = useState(null);
  const [terrain, setTerrain] = useState(null);
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
      const generatedTerrain = generateTerrain(mapData.width || CONSTANTS.MAP_WIDTH, mapData.height || CONSTANTS.MAP_HEIGHT);
      setTerrain(generatedTerrain);
      renderTerrainToOffscreen(generatedTerrain);
    }
  }, [gameEngine, gameEngine?.map, gameEngine?.units, mapData.width, mapData.height]);

  // Update terrain visibility when game state changes
  useEffect(() => {
    console.log('[Civ1GameCanvas] Updating terrain visibility', {
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
      console.warn('[Civ1GameCanvas] Terrain grid mismatch detected. Rebuilding terrain from mapData.tiles');
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
        console.warn('[Civ1GameCanvas] Cannot rebuild terrain: invalid mapData.tiles length');
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
      console.log('[Civ1GameCanvas] Terrain visibility updated');
    } else {
      console.log('[Civ1GameCanvas] Skipping terrain visibility update - missing data');
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
  const drawTerrainSymbol = (ctx, centerX, centerY, terrain) => {
    const terrainInfo = getTerrainInfo(terrain.type);
    if (!terrainInfo) return;
    // Defensive checks: ensure coordinates are finite and char is valid
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
    const char = terrainInfo.char ?? '';
    if (typeof char !== 'string' || char.length === 0) return;

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
    
    // Draw improvements
    if (terrain.hasRiver) {
      try {
        ctx.fillStyle = '#0066FF';
        ctx.fillText('~', centerX + 8, centerY + 8);
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText river failed', err);
      }
    }
    
    if (terrain.hasRoad) {
      try {
        ctx.fillStyle = '#8B4513';
        ctx.fillText('═', centerX, centerY + 12);
      } catch (err) {
        console.warn('[drawTerrainSymbol] fillText road failed', err);
      }
    }
  };

  // Draw city
  const drawCity = (ctx, centerX, centerY, city) => {
    // City background
    ctx.fillStyle = city.owner === 0 ? '#FFD700' : '#FF6347';
    ctx.fillRect(centerX - 12, centerY - 12, 24, 24);
    
    // City border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - 12, centerY - 12, 24, 24);
    
    // City symbol
    ctx.fillStyle = '#000';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏛️', centerX, centerY);
    
    // City name
    ctx.font = '10px monospace';
    ctx.fillStyle = '#000';
    ctx.fillText(city.name, centerX, centerY + 20);
    
    // City size
    ctx.fillStyle = '#FFF';
    ctx.fillText((city.population || 1).toString(), centerX + 10, centerY - 10);
  };

  // Draw unit (alpha optional for blinking)
  const drawUnit = (ctx, centerX, centerY, unit, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Scale factor for icon - make everything 5x bigger
    const scale = 4;
    const baseRadius = 10; // previous radius
    const radius = baseRadius * scale;

    // Unit background
    ctx.fillStyle = unit.owner === 0 ? '#4169E1' : '#DC143C';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();

    // Unit border (scale stroke width a bit)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(2, 0.5 * scale);
    ctx.stroke();

    // Unit icon (prefer unit.icon, then UNIT_TYPES lookup)
    ctx.fillStyle = '#FFF';
    // Scale font size by same factor
    const fontSize = 12 * scale;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const unitTypeKey = unit.type?.toUpperCase();
    const typeDef = unitTypeKey ? (UNIT_TYPES[unitTypeKey] || null) : null;
    const icon = unit.icon || typeDef?.icon || '⚔️';
    ctx.fillText(icon, centerX, centerY);

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
          ctx.fillStyle = tile.city.owner === 0 ? '#FFD700' : '#FF6347';
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
    if (terrainCanvasRef.current) {
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

        // Draw selection highlight (red border)
        const isSelected = selectedHex.col === col && selectedHex.row === row;
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
          ctx.fillText(`${col},${row}`, x, y + TILE_SIZE + 10);
        }
      }
    }
    
    // Draw selected hex info
    if (selectedHex && terrain && gameEngine) {
      const tile = terrain[selectedHex.row]?.[selectedHex.col];
      if (tile) {
      const unit = units.find(u => u.col === selectedHex.col && u.row === selectedHex.row);
      const city = cities.find(c => c.col === selectedHex.col && c.row === selectedHex.row);        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(10, 10, 200, 80);
        
        ctx.fillStyle = '#FFF';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Hex: ${selectedHex.col}, ${selectedHex.row}`, 15, 25);
        ctx.fillText(`Terrain: ${TERRAIN_TYPES[tile.type]?.name}`, 15, 40);
        if (city) ctx.fillText(`City: ${city.name}`, 15, 55);
        if (unit) ctx.fillText(`Unit: ${unit.name || unit.type}`, 15, 70);
        if (tile.hasRiver) ctx.fillText(`🌊 River`, 15, 85);
      }
    }
  };

  // Handle mouse events
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    triggerRender(); // Immediate render for visual feedback
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
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
        setSelectedHex(hex);
        setContextMenu(null); // Hide context menu on left click

        console.log(`[CLICK] Map click at hex (${hex.col}, ${hex.row})`);

        // If we have a gameEngine available, try to select unit/city or move selected unit
        if (gameEngine) {
          // Prefer engine helper methods when present
          const unitAt = units.find(u => u.col === hex.col && u.row === hex.row) || null;

          const cityAt = cities.find(c => c.col === hex.col && c.row === hex.row) || null;

          if (unitAt) {
            // Select the clicked unit
            console.log(`[CLICK] Selected unit ${unitAt.id} (${unitAt.type}) at (${hex.col}, ${hex.row})`);
            if (actions && typeof actions.selectUnit === 'function') actions.selectUnit(unitAt.id);
          } else if (cityAt) {
            console.log(`[CLICK] Selected city ${cityAt.id} (${cityAt.name}) at (${hex.col}, ${hex.row})`);

            const storeState = useGameStore.getState();
            const storeCity = storeState.cities.find(c => c.id === cityAt.id) || storeState.cities.find(c => c.col === hex.col && c.row === hex.row);
            const cityData = cityAt || storeCity || null;
            const cityId = cityData?.id || storeCity?.id || null;

            console.log(`[CLICK] City data:`, { cityAt, storeCity, cityData, cityId });

            if (actions && typeof actions.selectCity === 'function') {
              actions.selectCity(cityId ?? null);
            }

            const humanCiv = storeState.civilizations.find(c => c.isHuman);
            const humanCivId = humanCiv?.id ?? gameEngine?.gameSettings?.playerCivilization ?? 0;
            const cityOwnerId = cityData?.civilizationId ?? null;
            const isOwnedByPlayer = humanCivId != null && cityOwnerId != null && Number(cityOwnerId) === Number(humanCivId);

            console.log(`[CLICK] Ownership check: humanCivId=${humanCivId}, cityOwnerId=${cityOwnerId}, isOwnedByPlayer=${isOwnedByPlayer}`);

            if (isOwnedByPlayer && actions && typeof actions.showDialog === 'function') {
              console.log(`[CLICK] Opening city-details modal`);
              actions.showDialog('city-details');
            }
          } else if (gameState.selectedUnit) {
            // Attempt to move the currently selected unit to the clicked hex
            console.log(`[CLICK] Attempting to move selected unit ${gameState.selectedUnit} to (${hex.col}, ${hex.row})`);
            const result = gameEngine.moveUnit(gameState.selectedUnit, hex.col, hex.row);
            if (!result || !result.success) {
              const reason = result?.reason || 'unknown';
              console.log(`[CLICK] Move failed: ${reason}`);
              if (actions && typeof actions.addNotification === 'function') {
                let msg = 'Move failed';
                switch (reason) {
                  case 'unit_not_found': msg = 'Move failed: unit not found'; break;
                  case 'invalid_target': msg = 'Move failed: invalid destination'; break;
                  case 'no_moves_left': msg = 'Move failed: no moves left'; break;
                  case 'terrain_impassable': msg = 'Move failed: terrain is impassable'; break;
                  case 'insufficient_moves': msg = 'Move failed: insufficient movement points'; break;
                  case 'combat_defeat': msg = 'Move resulted in combat and the attacker was defeated'; break;
                  default: msg = 'Move failed';
                }
                actions.addNotification({ type: 'warning', message: msg });
              }
            }
          } else {
            console.log(`[CLICK] Empty hex clicked at (${hex.col}, ${hex.row}) - no unit or city selected`);
          }
        }
      }
    }
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hex = screenToSquare(x, y);
    
    if (!terrain) return;
    const tile = terrain[hex.row]?.[hex.col];
    if (!tile) return;

    // Only show right-click options when clicking a human player's unit
    let unitAtEngine = null;
    try {
      if (gameEngine && typeof gameEngine.getUnitAt === 'function') {
        unitAtEngine = gameEngine.getUnitAt(hex.col, hex.row);
      }
    } catch (e) {
      unitAtEngine = null;
    }

    const unitInfo = unitAtEngine || tile.unit || null;
    const civId = unitInfo ? (unitInfo.civilizationId ?? unitInfo.owner ?? null) : null;
    let civIsHuman = false;
    if (civId !== null && typeof gameEngine?.civilizations !== 'undefined') {
      const civ = gameEngine.civilizations?.[civId];
      civIsHuman = civ ? !!civ.isHuman : false;
    }

    // If no unit or unit is not a human player's, do not show context menu
    if (!unitInfo || civIsHuman !== true) {
      return;
    }

    // Generate context menu options based on tile content
    const menuOptions = [];

    // Unit actions only (we limit options to player's units here)
    menuOptions.push({
      label: `⚔️ ${unitInfo.type} Orders`,
      action: 'unitOrders',
      enabled: true,
      submenu: [
        { label: '🏰 Fortify', action: 'fortify' },
        { label: '👁️ Sentry', action: 'sentry' },
        { label: '💤 Skip Turn', action: 'skipTurn' },
        { label: '🏠 Go to Home City', action: 'goHome' }
      ]
    });

    const isSettler = (unitInfo.type === 'settlers' || unitInfo.type === 'settler');
    if (isSettler && civId === 0) {
      menuOptions.push({
        label: '🏙️ Build City',
        action: 'buildCity',
        enabled: !tile.city && tile.type !== 'OCEAN',
        description: 'Found a new city here'
      });
    }

    // City actions
    if (tile.city && tile.city.owner === 0) {
      menuOptions.push({
        label: `🏛️ ${tile.city.name}`,
        action: 'cityOrders',
        enabled: true,
        submenu: [
          { label: '🏭 Production', action: 'viewProduction' },
          { label: '👥 Citizens', action: 'viewCitizens' },
          { label: '📊 Info', action: 'cityInfo' },
          { label: '🏗️ Buy Building', action: 'buyBuilding' }
        ]
      });
    }

    // General actions
    menuOptions.push({
      label: '📍 Center View',
      action: 'centerView',
      enabled: true,
      description: 'Center camera on this tile'
    });

    if (tile.type !== 'OCEAN') {
      menuOptions.push({
        label: '🔍 Examine Terrain',
        action: 'examineHex',
        enabled: true,
        description: 'Get detailed terrain information'
      });
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      hex: hex,
      tile: tile,
      options: menuOptions
    });
  };

  const executeContextAction = (action, data = null) => {
    console.log(`Executing action: ${action}`, data);
    
    if (!terrain) return;

    switch (action) {
      case 'buildRoad':
        // Update terrain to add road
        const newTerrain = [...terrain];
        newTerrain[contextMenu.hex.row][contextMenu.hex.col].hasRoad = true;
        setTerrain(newTerrain);
        break;
        
      case 'irrigate':
        // Add irrigation improvement
        const irrigatedTerrain = [...terrain];
        irrigatedTerrain[contextMenu.hex.row][contextMenu.hex.col].improvement = 'irrigation';
        setTerrain(irrigatedTerrain);
        break;
        
      case 'mine':
        // Add mine improvement
        const minedTerrain = [...terrain];
        minedTerrain[contextMenu.hex.row][contextMenu.hex.col].improvement = 'mine';
        setTerrain(minedTerrain);
        break;
        
      case 'buildCity':
        // Build a new city via the game engine if available
        if (gameEngine && typeof gameEngine.foundCityWithSettler === 'function') {
          // Try to find the settler unit at this location
          const unit = gameEngine.getUnitAt(contextMenu.hex.col, contextMenu.hex.row) || contextMenu.tile.unit;
          if (unit && (unit.type === 'settlers' || unit.type === 'settler')) {
            const ok = gameEngine.foundCityWithSettler(unit.id);
            if (ok) {
              // Sync store
              if (typeof actions.updateCities === 'function') actions.updateCities(gameEngine.getAllCities());
              if (typeof actions.updateUnits === 'function') actions.updateUnits(gameEngine.getAllUnits());
              if (typeof actions.updateMap === 'function') actions.updateMap(gameEngine.map);
              if (typeof actions.addNotification === 'function') actions.addNotification({ type: 'success', message: 'City founded!' });
            } else {
              if (typeof actions.addNotification === 'function') actions.addNotification({ type: 'warning', message: 'Failed to found city' });
            }
          } else {
            if (typeof actions.addNotification === 'function') actions.addNotification({ type: 'warning', message: 'No settler present to found a city' });
          }
        } else {
          // Fallback visual: add city to terrain
          const cityTerrain = [...terrain];
          cityTerrain[contextMenu.hex.row][contextMenu.hex.col].city = {
            name: 'New City',
            size: 1,
            owner: 0
          };
          // Remove the settler unit visually
          cityTerrain[contextMenu.hex.row][contextMenu.hex.col].unit = null;
          setTerrain(cityTerrain);
          if (typeof actions.addNotification === 'function') actions.addNotification({ type: 'info', message: 'City placed (visual only)' });
        }
        break;
        
      case 'centerView':
        // Center camera on selected hex
        const { x, y } = squareToScreen(contextMenu.hex.col, contextMenu.hex.row);
        actions.updateCamera({
          x: contextMenu.hex.col * TILE_SIZE - canvasRef.current.width / 2,
          y: contextMenu.hex.row * TILE_SIZE - canvasRef.current.height / 2
        });
        break;
        
      case 'fortify':
      case 'sentry':
      case 'skipTurn':
      case 'goHome':
        // Unit order actions
        console.log(`Unit ${contextMenu.tile.unit?.type} executing: ${action}`);
        break;
        
      case 'viewProduction':
      case 'viewCitizens':
      case 'cityInfo':
      case 'buyBuilding':
        // City management actions
        console.log(`City ${contextMenu.tile.city?.name} action: ${action}`);
        break;
        
      case 'examineHex':
        // Show detailed hex information modal
        if (onExamineHex) {
          onExamineHex(contextMenu.hex, terrain);
        }
        break;
    }
    
    setContextMenu(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    
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
          // console.debug('[Civ1GameCanvas] render() initial call failed after camera change', e);
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

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
      triggerRender(); // Render to hide context menu
    };
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  return (
    <div className="position-relative w-100 h-100">
      <canvas
        ref={canvasRef}
        className="w-100 h-100"
        style={{ cursor: minimap ? 'pointer' : (isDragging ? 'grabbing' : 'grab') }}
        tabIndex={minimap ? -1 : 0}
        onMouseDown={minimap ? null : handleMouseDown}
        onMouseMove={minimap ? null : handleMouseMove}
        onMouseUp={minimap ? null : handleMouseUp}
        onClick={handleClick}
        onContextMenu={minimap ? null : handleRightClick}
        onWheel={minimap ? null : handleWheel}
      />
      
      {/* Context Menu (not shown on minimap) */}
      {!minimap && contextMenu && (
        <div
          className="position-fixed bg-dark border border-light text-white"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            minWidth: '200px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-secondary p-2 border-bottom border-light">
            <strong>
              {contextMenu.tile.city ? `${contextMenu.tile.city.name}` : 
               contextMenu.tile.unit ? `${contextMenu.tile.unit.type}` :
               `${TERRAIN_TYPES[contextMenu.tile.type]?.name}`}
            </strong>
            <div className="context-menu-coords">
              ({contextMenu.hex.col}, {contextMenu.hex.row})
            </div>
          </div>
          
          {contextMenu.options.map((option, index) => (
            <div key={index}>
              <button
                className={`btn btn-sm w-100 text-start border-0 rounded-0 context-menu-button ${
                  option.enabled ? 'btn-dark text-white' : 'btn-secondary text-muted'
                }`}
                disabled={!option.enabled}
                onClick={() => option.submenu ? null : executeContextAction(option.action)}
              >
                {option.label}
                {option.submenu && ' ▶'}
              </button>
              
              {option.submenu && (
                <div className="ms-3 border-start border-secondary">
                  {option.submenu.map((subOption, subIndex) => (
                    <button
                      key={subIndex}
                      className="btn btn-sm btn-dark text-white w-100 text-start border-0 rounded-0 context-menu-sub-button"
                      onClick={() => executeContextAction(subOption.action)}
                    >
                      {subOption.label}
                    </button>
                  ))}
                </div>
              )}
              
              {option.description && (
                <div className="px-2 py-1 bg-info text-dark context-menu-description">
                  {option.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Civ1GameCanvas;