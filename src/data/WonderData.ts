/**
 * WonderData — the single source of truth for the 22 World Wonders.
 *
 * Data-driven by design: every wonder is one entry in `WONDERS`. Adding a new
 * wonder means adding one object here — no engine or UI code has to change.
 *
 * Rules encoded here (see doc/WONDERS.md for the full data format):
 *  - Exactly 22 unique wonders, each buildable once in the whole game.
 *  - `cost` is a fixed shield cost (200–600); wonders have NO maintenance.
 *  - `requiredTechnology` unlocks construction; `obsoleteBy` (or null) is the
 *    technology that, discovered by ANY civilization, switches the effect off.
 *  - `era` is documentation-only flavour — it never affects mechanics.
 *  - `effects` is a typed list consumed by the WonderEffects engine.
 */

import type { City } from '../../types/game';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Documentation-only age. Never read by game rules. */
export type WonderEra = 'antiquity' | 'middle' | 'industrial';

/**
 * The typed effect list of a wonder. The WonderEffects engine switches on
 * `kind`; unknown kinds are ignored safely so old data never crashes.
 */
export type WonderEffect =
  /** +`amount` trade on every worked tile that already produces trade. */
  | { kind: 'tradePerTradeSquare'; scope: 'city' | 'civilization'; amount: number }
  /** +`percent`% science for every city in scope. */
  | { kind: 'sciencePercent'; scope: 'city' | 'civilization' | 'continent'; percent: number }
  /** +`percent`% production for every city in scope. */
  | { kind: 'productionPercent'; scope: 'continent'; percent: number }
  /**
   * +`amount` production for cities in scope. `requiresNoPowerPlant` limits it
   * to cities that have no power plant of their own (Hoover Dam).
   */
  | { kind: 'productionFlat'; scope: 'continent'; amount: number; requiresNoPowerPlant?: boolean }
  /** +`amount` happiness in every city in scope. */
  | { kind: 'happiness'; scope: 'city' | 'civilization' | 'continent'; amount: number }
  /** Convert up to `amount` unhappy citizens to content in every city in scope. */
  | { kind: 'unhappyToContent'; scope: 'city' | 'continent'; amount: number }
  /** Multiply the happiness of `buildingType` in all owner cities (Oracle, Michelangelo). */
  | { kind: 'buildingHappinessMultiplier'; buildingType: string; scope: 'civilization'; multiplier: number }
  /** Multiply the science granted by `buildings` in all owner cities (Newton). */
  | { kind: 'buildingScienceMultiplier'; buildings: string[]; scope: 'civilization'; multiplier: number }
  /** +`amount` movement points for the owner's sea units. */
  | { kind: 'navalMovement'; scope: 'civilization'; amount: number }
  /** +`amount` vision range for the owner's units and cities. */
  | { kind: 'visionRange'; scope: 'civilization'; amount: number }
  /** Government changes take only `turns` turns of anarchy (Pyramids). */
  | { kind: 'governmentAnarchyTurns'; scope: 'civilization'; turns: number }
  /** Obsolete units are automatically upgraded to their replacements (Leonardo). */
  | { kind: 'autoUpgradeUnits'; scope: 'civilization' }
  /** Enables the space race (Moonshot) for every civ once the wonder exists. */
  | { kind: 'enableSpaceship'; scope: 'global' }
  /** Enables nuclear weapons for every civ that has the technology. */
  | { kind: 'enableNuclear'; scope: 'global' }
  /** The owner sees every city on the map (ISS). */
  | { kind: 'revealAllCities'; scope: 'civilization' };

/** One of the 22 unique wonders. */
export interface WonderDefinition {
  /** Stable machine id (snake_case). Used in city.buildings and the save game. */
  id: string;
  /** Display name. */
  name: string;
  /** Fixed shield cost (200–600). */
  cost: number;
  /** Maintenance per turn — always 0 for wonders. */
  maintenance: number;
  /** Technology required before this wonder can be started. */
  requiredTechnology: string;
  /** Technology (discovered by ANY civ) that switches the effect off, or null = never obsolete. */
  obsoleteBy: string | null;
  /** Documentation-only age for the overview screen / Civilopedia. */
  era: WonderEra;
  /** Emoji badge — also the fallback when the artwork file is missing. */
  icon: string;
  /**
   * Path to the artwork under `public/`, e.g. `assets/wonders/colossus.jpg`.
   * Attribution for the file lives in `WONDER_ARTWORK_CREDITS` below; if the file
   * is ever missing, `WonderArtwork` falls back to a styled emoji placeholder.
   */
  image: string;
  /** One-line effect reminder (city screen, production list, overview card). */
  shortEffect: string;
  /** Full mechanical effect in plain language (completion screen, Civilopedia). */
  effectText: string;
  /** Short historical/flavour text shown on the completion screen. */
  flavor: string;
  /** "Did you know?" facts for the Civilopedia entry — only verified facts. */
  facts: string[];
  /** Typed effects consumed by the WonderEffects engine. */
  effects: WonderEffect[];
}

/** Colour-coded status of a wonder from the player's point of view. */
export type WonderStatus =
  /** Green — owned by the player. */
  | 'owned'
  /** Blue — the player is currently building it (nobody else is). */
  | 'building'
  /** Yellow — the player AND at least one rival are building it. */
  | 'contested'
  /** Red — owned or being built by another civilization only. */
  | 'rival'
  /** Grey — locked: the player has not researched the required technology. */
  | 'locked'
  /** Neutral — available and nobody is building it yet. */
  | 'available';

// ---------------------------------------------------------------------------
// The 22 wonders (chronological by real-world inspiration — flavour only)
// ---------------------------------------------------------------------------

export const WONDERS: readonly WonderDefinition[] = [
  // ── Antiquity (7) ───────────────────────────────────────────────────────
  {
    id: 'colossus',
    name: 'Colossus',
    cost: 200,
    maintenance: 0,
    requiredTechnology: 'bronze_working',
    obsoleteBy: 'electricity',
    era: 'antiquity',
    icon: '🗿',
    image: 'assets/wonders/colossus.jpg',
    shortEffect: '+1 trade per trade square (this city)',
    effectText: 'Every trade square worked by the city that builds the Colossus yields +1 extra trade.',
    flavor:
      'A towering bronze statue of the sun god Helios, raised on the island of Rhodes to celebrate a victorious siege — one of the Seven Wonders of the ancient world.',
    facts: [
      'The Colossus of Rhodes stood about 33 metres tall, roughly the height of the Statue of Liberty today.',
      'It stood for only about 54 years before an earthquake toppled it around 226 BC.',
      'Its ruins reportedly lay on the ground for centuries and were still a tourist attraction in late antiquity.',
    ],
    effects: [{ kind: 'tradePerTradeSquare', scope: 'city', amount: 1 }],
  },
  {
    id: 'great_library',
    name: 'Great Library',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'literacy',
    obsoleteBy: 'university',
    era: 'antiquity',
    icon: '📖',
    image: 'assets/wonders/great_library.jpg',
    shortEffect: '+10% science in all cities',
    effectText: 'All cities of the civilization that builds the Great Library produce +10% science.',
    flavor:
      'The legendary library of Alexandria, founded under the early Ptolemies, gathered the writings of the Mediterranean world in one place and became the symbol of collected knowledge.',
    facts: [
      'The library was part of the larger Mouseion, a research institution funded by the Ptolemaic kings of Egypt.',
      'Ancient writers claimed the Ptolemies seized ships visiting Alexandria and confiscated their books — copies were kept, the originals sometimes retained.',
      'Its decline spans centuries of war, fire and neglect rather than a single famous fire.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'civilization', percent: 10 }],
  },
  {
    id: 'hanging_gardens',
    name: 'Hanging Gardens',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'pottery',
    obsoleteBy: 'invention',
    era: 'antiquity',
    icon: '🌿',
    image: 'assets/wonders/hanging_gardens.jpg',
    shortEffect: '+1 happy here and in same-continent cities',
    effectText:
      'The city that builds the Hanging Gardens and every other city of the owner on the same continent gains +1 happiness.',
    flavor:
      'Ancient authors describe terraced gardens rising above the plain of Babylon, watered by engines lifting the Euphrates skyward — one of the Seven Wonders.',
    facts: [
      'The Hanging Gardens are the only one of the Seven Wonders whose existence is genuinely disputed.',
      'Babylonian records from the period describe Nebuchadnezzar II\'s palace but never mention a hanging garden.',
      'Some historians argue the gardens were really those of Nineveh, built by Sennacherib centuries later.',
    ],
    effects: [{ kind: 'happiness', scope: 'continent', amount: 1 }],
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    cost: 200,
    maintenance: 0,
    requiredTechnology: 'map_making',
    obsoleteBy: 'magnetism',
    era: 'antiquity',
    icon: '🕯️',
    image: 'assets/wonders/lighthouse.jpg',
    shortEffect: '+1 ship movement',
    effectText: 'All sea units of the civilization that builds the Lighthouse move +1 tile per turn.',
    flavor:
      'The Pharos of Alexandria, raised on the harbour island of Pharos, guided ships into the busiest port of the ancient world for over a millennium.',
    facts: [
      'The Pharos was among the tallest man-made structures in the world for many centuries, often estimated at around 100 metres.',
      'It gave its name to the word for "lighthouse" in several languages, including French (phare) and Spanish (faro).',
      'Successive earthquakes between the 10th and 14th centuries brought it down; its stones are thought to have been reused in a fortress offshore.',
    ],
    effects: [{ kind: 'navalMovement', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'oracle',
    name: 'Oracle',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'mysticism',
    obsoleteBy: 'religion',
    era: 'antiquity',
    icon: '🔮',
    image: 'assets/wonders/oracle.jpg',
    shortEffect: 'Doubles Temple effect in all cities',
    effectText: 'Temples of the civilization that builds the Oracle give twice their usual happiness in every city.',
    flavor:
      'The sanctuary of Apollo at Delphi, where the Pythia delivered prophecies to kings and city-states, was the most respected oracle of the Greek world.',
    facts: [
      'The Oracle of Delphi was pan-Hellenic: even rival cities sent embassies there for advice.',
      'The Pythia was a real priestess who delivered her answers in a trance, later interpreted by priests.',
      'The site sits above volcanic fumes — some researchers have proposed gases as part of the trance.',
    ],
    effects: [{ kind: 'buildingHappinessMultiplier', buildingType: 'temple', scope: 'civilization', multiplier: 2 }],
  },
  {
    id: 'pyramids',
    name: 'Pyramids',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'masonry',
    obsoleteBy: 'communism',
    era: 'antiquity',
    icon: '🏛️',
    image: 'assets/wonders/pyramids.jpg',
    shortEffect: 'Government change needs only 1 turn of anarchy',
    effectText:
      'The civilization that builds the Pyramids changes government with only 1 turn of anarchy instead of the usual 3.',
    flavor:
      'The pyramids of Giza, built as tombs for the pharaohs of the Fourth Dynasty, are the oldest surviving wonder and the only one still substantially intact.',
    facts: [
      'The Great Pyramid of Khufu was the tallest human-made structure on Earth for about 3,800 years.',
      'It is built from roughly 2.3 million stone blocks, each averaging about 2.5 tonnes.',
      'The pyramids were already ancient when Cleopatra ruled Egypt — she lived closer in time to the Moon landing than to their construction.',
    ],
    effects: [{ kind: 'governmentAnarchyTurns', scope: 'civilization', turns: 1 }],
  },
  {
    id: 'silk_road',
    name: 'Silk Road',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'map_making',
    obsoleteBy: null,
    era: 'antiquity',
    icon: '🐪',
    image: 'assets/wonders/silk_road.jpg',
    shortEffect: '+1 vision range for all units and cities',
    effectText:
      'All units and cities of the civilization that builds the Silk Road see one tile further — its caravans and traders carry word of distant lands.',
    flavor:
      'For more than a millennium, caravans threaded the routes between China and the Mediterranean, carrying silk, spices, gold, ideas and faiths across Asia. The Silk Road was never one road, but a web of them.',
    facts: [
      'The name "Silk Road" was coined by the German geographer Ferdinand von Richthofen in 1877.',
      'The routes flourished from about 130 BC, when the Han dynasty opened trade with Central Asia, until sea routes took over in the 15th century.',
      'Silk was only one of many goods: paper, gunpowder, horses, glass, spices and religions travelled the same paths.',
    ],
    effects: [{ kind: 'visionRange', scope: 'civilization', amount: 1 }],
  },

  // ── Middle Ages (7) ─────────────────────────────────────────────────────
  {
    id: 'copernicus_observatory',
    name: "Copernicus' Observatory",
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'astronomy',
    obsoleteBy: 'automobile',
    era: 'middle',
    icon: '🌌',
    image: 'assets/wonders/copernicus_observatory.jpg',
    shortEffect: 'Doubles science in this city',
    effectText: 'The city that builds Copernicus\' Observatory produces double science.',
    flavor:
      'From a tower in Frombork, Nicolaus Copernicus worked out that the Earth circles the Sun — and quietly rewrote humanity\'s place in the cosmos.',
    facts: [
      'Copernicus published his heliocentric theory in De revolutionibus orbium coelestium in 1543, the year he died.',
      'He was also a physician, economist and church administrator, not only an astronomer.',
      'The "Copernican Revolution" is still used as a byword for overturning a fixed worldview.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'city', percent: 100 }],
  },
  {
    id: 'isaac_newtons_college',
    name: "Isaac Newton's College",
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'theory_of_gravity',
    obsoleteBy: 'nuclear_fission',
    era: 'middle',
    icon: '🍎',
    image: 'assets/wonders/isaac_newtons_college.jpg',
    shortEffect: 'Doubles Library/University science in all cities',
    effectText:
      'In every city of the civilization that builds it, the science bonus from Libraries and Universities is doubled.',
    flavor:
      'Newton\'s Principia laid out the laws of motion and universal gravitation, making the heavens and the falling apple part of the same mathematics.',
    facts: [
      'Newton formulated calculus, the binomial series and the theory of colours during the plague years, when Cambridge sent him home.',
      'His famous phrase "standing on the shoulders of giants" appears in a letter to Robert Hooke.',
      'The Principia (1687) remained the foundation of physics for over two centuries.',
    ],
    effects: [
      {
        kind: 'buildingScienceMultiplier',
        buildings: ['library', 'university'],
        scope: 'civilization',
        multiplier: 2,
      },
    ],
  },
  {
    id: 'js_bachs_cathedral',
    name: "J.S. Bach's Cathedral",
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'religion',
    obsoleteBy: null,
    era: 'middle',
    icon: '🎻',
    image: 'assets/wonders/js_bachs_cathedral.jpg',
    shortEffect: '1 unhappy → content per continent city',
    effectText:
      'In every city of the owner on the same continent as the cathedral, 1 unhappy citizen is made content.',
    flavor:
      'Johann Sebastian Bach spent the last decades of his life composing sacred music in Leipzig — cantatas, passions and organ works that still fill cathedrals today.',
    facts: [
      'Bach (1685–1750) wrote well over 1,000 surviving works and held organist and cantor posts across central Germany.',
      'The St. Matthew Passion went unperformed for nearly a century after his death before Mendelssohn revived it in 1829.',
      'Bach\'s music was studied by Mozart, Beethoven and Brahms alike; the B in BWV stands for Bach.',
    ],
    effects: [{ kind: 'unhappyToContent', scope: 'continent', amount: 1 }],
  },
  {
    id: 'magellans_expedition',
    name: "Magellan's Expedition",
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'navigation',
    obsoleteBy: null,
    era: 'middle',
    icon: '⛵',
    image: 'assets/wonders/magellans_expedition.jpg',
    shortEffect: '+1 ship movement',
    effectText: 'All sea units of the civilization that completes Magellan\'s Expedition move +1 tile per turn.',
    flavor:
      'Five ships left Seville in 1519 to find a western route to the Spice Islands. One returned in 1522, having circled the entire globe.',
    facts: [
      'Ferdinand Magellan was killed in the Philippines in 1521; Juan Sebastián Elcano captained the Victoria home.',
      'Only 18 of the original crew of about 270 men completed the circumnavigation.',
      'The expedition discovered the strait at the tip of South America that now bears Magellan\'s name.',
    ],
    effects: [{ kind: 'navalMovement', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'michelangelos_chapel',
    name: "Michelangelo's Chapel",
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'religion',
    obsoleteBy: 'communism',
    era: 'middle',
    icon: '🎨',
    image: 'assets/wonders/michelangelos_chapel.jpg',
    shortEffect: '+50% Cathedral effect in all cities',
    effectText: 'Cathedrals of the civilization that builds the chapel give +50% happiness in every city.',
    flavor:
      'Between 1508 and 1512 Michelangelo painted the ceiling of the Sistine Chapel single-handedly, lying on scaffolding above the altar.',
    facts: [
      'The ceiling covers about 500 square metres and contains more than 300 figures.',
      'Michelangelo considered himself a sculptor first and resisted the painting commission.',
      'He returned decades later to paint The Last Judgment on the altar wall (1536–1541).',
    ],
    effects: [{ kind: 'buildingHappinessMultiplier', buildingType: 'cathedral', scope: 'civilization', multiplier: 1.5 }],
  },
  {
    id: 'shakespeare_theatre',
    name: "Shakespeare's Theatre",
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'medicine',
    obsoleteBy: 'electronics',
    era: 'middle',
    icon: '🎭',
    image: 'assets/wonders/shakespeare_theatre.jpg',
    shortEffect: '4 unhappy → content (this city)',
    effectText: 'In the city that builds the theatre, up to 4 unhappy citizens are made content.',
    flavor:
      'The Globe — "a wooden O" on the south bank of the Thames — premiered Hamlet, King Lear and Macbeth before packed playhouses of Londoners.',
    facts: [
      'Shakespeare (1564–1616) wrote 37 plays and 154 sonnets in a career of roughly two decades.',
      'The Globe burned down in 1613 when a cannon effect during Henry VIII set the thatch alight.',
      'The First Folio of 1623, assembled by fellow actors, is why half his plays survive at all.',
    ],
    effects: [{ kind: 'unhappyToContent', scope: 'city', amount: 4 }],
  },
  {
    id: 'leonardos_workshop',
    name: "Leonardo's Workshop",
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'invention',
    obsoleteBy: null,
    era: 'middle',
    icon: '🖋️',
    image: 'assets/wonders/leonardos_workshop.jpg',
    shortEffect: 'Automatically upgrades obsolete units',
    effectText:
      'Whenever the civilization that builds the workshop has units that are obsolete — because a better replacement is already available — those units are automatically upgraded to the modern type.',
    flavor:
      'Leonardo da Vinci filled thousands of notebook pages with flying machines, tanks and bridges, centuries before the engineering existed to build them.',
    facts: [
      'Leonardo (1452–1519) wrote his notebooks in mirror writing, which reads normally in a mirror.',
      'He left many works unfinished and completed relatively few paintings — yet those few reshaped art.',
      'His designs included a parachute, an armoured vehicle and a revolving bridge, all drawn but never built in his lifetime.',
    ],
    effects: [{ kind: 'autoUpgradeUnits', scope: 'civilization' }],
  },

  // ── Industrial / Modern Age (8) ─────────────────────────────────────────
  {
    id: 'international_space_station',
    name: 'International Space Station',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'space_flight',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🛰️',
    image: 'assets/wonders/international_space_station.jpg',
    shortEffect: 'Space race enabled · +20% science · all cities revealed',
    effectText:
      'The International Space Station enables the space race (Moonshot) for every civilization with the technology, grants +20% science in all cities of its owner, and reveals every city on the map to its owner.',
    flavor:
      'Since 1998 a modular laboratory has circled the Earth every 90 minutes, built and operated jointly by space agencies from the United States, Russia, Europe, Japan and Canada.',
    facts: [
      'The ISS has been continuously inhabited by crews since November 2000.',
      'At roughly 400 km altitude it is the brightest human-made object often visible crossing the night sky.',
      'More than 200 people from many countries have visited the station; its assembly required dozens of shuttle and rocket flights.',
    ],
    effects: [
      { kind: 'enableSpaceship', scope: 'global' },
      { kind: 'sciencePercent', scope: 'civilization', percent: 20 },
      { kind: 'revealAllCities', scope: 'civilization' },
    ],
  },
  {
    id: 'human_genome_project',
    name: 'Human Genome Project',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'genetic_engineering',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🧬',
    image: 'assets/wonders/human_genome_project.jpg',
    shortEffect: '+1 happy in every city',
    effectText: 'Every city of the civilization that completes the Human Genome Project gains +1 happiness.',
    flavor:
      'An international effort begun in 1990 set out to read all three billion letters of human DNA. Completed in 2003, it gave medicine a map of the human body\'s instruction book.',
    facts: [
      'The Human Genome Project ran from 1990 to 2003, with sequencing centres in the United States, Britain, France, Germany, Japan and China.',
      'It sequenced roughly 3 billion base pairs — the "letters" of human DNA.',
      'The project cost about $2.7 billion; a human genome can now be sequenced for a tiny fraction of that.',
    ],
    effects: [{ kind: 'happiness', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'hoover_dam',
    name: 'Hoover Dam',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'electronics',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🌊',
    image: 'assets/wonders/hoover_dam.jpg',
    shortEffect: 'Free Hydro Plant effect (continent, no power plant)',
    effectText:
      'Every city of the owner on the same continent that has no power plant of its own acts as if it had a Hydro Plant, gaining +1 production.',
    flavor:
      'Built during the Great Depression between 1931 and 1936, the dam tamed the Colorado River, created Lake Mead and still supplies water and power across the American Southwest.',
    facts: [
      'The concrete of the dam is still curing — it will take over a hundred years to dry completely.',
      'It was originally called Boulder Dam; it was renamed for President Herbert Hoover in 1947.',
      'At completion it was the tallest dam in the world, and its generators still produce thousands of megawatts.',
    ],
    effects: [{ kind: 'productionFlat', scope: 'continent', amount: 1, requiresNoPowerPlant: true }],
  },
  {
    id: 'manhattan_project',
    name: 'Manhattan Project',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'nuclear_fission',
    obsoleteBy: null,
    era: 'industrial',
    icon: '☢️',
    image: 'assets/wonders/manhattan_project.jpg',
    shortEffect: 'Nuclear weapons become possible for all civs with the tech',
    effectText:
      'The Manhattan Project allows nuclear weapons: any civilization that has the required technology can build them once the project is complete.',
    flavor:
      'A secret Allied programme of some 125,000 people produced the first nuclear weapons in 1945, ending one war and beginning the atomic age.',
    facts: [
      'The first nuclear test, "Trinity", took place in the New Mexico desert on 16 July 1945.',
      'The project cost about $2 billion at the time — roughly $30 billion in today\'s money.',
      'Its main laboratories were at Los Alamos, Oak Ridge and Hanford.',
    ],
    effects: [{ kind: 'enableNuclear', scope: 'global' }],
  },
  {
    id: 'seti_program',
    name: 'SETI Program',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'computers',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🔭',
    image: 'assets/wonders/seti_program.jpg',
    shortEffect: '+30% science in all cities',
    effectText: 'All cities of the civilization that runs the SETI Program produce +30% science.',
    flavor:
      'The Search for Extraterrestrial Intelligence sifts radio-telescope data for signals that did not come from nature — a scientific experiment with no guarantee of an answer.',
    facts: [
      'SETI typically scans narrow radio frequencies, looking for signals too orderly to be natural.',
      'No confirmed message from another civilization has ever been received.',
      'A famous candidate, the "Wow! signal" of 1977, has never repeated and remains unexplained.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'civilization', percent: 30 }],
  },
  {
    id: 'atomium',
    name: 'Atomium',
    cost: 500,
    maintenance: 0,
    requiredTechnology: 'nuclear_fission',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🔬',
    image: 'assets/wonders/atomium.jpg',
    shortEffect: '+1 happy everywhere · +10% science in this city',
    effectText:
      'Every city of the owner gains +1 happiness, and the city that builds the Atomium produces +10% extra science.',
    flavor:
      'A stainless-steel model of an iron crystal magnified 165 billion times, built for the 1958 Brussels World\'s Fair — an age\'s optimism cast in metal.',
    facts: [
      'The Atomium was designed by engineer André Waterkeyn for Expo 58 and is 102 metres tall.',
      'Its nine spheres are connected by tubes containing escalators; the top sphere offers a view over Brussels.',
      'It was originally intended to stand for only six months but was never dismantled.',
    ],
    effects: [
      { kind: 'happiness', scope: 'civilization', amount: 1 },
      { kind: 'sciencePercent', scope: 'city', percent: 10 },
    ],
  },
  {
    id: 'statue_of_liberty',
    name: 'Statue of Liberty',
    cost: 500,
    maintenance: 0,
    requiredTechnology: 'democracy',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🗽',
    image: 'assets/wonders/statue_of_liberty.jpg',
    shortEffect: '+1 trade per trade square in all cities',
    effectText:
      'Every trade square worked by any city of the civilization that completes the Statue of Liberty yields +1 extra trade.',
    flavor:
      'A gift from France dedicated in 1886, the statue has greeted arrivals in New York Harbour for well over a century as a symbol of liberty.',
    facts: [
      'The statue was designed by Frédéric Bartholdi; its iron framework was engineered by Gustave Eiffel\'s firm.',
      'Its copper skin is only about 2.4 millimetres thick — roughly the thickness of two coins.',
      'The pedestal was funded by American subscriptions, including a famous newspaper campaign run by Joseph Pulitzer.',
    ],
    effects: [{ kind: 'tradePerTradeSquare', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'ai_supercluster',
    name: 'Colossus (AI Supercluster)',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'computers',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🤖',
    image: 'assets/wonders/ai_supercluster.jpg',
    shortEffect: '+10% science & +10% production (continent)',
    effectText:
      'Every city of the owner on the same continent as the supercluster produces +10% science and +10% production.',
    flavor:
      'A modern AI training supercluster — among the largest known in the world — where thousands of accelerators train frontier models around the clock.',
    facts: [
      'The name echoes the Colossus of Rhodes, one of the ancient Wonders, reimagined as a monument of computation.',
      'Such clusters are typically built in large, purpose-designed datacentres with their own power and cooling.',
      'Training runs of frontier models draw enough electricity to power a small town.',
    ],
    effects: [
      { kind: 'sciencePercent', scope: 'continent', percent: 10 },
      { kind: 'productionPercent', scope: 'continent', percent: 10 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const WONDER_IDS: readonly string[] = WONDERS.map((w) => w.id);

const WONDER_BY_ID: ReadonlyMap<string, WonderDefinition> = new Map(WONDERS.map((w) => [w.id, w]));

/** The wonder with this id, or undefined when the id is not a wonder. */
export function getWonder(wonderId: string | null | undefined): WonderDefinition | undefined {
  return wonderId ? WONDER_BY_ID.get(wonderId) : undefined;
}

/** True when `id` is one of the 22 wonder ids. */
export function isWonderId(id: string | null | undefined): boolean {
  return !!id && WONDER_BY_ID.has(id);
}

/** All wonders of one documentation era, in list order. */
export function wondersForEra(era: WonderEra): WonderDefinition[] {
  return WONDERS.filter((w) => w.era === era);
}

/** The wonder ids a city holds (defensive: tolerates legacy/unknown entries). */
export function wondersInCity(city: City | null | undefined): string[] {
  const list = Array.isArray(city?.buildings) ? city!.buildings! : [];
  return list.filter((b) => isWonderId(String(b)));
}

// ---------------------------------------------------------------------------
// Status classification (pure — used by the overview screen, production list
// and tests; no engine access required)
// ---------------------------------------------------------------------------

export interface WonderStatusContext {
  /** The player's civilization id. */
  playerCivId: number;
  /** Civilization that already completed the wonder, or null. */
  ownerCivId: number | null;
  /** Civilizations that currently have this wonder in production (queued or active). */
  builderCivIds: number[];
  /** Whether the player has researched the required technology. */
  playerHasTech: boolean;
}

/**
 * Colour-coded status of one wonder for the player.
 *
 * Precedence: ownership first (green/red are facts), then build races
 * (yellow/blue), then red for a rival build, then grey when the player could
 * not start it anyway, otherwise neutral `available`.
 */
export function computeWonderStatus(ctx: WonderStatusContext): WonderStatus {
  if (ctx.ownerCivId === ctx.playerCivId) return 'owned';
  if (ctx.ownerCivId !== null) return 'rival';
  const playerBuilding = ctx.builderCivIds.includes(ctx.playerCivId);
  const rivalBuilding = ctx.builderCivIds.some((id) => id !== ctx.playerCivId);
  if (playerBuilding && rivalBuilding) return 'contested';
  if (playerBuilding) return 'building';
  if (rivalBuilding) return 'rival';
  if (!ctx.playerHasTech) return 'locked';
  return 'available';
}

/** Minimal shape of a city as far as status classification needs it. */
export interface WonderStatusCityLike {
  civilizationId: number;
  buildings?: string[];
  currentProduction?: { itemType?: string; type?: string } | null;
  buildQueue?: Array<{ itemType?: string; type?: string }>;
}

/** Minimal shape of a civilization as far as status classification needs it. */
export interface WonderStatusCivLike {
  id: number;
  technologies?: string[] | Set<string>;
}

function civHasTech(civ: WonderStatusCivLike | undefined, tech: string): boolean {
  if (!civ?.technologies) return false;
  if (civ.technologies instanceof Set) return civ.technologies.has(tech);
  return civ.technologies.includes(tech);
}

/** The civilization that completed `wonderId`, or null. */
export function findWonderOwner(wonderId: string, cities: WonderStatusCityLike[]): number | null {
  for (const city of cities) {
    if ((city.buildings ?? []).includes(wonderId)) return city.civilizationId;
  }
  return null;
}

/** Civilizations that currently have `wonderId` in production (active or queued). */
export function findWonderBuilders(wonderId: string, cities: WonderStatusCityLike[]): number[] {
  const builders = new Set<number>();
  for (const city of cities) {
    const active = String(city.currentProduction?.itemType ?? city.currentProduction?.type ?? '') === wonderId;
    const queued = (city.buildQueue ?? []).some(
      (q) => String(q?.itemType ?? q?.type ?? '') === wonderId,
    );
    if (active || queued) builders.add(city.civilizationId);
  }
  return [...builders];
}

/** Status of every wonder in one map: `wonderId → status`. */
export function computeWonderStatuses(
  cities: WonderStatusCityLike[],
  civilizations: WonderStatusCivLike[],
  playerCivId: number,
): Record<string, WonderStatus> {
  const player = civilizations.find((c) => c.id === playerCivId);
  const result: Record<string, WonderStatus> = {};
  for (const wonder of WONDERS) {
    result[wonder.id] = computeWonderStatus({
      playerCivId,
      ownerCivId: findWonderOwner(wonder.id, cities),
      builderCivIds: findWonderBuilders(wonder.id, cities),
      playerHasTech: civHasTech(player, wonder.requiredTechnology),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Obsolescence (pure) — a wonder is obsolete as soon as ANY civ has the tech
// ---------------------------------------------------------------------------

/** True when some civilization has discovered `wonderId`'s obsolescence tech. */
export function isWonderObsolete(
  wonderId: string,
  civilizations: Array<{ technologies?: string[] | Set<string> }>,
): boolean {
  const wonder = getWonder(wonderId);
  if (!wonder?.obsoleteBy) return false;
  return civilizations.some((civ) => civHasTech(civ as WonderStatusCivLike, wonder.obsoleteBy!));
}
/**
 * WonderArtworkCredits — attribution for every wonder image.
 *
 * All artwork lives in `public/assets/wonders/`. Most entries come from
 * Wikimedia Commons and record the author and the source page, as the licences
 * require: CC BY / CC BY-SA demand visible attribution, and we credit
 * public-domain files too so the provenance of each image is never in doubt.
 * Artwork supplied by the project owner carries no external source, author or
 * licence — only the Wikipedia article link.
 *
 * Keep this table in sync with `WONDERS[].image` and the files on disk.
 */

export interface WonderArtworkCredit {
  /** English Wikipedia article about the wonder — linked under the image. */
  articleUrl: string;
  /**
   * Wikimedia Commons file page the image came from. Absent for artwork the
   * project owner supplied, which has no external source to point at.
   */
  sourceUrl?: string;
  /** Author / photographer as stated by the Commons file page. */
  author?: string;
  /** Short licence name, e.g. "CC BY-SA 4.0" or "Public domain". */
  license?: string;
  /** Licence deed URL, empty/absent for public-domain works. */
  licenseUrl?: string;
}

export const WONDER_ARTWORK_CREDITS: Readonly<Record<string, WonderArtworkCredit>> = {
  colossus: {
    // Artwork supplied by the project owner (own collection) — no external
    // source, author or licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Colossus_of_Rhodes',
  },
  great_library: {
    // Artwork supplied by the project owner (own collection) — no external
    // source, author or licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Library_of_Alexandria',
  },
  hanging_gardens: {
    // Artwork supplied by the project owner (own collection) — no external
    // source, author or licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Hanging_Gardens_of_Babylon',
  },
  lighthouse: {
    // Artwork supplied by the project owner (own collection) — no external
    // source, author or licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Lighthouse_of_Alexandria',
  },
  oracle: {
    // Artwork supplied by the project owner (own collection) — no external
    // source, author or licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Delphi',
  },
  pyramids: {
    articleUrl: 'https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Great_Pyramid_of_Giza.jpg',
    author: 'kallerna',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  },
  silk_road: {
    articleUrl: 'https://en.wikipedia.org/wiki/Silk_Road',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Catalan_Atlas_caravan_drawing.jpg',
    author: 'Abraham Cresques (Catalan Atlas, 1375)',
    license: 'Public domain',
    licenseUrl: '',
  },
  copernicus_observatory: {
    articleUrl: 'https://en.wikipedia.org/wiki/Nicolaus_Copernicus',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Frombork_2023_28_Copernicus_Tower.jpg',
    author: 'Scotch Mist',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  },
  isaac_newtons_college: {
    articleUrl: 'https://en.wikipedia.org/wiki/Trinity_College%2C_Cambridge',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cmglee_Cambridge_Trinity_College_Great_Court.jpg',
    author: 'Cmglee',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  },
  js_bachs_cathedral: {
    articleUrl: 'https://en.wikipedia.org/wiki/St._Thomas_Church%2C_Leipzig',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Exterior_of_St._Thomas_Church,_Leipzig,_with_Bach_statue.jpg',
    author: 'Zarafa at en.wikipedia',
    license: 'Public domain',
    licenseUrl: '',
  },
  magellans_expedition: {
    // Artwork supplied by the project owner — no external source, author or
    // licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Magellan_expedition',
  },
  michelangelos_chapel: {
    articleUrl: 'https://en.wikipedia.org/wiki/Sistine_Chapel_ceiling',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:%27Sistine_Chapel_ceiling%27_by_Michelangelo_JBU21.JPG',
    author: 'Jörg Bittner Unna',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
  },
  shakespeare_theatre: {
    // Artwork supplied by the project owner — no external source, author or
    // licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Globe_Theatre',
  },
  leonardos_workshop: {
    // Artwork supplied by the project owner — no external source, author or
    // licence to attribute.
    articleUrl: 'https://en.wikipedia.org/wiki/Codex_Atlanticus',
  },
  international_space_station: {
    articleUrl: 'https://en.wikipedia.org/wiki/International_Space_Station',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:ISS_March_2009.jpg',
    author: 'National Aeronautics and Space Administration (Q23548)',
    license: 'Public domain',
    licenseUrl: '',
  },
  human_genome_project: {
    articleUrl: 'https://en.wikipedia.org/wiki/Human_Genome_Project',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:DNA_Double_Helix_by_NHGRI.jpg',
    author: 'National Human Genome Research Institute',
    license: 'Public domain',
    licenseUrl: '',
  },
  hoover_dam: {
    articleUrl: 'https://en.wikipedia.org/wiki/Hoover_Dam',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hoover_dam.jpg',
    author: 'Hannah Beker',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  },
  manhattan_project: {
    articleUrl: 'https://en.wikipedia.org/wiki/Manhattan_Project',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Trinity_Test_Fireball_16ms.jpg',
    author: 'Berlyn Brixner / Los Alamos National Laboratory',
    license: 'Public domain',
    licenseUrl: '',
  },
  seti_program: {
    articleUrl: 'https://en.wikipedia.org/wiki/Search_for_extraterrestrial_intelligence',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Allen_Telescope_Array_-_Flickr_-_brewbooks.jpg',
    author: 'brewbooks from near Seattle, USA',
    license: 'CC BY-SA 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0',
  },
  atomium: {
    articleUrl: 'https://en.wikipedia.org/wiki/Atomium',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:The_Atomium,_Brussels_-_54578545913.jpg',
    author: 'Pierre Blaché',
    license: 'CC0',
    licenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
  },
  statue_of_liberty: {
    articleUrl: 'https://en.wikipedia.org/wiki/Statue_of_Liberty',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Liberty_Island_photo_Don_Ramey_Logan.jpg',
    author: 'Don Ramey Logan',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
  },
  ai_supercluster: {
    articleUrl: 'https://en.wikipedia.org/wiki/Colossus_(data_center)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:CSIRO_ScienceImage_11313_The_CSIRO_GPU_cluster_at_the_data_centre.jpg',
    author: 'division, CSIRO',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
  },
};

