import { TILE_SIZE } from '@/data/TerrainData';

/**
 * How much of the screen may be unexplored black before the GoTo camera rule
 * kicks in. A route plotted while the board is almost entirely black shows
 * the player nothing — the routed unit is somewhere else — so the camera
 * comes back to it. A view with real map content stays where the player put
 * it (the destination and the drawn route are what they are looking at).
 */
export const BLACK_COVERAGE_REFOCUS_THRESHOLD = 0.8;

export interface ViewportBlackCoverageParams {
  /** Camera position (world px) and zoom; world→screen is `(world - camera) * zoom`. */
  camera: { x: number; y: number; zoom: number };
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
  /**
   * Fog-of-war "already seen" mask (row-major, one entry per tile), i.e. the
   * store's `map.revealed`. Missing arrays/entries fall back to the per-tile
   * `explored` flag, exactly like the renderer's `createTerrainGrid` — and
   * missing data counts as black, matching the renderer's default-hidden rule.
   */
  revealed?: boolean[];
  /** Per-tile fallback when `revealed` is not populated (store `map.tiles`). */
  tiles?: ReadonlyArray<{ explored?: boolean } | undefined>;
}

/**
 * Fraction (0..1) of the current viewport that renders black: unexplored tiles
 * plus any off-map space the camera shows past the map edge.
 *
 * The renderer paints unexplored tiles with an opaque dark mask and leaves
 * everything outside the map as bare background, so "black" here is exactly
 * "the player cannot see anything there". Visible-but-fogged (explored but
 * currently out of sight) tiles are dimmed, not black, and are therefore not
 * counted.
 */
export function computeViewportBlackCoverage({
  camera,
  viewportWidth,
  viewportHeight,
  mapWidth,
  mapHeight,
  revealed,
  tiles,
}: ViewportBlackCoverageParams): number {
  if (!(viewportWidth > 0) || !(viewportHeight > 0) || !(camera.zoom > 0)) return 0;
  if (!(mapWidth > 0) || !(mapHeight > 0)) return 0;

  const viewWorldW = viewportWidth / camera.zoom;
  const viewWorldH = viewportHeight / camera.zoom;
  const viewArea = viewWorldW * viewWorldH;
  if (!(viewArea > 0)) return 0;

  const left = camera.x;
  const top = camera.y;
  const right = left + viewWorldW;
  const bottom = top + viewWorldH;

  // Black area = viewport area − explored area actually on screen. Off-map
  // space never gets subtracted, so it stays counted as black.
  let exploredVisibleArea = 0;

  const startCol = Math.max(0, Math.floor(left / TILE_SIZE));
  const endCol = Math.min(mapWidth - 1, Math.ceil(right / TILE_SIZE) - 1);
  const startRow = Math.max(0, Math.floor(top / TILE_SIZE));
  const endRow = Math.min(mapHeight - 1, Math.ceil(bottom / TILE_SIZE) - 1);

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const index = row * mapWidth + col;
      const explored = revealed ? revealed[index] === true : tiles?.[index]?.explored === true;
      if (!explored) continue;

      const tileLeft = col * TILE_SIZE;
      const tileTop = row * TILE_SIZE;
      const overlapW = Math.min(right, tileLeft + TILE_SIZE) - Math.max(left, tileLeft);
      const overlapH = Math.min(bottom, tileTop + TILE_SIZE) - Math.max(top, tileTop);
      if (overlapW > 0 && overlapH > 0) {
        exploredVisibleArea += overlapW * overlapH;
      }
    }
  }

  return Math.max(0, Math.min(1, 1 - exploredVisibleArea / viewArea));
}
