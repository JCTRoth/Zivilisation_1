/**
 * Nomads — the opening visitors. Constants for the whole feature: tuned so
 * the visit lands inside the dead window of turns 4–10, the deal stays fair
 * (half research cost for knowledge, above-build-cost for spears), and the
 * relationship has a memory: friendly courts get them back with maps, angry
 * ones get their stores raided.
 */

/** Earliest round (0-based) the nomads may seek the player. */
export const NOMAD_TRIGGER_ROUND = 4;

/** Fallback trigger: with no city by this round, they visit the settlers. */
export const NOMAD_TRIGGER_FALLBACK_ROUND = 12;

/** The envoy arrives at the court this many rounds after the camp appears. */
export const NOMAD_PARLEY_DELAY_ROUNDS = 2;

/** Camp spawn distance (Chebyshev) from the visited city/units. */
export const NOMAD_SPAWN_MIN_DISTANCE = 9;
export const NOMAD_SPAWN_MAX_DISTANCE = 13;

/** The horde: two spears and a rider — enough to matter, not enough to win. */
export const NOMAD_SPAWN_UNITS = ['warriors', 'warriors', 'scout'] as const;
export const NOMAD_HIRE_COST_FACTOR = 1.1;

/** The tech bargain: half of the raw research cost, clamped. */
export const NOMAD_TECH_PRICE_DIVISOR = 2;
export const NOMAD_TECH_PRICE_MIN = 25;
export const NOMAD_TECH_PRICE_MAX = 100;

/** Fog reveal around the camp when their maps are accepted. */
export const NOMAD_MAP_REVEAL_RADIUS = 10;
/** The friendly return visit charts MORE of the world — their gift. */
export const NOMAD_RETURN_MAP_RADIUS = 14;

/**
 * How long the camp stands after a DEAL (tech/maps taken) — the window in
 * which any civilization, player or AI, may hire the horde. A refusal
 * ("pass in peace") sends them off much sooner.
 */
export const NOMAD_CAMP_LINGER_ROUNDS = 20;
export const NOMAD_PASS_DEPART_ROUNDS = 6;

/**
 * The AI may try to hire from this many rounds after the first parley —
 * late in the linger (a dealt camp stands ~20), so the race fires as the
 * camp is about to walk: a real last chance, and the tribe keeps ITS
 * opening build slots (an early hire would end their economy at round 14).
 */
export const NOMAD_AI_HIRE_MIN_ROUND_GAP = 16;

/** Per-round chance an eligible AI takes the horde, scaled by diplomacy. */
export const NOMAD_AI_HIRE_BASE_CHANCE = 0.1;
export const NOMAD_AI_HIRE_DIPLOMACY_BONUS = 0.04;

/** The parley re-offers when the player stands at the camp after dismissal. */
export const NOMAD_REOFFER_COOLDOWN_ROUNDS = 3;

/** How close (Chebyshev) a player unit must be to re-offer / trigger visit 2. */
export const NOMAD_PROXIMITY_DISTANCE = 2;

// ── The Nomads as their OWN AI player ─────────────────────────────────────

/**
 * The nomads' civilization id — deliberately NOT `BARBARIAN_CIV_ID` (-1):
 * the barbarian AI drives every -1 unit and city, and the nomads are their
 * own player with their own economy. Negative ids skip contact recording,
 * render with the neutral fallback colour and never win or lose anything —
 * exactly like the barbarians, but never confused with them.
 */
export const NOMAD_CIV_ID = -2;

/** The camp opens its war chest with this much gold. */
export const NOMAD_START_GOLD = 300;

/** One tribe trades with at most six cities (routes + in-flight caravans). */
export const NOMAD_TRADE_ROUTE_LIMIT = 6;
/**
 * The camp fashions a travelling bazaar every this many rounds — and it is
 * expensive on purpose: a full third of the opening purse, so a route is an
 * INVESTMENT the economy has to pay back (up to this many in transit).
 * The cadence is tuned against the camp's short life (a dealt camp stands
 * ~20 rounds): 8 rounds gives two to three bazaars per stint.
 */
export const NOMAD_CARAVAN_BUILD_ROUNDS = 8;
export const NOMAD_CARAVAN_MAX_IN_FLIGHT = 2;
/** A caravan that cannot take a single step for this many rounds is lost. */
export const NOMAD_CARAVAN_BLOCKED_ROUNDS = 10;
/** Hard transit cap: no delivery in this many rounds and the road is given up. */
export const NOMAD_CARAVAN_MAX_AGE_ROUNDS = 40;

/** Route income per turn: base + half the partner city's population. */
export const NOMAD_ROUTE_INCOME_BASE = 3;
/** A bought city pays tribute per population per turn. */
export const NOMAD_CITY_TRIBUTE_PER_POP = 1;

/** The city market: they bid when rich, and never for a refused city. */
export const NOMAD_CITY_OFFER_MIN_GOLD = 450;
export const NOMAD_CITY_OFFER_COOLDOWN_ROUNDS = 15;
export const NOMAD_CITY_PRICE_BASE = 250;
export const NOMAD_CITY_PRICE_PER_POP = 75;

/** When trouble starts, gold buys soldiers: bribes near the camp. */
export const NOMAD_BRIBE_RADIUS = 4;
export const NOMAD_BRIBE_COOLDOWN_ROUNDS = 3;

// ── The tribe's strategy brain (NomadAI) ──────────────────────────────────

/**
 * Every this many rounds the tribe reviews its priorities — and the review
 * is what makes it VARY over time: roads while the map still holds
 * unsigned cities, the treasury while saving, the market when a city is
 * within reach, steel when the clan is warlike (bribery whenever angry
 * overrides every review).
 */
export const NOMAD_STRATEGY_REVIEW_ROUNDS = 8;

/** The camp may muster up to this many EXTRA soldiers beyond the spawned horde. */
export const NOMAD_CAMP_MUSTER_LIMIT = 2;
/** Rounds between two musters (only while the steel stance holds). */
export const NOMAD_CAMP_MUSTER_ROUNDS = 8;

/** Under this much gold the tribe swallows its pride and asks YOU for help. */
export const NOMAD_MONEY_REQUEST_BELOW = 80;
export const NOMAD_MONEY_REQUEST_AMOUNT = 60;
export const NOMAD_MONEY_REQUEST_COOLDOWN_ROUNDS = 25;

/** Knowledge brokerage: a tech sold to an AI court every this many rounds. */
export const NOMAD_KNOWLEDGE_ROUNDS = 15;
/** Price of brokered knowledge: half the raw research cost, clamped. */
export const NOMAD_KNOWLEDGE_PRICE_DIVISOR = 2;
export const NOMAD_KNOWLEDGE_PRICE_MIN = 25;
export const NOMAD_KNOWLEDGE_PRICE_MAX = 100;

/** Barbarian friendship: when they take a city, the camp strikes tents
 *  and moves in beside it (a free spot within this Chebyshev distance). */
export const NOMAD_MIGRATION_MAX_DISTANCE = 3;

/** A friendly court earns ONE return visit, this many rounds after leaving. */
export const NOMAD_MAX_VISITS = 2;
export const NOMAD_RETURN_DELAY_ROUNDS = 30;

/** An angry camp preys on you for this long, then walks away for good. */
export const NOMAD_RAID_ROUNDS = 12;
/** Gold stolen per raid when the nomads reach a city's stores (share of treasury). */
export const NOMAD_RAID_GOLD_SHARE = 0.15;
export const NOMAD_RAID_GOLD_MIN = 5;
export const NOMAD_RAID_GOLD_MAX = 30;
/** Rounds between two raids on the same city. */
export const NOMAD_RAID_COOLDOWN_ROUNDS = 3;

/** A settlement sits within this of a city and drains its food. */
export const NOMAD_SETTLEMENT_MAX_DISTANCE = 2;
export const NOMAD_SETTLEMENT_FOOD_COST = 2;
/** The city notices a settlement this close (food drain lookup radius). */
export const NOMAD_SETTLEMENT_DRAIN_RADIUS = 3;
/** The settlers raise this many defenders for the city that feeds them. */
export const NOMAD_SETTLEMENT_DEFENDERS = 1;

// ── The three clans ───────────────────────────────────────────────────────

export type NomadPersonality = 'trader' | 'warrior' | 'mystic';

export interface NomadClan {
  id: 'sandborne' | 'ironhoof' | 'greywind';
  /** i18n key of the clan name. */
  nameKey: string;
  /** i18n key of the epithet shown under the name in the audience. */
  epithetKey: string;
  personality: NomadPersonality;
  /** Root-relative art under public/ — shown big, falls back to `icon`. */
  image: string;
  /** Emoji fallback until the art exists. */
  icon: string;
  /** i18n keys of the opening and the returning line. */
  leadKey: string;
  returnLeadKey: string;
  /** Price factors: the trader bargains, the proud overcharge. */
  techPriceFactor: number;
  hirePriceFactor: number;
  /** Chance a parley includes the settlement door. */
  settleChance: number;
  /** Refusals tolerated before the clan turns hostile. */
  angerTolerance: number;
}

/**
 * Three identities, three temperaments. The roll happens once per game —
 * the SAME clan returns on a return visit (they are who you met).
 */
export const NOMAD_CLANS: readonly NomadClan[] = [
  {
    id: 'sandborne',
    nameKey: 'nomad.clan.sandborne.name',
    epithetKey: 'nomad.clan.sandborne.epithet',
    personality: 'trader',
    image: '/assets/nomads/sandborne.png',
    icon: '🐫',
    leadKey: 'nomad.clan.sandborne.lead',
    returnLeadKey: 'nomad.clan.sandborne.returnLead',
    techPriceFactor: 0.8,
    hirePriceFactor: 1.0,
    settleChance: 0.55,
    angerTolerance: 3,
  },
  {
    id: 'ironhoof',
    nameKey: 'nomad.clan.ironhoof.name',
    epithetKey: 'nomad.clan.ironhoof.epithet',
    personality: 'warrior',
    image: '/assets/nomads/ironhoof.png',
    icon: '🐎',
    leadKey: 'nomad.clan.ironhoof.lead',
    returnLeadKey: 'nomad.clan.ironhoof.returnLead',
    techPriceFactor: 1.0,
    hirePriceFactor: 1.4,
    settleChance: 0.15,
    angerTolerance: 1,
  },
  {
    id: 'greywind',
    nameKey: 'nomad.clan.greywind.name',
    epithetKey: 'nomad.clan.greywind.epithet',
    personality: 'mystic',
    image: '/assets/nomads/greywind.png',
    icon: '🐺',
    leadKey: 'nomad.clan.greywind.lead',
    returnLeadKey: 'nomad.clan.greywind.returnLead',
    techPriceFactor: 0.9,
    hirePriceFactor: 1.0,
    settleChance: 0.3,
    angerTolerance: 2,
  },
];
