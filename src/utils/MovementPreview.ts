import { Pathfinding } from '@/game/engine/Pathfinding';
import type { MapTile } from '@/game/engine/GameEngine';
import type { TurnMarker, Unit } from '../../types/game';

/** Tile accessor shared by the movement-preview helpers. */
export type TileLookup = (col: number, row: number) => MapTile | null;

/** The subset of a Unit needed to preview a movement or attack. */
export type MovementPreviewUnit = Pick<
  Unit,
  'col' | 'row' | 'type' | 'movesRemaining' | 'maxMoves' | 'hasMovedThisTurn' | 'civilizationId'
>;

/** A computed preview: the path steps (excluding the start tile) + turn markers. */
export interface MovementPreview {
  /** Path steps excluding the unit's starting tile. */
  steps: Array<{ col: number; row: number }>;
  /**
   * Turn-end tiles for a journey longer than one turn. Empty when the whole
   * path fits in the current turn (no numbers are drawn in that case).
   */
  turnMarkers: TurnMarker[];
  /** True when the final step lands on an enemy unit (attack move). */
  isAttack: boolean;
}

/** Floating-point tolerance for "no movement points left". */
const EPSILON = 1e-6;

/**
 * Compute the shortest path from a unit to a destination, plus the turn numbers
 * for a multi-turn journey. Returns `null` when no path exists.
 *
 * The path comes from `Pathfinding.findPath` (A*); the turn markers come from
 * {@link computeTurnMarkers}, which mirrors the engine's movement rules so the
 * preview matches what `GameEngine.moveUnit` will actually do.
 *
 * When `getUnitAt` is provided, the result includes `isAttack: true` if the
 * destination tile is occupied by an enemy unit. This flag is shared by the
 * GoToManager path drawing and the hover preview.
 *
 * Both `getUnitAt` and `getCityAt` are forwarded to the pathfinder so the
 * preview matches the real GoTo path: friendly units and enemy cities are
 * routed around (unless they are the attack target itself). Without this the
 * preview draws a line straight through units the unit cannot actually step
 * on, so the order then "doesn't work" (`GoToManager.calculatePath` returns a
 * different path or none at all).
 */
export function computeMovementPreview(
  unit: MovementPreviewUnit,
  targetCol: number,
  targetRow: number,
  getTileAt: TileLookup,
  mapWidth: number,
  mapHeight: number,
  getUnitAt?: (col: number, row: number) => { civilizationId: number } | null,
  getCityAt?: (col: number, row: number) => { civilizationId: number } | null
): MovementPreview | null {
  if (unit.col === targetCol && unit.row === targetRow) return null;

  const result = Pathfinding.findPath(
    unit.col,
    unit.row,
    targetCol,
    targetRow,
    getTileAt,
    unit.type,
    mapWidth,
    mapHeight,
    getUnitAt,
    unit.civilizationId,
    getCityAt
  );

  if (!result.success || result.path.length < 2) return null;

  const steps = result.path.slice(1).map(step => ({ col: step.col, row: step.row }));
  const turnMarkers = computeTurnMarkers(
    steps,
    getTileAt,
    unit.type,
    unit.movesRemaining || 0,
    unit.maxMoves,
    unit.hasMovedThisTurn === true
  );

  // Detect attack: destination occupied by an enemy.
  let isAttack = false;
  if (getUnitAt) {
    const occupant = getUnitAt(targetCol, targetRow);
    isAttack = !!occupant && occupant.civilizationId !== unit.civilizationId;
  }

  return { steps, turnMarkers, isAttack };
}

/**
 * Greedily simulate how far the unit travels each turn along `steps` and return
 * the tile where every turn ends, tagged with its 1-based turn number.
 *
 * Mirrors the engine's rules (`GameEngine.moveUnit` + `canUnitAffordMove`):
 * - Movement points are spent per-tile using `Pathfinding.getMovementCost`.
 * - A fresh unit (nothing done this turn, full movement) may always make its
 *   first move, even into terrain costing more than it has ("Minimum 1 Move");
 *   that move spends everything.
 * - When the remaining points run out, the next turn starts with `maxMoves`.
 *
 * Turn 1 = the first turn in which the unit moves (the current one when it has
 * moves left, otherwise the next one). Returns `[]` when the entire path fits
 * in a single turn.
 */
export function computeTurnMarkers(
  steps: Array<{ col: number; row: number }>,
  getTileAt: TileLookup,
  unitType: string,
  movesRemaining: number,
  maxMoves: number | undefined,
  hasMovedThisTurn: boolean
): TurnMarker[] {
  if (steps.length === 0) return [];

  const effectiveMax = typeof maxMoves === 'number' && maxMoves > 0
    ? maxMoves
    : Math.max(movesRemaining, 1);

  const costOf = (col: number, row: number): number => {
    const tile = getTileAt(col, row);
    return tile ? Pathfinding.getMovementCost(tile, unitType) : Infinity;
  };

  // Can the unit move at all during the current turn? If not, its first
  // movement turn is the next game turn, when it starts fresh with a full
  // allowance — still counted as turn 1 of the journey.
  const firstCost = costOf(steps[0].col, steps[0].row);
  if (!Number.isFinite(firstCost)) return [];

  let turn = 1;
  let remaining = movesRemaining;
  // A unit may use the Minimum-1-Move exception only when it has not acted yet
  // and still has its full allowance.
  let fresh = !hasMovedThisTurn && remaining >= effectiveMax;

  if (remaining <= EPSILON || (firstCost > remaining + EPSILON && !fresh)) {
    remaining = effectiveMax;
    fresh = true;
  }

  const markers: TurnMarker[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const cost = costOf(step.col, step.row);

    // Paths should never contain impassable tiles; bail defensively if one does.
    if (!Number.isFinite(cost)) return markers;

    if (cost <= remaining + EPSILON) {
      remaining -= cost;
    } else if (fresh) {
      // Civ1 Minimum-1-Move: forced move spends all remaining points.
      remaining = 0;
    } else {
      // The current turn ends at the previous step; a new turn starts with a
      // full allowance (the unit is fresh again).
      markers.push({ col: steps[i - 1].col, row: steps[i - 1].row, turn });
      turn += 1;
      remaining = effectiveMax;
      fresh = true;
      if (cost <= remaining + EPSILON) {
        remaining -= cost;
      } else {
        remaining = 0;
      }
    }

    fresh = false;
  }

  if (turn <= 1) return []; // Whole journey fits in a single turn

  const last = steps[steps.length - 1];
  markers.push({ col: last.col, row: last.row, turn });
  return markers;
}
