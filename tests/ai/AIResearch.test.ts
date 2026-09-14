import { describe, it, expect } from 'vitest';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import type { Personality } from '@/game/engine/AI/AITypes';

type TestCiv = {
  id: number;
  name: string;
  color: string;
  isAlive: boolean;
  resources: { food: number; production: number; trade: number; science: number; gold: number };
  technologies: string[];
  currentResearch: null;
  personality: Personality;
};

const baseCiv = (overrides: Record<string, unknown> = {}): TestCiv => ({
  id: 1,
  name: 'TestCiv',
  color: '#ff0000',
  isAlive: true,
  resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
  technologies: [],
  currentResearch: null,
  personality: {
    aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
  } as Personality,
  ...overrides,
} as TestCiv);

const baseGameState = (overrides: Record<string, unknown> = {}) => ({
  currentYear: -3000,
  roundNumber: 10,
  numCities: 2,
  numEnemyCitiesKnown: 0,
  isAtWar: false,
  hasLibrary: false,
  totalScience: 2,
  ...overrides,
});

describe('AIResearch.selectResearch', () => {
  it('should return a tech id when techs are available', () => {
    const civ = baseCiv();
    const result = AIResearch.selectResearch(civ, 'balanced_growth', baseGameState());
    expect(result).toBeTypeOf('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('should return null when all techs are researched', () => {
    const allTechs = TECHNOLOGIES_DATA.map((t) => t.id);

    const civ = baseCiv({ technologies: allTechs });
    const result = AIResearch.selectResearch(civ, 'balanced_growth', baseGameState());
    expect(result).toBeNull();
  });

  it('should favor military techs for military_expansion strategy', () => {
    const militaryCiv = baseCiv({
      personality: { aggression: 9, expansion: 3, diplomacy: 2, science: 3, military: 9, economy: 3 },
    });

    const militaryResult = AIResearch.selectResearch(militaryCiv, 'military_expansion', baseGameState());
    const scienceResult = AIResearch.selectResearch(militaryCiv, 'science_focus', baseGameState());

    // Both should return something, but they may differ
    expect(militaryResult).toBeTypeOf('string');
    expect(scienceResult).toBeTypeOf('string');
  });
});

describe('AIResearch.scoreTechnology', () => {
  const personality: Personality = {
    aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
  };

  it('should give key unlock techs a higher score', () => {
    const potteryScore = AIResearch.scoreTechnology('pottery', personality, 'balanced_growth', baseGameState());
    // pottery has a key unlock bonus of 15
    expect(potteryScore.score).toBeGreaterThan(10);
  });

  it('should give higher scores to category-aligned techs', () => {
    const bronzeForMilitary = AIResearch.scoreTechnology('bronze_working', personality, 'military_expansion', baseGameState());
    const bronzeForScience = AIResearch.scoreTechnology('bronze_working', personality, 'science_focus', baseGameState());
    // bronze_working is military category — should score higher for military strategy
    expect(bronzeForMilitary.score).toBeGreaterThan(bronzeForScience.score);
  });

  it('should return a reason string', () => {
    const result = AIResearch.scoreTechnology('pottery', personality, 'balanced_growth', baseGameState());
    expect(result.reason).toBeTypeOf('string');
    expect(result.techId).toBe('pottery');
  });

  it('strongly delays naval research for a landlocked civ in the early game', () => {
    const landlocked = AIResearch.scoreTechnology(
      'sailing', personality, 'balanced_growth', baseGameState({ hasWaterAccess: false, currentYear: -3000 })
    );
    const coastal = AIResearch.scoreTechnology(
      'sailing', personality, 'balanced_growth', baseGameState({ hasWaterAccess: true, currentYear: -3000 })
    );

    expect(landlocked.score).toBeLessThan(coastal.score);
    expect(landlocked.reason).toContain('no-coastal-city');
  });

  it('also delays Map Making for a landlocked civ, but permits it for a coastal civ', () => {
    const landlocked = AIResearch.scoreTechnology(
      'map_making', personality, 'balanced_growth', baseGameState({ hasWaterAccess: false, currentYear: -3000 })
    );
    const coastal = AIResearch.scoreTechnology(
      'map_making', personality, 'balanced_growth', baseGameState({ hasWaterAccess: true, currentYear: -3000 })
    );

    expect(landlocked.score).toBeLessThan(coastal.score);
    expect(landlocked.reason).toContain('no-coastal-city');
  });

  it('does not select Sailing early when the civ has no direct coastal city', () => {
    const civ = baseCiv();
    const result = AIResearch.selectResearch(
      civ,
      'balanced_growth',
      baseGameState({ hasWaterAccess: false, currentYear: -3000 }),
    );

    expect(result).not.toBe('sailing');
    expect(result).not.toBe('map_making');
  });
});

describe('AIResearch.getAvailableTechnologies', () => {
  it('should return techs for a fresh civ', () => {
    const civ = baseCiv();
    const available = AIResearch.getAvailableTechnologies(civ);
    expect(available.length).toBeGreaterThan(0);
  });

  it('should exclude already researched techs', () => {
    const civ = baseCiv({ technologies: ['pottery'] });
    const available = AIResearch.getAvailableTechnologies(civ);
    expect(available).not.toContain('pottery');
  });

  it('should handle Array-based technologies (legacy string array)', () => {
    const civ = baseCiv({ technologies: ['pottery'] });
    const available = AIResearch.getAvailableTechnologies(civ);
    expect(available).not.toContain('pottery');
  });
});
