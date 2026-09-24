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
 * Research stays idle for the opening rounds: the first three full rounds let
 * the player settle in (move the starting units, found the first cities) before
 * the "No Research Selected" prompt and the turn-end auto-select fallback start.
 * Compared against the engine's 0-based round counter (rounds 0, 1, 2 are the
 * opening rounds; research unlocks when round 3 begins).
 */
export const RESEARCH_UNLOCK_ROUND = 3;


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