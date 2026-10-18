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
  /**
   * How much a fleet is worth to this civ right now (0 on an ordinary land
   * map): >0 when the world has more than one landmass and we border water,
   * higher again when we know an enemy city sits on another landmass. On a
   * naval map this is the difference between Sailing being researched in the
   * first few turns and never being researched at all.
   */
  navalRelevance?: number;
  /** True when the civ's start tile was on an island (known from turn one). */
  startsOnIsland?: boolean;
  /**
   * 0 = no island expansion pending; 1 = colonisable islands visible and the
   * civ lacks Sailing; 2 = the same while holding 1-2 cities (expansion is
   * blocked until it sails — the stranded-equivalent urgency). Computed by
   * AIManager from the island probe + tech, so a 1-city archipelago civ cannot
   * research Alphabet for a century while 10 islands wait offshore (seed-19:
   * 60 rounds, 10 known islands, Sailing never picked).
   */
  islandExpansionUrgency?: number;
  /**
   * How much a Fisher Boat would be worth to this civ right now (0 when no
   * coastal city has a worthwhile fishing ground). The Harbor that unlocks it
   * needs Masonry, so a fishing civ researches Masonry instead of never
   * getting the boat the economics asked for.
   */
  fishingRelevance?: number;
  /**
   * 0 = no nuclear interest; 1 = wartime fission interest; 2 = late endgame
   * interest; 3 = Manhattan stands and the civ still lacks Fission (race to
   * arm). Drives the Fission tip and the Nuclear Power chain root the way
   * island urgency drives Sailing.
   */
  nuclearRelevance?: number;
  /**
   * 0 = nothing to strike or too early; up to 4 when hostile cities are known
   * late enough that the combustion→flight chain can pay. Mirrors
   * `AIManager.buildGameStateSnapshot`'s air interest — the naval branch got a
   * relevance signal first and the naval audit showed the ONE signal decides
   * whether the branch is ever opened.
   */
  airRelevance?: number;
  /**
   * Real turns to finish one technology, as the engine would charge them.
   *
   * Supplied by AIManager from `ResearchManager.estimatedTurns`, so the scorer
   * sees the EFFECTIVE cost (map size × difficulty × tech-count gap) and the
   * post-modifier beakers instead of the raw table cost. Scoring cost
   * efficiency against `TECHNOLOGIES_DATA.cost / totalScience` understated every
   * tech by the map-size factor (×2 on a 40×40 map) plus the known-civ and
   * prerequisite penalties: a moonshot the AI scored as 20 turns away actually
   * took 38, and its "slow research" penalty never fired for it.
   */
  turnsToResearch?: (techId: string) => number;
  /**
   * How worthwhile the Caravan line is to this civ right now (0 when every city
   * already has routes, up to 3 for a route-less empire at peace). Without it the
   * AI never researched `trade` and delivered zero trade routes in 1,000 rounds.
   */
  caravanRelevance?: number;
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
  /**
   * How much a tech is worth for the sake of a better HULL.
   *
   * Ordered by what each rung unlocks: `map_making` → trireme, `navigation` →
   * caravel and frigate, `steel` → ironclad and battleship, `combustion` →
   * destroyer, cruiser and submarine, `flight` → carrier. The middle of the
   * ladder carries the most weight because that is where the fleet stops being
   * one boat and becomes a fleet.
   */
  /**
   * How much a tech is worth for the AIR arm.
   *
   * The chain flight needs is long (alphabet→writing→...→electricity→the_wheel
   * →mathematics→engineering→combustion→flight, ~1135 beakers): the middle
   * rungs already compete under other weights, so the LADDER weights the
   * defence-expensive rungs. `combustion` is where the air and naval hulls
   * cross (destroyer/cruiser/submarine AND the flight prerequisite), so its
   * weight stacks with the naval ladder on purpose. `flight` carries the most
   * — it is the rung that makes ANY of this usable, and the ladder exists
   * because the audit found no civ ever reached it otherwise.
   */
  // The WHOLE chain, not just the tip: flight needs combustion, which needs
  // electricity + engineering; engineering needs mathematics; mathematics needs
  // the_wheel. Pushing only the tip meant the civ researched the rungs in
  // between only when some other priority asked for them, so Flight arrived
  // (if at all) dozens of rounds after the ladder intended. Pushing the chain
  // root is what makes the tech arrive at all — same shape as the caravan
  // relevance push (trade → currency → bronze_working).
  private static readonly AIR_LADDER: Readonly<Record<string, number>> = {
    the_wheel: 3,
    mathematics: 4,
    engineering: 6,
    science_theory: 5,
    electricity: 6,
    combustion: 10,
    flight: 16,
  };

  private static readonly NAVY_HULL_LADDER: Readonly<Record<string, number>> = {
    map_making: 6,
    navigation: 14,
    steel: 10,
    combustion: 14,
    flight: 6,
  };

  private static isNavalTech(techId: string): boolean {
    return techId === 'sailing' || techId === 'map_making';
  }

  private static isEarlyLandlocked(gameState: GameStateSnapshot): boolean {
    // A civ that starts on an island is not landlocked, whatever its cities
    // look like right now: the open water is on its doorstep from turn one.
    // Judging only by "has a coastal city yet" meant the whole naval branch
    // stayed locked until a city existed — and on the archipelago the AI had
    // already picked its next research by then, so Sailing never came up.
    if (gameState.startsOnIsland === true) return false;
    // Island expansion pending means the same: the civ SEES somewhere to sail.
    if ((gameState.islandExpansionUrgency ?? 0) > 0) return false;
    // Otherwise treat missing/unknown access as landlocked for this gate.
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
    // The turn count comes from the engine's own research model when the caller
    // supplies it (see `turnsToResearch`): the raw table cost is not what the
    // civ will actually pay, and the beakers that arrive are not
    // `totalScience` either. The fallback keeps lightweight test doubles
    // working.
    if (gameState.totalScience > 0 || gameState.turnsToResearch) {
      const turnsToResearch = gameState.turnsToResearch
        ? gameState.turnsToResearch(techId)
        : (TECHNOLOGIES_DATA.find(t => t.id === techId)?.cost ?? 40)
          / Math.max(1, gameState.totalScience);
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

    // …and the mirror image: when the world is split by water, Sailing is not
    // a dead end, it is the only way to reach anybody. An AI-vs-AI naval game
    // where nobody picks Sailing never fields a ship, so it never colonises,
    // invades or even goes to war — 120 rounds produced 0 ferries and 0 attacks
    // on the archipelago because Sailing had no key-unlock score at all.
    const naval = gameState.navalRelevance ?? 0;
    if (naval > 0 && techId === 'sailing') {
      score += 18 + 4 * naval;
      reasons.push('naval-relevance');
      // A civ that BEGAN on an island is stranded until it has a boat: it
      // cannot settle a second city, reach an enemy, or touch another landmass.
      // That makes Sailing a prerequisite rather than one candidate among many,
      // so it has to outrank the whole category-weighted field — otherwise a
      // science_focus civ happily researches Alphabet for a century and never
      // sails.
      if (gameState.startsOnIsland === true) {
        score += 40;
        reasons.push('stranded-must-sail');
      }
      // Island expansion pending: the civ SEES islands it cannot reach without
      // Sailing. A 1-2 city civ with 10 known islands is as stranded as an
      // island start — Sailing is its expansion tech, not one option among many.
      const islandUrgency = gameState.islandExpansionUrgency ?? 0;
      if (islandUrgency > 0) {
        score += 30 * islandUrgency;
        reasons.push('island-expansion');
      }
    }
    if (naval > 0 && techId === 'map_making') {
      score += 6 + 2 * naval;
      reasons.push('naval-relevance');
    }

    // The HULL LADDER. Sailing earns a boat; it takes Map Making, Navigation,
    // Steel and Combustion before a civ has a fleet that can actually fight.
    // Without this the research policy stopped at Sailing and every civ in the
    // benchmark finished with the same single hull type — a four-seed run built
    // 28 ferries and not one warship, because `warshipOptions` never held more
    // than `sail`. Variety is a RESEARCH outcome before it is a production one:
    // the fleet can only vary across hulls the civ can build.
    //
    // Keyed on the tech alone, not on what the civ knows: candidates are already
    // prerequisite-filtered, so `navigation` only appears once the civ can take
    // it. The bonus scales with naval relevance so a land empire at sea goes up
    // the ladder faster than one that merely has a coast.
    if (naval > 0) {
      const ladder = AIResearch.NAVY_HULL_LADDER[techId];
      if (ladder) {
        score += ladder * (1 + naval * 0.5);
        reasons.push('naval-hull-ladder');
      }
    }

    // The AIR ladder, gated the same way: interest on the snapshot, weight per
    // rung, stacking with the naval ladder where both branches need the tech
    // (combustion). Without this the air branch never opens — see the ladder
    // comment for the audit numbers.
    const air = gameState.airRelevance ?? 0;
    if (air > 0) {
      const ladder = AIResearch.AIR_LADDER[techId];
      if (ladder) {
        score += ladder * (1 + air * 0.25);
        reasons.push('air-ladder');
      }
    }

    // Fishing: the Harbor (and through it the Fisher Boat) needs Masonry. A
    // coastal civ whose fishing grounds repay the boat should research it
    // promptly, otherwise the AI never unlocked the feature at all. A clearly
    // worthwhile ground (relevance 2) gets the same decisive push the stranded
    // island civ gets for Sailing — the food equation already proved the boat
    // pays for itself.
    const fishing = gameState.fishingRelevance ?? 0;
    if (fishing > 0 && techId === 'masonry') {
      score += 40 + 20 * fishing;
      reasons.push('fishing-harbor');
    }

    // Caravans: the `trade` tech gates the whole trade-route economy, and without
    // a push the AI never researched it — a profiled 1,000-round game delivered
    // ZERO trade routes while every city sat three routes short of capacity. Same
    // shape as the Masonry push: the prerequisite of a feature the civ can use.
    //
    // The WHOLE CHAIN, not just the tip: `trade` needs `currency`, which needs
    // `bronze_working`, so a civ without Bronze Working would research the branch
    // tip last — after every other priority had been served. Pushing the chain
    // root is what makes the tech arrive at all; the tip's push then keeps it
    // from being skipped once it is reachable.
    const caravan = gameState.caravanRelevance ?? 0;
    if (caravan > 0 && techId === 'trade') {
      score += 30 + 15 * caravan;
      reasons.push('caravan-relevance');
    }
    if (caravan > 0 && techId === 'currency') {
      score += 25 + 12 * caravan;
      reasons.push('caravan-relevance');
    }
    if (caravan > 0 && techId === 'bronze_working') {
      score += 20 + 10 * caravan;
      reasons.push('caravan-relevance');
    }

    // Nuclear endgame: Fission is the tip of the endgame arm (warheads need
    // it, Manhattan needs it), Nuclear Power is the chain root. Without a
    // push the AI researches the atomic age never — a 634-round game reached
    // 2085 with 31 techs and zero warheads. Same shape as the caravan chain:
    // push the root so the branch arrives, push the tip so it is not skipped.
    const nuclear = gameState.nuclearRelevance ?? 0;
    if (nuclear > 0 && techId === 'nuclear_fission') {
      score += 35 + 15 * nuclear;
      reasons.push('nuclear-endgame');
    }
    if (nuclear > 0 && techId === 'nuclear_power') {
      score += 20 + 10 * nuclear;
      reasons.push('nuclear-chain');
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
