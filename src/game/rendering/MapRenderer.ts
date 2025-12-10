/**
 * MapRenderer - Core rendering engine for Civilization 1 game maps
 *
 * This module provides comprehensive canvas-based rendering for the game world,
 * including terrain layers, dynamic game objects (units, cities), and minimap
 * visualization. It handles camera transformations, fog of war, and performance
 * optimizations through offscreen rendering and viewport culling.
 *
 * Key features:
 * - Terrain rendering with improvements and resources
 * - Dynamic content overlay (units, cities, selection highlights)
 * - Minimap with fog of war and viewport indicator
 * - Camera-aware viewport culling for performance
 * - Offscreen terrain layer caching
 */

import { Constants } from '@/utils/Constants';
import { TILE_SIZE, getTerrainInfo, TERRAIN_TYPES } from '@/data/TerrainData';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES, ImprovementDisplayConfig } from '@/data/TileImprovementConstants';
import { UNIT_TYPES } from '@/data/GameData';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { getUnitIcon } from '@/utils/UnitIconLoader';
import type { MapState, CameraState, Unit, City, GameState, Civilization } from '../../../types/game';


/**
 * 2D grid representing terrain tiles for rendering purposes.
 * Each cell contains rendering information for a map tile.
 */
export type TerrainRenderGrid = Array<Array<TerrainTileRenderInfo | null>>;

/**
 * Rendering information for a single terrain tile.
 * Contains all visual properties needed to draw the tile.
 */
export interface TerrainTileRenderInfo {
  /** Terrain type identifier (e.g., 'GRASSLAND', 'OCEAN') */
  type: string;
  /** Optional resource type present on this tile */
  resource?: string | null;
  /** Optional improvement or structure on this tile */
  improvement?: string | Record<string, unknown> | null;
  /** Whether this tile is currently visible to the player */
  visible?: boolean;
  /** Whether this tile has been explored/discovered */
  explored?: boolean;
  /** Whether this tile has a road improvement */
  hasRoad?: boolean;
  /** Whether this tile has a river */
  hasRiver?: boolean;
}

/**
 * Parameters for rendering the static terrain layer to an offscreen canvas.
 */
export interface TerrainLayerParams {
  /** Offscreen canvas to render terrain onto */
  offscreenCanvas: HTMLCanvasElement;
  /** Current map state */
  map: MapState;
  /** Terrain grid containing rendering data */
  terrainGrid: TerrainRenderGrid;
}

/**
 * Represents a single step in a unit's movement path.
 */
export interface UnitPathStep {
  /** Column coordinate of the path step */
  col: number;
  /** Row coordinate of the path step */
  row: number;
}

/**
 * Parameters for rendering a complete game frame including terrain and dynamic content.
 */
export interface RenderFrameParams {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Main game canvas element */
  canvas: HTMLCanvasElement;
  /** Current map state */
  map: MapState;
  /** Terrain grid (null if using offscreen rendering) */
  terrainGrid: TerrainRenderGrid | null;
  /** Current camera state */
  camera: CameraState;
  /** Currently selected hex coordinates */
  selectedHex: { col: number; row: number } | null;
  /** Current game state */
  gameState: GameState;
  /** Array of all units in the game */
  units: Unit[];
  /** Array of all cities in the game */
  cities: City[];
  /** Array of all civilizations */
  civilizations: Civilization[];
  /** Movement paths for units (unit ID -> path steps) */
  unitPaths: Map<string, UnitPathStep[]>;
  /** Current timestamp for animations */
  currentTime: number;
  /** Optional offscreen canvas for terrain layer */
  offscreenCanvas?: HTMLCanvasElement | null;
  /** Function to convert map coordinates to screen coordinates */
  squareToScreen: (col: number, row: number) => { x: number; y: number };
  /** Current camera zoom level */
  cameraZoom: number;
  /** Reachable tiles for movement range indicator */
  reachableTiles?: Map<string, number>;
}

/**
 * Parameters for rendering static content (no animations).
 */
export interface RenderStaticFrameParams {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Main game canvas element */
  canvas: HTMLCanvasElement;
  /** Current map state */
  map: MapState;
  /** Terrain grid (null if using offscreen rendering) */
  terrainGrid: TerrainRenderGrid | null;
  /** Current camera state */
  camera: CameraState;
  /** Currently selected hex coordinates */
  selectedHex: { col: number; row: number } | null;
  /** Current game state */
  gameState: GameState;
  /** Array of all units in the game */
  units: Unit[];
  /** Array of all cities in the game */
  cities: City[];
  /** Array of all civilizations */
  civilizations: Civilization[];
  /** Movement paths for units (unit ID -> path steps) */
  unitPaths: Map<string, UnitPathStep[]>;
  /** Optional offscreen canvas for terrain layer */
  offscreenCanvas?: HTMLCanvasElement | null;
  /** Function to convert map coordinates to screen coordinates */
  squareToScreen: (col: number, row: number) => { x: number; y: number };
  /** Current camera zoom level */
  cameraZoom: number;
  /** Reachable tiles for movement range indicator */
  reachableTiles?: Map<string, number>;
}

/**
 * Parameters for rendering animated pulsing units.
 */
export interface RenderPulsingUnitsParams {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Current map state */
  map: MapState;
  /** Array of all units in the game */
  units: Unit[];
  /** Current game state */
  gameState: GameState;
  /** Array of all civilizations */
  civilizations: Civilization[];
  /** Current timestamp for animations */
  currentTime: number;
  /** Function to convert map coordinates to screen coordinates */
  squareToScreen: (col: number, row: number) => { x: number; y: number };
  /** Current camera zoom level */
  cameraZoom: number;
  /** ID of the current unit in the turn queue (only this unit should pulse) */
  currentQueueUnitId?: string | null;
}

/**
 * Parameters for rendering the minimap.
 */
export interface RenderMinimapParams {
  /** Minimap canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Current map state */
  map: MapState;
  /** Minimap width in CSS pixels */
  cssWidth: number;
  /** Minimap height in CSS pixels */
  cssHeight: number;
  /** Current camera state */
  camera: CameraState;
  /** Array of all units in the game */
  units: Unit[];
  /** Array of all cities in the game */
  cities: City[];
  /** Array of all civilizations */
  civilizations: Civilization[];
  /** When true, ignore fog-of-war (show all tiles/units) */
  ignoreFog?: boolean;
}

/**
 * Options for drawing terrain symbols (improvements, resources, etc.).
 */
interface DrawTerrainSymbolOptions {
  /** Whether to draw base terrain symbols */
  drawBase?: boolean;
  /** Whether to draw river overlays */
  drawRivers?: boolean;
}

/**
 * Bounds of the visible area in map coordinates.
 */
interface VisibleBounds {
  /** Starting column (inclusive) */
  startCol: number;
  /** Ending column (exclusive) */
  endCol: number;
  /** Starting row (inclusive) */
  startRow: number;
  /** Ending row (exclusive) */
  endRow: number;
}

/**
 * Size of a canvas in pixels.
 */
interface CanvasSize {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
}

/**
 * State of fog of war for minimap rendering.
 */
interface MinimapFogState {
  /** Whether the map has revealed tiles data */
  hasRevealed: boolean;
  /** Whether the map has visibility data */
  hasVisibility: boolean;
  /** Whether any tiles have been revealed */
  anyRevealed: boolean;
}

/**
 * Parameters for drawing dynamic content (units, cities, overlays).
 */
interface DynamicContentParams {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D;
  /** Current map state */
  map: MapState;
  /** Terrain grid containing rendering data */
  terrainGrid: TerrainRenderGrid;
  /** Visible bounds in map coordinates */
  bounds: VisibleBounds;
  /** Canvas size in pixels */
  canvasSize: CanvasSize;
  /** Currently selected hex coordinates */
  selectedHex: { col: number; row: number } | null;
  /** Current game state */
  gameState: GameState;
  /** Array of all units in the game */
  units: Unit[];
  /** Array of all cities in the game */
  cities: City[];
  /** Array of all civilizations */
  civilizations: Civilization[];
  /** Current timestamp for animations */
  currentTime: number;
  /** Current camera zoom level */
  cameraZoom: number;
  /** Whether offscreen terrain rendering is available */
  hasOffscreen: boolean;
  /** Function to convert map coordinates to screen coordinates */
  squareToScreen: (col: number, row: number) => { x: number; y: number };
  /** Reachable tiles for movement range indicator */
  reachableTiles?: Map<string, number>;
}

/**
 * Core rendering engine for Civilization 1 game maps.
 *
 * Handles all canvas-based rendering including terrain, units, cities,
 * minimap, and various visual effects. Uses performance optimizations
 * like viewport culling and offscreen rendering.
 */
export class MapRenderer {
  /** Size of each map tile in pixels */
  private readonly tileSize: number;

  /**
   * Creates a new MapRenderer instance.
   * @param tileSize - Size of each map tile in pixels (defaults to TILE_SIZE)
   */
  constructor(tileSize: number = TILE_SIZE) {
    this.tileSize = tileSize;
  }

  /**
   * Generates a fallback terrain grid for testing or when map data is unavailable.
   * Creates a procedurally generated terrain with varied types and some resources.
   *
   * @param width - Width of the terrain grid in tiles
   * @param height - Height of the terrain grid in tiles
   * @returns A complete terrain render grid with generated terrain data
   */
  static generateFallbackTerrain(width: number, height: number): TerrainRenderGrid {
    const generated: TerrainRenderGrid = [];
    for (let row = 0; row < height; row++) {
      generated[row] = [];
      for (let col = 0; col < width; col++) {
        let terrainType: string = Constants.TERRAIN.GRASSLAND;

        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          terrainType = Constants.TERRAIN.OCEAN;
        } else {
          const rand = Math.random();
          if (rand < 0.05) terrainType = Constants.TERRAIN.MOUNTAINS;
          else if (rand < 0.2) terrainType = Constants.TERRAIN.HILLS;
          else if (rand < 0.3) terrainType = Constants.TERRAIN.FOREST;
          else if (rand < 0.4) terrainType = Constants.TERRAIN.DESERT;
          else if (rand < 0.5) terrainType = Constants.TERRAIN.PLAINS;
          else if (rand < 0.6) terrainType = Constants.TERRAIN.TUNDRA;
          else terrainType = Constants.TERRAIN.GRASSLAND;
        }

        generated[row][col] = {
          type: terrainType,
          resource: Math.random() < 0.1 ? 'bonus' : null,
          improvement: null,
          visible: false,
          explored: false,
          hasRoad: false,
          hasRiver: false
        };
      }
    }
    return generated;
  }

  /**
   * Renders the static terrain layer to an offscreen canvas for performance.
   * This creates a cached version of the terrain that can be reused across frames.
   *
   * @param params - Parameters containing canvas, map state, and terrain grid
   */
  renderTerrainLayer(params: TerrainLayerParams): void {
    const { offscreenCanvas, map, terrainGrid } = params;
    if (!offscreenCanvas || !terrainGrid) return;

    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    const mapWidth = map.width * this.tileSize;
    const mapHeight = map.height * this.tileSize;

    if (offscreenCanvas.width !== mapWidth || offscreenCanvas.height !== mapHeight) {
      offscreenCanvas.width = mapWidth;
      offscreenCanvas.height = mapHeight;
    }

    ctx.clearRect(0, 0, mapWidth, mapHeight);

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile) continue;

        const x = col * this.tileSize;
        const y = row * this.tileSize;

        if (!tile.explored) {
          this.drawSquare(ctx, x, y, this.tileSize, '#000000', '#000000', true);
          continue;
        }

        const terrainInfo = this.resolveTerrain(tile.type);
        this.drawSquare(ctx, x, y, this.tileSize, terrainInfo.color, '#333', true);
        const tileWithoutImprovement = { ...tile, improvement: null, hasRoad: false };
        this.drawTerrainSymbol(ctx, x + this.tileSize / 2, y + this.tileSize / 2, tileWithoutImprovement, { drawBase: true, drawRivers: true });

        if (!tile.visible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(x, y, this.tileSize, this.tileSize);
        }
      }
    }
  }

  /**
   * Renders a complete game frame including terrain and all dynamic content.
   * This is the main rendering method called each frame to update the game view.
   *
   * @param params - Complete set of rendering parameters for the frame
   */
  renderFrame(params: RenderFrameParams): void {
    const {
      ctx,
      canvas,
      map,
      terrainGrid,
      camera,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      unitPaths,
      currentTime,
      offscreenCanvas,
      squareToScreen,
      cameraZoom,
      reachableTiles
    } = params;

    const canvasSize = this.ensureCanvasSize(canvas);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (!terrainGrid) {
      console.warn('[MapRenderer] renderFrame: No terrain grid available');
      return;
    }

    const bounds = this.calculateVisibleBounds(camera, canvasSize, map);
    const hasOffscreen = Boolean(offscreenCanvas);

    if (hasOffscreen && offscreenCanvas) {
      this.drawTerrainFromOffscreen(ctx, offscreenCanvas, camera, canvasSize);
    } else {
      console.warn('[MapRenderer] Falling back to direct terrain rendering - offscreen canvas not available');
      this.drawTerrainTiles(ctx, terrainGrid, bounds, camera, canvasSize, squareToScreen, selectedHex);
    }

    this.drawDynamicContent({
      ctx,
      map,
      terrainGrid,
      bounds,
      canvasSize,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      currentTime,
      cameraZoom,
      hasOffscreen,
      squareToScreen,
      reachableTiles
    });

    this.drawUnitPaths(ctx, unitPaths, units, gameState, squareToScreen);
  }

  /**
   * Renders static content only (no animations) - used for on-demand rendering.
   * This is the main rendering method for turn-based gameplay when nothing is animating.
   *
   * @param params - Complete set of rendering parameters minus currentTime
   */
  renderStaticFrame(params: RenderStaticFrameParams): void {
    const {
      ctx,
      canvas,
      map,
      terrainGrid,
      camera,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      unitPaths,
      offscreenCanvas,
      squareToScreen,
      cameraZoom,
      reachableTiles
    } = params;

    const canvasSize = this.ensureCanvasSize(canvas);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const bounds = this.calculateVisibleBounds(camera, canvasSize, map);
    const hasOffscreen = Boolean(offscreenCanvas);

    // Draw terrain if available
    if (terrainGrid) {
      if (hasOffscreen && offscreenCanvas) {
        this.drawTerrainFromOffscreen(ctx, offscreenCanvas, camera, canvasSize);
      } else {
        this.drawTerrainTiles(ctx, terrainGrid, bounds, camera, canvasSize, squareToScreen, selectedHex);
      }
    }

    // Draw all static dynamic content (units at alpha 1, no pulsing)
    this.drawDynamicContent({
      ctx,
      map,
      terrainGrid,
      bounds,
      canvasSize,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      currentTime: 0, // No animation
      cameraZoom,
      hasOffscreen,
      squareToScreen,
      reachableTiles
    });

    this.drawUnitPaths(ctx, unitPaths, units, gameState, squareToScreen);
  }

  /**
   * Renders only the pulsing animation for units with moves remaining.
   * This is called at high FPS on a separate animation layer.
   *
   * @param params - Parameters for pulsing unit rendering
   */
  renderPulsingUnits(params: RenderPulsingUnitsParams): void {
    const {
      ctx,
      map,
      units,
      gameState,
      civilizations,
      currentTime,
      squareToScreen,
      cameraZoom,
      currentQueueUnitId
    } = params;

    // If a currentQueueUnitId is provided, only pulse that specific unit
    // Otherwise, fall back to the old behavior (all active player units with moves)
    let unitsToPulse: Unit[];
    
    if (currentQueueUnitId) {
      // Only pulse the current queue unit
      const currentUnit = units.find(u => u.id === currentQueueUnitId);
      unitsToPulse = currentUnit ? [currentUnit] : [];
    } else {
      // Fall back: all active player units with moves
      unitsToPulse = units.filter(u => 
        u.civilizationId === gameState.activePlayer && 
        (u.movesRemaining || 0) > 0
      );
    }

    if (unitsToPulse.length === 0) return;

    // Calculate pulse color shift (from green to yellow)
    const period = 9000;
    const t = (currentTime % period) / period;
    const sine = Math.sin(t * Math.PI * 4);
    // Normalize sine from [-1, 1] to [0, 1]
    const pulseValue = (sine + 1) / 2;

    unitsToPulse.forEach(unit => {
      const tileIndex = unit.row * map.width + unit.col;
      const isVisible = map.visibility?.[tileIndex] ?? true;
      
      if (isVisible) {
        const { x, y } = squareToScreen(unit.col, unit.row);
        this.drawUnitWithPulse(ctx, x, y, unit, pulseValue, cameraZoom, civilizations);
      }
    });
  }

  /**
   * Renders the minimap showing the entire map with fog of war and viewport indicator.
   * Displays terrain, cities, units, and the current camera viewport.
   *
   * @param params - Parameters for minimap rendering
   */
  renderMinimap(params: RenderMinimapParams): void {
    const { ctx, map, cssWidth, cssHeight, camera, units, cities, civilizations, ignoreFog } = params;
    this.resetMinimapCanvas(ctx, cssWidth, cssHeight);

    const fogState = ignoreFog ? { visibility: null, revealed: null } as any : this.getMinimapFogState(map);

    this.drawMinimapTerrain(ctx, map, cssWidth, cssHeight, fogState);
    this.drawMinimapCities(ctx, map, cities, cssWidth, cssHeight);
    this.drawMinimapUnits(ctx, map, units, civilizations, cssWidth, cssHeight, !!ignoreFog);
    this.drawMinimapViewport(ctx, map, camera, cssWidth, cssHeight);
  }

  /**
   * Ensures the canvas size matches its CSS dimensions.
   * Updates the canvas pixel dimensions if they don't match the CSS size.
   *
   * @param canvas - The HTML canvas element to check and resize
   * @returns The current canvas size in pixels
   */
  private ensureCanvasSize(canvas: HTMLCanvasElement): CanvasSize {
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    return { width: canvas.width, height: canvas.height };
  }

  /**
   * Calculates the visible bounds of the map based on camera position and viewport.
   * Adds padding around the viewport for smooth scrolling and culling margin.
   *
   * @param camera - Current camera state
   * @param canvasSize - Size of the rendering canvas
   * @param map - Current map state
   * @returns Bounds of visible tiles in map coordinates
   */
  private calculateVisibleBounds(camera: CameraState, canvasSize: CanvasSize, map: MapState): VisibleBounds {
    const startCol = Math.max(0, Math.floor(camera.x / this.tileSize) - 2);
    const endCol = Math.min(map.width, Math.ceil((camera.x + canvasSize.width / camera.zoom) / this.tileSize) + 2);
    const startRow = Math.max(0, Math.floor(camera.y / this.tileSize) - 2);
    const endRow = Math.min(map.height, Math.ceil((camera.y + canvasSize.height / camera.zoom) / this.tileSize) + 2);
    return { startCol, endCol, startRow, endRow };
  }

  /**
   * Draws the terrain layer from the offscreen canvas to the main canvas.
   * Applies camera transformation to show the correct portion of the terrain.
   *
   * @param ctx - Main canvas rendering context
   * @param offscreenCanvas - Offscreen canvas containing terrain layer
   * @param camera - Current camera state for positioning
   * @param canvasSize - Size of the main canvas
   */
  private drawTerrainFromOffscreen(
    ctx: CanvasRenderingContext2D,
    offscreenCanvas: HTMLCanvasElement,
    camera: CameraState,
    canvasSize: CanvasSize
  ): void {
    const srcX = camera.x;
    const srcY = camera.y;
    const srcWidth = canvasSize.width / camera.zoom;
    const srcHeight = canvasSize.height / camera.zoom;
    ctx.drawImage(offscreenCanvas, srcX, srcY, srcWidth, srcHeight, 0, 0, canvasSize.width, canvasSize.height);
  }

  /**
   * Draws terrain tiles directly to the canvas (fallback when offscreen not available).
   * Handles viewport culling, terrain colors, symbols, and fog of war.
   *
   * @param ctx - Canvas rendering context
   * @param terrainGrid - Terrain data grid
   * @param bounds - Visible bounds in map coordinates
   * @param camera - Current camera state
   * @param canvasSize - Canvas dimensions
   * @param squareToScreen - Coordinate transformation function
   * @param selectedHex - Currently selected hex coordinates
   */
  private drawTerrainTiles(
    ctx: CanvasRenderingContext2D,
    terrainGrid: TerrainRenderGrid,
    bounds: VisibleBounds,
    camera: CameraState,
    canvasSize: CanvasSize,
    squareToScreen: (col: number, row: number) => { x: number; y: number },
    selectedHex: { col: number; row: number } | null
  ): void {
    const scaledTileSize = this.tileSize * camera.zoom;
    const margin = this.tileSize * 2;

    for (let row = bounds.startRow; row < bounds.endRow; row++) {
      for (let col = bounds.startCol; col < bounds.endCol; col++) {
        const { x, y } = squareToScreen(col, row);
        if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) {
          continue;
        }

        const tile = terrainGrid[row]?.[col];
        if (!tile) continue;

        if (!tile.explored) {
          this.drawSquare(ctx, x, y, scaledTileSize, '#000000', '#000000');
          continue;
        }

        const terrainInfo = this.resolveTerrain(tile.type);
        const isSelectedHex = selectedHex?.col === col && selectedHex?.row === row;
        this.drawSquare(ctx, x, y, scaledTileSize, terrainInfo.color, isSelectedHex ? '#FF0000' : '#333');

        if (camera.zoom > 0.5) {
          this.drawTerrainSymbol(ctx, x, y, tile, { drawBase: true, drawRivers: true });
        }

        if (!tile.visible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          const half = scaledTileSize / 2;
          ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
        }
      }
    }
  }

  /**
   * Draws all dynamic content including units, cities, selection highlights, and overlays.
   * Handles animations, visibility checks, and coordinate transformations.
   *
   * @param params - Complete parameters for dynamic content rendering
   */
  private drawDynamicContent(params: DynamicContentParams): void {
    const {
      ctx,
      map,
      terrainGrid,
      bounds,
      canvasSize,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      currentTime,
      cameraZoom,
      hasOffscreen,
      squareToScreen,
      reachableTiles
    } = params;

    const margin = this.tileSize * 2;
    const scaledTileSize = this.tileSize * cameraZoom;

    // Draw movement range overlay first (so it's under everything else)
    if (reachableTiles && reachableTiles.size > 0) {
      // Determine if the selected unit is naval
      const selectedUnitId = gameState.selectedUnit;
      const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;
      const isNaval = selectedUnit && UNIT_PROPERTIES[selectedUnit.type]?.naval;
      
      reachableTiles.forEach((cost, key) => {
        const [col, row] = key.split(',').map(Number);
        
        // Check if tile is visible (not in fog of war)
        const tileIndex = this.getTileIndex(row, col, map.width);
        const isVisible = map.visibility?.[tileIndex] ?? false;
        
        if (!isVisible) return; // Skip tiles in fog of war
        
        // Check if within viewport bounds
        if (row < bounds.startRow || row >= bounds.endRow || col < bounds.startCol || col >= bounds.endCol) {
          return;
        }
        
        const { x, y } = squareToScreen(col, row);
        if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) {
          return;
        }
        
        // Draw semi-transparent overlay
        const half = scaledTileSize / 2;
        if (isNaval) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; // Red for naval units
        } else {
          ctx.fillStyle = 'rgba(0, 85, 255, 0.5)'; // Blue for land units
        }
        ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
      });
    }

    for (let row = bounds.startRow; row < bounds.endRow; row++) {
      for (let col = bounds.startCol; col < bounds.endCol; col++) {
        const { x, y } = squareToScreen(col, row);
        if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) {
          continue;
        }

        const tileIndex = this.getTileIndex(row, col, map.width);
        const tile = terrainGrid?.[row]?.[col];
        
        // Check if tile is explored (either from terrain grid or map data)
        const isExplored = tile?.explored ?? map.revealed?.[tileIndex] ?? false;
        if (!isExplored) continue;

        // Draw selection highlight
        if (selectedHex && selectedHex.col === col && selectedHex.row === row) {
          const half = scaledTileSize / 2;
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
        }

        // === IMPROVEMENTS RENDERING (same pattern as units/cities) ===
        // Always read improvements from authoritative map.tiles, never from cached terrain grid
        const authoritativeTile: any = map.tiles?.[tileIndex];
        if (authoritativeTile && isExplored && tile) {
          const improvementTile: TerrainTileRenderInfo = {
            type: tile.type,
            resource: authoritativeTile.resource ?? tile.resource ?? null,
            improvement: authoritativeTile.improvement ?? null,
            hasRoad: authoritativeTile.hasRoad ?? false,
            hasRiver: authoritativeTile.hasRiver ?? tile.hasRiver ?? false,
            visible: tile.visible ?? false,
            explored: tile.explored ?? false
          };

          // Draw improvements using the same drawTerrainSymbol function, but only improvements/roads
          // (no base terrain symbols, as those are already in the offscreen layer)
          try {
            this.drawTerrainSymbol(ctx, x, y, improvementTile, { drawBase: false, drawRivers: false });
          } catch (err) {
            console.warn('[MapRenderer] drawDynamicContent: failed to draw improvement', err);
          }
        }

        // === UNITS AND CITIES RENDERING ===
        const isVisible = map.visibility?.[tileIndex] ?? tile?.visible ?? false;

        // Draw cities only on visible tiles
        if (isVisible) {
          const city = cities.find(c => c.col === col && c.row === row);
          if (city) {
            this.drawCity(ctx, x, y, city, cameraZoom, civilizations);
          }
        }

        // Draw units: player's own units always visible, enemy units only on visible tiles
        const unit = units.find(u => u.col === col && u.row === row);
        if (unit && isExplored) {
          const isActivePlayersUnit = unit.civilizationId === gameState.activePlayer;
          const shouldDrawUnit = isActivePlayersUnit || isVisible;
          
          // Debug: Log enemy units on non-visible tiles
          if (!isActivePlayersUnit && !isVisible && shouldDrawUnit) {
            console.warn('[MapRenderer] Drawing enemy unit on non-visible tile!', {
              unitType: unit.type,
              position: `${col},${row}`,
              civilizationId: unit.civilizationId,
              activePlayer: gameState.activePlayer,
              isVisible,
              isExplored,
              shouldDrawUnit
            });
          }
          
          if (shouldDrawUnit) {
            const hasMoves = (unit.movesRemaining || 0) > 0;
            let alpha = 1;
            // Only apply pulsing animation if currentTime > 0 (animated mode)
            if (currentTime > 0 && isActivePlayersUnit && hasMoves) {
              const period = 2000;
              const t = (currentTime % period) / period;
              const sine = Math.sin(t * Math.PI * 4);
              alpha = 0.675 + 0.325 * (sine + 1) * 10;
            }
            this.drawUnit(ctx, x, y, unit, alpha, cameraZoom, civilizations);
          }
        }

        // Draw selected unit highlight (on top of everything)
        const selectedUnitId = gameState.selectedUnit;
        const unitAtTile = units.find(u => u.col === col && u.row === row);
        if (selectedUnitId && unitAtTile && unitAtTile.id === selectedUnitId) {
          const half = scaledTileSize / 2;
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 3;
          ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
        }

        // Debug coordinates (high zoom only)
        if (cameraZoom > 1.5) {
          ctx.fillStyle = '#000';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${col},${row}`, x, y + scaledTileSize * 0.3);
        }
      }
    }
  }

  /**
   * Draws movement paths for all units that have planned paths.
   * Only draws paths for the currently selected unit.
   *
   * @param ctx - Canvas rendering context
   * @param unitPaths - Map of unit IDs to their movement paths
   * @param units - Array of all units
   * @param gameState - Current game state
   * @param squareToScreen - Coordinate transformation function
   */
  private drawUnitPaths(
    ctx: CanvasRenderingContext2D,
    unitPaths: Map<string, UnitPathStep[]>,
    units: Unit[],
    gameState: GameState,
    squareToScreen: (col: number, row: number) => { x: number; y: number }
  ): void {
    unitPaths.forEach((path, unitId) => {
      this.drawUnitPath(ctx, unitId, path, units, gameState, squareToScreen);
    });
  }

  /**
   * Calculates the tile index in a 1D array from row and column coordinates.
   * @param row - Row coordinate
   * @param col - Column coordinate
   * @param width - Map width in tiles
   * @returns Linear index for the tile
   */
  private getTileIndex(row: number, col: number, width: number): number {
    return row * width + col;
  }

  /**
   * Checks if a screen position is outside the viewport bounds with margin.
   * Used for culling objects that are not visible.
   *
   * @param x - Screen X coordinate
   * @param y - Screen Y coordinate
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @param margin - Additional margin around viewport
   * @returns True if position is outside viewport
   */
  private isOutsideViewport(x: number, y: number, canvasWidth: number, canvasHeight: number, margin: number = this.tileSize * 2): boolean {
    return x < -margin || x > canvasWidth + margin || y < -margin || y > canvasHeight + margin;
  }

  /**
   * Resets the minimap canvas by clearing it and filling with background color.
   * @param ctx - Minimap canvas context
   * @param width - Canvas width
   * @param height - Canvas height
   */
  private resetMinimapCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Determines the fog of war state for minimap rendering.
   * Checks if the map has revealed and visibility data available.
   *
   * @param map - Current map state
   * @returns Fog state information for minimap rendering
   */
  private getMinimapFogState(map: MapState): MinimapFogState {
    const hasRevealed = Array.isArray(map.revealed) && map.revealed.length === map.tiles.length;
    const hasVisibility = Array.isArray(map.visibility) && map.visibility.length === map.tiles.length;
    const anyRevealed = hasRevealed ? map.revealed.some(Boolean) : false;
    return { hasRevealed, hasVisibility, anyRevealed };
  }

  /**
   * Draws the terrain layer on the minimap with fog of war effects.
   * Each tile is represented as a small rectangle colored by terrain type.
   *
   * @param ctx - Minimap canvas context
   * @param map - Current map state
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   * @param fogState - Fog of war state information
   */
  private drawMinimapTerrain(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    width: number,
    height: number,
    fogState: MinimapFogState
  ): void {
    const tileWidth = width / map.width;
    const tileHeight = height / map.height;

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tileIndex = this.getTileIndex(row, col, map.width);
        const tile: any = map.tiles?.[tileIndex];
        if (!tile) continue;

        const terrainProps = this.resolveTerrain(tile.type);
        ctx.fillStyle = terrainProps.color;
        ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);

        if (fogState.hasRevealed && fogState.anyRevealed) {
          const explored = map.revealed?.[tileIndex] ?? true;
          const visible = map.visibility?.[tileIndex] ?? true;
          if (!explored) {
            // Draw completely black for unexplored areas
            ctx.fillStyle = '#000000';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
          } else if (!visible) {
            // Draw semi-transparent black for explored but not currently visible
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
          }
        }
      }
    }
  }

  /**
   * Draws cities on the minimap as colored rectangles.
   * Only shows cities that are currently visible to the player.
   *
   * @param ctx - Minimap canvas context
   * @param map - Current map state
   * @param cities - Array of all cities
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   */
  private drawMinimapCities(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    cities: City[],
    width: number,
    height: number
  ): void {
    if (!Array.isArray(cities) || cities.length === 0) {
      return;
    }

    const tileWidth = width / map.width;
    const tileHeight = height / map.height;

    for (const city of cities) {
      const tileIndex = this.getTileIndex(city.row, city.col, map.width);
      const isVisible = map.visibility ? map.visibility[tileIndex] : false;
      if (!isVisible) continue;

      const x = city.col * tileWidth;
      const y = city.row * tileHeight;
      ctx.fillStyle = city.civilizationId === 0 ? '#FFD700' : '#FF6347';
      ctx.fillRect(x, y, tileWidth * 2, tileHeight * 2);
    }
  }

  /**
   * Draws units on the minimap as small colored rectangles.
   * Uses civilization colors and only shows visible units.
   *
   * @param ctx - Minimap canvas context
   * @param map - Current map state
   * @param units - Array of all units
   * @param civilizations - Array of all civilizations
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   */
  private drawMinimapUnits(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    units: Unit[],
    civilizations: Civilization[],
    width: number,
    height: number,
    ignoreFog: boolean = false
  ): void {
    if (!Array.isArray(units) || units.length === 0) {
      return;
    }

    const tileWidth = width / map.width;
    const tileHeight = height / map.height;

    for (const unit of units) {
      const tileIndex = this.getTileIndex(unit.row, unit.col, map.width);
      const isVisible = ignoreFog ? true : (map.visibility ? map.visibility[tileIndex] : false);
      
      // Only draw units on visible tiles (fog of war)
      if (!isVisible) continue;

      const x = unit.col * tileWidth;
      const y = unit.row * tileHeight;
      const civ = civilizations.find(c => c.id === unit.civilizationId);
      ctx.fillStyle = civ?.color || '#FF0000';
      ctx.fillRect(x, y, Math.max(1, tileWidth / 2), Math.max(1, tileHeight / 2));
    }
  }

  /**
   * Draws the current camera viewport rectangle on the minimap.
   * Shows what portion of the map is currently visible in the main view.
   *
   * @param ctx - Minimap canvas context
   * @param map - Current map state
   * @param camera - Current camera state
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   */
  private drawMinimapViewport(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    camera: CameraState,
    width: number,
    height: number
  ): void {
    if (typeof window === 'undefined') {
      return;
    }

    const tileSize = Constants.HEX_SIZE || this.tileSize;
    const cssPerTileX = width / map.width;
    const cssPerTileY = height / map.height;
    const cameraTileX = camera.x / tileSize;
    const cameraTileY = camera.y / tileSize;
    const viewportTilesW = (window.innerWidth / camera.zoom) / tileSize;
    const viewportTilesH = (window.innerHeight / camera.zoom) / tileSize;
    const viewportX = cameraTileX * cssPerTileX;
    const viewportY = cameraTileY * cssPerTileY;
    const viewportW = viewportTilesW * cssPerTileX;
    const viewportH = viewportTilesH * cssPerTileY;
    const rectX = Math.max(0, viewportX);
    const rectY = Math.max(0, viewportY);
    const rectW = Math.min(width, viewportX + viewportW) - rectX;
    const rectH = Math.min(height, viewportY + viewportH) - rectY;

    if (rectW <= 0 || rectH <= 0) {
      return;
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(rectX, rectY, rectW, rectH);
  }

  /**
   * Draws a square/rectangle on the canvas with fill and stroke.
   * Can operate in world coordinates (center-based) or screen coordinates (corner-based).
   *
   * @param ctx - Canvas rendering context
   * @param centerX - X coordinate (center if world coordinates, top-left if screen)
   * @param centerY - Y coordinate (center if world coordinates, top-left if screen)
   * @param size - Size of the square (width and height)
   * @param fillColor - Fill color for the square
   * @param strokeColor - Stroke/border color
   * @param isWorldCoordinates - If true, treats coordinates as center point
   */
  private drawSquare(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    size: number,
    fillColor: string,
    strokeColor: string,
    isWorldCoordinates: boolean = false
  ): void {
    const half = size / 2;
    const x = isWorldCoordinates ? centerX : centerX - half;
    const y = isWorldCoordinates ? centerY : centerY - half;
    const width = size;
    const height = size;

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Draws terrain symbols including base terrain characters, rivers, and improvements.
   * Handles glyph rendering for roads, railroads, and other terrain features.
   *
   * @param ctx - Canvas rendering context
   * @param centerX - Center X coordinate for the symbol
   * @param centerY - Center Y coordinate for the symbol
   * @param terrain - Terrain tile information
   * @param options - Drawing options for base symbols and rivers
   */
  private drawTerrainSymbol(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    terrain: TerrainTileRenderInfo,
    options: DrawTerrainSymbolOptions
  ): void {
    const { drawBase = true, drawRivers = true } = options;
    const terrainInfo = getTerrainInfo(terrain.type);
    if (!terrainInfo) return;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
    const char = terrainInfo.char ?? '';

    if (drawBase && typeof char === 'string' && char.length > 0) {
      ctx.fillStyle = '#000';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      try {
        ctx.fillText(char, centerX, centerY - 8);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol fillText failed', err);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (drawRivers && terrain.hasRiver) {
      try {
        ctx.font = '16px monospace';
        ctx.fillStyle = '#0066FF';
        ctx.fillText('~', centerX + 8, centerY + 8);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol river fillText failed', err);
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
        console.warn('[MapRenderer] drawTerrainSymbol improvement glyph failed', err);
        return false;
      }
    };

    const drawLabelForImprovement = (key: string, display?: ImprovementDisplayConfig | null) => {
      if (display?.skipLabel) return;
      const impDef = IMPROVEMENT_PROPERTIES[key];
      const baseLabel = display?.label || impDef?.name?.[0] || key[0]?.toUpperCase();
      if (!baseLabel) return;
      try {
        ctx.font = display?.font ?? 'bold 12px monospace';
        ctx.fillStyle = display?.color ?? '#ff0000ff';
        const dx = display?.offsetX ?? 10;
        const dy = display?.offsetY ?? -10;
        ctx.fillText(baseLabel, centerX + dx, centerY + dy);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol improvement label failed', err);
      }
    };

    const roadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD]?.display;
    const railroadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD]?.display;
    let roadDrawn = false;

    if (terrain.hasRoad && roadDisplay) {
      roadDrawn = drawDisplayGlyph(roadDisplay);
    }

    const improvementKey = terrain.improvement ? String(terrain.improvement) : null;
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
  }

  /**
   * Draws a city on the map with civilization colors and name label.
   * Shows a building icon and city name scaled by camera zoom.
   *
   * @param ctx - Canvas rendering context
   * @param centerX - Center X coordinate
   * @param centerY - Center Y coordinate
   * @param city - City data to render
   * @param cameraZoom - Current camera zoom level
   * @param civilizations - Array of all civilizations for color lookup
   */
  private drawCity(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    city: City,
    cameraZoom: number,
    civilizations: Civilization[]
  ): void {
    const civ = civilizations.find(c => c.id === city.civilizationId);
    const civColor = civ?.color || (city.civilizationId === 0 ? '#FFD700' : '#FF6347');
    ctx.fillStyle = civColor;
    const size = 28 * cameraZoom;
    ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - size / 2, centerY - size / 2, size, size);

    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(12, 24 * cameraZoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏛️', centerX, centerY);

    ctx.font = `${Math.max(8, 10 * cameraZoom)}px monospace`;
    ctx.fillStyle = '#000';
    ctx.fillText(city.name, centerX, centerY + 24 * cameraZoom);
  }

  /**
   * Draws a unit with color pulsing effect for units with moves remaining.
   * @param ctx - Canvas rendering context
   * @param centerX - Center X coordinate
   * @param centerY - Center Y coordinate
   * @param unit - Unit data to render
   * @param pulseValue - Pulse value between 0 and 1 for color interpolation
   * @param cameraZoom - Current camera zoom level
   * @param civilizations - Array of all civilizations for color lookup
   */
  private drawUnitWithPulse(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    unit: Unit,
    pulseValue: number,
    cameraZoom: number,
    civilizations: Civilization[]
  ): void {
    ctx.save();

    const zoomFactor = typeof cameraZoom === 'number' ? Math.min(Math.max(cameraZoom, 0.5), 1.5) : 1;
    const radius = Math.round(20 * zoomFactor);

    const civIndex = unit.civilizationId ?? (unit as any).owner;
    const civ = civilizations.find(c => c.id === civIndex);
    const civColor = civ?.color || (civIndex === 0 ? '#4169E1' : '#DC143C');

    // Interpolate between base color and a brighter highlight color
    const highlightColor = '#ff0000'; // Bright yellow for highlight
    const pulseColor = this.interpolateColor(civColor, highlightColor, pulseValue);

    const innerRadius = Math.max(8, Math.round(radius * 0.95));
    ctx.beginPath();
    ctx.fillStyle = pulseColor;
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Add a subtle glow effect
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = Math.max(1, pulseValue * 3);
    ctx.stroke();

    const unitTypeId = unit.type ? String(unit.type) : null;
    
    // Try to load the image icon first (PNG or SVG)
    const iconResource = unitTypeId ? getUnitIcon(unitTypeId) : null;
    
    if (iconResource && typeof iconResource !== 'string' && iconResource.complete) {
      // Draw the PNG/SVG image icon (preserves transparency to show tile background)
      const iconSize = innerRadius * 2;
      ctx.drawImage(
        iconResource as HTMLImageElement,
        centerX - iconSize / 2,
        centerY - iconSize / 2,
        iconSize,
        iconSize
      );
    } else {
      // Fallback to emoji from unit data or text icon on colored circle
      ctx.fillStyle = pulseColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
      ctx.fill();

      const iconColor = this.isLightColor(pulseColor) ? '#111' : '#FFF';
      let emoji = '';
      if (typeof iconResource === 'string') {
        // Cached emoji
        emoji = iconResource;
      } else {
        // Get emoji from unit data
        const typeDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;
        emoji = unit.icon || typeDef?.icon || (typeDef?.name ? typeDef.name[0] : (unit.type ? String(unit.type)[0].toUpperCase() : 'U')) || '⚔️';
      }
      const fontSize = Math.max(10, Math.round(innerRadius * 1.1));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = iconColor;
      try {
        ctx.fillText(emoji, centerX, centerY);
      } catch (err) {
        const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
        ctx.fillText(fallback, centerX, centerY);
      }
    }

    if ((unit as any).isSleeping) {
      const sleepIcon = '💤';
      const sleepFontSize = Math.max(8, Math.round(innerRadius * 0.7));
      ctx.font = `${sleepFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.isLightColor(pulseColor) ? '#111' : '#FFF';
      ctx.fillText(sleepIcon, centerX, centerY + 22);
    }

    ctx.restore();
  }

  /**
   * Draws a unit on the map with civilization colors and unit icons.
   * Handles animations for active units and special states like sleeping.
   *
   * @param ctx - Canvas rendering context
   * @param centerX - Center X coordinate
   * @param centerY - Center Y coordinate
   * @param unit - Unit data to render
   * @param alpha - Transparency level (for animations)
   * @param cameraZoom - Current camera zoom level
   * @param civilizations - Array of all civilizations for color lookup
   */
  private drawUnit(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    unit: Unit,
    alpha: number,
    cameraZoom: number,
    civilizations: Civilization[]
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;

    const zoomFactor = typeof cameraZoom === 'number' ? Math.min(Math.max(cameraZoom, 0.5), 1.5) : 1;
    const radius = Math.round(20 * zoomFactor);

    const civIndex = unit.civilizationId ?? (unit as any).owner;
    const civ = civilizations.find(c => c.id === civIndex);
    const civColor = civ?.color || (civIndex === 0 ? '#4169E1' : '#DC143C');

    const innerRadius = Math.max(8, Math.round(radius * 0.95));

    const unitTypeId = unit.type ? String(unit.type) : null;
    
    // Try to load the image icon first (PNG or SVG)
    const iconResource = unitTypeId ? getUnitIcon(unitTypeId) : null;
    
    if (iconResource && typeof iconResource !== 'string' && iconResource.complete) {
      // Draw the PNG/SVG image icon (preserves transparency to show tile background)
      const iconSize = innerRadius * 2;
      ctx.drawImage(
        iconResource as HTMLImageElement,
        centerX - iconSize / 2,
        centerY - iconSize / 2,
        iconSize,
        iconSize
      );
    } else {
      // Fallback to emoji from unit data or text icon on colored circle
      ctx.beginPath();
      ctx.fillStyle = civColor;
      ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
      ctx.fill();

      const iconColor = this.isLightColor(civColor) ? '#111' : '#FFF';
      let emoji = '';
      if (typeof iconResource === 'string') {
        // Cached emoji
        emoji = iconResource;
      } else {
        // Get emoji from unit data
        const typeDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;
        emoji = unit.icon || typeDef?.icon || (typeDef?.name ? typeDef.name[0] : (unit.type ? String(unit.type)[0].toUpperCase() : 'U')) || '⚔️';
      }
      const fontSize = Math.max(10, Math.round(innerRadius * 1.1));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = iconColor;
      try {
        ctx.fillText(emoji, centerX, centerY);
      } catch (err) {
        const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
        ctx.fillText(fallback, centerX, centerY);
      }
    }

    if ((unit as any).isSleeping) {
      const sleepIcon = '💤';
      const sleepFontSize = Math.max(8, Math.round(innerRadius * 0.7));
      ctx.font = `${sleepFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.isLightColor(civColor) ? '#111' : '#FFF';
      ctx.fillText(sleepIcon, centerX, centerY + 22);
    }

    // Draw black X on defeated units (shown for 5 seconds before removal)
    if ((unit as any).isDefeated) {
      ctx.save();
      ctx.globalAlpha = 1.0; // Make X fully visible
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      
      const xSize = innerRadius * 1.2;
      // Draw X
      ctx.beginPath();
      ctx.moveTo(centerX - xSize, centerY - xSize);
      ctx.lineTo(centerX + xSize, centerY + xSize);
      ctx.moveTo(centerX + xSize, centerY - xSize);
      ctx.lineTo(centerX - xSize, centerY + xSize);
      ctx.stroke();
      
      // Add white outline for visibility
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX - xSize, centerY - xSize);
      ctx.lineTo(centerX + xSize, centerY + xSize);
      ctx.moveTo(centerX + xSize, centerY - xSize);
      ctx.lineTo(centerX - xSize, centerY + xSize);
      ctx.stroke();
      
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Draws a movement path for a single unit with directional arrows.
   * Only draws if the unit is currently selected and has a valid path.
   *
   * @param ctx - Canvas rendering context
   * @param unitId - ID of the unit whose path to draw
   * @param path - Array of path steps for the unit
   * @param units - Array of all units
   * @param gameState - Current game state
   * @param squareToScreen - Coordinate transformation function
   */
  private drawUnitPath(
    ctx: CanvasRenderingContext2D,
    unitId: string,
    path: UnitPathStep[] | undefined,
    units: Unit[],
    gameState: GameState,
    squareToScreen: (col: number, row: number) => { x: number; y: number }
  ): void {
    if (!path || path.length < 2) return;
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    if (gameState.selectedUnit !== unitId) return;

    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Get map data for checking explored tiles
    const mapData = (gameState as any).mapData;
    const mapWidth = mapData?.width || 0;
    
    // Filter path to only include explored tiles for line drawing
    const visiblePath = path.filter((pos) => {
      if (!mapData || !mapData.revealed) return true;
      const tileIndex = pos.row * mapWidth + pos.col;
      return mapData.revealed[tileIndex] === true;
    });

    // Draw path lines only through explored tiles
    if (visiblePath.length >= 2) {
      ctx.beginPath();
      visiblePath.forEach((pos, index) => {
        const { x, y } = squareToScreen(pos.col, pos.row);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // Always show destination marker (even on unexplored terrain)
    // Check if path ends at an enemy unit - if so, show combat icon instead of arrow
    const lastPathStep = path[path.length - 1];
    const targetUnit = units.find(u => u.col === lastPathStep.col && u.row === lastPathStep.row);
    const isEnemyAtDestination = targetUnit && targetUnit.civilizationId !== unit.civilizationId;

    // Always draw destination marker regardless of explored status
    if (path.length >= 1) {
      const last = path[path.length - 1];
      const { x: x2, y: y2 } = squareToScreen(last.col, last.row);
      
      if (isEnemyAtDestination) {
        // Draw red crossed swords icon (⚔) for combat
        ctx.save();
        ctx.fillStyle = '#FF0000';
        ctx.font = 'bold 24px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Add white outline for visibility
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.strokeText('⚔', x2, y2 - 15);
        ctx.fillText('⚔', x2, y2 - 15);
        ctx.restore();
      } else {
        // Draw normal arrow for movement
        // Use visiblePath if available to get proper direction from last visible segment
        const arrowSourcePath = visiblePath.length >= 2 ? visiblePath : path;
        if (arrowSourcePath.length >= 2) {
          const secondLast = arrowSourcePath[arrowSourcePath.length - 2];
          const { x: x1, y: y1 } = squareToScreen(secondLast.col, secondLast.row);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const arrowLen = 10;
            const arrowAngle = Math.PI / 6;
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
        } else {
          // If no direction available, draw a simple target marker
          ctx.beginPath();
          ctx.arc(x2, y2, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x2, y2, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /**
   * Resolves a terrain type string to its color definition.
   * Falls back to grassland if the terrain type is not found.
   *
   * @param type - Terrain type identifier
   * @returns Terrain color information
   */
  private resolveTerrain(type: string): { color: string } {
    const upper = type?.toUpperCase();
    return TERRAIN_TYPES[type] || TERRAIN_TYPES[upper] || TERRAIN_TYPES.GRASSLAND;
  }

  /**
   * Interpolates between two colors based on a factor.
   * @param color1 - Start color (hex string)
   * @param color2 - End color (hex string)
   * @param factor - Interpolation factor between 0 and 1
   * @returns Interpolated color as hex string
   */
  private interpolateColor(color1: string, color2: string, factor: number): string {
    const c1 = color1.replace('#', '');
    const c2 = color2.replace('#', '');
    
    const r1 = parseInt(c1.substring(0, 2), 16);
    const g1 = parseInt(c1.substring(2, 4), 16);
    const b1 = parseInt(c1.substring(4, 6), 16);
    
    const r2 = parseInt(c2.substring(0, 2), 16);
    const g2 = parseInt(c2.substring(2, 4), 16);
    const b2 = parseInt(c2.substring(4, 6), 16);
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Determines if a hex color is considered "light" based on luminance.
   * Used to choose appropriate text/icon colors for contrast.
   *
   * @param hexColor - Hex color string (with or without #)
   * @returns True if the color is light (high luminance)
   */
  private isLightColor(hexColor: string): boolean {
    if (!hexColor) return false;
    const normalized = hexColor.replace('#', '');
    const bigint = parseInt(normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6;
  }
}
