/**
 * Civilization I Game Data
 * Historical civilizations, leaders, technologies, wonders, and units
 */

export interface Civilization {
  name: string;
  leader: string;
  color: string;
  cityNames: string[];
  icon: string;
}

export interface Technology {
  id: string;
  name: string;
  era: string;
  cost: number;
  prerequisites: string[];
  enables: string[];
  description: string;
}

export interface Wonder {
  id: string;
  name: string;
  cost: number;
  requires: string;
  effect: string;
  description: string;
}

export interface UnitType {
  id: string;
  name: string;
  cost: number;
  attack: number;
  defense: number;
  movement: number;
  sightRange: number;
  icon: string;
  requires: string | null;
  description: string;
}

export interface Building {
  id: string;
  name: string;
  cost: number;
  maintenance: number;
  requires: string | null;
  effect: string;
  description: string;
}

export interface Government {
  id: string;
  name: string;
  requires: string | null;
  corruption: string;
  unitSupport: string;
  description: string;
}

export interface VictoryCondition {
  id: string;
  name: string;
  description: string;
  requires?: string[];
}

export interface DifficultyLevel {
  name: string;
  aiBonus: number;
  barbarianFrequency: number;
}

// Civilizations from original Civ1
export const CIVILIZATIONS: Civilization[] = [
  {
    name: 'Americans',
    leader: 'Abraham Lincoln',
    color: '#0000FF', // Blue - stars and stripes
    cityNames: ['Washington', 'New York', 'Boston', 'Philadelphia', 'Atlanta', 'Chicago', 'Seattle', 'San Francisco', 'Los Angeles', 'Detroit'],
    icon: '🦅'
  },
  {
    name: 'Aztecs',
    leader: 'Montezuma',
    color: '#009220ff', // Teal - Jungle gree
    cityNames: ['Tenochtitlan', 'Texcoco', 'Tlatelolco', 'Teotihuacan', 'Tlaxcala', 'Cholula', 'Xochicalco', 'Tula'],
    icon: '🐆'
  },
  {
    name: 'Babylonians',
    leader: 'Hammurabi',
    color: '#ff954fff', // Lime - ancient Mesopotamian gold/yellow-green
    cityNames: ['Babylon', 'Ur', 'Nineveh', 'Ashur', 'Eridu', 'Uruk', 'Lagash', 'Nippur'],
    icon: '🏺'
  },
  {
    name: 'Chinese',
    leader: 'Mao Tse Tung',
    color: '#fbff00ff', // Green - traditional Chinese color
    cityNames: ['Beijing', 'Shanghai', 'Guangzhou', 'Nanjing', 'Xian', 'Chengdu', 'Hangzhou', 'Tianjin', 'Wuhan'],
    icon: '🐉'
  },
  {
    name: 'Egyptians',
    leader: 'Ramesses II',
    color: '#ffbb00ff', // Yellow - Egyptian gold/sand
    cityNames: ['Thebes', 'Memphis', 'Heliopolis', 'Alexandria', 'Giza', 'Luxor', 'Aswan', 'Karnak'],
    icon: '𓂀'
  },
  {
    name: 'English',
    leader: 'Elizabeth I',
    color: '#ff0000ff', // Red was on two of their historical flags
    cityNames: ['London', 'York', 'Nottingham', 'Oxford', 'Cambridge', 'Canterbury', 'Coventry', 'Warwick', 'Newcastle'],
    icon: '🇬🇧'
  },
  {
    name: 'Germans',
    leader: 'Frederick the Great',
    color: '#949494',
    cityNames: ['Berlin', 'Leipzig', 'Hamburg', 'Bremen', 'Frankfurt', 'Bonn', 'Nuremberg', 'Cologne', 'Munich', 'Darmstadt', 'Mannheim','Heidelberg'],
    icon: '✠'
  },
  {
    name: 'French',
    leader: 'Napoleon Bonaparte',
    color: '#fffffff6', // capitulation white
    cityNames: ['Paris', 'Orleans', 'Lyon', 'Tours', 'Marseille', 'Chartres', 'Avignon', 'Rouen', 'Grenoble'],
    icon: '🇫🇷🥖'
  },
  {
    name: 'Greeks',
    leader: 'Alexander the Great',
    color: '#1269c5', 
    cityNames: ['Athens', 'Sparta', 'Corinth', 'Delphi', 'Thebes', 'Ephesus', 'Rhodes', 'Byzantium', 'Pergamon'],
    icon: '🏛️'
  },
  {
    name: 'Indians',
    leader: 'Mahatma Gandhi',
    color: '#ff681a',
    cityNames: ['Delhi', 'Bombay', 'Madras', 'Bangalore', 'Calcutta', 'Lahore', 'Karachi', 'Hyderabad'],
    icon: '🇮🇳'
  },
  {
    name: 'Huns',
    leader: 'Dschingis Khan',
    color: '#00ADC3',
    cityNames: ['Almaty', 'Shymkent', 'Karaganda', 'Taraz', 'Aktobe', 'Pavlodar', 'Oskemen', 'Semey', 'Oral', 'Astana'],
    icon: '🐎🏹'
  },
  {
    name: 'Romans',
    leader: 'Julius Caesar',
    color: '#080308ff',
    cityNames: ['Rome', 'Capua', 'Veii', 'Pompeii', 'Antium', 'Cumae', 'Neapolis', 'Ravenna', 'Verona'],
    icon: '⚔️'
  },
  {
    name: 'Russians',
    leader: 'Joseph Stalin',
    color: '#D00000',
    cityNames: ['Kiev','Novgorod','Chernigov','Smolensk','Moscow', 'Leningrad', 'Minsk', 'Odessa', 'Sevastopol', 'Tula', 'Stalingrad'],
    icon: '☭'
  },
  {
    name: 'Zulus',
    leader: 'Shaka',
    color: '#8B4513',
    cityNames: ['Zimbabwe', 'Ulundi', 'Bapedi', 'Hlobane', 'Isandhlwana', 'Intombe', 'Mpondo', 'Swazi'],
    icon: '🛡️'
  }
];

// Technology Tree (simplified from Civ1)
export const TECHNOLOGIES: Record<string, Technology> = {
  // Ancient Era
  POTTERY: {
    id: 'pottery',
    name: 'Pottery',
    era: 'ancient',
    cost: 6,
    prerequisites: [],
    enables: ['granary'],
    description: 'Allows construction of Granaries'
  },
  THE_WHEEL: {
    id: 'the_wheel',
    name: 'The Wheel',
    era: 'ancient',
    cost: 6,
    prerequisites: [],
    enables: ['chariot'],
    description: 'Enables Chariots and road building'
  },
  ALPHABET: {
    id: 'alphabet',
    name: 'Alphabet',
    era: 'ancient',
    cost: 6,
    prerequisites: [],
    enables: ['writing'],
    description: 'Foundation of written language'
  },
  BRONZE_WORKING: {
    id: 'bronze_working',
    name: 'Bronze Working',
    era: 'ancient',
    cost: 8,
    prerequisites: [],
    enables: ['phalanx', 'barracks'],
    description: 'Enables Phalanx and Barracks'
  },
  CEREMONIAL_BURIAL: {
    id: 'ceremonial_burial',
    name: 'Ceremonial Burial',
    era: 'ancient',
    cost: 6,
    prerequisites: [],
    enables: ['temple'],
    description: 'Allows construction of Temples'
  },
  HORSEBACK_RIDING: {
    id: 'horseback_riding',
    name: 'Horseback Riding',
    era: 'ancient',
    cost: 10,
    prerequisites: [],
    enables: ['horsemen'],
    description: 'Enables Horsemen units'
  },
  WRITING: {
    id: 'writing',
    name: 'Writing',
    era: 'ancient',
    cost: 8,
    prerequisites: ['alphabet'],
    enables: ['library'],
    description: 'Allows construction of Libraries'
  },
  CODE_OF_LAWS: {
    id: 'code_of_laws',
    name: 'Code of Laws',
    era: 'ancient',
    cost: 8,
    prerequisites: ['alphabet'],
    enables: ['courthouse'],
    description: 'Allows construction of Courthouses'
  },
  MYSTICISM: {
    id: 'mysticism',
    name: 'Mysticism',
    era: 'ancient',
    cost: 10,
    prerequisites: ['ceremonial_burial'],
    enables: ['oracle'],
    description: 'Enables Oracle wonder'
  },
  MATHEMATICS: {
    id: 'mathematics',
    name: 'Mathematics',
    era: 'ancient',
    cost: 10,
    prerequisites: ['alphabet', 'pottery'],
    enables: ['catapult'],
    description: 'Enables Catapults'
  },
  MAP_MAKING: {
    id: 'map_making',
    name: 'Map Making',
    era: 'ancient',
    cost: 12,
    prerequisites: ['alphabet'],
    enables: ['trireme'],
    description: 'Enables Trireme ships'
  },
  
  // Classical Era
  IRON_WORKING: {
    id: 'iron_working',
    name: 'Iron Working',
    era: 'classical',
    cost: 12,
    prerequisites: ['bronze_working'],
    enables: ['legion', 'iron_mine'],
    description: 'Enables Legion and Iron Mines'
  },
  CURRENCY: {
    id: 'currency',
    name: 'Currency',
    era: 'classical',
    cost: 12,
    prerequisites: ['bronze_working'],
    enables: ['marketplace'],
    description: 'Allows construction of Marketplaces'
  },
  CONSTRUCTION: {
    id: 'construction',
    name: 'Construction',
    era: 'classical',
    cost: 16,
    prerequisites: ['pottery', 'currency'],
    enables: ['colosseum', 'aqueduct'],
    description: 'Enables Colosseum and Aqueduct'
  },
  REPUBLIC: {
    id: 'republic',
    name: 'Republic',
    era: 'classical',
    cost: 16,
    prerequisites: ['code_of_laws', 'literacy'],
    enables: ['republic_government'],
    description: 'Enables Republic government'
  },
  MONARCHY: {
    id: 'monarchy',
    name: 'Monarchy',
    era: 'classical',
    cost: 14,
    prerequisites: ['ceremonial_burial', 'code_of_laws'],
    enables: ['monarchy_government'],
    description: 'Enables Monarchy government'
  },
  
  // Medieval Era
  FEUDALISM: {
    id: 'feudalism',
    name: 'Feudalism',
    era: 'medieval',
    cost: 20,
    prerequisites: ['monarchy'],
    enables: ['pikemen'],
    description: 'Enables Pikemen'
  },
  GUNPOWDER: {
    id: 'gunpowder',
    name: 'Gunpowder',
    era: 'medieval',
    cost: 40,
    prerequisites: ['iron_working', 'invention'],
    enables: ['musketeer'],
    description: 'Enables Musketeers'
  },
  
  // Renaissance Era
  DEMOCRACY: {
    id: 'democracy',
    name: 'Democracy',
    era: 'renaissance',
    cost: 60,
    prerequisites: ['republic', 'industrialization'],
    enables: ['democracy_government'],
    description: 'Enables Democracy government'
  },
  
  // Industrial Era
  RAILROAD: {
    id: 'railroad',
    name: 'Railroad',
    era: 'industrial',
    cost: 50,
    prerequisites: ['steam_engine'],
    enables: ['railroad_improvement'],
    description: 'Enables Railroad construction'
  },
  
  // Modern Era
  ROCKETRY: {
    id: 'rocketry',
    name: 'Rocketry',
    era: 'modern',
    cost: 80,
    prerequisites: ['advanced_flight'],
    enables: ['space_program'],
    description: 'Enables Space Program'
  },
  SPACE_FLIGHT: {
    id: 'space_flight',
    name: 'Space Flight',
    era: 'modern',
    cost: 100,
    prerequisites: ['rocketry', 'computers'],
    enables: ['apollo_program', 'spaceship'],
    description: 'Required for space race victory'
  }
};

// Wonders of the World
export const WONDERS: Record<string, Wonder> = {
  PYRAMIDS: {
    id: 'pyramids',
    name: 'Pyramids',
    cost: 200,
    requires: 'pottery',
    effect: 'Granary in every city',
    description: 'Acts as a Granary in every city on the same continent'
  },
  HANGING_GARDENS: {
    id: 'hanging_gardens',
    name: 'Hanging Gardens',
    cost: 200,
    requires: 'pottery',
    effect: '+1 happy citizen in every city',
    description: 'Makes 1 content citizen happy in every city'
  },
  COLOSSUS: {
    id: 'colossus',
    name: 'Colossus',
    cost: 200,
    requires: 'bronze_working',
    effect: '+1 trade in every square',
    description: '+1 trade in every square producing trade'
  },
  LIGHTHOUSE: {
    id: 'lighthouse',
    name: 'Lighthouse',
    cost: 200,
    requires: 'map_making',
    effect: 'Trireme movement +1',
    description: 'Triremes can move safely on sea squares'
  },
  GREAT_LIBRARY: {
    id: 'great_library',
    name: 'Great Library',
    cost: 300,
    requires: 'literacy',
    effect: 'Free technologies',
    description: 'Gives you any technology discovered by two other civilizations'
  },
  ORACLE: {
    id: 'oracle',
    name: 'Oracle',
    cost: 300,
    requires: 'mysticism',
    effect: 'Temple in every city',
    description: 'Acts as a Temple in every city'
  },
  GREAT_WALL: {
    id: 'great_wall',
    name: 'Great Wall',
    cost: 300,
    requires: 'pottery',
    effect: 'Defense bonus',
    description: 'Doubles defense of all cities against barbarians'
  },
  COPERNICUS_OBSERVATORY: {
    id: 'copernicus',
    name: "Copernicus' Observatory",
    cost: 300,
    requires: 'astronomy',
    effect: '+50% science',
    description: '+50% science in the city where it is built'
  },
  ISAAC_NEWTONS_COLLEGE: {
    id: 'newtons_college',
    name: "Isaac Newton's College",
    cost: 400,
    requires: 'theory_of_gravity',
    effect: '+50% science globally',
    description: 'Doubles science output in the city'
  },
  APOLLO_PROGRAM: {
    id: 'apollo_program',
    name: 'Apollo Program',
    cost: 600,
    requires: 'space_flight',
    effect: 'Enables spaceship',
    description: 'Required to build spaceship parts for space race victory'
  }
};

// Unit Types
export const UNIT_TYPES: Record<string, UnitType> = {
  // Non-combat units
  SETTLERS: {
    id: 'settlers',
    name: 'Settlers',
    cost: 40,
    attack: 0,
    defense: 0,
    movement: 1,
    sightRange: 2,
    icon: '👷',
    requires: null,
    description: 'Non-combat: builds cities & improvements'
  },
  CARAVAN: {
    id: 'caravan',
    name: 'Caravan',
    cost: 50,
    attack: 0,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '🛺',
    requires: 'trade',
    description: 'Non-combat: trade unit'
  },
  DIPLOMAT: {
    id: 'diplomat',
    name: 'Diplomat',
    cost: 20,
    attack: 0,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '🕊️',
    requires: 'writing',
    description: 'Non-combat: diplomacy'
  },
  WAGON: {
    id: 'wagon',
    name: 'Wagon',
    cost: 20,
    attack: 0,
    defense: 0,
    movement: 2,
    sightRange: 1,
    icon: '🛞',
    requires: 'the_wheel',
    description: 'Non-combat: transport'
  },
  
  // Infantry units
  MILITIA: {
    id: 'militia',
    name: 'Militia',
    cost: 10,
    attack: 1,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '🪖',
    requires: null,
    description: 'Basic early infantry'
  },
  PHALANX: {
    id: 'phalanx',
    name: 'Phalanx',
    cost: 20,
    attack: 1,
    defense: 2,
    movement: 1,
    sightRange: 1,
    icon: '🛡️',
    requires: 'bronze_working',
    description: 'Defensive ancient infantry'
  },
  LEGION: {
    id: 'legion',
    name: 'Legion',
    cost: 20,
    attack: 3,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '⚔️',
    requires: 'iron_working',
    description: 'Offensive ancient infantry'
  },
  MUSKETEERS: {
    id: 'musketeers',
    name: 'Musketeers',
    cost: 30,
    attack: 2,
    defense: 3,
    movement: 1,
    sightRange: 1,
    icon: '🔫',
    requires: 'gunpowder',
    description: 'Gunpowder infantry'
  },
  RIFLEMEN: {
    id: 'riflemen',
    name: 'Riflemen',
    cost: 30,
    attack: 3,
    defense: 5,
    movement: 1,
    sightRange: 1,
    icon: '🎯',
    requires: 'conscription',
    description: 'Advanced infantry'
  },
  MECHANIZED_INFANTRY: {
    id: 'mechanized_infantry',
    name: 'Mechanized Infantry',
    cost: 50,
    attack: 6,
    defense: 6,
    movement: 3,
    sightRange: 2,
    icon: '🚜',
    requires: 'labor_union',
    description: 'Modern infantry with high mobility'
  },
  
  // Cavalry units
  CAVALRY: {
    id: 'cavalry',
    name: 'Cavalry',
    cost: 40,
    attack: 4,
    defense: 1,
    movement: 2,
    sightRange: 2,
    icon: '🐎',
    requires: 'horseback_riding',
    description: 'Early fast cavalry'
  },
  CHARIOT: {
    id: 'chariot',
    name: 'Chariot',
    cost: 40,
    attack: 4,
    defense: 1,
    movement: 2,
    sightRange: 2,
    icon: '🛶',
    requires: 'the_wheel',
    description: 'Ancient fast cavalry'
  },
  KNIGHTS: {
    id: 'knights',
    name: 'Knights',
    cost: 40,
    attack: 4,
    defense: 2,
    movement: 2,
    sightRange: 2,
    icon: '♞',
    requires: 'chivalry',
    description: 'Medieval cavalry with balanced stats'
  },
  ARMOR: {
    id: 'armor',
    name: 'Armor',
    cost: 80,
    attack: 8,
    defense: 8,
    movement: 4,
    sightRange: 2,
    // replacement for a corrupted emoji sequence — use a short text fallback
    icon: 'TANK',
    requires: 'automobile',
    description: 'Heavy modern tank'
  },
  
  // Artillery units
  ARTILLERY: {
    id: 'artillery',
    name: 'Artillery',
    cost: 40,
    attack: 6,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '💣',
    requires: 'mathematics',
    description: 'Early artillery unit'
  },
  CANNON: {
    id: 'cannon',
    name: 'Cannon',
    cost: 40,
    attack: 8,
    defense: 1,
    movement: 1,
    sightRange: 1,
    icon: '🎯',
    requires: 'metallurgy',
    description: 'Improved artillery'
  },
  
  // Naval units
  TRIREME: {
    id: 'trireme',
    name: 'Trireme',
    cost: 40,
    attack: 1,
    defense: 0,
    movement: 3,
    sightRange: 2,
    icon: '⛵',
    requires: 'map_making',
    description: 'Early naval transport/exploration'
  },
  SAILING_SHIP: {
    id: 'sailing_ship',
    name: 'Sailing Ship',
    cost: 60,
    attack: 1,
    defense: 2,
    movement: 3,
    sightRange: 2,
    icon: '⛵',
    requires: 'navigation',
    description: 'Early weaponized naval ship'
  },
  FRIGATE: {
    id: 'frigate',
    name: 'Frigate',
    cost: 80,
    attack: 4,
    defense: 4,
    movement: 4,
    sightRange: 2,
    icon: '🚢',
    requires: 'magnetism',
    description: 'Mid-game naval combat ship'
  },
  IRONCLAD: {
    id: 'ironclad',
    name: 'Ironclad',
    cost: 100,
    attack: 8,
    defense: 8,
    movement: 4,
    sightRange: 2,
    icon: '🛳️',
    requires: 'steam_engine',
    description: 'Early armored naval ship'
  },
  CRUISER: {
    id: 'cruiser',
    name: 'Cruiser',
    cost: 100,
    attack: 10,
    defense: 8,
    movement: 4,
    sightRange: 2,
    icon: '🚢',
    requires: 'combustion',
    description: 'Late-game naval attack ship'
  },
  BATTLESHIP: {
    id: 'battleship',
    name: 'Battleship',
    cost: 160,
    attack: 18,
    defense: 12,
    movement: 4,
    sightRange: 2,
    icon: '🛥️',
    requires: 'steel',
    description: 'Powerful late-game naval battleship'
  },
  CARRIER: {
    id: 'carrier',
    name: 'Carrier',
    cost: 160,
    attack: 6,
    defense: 10,
    movement: 4,
    sightRange: 2,
    icon: '✈️',
    requires: 'advanced_flight',
    description: 'Naval air unit carrier'
  },
  SUBMARINE: {
    id: 'submarine',
    name: 'Submarine',
    cost: 120,
    attack: 14,
    defense: 7,
    movement: 4,
    sightRange: 2,
    // replacement for a corrupted emoji sequence — use a short text fallback
    icon: 'SUB',
    requires: 'mass_production',
    description: 'Stealthy naval attacker'
  },
  TRANSPORT: {
    id: 'transport',
    name: 'Transport',
    cost: 40,
    attack: 0,
    defense: 1,
    movement: 3,
    sightRange: 2,
    icon: '🚢',
    requires: 'industrialization',
    description: 'Naval troop transport unit'
  },
  
  // Air units
  FIGHTER: {
    id: 'fighter',
    name: 'Fighter',
    cost: 60,
    attack: 4,
    defense: 2,
    movement: 10,
    sightRange: 3,
    icon: '🛩️',
    requires: 'flight',
    description: 'Late game fast air unit'
  },
  BOMBER: {
    id: 'bomber',
    name: 'Bomber',
    cost: 120,
    attack: 12,
    defense: 1,
    movement: 8,
    sightRange: 2,
    icon: '✈️',
    requires: 'advanced_flight',
    description: 'Heavy air attack unit'
  },
  NUCLEAR_MISSILE: {
    id: 'nuclear_missile',
    name: 'Nuclear Missile',
    cost: 200,
    attack: 99,
    defense: 0,
    movement: 20,
    sightRange: 0,
    icon: '☢️',
    requires: 'rocketry',
    description: 'Ultimate area-effect weapon (air)'
  }
};


// Government Types
export const GOVERNMENTS: Record<string, Government> = {
  DESPOTISM: {
    id: 'despotism',
    name: 'Despotism',
    requires: null,
    corruption: 'high',
    unitSupport: 'free',
    description: 'Starting government. High corruption, free unit support'
  },
  MONARCHY: {
    id: 'monarchy',
    name: 'Monarchy',
    requires: 'monarchy',
    corruption: 'medium',
    unitSupport: 'low',
    description: 'Medium corruption, low unit costs'
  },
  REPUBLIC: {
    id: 'republic',
    name: 'Republic',
    requires: 'republic',
    corruption: 'low',
    unitSupport: 'medium',
    description: 'Low corruption, medium unit costs, trade bonus'
  },
  DEMOCRACY: {
    id: 'democracy',
    name: 'Democracy',
    requires: 'democracy',
    corruption: 'minimal',
    unitSupport: 'high',
    description: 'Minimal corruption, high unit costs, maximum trade'
  },
  COMMUNISM: {
    id: 'communism',
    name: 'Communism',
    requires: 'communism',
    corruption: 'low',
    unitSupport: 'medium',
    description: 'Low corruption, no senate, spies effective'
  }
};

// Victory Conditions
export const VICTORY_CONDITIONS: Record<string, VictoryCondition> = {
  CONQUEST: {
    id: 'conquest',
    name: 'Conquest Victory',
    description: 'Eliminate all other civilizations'
  },
  SPACE_RACE: {
    id: 'space_race',
    name: 'Space Race Victory',
    description: 'Launch spaceship and reach Alpha Centauri first',
    requires: ['apollo_program', 'spaceship_parts']
  },
  SCORE: {
    id: 'score',
    name: 'Score Victory',
    description: 'Highest civilization score at 2100 AD'
  }
};

// Game difficulty levels
export const DIFFICULTY_LEVELS: Record<string, DifficultyLevel> = {
  CHIEFTAIN: { name: 'Chieftain', aiBonus: 0, barbarianFrequency: 0.3 },
  WARLORD: { name: 'Warlord', aiBonus: 0.5, barbarianFrequency: 0.5 },
  PRINCE: { name: 'Prince', aiBonus: 1, barbarianFrequency: 0.7 },
  KING: { name: 'King', aiBonus: 1.5, barbarianFrequency: 0.9 },
  EMPEROR: { name: 'Emperor', aiBonus: 2, barbarianFrequency: 1.0 }
};
