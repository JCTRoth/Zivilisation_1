// Unit Constants - Unit types and properties

import { UnitProperties } from './GameConstants';

export const UNIT_TYPES = {
    // Military Units
    WARRIOR: 'warrior',
    SCOUT: 'scout',
    ARCHER: 'archer',
    PHALANX: 'phalanx',
    CHARIOT: 'chariot',
    KNIGHTS: 'knights',
    LEGION: 'legion',
    CATAPULT: 'catapult',
    MUSKETEER: 'musketeer',
    RIFLEMEN: 'riflemen',
    CAVALRY: 'cavalry',
    MECH_INF: 'mech_inf',
    CANNON: 'cannon',
    ARTILLERY: 'artillery',
    TANK: 'tank',

    // Naval Units
    SAIL: 'sail',
    TRIREME: 'trireme',
    CARAVEL: 'caravel',
    FRIGATE: 'frigate',
    IRONCLAD: 'ironclad',
    DESTROYER: 'destroyer',
    CRUISER: 'cruiser',
    BATTLESHIP: 'battleship',
    SUBMARINE: 'submarine',
    CARRIER: 'carrier',
    TRANSPORT: 'transport',

    // Civilian Units
    SETTLER: 'settler',
    DIPLOMAT: 'diplomat',
    CARAVAN: 'caravan',
    FERRY: 'ferry',
    
    // Air Units
    FIGHTER: 'fighter',
    BOMBER: 'bomber',
    NUCLEAR: 'nuclear'
} as const;

export const UNIT_PROPERTIES: Record<string, UnitProperties> = {
    [UNIT_TYPES.WARRIOR]: {
        name: 'Warrior',
        attack: 1,
        defense: 1,
        movement: 1,
        sightRange: 1,
        cost: 10,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '⚔️',
        type: 'military'
    },
    [UNIT_TYPES.SCOUT]: {
        name: 'Scout',
        attack: 0.5,
        defense: 1,
        movement: 2,
        sightRange: 2,
        cost: 15,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: ' 🔦',
        type: 'military'
    },
    [UNIT_TYPES.ARCHER]: {
        name: 'Archer',
        attack: 3,
        defense: 2,
        movement: 1,
        sightRange: 1,
        cost: 30,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🏹',
        type: 'military'
    },
    [UNIT_TYPES.PHALANX]: {
        name: 'Phalanx',
        attack: 1,
        defense: 2,
        movement: 1,
        sightRange: 1,
        cost: 50,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🗡️',
        type: 'military'
    },
    [UNIT_TYPES.CHARIOT]: {
        name: 'Chariot',
        attack: 4,
        defense: 2,
        movement: 2,
        sightRange: 1,
        cost: 40,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '𓌝',
        type: 'military'
    },
    [UNIT_TYPES.KNIGHTS]: {
        name: 'Knights',
        attack: 4,
        defense: 2,
        movement: 2,
        sightRange: 1,
        cost: 40,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🏇',
        type: 'military'
    },
    [UNIT_TYPES.LEGION]: {
        name: 'Legion',
        attack: 3,
        defense: 1,
        movement: 1,
        sightRange: 1,
        cost: 60,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '⚔️',
        type: 'military'
    },
    [UNIT_TYPES.CATAPULT]: {
        name: 'Catapult',
        attack: 6,
        defense: 1,
        movement: 1,
        sightRange: 1,
        cost: 70,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🪨',
        type: 'siege'
    },
    [UNIT_TYPES.MUSKETEER]: {
        name: 'Musketeer',
        attack: 3,
        defense: 3,
        movement: 1,
        sightRange: 1,
        cost: 80,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '💂',
        type: 'military'
    },
    [UNIT_TYPES.RIFLEMEN]: {
        name: 'Riflemen',
        attack: 3,
        defense: 5,
        movement: 1,
        sightRange: 1,
        cost: 30,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🪖',
        type: 'military'
    },
    [UNIT_TYPES.CAVALRY]: {
        name: 'Cavalry',
        attack: 5,
        defense: 2,
        movement: 3,
        sightRange: 2,
        cost: 100,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🐎',
        type: 'military'
    },
    [UNIT_TYPES.MECH_INF]: {
        name: 'Mech. Inf.',
        attack: 6,
        defense: 6,
        movement: 3,
        sightRange: 1,
        cost: 50,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🚐',
        type: 'military'
    },
    [UNIT_TYPES.CANNON]: {
        name: 'Cannon',
        attack: 8,
        defense: 1,
        movement: 1,
        sightRange: 1,
        cost: 120,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '💣',
        type: 'siege'
    },
    [UNIT_TYPES.ARTILLERY]: {
        name: 'Artillery',
        attack: 12,
        defense: 2,
        movement: 1,
        sightRange: 2,
        cost: 150,
        maintenance: 3,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '💥',
        type: 'siege'
    },
    [UNIT_TYPES.TANK]: {
        name: 'Tank',
        attack: 16,
        defense: 8,
        movement: 3,
        sightRange: 2,
        cost: 200,
        maintenance: 4,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🚂',
        type: 'military'
    },
    [UNIT_TYPES.SAIL]: {
        name: 'Sail',
        attack: 1,
        defense: 1,
        movement: 3,
        sightRange: 2,
        cost: 40,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '⛵',
        type: 'naval'
    },
    [UNIT_TYPES.TRIREME]: {
        name: 'Trireme',
        attack: 3,
        defense: 2,
        movement: 4,
        sightRange: 2,
        cost: 80,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🚣',
        type: 'naval'
    },
    [UNIT_TYPES.CARAVEL]: {
        name: 'Caravel',
        attack: 2,
        defense: 1,
        movement: 4,
        sightRange: 2,
        cost: 60,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '⛵',
        type: 'naval'
    },
    [UNIT_TYPES.FRIGATE]: {
        name: 'Frigate',
        attack: 4,
        defense: 2,
        movement: 4,
        sightRange: 2,
        cost: 80,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '𓊝',
        type: 'naval'
    },
    [UNIT_TYPES.IRONCLAD]: {
        name: 'Ironclad',
        attack: 6,
        defense: 4,
        movement: 4,
        sightRange: 2,
        cost: 120,
        maintenance: 3,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🚢',
        type: 'naval'
    },
    [UNIT_TYPES.DESTROYER]: {
        name: 'Destroyer',
        attack: 8,
        defense: 6,
        movement: 5,
        sightRange: 2,
        cost: 160,
        maintenance: 4,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🏴‍☠',
        type: 'naval'
    },
    [UNIT_TYPES.CRUISER]: {
        name: 'Cruiser',
        attack: 12,
        defense: 8,
        movement: 5,
        sightRange: 2,
        cost: 200,
        maintenance: 5,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🛳️',
        type: 'naval'
    },
    [UNIT_TYPES.BATTLESHIP]: {
        name: 'Battleship',
        attack: 18,
        defense: 12,
        movement: 4,
        sightRange: 2,
        cost: 280,
        maintenance: 6,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🛥️',
        type: 'naval'
    },
    [UNIT_TYPES.SUBMARINE]: {
        name: 'Submarine',
        attack: 14,
        defense: 3,
        movement: 3,
        sightRange: 2,
        cost: 240,
        maintenance: 5,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🔱',
        type: 'naval'
    },
    [UNIT_TYPES.CARRIER]: {
        name: 'Carrier',
        attack: 1,
        defense: 12,
        movement: 5,
        sightRange: 2,
        cost: 160,
        maintenance: 5,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🛳️',
        type: 'naval'
    },
    [UNIT_TYPES.SETTLER]: {
        name: 'Settler',
        attack: 0,
        defense: 0,
        movement: 1,
        sightRange: 1,
        cost: 40,
        maintenance: 1,
        canSettle: true,
        canWork: false,
        naval: false,
        icon: '👷',
        type: 'civilian'
    },
    [UNIT_TYPES.DIPLOMAT]: {
        name: 'Diplomat',
        attack: 0,
        defense: 0,
        movement: 2,
        sightRange: 1,
        cost: 30,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🎩',
        type: 'civilian'
    },
    [UNIT_TYPES.CARAVAN]: {
        name: 'Caravan',
        attack: 0,
        defense: 0,
        movement: 1,
        sightRange: 1,
        cost: 50,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🐫',
        type: 'civilian'
    },
    [UNIT_TYPES.FERRY]: {
        name: 'Ferry',
        attack: 0,
        defense: 0,
        movement: 3,
        sightRange: 2,
        cost: 30,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '⛴️',
        type: 'civilian'
    },
    [UNIT_TYPES.FIGHTER]: {
        name: 'Fighter',
        attack: 4,
        defense: 2,
        movement: 10,
        sightRange: 1,
        cost: 60,
        maintenance: 2,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '✈️',
        type: 'air'
    },
    [UNIT_TYPES.BOMBER]: {
        name: 'Bomber',
        attack: 12,
        defense: 1,
        movement: 8,
        sightRange: 2,
        cost: 120,
        maintenance: 3,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🛩️',
        type: 'air'
    },
    [UNIT_TYPES.NUCLEAR]: {
        name: 'Nuclear',
        attack: 99,
        defense: 0,
        movement: 16,
        sightRange: 1,
        cost: 160,
        maintenance: 5,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '☢️',
        type: 'air'
    }
};

export const UNIT_MAINTENANCE_COSTS = {
    MILITARY: 1,
    NAVAL: 2,
    CIVILIAN: 1
} as const;

export const UNIT_PRODUCTION_REQUIREMENTS = {
    [UNIT_TYPES.WARRIOR]: { shields: 10 },
    [UNIT_TYPES.SCOUT]: { shields: 15 },
    [UNIT_TYPES.ARCHER]: { shields: 30 },
    [UNIT_TYPES.PHALANX]: { shields: 50 },
    [UNIT_TYPES.CHARIOT]: { shields: 40 },
    [UNIT_TYPES.KNIGHTS]: { shields: 40 },
    [UNIT_TYPES.LEGION]: { shields: 60 },
    [UNIT_TYPES.CATAPULT]: { shields: 70 },
    [UNIT_TYPES.MUSKETEER]: { shields: 80 },
    [UNIT_TYPES.RIFLEMEN]: { shields: 30 },
    [UNIT_TYPES.CAVALRY]: { shields: 100 },
    [UNIT_TYPES.MECH_INF]: { shields: 50 },
    [UNIT_TYPES.CANNON]: { shields: 120 },
    [UNIT_TYPES.ARTILLERY]: { shields: 150 },
    [UNIT_TYPES.TANK]: { shields: 200 },
    [UNIT_TYPES.SAIL]: { shields: 40 },
    [UNIT_TYPES.TRIREME]: { shields: 80 },
    [UNIT_TYPES.CARAVEL]: { shields: 60 },
    [UNIT_TYPES.FRIGATE]: { shields: 80 },
    [UNIT_TYPES.IRONCLAD]: { shields: 120 },
    [UNIT_TYPES.DESTROYER]: { shields: 160 },
    [UNIT_TYPES.CRUISER]: { shields: 200 },
    [UNIT_TYPES.BATTLESHIP]: { shields: 280 },
    [UNIT_TYPES.SUBMARINE]: { shields: 240 },
    [UNIT_TYPES.CARRIER]: { shields: 160 },
    [UNIT_TYPES.TRANSPORT]: { shields: 50 },
    [UNIT_TYPES.SETTLER]: { shields: 40 },
    [UNIT_TYPES.DIPLOMAT]: { shields: 30 },
    [UNIT_TYPES.CARAVAN]: { shields: 50 },
    [UNIT_TYPES.FERRY]: { shields: 30 },
    [UNIT_TYPES.FIGHTER]: { shields: 60 },
    [UNIT_TYPES.BOMBER]: { shields: 120 },
    [UNIT_TYPES.NUCLEAR]: { shields: 160 }
} as const;

// Create GameData-compatible format: Record<string, UnitDataObject>
// This provides the format expected by code using Object.values(UNIT_TYPES) from GameData
export const UNIT_DATA_MAP: Record<string, {
    id: string;
    name: string;
    cost: number;
    attack: number;
    defense: number;
    movement: number;
    sightRange?: number;
    icon: string;
    requires?: string | null;
    description?: string;
}> = Object.fromEntries(
    Object.entries(UNIT_PROPERTIES).map(([key, props]) => {
        // Determine sight range based on unit type
        let sightRange = 1; // Default for most units
        
        // Naval units and scouts have extended sight range
        if (props.naval) {
            sightRange = 2; // Ships can see further
        }
        // Special units with better vision
        if (key === 'scout' || key === 'trireme' || key === 'caravel' || key === 'frigate') {
            sightRange = 2;
        }
        if (key === 'battleship' || key === 'cruiser' || key === 'submarine') {
            sightRange = 3;
        }
        
        return [
            key,
            {
                id: key,
                name: props.name,
                cost: props.cost,
                attack: props.attack,
                defense: props.defense,
                movement: props.movement,
                sightRange,
                icon: props.icon,
                requires: null,
                description: `${props.name} - ${props.type} unit`
            }
        ];
    })
);