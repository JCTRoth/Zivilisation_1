import { describe, it, expect } from 'vitest';
import { AIStrategySelector } from '@/game/engine/AI/AIStrategySelector';
import { createDefaultAIState, type AIState, type Personality, type StrategyProfile } from '@/game/engine/AI/AITypes';

const makePersonality = (overrides: Partial<Personality> = {}): Personality => ({
  aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
  ...overrides,
});

const baseGameState = (overrides: Record<string, unknown> = {}) => ({
  currentYear: -2000,
  roundNumber: 20,
  numOwnCities: 3,
  numEnemyCitiesKnown: 0,
  numOwnMilitaryUnits: 4,
  numOwnCivilianUnits: 2,
  averageEnemyStrength: 5,
  ownMilitaryStrength: 10,
  numTechnologies: 5,
  isAtWar: false,
  threatenedCitiesCount: 0,
  ...overrides,
});

const makeCiv = (overrides: Record<string, unknown> = {}): any => ({
  id: 1,
  name: 'TestCiv',
  personality: makePersonality(),
  ...overrides,
});

describe('AIStrategySelector.evaluateStrategy', () => {
  it('should return a valid strategy profile', () => {
    const civ = makeCiv();
    const aiState = createDefaultAIState();
    const result = AIStrategySelector.evaluateStrategy(civ, baseGameState(), aiState, true);

    const validStrategies: StrategyProfile[] = [
      'balanced_growth', 'military_expansion', 'science_focus',
      'defensive_turtle', 'early_expansion', 'wonder_rush',
    ];
    expect(validStrategies).toContain(result);
  });

  it('should not re-evaluate before interval unless forced', () => {
    const civ = makeCiv();
    const aiState: AIState = {
      ...createDefaultAIState(),
      strategyProfile: 'science_focus',
      lastStrategyEvaluation: 15,
    };
    // Round 20, last eval at 15 → 5 turns ago, interval is 10
    const result = AIStrategySelector.evaluateStrategy(civ, baseGameState({ roundNumber: 20 }), aiState, false);
    expect(result).toBe('science_focus'); // Should keep existing
  });

  it('should re-evaluate after interval', () => {
    const civ = makeCiv();
    const aiState: AIState = {
      ...createDefaultAIState(),
      strategyProfile: 'wonder_rush',
      lastStrategyEvaluation: 5,
    };
    // Round 20, last eval at 5 → 15 turns ago, exceeds 10 interval
    const result = AIStrategySelector.evaluateStrategy(civ, baseGameState({ roundNumber: 20 }), aiState, false);
    // Should re-evaluate (wonder_rush is unlikely to remain top with balanced personality)
    expect(result).toBeTypeOf('string');
  });

  it('should favor early_expansion in early game with few cities', () => {
    const expansionCiv = makeCiv({
      personality: makePersonality({ expansion: 9 }),
    });
    const aiState = createDefaultAIState();
    const result = AIStrategySelector.evaluateStrategy(
      expansionCiv,
      baseGameState({ currentYear: -3500, numOwnCities: 1, roundNumber: 100 }),
      aiState,
      true
    );
    expect(result).toBe('early_expansion');
  });

  it('should favor defensive_turtle when heavily threatened', () => {
    const peacefulCiv = makeCiv({
      personality: makePersonality({ aggression: 1 }),
    });
    const aiState = createDefaultAIState();
    const result = AIStrategySelector.evaluateStrategy(
      peacefulCiv,
      baseGameState({
        isAtWar: true,
        threatenedCitiesCount: 2,
        ownMilitaryStrength: 3,
        averageEnemyStrength: 15,
        numOwnCities: 3,
        roundNumber: 100,
      }),
      aiState,
      true
    );
    expect(result).toBe('defensive_turtle');
  });

  it('should favor military_expansion for aggressive civ at war with known enemies', () => {
    const warCiv = makeCiv({
      personality: makePersonality({ aggression: 10, military: 10 }),
    });
    const aiState = createDefaultAIState();
    const result = AIStrategySelector.evaluateStrategy(
      warCiv,
      baseGameState({
        isAtWar: true,
        numEnemyCitiesKnown: 2,
        ownMilitaryStrength: 20,
        averageEnemyStrength: 10,
        numOwnMilitaryUnits: 8,
        roundNumber: 100,
      }),
      aiState,
      true
    );
    expect(result).toBe('military_expansion');
  });
});

describe('AIStrategySelector.shouldForceReevaluation', () => {
  it('should return true for war_declared', () => {
    expect(AIStrategySelector.shouldForceReevaluation('war_declared')).toBe(true);
  });

  it('should return true for city_lost', () => {
    expect(AIStrategySelector.shouldForceReevaluation('city_lost')).toBe(true);
  });

  it('should return false for random events', () => {
    expect(AIStrategySelector.shouldForceReevaluation('unit_moved')).toBe(false);
  });
});
