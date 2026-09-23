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
    FISHER_BOAT: 'fisher_boat',

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
        requires: 'bronze_working',
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
        requires: 'the_wheel',
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
        requires: 'horseback_riding',
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
        requires: 'iron_working',
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
        requires: 'mathematics',
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
        requires: 'gunpowder',
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
        requires: 'gunpowder',
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
        requires: 'horseback_riding',
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
        requires: 'combustion',
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
        requires: 'metallurgy',
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
        requires: 'steel',
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
        requires: 'combustion',
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
        requires: 'sailing',
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
        requires: 'map_making',
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
        requires: 'navigation',
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
        requires: 'navigation',
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
        requires: 'steel',
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
        requires: 'combustion',
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
        requires: 'combustion',
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
        requires: 'steel',
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
        requires: 'combustion',
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
        requires: 'flight',
        type: 'naval'
    },
    [UNIT_TYPES.SETTLER]: {
        name: 'Settler',
        attack: 0,
        defense: 1,
        movement: 1,
        hitPoints: 2,
        sightRange: 3,
        cost: 40,
        // Civ1: Settlers consume food from their home city (1 food/turn, 2 in
        // Democracy), not gold. The food cost is applied in TurnManager.
        maintenance: 0,
        canSettle: true,
        canWork: true,
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
        requires: 'writing',
        type: 'civilian'
    },
    [UNIT_TYPES.CARAVAN]: {
        name: 'Caravan',
        attack: 0,
        defense: 0,
        movement: 1,
        sightRange: 1,
        cost: 50,
        // Civ1: Caravans are consumed when they deliver a trade route. No
        // ongoing upkeep — the benefit is the one-time lump-sum gold/science
        // payout plus the permanent per-turn trade route bonus.
        maintenance: 0,
        canSettle: false,
        canWork: false,
        naval: false,
        icon: '🐫',
        requires: 'trade',
        type: 'civilian'
    },
    [UNIT_TYPES.FISHER_BOAT]: {
        name: 'Fisher Boat',
        attack: 0,
        defense: 1,
        movement: 2,
        sightRange: 2,
        cost: 20,
        maintenance: 1,
        canSettle: false,
        canWork: false,
        naval: true,
        icon: '🎣',
        requires: null,
        // A Fisher Boat needs the Harbor BUILDING (not just a coast): it is
        // the replacement for the old harbor "food from the sea" bonus.
        requiredBuilding: 'harbor',
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
        requires: 'sailing',
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
        requires: 'flight',
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
        requires: 'flight',
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
        requires: 'nuclear_power',
        type: 'air'
    }
};

/** Fisher Boat hold capacity: fish collected per full catch. */
export const FISHER_BOAT_STORAGE = 6;

/**
 * Food value of a single fish based on the Chebyshev distance `d` between the
 * Fisher Boat's home city and its net tile:
 *
 *     foodPerFish = min(3, 1 + floor(d / 4))
 *
 * Far fishing grounds pay more per fish to compensate for the longer trip:
 * d 0-3 → 1, d 4-7 → 2, d 8+ → 3. A full catch (6 fish) therefore delivers
 * 6 / 12 / 18 food.
 */
export function fisherFoodPerFish(distance: number): number {
    const d = Math.max(0, Math.floor(distance));
    return Math.min(3, 1 + Math.floor(d / 4));
}

/** Food delivered by a full hold fished at Chebyshev distance `d`. */
export function fisherCatchValue(distance: number): number {
    return FISHER_BOAT_STORAGE * fisherFoodPerFish(distance);
}


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
