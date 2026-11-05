/**
 * Nomads — the opening visitors. Constants for the whole feature: tuned so
 * the visit lands inside the dead window of turns 4–10, the deal stays fair
 * (half research cost for knowledge, a real price for the spears you meet),
 * and the relationship has a memory: friendly courts get them back with maps,
 * angry ones get their stores raided.
 */

/** Earliest round (0-based) the nomads may seek the player. */
export const NOMAD_TRIGGER_ROUND = 4;

/** Fallback trigger: with no city by this round, they visit the settlers. */
export const NOMAD_TRIGGER_FALLBACK_ROUND = 12;

/** Camp spawn distance (Chebyshev) from the visited city/units. */
export const NOMAD_SPAWN_MIN_DISTANCE = 9;
export const NOMAD_SPAWN_MAX_DISTANCE = 13;

/** The horde: two spears and a rider — enough to matter, not enough to win. */
export const NOMAD_SPAWN_UNITS = ['warriors', 'warriors', 'scout'] as const;
/**
 * Hire price = the MEETED units' build cost × this × the clan's factor.
 *
 * ×5, not ×1.1: at 1.1 the whole horde went for ~38 gold, less than a
 * single round of a city's taxes — mercenaries that cheap were free money.
 * At ×5 the starting three ask ~175 gold (a lone rider you met: 50), which
 * is a real decision inside the camp's 20-round linger.
 *
 * Only the units that STAND WITH YOU are sold (see
 * `NomadManager.meetingUnitIds`): the rest of the tribe keeps its tents and
 * stays neutral — you hire the riders you met, not a horde you never saw.
 */
export const NOMAD_HIRE_COST_FACTOR = 5;

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

/**
 * Per-round chance an eligible AI court buys ONE GROUP off the camp,
 * scaled by diplomacy — **seldom** on purpose: from
 * `NOMAD_AI_HIRE_MIN_ROUND_GAP` to the end of the linger there are only a
 * handful of rolls, and a court never buys the tribe's last camp (see
 * `NomadManager.tryAiHire`). Base0.02 + 0.005 × diplomacy ≈ 18 % per visit.
 */
export const NOMAD_AI_HIRE_BASE_CHANCE = 0.02;
export const NOMAD_AI_HIRE_DIPLOMACY_BONUS = 0.005;

/** The parley re-offers when the player stands at the camp after dismissal. */
export const NOMAD_REOFFER_COOLDOWN_ROUNDS = 3;

/** How close (Chebyshev) a player unit must be to re-offer / trigger visit 2. */
export const NOMAD_PROXIMITY_DISTANCE = 2;

// ── Travelling from court to court ────────────────────────────────────────

/**
 * The tribe does not stay with one court: after a visit ends it strikes
 * camp and RIDES ON to the next one (every alive court in turn — the human
 * first, then the AI rivals, then around again). This is the travel spell
 * between two camps: long enough that a visit reads as an event, short
 * enough that every court sees them within a game.
 */
export const NOMAD_TRAVEL_ROUNDS = 12;

/**
 * The contact window: how long a camp may wait at a court that never opens
 * its door (an unreachable island, a city with no room to walk in) before it
 * strikes tents and rides on. It is also the camp's `departAt` before any
 * deal is struck — so pinning `departAt` to null (the tests do) holds the
 * camp indefinitely.
 */
export const NOMAD_CONTACT_TIMEOUT_ROUNDS = 60;

// ── What a camp standing at your gate costs you ───────────────────────────

/**
 * Food per turn a VISITING camp costs the city it camps beside — the
 * temporary version of the settlement's drain (`NOMAD_SETTLEMENT_FOOD_COST`,
 * which is permanent). Charged for every camp (tents or splinter) within
 * the settlement drain radius of the city, for as long as it stands there.
 */
export const NOMAD_CAMP_FOOD_COST = 1;

/**
 * Prices rise by this much per refusal: the tribe remembers a closed hand,
 * and what they sell you (knowledge, the horde) is priced accordingly. Four
 * refusals double the price — past the clan's tolerance they stop selling
 * entirely and turn hostile instead.
 */
export const NOMAD_REFUSAL_PRICE_PENALTY = 0.25;

/**
 * A settled camp earns its host city one trade-route slot beyond the
 * normal cap (`MAX_TRADE_ROUTES`): their stakes beside your fields are
 * worth a fourth road.
 */
export const NOMAD_TRADE_ROUTE_SLOT_BONUS = 1;

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

// ── The roaming horde — wander, growth and the great split ─────────────────

/**
 * POST-SPLIT GROWTH — "later with more": once the parley has been ANSWERED
 * the horde no longer stands as a three-spear curiosity; it gathers its own
 * riders, one every this many rounds, paid from the chest like everything
 * else. (The steel stance gathers at the same cadence pre-parley, under the
 * old v1 garrison cap; post-parley the growth cap below governs both.)
 */
export const NOMAD_GROWTH_ROUNDS = 8;

/**
 * THE SPLIT — when a living group reaches this many wanderers it divides
 * into two COOPERATING camps (half each): the same tribe, one standing, one
 * chest — but two tents. No further split while the tribe already holds
 * `NOMAD_MAX_CAMPS` camps; the groups simply regrow instead.
 */
export const NOMAD_GROUP_SPLIT_SIZE = 6;
/** Splinter tents stand within this Chebyshev distance of the parent camp. */
export const NOMAD_SPLIT_DISTANCE = 4;
/** The tribe never forms more than this many camps at once. */
export const NOMAD_MAX_CAMPS = 2;
/** A settlement's wanderers never stray further from their stakes than this (tiles). */
export const NOMAD_ROAM_LEASH = 6;
/**
 * How often a wandering step drifts SIDeways instead of closing in (0–1).
 * The walk is a wander, not a march — but a drifting step is only ever
 * drawn from the same-distance neighbours, so the visit still lands.
 */
export const NOMAD_WANDER_DRIFT_CHANCE = 0.35;

// ── Settled camps — the nomads that live with a city ───────────────────────

/**
 * A settlement keeps PRODUCING: the camp musters one of its own wanderers
 * every this many rounds, from the settlement tile, paid from the chest.
 * The produced wanderers roam the land around their camp again.
 */
export const NOMAD_SETTLEMENT_MUSTER_ROUNDS = 12;
/** Wanderers a settlement may sustain at once (their camps never mass). */
export const NOMAD_SETTLEMENT_MUSTER_LIMIT = 2;
/** The deal: a settlement brings trade — the host city earns this much gold
 *  per turn while it feeds the camp (the settlement's day market). */
export const NOMAD_SETTLEMENT_TRADE_GOLD = 2;

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
  id: 'bedouin' | 'mongol' | 'sami';
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
 * How each standing colours the UI — the audience frame and the diplomacy
 * hall's badge read the same three words in the same three colours.
 */
export const NOMAD_STANDING_COLORS: Record<'neutral' | 'friendly' | 'angry', string> = {
  neutral: '#9aa7b4',
  friendly: '#4caf50',
  angry: '#f44336',
};

/**
 * The doors of a nomad audience, each with the icon its card leads with —
 * shared by the audience screen and the diplomacy hall, which both render
 * the same `AudienceChoice` list.
 */
export const NOMAD_CHOICE_ICONS: Record<string, string> = {
  tech: '📜',
  techGift: '📜',
  maps: '🗺️',
  hire: '🗡️',
  settle: '⛺',
  pass: '🚶',
  farewell: '🚶',
  buy_city: '🏙️',
  refuse_city: '🚫',
  giveGold: '🪙',
  refuseGold: '🪙',
};

/**
 * THREE PEOPLES, THREE TEMPERAMENTS — chosen from the history of the
 * world's nomads rather than from game archetypes (research notes, lore
 * and the generation prompts live in
 * [`FACTIONS_README.md`](../game/engine/nomad/FACTIONS_README.md)):
 *
 *   * **The Bedouin** — Arabia's and the Sahara's camel caravans: the
 *     well, the duty of hospitality (*diyafa*), the incense roads. The
 *     traders.
 *   * **The Mongol Horde** — the steppe confederation: horse archers, the
 *     *yam* relay, the ger camp that moves with the season. The warriors.
 *   * **The Sámi** — Sápmi's tundra: the reindeer migration, the *noaidi's*
 *     drum, a sky read like a road. The mystics.
 *
 * The roll happens once per game — the SAME people return on a return
 * visit (they are who you met). The ORDER is load-bearing: tests roll the
 * clan by index (trader / warrior / mystic).
 */
export const NOMAD_CLANS: readonly NomadClan[] = [
  {
    // The Bedouin — the desert's merchants. A well is wealth and hospitality
    // is law: they bargain, they plant their stakes beside a city often, and
    // they forgive three refusals before they ride off offended.
    id: 'bedouin',
    nameKey: 'nomad.clan.bedouin.name',
    epithetKey: 'nomad.clan.bedouin.epithet',
    personality: 'trader',
    image: '/assets/nomads/bedouin.png',
    icon: '🐫',
    leadKey: 'nomad.clan.bedouin.lead',
    returnLeadKey: 'nomad.clan.bedouin.returnLead',
    techPriceFactor: 0.8,
    hirePriceFactor: 1.0,
    settleChance: 0.55,
    angerTolerance: 3,
  },
  {
    // The Mongol Horde — the steppe's soldiers. They do not beg at gates,
    // they overcharge for their spears, they rarely settle (the camp moves
    // with the season) and ONE refusal is their limit.
    id: 'mongol',
    nameKey: 'nomad.clan.mongol.name',
    epithetKey: 'nomad.clan.mongol.epithet',
    personality: 'warrior',
    image: '/assets/nomads/mongol.png',
    icon: '🐎',
    leadKey: 'nomad.clan.mongol.lead',
    returnLeadKey: 'nomad.clan.mongol.returnLead',
    techPriceFactor: 1.0,
    hirePriceFactor: 1.4,
    settleChance: 0.15,
    angerTolerance: 1,
  },
  {
    // The Sámi — the tundra's path-finders. The stars already named the
    // road: they chart what you have not walked, stake their tents sometimes
    // and keep their own counsel through two refusals.
    id: 'sami',
    nameKey: 'nomad.clan.sami.name',
    epithetKey: 'nomad.clan.sami.epithet',
    personality: 'mystic',
    image: '/assets/nomads/sami.png',
    icon: '🦌',
    leadKey: 'nomad.clan.sami.lead',
    returnLeadKey: 'nomad.clan.sami.returnLead',
    techPriceFactor: 0.9,
    hirePriceFactor: 1.0,
    settleChance: 0.3,
    angerTolerance: 2,
  },
];
