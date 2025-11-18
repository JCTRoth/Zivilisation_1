import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/GameStore';
import '../../styles/miniMap.css';

// Declare window properties
declare global {
  interface Window {
    __MINIMAP_FILE_EVALUATED?: number;
    __MINIMAP_MISSED_TYPE_REPORTED?: boolean;
    __MINIMAP_DRAWN_ONCE?: boolean;
  }
}
import { Constants } from '../../utils/Constants';
import { UNIT_TYPES } from '../../data/GameData';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sizeKey, setSizeKey] = useState(0); // bump to force redraw on resize
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const mapData = useGameStore(state => state.map);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const civilizations = useGameStore(state => state.civilizations);
  // Also get civilizations from gameEngine if available (more reliable)
  const gameEngineCivilizations = gameEngine?.civilizations || [];
  const effectiveCivilizations = gameEngineCivilizations.length > 0 ? gameEngineCivilizations : civilizations;

  const MINIMAP_WIDTH = 200; // aspect ratio baseline
  const MINIMAP_HEIGHT = 150;

  // Render minimap
  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    const container: HTMLDivElement | null = containerRef.current;
    if (!canvas || !container) return;

    // Use map data from store for consistent visibility data
    const dataSource = mapData;
    if (!dataSource || !dataSource.tiles || !dataSource.tiles.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

  // Measure CSS size from container (fill both width and height)
  // Prefer filling the container's height if available so minimap can fill a "board" area.
  const cssWidth = Math.max(1, Math.floor(container.clientWidth));
  // Use container.clientHeight when provided; fallback to aspect ratio if height is 0
  const cssHeightFromContainer = Math.max(0, Math.floor(container.clientHeight || 0));
  const cssHeight = cssHeightFromContainer > 32 ? cssHeightFromContainer : Math.max(1, Math.floor((cssWidth * MINIMAP_HEIGHT) / MINIMAP_WIDTH));

    // Device pixel ratio backing store for crisp rendering
    const dpr = Math.max(1, window.devicePixelRatio || 1);
  // Apply full-size CSS so canvas stretches to container
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    // Reset transform and scale so drawing uses CSS pixels coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Defensive reset of context state
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.imageSmoothingEnabled = false;
    } catch (e) {}

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    // Fill a neutral background so any fully-transparent drawing doesn't show as black
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Calculate scale factors (in CSS pixels)
    const scaleX = cssWidth / dataSource.width;
    const scaleY = cssHeight / dataSource.height;

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
  const terrainProps = Constants.TERRAIN_PROPS[typeKey];
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
    if (units && units.length > 0 && effectiveCivilizations && effectiveCivilizations.length > 0) {
      
      for (const unit of units) {
        const tileIndex = unit.row * dataSource.width + unit.col;
        const isVisible = dataSource.visibility ? dataSource.visibility[tileIndex] : false;
        const unitTypeKey = unit.type.toUpperCase();
        const unitType = UNIT_TYPES[unitTypeKey];
        const hasSight = unitType?.sightRange > 0;
        
        if (isVisible || hasSight) {
          const x = unit.col * scaleX;
          const y = unit.row * scaleY;
          
          // Use civilization color for units
          const civilization = effectiveCivilizations.find(c => c.id === unit.civilizationId);
          ctx.fillStyle = civilization?.color || '#ff0000';
          
          ctx.fillRect(x, y, Math.max(1, scaleX/2), Math.max(1, scaleY/2));
        }
      }
    }

  // Draw viewport indicator in tile-space so it aligns to square tiles
  const tileSize = Constants.HEX_SIZE || 32; // world pixels per tile (square tiles)
  // scaleX/Y maps tiles -> CSS pixels per tile
  const cssPerTileX = cssWidth / dataSource.width;
  const cssPerTileY = cssHeight / dataSource.height;

  // Camera.world x/y are in world pixels; convert to tile coordinates
  const cameraTileX = camera.x / tileSize;
  const cameraTileY = camera.y / tileSize;

  // World viewport size in tiles
  const viewportTilesW = (window.innerWidth / camera.zoom) / tileSize;
  const viewportTilesH = (window.innerHeight / camera.zoom) / tileSize;

  // Convert to CSS pixels on the minimap
  const viewportX = cameraTileX * cssPerTileX;
  const viewportY = cameraTileY * cssPerTileY;
  const viewportW = viewportTilesW * cssPerTileX;
  const viewportH = viewportTilesH * cssPerTileY;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.max(0, viewportX),
      Math.max(0, viewportY),
      Math.min(cssWidth - viewportX, viewportW),
      Math.min(cssHeight - viewportY, viewportH)
    );

    // end draw

  }, [camera, mapData, mapData?.tiles?.length, cities, units, civilizations, gameEngine, gameEngine?.currentTurn, gameEngine?.isInitialized, sizeKey]);

  // Resize observer to redraw when container width changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      // bump key to re-run drawing effect
      setSizeKey(k => k + 1);
    });
    ro.observe(container);
    // also observe window resizes for safety
    const onWin = () => setSizeKey(k => k + 1);
    window.addEventListener('resize', onWin);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, []);

  // Handle minimap clicks to move camera
  const handleMinimapClick = (event) => {
    console.log('MiniMap: Minimap clicked');
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

  // Convert minimap coordinates (CSS pixels) to world coordinates using square tile sizes
  const tileSize = 32; // Same as TILE_SIZE in GameCanvas
  const mapPixelWidth = mapData.width * tileSize;
  const mapPixelHeight = mapData.height * tileSize;

  const worldX = (x / rect.width) * mapPixelWidth;
  const worldY = (y / rect.height) * mapPixelHeight;

    // Center camera on clicked position
    actions.updateCamera({
      x: worldX - (window.innerWidth / camera.zoom) / 2,
      y: worldY - (window.innerHeight / camera.zoom) / 2
    });
  };

  return (
    <div className="minimap-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="border border-secondary minimap-canvas"
        onClick={handleMinimapClick}
      />
    </div>
  );
};

export default MiniMap;