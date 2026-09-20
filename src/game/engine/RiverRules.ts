/**
 * RiverRules — the single source of truth for how rivers behave on the map.
 *
 * The rule (from the design examples, L = land, R = river):
 *
 *   Example 1 (1-wide river)          Example 2                  Example 3
 *   L R L                             L R R L                    L R R L
 *   L R L                             L R L L                    L R L L
 *   L R L                             L R R L                    L R L L
 *                                                                L R R L
 *   A land unit may enter a river tile only when the river is ONE TILE WIDE
 *   at that tile (1-wide in at least one axis). Such a tile is "fordable":
 *     - Example 1: every tile is 1 wide horizontally → cross left↔right,
 *       and walk along the river.
 *     - Example 2: only the middle tile is 1 wide → the ONLY crossing is
 *       there; the river cannot be walked down (a wide tile blocks).
 *     - Example 3: rows 2/3 are 1 wide → walk up/down between them, but the
 *       2-wide row 4 cannot be entered from row 3.
 *
 * A 2+ tile wide river tile is impassable to land units from EVERY direction
 * (it is a real barrier: AI pathfinding, connectivity and movement all agree).
 * Rivers remain navigable for naval units — the width rule is a fording rule.
 *
 * The helpers are pure and take a `getTileAt` lookup, so the engine, the
 * pathfinder, the UI preview and the AI can all share the exact same rule.
 */

import { TERRAIN_TYPES } from '@/data/TerrainConstants';

/** Minimal tile shape the river rules need. */
export interface RiverTileLike {
  type?: string;
  terrain?: string;
}

/** Tile lookup callback (out-of-bounds must return null/undefined). */
export type RiverTileLookup = (col: number, row: number) => RiverTileLike | null | undefined;

/**
 * How many tiles wide a river may be and still be fordable by land units.
 * 1 = only one-tile-wide river sections can be entered/crossed.
 */
export const MAX_FORDABLE_RIVER_WIDTH = 1;

/** Safety bound for run-length scans (a broken lookup cannot loop forever). */
const RUN_SCAN_LIMIT = 4096;

/** Whether a tile is a river tile. */
export function isRiverTile(tile?: RiverTileLike | null): boolean {
  return String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase() === TERRAIN_TYPES.RIVER;
}

/**
 * Length of the consecutive river run through (col,row) along one axis
 * (including the tile itself). Returns 0 when the tile is not a river.
 */
export function riverRunLength(
  col: number,
  row: number,
  dCol: number,
  dRow: number,
  getTileAt: RiverTileLookup,
): number {
  if (!isRiverTile(getTileAt(col, row))) return 0;

  let length = 1;
  for (let c = col + dCol, r = row + dRow, i = 0; i < RUN_SCAN_LIMIT; c += dCol, r += dRow, i++) {
    if (!isRiverTile(getTileAt(c, r))) break;
    length++;
  }
  for (let c = col - dCol, r = row - dRow, i = 0; i < RUN_SCAN_LIMIT; c -= dCol, r -= dRow, i++) {
    if (!isRiverTile(getTileAt(c, r))) break;
    length++;
  }
  return length;
}

/** River extent through a tile in both axes: `{ horizontal, vertical }`. */
export function riverWidthsAt(
  col: number,
  row: number,
  getTileAt: RiverTileLookup,
): { horizontal: number; vertical: number } {
  return {
    horizontal: riverRunLength(col, row, 1, 0, getTileAt),
    vertical: riverRunLength(col, row, 0, 1, getTileAt),
  };
}

/**
 * Whether a river tile is too wide to ford (more than
 * `MAX_FORDABLE_RIVER_WIDTH` in BOTH axes). Wide river tiles are impassable
 * to land units; non-river tiles always return false.
 */
export function isWideRiverTile(col: number, row: number, getTileAt: RiverTileLookup): boolean {
  if (!isRiverTile(getTileAt(col, row))) return false;
  const { horizontal, vertical } = riverWidthsAt(col, row, getTileAt);
  return horizontal > MAX_FORDABLE_RIVER_WIDTH && vertical > MAX_FORDABLE_RIVER_WIDTH;
}

/** True for a river tile a land unit may enter/stand on (a 1-wide section). */
export function isFordableRiverTile(col: number, row: number, getTileAt: RiverTileLookup): boolean {
  return isRiverTile(getTileAt(col, row)) && !isWideRiverTile(col, row, getTileAt);
}
