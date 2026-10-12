// Game Constants - Core game settings and configuration

import { translateDynamic } from '../i18n';

export const MAX_CARAVAN_TRADE_ROUTES = 3;

/**
 * ── Caravan governor (see `src/game/engine/AI/CaravanGovernor.ts`) ────────
 * Caps and patience values for the module that governs Caravan behaviour.
 */
/** A city may have at most this many in-transit caravans of its own at once. */
export const MAX_CARAVANS_PER_CITY = 3;
/** How many caravans per civ may be on scout duty at the same time. */
export const CARAVAN_MAX_SCOUTS = 1;
/** Consecutive no-route turns before a delivery target is given up. */
export const CARAVAN_BLOCK_PATIENCE = 3;
/** Consecutive do-nothing turns before a useless caravan is disbanded (last resort). */
export const CARAVAN_DISBAND_PATIENCE = 10;
/**
 * Enemy units adjacent to the route at which a delivery is called "risky".
 * Caravans are defenceless — they TAKE the risk by default; the threshold only
 * decides whether a *safer* alternate route is looked for.
 */
export const CARAVAN_RISK_THRESHOLD = 3;
/** A* penalty per enemy-adjacent tile when hunting for a safer alternate route. */
export const CARAVAN_SAFE_ROUTE_PENALTY = 8;

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
export const RESEARCH_UNLOCK_ROUND = 5;

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

/**
 * Label for the current rung of the ladder. Translated through the i18n
 * runtime (`speed.full` / `speed.slowerBy`); the English strings are
 * unchanged. Components showing the label call `useTranslation()` so the
 * text follows a language switch.
 */
export function gameSpeedLabel(step: number): string {
    const s = clampGameSpeedStep(step);
    return s === 0
        ? translateDynamic('speed.full', undefined, 'Full Speed')
        : translateDynamic('speed.slowerBy', { factor: s }, `Slower ×${s}`);
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

// ── City upkeep ─────────────────────────────────────────────────────────
/**
 * Cities each cost this much gold per turn beyond the first
 * `FREE_CITY_SUPPORT`, paid through `EconomicManager.totalUpkeep`.
 *
 * Without it a city costs the empire nothing but the food and shields it takes
 * to build, so gold has no relationship to empire size at all: measured tax
 * income was 0.43 gold per civ per turn while a single warrior cost 1 — there is
 * no way to pay for an empire, so the only gold sinks were rushes and the
 * accidental liquidations. It also makes conquest *pay*, which is the other
 * half of the problem: a rich civ was never worth attacking (plunder is capped
 * at 100).
 *
 * Three free cities keeps the opening untouched; the bill starts with the
 * fourth, which is where an empire normally stops being a single town.
 */
export const CITY_UPKEEP_PER_CITY = 1;

/** Cities the empire supports for free before `CITY_UPKEEP_PER_CITY` starts. */
export const FREE_CITY_SUPPORT = 3;

/**
 * How much a trade route to a civ we hold a trade agreement with is worth.
 *
 * The treaty's whole value lives here rather than in a flat stipend: the
 * stipend used to add 2 gold a turn to BOTH sides for as long as the treaty
 * stood, minted from nothing, so a civ with several treaties had a permanent
 * income it did nothing to earn. Doubling the route's trade instead makes the
 * treaty pay only where a caravan has actually been delivered.
 */
export const TREATY_ROUTE_TRADE_MULTIPLIER = 2;

// ── Gold ↔ shields ───────────────────────────────────────────────────────

/**
 * Gold per production shield when a civ buys or rushes production outright.
 *
 * ONE rate for everything — units, buildings and wonders, whether bought from
 * the production menu (`ProductionManager.purchaseCityProduction`) or rushed
 * mid-build (`GameEngine.rushCityProduction`). It used to be two: 2 gold per
 * shield for units and in-progress rushes, but 1 gold per shield for a
 * building bought from the menu, so the same 120-shield Aqueduct cost 240 gold
 * to rush and 120 to buy. Buying half-price is the kind of arbitrage that makes
 * a player stop trusting the economy, and the AI (which only ever rushes) never
 * even saw it.
 */
export const PURCHASE_GOLD_PER_SHIELD = 2;