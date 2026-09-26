/**
 * The AI must open the naval branch on a world split by water.
 *
 * A 120-round AI-vs-AI game on the naval archipelago produced 0 ships, 0
 * ferries, 0 invasions and 0 wars, and the cause was not the invasion code: no
 * civ ever researched Sailing. It had no key-unlock score at all, and the
 * early-game "landlocked" filter locked naval techs out until a coastal city
 * existed — by which time the AI had already committed to something else.
 */
import { describe, it, expect } from 'vitest';
import { AIResearch } from '@/game/engine/AI/AIResearch';

const personality = {
  aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
};

const gameState = (over: Record<string, unknown> = {}) => ({
  currentYear: -3000,
  roundNumber: 10,
  numCities: 2,
  numOwnCities: 2,
  totalPopulation: 4,
  numMilitaryUnits: 1,
  numOwnMilitaryUnits: 1,
  numOwnCivilianUnits: 1,
  averageEnemyStrength: 0,
  ownMilitaryStrength: 2,
  numTechnologies: 3,
  isAtWar: false,
  knownEnemyCities: 0,
  numEnemyCitiesKnown: 0,
  threatenedCitiesCount: 0,
  criticalThreatsCount: 0,
  hasLibrary: false,
  totalScience: 1,
  hasWaterAccess: false,
  ...over,
});

const score = (tech: string, state: Record<string, unknown>) =>
  AIResearch.scoreTechnology(tech, personality as never, 'balanced_growth' as never, state as never);

describe('naval research priority', () => {
  it('rates Sailing as a top pick for a civ that starts on an island', () => {
    const naval = score('sailing', gameState({ startsOnIsland: true, navalRelevance: 2 }));
    const land = score('pottery', gameState({ navalRelevance: 0 }));
    expect(naval.score).toBeGreaterThan(land.score);
    expect(naval.reason).toContain('naval-relevance');
  });

  it('rates Sailing as urgent when an enemy city is known across water', () => {
    // navalRelevance 5 = split world + enemy off-shore.
    const naval = score('sailing', gameState({ startsOnIsland: true, navalRelevance: 5 }));
    const plain = score('sailing', gameState({ navalRelevance: 0 }));
    expect(naval.score).toBeGreaterThan(plain.score);
  });

  it('leaves Sailing alone on a one-continent land map', () => {
    const sailing = score('sailing', gameState({ navalRelevance: 0, hasWaterAccess: true }));
    expect(sailing.reason).not.toContain('naval-relevance');
  });

  it('still refuses Sailing for a landlocked civ with no island start', () => {
    const sailing = score('sailing', gameState({ currentYear: -3500, hasWaterAccess: false, navalRelevance: 0 }));
    expect(sailing.score).toBe(0);
    expect(sailing.reason).toContain('no-coastal-city');
  });

  it('an island civ is never treated as landlocked', () => {
    // No coastal city yet (turn 1), but the start tile was on an island, so the
    // naval branch must be selectable.
    const civ: never = { technologies: [], personality: {} } as never;
    const chosen = AIResearch.selectResearch(
      civ,
      'science_focus' as never,
      gameState({ startsOnIsland: true, navalRelevance: 2 }) as never,
    );
    expect(chosen).toBe('sailing');
  });
});
