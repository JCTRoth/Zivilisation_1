import { describe, expect, it, afterEach } from 'vitest';
import { AIUtility } from '@/game/engine/AI/AIUtility';

/**
 * Civ1 exploration randomness — regression coverage for the weighted-random
 * frontier pick used by scouts / combat probes / forward pickets.
 */
describe('AI exploration randomness', () => {
  afterEach(() => {});

  it('pickRandomExplorationTarget always returns one of the candidates', () => {
    const unit = { col: 5, row: 5 };
    const candidates = [
      { col: 4, row: 5, dist: 1 },
      { col: 5, row: 4, dist: 1 },
      { col: 6, row: 6, dist: 1 },
      { col: 3, row: 5, dist: 2 },
    ];
    for (let i = 0; i < 40; i++) {
      const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, { dx: -1, dy: 0 });
      expect(pick).not.toBeNull();
      expect(candidates.some((c) => c.col === pick!.col && c.row === pick!.row)).toBe(true);
    }
  });

  it('pickRandomExplorationTarget returns the only candidate immediately', () => {
    const unit = { col: 5, row: 5 };
    const pick = AIUtility.pickRandomExplorationTarget(unit, [{ col: 9, row: 9, dist: 4 }], { dx: 1, dy: 1 });
    expect(pick).toEqual({ col: 9, row: 9, dist: 4 });
  });

  it('pickRandomExplorationTarget returns null for no candidates', () => {
    expect(AIUtility.pickRandomExplorationTarget({ col: 5, row: 5 }, [], { dx: 1, dy: 0 })).toBeNull();
  });

  it('pickRandomExplorationTarget never picks beyond the nearest frontier band (no teleport-targeting)', () => {
    const unit = { col: 5, row: 5 };
    // 8 tiles at distance 1 (the default band) plus 4 tiles at distance 2.
    const candidates = [
      { col: 6, row: 5, dist: 1 }, { col: 5, row: 6, dist: 1 }, { col: 4, row: 5, dist: 1 }, { col: 5, row: 4, dist: 1 },
      { col: 6, row: 6, dist: 1 }, { col: 4, row: 4, dist: 1 }, { col: 6, row: 4, dist: 1 }, { col: 4, row: 6, dist: 1 },
      { col: 7, row: 5, dist: 2 }, { col: 5, row: 7, dist: 2 }, { col: 3, row: 5, dist: 2 }, { col: 5, row: 3, dist: 2 },
    ];
    // Only the 8 nearest tiles compete; the distance-2 tiles have zero weight.
    for (let i = 0; i < 200; i++) {
      const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, null)!;
      expect(pick.dist).toBeLessThanOrEqual(1);
    }
  });

  it('a wider band lets farther tiles compete when explicitly requested', () => {
    const unit = { col: 5, row: 5 };
    const candidates = [
      { col: 6, row: 5, dist: 1 },
      { col: 7, row: 5, dist: 2 },
      { col: 9, row: 5, dist: 4 },
      { col: 15, row: 5, dist: 10 },
    ];
    const pickedFar = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const pick = AIUtility.pickRandomExplorationTarget(unit, candidates, { dx: 1, dy: 0 }, 4)!;
      pickedFar.add(`${pick.col},${pick.row}`);
    }
    // With band 4 every candidate competes, so even the farthest occasionally wins.
    expect(pickedFar.has('15,5')).toBe(true);
  });
});
