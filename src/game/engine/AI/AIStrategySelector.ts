/**
 * AIStrategySelector - Evaluates game state and selects overall AI strategy
 * 
 * Re-evaluates every N turns or on major events. The strategy profile
 * drives all other AI subsystems (research, production, movement).
 */

import {
  type StrategyProfile,
  type Personality,
  type AIState,
} from './AITypes';
import type { Civilization } from '../../../../types/game';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Re-evaluate strategy every N rounds (unless a major event triggers early) */
const REEVALUATION_INTERVAL = 10;

// ---------------------------------------------------------------------------
// AIStrategySelector class
// ---------------------------------------------------------------------------

export class AIStrategySelector {
  /**
   * Evaluate the current game state and return the best strategy profile
   * for the civilization.
   * 
   * @param civ - Civilization object
   * @param gameState - Relevant game state
   * @param aiState - Current AI state (for checking when last evaluated)
   * @param forceReevaluation - Force re-evaluation regardless of interval
   * @returns Updated strategy profile, or the existing one if not time to re-evaluate
   */
  static evaluateStrategy(
    civ: Civilization,
    gameState: {
      currentYear: number;
      roundNumber: number;
      numOwnCities: number;
      numEnemyCitiesKnown: number;
      numOwnMilitaryUnits: number;
      numOwnCivilianUnits: number;
      averageEnemyStrength: number;
      ownMilitaryStrength: number;
      numTechnologies: number;
      isAtWar: boolean;
      threatenedCitiesCount: number;
    },
    aiState: AIState,
    forceReevaluation: boolean = false
  ): StrategyProfile {
    // Check if we should re-evaluate
    const turnsSinceEval = gameState.roundNumber - aiState.lastStrategyEvaluation;
    if (!forceReevaluation && turnsSinceEval < REEVALUATION_INTERVAL) {
      return aiState.strategyProfile;
    }

    // Normalize the civ's optional personality traits to a full Personality
    // (defaulting any missing trait to 5) so strategy scoring is stable.
    const personality: Personality = {
      aggression: civ.personality?.aggression ?? 5,
      expansion: civ.personality?.expansion ?? 5,
      diplomacy: civ.personality?.diplomacy ?? 5,
      science: civ.personality?.science ?? 5,
      military: civ.personality?.military ?? 5,
      economy: civ.personality?.economy ?? 5,
    };

    // Score each strategy
    const scores = new Map<StrategyProfile, number>();

    scores.set('balanced_growth', AIStrategySelector.scoreBalancedGrowth(personality, gameState));
    scores.set('military_expansion', AIStrategySelector.scoreMilitaryExpansion(personality, gameState));
    scores.set('science_focus', AIStrategySelector.scoreScienceFocus(personality, gameState));
    scores.set('defensive_turtle', AIStrategySelector.scoreDefensiveTurtle(personality, gameState));
    scores.set('early_expansion', AIStrategySelector.scoreEarlyExpansion(personality, gameState));
    scores.set('wonder_rush', AIStrategySelector.scoreWonderRush(personality, gameState));

    // Pick highest scoring strategy
    let bestStrategy: StrategyProfile = 'balanced_growth';
    let bestScore = -Infinity;

    for (const [strategy, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    if (bestStrategy !== aiState.strategyProfile) {
      console.log(`[AIStrategySelector] ${civ.name}: Strategy changed from ${aiState.strategyProfile} -> ${bestStrategy} (score: ${bestScore.toFixed(1)})`);
    }

    return bestStrategy;
  }

  /**
   * Check if a major event warrants an early strategy re-evaluation.
   */
  static shouldForceReevaluation(event: string): boolean {
    const triggerEvents = new Set([
      'city_lost',
      'war_declared',
      'peace_made',
      'era_change',
      'wonder_completed',
      'enemy_border_approach',
    ]);
    return triggerEvents.has(event);
  }

  // ---------------------------------------------------------------------------
  // Strategy scoring methods
  // ---------------------------------------------------------------------------

  private static scoreBalancedGrowth(
    personality: Personality,
    gameState: { numOwnCities: number; currentYear: number; isAtWar: boolean; numTechnologies: number }
  ): number {
    let score = 50; // Strong baseline — the default safe choice

    // Good early game when building up
    if (gameState.numOwnCities <= 3) score += 10;
    if (gameState.currentYear < -2000) score += 8;

    // Personality: balanced personalities favor this
    const variance = Math.abs(personality.military - personality.science) +
                     Math.abs(personality.military - personality.economy);
    if (variance < 6) score += 8; // Low variance = balanced personality

    // Penalty if at war
    if (gameState.isAtWar) score -= 15;

    return score;
  }

  private static scoreMilitaryExpansion(
    personality: Personality,
    gameState: {
      numOwnCities: number;
      numEnemyCitiesKnown: number;
      ownMilitaryStrength: number;
      averageEnemyStrength: number;
      isAtWar: boolean;
      numOwnMilitaryUnits: number;
    }
  ): number {
    let score = 20;

    // Personality drives this
    score += personality.aggression * 3;
    score += personality.military * 2;

    // Good when we're strong relative to enemies
    if (gameState.ownMilitaryStrength > gameState.averageEnemyStrength * 1.5) {
      score += 15;
    }

    // Good when we know where enemies are
    if (gameState.numEnemyCitiesKnown > 0) score += 8;

    // Already at war? Commit to military
    if (gameState.isAtWar) score += 20;

    // Need enough units to project power
    if (gameState.numOwnMilitaryUnits < 3) score -= 10;

    return score;
  }

  private static scoreScienceFocus(
    personality: Personality,
    gameState: {
      numOwnCities: number;
      numTechnologies: number;
      currentYear: number;
      isAtWar: boolean;
      threatenedCitiesCount: number;
    }
  ): number {
    let score = 25;

    // Personality
    score += personality.science * 3;

    // Good mid-to-late game
    if (gameState.currentYear > -1000) score += 5;
    if (gameState.currentYear > 500) score += 8;

    // Need cities to generate science
    if (gameState.numOwnCities >= 3) score += 8;
    if (gameState.numOwnCities >= 5) score += 5;

    // Bad when under threat
    if (gameState.isAtWar) score -= 10;
    if (gameState.threatenedCitiesCount > 0) score -= 8;

    return score;
  }

  private static scoreDefensiveTurtle(
    personality: Personality,
    gameState: {
      threatenedCitiesCount: number;
      isAtWar: boolean;
      ownMilitaryStrength: number;
      averageEnemyStrength: number;
      numOwnCities: number;
    }
  ): number {
    let score = 15;

    // High when threatened
    if (gameState.threatenedCitiesCount > 0) score += 15;
    if (gameState.threatenedCitiesCount >= 2) score += 10;
    if (gameState.isAtWar) score += 12;

    // When weaker than enemies
    if (gameState.ownMilitaryStrength < gameState.averageEnemyStrength * 0.7) {
      score += 15;
    }

    // Personality: low aggression favors defense
    score += (10 - personality.aggression) * 1.5;

    // Don't turtle if we only have 1 city (need to expand)
    if (gameState.numOwnCities <= 1) score -= 10;

    return score;
  }

  private static scoreEarlyExpansion(
    personality: Personality,
    gameState: {
      numOwnCities: number;
      currentYear: number;
      isAtWar: boolean;
      numOwnCivilianUnits: number;
    }
  ): number {
    let score = 15;

    // Best in early game
    if (gameState.currentYear < -2000) score += 20;
    else if (gameState.currentYear < -1000) score += 10;
    else score -= 10; // Late game: expansion is less relevant

    // Good when few cities
    if (gameState.numOwnCities < 3) score += 15;
    if (gameState.numOwnCities < 2) score += 10;

    // Personality
    score += personality.expansion * 2;

    // Bad when at war
    if (gameState.isAtWar) score -= 15;

    return score;
  }

  private static scoreWonderRush(
    personality: Personality,
    gameState: {
      numOwnCities: number;
      currentYear: number;
      isAtWar: boolean;
      threatenedCitiesCount: number;
    }
  ): number {
    let score = 10;

    // Needs a strong economy base
    if (gameState.numOwnCities >= 3) score += 5;
    if (gameState.numOwnCities >= 5) score += 5;

    // Better in ancient/classical era when wonders are available
    if (gameState.currentYear < 0) score += 5;

    // Personality
    score += personality.economy * 1.5;
    score += personality.science * 1.0;

    // Very bad when at war or threatened
    if (gameState.isAtWar) score -= 20;
    if (gameState.threatenedCitiesCount > 0) score -= 15;

    return score;
  }
}
