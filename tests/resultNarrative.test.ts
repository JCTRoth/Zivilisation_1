import { describe, expect, it } from 'vitest';
import {
  TEAM_VICTORY_LEDE_KEYS,
  teamVictoryLedeKey,
} from '@/utils/resultNarrative';

describe('team victory lede variants', () => {
  it('there are exactly three epic versions', () => {
    expect(TEAM_VICTORY_LEDE_KEYS).toHaveLength(3);
    expect(new Set(TEAM_VICTORY_LEDE_KEYS).size).toBe(3);
  });

  it('the same result always tells the same story', () => {
    // A re-render must not flip the text under the player.
    expect(teamVictoryLedeKey(1770000000000)).toBe(teamVictoryLedeKey(1770000000000));
    expect(teamVictoryLedeKey(undefined)).toBe(teamVictoryLedeKey(null));
    expect(teamVictoryLedeKey(-3)).toBe(teamVictoryLedeKey(-3));
  });

  it('different results spread across all three versions', () => {
    const picks = new Set(
      [0, 1, 2, 3, 4, 5, 100, 1770000000001, 1770000000002].map(teamVictoryLedeKey),
    );
    expect(picks.size).toBe(3);
  });

  it('never picks a key outside the three', () => {
    for (let seed = -20; seed < 50; seed++) {
      expect(TEAM_VICTORY_LEDE_KEYS).toContain(teamVictoryLedeKey(seed));
    }
  });
});
