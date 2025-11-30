// Game Constants - Core game settings and configuration

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
    sightRange?: number;
    cost: number;
    maintenance?: number;
    canSettle: boolean;
    canWork: boolean;
    naval?: boolean;
    icon?: string;
    type?: 'civilian' | 'military' | 'siege' | 'naval' | 'scout';
}

export interface BuildingProperties {
    name: string;
    cost: number;
    maintenance: number;
    effects: Record<string, any>;
    description?: string;
    requiredTechnology?: string;
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