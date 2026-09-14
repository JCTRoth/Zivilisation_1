import { describe, it, expect } from 'vitest';
import { assessCityThreat, scoreEnemyTarget } from '@/game/engine/AI/AIStrategy';
import type { EnemyLocation } from '@/game/engine/EnemySearcher';

const makeLocation = (overrides: Partial<EnemyLocation> = {}): EnemyLocation => ({
  col: 5,
  row: 5,
  type: 'unit',
  id: 'loc-1',
  discoveredRound: 10,
  lastSeenRound: 10,
  ...overrides
});

describe('AIStrategy.scoreEnemyTarget', () => {
  it('should prioritize cities over units at same distance', () => {
    const currentRound = 12;
    const cityScore = scoreEnemyTarget({
      location: makeLocation({ type: 'city' }),
      distance: 3,
      currentRound
    });

    const unitScore = scoreEnemyTarget({
      location: makeLocation({ type: 'unit' }),
      distance: 3,
      currentRound
    });

    expect(cityScore.score).toBeGreaterThan(unitScore.score);
  });

  it('should heavily penalize stale targets', () => {
    const fresh = scoreEnemyTarget({
      location: makeLocation({ lastSeenRound: 15 }),
      distance: 4,
      currentRound: 16
    });
    const stale = scoreEnemyTarget({
      location: makeLocation({ lastSeenRound: 1 }),
      distance: 4,
      currentRound: 30
    });

    expect(fresh.score).toBeGreaterThan(stale.score);
  });
});

describe('AIStrategy.assessCityThreat', () => {
  it('should flag cities that have higher enemy pressure than garrison strength', () => {
    const assessment = assessCityThreat({
      city: { id: 'city-1', col: 0, row: 0 },
      samples: [
        { distance: 1, strength: 3, type: 'unit' },
        { distance: 2, strength: 4, type: 'city' }
      ],
      garrisonStrength: 1
    });

    expect(assessment.needsDefense).toBe(true);
    expect(assessment.netThreat).toBeGreaterThan(0);
  });

  it('should consider strong garrisons safe', () => {
    const assessment = assessCityThreat({
      city: { id: 'city-1', col: 0, row: 0 },
      samples: [
        { distance: 2, strength: 2, type: 'unit' }
      ],
      garrisonStrength: 5
    });

    expect(assessment.needsDefense).toBe(false);
    expect(assessment.netThreat).toBeLessThan(0);
  });
});
