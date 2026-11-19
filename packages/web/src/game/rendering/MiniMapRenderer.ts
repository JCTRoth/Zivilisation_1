/**
 * MiniMapRenderer - Renders the Civilization 1 minimap (overview map) to a canvas.
 *
 * This module provides canvas-based rendering for the minimap, showing the
 * entire map with terrain, cities and units colored by their civilization,
 * plus a viewport indicator. It is kept separate from MapRenderer so the main
 * game renderer stays focused on the detailed camera view.
 *
 * Key features:
 * - Terrain overview with fog-of-war dimming
 * - Cities and units colored by civilization (colors from src/data/GameData.ts)
 * - Current camera viewport indicator
 * - Option to ignore fog (developer mode)
 */

import { Constants } from '@/utils/Constants';
import { TILE_SIZE, TERRAIN_TYPES } from '@/data/TerrainData';
import { CIVILIZATIONS } from '@/data/GameData';
import type { MapState, CameraState, Unit, City, Civilization } from '../../../types/game';

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
 * Renders the minimap showing the entire map with fog of war, civilization
 * colors and the current camera viewport indicator.
 */
export class MiniMapRenderer {
  /**
   * The terrain + fog layer only changes when the map, the fog, the canvas size
   * or the ignoreFog setting changes — never when a unit moves or the camera
   * pans. Cities, units and the viewport are drawn on top of this cache, so a
   * redraw with only movement blits one image instead of repainting every tile.
   *
   * Without it, drawMinimapTerrain ran a full per-tile pass (5760 tiles on the
   * 96x60 archipelago, with a toUpperCase() allocation each) on EVERY React
   * commit, and an AI-vs-AI turn produces dozens of commits per second. CDP
   * profiles of the tropical map showed ~200 ms stalls from this pass alone.
   */
  private terrainLayerCanvas: HTMLCanvasElement | null = null;
  private terrainLayerKey = '';

  /**
   * Renders the minimap showing the entire map with fog of war and viewport indicator.
   * Displays terrain, cities, units, and the current camera viewport.
   *
   * @param params - Parameters for minimap rendering
   */
  renderMinimap(params: RenderMinimapParams): void {
    const { ctx, map, cssWidth, cssHeight, camera, units, cities, civilizations, ignoreFog } = params;
    this.resetMinimapCanvas(ctx, cssWidth, cssHeight);

    const fogState = ignoreFog
      ? { hasRevealed: false, hasVisibility: false, anyRevealed: false }
      : this.getMinimapFogState(map);

    const civColors = this.buildCivilizationColors(civilizations);

    this.blitTerrainLayer(ctx, map, cssWidth, cssHeight, fogState, !!ignoreFog);
    this.drawMinimapCities(ctx, map, cities, civColors, cssWidth, cssHeight);
    this.drawMinimapUnits(ctx, map, units, civColors, cssWidth, cssHeight, !!ignoreFog);
    this.drawMinimapViewport(ctx, map, camera, cssWidth, cssHeight);
  }

  /**
   * Blits the cached terrain+fog layer onto the minimap, rebuilding it only
   * when something it actually draws changed.
   */
  private blitTerrainLayer(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    width: number,
    height: number,
    fogState: MinimapFogState,
    ignoreFog: boolean
  ): void {
    if (typeof document === 'undefined') {
      // No offscreen canvas (unit tests, SSR): draw the layer directly.
      this.drawMinimapTerrain(ctx, map, width, height, fogState);
      return;
    }

    const dpr = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const key = this.buildTerrainLayerKey(map, width, height, dpr, ignoreFog);

    if (this.terrainLayerKey !== key || !this.terrainLayerCanvas) {
      const layer = this.ensureTerrainLayerCanvas(width * dpr, height * dpr);
      const layerCtx = layer.getContext('2d');
      if (!layerCtx) return;
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layerCtx.globalCompositeOperation = 'source-over';
      layerCtx.globalAlpha = 1;
      layerCtx.imageSmoothingEnabled = false;
      layerCtx.clearRect(0, 0, width, height);
      layerCtx.fillStyle = '#1a1a1a';
      layerCtx.fillRect(0, 0, width, height);
      this.drawMinimapTerrain(layerCtx, map, width, height, fogState);
      this.terrainLayerKey = key;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainLayerCanvas!, 0, 0, width, height);
  }

  private ensureTerrainLayerCanvas(pixelWidth: number, pixelHeight: number): HTMLCanvasElement {
    if (!this.terrainLayerCanvas) {
      this.terrainLayerCanvas = document.createElement('canvas');
    }
    const layer = this.terrainLayerCanvas;
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
    }
    return layer;
  }

  /**
   * Hash of everything drawMinimapTerrain reads. Cheap relative to a full
   * repaint: the terrain types and the fog bits.
   */
  private buildTerrainLayerKey(
    map: MapState,
    width: number,
    height: number,
    dpr: number,
    ignoreFog: boolean
  ): string {
    const tiles = map.tiles;
    if (!tiles) return `${width}x${height}@${dpr}:empty`;

    let h = ignoreFog ? 5381 : 5381 * 33;
    h = ((h << 5) - h + map.width) | 0;
    h = ((h << 5) - h + map.height) | 0;
    const revealed = ignoreFog ? undefined : map.revealed;
    const visibility = ignoreFog ? undefined : map.visibility;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!t) continue;
      const type = t.type ?? '';
      for (let j = 0; j < type.length; j++) {
        h = ((h << 5) - h + type.charCodeAt(j)) | 0;
      }
      if (revealed) h = ((h << 5) - h + (revealed[i] ? 1 : 0)) | 0;
      if (visibility) h = ((h << 5) - h + (visibility[i] ? 2 : 0)) | 0;
    }
    return `${width}x${height}@${dpr}:${h}`;
  }

  /**
   * Builds a lookup of civilization id -> color used to paint cities and units.
   * Colors come from the runtime civilizations (populated from `CIVILIZATIONS`
   * in src/data/GameData.ts) with a name-based fallback into the static list.
   *
   * @param civilizations - Array of all civilizations
   * @returns Map of civilization id to its color
   */
  private buildCivilizationColors(civilizations: Civilization[]): Map<number, string> {
    const colorMap = new Map<number, string>();
    if (!Array.isArray(civilizations)) return colorMap;

    for (const civ of civilizations) {
      if (!civ) continue;
      const color = this.changeVivid(civ.color,2.0) || this.getStaticCivilizationColor(civ.name);
      if (color) colorMap.set(civ.id, color);
    }
    return colorMap;
  }

  /**
   * Looks up a civilization's color from the static `CIVILIZATIONS` list by name.
   *
   * @param name - Civilization name
   * @returns The civilization's color, or undefined if not found
   */
  private getStaticCivilizationColor(name: string | undefined): string | undefined {
    if (!name) return undefined;
    return CIVILIZATIONS.find(civ => civ.name === name)?.color;
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

    // Resolve each terrain type's colour once instead of calling
    // `toUpperCase()` for every tile (5760 of them on the naval maps).
    const colorCache = new Map<string, string>();

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tileIndex = this.getTileIndex(row, col, map.width);
        const tile = map.tiles?.[tileIndex];
        if (!tile) continue;

        // Default to black for unexplored tiles when fog data is available
        if (fogState.hasRevealed) {
          const explored = map.revealed?.[tileIndex] ?? false;
          if (!explored) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
            continue;
          }
        }

        let color = colorCache.get(tile.type);
        if (color === undefined) {
          color = this.resolveTerrain(tile.type).color;
          colorCache.set(tile.type, color);
        }
        ctx.fillStyle = color;
        ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);

        // Apply semi-transparent overlay for explored but not currently visible tiles
        if (fogState.hasRevealed) {
          const visible = map.visibility?.[tileIndex] ?? false;
          if (!visible) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
          }
        }
      }
    }
  }

  /**
   * Draws cities on the minimap as colored rectangles.
   * Each city is colored by its owning civilization. Only shows cities that
   * are currently visible to the player (unless fog is ignored).
   *
   * @param ctx - Minimap canvas context
   * @param map - Current map state
   * @param cities - Array of all cities
   * @param civColors - Map of civilization id to its color
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   */
  private drawMinimapCities(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    cities: City[],
    civColors: Map<number, string>,
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
      // Cities are remembered: show them on any explored tile (not only while
      // currently visible), matching the main map.
      const explored = map.revealed ? !!map.revealed[tileIndex] : !!map.visibility?.[tileIndex];
      if (!explored) continue;

      const x = city.col * tileWidth;
      const y = city.row * tileHeight;
      ctx.fillStyle = civColors.get(city.civilizationId) || '#FF6347';
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
   * @param civColors - Map of civilization id to its color
   * @param width - Minimap width in pixels
   * @param height - Minimap height in pixels
   * @param ignoreFog - When true, draw all units regardless of visibility
   */
  private drawMinimapUnits(
    ctx: CanvasRenderingContext2D,
    map: MapState,
    units: Unit[],
    civColors: Map<number, string>,
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
      ctx.fillStyle = civColors.get(unit.civilizationId) || '#FF0000';
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

    const tileSize = Constants.HEX_SIZE || TILE_SIZE;
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
   * Converts a grid (row, col) to a linear tile index.
   *
   * @param row - Row coordinate
   * @param col - Column coordinate
   * @param width - Map width in tiles
   * @returns Linear index for the tile
   */
  private getTileIndex(row: number, col: number, width: number): number {
    return row * width + col;
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
   * Changes the vividness (saturation) of a hex color string.
   * Converts the hex color to HSL, adjusts saturation, and converts back to hex.
   * @param {string} hex - The hex color string (e.g., "#ff0000" or "#f00")
   * @param {number} factor - The multiplier for saturation (default: 1.2)
   * @returns {string} - The modified hex color string
   */
  private changeVivid = (hex, factor = 1.2) => {
    // Normalize shorthand hex (e.g., "#03F" -> "#0033FF")
    let cleanHex = hex.replace(/^#/, '');
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map(char => char + char).join('');
    }

    // Convert hex to RGB (0-1 range)
    const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
    const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
    const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

    // Convert RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    // Increase saturation (clamp to 0-1)
    s = Math.min(1, Math.max(0, s * factor));

    // Convert HSL back to RGB
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const newR = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const newG = Math.round(hue2rgb(p, q, h) * 255);
    const newB = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    // Convert back to hex string
    const toHex = x => x.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

}