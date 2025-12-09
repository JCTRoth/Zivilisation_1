// Building Constants - Building types and properties

import { BuildingProperties } from './GameConstants';

export const BUILDING_TYPES = {
    // Ancient Era
    BARRACKS: 'barracks',
    GRANARY: 'granary',
    TEMPLE: 'temple',
    MARKETPLACE: 'marketplace',
    LIBRARY: 'library',
    COURTHOUSE: 'courthouse',
    CITY_WALLS: 'city_walls',

    // Medieval Era
    AQUEDUCT: 'aqueduct',
    BANK: 'bank',
    CATHEDRAL: 'cathedral',
    UNIVERSITY: 'university',
    COLOSSEUM: 'colosseum',
    FORGE: 'forge',

    // Renaissance Era
    FACTORY: 'factory',
    HOSPITAL: 'hospital',
    HYDRO_PLANT: 'hydro_plant',
    MASS_TRANSIT: 'mass_transit',
    NUCLEAR_PLANT: 'nuclear_plant',
    POWER_PLANT: 'power_plant',
    RECYCLING_CENTER: 'recycling_center',
    SDI_DEFENSE: 'sdi_defense',
    STOCK_EXCHANGE: 'stock_exchange',

    // Wonders
    GREAT_WALL: 'great_wall',
    HANGING_GARDENS: 'hanging_gardens',
    LIGHTHOUSE: 'lighthouse',
    ORACLE: 'oracle',
    PYRAMIDS: 'pyramids',
    MAGELLANS_VOYAGE: 'magellans_voyage',
    MICHELANGELO: 'michelangelo',
    NEWTON: 'newton',
    UNITED_NATIONS: 'united_nations',
    WOMENS_SUFFRAGE: 'womens_suffrage'
} as const;

export const BUILDING_PROPERTIES: Record<string, BuildingProperties> = {
    [BUILDING_TYPES.BARRACKS]: {
        name: 'Barracks',
        cost: 40,
        maintenance: 1,
        requiredTechnology: 'bronze_working',
        effects: {
            unitProduction: 1,
            veteranUnits: true
        },
        description: 'Increases the production of military units and produces veteran units',
        icon: '🏛️'
    },
    [BUILDING_TYPES.GRANARY]: {
        name: 'Granary',
        cost: 60,
        maintenance: 1,
        requiredTechnology: 'pottery',
        effects: {
            foodStorage: 2,
            growthBonus: 1
        },
        description: 'Increases food storage capacity and helps cities grow faster',
        icon: '🌾'
    },
    [BUILDING_TYPES.TEMPLE]: {
        name: 'Temple',
        cost: 40,
        maintenance: 1,
        requiredTechnology: 'ceremonial_burial',
        effects: {
            happiness: 1,
            culture: 1
        },
        description: 'Increases happiness and culture in the city',
        icon: '⛩️'
    },
    [BUILDING_TYPES.MARKETPLACE]: {
        name: 'Marketplace',
        cost: 80,
        maintenance: 1,
        requiredTechnology: 'currency',
        effects: {
            trade: 1,
            corruptionReduction: 0.5
        },
        description: 'Increases trade revenue and reduces corruption',
        icon: '🏪'
    },
    [BUILDING_TYPES.LIBRARY]: {
        name: 'Library',
        cost: 80,
        maintenance: 1,
        requiredTechnology: 'writing',
        effects: {
            science: 1,
            culture: 1
        },
        description: 'Increases science production and culture',
        icon: '📚'
    },
    [BUILDING_TYPES.COURTHOUSE]: {
        name: 'Courthouse',
        cost: 80,
        maintenance: 1,
        requiredTechnology: 'code_of_laws',
        effects: {
            corruptionReduction: 0.8,
            happiness: 1
        },
        description: 'Greatly reduces corruption and increases happiness',
        icon: '⚖️'
    },
    [BUILDING_TYPES.CITY_WALLS]: {
        name: 'City Walls',
        cost: 120,
        maintenance: 2,
        requiredTechnology: 'masonry',
        effects: {
            defense: 2,
            happiness: -1
        },
        description: 'Increases city defense but reduces happiness',
        icon: '🏰'
    },
    [BUILDING_TYPES.AQUEDUCT]: {
        name: 'Aqueduct',
        cost: 120,
        maintenance: 1,
        requiredTechnology: 'construction',
        effects: {
            health: 2,
            growthBonus: 1
        },
        description: 'Increases health and helps cities grow larger',
        icon: '🏛️'
    },
    [BUILDING_TYPES.BANK]: {
        name: 'Bank',
        cost: 120,
        maintenance: 1,
        effects: {
            trade: 2,
            corruptionReduction: 0.5
        },
        description: 'Increases trade revenue and reduces corruption',
        icon: '🏦'
    },
    [BUILDING_TYPES.CATHEDRAL]: {
        name: 'Cathedral',
        cost: 160,
        maintenance: 2,
        effects: {
            happiness: 3,
            culture: 2
        },
        description: 'Greatly increases happiness and culture',
        icon: '⛪'
    },
    [BUILDING_TYPES.UNIVERSITY]: {
        name: 'University',
        cost: 160,
        maintenance: 2,
        effects: {
            science: 2,
            culture: 1
        },
        description: 'Increases science production and culture',
        icon: '🎓'
    },
    [BUILDING_TYPES.COLOSSEUM]: {
        name: 'Colosseum',
        cost: 100,
        maintenance: 1,
        effects: {
            happiness: 2,
            culture: 1
        },
        description: 'Increases happiness and culture through entertainment',
        icon: '🏟️'
    },
    [BUILDING_TYPES.FORGE]: {
        name: 'Forge',
        cost: 80,
        maintenance: 1,
        effects: {
            production: 1,
            unitProduction: 1
        },
        description: 'Increases production and military unit production',
        icon: '⚒️'
    },
    [BUILDING_TYPES.FACTORY]: {
        name: 'Factory',
        cost: 200,
        maintenance: 3,
        effects: {
            production: 2,
            pollution: 2
        },
        description: 'Greatly increases production but causes pollution',
        icon: '🏭'
    },
    [BUILDING_TYPES.HOSPITAL]: {
        name: 'Hospital',
        cost: 120,
        maintenance: 1,
        effects: {
            health: 2,
            happiness: 1
        },
        description: 'Increases health and happiness',
        icon: '🏥'
    },
    [BUILDING_TYPES.HYDRO_PLANT]: {
        name: 'Hydro Plant',
        cost: 240,
        maintenance: 2,
        effects: {
            production: 1,
            pollution: -2
        },
        description: 'Increases production and reduces pollution',
        icon: '💧'
    },
    [BUILDING_TYPES.MASS_TRANSIT]: {
        name: 'Mass Transit',
        cost: 160,
        maintenance: 2,
        effects: {
            happiness: 2,
            pollution: -1
        },
        description: 'Increases happiness and reduces pollution',
        icon: '🚇'
    },
    [BUILDING_TYPES.NUCLEAR_PLANT]: {
        name: 'Nuclear Plant',
        cost: 160,
        maintenance: 2,
        effects: {
            production: 2,
            pollution: 3
        },
        description: 'Greatly increases production but causes significant pollution',
        icon: '☢️'
    },
    [BUILDING_TYPES.POWER_PLANT]: {
        name: 'Power Plant',
        cost: 160,
        maintenance: 2,
        effects: {
            production: 1,
            pollution: 2
        },
        description: 'Increases production but causes pollution',
        icon: '⚡'
    },
    [BUILDING_TYPES.RECYCLING_CENTER]: {
        name: 'Recycling Center',
        cost: 200,
        maintenance: 2,
        effects: {
            pollution: -3,
            production: 1
        },
        description: 'Greatly reduces pollution and increases production',
        icon: '♻️'
    },
    [BUILDING_TYPES.SDI_DEFENSE]: {
        name: 'SDI Defense',
        cost: 200,
        maintenance: 4,
        effects: {
            missileDefense: true,
            culture: 1
        },
        description: 'Provides missile defense and increases culture',
        icon: '🛡️'
    },
    [BUILDING_TYPES.STOCK_EXCHANGE]: {
        name: 'Stock Exchange',
        cost: 160,
        maintenance: 2,
        effects: {
            trade: 3,
            corruptionReduction: 0.8
        },
        description: 'Greatly increases trade and reduces corruption',
        icon: '📈'
    }
};

export const WONDER_PROPERTIES: Record<string, BuildingProperties> = {
    [BUILDING_TYPES.GREAT_WALL]: {
        name: 'Great Wall',
        cost: 300,
        maintenance: 0,
        effects: {
            globalDefense: 1,
            culture: 2,
            wonder: true
        },
        icon: '🏯'
    },
    [BUILDING_TYPES.HANGING_GARDENS]: {
        name: 'Hanging Gardens',
        cost: 300,
        maintenance: 0,
        effects: {
            globalHappiness: 1,
            culture: 2,
            wonder: true
        },
        icon: '🌿'
    },
    [BUILDING_TYPES.LIGHTHOUSE]: {
        name: 'Lighthouse',
        cost: 200,
        maintenance: 0,
        effects: {
            navalMovement: 1,
            trade: 1,
            wonder: true
        },
        icon: '🏮'
    },
    [BUILDING_TYPES.ORACLE]: {
        name: 'Oracle',
        cost: 300,
        maintenance: 0,
        effects: {
            science: 2,
            culture: 2,
            wonder: true
        },
        icon: '🔮'
    },
    [BUILDING_TYPES.PYRAMIDS]: {
        name: 'Pyramids',
        cost: 300,
        maintenance: 0,
        effects: {
            culture: 3,
            wonder: true
        },
        icon: '🏗️'
    },
    [BUILDING_TYPES.MAGELLANS_VOYAGE]: {
        name: 'Magellan\'s Voyage',
        cost: 400,
        maintenance: 0,
        effects: {
            navalMovement: 2,
            exploration: true,
            wonder: true
        },
        icon: '🗺️'
    },
    [BUILDING_TYPES.MICHELANGELO]: {
        name: 'Michelangelo\'s Chapel',
        cost: 400,
        maintenance: 0,
        effects: {
            culture: 3,
            wonder: true
        },
        icon: '🎨'
    },
    [BUILDING_TYPES.NEWTON]: {
        name: 'Newton\'s University',
        cost: 400,
        maintenance: 0,
        effects: {
            science: 3,
            wonder: true
        },
        icon: '🧮'
    },
    [BUILDING_TYPES.UNITED_NATIONS]: {
        name: 'United Nations',
        cost: 600,
        maintenance: 0,
        effects: {
            diplomacy: true,
            culture: 2,
            wonder: true
        },
        icon: '🌍'
    },
    [BUILDING_TYPES.WOMENS_SUFFRAGE]: {
        name: 'Women\'s Suffrage',
        cost: 600,
        maintenance: 0,
        effects: {
            happiness: 2,
            culture: 2,
            wonder: true
        },
        icon: '🗳️'
    }
};

export const BUILDING_PREREQUISITES = {
    [BUILDING_TYPES.AQUEDUCT]: [BUILDING_TYPES.TEMPLE],
    [BUILDING_TYPES.BANK]: [BUILDING_TYPES.MARKETPLACE],
    [BUILDING_TYPES.CATHEDRAL]: [BUILDING_TYPES.TEMPLE],
    [BUILDING_TYPES.UNIVERSITY]: [BUILDING_TYPES.LIBRARY],
    [BUILDING_TYPES.FACTORY]: [BUILDING_TYPES.FORGE],
    [BUILDING_TYPES.HYDRO_PLANT]: [BUILDING_TYPES.FACTORY],
    [BUILDING_TYPES.NUCLEAR_PLANT]: [BUILDING_TYPES.FACTORY],
    [BUILDING_TYPES.POWER_PLANT]: [BUILDING_TYPES.FACTORY],
    [BUILDING_TYPES.STOCK_EXCHANGE]: [BUILDING_TYPES.BANK]
} as const;