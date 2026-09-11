/**
 * MapRenderer - Core rendering engine for Civilization 1 game maps
 *
 * This module provides comprehensive canvas-based rendering for the game world,
 * including terrain layers and dynamic game objects (units, cities). It handles
 * camera transformations, fog of war, and performance optimizations through
 * offscreen rendering and viewport culling.
 *
 * Key features:
 * - Terrain rendering with improvements and resources
 * - Dynamic content overlay (units, cities, selection highlights)
 * - Camera-aware viewport culling for performance
 * - Offscreen terrain layer caching
 *
 * The minimap is rendered separately by MiniMapRenderer.
 */

import { Constants } from '@/utils/Constants';
import { TILE_SIZE, getTerrainInfo, TERRAIN_TYPES } from '@/data/TerrainData';
import { TERRAIN_RESOURCES } from '@/data/TerrainConstants';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES, ImprovementDisplayConfig } from '@/data/TileImprovementConstants';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { getUnitIcon } from '@/utils/UnitIconLoader';
import { TERRAIN_FONT_FAMILY } from '@/utils/terrainFont';
import { MathUtils } from '@/utils/MathUtils';
import type { MapState, CameraState, Unit, City, GameState, Civilization, CombatAnimation, MovementAnimation } from '../../../types/game';
import { TerrainTextureManager } from './TerrainTextureManager';

/**
 * Compute the (possibly fractional) tile a unit should be drawn at, honoring any
 * active movement animation (glide). Falls back to the unit's committed tile when
 * no animation applies. Shared by the static renderer and GameCanvas' pulsing
 * layer so a gliding unit is always drawn at the same interpolated position.
 */
export function getUnitDisplayTile(
  unit: Unit,
  movementAnimations?: MovementAnimation[]
): { col: number; row: number } {
  if (movementAnimations && movementAnimations.length > 0) {
    const now = performance.now();
    for (const anim of movementAnimations) {
      if (anim.unitId !== unit.id) continue;
      const elapsed = now - anim.startTime;
      const t = Math.max(0, Math.min(1, elapsed / (anim.duration || 1)));
      const eased = MathUtils.fade(t);
      return {
        col: MathUtils.lerp(anim.fromCol, anim.toCol, eased),
        row: MathUtils.lerp(anim.fromRow, anim.toRow, eased),
      };
    }
  }
  return { col: unit.col, row: unit.row };
}


/** Civ1 special-resource glyphs rendered on the map (keyed by lowercase name). */
const RESOURCE_GLYPHS: Record<string, string> = {
  seal: '🦭',
  gems: '💎',
  horses: '🐎',
  gold: '💰',
  coal: '🪨',
  fish: '🐟',
  oil: '🛢️',
  game: '🦌',
  oasis: '🌴',
};


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
  /** Whether this tile contains a Civ1 village (goody hut). */
  village?: boolean;
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
  /** Active citizen pick-up origin (cityId + tile) while reassigning a worker. */
  citizenReassign?: { cityId: string; col: number; row: number } | null;
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
  /** Active combat animations (hide units + draw cloud) */
  combatAnimations?: CombatAnimation[];
  /** Active unit-movement glides (position interpolation between tiles) */
  movementAnimations?: MovementAnimation[];
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
  /** Active citizen pick-up origin (cityId + tile) while reassigning a worker. */
  citizenReassign?: { cityId: string; col: number; row: number } | null;
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
  /** Active combat animations (hide units + draw cloud) */
  combatAnimations?: CombatAnimation[];
  /** Active unit-movement glides (position interpolation between tiles) */
  movementAnimations?: MovementAnimation[];
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
  /** Active combat animations (hide units + apply survivor fade) */
  combatAnimations?: CombatAnimation[];
  /** Active unit-movement glides (position interpolation between tiles) */
  movementAnimations?: MovementAnimation[];
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
  /** Active citizen pick-up origin (cityId + tile) while reassigning a worker. */
  citizenReassign?: { cityId: string; col: number; row: number } | null;
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
  /** Active combat animations (hide units + draw cloud) */
  combatAnimations?: CombatAnimation[];
  /** Active unit-movement glides (position interpolation between tiles) */
  movementAnimations?: MovementAnimation[];
}

/**
 * Core rendering engine for Civilization 1 game maps.
 *
 * Handles all canvas-based rendering including terrain, units, cities,
 * and various visual effects. Uses performance optimizations
 * like viewport culling and offscreen rendering.
 */
export class MapRenderer {
  /** Size of each map tile in pixels */
  private readonly tileSize: number;

  /** Optional texture manager for AI-generated terrain images with transitions. */
  textureManager: TerrainTextureManager | null = null;

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

        const res = TERRAIN_RESOURCES[terrainType];
        generated[row][col] = {
          type: terrainType,
          resource: res !== null && res !== undefined && Math.random() < 0.2 ? res : null,
          improvement: null,
          visible: false,
          explored: false,
          hasRoad: false,
          hasRiver: false,
          village: false
        };
      }
    }
    return generated;
  }

  /**
   * Renders only the expensive terrain base layer (textures + transitions + features).
   * Does NOT include fog overlay — call renderFogOverlay separately for that.
   * This is meant to be cached and only rebuilt when terrain *types* change.
   */
  renderTerrainBase(params: TerrainLayerParams): void {
    const { offscreenCanvas, map, terrainGrid } = params;
    if (!offscreenCanvas || !terrainGrid) return;

    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    const resolutionScale = 2;
    const scaledTile  = this.tileSize * resolutionScale;
    const mapWidth    = map.width  * scaledTile;
    const mapHeight   = map.height * scaledTile;

    if (offscreenCanvas.width !== mapWidth || offscreenCanvas.height !== mapHeight) {
      offscreenCanvas.width  = mapWidth;
      offscreenCanvas.height = mapHeight;
    }

    ctx.clearRect(0, 0, mapWidth, mapHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const tm = this.textureManager;

    // ── Pass 1: base ground textures ─────────────────────────────────────
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile) continue;
        const x = col * scaledTile;
        const y = row * scaledTile;

        if (!tile.explored) {
          ctx.fillStyle = '#111118';
          ctx.fillRect(x, y, scaledTile, scaledTile);
          continue;
        }

        const terrainInfo = this.resolveTerrain(tile.type);
        if (tm) {
          tm.drawTile(ctx, tile.type, x, y, scaledTile, terrainInfo.color, true, col, row);
        } else {
          ctx.fillStyle = terrainInfo.color;
          ctx.fillRect(x, y, scaledTile, scaledTile);
        }
      }
    }

    // ── Pass 2: texture-based edge transitions (Wesnoth-style) ──────────
    if (tm && tm.isReady) {
      for (let row = 0; row < map.height; row++) {
        for (let col = 0; col < map.width; col++) {
          const tile = terrainGrid[row]?.[col];
          if (!tile?.explored) continue;
          const x = col * scaledTile;
          const y = row * scaledTile;
          const tPriority = tm.getPriority(tile.type);

          const edges: Array<{ dcol: number; drow: number; dir: 'N'|'E'|'S'|'W' }> = [
            { dcol: 0, drow: -1, dir: 'N' },
            { dcol: 1, drow:  0, dir: 'E' },
            { dcol: 0, drow:  1, dir: 'S' },
            { dcol:-1, drow:  0, dir: 'W' },
          ];
          for (const { dcol, drow, dir } of edges) {
            const n = terrainGrid[row + drow]?.[col + dcol];
            if (!n?.explored || n.type === tile.type) continue;
            const nPriority = tm.getPriority(n.type);
            if (nPriority <= tPriority) continue;
            const diff = nPriority - tPriority;
            tm.drawTextureTransition(ctx, n.type, x, y, scaledTile, dir, diff);
          }

          // Draw corner transitions considering all 4 tiles at each corner
          const cornerConfigs: Array<{
            corner: 'NW' | 'NE' | 'SW' | 'SE';
            northRow: number; northCol: number;
            westRow: number; westCol: number;
            diagRow: number; diagCol: number;
          }> = [
            { corner: 'NW', northRow: row-1, northCol: col, westRow: row, westCol: col-1, diagRow: row-1, diagCol: col-1 },
            { corner: 'NE', northRow: row-1, northCol: col, westRow: row, westCol: col+1, diagRow: row-1, diagCol: col+1 },
            { corner: 'SW', northRow: row+1, northCol: col, westRow: row, westCol: col-1, diagRow: row+1, diagCol: col-1 },
            { corner: 'SE', northRow: row+1, northCol: col, westRow: row, westCol: col+1, diagRow: row+1, diagCol: col+1 },
          ];

          for (const { corner, northRow, northCol, westRow, westCol, diagRow, diagCol } of cornerConfigs) {
            const northTile = terrainGrid[northRow]?.[northCol];
            const westTile = terrainGrid[westRow]?.[westCol];
            const diagTile = terrainGrid[diagRow]?.[diagCol];

            // Only draw if at least one neighbor is explored
            if (!northTile?.explored && !westTile?.explored && !diagTile?.explored) continue;

            tm.drawCornerTransition4(
              ctx, x, y, scaledTile, corner,
              tile.type,
              northTile?.explored ? northTile.type : null,
              westTile?.explored ? westTile.type : null,
              diagTile?.explored ? diagTile.type : null,
            );
          }
        }
      }
    }

    // ── Pass 2b: edge-aware river rendering ────────────────────────────────
    // Replaces the old blue "~" glyph with directional water arms that
    // connect to adjacent river tiles and show natural banks.
    if (tm && tm.isReady) {
      for (let row = 0; row < map.height; row++) {
        for (let col = 0; col < map.width; col++) {
          const tile = terrainGrid[row]?.[col];
          if (!tile?.explored || !tile.hasRiver) continue;
          const x = col * scaledTile;
          const y = row * scaledTile;

          // Detect which cardinal edges connect to adjacent river tiles
          const n = terrainGrid[row - 1]?.[col];
          const e = terrainGrid[row]?.[col + 1];
          const s = terrainGrid[row + 1]?.[col];
          const w = terrainGrid[row]?.[col - 1];
          const connectN = !!n?.hasRiver && n.explored;
          const connectE = !!e?.hasRiver && e.explored;
          const connectS = !!s?.hasRiver && s.explored;
          const connectW = !!w?.hasRiver && w.explored;

          tm.drawRiver(ctx, tile.type, x, y, scaledTile, connectN, connectE, connectS, connectW);
        }
      }
    }

    // ── Pass 3a: terrain symbols (rivers, resources) — no fog ───────────
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile?.explored) continue;
        const x = col * scaledTile;
        const y = row * scaledTile;

        const tileNoImprove = { ...tile, improvement: null, hasRoad: false };
        this.drawTerrainSymbol(ctx, x + scaledTile / 2, y + scaledTile / 2, tileNoImprove, { drawBase: false, drawRivers: true });
      }
    }

    // ── Pass 4: feature sprites (painter's algorithm — row 0 first) ──────
    if (tm && tm.isReady) {
      for (let row = 0; row < map.height; row++) {
        for (let col = 0; col < map.width; col++) {
          const tile = terrainGrid[row]?.[col];
          if (!tile?.explored || !tile.visible) continue;
          const x = col * scaledTile;
          const y = row * scaledTile;
          tm.drawFeature(ctx, tile.type, x, y, scaledTile, col, row);
        }
      }
    }
  }

  /**
   * Renders only the fog-of-war overlay on top of an already-drawn terrain base.
   * This is very cheap (one fillRect per non-visible tile) and can be called
   * on every visibility change without re-doing the expensive texture transitions.
   */
  renderFogOverlay(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    terrainGrid: TerrainRenderGrid,
  ): void {
    const resolutionScale = 2;
    const scaledTile = this.tileSize * resolutionScale;

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile?.explored) continue;
        if (tile.visible) continue;  // visible tiles get no fog

        const x = col * scaledTile;
        const y = row * scaledTile;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.fillRect(x, y, scaledTile, scaledTile);
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
      citizenReassign: params.citizenReassign,
      gameState,
      units,
      cities,
      civilizations,
      currentTime,
      cameraZoom,
      hasOffscreen,
      squareToScreen,
      reachableTiles,
      combatAnimations: params.combatAnimations,
      movementAnimations: params.movementAnimations
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
      reachableTiles,
      combatAnimations,
      movementAnimations
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
      citizenReassign: params.citizenReassign,
      gameState,
      units,
      cities,
      civilizations,
      currentTime: 0, // No animation
      cameraZoom,
      hasOffscreen,
      squareToScreen,
      reachableTiles,
      combatAnimations,
      movementAnimations
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
      // Combat animation: hide units during the cloud window and apply the
      // survivor fade — the pulsing layer must never redraw a hidden unit on top.
      const combat = this.getCombatRenderState(unit, params.combatAnimations);
      if (combat.hidden) {
        return;
      }

      const tileIndex = unit.row * map.width + unit.col;
      const isVisible = map.visibility?.[tileIndex] ?? true;
      
      if (isVisible) {
        const displayTile = this.getUnitDisplayTile(unit, params.movementAnimations);
        const { x, y } = squareToScreen(displayTile.col, displayTile.row);
        this.drawUnitWithPulse(ctx, x, y, unit, pulseValue, cameraZoom, civilizations, combat.alpha);
      }
    });
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
    // The offscreen canvas is rendered at 2× tile resolution, so source
    // coordinates must be scaled accordingly.
    const resolutionScale = 2;
    const srcX = camera.x * resolutionScale;
    const srcY = camera.y * resolutionScale;
    const srcWidth = (canvasSize.width / camera.zoom) * resolutionScale;
    const srcHeight = (canvasSize.height / camera.zoom) * resolutionScale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
          const half2 = scaledTileSize / 2;
          ctx.fillStyle = '#111118';
          ctx.fillRect(x - half2, y - half2, scaledTileSize, scaledTileSize);
          continue;
        }

        const terrainInfo = this.resolveTerrain(tile.type);
        const isSelectedHex = selectedHex?.col === col && selectedHex?.row === row;
        const half = scaledTileSize / 2;
        const tileX = x - half;
        const tileY = y - half;
        const tm = this.textureManager;

        // Draw base terrain texture
        if (tm) {
          tm.drawTile(ctx, tile.type, tileX, tileY, scaledTileSize, terrainInfo.color, true, col, row);
        } else {
          ctx.fillStyle = terrainInfo.color;
          ctx.fillRect(tileX, tileY, scaledTileSize, scaledTileSize);
        }

        // Texture-based edge transitions (Wesnoth-style)
        if (tm && tm.isReady) {
          const tPriority = tm.getPriority(tile.type);
          const edges: Array<{ dcol: number; drow: number; dir: 'N'|'E'|'S'|'W' }> = [
            { dcol: 0, drow: -1, dir: 'N' },
            { dcol: 1, drow:  0, dir: 'E' },
            { dcol: 0, drow:  1, dir: 'S' },
            { dcol:-1, drow:  0, dir: 'W' },
          ];
          for (const { dcol, drow, dir } of edges) {
            const n = terrainGrid[row + drow]?.[col + dcol];
            if (!n?.explored || n.type === tile.type) continue;
            const nPriority = tm.getPriority(n.type);
            if (nPriority <= tPriority) continue;
            const diff = nPriority - tPriority;
            tm.drawTextureTransition(ctx, n.type, tileX, tileY, scaledTileSize, dir, diff);
          }

          // Draw corner transitions considering all 4 tiles at each corner
          const cornerConfigs: Array<{
            corner: 'NW' | 'NE' | 'SW' | 'SE';
            northRow: number; northCol: number;
            westRow: number; westCol: number;
            diagRow: number; diagCol: number;
          }> = [
            { corner: 'NW', northRow: row-1, northCol: col, westRow: row, westCol: col-1, diagRow: row-1, diagCol: col-1 },
            { corner: 'NE', northRow: row-1, northCol: col, westRow: row, westCol: col+1, diagRow: row-1, diagCol: col+1 },
            { corner: 'SW', northRow: row+1, northCol: col, westRow: row, westCol: col-1, diagRow: row+1, diagCol: col-1 },
            { corner: 'SE', northRow: row+1, northCol: col, westRow: row, westCol: col+1, diagRow: row+1, diagCol: col+1 },
          ];

          for (const { corner, northRow, northCol, westRow, westCol, diagRow, diagCol } of cornerConfigs) {
            const northTile = terrainGrid[northRow]?.[northCol];
            const westTile = terrainGrid[westRow]?.[westCol];
            const diagTile = terrainGrid[diagRow]?.[diagCol];

            // Only draw if at least one neighbor is explored
            if (!northTile?.explored && !westTile?.explored && !diagTile?.explored) continue;

            tm.drawCornerTransition4(
              ctx, tileX, tileY, scaledTileSize, corner,
              tile.type,
              northTile?.explored ? northTile.type : null,
              westTile?.explored ? westTile.type : null,
              diagTile?.explored ? diagTile.type : null,
            );
          }
        }

        if (isSelectedHex) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 2;
          ctx.strokeRect(tileX + 1, tileY + 1, scaledTileSize - 2, scaledTileSize - 2);
        }

        if (camera.zoom > 0.5) {
          // Edge-aware river rendering (replaces old "~" glyph)
          if (tile.hasRiver) {
            const tm2 = this.textureManager;
            if (tm2 && tm2.isReady) {
              const n2 = terrainGrid[row - 1]?.[col];
              const e2 = terrainGrid[row]?.[col + 1];
              const s2 = terrainGrid[row + 1]?.[col];
              const w2 = terrainGrid[row]?.[col - 1];
              tm2.drawRiver(ctx, tile.type, tileX, tileY, scaledTileSize,
                !!n2?.hasRiver && n2.explored,
                !!e2?.hasRiver && e2.explored,
                !!s2?.hasRiver && s2.explored,
                !!w2?.hasRiver && w2.explored,
              );
            }
          } else {
            this.drawTerrainSymbol(ctx, x, y, tile, { drawBase: false, drawRivers: true });
          }
        }

        if (!tile.visible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          ctx.fillRect(tileX, tileY, scaledTileSize, scaledTileSize);
        }
      }
    }

    // Feature sprites pass — drawn row by row for correct depth sorting
    if (this.textureManager?.isReady) {
      const tm = this.textureManager;
      for (let row = bounds.startRow; row < bounds.endRow; row++) {
        for (let col = bounds.startCol; col < bounds.endCol; col++) {
          const tile = terrainGrid[row]?.[col];
          if (!tile?.explored || !tile.visible) continue;
          const { x, y } = squareToScreen(col, row);
          if (this.isOutsideViewport(x, y + scaledTileSize / 2, canvasSize.width, canvasSize.height, scaledTileSize * 2)) continue;
          const half = scaledTileSize / 2;
          tm.drawFeature(ctx, tile.type, x - half, y - half, scaledTileSize, col, row);
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
      citizenReassign,
      gameState,
      units,
      cities,
      civilizations,
      currentTime,
      cameraZoom,
      squareToScreen,
      reachableTiles,
      combatAnimations,
      movementAnimations
    } = params;

    const margin = this.tileSize * 2;
    const scaledTileSize = this.tileSize * cameraZoom;

    // ── City radius highlights ───────────────────────────────────────────
    //
    // Two layers:
    //   1. **Other cities' radii** — drawn first so they sit behind
    //      everything else.  Tiles that belong to a *different* city are
    //      tinted red to signal "blocked / owned by someone else".
    //   2. **Selected city** — drawn on top.  Its full 20-tile diamond is
    //      shown in gold/yellow.  Tiles that are **actively worked** by
    //      citizens get a stronger green tint so the player can instantly
    //      see which tiles contribute yields.
    //
    // The city center is always worked and gets a thick gold outline.

    // Build a set of "blocked by another city" keys for fast lookup.
    // A tile is blocked when it falls inside a *different* city's radius.
    const blockedByOtherCity = new Set<string>();
    // Highlight the transiently selected city, falling back to the persistent
    // "focused" city (last opened/selected) so the net stays visible after the
    // city modal is closed or after selecting a unit / field / ESC.
    const radiusCityId = gameState.selectedCity ?? gameState.focusedCity ?? null;
    const selectedCity = radiusCityId
      ? cities.find(city => city.id === radiusCityId)
      : null;

    if (selectedCity) {
      // Gather all tiles in the selected city's radius (including center).
      const ownRadiusKeys = new Set<string>();
      for (let dCol = -2; dCol <= 2; dCol++) {
        for (let dRow = -2; dRow <= 2; dRow++) {
          if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;
          const key = `${selectedCity.col + dCol},${selectedCity.row + dRow}`;
          ownRadiusKeys.add(key);
        }
      }

      // Scan every *other* city and mark overlapping radius tiles.
      for (const otherCity of cities) {
        if (otherCity.id === selectedCity.id) continue;
        for (let dCol = -2; dCol <= 2; dCol++) {
          for (let dRow = -2; dRow <= 2; dRow++) {
            if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;
            const key = `${otherCity.col + dCol},${otherCity.row + dRow}`;
            if (ownRadiusKeys.has(key)) {
              blockedByOtherCity.add(key);
            }
          }
        }
      }

      // ── Layer 1: blocked tiles from other cities ──
      if (blockedByOtherCity.size > 0) {
        for (const key of blockedByOtherCity) {
          const [col, row] = key.split(',').map(Number);
          if (row < bounds.startRow || row >= bounds.endRow ||
              col < bounds.startCol || col >= bounds.endCol) continue;
          const { x, y } = squareToScreen(col, row);
          if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) continue;
          const half = scaledTileSize / 2;
          ctx.fillStyle = 'rgba(220, 50, 50, 0.18)';
          ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
          ctx.strokeStyle = 'rgba(220, 50, 50, 0.85)';
          ctx.lineWidth = Math.max(1, cameraZoom);
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
          ctx.setLineDash([]);
        }
      }

      // ── Layer 2: selected city radius (full diamond) ──
      const workedTiles = selectedCity.workingTiles;
      // While reassigning, remember the origin tile (the citizen being carried)
      // so it can be dimmed/pulsed, and treat the other unworked radius tiles as
      // bright "available drop" targets.
      const isHolding =
        !!citizenReassign &&
        citizenReassign.cityId === selectedCity.id &&
        (citizenReassign.col !== selectedCity.col || citizenReassign.row !== selectedCity.row);
      const originKey = isHolding && citizenReassign
        ? `${citizenReassign.col},${citizenReassign.row}`
        : null;
      const pulse = 0.5 + 0.5 * Math.sin(currentTime / 180);

      for (let dCol = -2; dCol <= 2; dCol++) {
        for (let dRow = -2; dRow <= 2; dRow++) {
          if (dCol === 0 && dRow === 0) continue;
          if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;

          const col = selectedCity.col + dCol;
          const row = selectedCity.row + dRow;
          if (row < bounds.startRow || row >= bounds.endRow ||
              col < bounds.startCol || col >= bounds.endCol) continue;

          const { x, y } = squareToScreen(col, row);
          if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) continue;

          const half = scaledTileSize / 2;
          const tileKey = `${col},${row}`;
          const isWorked = workedTiles?.has(tileKey) ?? false;
          const isOrigin = isHolding && originKey === tileKey;

          if (isOrigin) {
            // Origin tile being carried — dimmed + pulsing dashed green so the
            // player remembers where the citizen came from (still worked).
            ctx.fillStyle = 'rgba(50, 200, 80, 0.10)';
            ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
            ctx.strokeStyle = `rgba(50, 200, 80, ${0.45 + 0.5 * pulse})`;
            ctx.lineWidth = Math.max(2, cameraZoom * 1.5);
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
            ctx.setLineDash([]);
          } else if (isWorked) {
            // Actively worked tile — strong green tint
            ctx.fillStyle = 'rgba(50, 200, 80, 0.28)';
            ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
            ctx.strokeStyle = 'rgba(50, 200, 80, 0.9)';
            ctx.lineWidth = Math.max(1.5, cameraZoom);
            ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
          } else if (blockedByOtherCity.has(tileKey)) {
            // Already drawn as red blocked — skip yellow overlay
            // (red layer was drawn first)
          } else if (isHolding) {
            // Available drop target while carrying a citizen — brighter gold
            ctx.fillStyle = 'rgba(255, 214, 0, 0.20)';
            ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
            ctx.strokeStyle = 'rgba(255, 214, 0, 0.95)';
            ctx.lineWidth = Math.max(1.5, cameraZoom);
            ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
          } else {
            // Unworked radius tile — subtle gold
            ctx.fillStyle = 'rgba(255, 214, 0, 0.12)';
            ctx.fillRect(x - half, y - half, scaledTileSize, scaledTileSize);
            ctx.strokeStyle = 'rgba(255, 214, 0, 0.6)';
            ctx.lineWidth = Math.max(1, cameraZoom);
            ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
          }
        }
      }

      // City center — always worked, thick gold outline
      const center = squareToScreen(selectedCity.col, selectedCity.row);
      const half = scaledTileSize / 2;
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = Math.max(2, cameraZoom * 2);
      ctx.strokeRect(center.x - half, center.y - half, scaledTileSize, scaledTileSize);
      // Green fill to indicate it's worked
      ctx.fillStyle = 'rgba(50, 200, 80, 0.28)';
      ctx.fillRect(center.x - half, center.y - half, scaledTileSize, scaledTileSize);
    }

    // Draw movement range overlay first (so it's under everything else)
    if (reachableTiles && reachableTiles.size > 0) {
      // Determine if the selected unit is naval
      const selectedUnitId = gameState.selectedUnit;
      const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;
      const isNaval = selectedUnit && UNIT_PROPERTIES[selectedUnit.type]?.naval;
      
      reachableTiles.forEach((_cost, key) => {
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
        if (!isExplored) {
          // Villages and all other elements remain hidden under fog of war.
          continue;
        }

        // Draw selection highlight
        if (selectedHex && selectedHex.col === col && selectedHex.row === row) {
          const half = scaledTileSize / 2;
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - half, y - half, scaledTileSize, scaledTileSize);
        }

        // === IMPROVEMENTS RENDERING (same pattern as units/cities) ===
        // Always read improvements from authoritative map.tiles, never from cached terrain grid
        const authoritativeTile = map.tiles?.[tileIndex];
        if (authoritativeTile && tile) {
          const improvementTile: TerrainTileRenderInfo = {
            type: tile.type,
            resource: authoritativeTile.resource ?? tile.resource ?? null,
            improvement: authoritativeTile.improvement ?? null,
            hasRoad: authoritativeTile.hasRoad ?? false,
            hasRiver: authoritativeTile.hasRiver ?? tile.hasRiver ?? false,
            village: authoritativeTile.village ?? tile.village ?? false,
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
            this.drawCity(ctx, x, y, city, cameraZoom, civilizations, combatAnimations);
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
            // Killed units (marked isDefeated) are never drawn again — the
            // combat animation replaces the old "black X" death marker.
            if ((unit as Unit).isDefeated) {
              continue;
            }

            const hasMoves = (unit.movesRemaining || 0) > 0;
            let alpha = 1;
            // Only apply pulsing animation if currentTime > 0 (animated mode)
            if (currentTime > 0 && isActivePlayersUnit && hasMoves) {
              const period = 2000;
              const t = (currentTime % period) / period;
              const sine = Math.sin(t * Math.PI * 4);
              alpha = 0.675 + 0.325 * (sine + 1) * 10;
            }

            // Combat animation: hide both units while the cloud is shown, then
            // fade the survivor back in. The destroyed unit stays hidden.
            const combat = this.getCombatRenderState(unit, combatAnimations);
            if (combat.hidden) {
              continue;
            }
            alpha *= combat.alpha;

            const displayTile = this.getUnitDisplayTile(unit, movementAnimations);
            const unitPos = squareToScreen(displayTile.col, displayTile.row);
            this.drawUnit(ctx, unitPos.x, unitPos.y, unit, alpha, cameraZoom, civilizations, combatAnimations);
          }
        }

        // Draw selected unit highlight (on top of everything)
        const selectedUnitId = gameState.selectedUnit;
        const unitAtTile = units.find(u => u.col === col && u.row === row);
        if (selectedUnitId && unitAtTile && unitAtTile.id === selectedUnitId) {
          const displayTile = this.getUnitDisplayTile(unitAtTile, movementAnimations);
          const unitPos = squareToScreen(displayTile.col, displayTile.row);
          const half = scaledTileSize / 2;
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 3;
          ctx.strokeRect(unitPos.x - half, unitPos.y - half, scaledTileSize, scaledTileSize);
        }

        // Debug coordinates (very high zoom only)
        if (cameraZoom > 4.0) {
          ctx.fillStyle = '#000';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${col},${row}`, x, y + scaledTileSize * 0.3);
        }
      }
    }

    // Draw combat clouds (on top of terrain/units).
    if (combatAnimations && combatAnimations.length > 0) {
      this.drawCombatClouds(ctx, combatAnimations, squareToScreen, cameraZoom, canvasSize);
    }
  }

  /** @inheritdoc getUnitDisplayTile */
  private getUnitDisplayTile(
    unit: Unit,
    movementAnimations?: MovementAnimation[]
  ): { col: number; row: number } {
    return getUnitDisplayTile(unit, movementAnimations);
  }

  /**
   * Determine how a unit should render given the active combat animations.
   *
   * Timeline:
   *   0 … duration     → both units VISIBLE; 💥 cloud blinks at defender tile
   *   duration … duration+deathBlink → survivor shown; dead unit blinks fast
   *   duration+deathBlink … ∞       → dead unit hidden forever
   */
  private getCombatRenderState(
    unit: Unit,
    combatAnimations?: CombatAnimation[]
  ): { hidden: boolean; alpha: number } {
    if (!combatAnimations || combatAnimations.length === 0) {
      return { hidden: false, alpha: 1 };
    }

    const now = performance.now();
    for (const anim of combatAnimations) {
      const isAttacker = unit.id === anim.attackerId;
      const isDefender = unit.id === anim.defenderId;
      if (!isAttacker && !isDefender) continue;

      const elapsed = now - anim.startTime;
      const survived = isAttacker ? anim.attackerSurvived : anim.defenderSurvived;

      if (elapsed < anim.duration) {
        // During the cloud phase: BOTH units are visible so the player
        // can see the attacker and defender. The 💥 cloud is drawn on top
        // at reduced opacity by drawCombatClouds().
        return { hidden: false, alpha: 1 };
      }

      if (survived) {
        // Survivor: fully visible, no fade needed.
        return { hidden: false, alpha: 1 };
      }

      // Destroyed unit: blink rapidly for deathBlinkDuration, then vanish.
      const blinkElapsed = elapsed - anim.duration;
      const blinkDuration = anim.deathBlinkDuration ?? 2000;
      if (blinkElapsed >= blinkDuration) {
        return { hidden: true, alpha: 0 };
      }
      // Fast blink: ~150ms on / ~150ms off
      const blinkCycle = 150;
      const visible = Math.floor(blinkElapsed / blinkCycle) % 2 === 0;
      return { hidden: !visible, alpha: visible ? 1 : 0 };
    }

    return { hidden: false, alpha: 1 };
  }

  /**
   * Draw a blinking 💥 cloud emoji at each active combat's defender tile
   * while its cloud phase is running. The cloud blinks on/off every ~200ms
   * so the fight feels dynamic.
   */
  private drawCombatClouds(
    ctx: CanvasRenderingContext2D,
    combatAnimations: CombatAnimation[],
    squareToScreen: (col: number, row: number) => { x: number; y: number },
    cameraZoom: number,
    canvasSize: CanvasSize
  ): void {
    const now = performance.now();
    const margin = this.tileSize * 2;

    for (const anim of combatAnimations) {
      const elapsed = now - anim.startTime;
      if (elapsed >= anim.duration) continue;

      const { x, y } = squareToScreen(anim.defenderCol, anim.defenderRow);
      if (this.isOutsideViewport(x, y, canvasSize.width, canvasSize.height, margin)) {
        continue;
      }

      // Blink the cloud: visible for 200ms, invisible for 200ms.
      const blinkCycle = 200;
      const visible = Math.floor(elapsed / blinkCycle) % 2 === 0;
      if (!visible) continue;

      // Fade in quickly on first appearance, cap at 60% opacity.
      const fadeIn = Math.min(0.6, (elapsed / 150) * 0.6);
      ctx.save();
      ctx.globalAlpha = fadeIn;

      const size = Math.round(this.tileSize * cameraZoom * 1.8);
      ctx.font = `${size}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const emoji = anim.cityAttack ? '💥' : '💥';
      ctx.fillText(emoji, x, y);

      ctx.restore();
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
   * Draws terrain symbols including base terrain characters, rivers, and improvements.
   * Handles glyph rendering for roads, railroads, and other terrain features.
   *
   * @param ctx - Canvas rendering context
   * @param centerX - Center X coordinate for the symbol
   * @param centerY - Center Y coordinate for the symbol
   * @param terrain - Terrain tile information
   * @param options - Drawing options for base symbols and rivers
   */
  /**
   * Draw a Civ1 village (goody hut) marker (🛖) at a tile. `dimmed` renders a
   * ghost hut — used for huts seen through the fog of war.
   */
  private drawVillageMarker(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    dimmed: boolean,
  ): void {
    try {
      const symbolScale = this.tileSize / 22;
      const villageSize = Math.round(20 * symbolScale);
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.45;
      ctx.font = `${villageSize}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🛖', centerX, centerY - 4 * symbolScale);
      ctx.restore();
    } catch (err) {
      console.warn('[MapRenderer] drawVillageMarker fillText failed', err);
    }
  }

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

    // Scale terrain symbols proportionally to tile size (base: 32px → 16px font)
    const symbolScale = this.tileSize / 32;
    const baseFontSize = Math.round(16 * symbolScale);

    if (drawBase && typeof char === 'string' && char.length > 0) {
      ctx.fillStyle = '#000';
      ctx.font = `${baseFontSize}px ${TERRAIN_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      try {
        ctx.fillText(char, centerX, centerY - 8 * symbolScale);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol fillText failed', err);
      }
    }

    // Civ1 special-resource glyph (Seal, Gems, Horses, Gold, Coal, Fish, Oil, Game, Oasis).
    const resource = terrain.resource ? String(terrain.resource) : null;
    if (drawBase && resource && RESOURCE_GLYPHS[resource.toLowerCase()]) {
      try {
        ctx.font = `${baseFontSize}px ${TERRAIN_FONT_FAMILY}`;
        ctx.fillStyle = '#000';
        ctx.fillText(RESOURCE_GLYPHS[resource.toLowerCase()], centerX - 10 * symbolScale, centerY + 10 * symbolScale);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol resource fillText failed', err);
      }
    }

    // Civ1 village (goody hut) marker. Drawn only in the dynamic pass
    // (drawBase === false) so it always reflects the authoritative map state
    // and disappears the moment a unit claims the hut.
    if (terrain.village && !drawBase) {
      this.drawVillageMarker(ctx, centerX, centerY, false);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (drawRivers && terrain.hasRiver) {
      try {
        ctx.font = `${baseFontSize}px ${TERRAIN_FONT_FAMILY}`;
        ctx.fillStyle = '#0066FF';
        ctx.fillText('~', centerX + 8 * symbolScale, centerY + 8 * symbolScale);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol river fillText failed', err);
      }
    }

    const drawDisplayGlyph = (display?: ImprovementDisplayConfig | null): boolean => {
      if (!display || !display.glyph) return false;
      try {
        ctx.font = display.font ?? `bold ${Math.round(14 * symbolScale)}px monospace`;
        ctx.fillStyle = display.color ?? '#8B4513';
        const dx = (display.offsetX ?? 0) * symbolScale;
        const dy = (display.offsetY ?? 12) * symbolScale;
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
    civilizations: Civilization[],
    combatAnimations?: CombatAnimation[]
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

    // Draw specialist icons below the city name, flowing left to right.
    const specs = city.specialists ?? [];
    if (specs.length > 0) {
      const specFontSize = Math.max(6, 7 * cameraZoom);
      ctx.font = `${specFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const iconW = specFontSize * 1.4;
      const totalW = specs.length * iconW;
      const startX = centerX - totalW / 2 + iconW / 2;
      const specY = centerY + 24 * cameraZoom + specFontSize * 0.5;
      for (let i = 0; i < specs.length; i++) {
        const def = SPECIALIST_YIELDS[specs[i]];
        if (def) {
          const x = startX + i * iconW;
          // Coloured circle background for each specialist type
          const bg =
            specs[i] === 'entertainer' ? 'rgba(180,80,220,0.7)' :
            specs[i] === 'taxman'      ? 'rgba(220,180,40,0.7)' :
                                          'rgba(80,160,220,0.7)';
          ctx.beginPath();
          ctx.arc(x, specY + specFontSize * 0.4, specFontSize * 0.65, 0, Math.PI * 2);
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.fillStyle = '#FFF';
          ctx.fillText(def.icon, x, specY);
        }
      }
    }

    // Show city population size as a number badge on the city tile
    const pop = city.population || 1;
    const popRadius = Math.max(6, 8 * cameraZoom);
    const popX = centerX + size / 2 - 2;
    const popY = centerY - size / 2 + 2;
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.arc(popX, popY, popRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${Math.max(7, 9 * cameraZoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pop), popX, popY + 0.5);
    
    // Red hit-flash overlay on a city that took damage.
    const cityHealthState = this.getCityCombatHealthState(city, combatAnimations);
    if (cityHealthState.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = cityHealthState.hitFlash * 0.4;
      ctx.fillStyle = '#FF0000';
      const flashSize = size + 4;
      ctx.fillRect(centerX - flashSize / 2, centerY - flashSize / 2, flashSize, flashSize);
      ctx.restore();
    }

    // Show HP bar if city has taken damage or has more than 1 HP
    const cityHP = cityHealthState.displayHealth;
    const cityMaxHP = cityHealthState.maxHealth;
    if (cityHP < cityMaxHP) {
      // Draw damaged HP bar
      const hpBarWidth = 40 * cameraZoom;
      const hpBarHeight = 6 * cameraZoom;
      const hpBarY = centerY - size / 2 - 10 * cameraZoom;
      
      // Background (max HP)
      ctx.fillStyle = '#333';
      ctx.fillRect(centerX - hpBarWidth / 2, hpBarY, hpBarWidth, hpBarHeight);
      
      // HP fill (red when damaged)
      const hpPercent = cityHP / cityMaxHP;
      ctx.fillStyle = hpPercent < 0.5 ? '#FF0000' : '#00FF00';
      ctx.fillRect(centerX - hpBarWidth / 2, hpBarY, hpBarWidth * hpPercent, hpBarHeight);
      
      // Border
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - hpBarWidth / 2, hpBarY, hpBarWidth, hpBarHeight);
    }
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
    civilizations: Civilization[],
    alpha = 1
  ): void {
    ctx.save();
    if (alpha < 1) {
      ctx.globalAlpha = alpha;
    }

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
    const backgroundAlpha = ctx.globalAlpha;
    ctx.globalAlpha = backgroundAlpha * 0.3;
    ctx.fill();
    ctx.globalAlpha = backgroundAlpha;

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
      const backgroundAlpha = ctx.globalAlpha;
      ctx.globalAlpha = backgroundAlpha * 0.3;
      ctx.fill();
      ctx.globalAlpha = backgroundAlpha;

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
      } catch {
        const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
        ctx.fillText(fallback, centerX, centerY);
      }
    }

    if ((unit as Unit).isSleeping) {
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
   * Resolve the displayed HP and a red hit-flash for a unit in an active combat
   * animation. The HP bar tweens from its pre-combat value to its post-combat
   * value; the flash decays over the cloud duration (strongest for the unit that
   * lost HP, and always shown on the attacked defender).
   */
  private getCombatHealthState(
    unit: Unit,
    combatAnimations?: CombatAnimation[]
  ): { displayHealth: number; hitFlash: number } {
    if (!combatAnimations || combatAnimations.length === 0) {
      return { displayHealth: unit.health ?? 100, hitFlash: 0 };
    }
    const now = performance.now();
    for (const anim of combatAnimations) {
      const isAttacker = unit.id === anim.attackerId;
      const isDefender = unit.id === anim.defenderId;
      if (!isAttacker && !isDefender) continue;
      const elapsed = now - anim.startTime;
      const before = isAttacker ? (anim.attackerHealthBefore ?? unit.health) : (anim.defenderHealthBefore ?? unit.health);
      const after = isAttacker ? (anim.attackerHealthAfter ?? unit.health) : (anim.defenderHealthAfter ?? unit.health);
      // Tween the HP bar over ~500ms from the combat start.
      const hpTween = Math.min(1, elapsed / 500);
      const displayHealth = MathUtils.lerp(before, after, MathUtils.fade(hpTween));
      const flash = elapsed < anim.duration ? 1 - (elapsed / anim.duration) : 0;
      // The defender is the "attacked" unit — always flashes while under attack,
      // and the unit that lost HP (the attacker on a failed attack) flashes too.
      const lostHp = before > after;
      return { displayHealth, hitFlash: lostHp || isDefender ? flash : 0 };
    }
    return { displayHealth: unit.health ?? 100, hitFlash: 0 };
  }

  /**
   * Resolve the displayed HP and a red hit-flash for a city in an active combat
   * animation (city attacks only).
   */
  private getCityCombatHealthState(
    city: City,
    combatAnimations?: CombatAnimation[]
  ): { displayHealth: number; maxHealth: number; hitFlash: number } {
    const cityMaxHP = city.population || 1;
    const baseHP = city.hitPoints ?? cityMaxHP;
    if (!combatAnimations || combatAnimations.length === 0) {
      return { displayHealth: baseHP, maxHealth: cityMaxHP, hitFlash: 0 };
    }
    const now = performance.now();
    for (const anim of combatAnimations) {
      if (!anim.cityAttack || anim.cityId !== city.id) continue;
      const elapsed = now - anim.startTime;
      const before = anim.cityHealthBefore ?? baseHP;
      const after = anim.cityHealthAfter ?? baseHP;
      const hpTween = Math.min(1, elapsed / 500);
      const displayHealth = MathUtils.lerp(before, after, MathUtils.fade(hpTween));
      const flash = elapsed < anim.duration ? 1 - (elapsed / anim.duration) : 0;
      return { displayHealth, maxHealth: cityMaxHP, hitFlash: before > after ? flash : 0 };
    }
    return { displayHealth: baseHP, maxHealth: cityMaxHP, hitFlash: 0 };
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
    civilizations: Civilization[],
    combatAnimations?: CombatAnimation[]
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;

    const healthState = this.getCombatHealthState(unit, combatAnimations);
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
      // Draw colored circle background for SVG units (same as emoji units)
      ctx.beginPath();
      ctx.fillStyle = civColor;
      ctx.arc(centerX, centerY, innerRadius, 0, 2.7 * Math.PI);
      const backgroundAlpha = ctx.globalAlpha;
      ctx.globalAlpha = backgroundAlpha * 0.3;
      ctx.fill();
      ctx.globalAlpha = backgroundAlpha;
      
      // Draw the PNG/SVG image icon on top of the colored circle
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
      const backgroundAlpha = ctx.globalAlpha;
      ctx.globalAlpha = backgroundAlpha * 0.3;
      ctx.fill();
      ctx.globalAlpha = backgroundAlpha;

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
      } catch {
        const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
        ctx.fillText(fallback, centerX, centerY);
      }
    }

    if ((unit as Unit).isSleeping) {
      const sleepIcon = '💤';
      const sleepFontSize = Math.max(8, Math.round(innerRadius * 0.7));
      ctx.font = `${sleepFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.isLightColor(civColor) ? '#111' : '#FFF';
      ctx.fillText(sleepIcon, centerX, centerY + 22);
    }

    // Fortified indicator (Civ1: fortification = +50% defense). A small shield
    // is drawn above the unit so players can see which units are dug in —
    // previously fortification was invisible and combat outcomes seemed random.
    if ((unit as Unit).isFortified) {
      const shieldSize = Math.max(5, Math.round(7 * zoomFactor));
      const shieldY = centerY - innerRadius - 3 * zoomFactor;
      ctx.save();
      ctx.globalAlpha = alpha * 0.95;
      ctx.beginPath();
      ctx.moveTo(centerX, shieldY - shieldSize);
      ctx.lineTo(centerX + shieldSize, shieldY - shieldSize * 0.5);
      ctx.lineTo(centerX + shieldSize, shieldY + shieldSize * 0.3);
      ctx.quadraticCurveTo(centerX + shieldSize, shieldY + shieldSize, centerX, shieldY + shieldSize);
      ctx.quadraticCurveTo(centerX - shieldSize, shieldY + shieldSize, centerX - shieldSize, shieldY + shieldSize * 0.3);
      ctx.lineTo(centerX - shieldSize, shieldY - shieldSize * 0.5);
      ctx.closePath();
      ctx.fillStyle = '#2b6cb0';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1, 1.5 * zoomFactor);
      ctx.stroke();
      ctx.restore();
    }

    // Red hit-flash overlay on a unit that took damage or is being attacked.
    if (healthState.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = alpha * healthState.hitFlash * 0.5;
      ctx.beginPath();
      ctx.fillStyle = '#FF0000';
      ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Show health indicator as a small bar below the unit circle
    const unitHealth = healthState.displayHealth;
    if (unitHealth < 100) {
      const hpBarWidth = innerRadius * 1.6;
      const hpBarHeight = Math.max(3, 3 * zoomFactor);
      const hpBarX = centerX - hpBarWidth / 2;
      const hpBarY = centerY + innerRadius + 2 * zoomFactor;
      const hpPercent = Math.max(0, Math.min(1, unitHealth / 100));

      // Background
      ctx.fillStyle = '#333';
      ctx.fillRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);

      // HP fill (red → yellow → green)
      ctx.fillStyle = hpPercent < 0.33 ? '#FF3333' : hpPercent < 0.66 ? '#FFD700' : '#33CC33';
      ctx.fillRect(hpBarX, hpBarY, hpBarWidth * hpPercent, hpBarHeight);

      // Border
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);

      // Percentage text
      const pctText = `${Math.round(unitHealth)}%`;
      ctx.fillStyle = '#FFF';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.font = `bold ${Math.max(6, 7 * zoomFactor)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.strokeText(pctText, centerX, hpBarY + hpBarHeight + 1);
      ctx.fillText(pctText, centerX, hpBarY + hpBarHeight + 1);
    }

    // Draw black X on defeated units (blinks with the unit during combat
    // animation; invisible once the unit is hidden after the death blink).
    if ((unit as Unit).isDefeated) {
      ctx.save();
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
    // Check if path ends at an enemy unit or city - if so, show combat icon instead of arrow
    const lastPathStep = path[path.length - 1];
    const targetUnit = units.find(u => u.col === lastPathStep.col && u.row === lastPathStep.row);
    const isEnemyAtUnit = targetUnit && targetUnit.civilizationId !== unit.civilizationId;
    
    // Check for enemy city at destination
    const cities = (gameState as unknown as Record<string, unknown>).cities as City[] || [];
    const targetCity = cities.find((c: City) => c.col === lastPathStep.col && c.row === lastPathStep.row);
    const isEnemyAtCity = targetCity && targetCity.civilizationId !== unit.civilizationId;
    const isEnemyAtDestination = isEnemyAtUnit || isEnemyAtCity;

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
