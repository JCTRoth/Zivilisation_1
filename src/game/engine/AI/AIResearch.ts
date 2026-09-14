/**
 * AIResearch - Technology research AI for civilizations
 * 
 * Responsible for all AI technology decisions:
 * - Selecting the next technology to research
 * - Scoring technologies based on personality, strategy, and game state
 * - Finding prerequisite chains to goal technologies
 * - Identifying goal technologies per strategy
 */

import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import {
  type StrategyProfile,
  type Personality,
  type TechCategory,
  TECH_CATEGORIES,
} from './AITypes';
import type { Civilization } from '../../../../types/game';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TechScoreResult {
  techId: string;
  score: number;
  reason: string;
}

interface GameStateSnapshot {
  currentYear: number;
  roundNumber: number;
  numCities: number;
  numEnemyCitiesKnown: number;
  isAtWar: boolean;
  hasLibrary: boolean;
  totalScience: number;
  /** True when at least one own city directly borders ocean/sea. */
  hasWaterAccess?: boolean;
}

// ---------------------------------------------------------------------------
// Strategy → tech category weight mapping
// ---------------------------------------------------------------------------

const STRATEGY_CATEGORY_WEIGHTS: Record<StrategyProfile, Partial<Record<TechCategory, number>>> = {
  military_expansion: {
    military: 2.8,
    economy: 1.0,
    science: 0.8,
    culture: 0.3,
    expansion: 1.2,
    infrastructure: 0.9,
    government: 1.2,
  },
  science_focus: {
    military: 0.5,
    economy: 1.5,
    science: 3.0,
    culture: 0.8,
    expansion: 0.8,
    infrastructure: 1.5,
    government: 1.5,
  },
  balanced_growth: {
    military: 1.2,
    economy: 1.5,
    science: 1.5,
    culture: 1.0,
    expansion: 1.5,
    infrastructure: 1.3,
    government: 1.2,
  },
  defensive_turtle: {
    military: 2.0,
    economy: 1.2,
    science: 1.0,
    culture: 1.5,
    expansion: 0.5,
    infrastructure: 2.0,
    government: 1.0,
  },
  wonder_rush: {
    military: 0.5,
    economy: 1.5,
    science: 2.0,
    culture: 2.5,
    expansion: 0.8,
    infrastructure: 1.5,
    government: 1.0,
  },
  early_expansion: {
    military: 1.0,
    economy: 1.5,
    science: 1.0,
    culture: 0.5,
    expansion: 3.0,
    infrastructure: 1.5,
    government: 1.0,
  },
};

// ---------------------------------------------------------------------------
// Goal technologies per strategy
// ---------------------------------------------------------------------------

const STRATEGY_GOAL_TECHS: Record<StrategyProfile, string[]> = {
  military_expansion: ['iron_working', 'horseback_riding', 'ceremonial_burial', 'gunpowder', 'metallurgy', 'combustion'],
  science_focus: ['writing', 'literacy', 'ceremonial_burial', 'university', 'science_theory', 'computers', 'space_flight'],
  balanced_growth: ['pottery', 'alphabet', 'ceremonial_burial','bronze_working', 'currency', 'construction', 'republic'],
  defensive_turtle: ['bronze_working', 'ceremonial_burial', 'masonry', 'construction', 'gunpowder', 'monarchy'],
  wonder_rush: ['masonry', 'ceremonial_burial', 'writing', 'philosophy', 'astronomy'],
  early_expansion: ['pottery', 'alphabet', 'the_wheel', 'horseback_riding', 'code_of_laws'],
};

// ---------------------------------------------------------------------------
// Key unlocks — specific high-value techs that unlock important capabilities
// ---------------------------------------------------------------------------

const KEY_UNLOCK_SCORES: Record<string, number> = {
  pottery: 15,          // Granary — critical for early growth
  writing: 12,          // Library + Diplomat
  bronze_working: 12,   // Phalanx + Barracks
  code_of_laws: 10,     // Courthouse + path to Monarchy
  monarchy: 14,         // Better government
  republic: 16,         // Best mid-game government
  currency: 10,         // Marketplace
  construction: 12,     // Aqueduct — required for city growth
  engineering: 10,      // Hospital — health/happiness for big cities
  iron_working: 10,     // Legion
  gunpowder: 14,        // Musketeer — major military leap
  masonry: 8,           // City Walls
  communism: 12,        // Best late government
  space_flight: 20,     // Victory path
  moonshot: 25,         // Victory condition
};

// ---------------------------------------------------------------------------
// AIResearch class
// ---------------------------------------------------------------------------

export class AIResearch {
  private static isNavalTech(techId: string): boolean {
    return techId === 'sailing' || techId === 'map_making';
  }

  private static isEarlyLandlocked(gameState: GameStateSnapshot): boolean {
    // Treat missing/unknown access as landlocked for this early-game gate.
    // Research should not assume naval infrastructure is useful without a
    // confirmed coastal city.
    return gameState.currentYear < -1000 && gameState.hasWaterAccess !== true;
  }

  /**
   * Select the best technology for an AI civilization to research.
   * 
   * @param civ - The civilization object
   * @param strategy - Current strategy profile
   * @param gameState - Snapshot of game state
   * @returns techId to research, or null if nothing available
   */
  static selectResearch(
    civ: Civilization,
    strategy: StrategyProfile,
    gameState: GameStateSnapshot
  ): string | null {
    const available = AIResearch.getAvailableTechnologies(civ);
    if (available.length === 0) return null;

    // Normalize the civ's optional personality traits to a full Personality
    // (defaulting any missing trait to 5) so scoring is always well-defined.
    const personality: Personality = {
      aggression: civ.personality?.aggression ?? 5,
      expansion: civ.personality?.expansion ?? 5,
      diplomacy: civ.personality?.diplomacy ?? 5,
      science: civ.personality?.science ?? 5,
      military: civ.personality?.military ?? 5,
      economy: civ.personality?.economy ?? 5,
    };

    const scored = available.map(techId => AIResearch.scoreTechnology(
      techId, personality, strategy, gameState
    ));

    // Never choose an early naval branch for a landlocked civilization while
    // another technology is available. The score penalty remains useful for
    // diagnostics and tie-breaking, while this filter makes the behaviour
    // deterministic even when all normal candidates score very low.
    const selectable = AIResearch.isEarlyLandlocked(gameState)
      ? scored.filter(result => !AIResearch.isNavalTech(result.techId))
      : scored;
    const candidates = selectable.length > 0 ? selectable : scored;

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (best) {
      console.log(`[AIResearch] Selected ${best.techId} (score: ${best.score.toFixed(1)}) — ${best.reason}`);
      return best.techId;
    }

    return null;
  }

  /**
   * Score a single technology for research priority.
   */
  static scoreTechnology(
    techId: string,
    personality: Personality,
    strategy: StrategyProfile,
    gameState: GameStateSnapshot
  ): TechScoreResult {
    let score = 10; // Base score
    const reasons: string[] = [];

    // 1. Category weight from strategy
    const category = TECH_CATEGORIES[techId];
    const categoryWeights = STRATEGY_CATEGORY_WEIGHTS[strategy] || {};
    if (category) {
      const categoryWeight = categoryWeights[category] ?? 1.0;
      score *= categoryWeight;
      if (categoryWeight > 1.5) reasons.push(`strategy-${category}`);
    }

    // 2. Personality modifier
    if (category) {
      const personalityMultiplier = AIResearch.getPersonalityModifier(category, personality);
      score *= personalityMultiplier;
    }

    // 3. Key unlock bonus
    const unlockBonus = KEY_UNLOCK_SCORES[techId] ?? 0;
    if (unlockBonus > 0) {
      score += unlockBonus;
      reasons.push('key-unlock');
    }

    // 4. Goal tech bonus — extra points if this tech is on the strategy's goal list
    const goalTechs = STRATEGY_GOAL_TECHS[strategy] || [];
    if (goalTechs.includes(techId)) {
      score += 8;
      reasons.push('goal-tech');
    }

    // 5. Cost efficiency — prefer cheaper techs early, expensive techs when rich
    const tech = TECHNOLOGIES_DATA.find(t => t.id === techId);
    const techCost = tech?.cost ?? 40;
    if (gameState.totalScience > 0) {
      const turnsToResearch = techCost / Math.max(1, gameState.totalScience);
      // Penalize very long research (>20 turns), bonus for quick (<5 turns)
      if (turnsToResearch > 20) {
        score -= 5;
        reasons.push('slow-research');
      } else if (turnsToResearch < 5) {
        score += 3;
        reasons.push('quick-research');
      }
    }

    // 6. Urgency modifiers based on game state
    if (gameState.isAtWar && (category === 'military' || category === 'infrastructure')) {
      score += 6;
      reasons.push('war-urgency');
    }

    if (gameState.numCities >= 3 && techId === 'construction') {
      score += 8;  // Need aqueducts for large cities
      reasons.push('aqueduct-need');
    }

    if (gameState.numCities < 2 && techId === 'pottery') {
      score += 6;  // Granary critical for first cities
      reasons.push('early-growth');
    }

    // Sailing and Map Making are dead-end investments for a landlocked
    // civilization in the early game. Do not let expansion/science weights
    // pull the AI into a naval branch before one of its cities touches water.
    if (AIResearch.isNavalTech(techId) && AIResearch.isEarlyLandlocked(gameState)) {
      score -= 100;
      reasons.push('no-coastal-city');
    }

    // 7. Era progression — slight bonus for advancing to new eras
    const prereqDepth = AIResearch.getPrereqDepth(techId);
    if (prereqDepth <= 1 && gameState.currentYear < -2000) {
      score += 3; // Early game: prefer foundational techs
    }

    return {
      techId,
      score: Math.max(0, score),
      reason: reasons.length > 0 ? reasons.join(', ') : 'base',
    };
  }

  /**
   * Get personality-based category modifier (0.5 to 1.5 range)
   */
  private static getPersonalityModifier(category: TechCategory, personality: Personality): number {
    const mapping: Partial<Record<TechCategory, keyof Personality>> = {
      military: 'military',
      economy: 'economy',
      science: 'science',
      culture: 'diplomacy',
      expansion: 'expansion',
      government: 'diplomacy',
      infrastructure: 'economy',
    };
    const trait = mapping[category];
    if (!trait) return 1.0;
    const value = personality[trait] ?? 5;
    // Scale 1-10 → 0.6-1.4
    return 0.6 + (value / 10) * 0.8;
  }

  /**
   * Get all technologies available for a civilization to research.
   * Handles both the engine's TECHNOLOGIES_DATA and the civ's technology list/set.
   */
  static getAvailableTechnologies(civ: Civilization): string[] {
    const available: string[] = [];
    const civTechs = civ.technologies;

    const hasTech = (techId: string): boolean => {
      if (civTechs instanceof Set) return civTechs.has(techId);
      if (Array.isArray(civTechs)) return civTechs.includes(techId);
      return false;
    };

    for (const tech of TECHNOLOGIES_DATA) {
      if (hasTech(tech.id)) continue;
      // NOTE: do NOT skip `tech.researched` here. The engine's shared tree
      // marks a tech "researched" when ANY civ completes it (union), but each
      // civilization researches independently in Civ1 — a tech another civ
      // already discovered is still a valid (and often the best) choice for
      // this civ. Skipping it here made the AI re-pick the same high-value
      // tech every turn while `setResearch` (which also read the union flag)
      // silently rejected it → permanent research freeze.

      // Check prerequisites
      const prereqs = tech.prerequisites ?? [];
      const allPrereqsMet = prereqs.every((prereq: string) => hasTech(prereq));
      if (!allPrereqsMet) continue;

      available.push(tech.id);
    }

    return available;
  }

  /**
   * Find the prerequisite chain to reach a goal technology.
   * Returns ordered list from first-to-research to goal.
   */
  static getResearchPath(goalTechId: string, civTechs: string[] | Set<string>): string[] {
    const hasTech = (techId: string): boolean => {
      if (civTechs instanceof Set) return civTechs.has(techId);
      if (Array.isArray(civTechs)) return civTechs.includes(techId);
      return false;
    };

    const techMap = new Map<string, { prerequisites: string[] }>();
    for (const tech of TECHNOLOGIES_DATA) {
      techMap.set(tech.id, { prerequisites: tech.prerequisites ?? [] });
    }

    // BFS backwards from goal to find all missing prerequisites
    const needed: string[] = [];
    const visited = new Set<string>();
    const queue = [goalTechId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (hasTech(current)) continue;

      needed.push(current);
      const techData = techMap.get(current);
      if (techData) {
        for (const prereq of techData.prerequisites) {
          if (!hasTech(prereq) && !visited.has(prereq)) {
            queue.push(prereq);
          }
        }
      }
    }

    // Reverse so prerequisites come first
    needed.reverse();
    return needed;
  }

  /**
   * Identify goal technologies based on current strategy.
   */
  static identifyGoalTechnologies(strategy: StrategyProfile): string[] {
    return STRATEGY_GOAL_TECHS[strategy] || STRATEGY_GOAL_TECHS.balanced_growth;
  }

  /**
   * Calculate prerequisite depth of a technology (how many techs deep in the tree)
   */
  private static getPrereqDepth(techId: string, depth: number = 0, visited: Set<string> = new Set()): number {
    if (visited.has(techId)) return depth;
    visited.add(techId);

    const tech = TECHNOLOGIES_DATA.find(t => t.id === techId);
    if (!tech || !tech.prerequisites || tech.prerequisites.length === 0) {
      return depth;
    }

    let maxDepth = depth;
    for (const prereq of tech.prerequisites) {
      const prereqDepth = AIResearch.getPrereqDepth(prereq, depth + 1, visited);
      if (prereqDepth > maxDepth) maxDepth = prereqDepth;
    }

    return maxDepth;
  }
}
