/**
 * Tests for the hover movement preview: the turn-number markers and the
 * shortest-path preview used when a unit is selected.
 *
 * The marker simulation mirrors GameEngine.moveUnit + canUnitAffordMove, so
 * these tests also pin the Civ1 rules it depends on (per-tile cost, roads,
 * and the "Minimum 1 Move" exception for a fresh unit).
 */
import { describe, it, expect } from 'vitest';
import type { MapTile } from '@/game/engine/GameEngine';
import { computeMovementPreview, computeTurnMarkers, type TileLookup } from '@/utils/MovementPreview';

/** Build a minimal MapTile for a grid keyed by "col,row". */
function makeTile(col: number, row: number, type: string, extra: Partial<MapTile> = {}): MapTile {
  return {
    terrain: type,
    type,
    visible: true,
    explored: true,
    col,
    row,
    ...extra,
  };
}

/** Build a tile lookup from a sparse map of "col,row" -> tile. */
function lookup(tiles: Record<string, MapTile>): TileLookup {
  return (col: number, row: number): MapTile | null => tiles[`${col},${row}`] ?? null;
}

/** A straight line of tiles starting at (1,0). */
function line(count: number, factory: (col: number, row: number) => MapTile): {
  steps: Array<{ col: number; row: number }>;
  tiles: Record<string, MapTile>;
} {
  const steps: Array<{ col: number; row: number }> = [];
  const tiles: Record<string, MapTile> = {};
  for (let i = 1; i <= count; i++) {
    steps.push({ col: i, row: 0 });
    tiles[`${i},0`] = factory(i, 0);
  }
  return { steps, tiles };
}

describe('computeTurnMarkers', () => {
  it('returns no markers when the whole path fits in one turn', () => {
    const { steps, tiles } = line(2, (col, row) => makeTile(col, row, 'grassland'));
    expect(computeTurnMarkers(steps, lookup(tiles), 'warriors', 3, 3, false)).toEqual([]);
  });

  it('marks every turn-end tile for a multi-turn journey', () => {
    const { steps, tiles } = line(3, (col, row) => makeTile(col, row, 'grassland'));

    // 1 movement point per turn, 3 plain tiles -> 3 turns.
    expect(computeTurnMarkers(steps, lookup(tiles), 'warriors', 1, 1, false)).toEqual([
      { col: 1, row: 0, turn: 1 },
      { col: 2, row: 0, turn: 2 },
      { col: 3, row: 0, turn: 3 },
    ]);
  });

  it('travels further per turn when the tiles have roads', () => {
    // Roads cost 1/3 of a movement point, so 3 road tiles fit in a single turn.
    const { steps, tiles } = line(3, (col, row) => makeTile(col, row, 'grassland', { road: true }));
    expect(computeTurnMarkers(steps, lookup(tiles), 'warriors', 1, 1, false)).toEqual([]);
  });

  it('lets a fresh unit take one move into heavy terrain (Minimum 1 Move)', () => {
    const tiles: Record<string, MapTile> = {
      '1,0': makeTile(1, 0, 'mountains'), // cost 3, more than the unit has
      '2,0': makeTile(2, 0, 'grassland'),
    };
    const steps = [{ col: 1, row: 0 }, { col: 2, row: 0 }];

    expect(computeTurnMarkers(steps, lookup(tiles), 'warriors', 1, 1, false)).toEqual([
      { col: 1, row: 0, turn: 1 },
      { col: 2, row: 0, turn: 2 },
    ]);
  });

  it('waits for the next turn when the first tile is unaffordable', () => {
    // The unit already acted this turn (not fresh) and only has 1 point, but
    // every forest tile costs 2: it must wait, then travels 3 points per turn.
    const { steps, tiles } = line(3, (col, row) => makeTile(col, row, 'forest'));

    expect(computeTurnMarkers(steps, lookup(tiles), 'warriors', 1, 3, true)).toEqual([
      { col: 1, row: 0, turn: 1 },
      { col: 2, row: 0, turn: 2 },
      { col: 3, row: 0, turn: 3 },
    ]);
  });

  it('returns an empty list for an empty path', () => {
    expect(computeTurnMarkers([], lookup({}), 'warriors', 3, 3, false)).toEqual([]);
  });
});

describe('computeMovementPreview', () => {
  it('returns null when the target is the unit’s own tile', () => {
    const unit = { col: 0, row: 0, type: 'warriors', movesRemaining: 3, maxMoves: 3, hasMovedThisTurn: false };
    expect(computeMovementPreview(unit, 0, 0, lookup({}), 10, 10)).toBeNull();
  });

  it('returns null when no path exists (land unit targeting ocean)', () => {
    const unit = { col: 0, row: 0, type: 'warriors', movesRemaining: 3, maxMoves: 3, hasMovedThisTurn: false };
    const tiles: Record<string, MapTile> = {
      '0,0': makeTile(0, 0, 'grassland'),
      '1,0': makeTile(1, 0, 'ocean'),
    };
    expect(computeMovementPreview(unit, 1, 0, lookup(tiles), 10, 10)).toBeNull();
  });

  it('excludes the start tile and reports turn markers for a long path', () => {
    const unit = { col: 0, row: 0, type: 'warriors', movesRemaining: 1, maxMoves: 1, hasMovedThisTurn: false };
    const tiles: Record<string, MapTile> = { '0,0': makeTile(0, 0, 'grassland') };
    for (let col = 1; col <= 3; col++) tiles[`${col},0`] = makeTile(col, 0, 'grassland');

    const preview = computeMovementPreview(unit, 3, 0, lookup(tiles), 10, 10);

    expect(preview).not.toBeNull();
    expect(preview!.steps).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ]);
    expect(preview!.turnMarkers.map(m => m.turn)).toEqual([1, 2, 3]);
  });
});
