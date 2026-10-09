/**
 * WonderData — the single source of truth for the 25 World Wonders.
 *
 * Data-driven by design: every wonder is one entry in `WONDERS`. Adding a new
 * wonder means adding one object here — no engine or UI code has to change.
 *
 * Rules encoded here (see doc/WONDERS.md for the full data format):
 *  - Exactly 25 unique wonders, each buildable once in the whole game.
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

/** One of the 25 unique wonders. */
export interface WonderDefinition {
  /** Stable machine id (snake_case). Used in city.buildings and the save game. */
  id: string;
  /** Display name. */
  name: string;
  /** Full formal name, shown as a subtitle under the display name in the Civilopedia entry. */
  fullName: string;
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
  /**
   * Where the wonder stands (or stood) — the real-world place, e.g. "Rhodes".
   * Shown as a chip with the flag in the Civilopedia entry and as a small
   * badge in the overview ledger.
   */
  location: string;
  /** Flag emoji for the location's country (🌐 for international wonders). */
  flag: string;
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
  /**
   * Optional plain-language overview of what the wonder actually was — four
   * to five sentences, shown as its own section in the Civilopedia entry.
   * Rendered only when present.
   */
  about?: string;
  /**
   * "Some facts" for the Civilopedia entry — verified facts only, each written
   * as one readable line (titles quoted, with an English gloss for foreign
   * names). Rendered as a numbered, scrollable panel.
   */
  facts: string[];
  /** Typed effects consumed by the WonderEffects engine. */
  effects: WonderEffect[];
  /**
   * Optional mutual-exclusion group (e.g. `'space_station'`). Once any member
   * is completed anywhere in the world, the other members can no longer be
   * started. Group members share cost and effects by design — building one
   * retires its sisters.
   */
  groupId?: string;
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
// The 23 wonders (chronological by real-world inspiration — flavour only)
// ---------------------------------------------------------------------------

export const WONDERS: readonly WonderDefinition[] = [
  // ── Antiquity (7) ───────────────────────────────────────────────────────
  {
    id: 'colossus',
    name: 'Colossus',
    fullName: 'Colossus of Rhodes',
    location: 'Rhodes, Greece',
    flag: '🇬🇷',
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
    about:
      'The Rhodians built it from the spoils of a failed siege: when Demetrius Poliorcetes gave up on Rhodes in 305 BC, he left his siege engines behind, and the city sold them to pay the sculptor Chares for a bronze Helios. Finished around 280 BC, it stood barely half a century before an earthquake snapped it at the knees in 226 BC. The oracle at Delphi advised against rebuilding, so the fallen giant lay in the harbour for nearly nine hundred years, still famous enough for Pliny to describe. A later chronicle claims Arab conquerors finally sold the scrap in the mid-600s — and that it took 900 camels to carry the bronze away.',
    facts: [
      'It was cast from the bronze weapons Demetrius Poliorcetes left behind after his failed siege of Rhodes in 305 BC — the Rhodians sold the abandoned siege engines to pay for the statue.',
      'About 33 metres tall, it matched the Statue of Liberty from her feet to her torch, and it guarded the harbour for only 54 years.',
      'An earthquake snapped it at the knees in 226 BC; the Pythian oracle advised the Rhodians not to rebuild, so the fallen Colossus lay where it fell.',
      'Even as a ruin it drew travellers for centuries, and Pliny the Elder still counted it among the great works of his day.',
      'It was the last of the Seven Wonders to be finished — and the first to be destroyed.',
      'Chares of Lindos, the sculptor, had learned his trade under Lysippus, the court sculptor of Alexander the Great.',
      'Forget the famous image of ships sailing between its legs — the statue stood on one side of the harbour, and the straddling pose is a medieval invention.',
    ],
    effects: [{ kind: 'tradePerTradeSquare', scope: 'city', amount: 1 }],
  },
  {
    id: 'great_library',
    name: 'Great Library',
    fullName: 'Great Library of Alexandria',
    location: 'Alexandria, Egypt',
    flag: '🇪🇬',
    cost: 300,
    maintenance: 0,
    requiredTechnology: 'literacy',
    obsoleteBy: 'university',
    era: 'antiquity',
    icon: '📖',
    image: 'assets/wonders/great_library.jpg',
    shortEffect: '+5% science in all cities',
    effectText: 'All cities of the civilization that builds the Great Library produce +5% science.',
    flavor:
      'The legendary library of Alexandria, founded under the early Ptolemies, gathered the writings of the Mediterranean world in one place and became the symbol of collected knowledge.',
    about:
      'Founded by Ptolemy I beside his palace, the Library was the research wing of the Mouseion, where kings paid scholars simply to think. Euclid wrote his Elements there, Eratosthenes measured the circumference of the Earth from its maps, and Aristarchus first put the Sun at the centre. Its scholars ate together in a great communal hall, paid by the king — among the first salaried scientists in history. Its fate tracked the dynasty that fed it: when the Ptolemies\u2019 money and attention faded, the shelves did too — over centuries, not in one famous fire.',
    facts: [
      'It belonged to the Mouseion, a research institute funded by the Ptolemaic kings, where scholars were paid to read rather than merely to store books.',
      'Its librarian Callimachus compiled the Pinakes, a catalogue of 120 scrolls listing authors and their works — the first bibliography in history.',
      'Greek writers claimed ships calling at Alexandria were searched for books: the library copied them and kept the originals.',
      'It faded over centuries of war, shrinking budgets and neglect — the fire Caesar caused in 48 BC burned harbour warehouses, not the whole collection.',
      'When the institution finally closed, the scholars it had gathered scattered to teach across the Mediterranean and carried its methods with them.',
      'Eratosthenes measured the Earth at about 39,000 kilometres — within a few percent of the true figure — by comparing noon shadows in two cities.',
      'Aristarchus argued the Earth orbits the Sun eighteen centuries before Copernicus — his book is lost, and only Archimedes quotes it.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'civilization', percent: 5 }],
  },
  {
    id: 'hanging_gardens',
    name: 'Hanging Gardens',
    fullName: 'Hanging Gardens of Babylon',
    location: 'Babylon, Iraq',
    flag: '🇮🇶',
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
    about:
      'The old story says Nebuchadnezzar II built them for his Median queen Amytis, who pined for the green hills of her homeland. No Babylonian record confirms a word of it, which is why a rival theory moves the wonder to Nineveh and credits Sennacherib\u2019s aqueduct instead. Whoever built them, the trick was waterproofing: Greek accounts describe terraces sealed with bitumen and sheets of lead, carrying soil deep enough for trees. In the end the gardens may be the most Greek of wonders — a marvel of the East that survives only in Western books.',
    facts: [
      'They are the only one of the Seven Wonders whose very existence is disputed — no Babylonian text of Nebuchadnezzar\'s time mentions gardens at all.',
      'The classic account comes from Berossus, a Babylonian priest writing around 290 BC, and survives only in later Greek and Jewish quotations.',
      'The name is a Greek mistranslation: kremastos meant "overhanging" terraces, not plants floating in the air.',
      'The rival candidate is Nineveh, where the Assyrian king Sennacherib boasted of gardens watered by a screw-pump aqueduct.',
      'Some historians think the gardens were a legend born in Greece, where writers expected the rich East to own impossibly lush palaces.',
      'The screw pump linked to the gardens is named for Archimedes, who lived three centuries after Nebuchadnezzar — the technology, if real, predates its famous inventor.',
      'Alexander the Great died in Nebuchadnezzar\u2019s palace at Babylon in 323 BC — in the very building the gardens were said to crown.',
    ],
    effects: [{ kind: 'happiness', scope: 'continent', amount: 1 }],
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    fullName: 'Lighthouse of Alexandria',
    location: 'Alexandria, Egypt',
    flag: '🇪🇬',
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
    about:
      'Ordered by Ptolemy I and finished under his son, the tower is credited to the architect Sostratus of Cnidus, who is said to have hidden his own name beneath the king\u2019s inscription. Three tapering stages — square, octagon, cylinder — lifted the fire high enough to be seen a day\u2019s sail out, and a great mirror threw its light by day. It worked longer than any other wonder, some fifteen centuries, outliving the Ptolemies, Rome and Byzantium alike. When it finally fell, its stones became a fortress on the same rock.',
    facts: [
      'Built in three tapering tiers and probably 100–130 metres tall, it was among the tallest structures on Earth for more than a thousand years.',
      'By day its light came from mirrors, by night from a fire, with a statue of Zeus (or Poseidon) posed on top ruling the harbour mouth.',
      'Unlike the other wonders it was built to be useful: guiding shipping rather than honouring a god — and it did so for around 1,500 years.',
      'It named the idea itself: phare in French, faro in Spanish, far in Romanian.',
      'Earthquakes finished it between 956 and 1323, and in 1480 the sultan Qait Bay raised a fortress from its stones at the same spot.',
      'It was finished around 280 BC, within a decade of the Colossus going up across the sea.',
      'Julius Caesar seized the Pharos island during the Alexandrine War of 48 BC and mentions the tower in his commentaries.',
    ],
    effects: [{ kind: 'navalMovement', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'oracle',
    name: 'Oracle',
    fullName: 'Oracle of Delphi',
    location: 'Delphi, Greece',
    flag: '🇬🇷',
    cost: 200,
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
    about:
      'Founded where Apollo slew the serpent Python, Delphi was neutral ground: no city owned it, so every city trusted it. Kings asked about wars and colonists asked where to sail, and the sanctuary grew rich on gratitude — treasuries line the Sacred Way, each a small temple stuffed with thank-you gifts. When the Christian emperors closed the pagan shrines in the 390s, a voice that had spoken for a thousand years fell silent. French excavators woke the site in 1892 and found the treasuries, the stadium and the chasm still in place.',
    facts: [
      'Delphi was pan-Hellenic: sworn enemies sent embassies to the same shrine, because whoever carried its verdict carried moral authority.',
      'Its verdicts were famous for ambiguity — Croesus was told that if he crossed the Halys he would destroy a great empire, meaning his own.',
      'The Pythia was a woman over fifty who served for life, breathing vapours from a chasm below the temple while priests turned her words into verse.',
      'Geology supports the fumes: springs beneath the site release ethylene, which in small doses can produce trance-like states.',
      'Carved into the temple wall were the maxims "Know thyself" and "Nothing in excess" — moral rules no other oracular shrine posted.',
      'The Athenian Treasury at Delphi was built from the spoils of Marathon.',
      'When Socrates was told no man was wiser than he, he spent his life testing the answer on everyone in Athens.',
    ],
    effects: [{ kind: 'buildingHappinessMultiplier', buildingType: 'temple', scope: 'civilization', multiplier: 2 }],
  },
  {
    id: 'pyramids',
    name: 'Pyramids',
    fullName: 'Pyramids of Giza',
    location: 'Giza, Egypt',
    flag: '🇪🇬',
    cost: 400,
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
    about:
      'Khufu ordered it around 2560 BC, and some 100,000 men — Herodotus\u2019 figure, still quoted — dragged six million tonnes of limestone into a mountain with four triangular faces. The white casing that once made it flash in the sun was stripped in the Middle Ages to build Cairo\u2019s mosques and walls; only Khafre\u2019s pyramid keeps a cap of it. Inside, the King\u2019s Chamber holds a granite sarcophagus too big for the passages — it must have been built in. Greek travellers were already coming to gawp two thousand years ago.',
    facts: [
      'Khufu\'s Great Pyramid stood 146.6 metres tall and remained the tallest structure made by human hands for some 3,800 years, until medieval cathedrals passed it.',
      'It holds roughly 2.3 million blocks, about six million tonnes of stone, and its sides face true north to within a fraction of a degree.',
      'The builders were paid labourers, not slaves: their village had bakeries, breweries, medical care, and work gangs named "Friends of Khufu".',
      'Cleopatra died closer in time to the first Moon landing than to the day the pyramids were finished.',
      'It is the only one of the traditional Seven Wonders still standing today.',
      'Modern archaeologists put the workforce closer to twenty thousand — Herodotus exaggerated by a factor of five.',
      'The Descending Passage aims at the pole star of 2600 BC — Thuban, not Polaris.',
    ],
    effects: [{ kind: 'governmentAnarchyTurns', scope: 'civilization', turns: 1 }],
  },
  {
    id: 'silk_road',
    name: 'Silk Road',
    fullName: 'Silk Road',
    location: "Xi'an to Antioch, China to Syria",
    flag: '🌐',
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
    about:
      'In 138 BC the Han emperor Wudi sent Zhang Qian west to find allies against the Xiongnu; he came home thirteen years later with something better — a road. Chinese silk flowed west until Roman moralists complained it was draining the empire\u2019s gold, while glass, horses and new crops travelled east. Under the Mongols the whole route reopened as one guarded highway, and in 1275 a young Venetian named Marco Polo walked it to Kublai Khan\u2019s court. Ocean ships finally killed it: once Portuguese carracks rounded Africa, no camel train could match a hold full of pepper.',
    facts: [
      'It was never one road at all: the name covers a shifting web of desert, steppe and sea routes that traders stitched across Asia.',
      'The term "Silk Road" (German: Seidenstraße) was coined by the geographer Ferdinand von Richthofen in 1877, long after the caravans had stopped.',
      'The routes opened when the Han envoy Zhang Qian reached Central Asia around 138 BC, and silk was worth more than gold in Rome within a century.',
      'Ideas moved with the merchandise: Buddhism travelled from India into China along the same tracks as the silk bales.',
      'So did the Black Death, which followed these routes west in the 1340s and killed a third of Europe.',
      'The papermaking Arabs captured at Talas in 751 AD carried the craft west from here, and gunpowder followed the same road.',
      'At Dunhuang the Mogao caves — a Silk Road rest stop — grew into hundreds of grottoes painted with Buddhist murals over a thousand years.',
    ],
    effects: [{ kind: 'visionRange', scope: 'civilization', amount: 1 }],
  },

  // ── Middle Ages (7) ─────────────────────────────────────────────────────
  {
    id: 'copernicus_observatory',
    name: "Copernicus' Observatory",
    fullName: 'Copernicus Tower, Frombork',
    location: 'Frombork, Royal Prussia',
    flag: '🇩🇪',
    cost: 400,
    maintenance: 0,
    requiredTechnology: 'astronomy',
    obsoleteBy: 'automobile',
    era: 'middle',
    icon: '🌌',
    image: 'assets/wonders/copernicus_observatory.jpg',
    shortEffect: 'Doubles science in this city',
    effectText: 'The city that builds Copernicus\' Observatory produces double science.',
    flavor:
      'Born at Thorn (Toruń), Nicolaus Copernicus worked out from a canon\'s tower at Frombork that the Earth circles the Sun — and quietly rewrote humanity\'s place in the cosmos.',
    about:
      'Young Nicolaus lost his father at ten and was raised by his uncle, the bishop of Warmia, who steered him into the church and paid for a decade of Italian universities. Back in Frombork he did the chapter\u2019s paperwork by day — rents, mills, coinage — and moved the Earth by night, filling a manuscript he refused to publish for thirty years. The printed book reached him on his deathbed in 1543, carried by his only pupil\u2019s printer. Two centuries after his burial in an unmarked cathedral grave, archaeologists dug him up and proved the bones were his with DNA from hairs pressed in his own calendar.',
    facts: [
      'Copernicus published his heliocentric theory: "De revolutionibus orbium coelestium" (eng. "On the Revolutions of the Heavenly Spheres") in 1543, and that was also the year he died.',
      'He came from a German-speaking merchant family, and at the University of Bologna he enrolled in the German student nation — the Natio Germanorum.',
      'A complete Renaissance figure, he also worked as a physician, economist and church canon — astronomy remained a sideline.',
      'As a canon of the cathedral chapter of Frombork he administered Warmia in the service of the Polish Crown.',
      'During the Polish–Teutonic war he commanded the defence of Olsztyn, directing the town\'s guns through the siege.',
      'He never looked through a telescope, making his observations with instruments he built himself from a tower above the Vistula Lagoon.',
      'His book was placed on the Church\'s Index of Forbidden Books in 1616 — "suspended until corrected", not forbidden outright.',
      'His model still moved the sun in perfect circles, so it predicted the planets no better than Ptolemy\'s; its power lay in a single simple system.',
      'He also wrote on money: bad coinage drives out good — the rule later named for Gresham — two centuries before Gresham.',
      'Legend says the first printed copy reached his deathbed on the very day he died.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'city', percent: 100 }],
  },
  {
    id: 'isaac_newtons_college',
    name: "Isaac Newton's College",
    fullName: 'Trinity College, Cambridge',
    location: 'Cambridge, United Kingdom',
    flag: '🇬🇧',
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
    about:
      'Born at Woolsthorpe on Christmas Day 1642, a sickly posthumous child nobody expected to live, Newton entered Trinity College as a sizar — a poor student who paid his way by waiting tables. Lucasian Professor at twenty-six, he spent his career feuding: with Hooke over light, with Leibniz over who invented calculus, a fight his allies won by writing the verdict themselves. Knighted in 1705, he ran the Mint with the zeal of a prosecutor and died rich, unmarried and busy at his desk in 1727. Westminster Abbey buried him like a king, and his epitaph calls him an ornament of the human race.',
    facts: [
      'In the plague year of 1666 he sketched calculus, the theory of colour and universal gravitation while sent home from Cambridge.',
      'Edmond Halley paid for the Principia to be printed at his own expense in 1687, after the Royal Society declared it could not afford it.',
      'His phrase "If I have seen further it is by standing on the shoulders of giants" comes from a letter to his rival Robert Hooke in 1676.',
      'The Principia governed physics for over two centuries — and still guides spacecraft to their targets.',
      'He spent thirty secret years on alchemy and biblical chronology, writing far more pages on them than on physics.',
      'As Master of the Mint he hunted counterfeiters himself and rebuilt English coinage.',
      'He once hid a Latin anagram in a letter to Leibniz to stake his claim to calculus without revealing a word of it.',
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
    fullName: 'St. Thomas Church, Leipzig',
    location: 'Leipzig, Germany',
    flag: '🇩🇪',
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
    about:
      'Orphaned at ten and raised by an elder brother, Bach walked some 460 kilometres to Lübeck in 1705 to hear the great Buxtehude — and stayed three months on a four-week leave. He spent his twenties as a court organist and his thirties directing Prince Leopold\u2019s band at Cöthen, where the Brandenburg Concertos were born. Leipzig made him Thomaskantor in 1723, and he answered with a cantata almost every week for years. Father of twenty children, blind at the end, he died in 1750 and was buried in an unmarked grave — Leipzig forgot where until 1894.',
    facts: [
      'As Thomaskantor he wrote, rehearsed and performed music for two Leipzig churches, producing a cantata for nearly every week of the church year.',
      'More than 1,100 works survive, listed in the BWV catalogue — the Bach-Werke-Verzeichnis compiled by Wolfgang Schmieder in 1950.',
      'The St. Matthew Passion lay unperformed for nearly a century until the twenty-year-old Felix Mendelssohn revived it in 1829.',
      'He came from a dynasty of working musicians, and four of his own children became composers in their turn.',
      'He never left German-speaking lands, yet folded French, Italian and Polish styles into his own writing.',
      'Already failing in sight, he underwent eye surgery in 1750 and died within months.',
      'In 1717 Weimar locked him in jail for a month — his crime was asking his prince for dismissal too rudely.',
    ],
    effects: [{ kind: 'unhappyToContent', scope: 'continent', amount: 1 }],
  },
  {
    id: 'magellans_expedition',
    name: "Magellan's Expedition",
    fullName: 'Magellan–Elcano circumnavigation',
    location: 'Seville, Spain',
    flag: '🇪🇸',
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
    about:
      'A Portuguese captain sailing for Spain, Magellan sold Charles I on a western road to the Moluccas that Spain\u2019s maps said must exist. Mutiny nearly ended it in Patagonia, where he had the ringleaders quartered and marooned a priest on the beach. The strait took 38 days to thread; the Pacific then took three months and twenty days without one fresh meal. He died a month from triumph, killed on Mactan in April 1521 while meddling in a local war his men had warned him to avoid.',
    facts: [
      'Five ships left Seville in August 1519 and one, the Victoria, came home in September 1522 — completing the first circumnavigation.',
      'Magellan died in a skirmish on Mactan in the Philippines in 1521, never learning that the passage west had been found.',
      'Juan Sebastián Elcano took command of the Victoria, becoming the first man to sail all the way around the globe.',
      'Of the roughly 270 men who sailed, only 18 returned — hunger, scurvy and fighting took the rest.',
      'He named the ocean he crossed "Mar Pacífico", the peaceful sea, and the strait he found at the tip of South America still carries his name.',
      'Sailing west, the Victoria arrived a day "early", and the circumnavigation proved the world needed an international date line.',
      'The survivors were paid in cloves: the Victoria\u2019s hold of spices covered the whole expedition\u2019s cost and left a profit — the cargo made the voyage pay.',
    ],
    effects: [{ kind: 'navalMovement', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'michelangelos_chapel',
    name: "Michelangelo's Chapel",
    fullName: 'Sistine Chapel',
    location: 'Vatican City',
    flag: '🇻🇦',
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
    about:
      'Born in Caprese in 1475 and raised among stonecutters, Michelangelo carved the Pietà at twenty-three. At twenty-six he took a rejected block of marble and freed the seventeen-foot David from it in three years. Popes used him like a weapon: Julius for the tomb and the ceiling, Paul III for the Last Judgment, and finally St. Peter\u2019s itself, whose dome he designed in his seventies. He died at eighty-eight in 1564 and was smuggled out of Rome by night, because Florence demanded the body.',
    facts: [
      'Pope Julius II commissioned the ceiling in 1508; Michelangelo, who saw himself as a sculptor, suspected rivals had talked him into it.',
      'He painted it standing on a scaffold of his own design, working overhead — the familiar image of him lying on his back is a later myth.',
      'The ceiling covers about 500 square metres and carries more than 300 figures, among them the Creation of Adam.',
      'A quarter of a century later he returned to the same room for The Last Judgment on the altar wall (1536–1541).',
      'A restoration finished in 1994 stripped away centuries of candle soot, revealing colours far brighter than anyone expected.',
      'The Pietà carries the only signature he ever carved — on the Virgin\u2019s sash, added after he overheard visitors crediting the work to another sculptor.',
      'He was a published poet too: over 300 sonnets and madrigals survive, most written for the young nobleman Tommaso dei Cavalieri and, late in life, for Vittoria Colonna.',
    ],
    effects: [{ kind: 'buildingHappinessMultiplier', buildingType: 'cathedral', scope: 'civilization', multiplier: 1.5 }],
  },
  {
    id: 'shakespeare_theatre',
    name: "Shakespeare's Theatre",
    fullName: 'Globe Theatre',
    location: 'London, United Kingdom',
    flag: '🇬🇧',
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
    about:
      'Born at Stratford in April 1564, he married Anne Hathaway at eighteen and was acting and writing in London within a decade, a sharer in the Lord Chamberlain\u2019s Men. In 1599 the company raised the Globe on Bankside, and he wrote Hamlet, Lear and Macbeth for its stage and its star Richard Burbage. Retired rich to Stratford around 1613, he died in 1616 — tradition says on his fifty-second birthday. His will left his wife only the \u2018second best bed\u2019, very likely the marriage bed itself, since best beds were kept for guests.',
    facts: [
      'Shakespeare wrote some 37 plays and 154 sonnets, and English remembers him as the first recorded user of over 1,700 words.',
      'The Globe burned down in June 1613 when a cannon blank fired during Henry VIII set the thatch alight.',
      'It was rebuilt within a year, but the Puritans closed every playhouse in 1642 and many were pulled down afterward.',
      'The First Folio of 1623, edited by his fellow actors Heminges and Condell, is why half his plays survive at all.',
      'He called the playhouse "this wooden O" in the prologue to Henry V, borrowing the Globe\'s own round shape.',
      'The Globe\u2019s timbers were second-hand: the company dismantled their old playhouse in Shoreditch and ferried the beams across the Thames.',
      'When James I took the throne in 1603, the Lord Chamberlain\u2019s Men became the King\u2019s Men.',
    ],
    effects: [{ kind: 'unhappyToContent', scope: 'city', amount: 4 }],
  },
  {
    id: 'leonardos_workshop',
    name: "Leonardo's Workshop",
    fullName: 'Codex Atlanticus',
    location: 'Milan, Italy',
    flag: '🇮🇹',
    cost: 600,
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
    about:
      'Born out of wedlock at Vinci in 1452, Leonardo learned his trade in Verrocchio\u2019s Florence workshop, where legend says the master quit painting when the pupil outshone him. Milan\u2019s duke Ludovico Sforza hired him as an engineer, and there he painted the Last Supper and filled notebooks with war machines. In his fifties he dissected some thirty human corpses, drawing a heart no one would better for centuries. He chased flight longest: birds, bats and his own doomed flying machines fill the Codex on the Flight of Birds.',
    facts: [
      'He wrote his notebooks in mirror writing, right to left, so the page reads normally when held to a mirror.',
      'The Codex Atlanticus gathers 1,119 pages of his drawings and lists: flying machines, armoured cars, irrigation pumps and waterwheels.',
      'He finished very few paintings — perhaps fifteen survive — yet those few changed the direction of art.',
      'He designed a parachute, an armoured vehicle, a revolving bridge and a diving suit, all drawn in detail and none built in his lifetime.',
      'He spent his last years in France at the invitation of King Francis I, dying at Amboise on the Loire in 1519.',
      'Bill Gates bought one of his notebooks, the Codex Leicester, in 1994 for $30.8 million — then a record for any manuscript.',
      'Vasari swears he once glued wings and a false beard onto a lizard to terrify his friends in Rome.',
    ],
    effects: [{ kind: 'autoUpgradeUnits', scope: 'civilization' }],
  },

  // ── Industrial / Modern Age (8) ─────────────────────────────────────────
  {
    id: 'international_space_station',
    name: 'International Space Station',
    fullName: 'International Space Station',
    groupId: 'space_station',
    location: 'Low Earth orbit, ~400 km',
    flag: '🌐',
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
    about:
      'The first piece, Russia\u2019s Zarya module, went up in November 1998, and the station has grown ever since — at roughly $150 billion shared by five space agencies, the most expensive single object ever built. Its crews have tested everything from growing lettuce to 3D-printing in weightlessness, and accidentally discovered that bacteria get meaner in orbit. Nothing is wasted up there: sweat and urine are distilled back into drinking water. When it retires around 2030, a purpose-built tug will drag it into a remote stretch of ocean — the largest controlled demolition in history.',
    facts: [
      'The first crew moved in on 2 November 2000, and the station has been occupied every single day since — the longest continuous human presence in space.',
      'It circles the Earth every 90 minutes, so its crew sees 16 sunrises and 16 sunsets a day.',
      'It is 109 metres long and 420 tonnes — too big to have been built anywhere but orbit.',
      'Outshining every star, it is often the third-brightest object in the sky after the Sun and the Moon.',
      'Assembly took 13 years and more than 40 rocket and shuttle flights, docking American, Russian, Japanese, European and Canadian modules together.',
      'More than 200 people from over 20 countries have lived aboard.',
      'Its toilet cost $19 million — NASA\u2019s most expensive commode, delivered in 2008.',
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
    fullName: 'Human Genome Project',
    location: 'International, six countries',
    flag: '🌐',
    cost: 400,
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
    about:
      'Washington started it in 1990 under James Watson of double-helix fame, who quit two years later over gene patenting and left Francis Collins to finish it. The race with Celera\u2019s Craig Venter turned sequencing into a sprint, and both sides declared the draft done in 2000 with Clinton and Blair on the line. The \u2018finished\u2019 genome of 2003 still had gaps; the truly complete, gapless sequence only arrived in 2022. Along the way the project set aside part of its budget for ethics research — the largest bioethics programme ever attached to a science project.',
    facts: [
      'It ran from 1990 to 2003, with sequencing centres across the United States, Britain, France, Germany, Japan and China.',
      'The book of human DNA runs to about three billion letters — reading it all took thirteen years.',
      'It found far fewer protein-coding genes than expected: roughly 20,000, where biologists had predicted 100,000.',
      'The project cost about $2.7 billion; a human genome can be read today for a few hundred dollars.',
      'A private company, Celera Genomics, raced the public effort to the finish, and both announced the finished sequence together in 2000.',
      'Any two people differ in only about 0.1% of that text — the differences are what make each of us distinct.',
      'The reference genome is a mosaic of some twenty anonymous donors — most of the DNA came from a single man.',
    ],
    effects: [{ kind: 'happiness', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'hoover_dam',
    name: 'Hoover Dam',
    fullName: 'Hoover Dam',
    location: 'Black Canyon, Colorado River, USA',
    flag: '🇺🇸',
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
    about:
      'The Bureau of Reclamation sold it as flood control and irrigation, but the Depression made it a jobs machine: up to 5,000 men worked the canyon at the peak. Summer heat killed — thermometers hit 60\u00B0C in the tunnels — so the company town of Boulder City banned alcohol and gambling to keep the peace. Concrete went in chilled through embedded pipes, a trick that let the dam rise a section a month. When the lake filled, it drowned the Mormon town of St. Thomas, whose ruins resurface whenever drought drops the water.',
    facts: [
      'Built in the depths of the Great Depression, 1931–1936, it tamed the Colorado River and created Lake Mead.',
      'Its concrete is still cooling: there is so much of it that the mass will need more than a century to dry out completely.',
      'It began life as Boulder Dam and was renamed for President Herbert Hoover in 1947.',
      'Standing 221 metres high, it was the tallest dam in the world when finished, and its generators still produce thousands of megawatts.',
      'Art Deco architect Gordon Kaufmann shaped its towers; the 112 workers who died building it are officially recorded.',
      'It was handed over more than two years ahead of schedule.',
      'Lake Mead, behind it, is the largest reservoir in the United States by volume.',
      'In 2010 traffic finally left the dam\u2019s crest for a bypass arch bridge named for a governor and a fallen football star.',
    ],
    effects: [{ kind: 'productionFlat', scope: 'continent', amount: 1, requiresNoPowerPlant: true }],
  },
  {
    id: 'manhattan_project',
    name: 'Manhattan Project',
    fullName: 'Manhattan Project',
    location: 'Los Alamos, New Mexico, USA',
    flag: '🇺🇸',
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
    about:
      'Washington put an artillery general, Leslie Groves, in charge of the physicists — and the pairing worked. The project took its cover name from the Manhattan Engineer District, the Army office in New York where it began. Los Alamos did not exist on any map; children born there had \u2018PO Box 1663, Santa Fe\u2019 on their birth certificates. Secrecy held so well that Vice President Truman learned of the bomb only after Roosevelt died.',
    facts: [
      'In 1939 the physicists Leó Szilárd and Albert Einstein wrote a letter warning Roosevelt that an atomic bomb might be possible.',
      'The project stretched over secret sites: uranium enrichment at Oak Ridge, plutonium production at Hanford, and design at Los Alamos.',
      'Robert Oppenheimer directed the Los Alamos laboratory where the weapon itself was designed.',
      'The Trinity test lit the desert at half past five on the morning of 16 July 1945 — the first nuclear explosion in history.',
      'Around 125,000 people worked on it, and most never learned what they were building.',
      'The Pacific war ended within weeks, and the atomic age began.',
      'The core of the Trinity gadget was plutonium the size of a grapefruit — about six kilograms.',
      'Klaus Fuchs, a Los Alamos physicist, was passing everything to Moscow the whole time.',
    ],
    effects: [{ kind: 'enableNuclear', scope: 'global' }],
  },
  {
    id: 'seti_program',
    name: 'SETI Program',
    fullName: 'Search for Extraterrestrial Intelligence',
    location: 'Green Bank, West Virginia, USA',
    flag: '🇺🇸',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'computers',
    obsoleteBy: null,
    era: 'industrial',
    icon: '📡',
    image: 'assets/wonders/seti_program.jpg',
    shortEffect: '+30% science in all cities',
    effectText: 'All cities of the civilization that runs the SETI Program produce +30% science.',
    flavor:
      'The Search for Extraterrestrial Intelligence sifts radio-telescope data for signals that did not come from nature — a scientific experiment with no guarantee of an answer.',
    about:
      'In 1974 astronomers beamed 1,679 bits from Arecibo toward the star cluster M13 — a postcard no one can answer for 50,000 years. The search went private after Congress pulled the plug in 1993, and billionaire Yuri Milner rebooted it in 2015 with $100 million and Stephen Hawking at his side. Modern hunts piggyback on other astronomy: the Allen Telescope Array scans the sky while doing ordinary science. The deepest irony is that our own noisiest century is ending — digital TV and fibre are making Earth go radio-quiet, harder for anyone to hear.',
    facts: [
      'Frank Drake opened the modern search with Project Ozma in 1960, listening to two nearby sun-like stars at the Green Bank radio telescope in West Virginia.',
      'The first SETI conference in 1961 gave the world the Drake equation — a way to estimate how many civilizations might be detectable.',
      'Searchers listen near the "water hole" frequencies, where hydrogen and hydroxyl naturally whisper across the galaxy.',
      'The "Wow! signal" of 1977 was a strong 72-second burst that has never repeated and never been explained.',
      'Not one confirmed message from another civilization has arrived in sixty years of listening.',
      'Congress cut NASA\'s SETI budget in 1993, yet the search continued privately — and SETI@home lent the public\'s home computers to it from 1999.',
      'Ohio State\u2019s \u2018Big Ear\u2019 telescope, which caught the Wow! signal, was bulldozed in 1998 to make a golf course.',
    ],
    effects: [{ kind: 'sciencePercent', scope: 'civilization', percent: 30 }],
  },
  {
    id: 'super_kamiokande',
    name: 'Super-Kamiokande',
    fullName: 'Super-Kamiokande',
    location: 'Hida, Gifu, Japan',
    flag: '🇯🇵',
    cost: 500,
    maintenance: 0,
    requiredTechnology: 'computers',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🔭',
    image: 'assets/wonders/super_kamiokande.jpg',
    shortEffect: '+15% science in all cities · +1 vision (supernova alert)',
    effectText:
      'All cities of the owner produce +15% science, and all units and cities gain +1 vision range from the Supernova Early Warning System.',
    flavor:
      'A cathedral of physics buried 1,000 metres underground: 50,000 tonnes of ultra-pure water watched by 11,146 golden eyes, waiting for the ghostly kiss of a neutrino.',
    about:
      'Construction began in 1991 beneath Mount Ikeno in the Japanese Alps. The cylindrical tank — 40 metres tall, 40 metres wide — is lined with 11,146 hand-blown photomultiplier tubes that amplify the faintest flash of Cherenkov light when a neutrino strikes a water molecule. In 1998 Super-K proved neutrinos have mass, rewriting the Standard Model. It also stands sentinel for the planet: when a star dies, its neutrinos escape hours before the light, and Super-K\u2019s alarm triggers the Supernova Early Warning System (SNEWS), giving astronomers worldwide a precious head start. In 2001 a single cracked tube imploded under pressure; the shockwave raced through the incompressible water and shattered 6,600 tubes in ten seconds — a disaster that taught the collaboration to armor every sensor in acrylic. The water itself is so aggressively pure it would leach the minerals from your skin; a dropped wrench dissolves in days. Since 2020, gadolinium-doped water has sharpened the detector\u2019s ears for the faint whispers of ancient supernovae echoing from the dawn of the universe.',
    facts: [
      'The 11,146 photomultiplier tubes are so sensitive they could theoretically detect a candle flame on the Moon.',
      'On 12 November 2001, one imploding tube triggered a chain reaction that destroyed over 6,600 tubes in just 10 seconds — a $30 million disaster averted only by the tank\u2019s underground location.',
      'The ultra-pure water is chemically starved: it aggressively strips ions from anything it touches, including human skin and metal tools.',
      'Super-K is the heart of SNEWS — when it sees a neutrino burst, observatories worldwide slew their telescopes to catch the supernova\u2019s first light.',
      'In 1998 the experiment announced the discovery of neutrino oscillation, proving neutrinos have mass — a Nobel-winning result that breaks the Standard Model.',
      'Since 2020, gadolinium sulfate dissolved in the water acts as a neutron catcher, letting Super-K hear the diffuse neutrino background from all past supernovae.',
      'The tank holds 50,000 tonnes of water — enough to fill 20 Olympic swimming pools — yet it fits inside a mountain with metres to spare.',
    ],
    effects: [
      { kind: 'sciencePercent', scope: 'civilization', percent: 15 },
      { kind: 'visionRange', scope: 'civilization', amount: 1 },
    ],
  },
  {
    id: 'transistor',
    name: 'Transistor',
    fullName: 'Transistor',
    location: 'Murray Hill, New Jersey, USA',
    flag: '🇺🇸',
    cost: 500,
    maintenance: 0,
    requiredTechnology: 'electronics',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🔌',
    image: 'assets/wonders/transistor.jpg',
    shortEffect: '+1 happy everywhere · +10% science in this city',
    effectText:
      'Every city of the owner gains +1 happiness, and the city that builds the Transistor produces +10% extra science.',
    flavor:
      'A sliver of germanium smaller than a paperclip, demonstrated the week before Christmas 1947 — the switch that replaced the vacuum tube and started the digital age.',
    about:
      'After the war, Bell Labs boss Mervin Kelly told William Shockley to find a solid-state replacement for the telephone system\u2019s fragile, power-hungry vacuum tubes. Theorist John Bardeen and experimenter Walter Brattain did the work: on 16 December 1947 their germanium device with two gold contacts amplified a signal a hundredfold. Shockley, watching, called the Christmas Eve demonstration \u2018a magnificent Christmas present\u2019 — then went home and invented the better junction version himself. Named by engineer John Pierce and announced in June 1948, the device won its three fathers the 1956 Nobel Prize; there are trillions of their descendants on Earth today.',
    facts: [
      'Bardeen and Brattain made it work on 16 December 1947, then demonstrated it to the lab brass days later, just before Christmas.',
      'The name \u2018transistor\u2019 was coined by Bell engineer John Pierce.',
      'All three fathers — Bardeen, Brattain and Shockley — shared the 1956 Nobel Prize in Physics.',
      'It replaced the vacuum tube: smaller, cooler, tougher, and sipping power instead of gulping it.',
      'Shockley quit Bell Labs in 1955 to found his own semiconductor company in California — the seed of Silicon Valley.',
      'Kilby built the first integrated circuit in 1958 and Noyce improved it a year later — whole circuits on one chip, born from the transistor.',
    ],
    effects: [
      { kind: 'happiness', scope: 'civilization', amount: 1 },
      { kind: 'sciencePercent', scope: 'city', percent: 10 },
    ],
  },
  {
    id: 'statue_of_liberty',
    name: 'Statue of Liberty',
    fullName: 'Liberty Enlightening the World',
    location: 'New York Harbor, USA',
    flag: '🇺🇸',
    cost: 600,
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
    about:
      'The idea came from a French law professor, Édouard de Laboulaye, who wanted a monument to American independence — and to shame France\u2019s own emperor. Bartholdi built the statue in Paris and shipped it in 350 pieces; Eiffel\u2019s iron skeleton lets the copper skin flex in the wind. Her full name, \u2018Liberty Enlightening the World,\u2019 is carved nowhere on her — Americans gave her the short one. Poet Emma Lazarus pinned \u2018The New Colossus\u2019 to her pedestal in 1883, and her \u2018huddled masses\u2019 verse turned an independence monument into an immigration icon.',
    facts: [
      'A gift from the people of France, it was dedicated on 28 October 1886 — ten years late, as both sides had to raise their own funds.',
      'Frédéric Auguste Bartholdi designed the statue, and the firm of Gustave Eiffel engineered the iron skeleton that carries it.',
      'Its copper skin is just 2.4 millimetres thick — about two coins stacked — and took roughly thirty years to weather into its famous green.',
      'The seven rays of her crown stand for the seven seas and continents.',
      'Her tablet carries the date of American independence: "JULY IV MDCCLXXVI".',
      'Newspaper owner Joseph Pulitzer raised the pedestal money from ordinary readers, most of whom sent in small change.',
      'Her torch has been off-limits since 1916, when German saboteurs blew up a munitions depot across the bay — the crown reopened in 2009.',
      'The 1986 restoration replaced her torch with one sheathed in 24-karat gold leaf — the flame you see is gold.',
    ],
    effects: [{ kind: 'tradePerTradeSquare', scope: 'civilization', amount: 1 }],
  },
  {
    id: 'tiangong',
    name: 'Tiangong',
    fullName: 'Tiangong Space Station',
    groupId: 'space_station',
    location: 'Low Earth orbit',
    flag: '🇨🇳',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'space_flight',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🚀',
    image: 'assets/wonders/tiangong.jpg',
    shortEffect: 'Space race enabled · +20% science · all cities revealed',
    effectText:
      'Tiangong enables the space race (Moonshot) for every civilization with the technology, grants +20% science in all cities of its owner, and reveals every city on the map to its owner.',
    flavor:
      'Shut out of the International Space Station, China built its own Heavenly Palace instead — three modules, permanently crewed, flying since 2021.',
    about:
      'When Washington\u2019s Wolf Amendment of 2011 barred NASA from working with China, Beijing answered by building its own station instead of begging a seat. The Tianhe core module went up in April 2021, the Wentian and Mengtian laboratories followed in 2022, and the T-shape was complete that November. Three taikonauts live aboard for six months at a time, and the station has been continuously crewed since mid-2022. It is one of two working space stations — and the proof that the orbital age now has two landlords.',
    facts: [
      'Tiangong means "Heavenly Palace" — the station\u2019s official English name is the China Space Station.',
      'The Tianhe core module launched on 29 April 2021; the Wentian and Mengtian laboratories followed in July and October 2022.',
      'Three taikonauts crew it for about six months at a time, doubling to six during handovers.',
      'Its crews set the longest spacewalk ever in 2024 — more than nine hours outside.',
      'Two earlier Tiangongs tested the way: Tiangong-1 in 2011 and Tiangong-2 in 2016.',
      'Experiments aboard have involved researchers from 17 countries.',
    ],
    effects: [
      { kind: 'enableSpaceship', scope: 'global' },
      { kind: 'sciencePercent', scope: 'civilization', percent: 20 },
      { kind: 'revealAllCities', scope: 'civilization' },
    ],
  },
  {
    id: 'mir',
    name: 'Mir',
    fullName: 'Mir Space Station',
    groupId: 'space_station',
    location: 'Low Earth orbit',
    flag: '☭︎',
    cost: 600,
    maintenance: 0,
    requiredTechnology: 'space_flight',
    obsoleteBy: null,
    era: 'industrial',
    icon: '🌍',
    image: 'assets/wonders/mir.jpg',
    shortEffect: 'Space race enabled · +20% science · all cities revealed',
    effectText:
      'Mir enables the space race (Moonshot) for every civilization with the technology, grants +20% science in all cities of its owner, and reveals every city on the map to its owner.',
    flavor:
      'The Soviet Union\u2019s Mir — Russian for both "world" and "peace" — was the first modular station: crewed for thirteen of its fifteen years, home to a record 437-day flight, and deliberately sunk in the Pacific in 2001.',
    about:
      'The core module went up in February 1986, and the Soviets spent a decade bolting on laboratories until Mir became the largest thing ever flown. From September 1989 to August 1999 it never stood empty — nearly ten unbroken years with people aboard, a record the ISS needed until 2010 to beat. Its guest book reads like a rehearsal for everything after: nine shuttle dockings, the first long stays by Americans, and Valeri Polyakov\u2019s 437 days, still the longest single spaceflight. When money ran out, Russia sailed it into the Pacific on 23 March 2001 — and handed every lesson to the station that followed.',
    facts: [
      '"Mir" means both "world" and "peace" in Russian.',
      'The core module launched on 19 February 1986 from Baikonur.',
      'It was continuously occupied from September 1989 to August 1999 — nearly ten unbroken years.',
      'Valeri Polyakov spent 437 days aboard in 1994–1995, still the longest single spaceflight.',
      'Nine American shuttles docked with Mir, and seven Americans flew long missions aboard.',
      '104 visitors from 12 nations came aboard; 42 of them later flew on the ISS.',
    ],
    effects: [
      { kind: 'enableSpaceship', scope: 'global' },
      { kind: 'sciencePercent', scope: 'civilization', percent: 20 },
      { kind: 'revealAllCities', scope: 'civilization' },
    ],
  },
  {
    id: 'ai_supercluster',
    name: 'Colossus (AI Supercluster)',
    fullName: 'xAI Colossus',
    location: 'Memphis, Tennessee, USA',
    flag: '🇺🇸',
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
      'Elon Musk\u2019s xAI raised Colossus in Memphis in 122 days in 2024 — a hundred thousand graphics processors in a single hall, training its Grok models around the clock.',
    about:
      'A graphics card turned out to be a brain: thousands of simple cores that draw game frames also multiply the matrices of neural networks. That accident built an industry — NVIDIA went from gaming company to the world\u2019s most valuable chipmaker on the back of AI training. The flagship of the new age stands in Memphis, where xAI raised \u2018Colossus\u2019 in 122 days in 2024: a hundred thousand graphics processors in one hall, then doubled. Nobody knows if the scaling laws hold forever, but every lab is betting they do.',
    facts: [
      'The name echoes the Colossus of Rhodes — an ancient wonder reborn as a monument of computation.',
      'Elon Musk\u2019s xAI switched it on in September 2024: 100,000 NVIDIA H100 graphics processors in Memphis, Tennessee — built in 122 days.',
      'It doubled to 200,000 graphics processors within months, training xAI\u2019s Grok models.',
      'Such halls are purpose-built for power and cooling, each rack drawing kilowatts around the clock.',
      'A single frontier training run can burn as much electricity as a small town.',
      'Scale matters more than any one chip: modern clusters network together hundreds of thousands of accelerators into one machine.',
      'Memphis neighbours protested the gas turbines and water the halls drink — a million gallons a day, by one utility estimate.',
      'A single frontier training run costs on the order of a hundred million dollars — compute, not salaries, is the bill.',
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

/** One expandable family of mutually exclusive wonders (e.g. the space stations). */
export interface WonderGroup {
  /** Stable group id referenced by `WonderDefinition.groupId`. */
  id: string;
  /** Display name for the grouped UI element. */
  name: string;
  /** One-line explainer shown under the group header. */
  blurb: string;
}

export const WONDER_GROUPS: Readonly<Record<string, WonderGroup>> = {
  space_station: {
    id: 'space_station',
    name: 'Space Stations',
    blurb: 'One station per world — completing any one retires the others.',
  },
};

/** Group id of a wonder, or null when it stands alone. */
export function wonderGroupId(wonderId: string | null | undefined): string | null {
  return (wonderId && getWonder(wonderId)?.groupId) || null;
}

/**
 * All wonder ids sharing `wonderId`'s group (itself included); empty when the
 * wonder is ungrouped or unknown.
 */
export function wonderGroupMembers(wonderId: string | null | undefined): string[] {
  const gid = wonderGroupId(wonderId);
  if (!gid) return [];
  return WONDERS.filter((w) => w.groupId === gid).map((w) => w.id);
}

/** The wonder with this id, or undefined when the id is not a wonder. */
export function getWonder(wonderId: string | null | undefined): WonderDefinition | undefined {
  return wonderId ? WONDER_BY_ID.get(wonderId) : undefined;
}

/** True when `id` is one of the 25 wonder ids. */
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
  // Owners first: group sisters need to know whether their group is closed.
  const owners = new Map(WONDERS.map((w) => [w.id, findWonderOwner(w.id, cities)]));
  for (const wonder of WONDERS) {
    let ownerCivId = owners.get(wonder.id) ?? null;
    let builderCivIds = findWonderBuilders(wonder.id, cities);
    // Mutually exclusive groups: a completed member closes the group — the
    // sisters take the completed member's colour (green when yours, red when
    // a rival's), since they can never be started any more. Races already in
    // progress on a sister are doomed, so they don't get a race colour.
    if (ownerCivId === null && wonder.groupId) {
      for (const memberId of wonderGroupMembers(wonder.id)) {
        if (memberId === wonder.id) continue;
        const memberOwner = owners.get(memberId);
        if (memberOwner !== null && memberOwner !== undefined) {
          ownerCivId = memberOwner;
          builderCivIds = [];
          break;
        }
      }
    }
    result[wonder.id] = computeWonderStatus({
      playerCivId,
      ownerCivId,
      builderCivIds,
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
  /**
   * Optional link to an official photo gallery, rendered next to the
   * Wikipedia link (e.g. the Super-Kamiokande gallery).
   */
  galleryUrl?: string;
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
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Nicolaus_Copernicus_Monument_in_Toru%C5%84_(Thorn).jpg',
    author: 'Pudelek',
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
    // Public-domain artwork with the visible credit line intentionally
    // hidden — only the "Read more on Wikipedia" link is shown.
    articleUrl: 'https://en.wikipedia.org/wiki/Human_Genome_Project',
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
  super_kamiokande: {
    // Artwork supplied by the project owner — no external source, author or
    // licence to attribute. The official gallery is linked under the image.
    articleUrl: 'https://en.wikipedia.org/wiki/Super-Kamiokande',
    galleryUrl: 'https://www-sk.icrr.u-tokyo.ac.jp/en/sk/experience/gallery/',
  },
  transistor: {
    articleUrl: 'https://en.wikipedia.org/wiki/Transistor',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Replica-of-first-transistor.jpg',
    author: 'Lucent Technologies',
    license: 'Public domain',
    licenseUrl: '',
  },
  statue_of_liberty: {
    articleUrl: 'https://en.wikipedia.org/wiki/Statue_of_Liberty',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Liberty_Island_photo_Don_Ramey_Logan.jpg',
    author: 'Don Ramey Logan',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
  },
  tiangong: {
    articleUrl: 'https://en.wikipedia.org/wiki/Tiangong_space_station',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tiangong_Space_Station_Rendering_2021.08.png',
    author: 'Shujianyang',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  },
  mir: {
    articleUrl: 'https://en.wikipedia.org/wiki/Mir',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mir_space_station_12_June_1998.jpg',
    author: 'NASA',
    license: 'Public domain',
    licenseUrl: '',
  },
  ai_supercluster: {
    articleUrl: 'https://en.wikipedia.org/wiki/Colossus_(data_center)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:CSIRO_ScienceImage_11313_The_CSIRO_GPU_cluster_at_the_data_centre.jpg',
    author: 'division, CSIRO',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
  },
};

