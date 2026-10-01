import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { TILE_SIZE } from '@/data/TerrainData';
import { MiniMapRenderer } from '@/game/rendering/MiniMapRenderer';
import GameEngine from '@/game/engine/GameEngine';
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
  const miniMapRendererRef = useRef<MiniMapRenderer>(new MiniMapRenderer());
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
    // A running AI-vs-AI game pushes dozens of store updates per second, each
    // one re-running this effect — and each draw repaints every tile (5760 on
    // the 96x60 maps). Coalesce them into a single draw per animation frame:
    // the last params win, and the frame after the last update still renders
    // (so a final state is never dropped).
    const frame = requestAnimationFrame(() => drawMinimap());
    return () => cancelAnimationFrame(frame);

    function drawMinimap(): void {
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

      // Show all units and cities, rely on fog-of-war visibility in renderer.
      // This ensures enemy movement appears on the minimap only when inside player vision.
      miniMapRendererRef.current.renderMinimap({
        ctx,
        map: dataSource,
        cssWidth,
        cssHeight,
        camera,
        units,
        cities,
        civilizations: civilizationsSource || [],
        ignoreFog: !!settings.devMode
      });
    }
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

  // Convert minimap CSS coordinates to world coordinates
  const minimapToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const tileSize = TILE_SIZE;
    const mapPixelWidth = mapData.width * tileSize;
    const mapPixelHeight = mapData.height * tileSize;
    return {
      worldX: (x / rect.width) * mapPixelWidth,
      worldY: (y / rect.height) * mapPixelHeight,
    };
  }, [mapData.width, mapData.height]);

  // Drag state
  const draggingRef = useRef(false);

  // Center camera on a world position
  const centerCameraOn = useCallback((worldX: number, worldY: number) => {
    actions.updateCamera({
      x: worldX - (window.innerWidth / camera.zoom) / 2,
      y: worldY - (window.innerHeight / camera.zoom) / 2,
    });
  }, [actions, camera.zoom]);

  // Handle minimap click (quick click without drag)
  const handleMinimapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = minimapToWorld(event.clientX, event.clientY);
    if (coords) centerCameraOn(coords.worldX, coords.worldY);
  };

  // Mouse down – start drag
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return; // left button only
    draggingRef.current = true;
    event.preventDefault();
    const coords = minimapToWorld(event.clientX, event.clientY);
    if (coords) centerCameraOn(coords.worldX, coords.worldY);
  };

  // Mouse move – continue drag
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      const coords = minimapToWorld(event.clientX, event.clientY);
      if (coords) centerCameraOn(coords.worldX, coords.worldY);
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minimapToWorld, centerCameraOn]);

  return (
    <div className="minimap-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="border border-secondary minimap-canvas"
        onClick={handleMinimapClick}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

export default MiniMap;