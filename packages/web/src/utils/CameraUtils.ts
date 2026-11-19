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

/**
 * Maximum zoom OUT level for normal (non-dev) games.
 * Below this the map becomes unreadably small and the player loses spatial
 * context — the fog of war and tile detail are designed for this range.
 */
const MIN_ZOOM_NORMAL = 0.5;

/** Clamp a zoom factor to the playable range. */
export function clampZoom(zoom: number, isDevMode: boolean = false): number {
  const min = isDevMode ? MIN_ZOOM : Math.max(MIN_ZOOM, MIN_ZOOM_NORMAL);
  return Math.max(min, Math.min(MAX_ZOOM, zoom));
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
 * Clamp a camera position (world px) to the map bounds so the view never
 * drifts into empty (black) space. When the view is larger than the map it is
 * centered instead.
 */
export function clampCameraToMap(
  x: number,
  y: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const viewWorldW = viewportWidth / zoom;
  const viewWorldH = viewportHeight / zoom;

  const worldW = mapWidth * TILE_SIZE;
  const worldH = mapHeight * TILE_SIZE;

  return {
    x: viewWorldW >= worldW
      ? (worldW - viewWorldW) / 2
      : Math.max(0, Math.min(worldW - viewWorldW, x)),
    y: viewWorldH >= worldH
      ? (worldH - viewWorldH) / 2
      : Math.max(0, Math.min(worldH - viewWorldH, y)),
  };
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
  return clampCameraToMap(
    (col + 0.5) * TILE_SIZE - viewportWidth / zoom / 2,
    (row + 0.5) * TILE_SIZE - viewportHeight / zoom / 2,
    zoom,
    viewportWidth,
    viewportHeight,
    mapWidth,
    mapHeight,
  );
}

/**
 * How close a moving unit may get to the viewport edge before the camera
 * starts following it. Half a tile keeps the unit's whole tile inside the
 * view: the camera nudges along the moment the tile would otherwise be
 * clipped, and stops again as soon as it is fully on screen.
 */
export const EDGE_FOLLOW_MARGIN_TILES = 0.5;

export interface EdgeFollowParams {
  /** World position (px) of the followed point — a moving unit's centre. */
  targetWorldX: number;
  targetWorldY: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
  /** Edge distance the point should keep, in tiles (defaults to the constant). */
  marginTiles?: number;
}

/**
 * Edge-follow: the minimal camera nudge that keeps a moving unit inside the
 * viewport's edge margin. The camera moves by exactly the overrun, in the
 * direction of the unit — it never re-centers and never overshoots.
 *
 * Returns the nudged camera position, or `null` when the point is already
 * inside the margin, when no data is available, or when the camera is pinned
 * against the map edge and cannot move any closer.
 */
export function nudgeCameraToKeepPointInView({
  targetWorldX,
  targetWorldY,
  cameraX,
  cameraY,
  zoom,
  viewportWidth,
  viewportHeight,
  mapWidth,
  mapHeight,
  marginTiles = EDGE_FOLLOW_MARGIN_TILES,
}: EdgeFollowParams): { x: number; y: number } | null {
  if (!(zoom > 0) || !(viewportWidth > 0) || !(viewportHeight > 0)) return null;
  if (!(mapWidth > 0) || !(mapHeight > 0)) return null;

  // The margin can never eat more than half the viewport; beyond that there is
  // no "inside" left to aim for.
  const marginX = Math.min(Math.max(0, marginTiles) * TILE_SIZE * zoom, viewportWidth / 2);
  const marginY = Math.min(Math.max(0, marginTiles) * TILE_SIZE * zoom, viewportHeight / 2);

  const screenX = (targetWorldX - cameraX) * zoom;
  const screenY = (targetWorldY - cameraY) * zoom;

  // Where the point should sit: only the overrun past an edge is compensated.
  const clampedX = Math.min(Math.max(screenX, marginX), viewportWidth - marginX);
  const clampedY = Math.min(Math.max(screenY, marginY), viewportHeight - marginY);
  if (clampedX === screenX && clampedY === screenY) return null;

  const target = clampCameraToMap(
    cameraX + (screenX - clampedX) / zoom,
    cameraY + (screenY - clampedY) / zoom,
    zoom,
    viewportWidth,
    viewportHeight,
    mapWidth,
    mapHeight,
  );

  // Pinned at the map edge (or the nudge is too small to matter): leave the
  // camera untouched rather than emitting a no-op update.
  if (Math.abs(target.x - cameraX) < 0.01 && Math.abs(target.y - cameraY) < 0.01) return null;
  return target;
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
