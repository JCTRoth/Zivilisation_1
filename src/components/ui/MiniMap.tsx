import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { TILE_SIZE } from '@/data/TerrainData';
import { MapRenderer } from '@/game/rendering/MapRenderer';
import type { GameEngine } from '../../../types/game';
import '../../styles/miniMap.css';

// Declare window properties
declare global {
  interface Window {
    __MINIMAP_FILE_EVALUATED?: number;
    __MINIMAP_MISSED_TYPE_REPORTED?: boolean;
    __MINIMAP_DRAWN_ONCE?: boolean;
  }
}

// Top-level evaluation marker for debugging whether this module is actually loaded by Vite/React
if (typeof window !== 'undefined') {
  window.__MINIMAP_FILE_EVALUATED = (window.__MINIMAP_FILE_EVALUATED || 0) + 1;
  // Only log first few times to avoid spam
  if (window.__MINIMAP_FILE_EVALUATED < 5) {
    console.log('[MiniMap] Module evaluated count:', window.__MINIMAP_FILE_EVALUATED);
  }
}

interface MiniMapProps {
  gameEngine?: GameEngine | null;
}

const MiniMap: React.FC<MiniMapProps> = ({ gameEngine = null }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRendererRef = useRef<MapRenderer>(new MapRenderer());
  const [sizeKey, setSizeKey] = useState(0); // bump to force redraw on resize
  const camera = useGameStore(state => state.camera);
  const actions = useGameStore(state => state.actions);
  const mapData = useGameStore(state => state.map);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const civilizations = useGameStore(state => state.civilizations);
  const settings = useGameStore(state => state.settings);
  const activePlayer = useGameStore(state => state.gameState.activePlayer);
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

    const dataSource = mapData;
    if (!dataSource || !Array.isArray(dataSource.tiles) || dataSource.tiles.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = Math.max(1, Math.floor(container.clientWidth));
    const cssHeightFromContainer = Math.max(0, Math.floor(container.clientHeight || 0));
    const cssHeight = cssHeightFromContainer > 32 ? cssHeightFromContainer : Math.max(1, Math.floor((cssWidth * MINIMAP_HEIGHT) / MINIMAP_WIDTH));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.imageSmoothingEnabled = false;

    const civilizationsSource = effectiveCivilizations && effectiveCivilizations.length > 0 ? effectiveCivilizations : civilizations;

    // Filter units and cities based on devMode setting
    let visibleUnits = units;
    let visibleCities = cities;
    
    if (!settings.devMode) {
      // In normal mode, only show human player's units and cities
      visibleUnits = units.filter(u => u.civilizationId === activePlayer);
      visibleCities = cities.filter(c => c.civilizationId === activePlayer);
      console.log('[MiniMap] Normal mode: Showing only player', activePlayer, 'units/cities');
    } else {
      console.log('[MiniMap] Developer mode: Showing all units/cities');
    }

    mapRendererRef.current.renderMinimap({
      ctx,
      map: dataSource,
      cssWidth,
      cssHeight,
      camera,
      units: visibleUnits,
      cities: visibleCities,
      civilizations: civilizationsSource || []
    });
  }, [camera, mapData, cities, units, civilizations, effectiveCivilizations, settings.devMode, activePlayer, sizeKey]);

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
  const handleMinimapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('MiniMap: Minimap clicked');
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

  // Convert minimap coordinates (CSS pixels) to world coordinates using square tile sizes
  const tileSize = TILE_SIZE;
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