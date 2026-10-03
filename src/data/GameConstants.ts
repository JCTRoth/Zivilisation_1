// Game Constants - Core game settings and configuration

export const MAX_CARAVAN_TRADE_ROUTES = 3;

/**
 * Island-size thresholds (in passable land tiles) for the AI's naval strategy:
 *  - a SMALL island makes the AI value a Harbor (and consider colonizing
 *    elsewhere),
 *  - a VERY SMALL island makes escaping by ship the top production priority.
 */
export const SMALL_ISLAND_MAX_TILES = 24;
export const VERY_SMALL_ISLAND_MAX_TILES = 10;

/**
 * Research stays idle for the opening rounds: the first five full rounds let
 * the player settle in (move the starting units, found the first cities) before
 * the "No Research Selected" prompt and the turn-end auto-select fallback start.
 * Compared against the engine's 0-based round counter (rounds 0-4 are the
 * opening rounds; research unlocks when round 5 begins).
 */
export const RESEARCH_UNLOCK_ROUND = 4;

/**
 * Turn at which the game offers the "Auto. turn ending" option once: by then
 * the player has the units and cities the feature is about, and has seen what
 * clicking "End turn" by hand costs. The offer is shown a single time per
 * browser (localStorage flag) so it never nags.
 */
export const AUTO_END_TURN_OFFER_TURN = 15;

/** localStorage key: the "Auto. turn ending" offer was already answered. */
export const AUTO_END_TURN_OFFER_FLAG = 'civ1_auto_end_turn_offered';

/**
 * Map types that are AI-vs-AI spectator scenarios: every civilization is
 * computer-controlled, nobody is watching a human, and the game is supposed to
 * play itself.
 *
 * This used to be seven hardcoded `mapType === 'AI_VS_AI' || …` checks spread
 * over four files, and they had drifted: `AIManager` and `App` listed only two
 * of the four types, so the naval scenarios were paying a 200 ms sleep per
 * move, never got the `aivsai-` log session, never auto-restarted after a win
 * and never auto-ticked Dev Mode. One predicate, one list.
 */
export const AUTO_SCENARIO_MAP_TYPES: readonly string[] = [
    'AI_VS_AI',
    'AI_VS_AI_SMALL',
    'AI_VS_AI_NAVAL',
    'AI_VS_AI_NAVAL_TROPICAL',
];

/** Whether a map type is a self-playing AI-vs-AI scenario. */
export function isAutoScenario(mapType: string | null | undefined): boolean {
    return !!mapType && AUTO_SCENARIO_MAP_TYPES.includes(mapType);
}

/**
 * Spectator speed ladder for self-playing scenarios.
 *
 * Step 0 is full speed — the game runs exactly as fast as the event loop
 * allows, which is what an unattended demo wants. Every step further down
 * adds exactly one increment of the delays below, so the ladder is uniform:
 * a "Faster" click undoes a "Slower" click one step at a time and always walks
 * the game back up the same rungs it came down. Nothing is exponential and
 * nothing is asymmetric, so the speed a player returns to is the speed they
 * left.
 */
export const GAME_SPEED_STEP_COUNT = 4;
/** Extra pause before each AI turn starts, per speed step. */
export const SPEED_STEP_TURN_DELAY_MS = 300;
/** Extra pause per AI unit move, per speed step. */
export const SPEED_STEP_MOVE_DELAY_MS = 20;

/** Keep a speed step inside the supported ladder. */
export function clampGameSpeedStep(step: number): number {
    if (!Number.isFinite(step)) return 0;
    return Math.min(GAME_SPEED_STEP_COUNT, Math.max(0, Math.round(step)));
}

/** True when the game is running slower than full speed. */
export function isSlowerThanFullSpeed(step: number): boolean {
    return clampGameSpeedStep(step) > 0;
}

/** True when "Faster" has anywhere left to go. */
export function canGoFaster(step: number): boolean {
    return clampGameSpeedStep(step) > 0;
}

/** True when "Slower" has anywhere left to go. */
export function canGoSlower(step: number): boolean {
    return clampGameSpeedStep(step) < GAME_SPEED_STEP_COUNT;
}

/** One step slower on the ladder. */
export function slowerGameSpeedStep(step: number): number {
    return clampGameSpeedStep(step) + (canGoSlower(step) ? 1 : 0);
}

/** One step faster on the ladder. */
export function fasterGameSpeedStep(step: number): number {
    return clampGameSpeedStep(step) - (canGoFaster(step) ? 1 : 0);
}

/**
 * Multiplier applied to the AI turn budget. A slowed turn deliberately waits
 * between units, and the TurnManager watchdog must not mistake that patience
 * for a hung AI and force-end the turn halfway through.
 */
export function gameSpeedTimeoutFactor(step: number): number {
    return 1 + clampGameSpeedStep(step) * 2;
}

/** Label for the current rung of the ladder. */
export function gameSpeedLabel(step: number): string {
    const s = clampGameSpeedStep(step);
    return s === 0 ? 'Full Speed' : `Slower ×${s}`;
}

/**
 * Milliseconds the AI movement phase may take before a civ's turn is force-
 * ended.
 *
 * A force-ended turn silently skips every unit that had not been processed
 * yet, which looks exactly like a broken AI when you are watching a demo — so
 * the budget has to be generous. The base is the figure tuned for the 40x40
 * AI duel, and bigger maps get a linear add-on because the extra cost is
 * pathfinding: a 96x60 archipelago with 7 civs does an order of magnitude more
 * of it per turn, and at 200 ms of debug sleep per move it will blow a 30 s
 * budget on its own.
 */
export const AI_TURN_TIMEOUT_MS = 30_000;
/** Map size the base budget above was tuned for (the 40x40 duel). */
export const AI_TURN_TIMEOUT_REFERENCE_TILES = 40 * 40;
/** Added per tile beyond the reference map, in ms. */
const AI_TURN_TIMEOUT_MS_PER_TILE = 25;
/** Hard ceiling, so a 180x90 Earth game cannot wait five minutes per civ. */
export const AI_TURN_TIMEOUT_MAX_MS = 180_000;

/** The AI turn budget for a map of `tiles` squares. */
export function aiTurnTimeoutMs(tiles: number): number {
  if (!tiles || tiles <= 0) return AI_TURN_TIMEOUT_MS;
  const extra = Math.max(0, tiles - AI_TURN_TIMEOUT_REFERENCE_TILES);
  return Math.min(AI_TURN_TIMEOUT_MAX_MS, AI_TURN_TIMEOUT_MS + extra * AI_TURN_TIMEOUT_MS_PER_TILE);
}


export interface TerrainProperties {
    movement: number;
    defense: number;
    food: number;
    production: number;
    trade: number;
    color: string;
    passable: boolean;
    description?: string;
    buildModifier?: number;
}

export interface UnitProperties {
    name: string;
    attack: number;
    defense: number;
    movement: number;
    /** Civ1 hit points. The engine's `health` field remains a percentage for combat compatibility. */
    hitPoints?: number;
    sightRange?: number;
    cost: number;
    maintenance?: number;
    canSettle: boolean;
    canWork: boolean;
    naval?: boolean;
    icon?: string;
    type?: 'civilian' | 'military' | 'siege' | 'naval' | 'scout' | 'air';
    /** Technology required to produce this unit (null/undefined = no requirement). */
    requires?: string | null;
    /** Building that must exist in the city to produce this unit (null/undefined = none). */
    requiredBuilding?: string | null;
    /**
     * Naval hulls only: how many land units the ship can carry at once.
     * 0/undefined for everything else. A Ferry takes several, so one hull can
     * land a landing force instead of a lone spear.
     */
    transportCapacity?: number;
}

export interface BuildingProperties {
    name: string;
    cost: number;
    maintenance: number;
    effects: {
      food?: number;
      production?: number;
      trade?: number;
      gold?: number;
      science?: number;
      happiness?: number;
      [key: string]: unknown;
    };
    description?: string;
    requiredTechnology?: string;
    icon?: string;
}

export interface GameConstants {
    // Hex Grid Configuration
    HEX_SIZE: number;
    HEX_WIDTH: number;
    HEX_HEIGHT: number;

    // Map Dimensions
    MAP_WIDTH: number;
    MAP_HEIGHT: number;

    // Game Settings
    INITIAL_GOLD: number;
    INITIAL_SCIENCE: number;
    TURNS_PER_YEAR: number;
    STARTING_YEAR: number;

    // Colors
    COLORS: {
        PLAYER: string;
        AI_1: string;
        AI_2: string;
        AI_3: string;
        AI_4: string;
        AI_5: string;
        NEUTRAL: string;
        SELECTED: string;
        HIGHLIGHT: string;
    };
}

export const GAME_CONSTANTS: GameConstants = {
    // Hex Grid Configuration
    HEX_SIZE: 32,
    HEX_WIDTH: 56,  // HEX_SIZE * Math.sqrt(3)
    HEX_HEIGHT: 64, // HEX_SIZE * 2

    // Map Dimensions
    MAP_WIDTH: 80,
    MAP_HEIGHT: 50,

    // Game Settings
    INITIAL_GOLD: 50,
    INITIAL_SCIENCE: 0,
    TURNS_PER_YEAR: 10,
    STARTING_YEAR: 4000,

    // Colors
    COLORS: {
        PLAYER: '#007bff',
        AI_1: '#dc3545',
        AI_2: '#28a745',
        AI_3: '#ffc107',
        AI_4: '#6f42c1',
        AI_5: '#fd7e14',
        NEUTRAL: '#6c757d',
        SELECTED: '#ff6b6b',
        HIGHLIGHT: '#4ecdc4'
    }
};
// ── Specialists ──────────────────────────────────────────────────────────
// When a citizen is pulled off a worked tile they become one of these
// specialists, trading raw tile yields (Food/Shields/Trade) for a fixed
// city-specific yield (Luxury / Gold / Science).

import type { SpecialistType } from '../../types/game';

export interface SpecialistProperties {
  name: string;
  /** Per-turn luxury bonus. */
  luxury: number;
  /** Per-turn gold bonus (straight to treasury). */
  gold: number;
  /** Per-turn science bonus (toward current research). */
  science: number;
  /** Emoji icon (drawn under the city on the map). */
  icon: string;
}

export const SPECIALIST_YIELDS: Record<SpecialistType, SpecialistProperties> = {
  entertainer: { luxury: 2, gold: 0, science: 0, name: 'Entertainer', icon: '🕺' },
  taxman:      { luxury: 0, gold: 2, science: 0, name: 'Taxman',      icon: '💸' },
  scientist:   { luxury: 0, gold: 0, science: 2, name: 'Scientist',   icon: '🥼' },
};