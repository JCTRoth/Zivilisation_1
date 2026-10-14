/**
 * Nuclear doctrine: what a warhead is worth, how big the arsenal should be,
 * and whether another one is affordable.
 *
 * Pure functions — the endgame equation pinned against hand-written scenarios
 * instead of a 600-round game.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreNuclearTarget,
  desiredNuclearArsenal,
  canAffordNuclear,
  NUCLEAR_CITY_VALUE,
} from '@/game/engine/AI/NuclearDoctrine';

describe('nuclear target scoring', () => {
  it('ranks a populous capital above an ordinary city', () => {
    const town = scoreNuclearTarget({ kind: 'city', col: 0, row: 0, weight: 3 });
    const capital = scoreNuclearTarget({ kind: 'city', col: 1, row: 1, weight: 3, bonus: 25 });
    expect(capital.hopeless).toBe(false);
    expect(capital.score).toBeGreaterThan(town.score);
  });

  it('values a city above a stack of the same weight', () => {
    const city = scoreNuclearTarget({ kind: 'city', col: 0, row: 0, weight: 4 });
    const stack = scoreNuclearTarget({ kind: 'stack', col: 1, row: 1, weight: 4 });
    // A weight-4 stack is below the worthwhile threshold (hopeless); the city
    // of the same weight is a valid, valuable strike.
    expect(stack.hopeless).toBe(true);
    expect(city.hopeless).toBe(false);
    expect(city.score).toBe(4 * NUCLEAR_CITY_VALUE);
  });

  it('calls an SDI-covered aim point hopeless, however juicy', () => {
    const shielded = scoreNuclearTarget({ kind: 'city', col: 0, row: 0, weight: 12, bonus: 25, sdiCovered: true });
    expect(shielded.hopeless).toBe(true);
    expect(shielded.score).toBe(-Infinity);
  });

  it('refuses a lone weak unit — a warhead is not worth one spearman', () => {
    expect(scoreNuclearTarget({ kind: 'stack', col: 0, row: 0, weight: 3 }).hopeless).toBe(true);
    expect(scoreNuclearTarget({ kind: 'stack', col: 0, row: 0, weight: 20 }).hopeless).toBe(false);
  });
});

describe('nuclear arsenal wants', () => {
  it('wants nothing with no targets, however late or rich', () => {
    expect(desiredNuclearArsenal({ stock: 0, valuableTargets: 0, overseasTargets: 0, subs: 0, year: 2000, gold: 9999 }))
      .toEqual({ wantNukes: 0, wantSubs: 0 });
  });

  it('wants one warhead for one target, no sub for a neighbour', () => {
    expect(desiredNuclearArsenal({ stock: 0, valuableTargets: 1, overseasTargets: 0, subs: 0, year: 1500, gold: 100 }))
      .toEqual({ wantNukes: 1, wantSubs: 0 });
  });

  it('wants delivery subs for overseas targets, capped by the stock', () => {
    const want = desiredNuclearArsenal({ stock: 0, valuableTargets: 5, overseasTargets: 4, subs: 0, year: 1950, gold: 1000 });
    expect(want.wantNukes).toBe(3);
    expect(want.wantSubs).toBe(2);
  });

  it('grows the stockpile in the endgame', () => {
    const early = desiredNuclearArsenal({ stock: 0, valuableTargets: 3, overseasTargets: 0, subs: 0, year: 1500, gold: 100 });
    const late = desiredNuclearArsenal({ stock: 0, valuableTargets: 3, overseasTargets: 0, subs: 0, year: 1950, gold: 100 });
    expect(late.wantNukes).toBeGreaterThan(early.wantNukes);
  });
});

describe('nuclear affordability', () => {
  it('needs a treasury above its reserve and a real target', () => {
    expect(canAffordNuclear(100, 50, 2)).toBe(true);
    expect(canAffordNuclear(40, 50, 2)).toBe(false);
    expect(canAffordNuclear(100, 50, 0)).toBe(false);
  });
});
