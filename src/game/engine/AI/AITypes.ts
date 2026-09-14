/**
 * AITypes - Shared type definitions for the AI system
 * 
 * Provides typed interfaces to replace `any` across AI modules,
 * shared state types for cross-module communication, and
 * strategy/coordination types.
 */

// ---------------------------------------------------------------------------
// Strategy profiles
// ---------------------------------------------------------------------------

/** High-level strategy the AI is pursuing this evaluation period */
export type StrategyProfile =
  | 'military_expansion'
  | 'science_focus'
  | 'balanced_growth'
  | 'defensive_turtle'
  | 'wonder_rush'
  | 'early_expansion';

// ---------------------------------------------------------------------------
// Personality (mirrors Civilization.ts but typed for AI consumption)
// ---------------------------------------------------------------------------

export interface Personality {
  aggression: number;   // 1-10
  expansion: number;    // 1-10
  diplomacy: number;    // 1-10
  science: number;      // 1-10
  military: number;     // 1-10
  economy: number;      // 1-10
}

// ---------------------------------------------------------------------------
// AI State — stored in PlayerTurnStorage.turnData (replacing Record<string,any>)
// ---------------------------------------------------------------------------

interface OffensivePlan {
  target: { col: number; row: number };
  targetType: 'city' | 'unit';
  score: number;
  requiredUnits: number;
  assignedUnitIds: string[];
  roundPrepared: number;
  /** Estimated defensive strength of the target (used to withdraw when it grows too strong). */
  targetDefense?: number;
  /** Owner of the target city (used to declare the rush war). */
  targetCivId?: number;
}

/** Situational aggression state, refreshed a few times per turn. */
export interface AggressionState {
  /** 0-100 situational aggression score. */
  score: number;
  posture: 'defensive' | 'aggressive';
  /** Human-readable reasons that pushed the score up or down. */
  reasons: string[];
  lastEvaluation: number;
}

export interface ArmyGroup {
  id: string;
  unitIds: string[];
  targetLocation: { col: number; row: number };
  rallyPoint: { col: number; row: number };
  status: 'forming' | 'marching' | 'attacking';
  requiredStrength: number;
  currentStrength: number;
}

export interface BuildingPlan {
  buildingType: string;
  priority: number;
  reason: string;
}

interface ResearchPriority {
  techId: string;
  score: number;
  reason: string;
}

export interface AIState {
  /** Current overall strategy profile */
  strategyProfile: StrategyProfile;
  /** Round when strategy was last evaluated */
  lastStrategyEvaluation: number;
  /** Offensive plans (up to 2 concurrent fronts) */
  offensivePlans: OffensivePlan[];
  /** Legacy single plan compat — points to offensivePlans[0] or null */
  offensivePlan: OffensivePlan | null;
  /** Army groups for coordinated movement */
  armyGroups: ArmyGroup[];
  /** Situational aggression posture (score + reasons). */
  aggression: AggressionState | null;
  /** Per-city building priorities (cityId -> plans) */
  buildingPriorities: Record<string, BuildingPlan[]>;
  /** Current tech research rationale */
  researchPriority: ResearchPriority | null;
}

/** Create a fresh default AIState */
export function createDefaultAIState(): AIState {
  return {
    strategyProfile: 'balanced_growth',
    lastStrategyEvaluation: 0,
    offensivePlans: [],
    offensivePlan: null,
    armyGroups: [],
    aggression: null,
    buildingPriorities: {},
    researchPriority: null,
  };
}

/**
 * Fixed per-civilization AI identity, assigned by civ index at game start.
 * AutoProduction (and the initial research strategy) key off this profile, so
 * each civ builds — and therefore behaves — differently. Index 0 is the human
 * player's civ in normal games; in AI-vs-AI every slot is AI-controlled.
 */
export const CIV_PRODUCTION_PROFILES: StrategyProfile[] = [
  'early_expansion',
  'military_expansion',
  'science_focus',
  'defensive_turtle',
  'wonder_rush',
  'balanced_growth',
];

/** Deterministically resolve a civ's production profile by its index. */
export function getCivProductionProfile(civilizationId: number): StrategyProfile {
  return CIV_PRODUCTION_PROFILES[civilizationId % CIV_PRODUCTION_PROFILES.length] ?? 'balanced_growth';
}

/**
 * Resolve the AI strategy that should drive BOTH production and research for
 * a civ, so every AI decision follows the same strategy. The civ's FIXED
 * production profile (assigned per civ at game start) is the source of truth
 * for its strategic identity — a military_expansion civ must research military
 * techs, not silently fall back to the generic 'balanced_growth' default. The
 * AI-state strategy (possibly re-evaluated by AIStrategySelector) is only a
 * fallback for civs without a fixed profile.
 */
export function resolveAICivStrategy(
  civ: { productionProfile?: StrategyProfile } | null | undefined,
  aiState?: { strategyProfile?: StrategyProfile } | null,
): StrategyProfile {
  return civ?.productionProfile ?? aiState?.strategyProfile ?? 'balanced_growth';
}

/**
 * Deterministic AI personality (aggression/diplomacy/military/…) derived from
 * the civ's production profile. The engine's civs are plain objects and never
 * got a `personality`, which made `processAIDiplomacy` fall back to an all-5
 * profile — so the AI could never declare war on its own and its city-capture
 * ability stayed dormant. Profiles that produce armies get high aggression so
 * they actually attack weaker neighbours.
 */
export function getCivPersonality(profile: StrategyProfile): {
  aggression: number;
  diplomacy: number;
  military: number;
  expansion: number;
  science: number;
  economy: number;
} {
  switch (profile) {
    case 'military_expansion':
      return { aggression: 8, diplomacy: 3, military: 9, expansion: 8, science: 3, economy: 4 };
    case 'early_expansion':
      return { aggression: 6, diplomacy: 5, military: 5, expansion: 9, science: 5, economy: 6 };
    case 'science_focus':
      return { aggression: 3, diplomacy: 7, military: 3, expansion: 5, science: 9, economy: 5 };
    case 'defensive_turtle':
      return { aggression: 2, diplomacy: 6, military: 7, expansion: 4, science: 6, economy: 6 };
    case 'wonder_rush':
      return { aggression: 4, diplomacy: 6, military: 4, expansion: 4, science: 7, economy: 7 };
    case 'balanced_growth':
    default:
      return { aggression: 5, diplomacy: 5, military: 5, expansion: 6, science: 5, economy: 5 };
  }
}

// ---------------------------------------------------------------------------
// Technology category mapping for AI research scoring
// ---------------------------------------------------------------------------

export type TechCategory = 'military' | 'economy' | 'science' | 'culture' | 'expansion' | 'infrastructure' | 'government';

/** Maps technology IDs to categories for AI scoring */
export const TECH_CATEGORIES: Record<string, TechCategory> = {
  // Military
  bronze_working: 'military',
  iron_working: 'military',
  horseback_riding: 'military',
  the_wheel: 'military',
  mathematics: 'military',
  metallurgy: 'military',
  gunpowder: 'military',
  steel: 'military',
  combustion: 'military',
  flight: 'military',

  // Economy
  currency: 'economy',
  trade: 'economy',
  banking: 'economy',
  industrialization: 'economy',
  railroad: 'economy',
  mass_production: 'economy',

  // Science
  alphabet: 'science',
  writing: 'science',
  literacy: 'science',
  philosophy: 'science',
  university: 'science',
  science_theory: 'science',
  electricity: 'science',
  electronics: 'science',
  computers: 'science',

  // Culture / Happiness
  ceremonial_burial: 'culture',
  polytheism: 'culture',
  monotheism: 'culture',
  theology: 'culture',

  // Expansion / Infrastructure
  pottery: 'expansion',
  masonry: 'infrastructure',
  construction: 'infrastructure',
  engineering: 'infrastructure',
  sailing: 'expansion',
  map_making: 'expansion',
  navigation: 'expansion',
  astronomy: 'science',

  // Government
  code_of_laws: 'government',
  monarchy: 'government',
  republic: 'government',
  democracy: 'government',

  // Late game
  nuclear_power: 'science',
  space_flight: 'science',
  moonshot: 'science',
};

// ---------------------------------------------------------------------------
// Unit technology requirements
// ---------------------------------------------------------------------------

/** Maps unit types to the technology required to build them */
const UNIT_TECH_REQUIREMENTS: Record<string, string | null> = {
  warrior: null,
  scout: null,
  archer: null,
  phalanx: 'bronze_working',
  chariot: 'the_wheel',
  knights: 'horseback_riding',
  legion: 'iron_working',
  catapult: 'mathematics',
  musketeer: 'gunpowder',
  riflemen: 'gunpowder',
  cavalry: 'horseback_riding',
  mech_inf: 'combustion',
  cannon: 'metallurgy',
  artillery: 'steel',
  tank: 'combustion',
  settler: null,
  diplomat: 'writing',
  caravan: 'trade',
  ferry: 'sailing',
  sail: 'sailing',
  trireme: 'map_making',
  caravel: 'navigation',
  frigate: 'navigation',
  ironclad: 'steel',
  destroyer: 'combustion',
  cruiser: 'combustion',
  battleship: 'steel',
  submarine: 'combustion',
  carrier: 'flight',
  fighter: 'flight',
  bomber: 'flight',
  nuclear: 'nuclear_power',
};

// ---------------------------------------------------------------------------
// Helper - check if a civ has a technology
// ---------------------------------------------------------------------------

/** 
 * Check if a civilization has researched a specific technology.
 * Handles both Set<string> and string[] formats.
 */
function civHasTech(civ: { technologies?: Set<string> | string[] }, techId: string): boolean {
  if (!civ || !techId) return false;
  if (civ.technologies instanceof Set) {
    return civ.technologies.has(techId);
  }
  if (Array.isArray(civ.technologies)) {
    return civ.technologies.includes(techId);
  }
  return false;
}

/**
 * Check if a civ can build a specific unit type given its technologies.
 */
export function canBuildUnit(civ: { technologies?: Set<string> | string[] }, unitType: string): boolean {
  const requiredTech = UNIT_TECH_REQUIREMENTS[unitType];
  if (!requiredTech) return true; // No tech required
  return civHasTech(civ, requiredTech);
}

/**
 * Check if a civ can build a specific building given its technologies and prerequisites.
 * @param civ - Civilization object
 * @param buildingType - Building type key
 * @param buildingProps - BUILDING_PROPERTIES entry
 * @param cityBuildings - Current buildings in the city (array or Set)
 * @param buildingPrereqs - BUILDING_PREREQUISITES map
 */
export function canBuildBuilding(
  civ: { technologies?: Set<string> | string[] },
  buildingType: string,
  buildingProps: { requiredTechnology?: string } | undefined,
  cityBuildings: string[] | Set<string>,
  buildingPrereqs: Record<string, readonly string[]>
): boolean {
  // Check tech requirement
  if (buildingProps?.requiredTechnology && !civHasTech(civ, buildingProps.requiredTechnology)) {
    return false;
  }
  // Check building prerequisites
  const prereqs = buildingPrereqs[buildingType];
  if (prereqs) {
    for (const prereq of prereqs) {
      const has = cityBuildings instanceof Set
        ? cityBuildings.has(prereq)
        : Array.isArray(cityBuildings) && cityBuildings.includes(prereq);
      if (!has) return false;
    }
  }
  return true;
}
