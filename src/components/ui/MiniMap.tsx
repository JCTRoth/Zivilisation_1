import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';

// Declare window properties
declare global {
  interface Window {
    __MINIMAP_FILE_EVALUATED?: number;
    __MINIMAP_MISSED_TYPE_REPORTED?: boolean;
    __MINIMAP_DRAWN_ONCE?: boolean;
  }
}
import { CONSTANTS } from '../../utils/constants';
import { UNIT_TYPES } from '../../game/gameData.js';

// Top-level evaluation marker for debugging whether this module is actually loaded by Vite/React
if (typeof window !== 'undefined') {
  window.__MINIMAP_FILE_EVALUATED = (window.__MINIMAP_FILE_EVALUATED || 0) + 1;
  // Only log first few times to avoid spam
  if (window.__MINIMAP_FILE_EVALUATED < 5) {
    console.log('[MiniMap] Module evaluated count:', window.__MINIMAP_FILE_EVALUATED);
  }
}

const MiniMap = ({ gameEngine }) => {
  const canvasRef = useRef(null);
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const mapData = useGameStore(state => state.map);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);

  const MINIMAP_WIDTH = 200;
  const MINIMAP_HEIGHT = 150;

  // Render minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    // Use map data from store for consistent visibility data
    const dataSource = mapData;

    if (!dataSource) {
      return;
    }
    if (!dataSource.tiles || !dataSource.tiles.length) {
      return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = MINIMAP_WIDTH;
    canvas.height = MINIMAP_HEIGHT;

    // Clear canvas
    // Defensive reset of context state (HMR/other renders can leave globalCompositeOperation or globalAlpha changed)
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.imageSmoothingEnabled = false;
    } catch (e) {
      // some browsers may be read-only for certain properties on certain contexts
    }

    ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    // Fill a neutral background so any fully-transparent drawing doesn't show as black
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    // Calculate scale factors
    const scaleX = MINIMAP_WIDTH / dataSource.width;
    const scaleY = MINIMAP_HEIGHT / dataSource.height;

  // Cache fog state so the minimap still works if arrays are missing/empty early on
  const hasRevealedData = Array.isArray(dataSource.revealed) && dataSource.revealed.length === dataSource.tiles.length;
  const hasVisibilityData = Array.isArray(dataSource.visibility) && dataSource.visibility.length === dataSource.tiles.length;
  const anyRevealed = hasRevealedData ? dataSource.revealed.some(Boolean) : false;

  // Draw terrain tiles with visibility/exploration shading
  let drawn = 0;
    for (let row = 0; row < dataSource.height; row++) {
      for (let col = 0; col < dataSource.width; col++) {
        const tileIndex = row * dataSource.width + col;
        const tile = dataSource.tiles[tileIndex];
        if (!tile) continue;

        const x = col * scaleX;
        const y = row * scaleY;

        const typeKey = (tile.type || '').toLowerCase();
  const terrainProps = CONSTANTS.TERRAIN_PROPS[typeKey];
        if (!terrainProps && !window.__MINIMAP_MISSED_TYPE_REPORTED) {
          console.warn('[MiniMap] Missing terrain props for type:', tile.type);
          window.__MINIMAP_MISSED_TYPE_REPORTED = true;
        }
        const baseColor = terrainProps ? terrainProps.color : '#555555';

        // Always draw underlying terrain first so the minimap never renders as a solid void
        ctx.fillStyle = baseColor;
        ctx.fillRect(x, y, scaleX + 1, scaleY + 1); // +1 to avoid gaps at low scale

        // Apply fog-of-war as translucent overlays so unexplored areas remain readable
        const isExplored = hasRevealedData ? dataSource.revealed[tileIndex] : true;
        const isVisible = hasVisibilityData ? dataSource.visibility[tileIndex] : true;

        if (hasRevealedData && anyRevealed) {
          if (!isExplored) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(x, y, scaleX + 1, scaleY + 1);
          } else if (!isVisible) {
            ctx.fillStyle = 'rgba(9, 13, 20, 0.25)';
            ctx.fillRect(x, y, scaleX + 1, scaleY + 1);
          }
        }
        drawn++;
      }
    }

    if (drawn === 0) {
      console.warn('[MiniMap] Drew 0 terrain tiles.');
    } else if (!window.__MINIMAP_DRAWN_ONCE) {
      console.log('[MiniMap] Drew', drawn, 'tiles on minimap.');
      window.__MINIMAP_DRAWN_ONCE = true;
    }

    // (debug logs removed)

    // Draw cities
    if (cities && cities.length > 0) {
      ctx.fillStyle = '#ffff00';
      
      for (const city of cities) {
        const tileIndex = city.row * dataSource.width + city.col;
        const isVisible = dataSource.visibility ? dataSource.visibility[tileIndex] : false;
        
        if (isVisible) {
          const x = city.col * scaleX;
          const y = city.row * scaleY;
          
          ctx.beginPath();
          ctx.arc(x + scaleX/2, y + scaleY/2, Math.max(1, scaleX/3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw units (simplified)
    if (units && units.length > 0) {
      
      for (const unit of units) {
        const tileIndex = unit.row * dataSource.width + unit.col;
        const isVisible = dataSource.visibility ? dataSource.visibility[tileIndex] : false;
        const unitTypeKey = unit.type.toUpperCase();
        const unitType = UNIT_TYPES[unitTypeKey];
        const hasSight = unitType?.sightRange > 0;
        
        if (isVisible || hasSight) {
          const x = unit.col * scaleX;
          const y = unit.row * scaleY;
          
          // Different colors for different players
          if (unit.civilizationId === 0) {
            ctx.fillStyle = '#00ff00'; // Player units in green
          } else {
            ctx.fillStyle = '#ff0000'; // AI units in red
          }
          
          ctx.fillRect(x, y, Math.max(1, scaleX/2), Math.max(1, scaleY/2));
        }
      }
    }

    // Draw viewport indicator
  const viewportX = (camera.x / (dataSource.width * 32)) * MINIMAP_WIDTH;
  const viewportY = (camera.y / (dataSource.height * 24)) * MINIMAP_HEIGHT;
  const viewportW = (window.innerWidth / camera.zoom / (dataSource.width * 32)) * MINIMAP_WIDTH;
  const viewportH = (window.innerHeight / camera.zoom / (dataSource.height * 24)) * MINIMAP_HEIGHT;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.max(0, viewportX),
      Math.max(0, viewportY),
      Math.min(MINIMAP_WIDTH - viewportX, viewportW),
      Math.min(MINIMAP_HEIGHT - viewportY, viewportH)
    );

  }, [camera, mapData, mapData?.tiles?.length, cities, units, gameEngine?.currentTurn, gameEngine?.isInitialized]);

  // Handle minimap clicks to move camera
  const handleMinimapClick = (event) => {
    console.log('MiniMap: Minimap clicked');
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert minimap coordinates to world coordinates
    const worldX = (x / MINIMAP_WIDTH) * mapData.width * 32;
    const worldY = (y / MINIMAP_HEIGHT) * mapData.height * 24;

    // Center camera on clicked position
    actions.updateCamera({
      x: worldX - (window.innerWidth / camera.zoom) / 2,
      y: worldY - (window.innerHeight / camera.zoom) / 2
    });
  };

  return (
    <div className="minimap-container">
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        className="border border-secondary"
        style={{ 
          width: '100%', 
          height: '100%',
          cursor: 'pointer',
          imageRendering: 'pixelated' 
        }}
        onClick={handleMinimapClick}
      />
    </div>
  );
};

export default MiniMap;