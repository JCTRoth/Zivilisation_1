import { TILE_SIZE } from '@/data/TerrainData';

/**
 * Zoom limits for the whole game.
 *
 * These used to be hardcoded in four places and disagreed with each other:
 * the keyboard handler allowed 0.5–3.0, the wheel/pinch/double-tap handlers
 * allowed 0.3–2.5, and `camera.minZoom` / `camera.maxZoom` (declared but never
 * read) said 0.5–3.0. The range below is the union of all of them, so no input
 * method loses a zoom level it could previously reach — they just agree now.
 *
 * The upper bound is safe for the renderer: above `DIRECT_TERRAIN_ZOOM` (2)
 * tiles are drawn straight from the 256 px source textures, which the renderer
 * documents as staying sharp to ~8×, i.e. well past MAX_ZOOM.
 */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3.0;

/** Clamp a zoom factor to the playable range. */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export interface CameraCenterParams {
  col: number;
  row: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
}

/**
 * Compute the camera position (world px) that centers a tile, clamping to the
 * map bounds so the view never drifts into empty (black) space.
 *
 * The renderer maps world->screen with `screen = (world - camera) * zoom`, so a
 * tile is centered when `camera = tileCenter - viewportWorld / 2`.
 */
export function centerCameraOnTile({
  col,
  row,
  zoom,
  viewportWidth,
  viewportHeight,
  mapWidth,
  mapHeight,
}: CameraCenterParams): { x: number; y: number } {
  // World-space center of the target tile
  const centerX = (col + 0.5) * TILE_SIZE;
  const centerY = (row + 0.5) * TILE_SIZE;

  // World-space size of the visible viewport at this zoom
  const viewWorldW = viewportWidth / zoom;
  const viewWorldH = viewportHeight / zoom;

  const worldW = mapWidth * TILE_SIZE;
  const worldH = mapHeight * TILE_SIZE;

  let x = centerX - viewWorldW / 2;
  let y = centerY - viewWorldH / 2;

  // Clamp to map bounds (center the map when the view is larger than it)
  x = viewWorldW >= worldW
    ? (worldW - viewWorldW) / 2
    : Math.max(0, Math.min(worldW - viewWorldW, x));
  y = viewWorldH >= worldH
    ? (worldH - viewWorldH) / 2
    : Math.max(0, Math.min(worldH - viewWorldH, y));

  return { x, y };
}

/**
 * Return the pixel size of the actual game map viewport.
 * Uses the canvas element (accounts for top/bottom bars on mobile) with a
 * window fallback for non-DOM contexts.
 */
export function getGameViewport(): { width: number; height: number } {
  if (typeof document === 'undefined') {
    return { width: 800, height: 600 };
  }
  const canvas = document.querySelector('.game-canvas canvas');
  if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }
  return {
    width: window.innerWidth || 800,
    height: window.innerHeight || 600,
  };
}
