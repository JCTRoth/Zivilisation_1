/**
 * Nomads — a relationship, not an event.
 *
 * Three peoples (the Bedouin traders, the Mongol riders, the Sámi seers)
 * with three temperaments visit once per single-human game. What happens
 * after is remembered:
 *
 *   * **Dealt with** (tech / maps / hire) → standing `friendly`. They leave
 *     after the linger window and ONE return visit follows 30 rounds later,
 *     bringing a bigger chart of the unknown world as their gift.
 *   * **Refused** → refusals accumulate per clan tolerance; beyond it, or if
 *     you **attack the camp**, they turn `angry`: the horde wakes and raids
 *     you (troops bleed in fights, stores stolen at the gates) for 12 rounds,
 *     then walks away for good.
 *   * **Settled** (random door, per clan chance) → a settlement beside your
 *     city: your fields feed it (−2 food/turn in the city balance) and their
 *     spears stand ready (free defenders raised for you).
 *
 * The tribe also keeps its own books like a player, taking its orders
 * from `NomadAI` (the strategy brain in this folder): it opens with 300
 * gold, its travelling bazaars (a unit type ONLY the camp can build, and
 * an expensive one) run trade routes with up to six cities (2 + pop/2
 * gold each per turn), a bought city pays tribute per head, the steel
 * stance musters a limited garrison, and every 15 rounds a technology is
 * sold to an AI court. A rich, peaceful camp tables an offer to BUY one
 * of your cities (never your last, refused ones never again); an angry one
 * spends the same gold bribing your troops standing near the horde; a
 * broke one swallows its pride and asks YOU for a loan. And nomads and
 * barbarians are friends — when they take a city, the camp moves in.
 *
 * Design rules (mirroring TeamCoordinator):
 *   * **Their own AI player, neutral by default.** Civ id -2 — NOT the
 *     barbarians' -1 (BarbarianManager drives every -1 unit and city, and
 *     would commandeer the camp). Contact recording skips negative ids, no
 *     civ is at war with the camp, and the tribe's treasury, routes and
 *     city market all live here (there is no `civilizations[-2]` entry).
 *   * **Stateless across loads.** Nothing is persisted; a loaded game has no
 *     nomads (v1). The settlement TILE flag does persist — its food/denfense
 *     effects live in engine code that reads the map, not in this manager.
 *   * **Single human seat only.**
 *   * **Fair by construction.** Half research cost (clan-adjusted), five
 *     times build cost for the riders who actually stand with you
 *     (clan-adjusted), the promised terms are what the BUTTON said.
 */
import type GameEngine from '../GameEngine';
import type { AudienceChoice, Civilization, City, Unit } from '../../../../types/game';
import { UNIT_PROPS } from '@/utils/Constants';
import {
  NOMAD_MIRRORED_UNITS,
  NOMAD_MOUNTED_UNITS,
  UNIT_TYPES,
  nomadFootType,
  nomadMountedType,
} from '@/data/UnitConstants';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import { bribeUnitCost } from '../DiplomacyManager';
import { stripPalaceBuildings } from '../BuildingEffects';
import { decideAiAttack } from '../AI/AttackOdds';
import { NomadAI, type NomadPlan, type NomadSituation, type NomadStance } from './NomadAI';
import {
  NOMAD_AI_HIRE_BASE_CHANCE,
  NOMAD_AI_HIRE_DIPLOMACY_BONUS,
  NOMAD_AI_HIRE_MIN_ROUND_GAP,
  NOMAD_BRIBE_COOLDOWN_ROUNDS,
  NOMAD_BRIBE_RADIUS,
  NOMAD_CAMP_LINGER_ROUNDS,
  NOMAD_CAMP_MUSTER_LIMIT,
  NOMAD_CAMP_MUSTER_ROUNDS,
  NOMAD_CARAVAN_BLOCKED_ROUNDS,
  NOMAD_CARAVAN_MIN_JOURNEY,
  NOMAD_RIDE_HOLD_DISTANCE,
  NOMAD_CARAVAN_MAX_AGE_ROUNDS,
  NOMAD_CITY_OFFER_COOLDOWN_ROUNDS,
  NOMAD_CITY_OFFER_MIN_GOLD,
  NOMAD_CITY_PRICE_BASE,
  NOMAD_CITY_PRICE_PER_POP,
  NOMAD_CITY_TRIBUTE_PER_POP,
  NOMAD_CLANS,
  NOMAD_CIV_ID,
  NOMAD_CONTACT_TIMEOUT_ROUNDS,
  NOMAD_CARAVAN_BUILD_ROUNDS,
  NOMAD_CARAVAN_MAX_IN_FLIGHT,
  NOMAD_GROWTH_ROUNDS,
  NOMAD_GROUP_RADIUS,
  NOMAD_GROUP_SPLIT_SIZE,
  NOMAD_HIRE_COST_FACTOR,
  NOMAD_KNOWLEDGE_PRICE_DIVISOR,
  NOMAD_KNOWLEDGE_PRICE_MAX,
  NOMAD_KNOWLEDGE_PRICE_MIN,
  NOMAD_KNOWLEDGE_ROUNDS,
  NOMAD_MAP_REVEAL_RADIUS,
  NOMAD_MOUNT_ICONS,
  NOMAD_MAX_VISITS,
  NOMAD_MIGRATION_MAX_DISTANCE,
  NOMAD_MONEY_REQUEST_AMOUNT,
  NOMAD_MONEY_REQUEST_BELOW,
  NOMAD_MONEY_REQUEST_COOLDOWN_ROUNDS,
  NOMAD_PASS_DEPART_ROUNDS,
  NOMAD_PROXIMITY_DISTANCE,
  NOMAD_RAID_COOLDOWN_ROUNDS,
  NOMAD_RAID_GOLD_MAX,
  NOMAD_RAID_GOLD_MIN,
  NOMAD_RAID_GOLD_SHARE,
  NOMAD_RAID_ROUNDS,
  NOMAD_REOFFER_COOLDOWN_ROUNDS,
  NOMAD_REFUSAL_PRICE_PENALTY,
  NOMAD_RETURN_DELAY_ROUNDS,
  NOMAD_RETURN_MAP_RADIUS,
  NOMAD_ROUTE_INCOME_BASE,
  NOMAD_ROAM_LEASH,
  NOMAD_SETTLEMENT_DEFENDERS,
  NOMAD_SETTLEMENT_FOOD_COST,
  NOMAD_SETTLEMENT_MAX_DISTANCE,
  NOMAD_SETTLEMENT_MUSTER_LIMIT,
  NOMAD_SETTLEMENT_MUSTER_ROUNDS,
  NOMAD_SETTLEMENT_TRADE_GOLD,
  NOMAD_TRADE_ROUTE_SLOT_BONUS,
  NOMAD_SPLIT_DISTANCE,
  NOMAD_MAX_CAMPS,
  NOMAD_SPAWN_MAX_DISTANCE,
  NOMAD_SPAWN_MIN_DISTANCE,
  NOMAD_WANDER_DRIFT_CHANCE,
  NOMAD_SPAWN_UNITS,
  NOMAD_START_GOLD,
  NOMAD_TECH_PRICE_DIVISOR,
  NOMAD_TECH_PRICE_MAX,
  NOMAD_TECH_PRICE_MIN,
  NOMAD_TRADE_ROUTE_LIMIT,
  NOMAD_TRAVEL_ROUNDS,
  NOMAD_TRIGGER_FALLBACK_ROUND,
  NOMAD_TRIGGER_ROUND,
  type NomadClan,
  type NomadPersonality,
} from '@/data/NomadConstants';

/** What a resolved parley did — the UI turns this into a localized toast. */
export interface NomadOutcome {
  ok: boolean;
  /**
   * `noGold`: the treasury cannot meet the hire price (UI shows the hint).
   * `notMeeting`: a door that sells the riders was answered from afar —
   * nobody stands with you, so nothing changes (UI shows the hint).
   */
  result?:
    | 'tech' | 'techGift' | 'maps' | 'hire' | 'settle' | 'pass' | 'noGold'
    | 'notMeeting'
    | 'cityBought' | 'cityRefused'
    | 'goldGiven' | 'goldRefused';
  params?: Record<string, string | number>;
}

/**
 * The tribe as the diplomacy hall needs it: who they are, how they stand
 * towards you, where they are and what is on the table. Every field is a
 * snapshot — the hall reads this, `resolveParley` is the only way to act.
 */
export interface NomadHallState {
  /** Sighted at least once — the hall lists them from then on. */
  known: boolean;
  clanId: string | null;
  nameKey: string | null;
  epithetKey: string | null;
  /** Emoji fallback while the clan art does not exist. */
  icon: string;
  /** The clan's portrait (`/assets/nomads/<clan>.png`). */
  image: string | null;
  standing: NomadStanding;
  /** The tribe's current doctrine: roads / treasury / market / steel / bribery. */
  stance: NomadStance;
  /** The player's units stand with them right now — the gate is open. */
  meeting: boolean;
  /** The doors on the table right now; null when there is nothing to treat about. */
  choices: AudienceChoice[] | null;
  visits: number;
  /** Where their tents stand; null when no camp is on the map. */
  campTile: { col: number; row: number } | null;
  /**
   * Whose court the camp stands at right now — `null` when they are
   * between courts. Not yours means they are away (and the hall can say
   * so instead of just locking the doors).
   */
  campCivId: number | null;
}

interface NomadPending {
  /** The technology the button promised (never re-rolled at resolve time). */
  tech?: string;
  /** The gold the button promised. */
  price?: number;
  /** The settlement tile the button offered (never re-picked at resolve). */
  settle?: { col: number; row: number; cityId: string };
  /** The city the market offered, at the price the button promised. */
  cityId?: string;
  cityPrice?: number;
}

export type NomadStanding = 'neutral' | 'friendly' | 'angry';

/**
 * One of the tribe's camps: its tents, its riders — and the visit **it** is
 * on. The tribe travels camp by camp, so one camp can stand at your gate
 * (costing you food, opening an audience) while another stands at a rival's,
 * both steered by the one `NomadAI`.
 *
 * Everything a single visit needs lives here; everything the TRIBE shares
 * (the chest, the routes, the standing, the one open audience) stays on the
 * manager.
 */
export interface NomadCamp {
  /** The tents. */
  col: number;
  row: number;
  /** The riders (the bazaars are the economy's business, not the camp's). */
  unitIds: string[];
  /** Whose court this camp is visiting right now. */
  targetCivId: number;
  /** The round these tents were raised — the contact window runs from it. */
  spawnedRound: number;
  /** When this camp strikes tents (linger, refusal, or the contact window). */
  departAt: number | null;
  // ── This camp's own visit ────────────────────────────────────────────
  /** Has the envoy spoken AT THESE TENTS? */
  parleyEmitted: boolean;
  /** Was the audience here answered? */
  parleyDone: boolean;
  /** Was the second (farewell) audience tabled here? */
  secondEmitted: boolean;
  /** The round this camp last tabled an audience (the re-offer cooldown). */
  parleyEmittedRound: number;
  /** The round this camp's audience was answered (the AI race counts from it). */
  parleyResolvedRound: number;
  /** The pitch beside these tents — a tent tile, visual only (`nomadTent`). */
  tent: { col: number; row: number } | null;
}

/** A fresh camp at `targetCivId`, with nothing tabled yet. */
const newCamp = (col: number, row: number, targetCivId: number, round: number): NomadCamp => ({
  col,
  row,
  unitIds: [],
  targetCivId,
  spawnedRound: round,
  departAt: null,
  parleyEmitted: false,
  parleyDone: false,
  secondEmitted: false,
  parleyEmittedRound: -1,
  parleyResolvedRound: -1,
  tent: null,
});

export class NomadManager {
  private readonly gameEngine: GameEngine;

  // ── The relationship (one per game) ────────────────────────────────────
  private clan: NomadClan | null = null;
  private standing: NomadStanding = 'neutral';
  private refusals = 0;
  /**
   * Visits to THE HUMAN'S court — the relationship memory with YOU. The
   * tribe also camps at the AI rivals' courts on its travels; those are
   * counted by the road (`NomadCamp.targetCivId`), never here, so "they
   * came back to you" keeps meaning exactly that.
   */
  private visitCount = 0;
  private settled = false;
  private hired = false;
  private angrySince = -1;
  private readonly raidCooldowns = new Map<string, number>();

  // ── The tribe's own economy (their AI-player state) ────────────────────
  /** The war chest: opens with NOMAD_START_GOLD, pays for caravans, bribes, cities. */
  treasury = NOMAD_START_GOLD;
  /** Signed trade routes: the camp ↔ up to NOMAD_TRADE_ROUTE_LIMIT cities. */
  readonly routes: Array<{ partnerCityId: string; partnerCivId: number }> = [];
  /** Cities the nomads bought from the player (tribute per head per turn). */
  readonly ownedCityIds: string[] = [];
  /** Cities whose offer was refused — never offered again. */
  private readonly refusedCityIds = new Set<string>();
  private lastCaravanBuildRound = -1;
  private lastCityOfferRound = -1;
  private lastBribeRound = -1;
  private lastMusterRound = -1;
  private lastMoneyRequestRound = -1;
  private lastKnowledgeRound = -1;
  /** Soldiers the camp mustered itself (the spawn horde does not count). */
  private readonly musteredIds: string[] = [];
  /** Caravans en route to a partner city (consumed on delivery, Civ1 rule). */
  private readonly caravans: Array<{
    unitId: string;
    targetCityId: string;
    /** Rounds without a single successful step (a lost caravan aborts). */
    blockedRounds: number;
    /** Rounds since the camp built it (hard transit cap). */
    ageRounds: number;
  }> = [];

  // ── The tribe's camps — one visit each ────────────────────────────────
  /**
   * The tribe's tents, one record per camp (a grown tribe keeps up to
   * `NOMAD_MAX_CAMPS`). Each camp carries its OWN visit: which court it is
   * at, whether the envoy has spoken there, when it leaves — that is what
   * lets one group stand at your gate while another is at a rival's.
   */
  private readonly camps: NomadCamp[] = [];
  /**
   * The road: camps that struck tents and are RIDING to the next court —
   * their riders are still on the map, walking it step by step (see
   * `marchRoad`), visible the whole way. A leg with NO riders (the tribe
   * was sold out and re-forms) still arrives by the old spell
   * (`raiseArrivedCamps`) — which is exactly why a tribe that still HAS
   * another camp never vanishes from the world.
   */
  private readonly road: Array<{
    targetCivId: number;
    /** When a RIDERLESS leg re-forms by the spell; marching legs ignore it. */
    arriveAt: number;
    /** The riders doing the riding — empty for a spell leg. */
    unitIds: string[];
    /** A promised return to the human court: it never re-routes away. */
    promised: boolean;
    /** No-progress bookkeeping (a bay, a wall, an island → pick another court). */
    bestDist: number;
    sinceProgress: number;
  }> = [];
  /** The court the tribe was last at — what "no camp right now" reports. */
  private lastTargetCivId = 0;
  /** The door's price: the riders who STAND WITH YOU, never the whole tribe. */
  private hireCost = 0;
  private departed = false;
  /** The player bought riders at the gate (part of the horde may still be theirs). */
  private playerHired = false;
  /** Some court (yours or a rival's) bought a GROUP of riders. */
  private groupSold = false;
  /**
   * The doors of the audience currently on the table, as last emitted. Read
   * through `openChoices`, which only hands them out while `liveParley`
   * says an audience is actually open — so a stale copy can never sell
   * anything after the visit ended.
   */
  private liveChoices: AudienceChoice[] | null = null;
  /**
   * The camp the OPEN audience belongs to — the tents you are talking to.
   * Null for the tribe's own voices (the market, the plea), which belong to
   * no single camp.
   */
  private openCamp: NomadCamp | null = null;

  // ── Settled camps — the nomads living beside a city ───────────────────
  private settlementSpots: Array<{
    col: number;
    row: number;
    cityId: string;
    /** The wanderers the camp produced since it moved in. */
    unitIds: string[];
    /** Host troops the camp gifted as guards when the settlement was agreed. */
    guardUnitIds: string[];
    lastMusterRound: number;
  }> = [];

  // ── The audience currently on the table — one at a time, tribe-level ──
  private liveParley: 'first' | 'second' | 'city' | 'request' | null = null;
  /**
   * The round ANY audience was last tabled — the tribe's own voices (the
   * city market, the plea) re-table on this. Each camp's parley has its own
   * clock (`NomadCamp.parleyEmittedRound`).
   */
  private lastEmitRound = -1;
  /**
   * Has any audience of a visit been answered? A tribe-level fact, not a
   * camp's: the market and the plea wait for "the first parley is answered"
   * and must not forget it the moment the camp that answered rides off —
   * their own voices outlive every camp.
   */
  private parleyAnswered = false;
  private lastRound = 0;
  private pending: NomadPending | null = null;
  private settleRolled = false;
  /** The strategy brain — reviews priorities and hands out the round's plan. */
  private readonly ai = new NomadAI();

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ── State for the UI / tests ───────────────────────────────────────────

  get isSpawned(): boolean { return this.visitCount > 0; }
  /** Any camp with an answered audience — the tribe has dealt with you. */
  get isParleyDone(): boolean { return this.parleyAnswered; }
  get isHired(): boolean { return this.hired || this.playerHired || this.groupSold; }
  /**
   * They have left YOU: no camp of theirs is standing at your court anymore
   * (a group travelling to or camping at a rival's court does not count as
   * being here — and never as "gone for good" either).
   */
  get isDeparted(): boolean {
    return this.departed && !this.camps.some((c) => c.targetCivId === this.humanCivId());
  }
  /**
   * Whose court the tribe is standing at — the camp you are talking to,
   * else the tribe's first camp. The hall and the tests read this; every
   * rule inside the manager reads `NomadCamp.targetCivId` instead.
   */
  get currentTargetCivId(): number {
    return this.openCamp?.targetCivId ?? this.camps[0]?.targetCivId ?? this.lastTargetCivId;
  }
  /** The tribe's first camp (there may be a second), or null. */
  private get firstCamp(): NomadCamp | null { return this.camps[0] ?? null; }
  get isSettled(): boolean { return this.settled; }
  get isAngry(): boolean { return this.standing === 'angry'; }
  get currentStanding(): NomadStanding { return this.standing; }
  get visits(): number { return this.visitCount; }
  get currentClan(): NomadClan | null { return this.clan ? { ...this.clan } : null; }
  /** The rolled clan's temperament ('trader' | 'warrior' | 'mystic'). */
  get currentPersonality(): NomadPersonality | null { return this.clan?.personality ?? null; }
  /** What the tribe is currently about — 'roads' until the first review. */
  get currentStance(): NomadStance { return this.ai.currentStance; }
  /**
   * Where their tents stand: the camp AT YOUR COURT if one is there, else
   * the tribe's first camp. Null when the whole tribe is on the road.
   */
  get campTile(): { col: number; row: number } | null {
    const camp = this.camps.find((c) => c.targetCivId === this.humanCivId()) ?? this.firstCamp;
    return camp ? { col: camp.col, row: camp.row } : null;
  }

  /**
   * How many of the tribe's RIDERS stand within this Chebyshev distance of
   * a point. This is what a camp parked at your gate costs you in food
   * (`EconomicManager.nomadDrain`): the settlement's bill is per tile, a
   * visiting camp's is per mouth.
   */
  unitsNear(col: number, row: number, radius: number): number {
    if (this.camps.length === 0) return 0; // nobody camping: no scan
    const campIds = new Set(this.allCampUnitIds());
    let count = 0;
    for (const unit of this.gameEngine.units ?? []) {
      if (unit.isDefeated || !campIds.has(unit.id)) continue;
      if (Math.max(Math.abs(unit.col - col), Math.abs(unit.row - row)) <= radius) count++;
    }
    return count;
  }

  /**
   * The doors of the audience currently on the table — a copy, and only
   * while an audience is actually open (`liveParley`). The diplomacy hall
   * renders these; `resolveParley` is the only thing allowed to execute
   * them, and it re-checks the meeting before it sells anything.
   */
  get openChoices(): AudienceChoice[] | null {
    if (this.liveParley === null || !this.liveChoices) return null;
    return this.liveChoices.map((choice) => ({
      ...choice,
      labelParams: choice.labelParams ? { ...choice.labelParams } : undefined,
    }));
  }

  /**
   * Are the player's units standing with the nomads RIGHT NOW? The gate on
   * every action the diplomacy hall offers: without a meeting there is
   * reading about them, not dealing with them.
   */
  isDirectlyMeeting(): boolean {
    const humanId = this.humanCivId();
    if (humanId === null || this.visitCount === 0) return false;
    return this.meetingUnitIds(humanId).length > 0;
  }

  /**
   * The tribe as the diplomacy hall shows it: who they are, how they feel
   * about you, where they are and what is on the table. Read-only — the
   * hall must never be able to nudge the state machine by looking at it.
   */
  get hallState(): NomadHallState {
    const humanId = this.humanCivId();
    return {
      known: this.visitCount > 0,
      clanId: this.clan?.id ?? null,
      nameKey: this.clan?.nameKey ?? null,
      epithetKey: this.clan?.epithetKey ?? null,
      icon: this.clan?.icon ?? '🐎',
      image: this.clan?.image ?? null,
      standing: this.standing,
      stance: this.ai.currentStance,
      meeting: humanId !== null && this.meetingUnitIds(humanId).length > 0,
      choices: this.openChoices,
      visits: this.visitCount,
      campTile: this.campTile,
      // Whose gate a camp stands at: yours if one is here, else the first
      // camp's court — and if the whole tribe is riding, the court it rides
      // to (so the hall can say "away at …" instead of just locking up).
      campCivId: this.camps.find((c) => c.targetCivId === humanId)?.targetCivId
        ?? this.camps[0]?.targetCivId
        ?? this.road[0]?.targetCivId
        ?? null,
    };
  }

  /** Drop all state (new game / load): v1 nomads never survive a save. */
  reset(): void {
    this.clan = null;
    this.standing = 'neutral';
    this.refusals = 0;
    this.visitCount = 0;
    this.settled = false;
    this.hired = false;
    this.angrySince = -1;
    this.camps.length = 0;
    this.road.length = 0;
    this.lastTargetCivId = 0;
    this.raidCooldowns.clear();
    this.treasury = NOMAD_START_GOLD;
    this.routes.length = 0;
    this.ownedCityIds.length = 0;
    this.refusedCityIds.clear();
    this.lastCaravanBuildRound = -1;
    this.lastCityOfferRound = -1;
    this.lastBribeRound = -1;
    this.lastMusterRound = -1;
    this.lastMoneyRequestRound = -1;
    this.lastKnowledgeRound = -1;
    this.musteredIds.length = 0;
    this.ai.reset();
    this.caravans.length = 0;
    this.settlementSpots = [];
    this.hireCost = 0;
    this.departed = false;
    this.playerHired = false;
    this.groupSold = false;
    this.liveChoices = null;
    this.openCamp = null;
    this.liveParley = null;
    this.parleyAnswered = false;
    this.lastEmitRound = -1;
    this.lastRound = 0;
    this.pending = null;
    this.settleRolled = false;

    // THE NOMADS NEVER SURVIVE A SAVE — the rule, applied to what a save
    // actually carries. A restored map still holds their PITCH beside tents
    // that no longer exist, and their RIDERS and BAZAARS with no camp, no
    // road and no settlement spot behind them: nothing would ever move them
    // again (frozen in place for the rest of the game, and always drawn
    // through the fog, so the player would watch them stand there forever).
    // Put them back in the box with the rest of the tribe. The settlement's
    // DEFENDERS are the player's own units and stay where they were paid for.
    for (const tile of this.gameEngine.map?.tiles ?? []) {
      if (tile.nomadTent) {
        tile.nomadTent = false;
        if (!tile.nomadSettlement) tile.nomadTentClanId = undefined;
      }
    }
    this.gameEngine.units = (this.gameEngine.units ?? []).filter(
      (u) => u.civilizationId !== NOMAD_CIV_ID,
    );
  }

  // ── The per-round state machine ───────────────────────────────────────

  processRound(round: number): void {
    this.lastRound = round;
    if (this.gameEngine.isGameOver) return;
    const humanId = this.humanCivId();
    const allAi = humanId === null
      && Array.isArray(this.gameEngine.gameSettings?.humanPlayerIds)
      && this.gameEngine.gameSettings!.humanPlayerIds!.length === 0;
    // Single-human games: run with the human. All-AI spectator games: run
    // without a human (nomads travel between AI courts, no parleys). Hotseat
    // and other multi-human setups remain unsupported.
    if (humanId === null && !allAi) return;

    // The tribe's economy (their own AI-player turn): runs whenever the
    // tribe is in the game — routes and bought cities outlive the camp,
    // and even a hired/settled tribe keeps collecting what it is owed (only
    // building new caravans and tableing offers needs a standing camp that
    // still belongs to them — those guard themselves below).
    if (this.visitCount > 0) this.economyPhase(round, humanId);

    // NOTE: no `settled || hired` early return here — the CAMP machinery
    // below keys off `campAlive()`, and a hire RETIRES the camp identity
    // (see retireCampForHire), so the sold horde's bones can never be
    // raided, angered or departed with. A friendly tribe's RETURN visit —
    // scheduled by departure or by the sale — runs from the block below.

    // Anger from an attack: an injured or missing camp unit means somebody
    // drew first blood (only combat does either).
    if (this.campAlive() && this.standing !== 'angry' && this.wasAttacked()) {
      this.goAngry();
    }

    // The first visit — the story opens at a court. In single-human games
    // that's the human; in all-AI spectator games, pick any alive AI court.
    if (this.visitCount === 0) {
      const firstTarget = humanId ?? this.firstAiCourtId();
      if (firstTarget === null) return;
      const hasCity = (this.gameEngine.cities ?? []).some((c) => c.civilizationId === firstTarget);
      const due = (round >= NOMAD_TRIGGER_ROUND && hasCity)
        || round >= NOMAD_TRIGGER_FALLBACK_ROUND;
      if (due) this.spawnVisit(round, firstTarget);
      return;
    }

    // THE ROAD: a camp that rode far enough raises its tents at the next
    // court. It runs for every state of the tribe — one group can be
    // arriving while another still stands somewhere else, and an angry
    // tribe travels too (it simply raids when it gets there).
    this.raiseArrivedCamps(round);
    // THE REAL RIDE: whoever struck tents rides to the next court on its
    // own legs — visible the whole way, arriving by contact.
    this.marchRoad(round);

    // Angry camps prey on the player, then leave for good.
    if (this.standing === 'angry') {
      if (!this.campAlive()) return; // wiped out — nothing left to raid with
      if (humanId !== null) this.raidRound(humanId, round);
      if (round >= this.angrySince + NOMAD_RAID_ROUNDS) {
        for (const camp of [...this.camps]) this.departCamp(camp, round);
      }
      return;
    }

    // EVERY CAMP RUNS ITS OWN VISIT: contact, envoy, answer, linger,
    // strike tents. Two camps may be mid-visit at two different courts —
    // one at your gate, one at a rival's — steered by the one brain.
    for (const camp of [...this.camps]) this.runVisit(camp, round, humanId);
  }

  /**
   * One camp's turn at its court. The visit is per camp, so whichever group
   * you are standing with is the one whose envoy speaks to you.
   */
  private runVisit(camp: NomadCamp, round: number, humanId: number | null): void {
    if (!this.camps.includes(camp) || camp.unitIds.length === 0) return;
    const target = camp.targetCivId;
    const humanVisit = humanId !== null && target === humanId;

    // THE VISIT: their units walk up to the court — the envoy only ever
    // speaks when a nomad unit stands beside the host's city (or beside one
    // of its units), never on a timer. Until then this group WANDERS
    // (never receding from the way to the court); on contact the envoy
    // speaks: an audience for the human, a deal struck in code for a rival.
    if (!camp.parleyEmitted) {
      if (this.hasMetCourt(target, camp)) {
        this.openMeeting(round, camp);
      } else {
        this.roamCamp(camp, target);
        // They may have just reached the court's edge — speak now, not next round.
        if (this.hasMetCourt(target, camp)) this.openMeeting(round, camp);
      }
      return;
    }

    // The envoy's commute: after delivering (or being dismissed) they walk
    // home to THESE tents. Never blocks the machinery below.
    if (!this.campHome(camp)) this.returnMarch(camp);

    if (!camp.parleyDone) {
      // Only a HUMAN audience can be dismissed and re-offered; a rival's
      // meeting is resolved the moment it happens. THE RULE: they may not
      // STAY at your court without a dialog — so an unanswered audience
      // comes back whenever the camp stands with you (beside your city, or
      // beside a unit) or you walk up to its tents, never silent for more
      // than the re-offer cooldown.
      if (
        humanVisit
        && this.liveParley !== null
        && this.openCamp === camp
        && round >= camp.parleyEmittedRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
        && (this.hasMetCourt(camp.targetCivId, camp) || this.playerNearCamp(camp, humanId))
      ) {
        this.emitParley(camp, false, round);
      }
      return;
    }

    // The race: every eligible court may bid for THIS group (and never for
    // the tribe's last camp — see tryAiHire).
    if (
      this.liveParley === null
      && round >= camp.parleyResolvedRound + NOMAD_AI_HIRE_MIN_ROUND_GAP
    ) {
      this.tryAiHire(humanId, camp);
      if (!this.camps.includes(camp)) return; // sold out from under us
    }

    // Same rule after the answer: a group camped at your gate tables its
    // farewell audience instead of sitting there unannounced.
    if (
      humanVisit
      && this.liveParley === null
      && !camp.secondEmitted
      && round >= camp.parleyEmittedRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
      && (this.hasMetCourt(camp.targetCivId, camp) || this.playerNearCamp(camp, humanId))
    ) {
      this.emitParley(camp, true, round);
      return;
    }

    if (camp.departAt !== null && round >= camp.departAt) {
      this.departCamp(camp, round);
    }
  }

  /**
   * The envoy speaks. To the HUMAN it is an audience — the modal, the
   * doors, the camera. To a rival court it is resolved in code: they
   * answer with their own gold and temperament, and the player hears it
   * as news rather than being put in the rival's shoes.
   */
  private openMeeting(round: number, camp: NomadCamp): void {
    // THEY MAKE CAMP AT THE GATE: these tents move to the tile where the
    // envoy actually stood. From here THIS group is camped beside the host's
    // doorstep — its city pays their food (EconomicManager.nomadDrain) for
    // as long as they linger — and every straggler walks in to join them.
    const spot = this.meetingUnitIds(camp.targetCivId, camp)
      .map((id) => this.unitById(id))
      .find((u): u is Unit => u !== undefined);
    if (spot) {
      camp.col = spot.col;
      camp.row = spot.row;
      // The tents moved — so did the pitch: the tent always sits beside
      // wherever the group is standing right now (beside your city, when
      // the envoy spoke at its gate).
      this.pitchTent(camp);
    }

    if (camp.targetCivId === this.humanCivId()) {
      this.emitParley(camp, false, round);
      return;
    }
    this.resolveAiMeeting(camp);
  }

  /**
   * A rival court answers the envoy: they may buy the technology on offer
   * (half research cost, the clan's factor, their diplomacy is the chance),
   * hire the riders standing at their gate (read against the court's own
   * case — at war or short of troops it buys readily, a peacetime court
   * rarely: see `aiHireThreshold`), or simply wave the tribe on.
   * Either way the meeting is answered, the camp lingers, and the route
   * continues to the next court.
   */
  private resolveAiMeeting(camp: NomadCamp): void {
    const aiId = camp.targetCivId;
    this.escortBazaar(this.lastRound, camp); // they came with a caravan
    camp.parleyEmitted = true; // an AI meeting is answered once, in code
    const ai = this.gameEngine.civilizations?.[aiId];
    const meeting = this.meetingUnitIds(aiId, camp);
    const diplomacy = ai?.personality?.diplomacy ?? 5;
    const mood = Math.random();

    const tech = this.gameEngine.pickFreeTech(aiId);
    const price = tech ? this.techPriceFor(tech) : 0;
    // Their temperament, not a dice roll: a court that values knowledge
    // (diplomacy ≥ 3) and can pay takes what the envoy carries. The deal
    // has to be readable in the log — and the same dice decide the wander,
    // so a coin flip here would decide whether they ever ARRIVE to make it.
    const valuesKnowledge = diplomacy >= 3;
    if (tech && ai && (ai.resources?.gold ?? 0) >= price && valuesKnowledge) {
      ai.resources.gold = (ai.resources.gold ?? 0) - price;
      this.treasury += price;
      this.gameEngine.grantTech(aiId, tech);
      this.gameEngine.onStateChange?.('NOMAD_KNOWLEDGE', {
        techId: tech,
        tech: TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech,
        civId: aiId,
        civ: ai.name,
        gold: price,
      });
    } else if (this.camps.length > 1 && meeting.length > 0 && ai
      && (ai.resources?.gold ?? 0) >= this.hirePriceFor(meeting)
      && mood > this.aiHireThreshold(ai, aiId)) {
      // They buy ONE GROUP — and never the tribe's last camp (see the race).
      const cost = this.hirePriceFor(meeting);
      ai.resources.gold = (ai.resources.gold ?? 0) - cost;
      this.treasury += cost;
      this.sellCamp(camp, aiId, meeting, cost, true);
      return;
    }

    // They came, they dealt (or they didn't), they stay a while — the same
    // linger as at your gate, then their own route rides on.
    this.endVisitWithLinger(camp);
  }

  /**
   * How eager THIS court is to buy the riders standing at its gate.
   *
   * The ruler AI uses the tribe when it has a use for it: a court AT WAR, or
   * one with no more soldiers than it has cities, wants the spears and buys
   * at good odds (0.55); a peacetime court with a full purse still buys — a
   * bargain is a bargain — but rarely (0.9). The caller has already rolled
   * the one dice this decision gets: the same stream drives the wander, so a
   * second roll here would decide whether they ever ARRIVE to make the deal.
   */
  private aiHireThreshold(ai: Civilization, aiId: number): number {
    const atWar = (ai.warWith?.size ?? 0) > 0;
    const soldiers = (this.gameEngine.units ?? []).filter(
      (u) => u.civilizationId === aiId
        && u.isDefeated !== true
        && (UNIT_PROPS[String(u.type)]?.attack ?? 0) > 0,
    ).length;
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === aiId).length;
    return atWar || soldiers <= cities ? 0.55 : 0.9;
  }

  // ── The tribe's economy (their own AI-player turn) ────────────────────

  /**
   * One round of the nomad market: the strategy brain reviews the world
   * and hands down a plan, then the treasury collects what routes and
   * bought cities yield and spends it per that plan — bribes when angry,
   * bazaars and musters when investing, knowledge sales and the occasional
   * plea to your purse when trading, the city market when buying.
   *
   * Every door draws from the SAME chest: that — plus the 300 opening
   * purse, the 100-gold bazaar, the six-route ceiling and the 450-gold
   * market gate — is how the mechanics balance against each other.
   */
  private economyPhase(round: number, humanId: number | null): void {
    // The brain reviews first: the stance it announces is the stance this
    // round's plan executes (a stance change is announced once, on change).
    const situation = this.situationOf(round);
    const stanceChange = this.ai.review(situation);
    if (stanceChange) {
      this.gameEngine.onStateChange?.('NOMAD_STRATEGY', { stance: stanceChange });
    }
    const plan = this.ai.plan(situation);

    this.collectRouteIncome();
    this.collectCityTribute();
    if (humanId !== null) this.tryBribe(humanId, round, plan);
    this.tryBuildCaravan(round, plan);
    this.tryMuster(round, plan);
    this.moveCaravans();
    this.trySellKnowledge(round, plan);
    if (humanId !== null) this.tryOfferCity(humanId, round, plan);
    if (humanId !== null) this.tryAskForMoney(humanId, round, plan);
    this.settlementPhase(round);
  }

  /** The snapshot of the tribe the strategy brain is allowed to see. */
  private situationOf(round: number): NomadSituation {
    return {
      round,
      treasury: this.treasury,
      routeCount: this.routes.length,
      garrisonExtra: this.musteredIds.filter((id) => this.unitById(id) !== undefined).length,
      standing: this.standing,
      personality: this.clan?.personality ?? null,
      ownedCityCount: this.ownedCityIds.length,
    };
  }

  /** Route income per turn: base + half the partner city's population. */
  private collectRouteIncome(): void {
    if (this.routes.length === 0) return;
    let income = 0;
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const route = this.routes[i];
      const city = (this.gameEngine.cities ?? []).find((c) => c.id === route.partnerCityId);
      // The route is with the city AND its people: a partner that is gone —
      // or that fell to someone else, nomads included — is no longer one.
      if (!city || city.civilizationId !== route.partnerCivId) {
        this.routes.splice(i, 1);
        continue;
      }
      income += NOMAD_ROUTE_INCOME_BASE + Math.floor((city.population ?? 1) / 2);
    }
    this.treasury += income;
  }

  /** Every head in a bought city pays tribute — until somebody takes it back. */
  private collectCityTribute(): void {
    for (let i = this.ownedCityIds.length - 1; i >= 0; i--) {
      const city = (this.gameEngine.cities ?? []).find((c) => c.id === this.ownedCityIds[i]);
      if (!city || city.civilizationId !== NOMAD_CIV_ID) {
        this.ownedCityIds.splice(i, 1); // razed or retaken — no tribute from a grave
        continue;
      }
      this.treasury += (city.population ?? 1) * NOMAD_CITY_TRIBUTE_PER_POP;
    }
  }

  /**
   * Trouble buys soldiers: an angry camp offers gold to the player's troops
   * near the horde — the unit changes colors and joins the raiding party.
   * Own implementation of the conversion: `DiplomacyManager.bribeUnit`
   * debits `civilizations[civId].gold`, and the nomads have no civ entry
   * (their treasury lives right here).
   */
  private tryBribe(humanId: number, round: number, plan: NomadPlan): void {
    // `plan.bribe` is standing === 'angry' — the brain encodes the state,
    // this method only spends the gold on it.
    if (!plan.bribe || !this.campAlive()) return;
    if (round - this.lastBribeRound < NOMAD_BRIBE_COOLDOWN_ROUNDS) return;
    const horde = this.allCampUnitIds()
      .map((id) => this.unitById(id))
      .filter((u): u is Unit => u !== undefined);
    if (horde.length === 0) return;

    // The nearest of the player's TROOPS to the horde — a bribe is for
    // soldiers, and civilians have no loyalty to buy.
    let target: Unit | null = null;
    let targetDist = Number.POSITIVE_INFINITY;
    for (const unit of this.gameEngine.units ?? []) {
      if (unit.civilizationId !== humanId || unit.isDefeated) continue;
      if ((unit.attack ?? 0) <= 0 || unit.embarkedOn) continue;
      const d = Math.min(
        ...horde.map((h) => Math.max(Math.abs(unit.col - h.col), Math.abs(unit.row - h.row))),
      );
      if (d <= NOMAD_BRIBE_RADIUS && d < targetDist) {
        target = unit;
        targetDist = d;
      }
    }
    if (!target) return;
    const cost = bribeUnitCost(target);
    if (this.treasury < cost) return;

    this.treasury -= cost;
    target.civilizationId = NOMAD_CIV_ID;
    target.isFortified = false;
    target.orders = null;
    target.movesRemaining = target.maxMoves ?? target.movesRemaining;
    // Their troops now make YOUR problems — for the NEAREST tents.
    const nearest = this.camps
      .map((c) => ({
        c,
        d: Math.max(Math.abs(target.col - c.col), Math.abs(target.row - c.row)),
      }))
      .sort((a, b) => a.d - b.d)[0];
    nearest?.c.unitIds.push(target.id);
    this.lastBribeRound = round;
    this.gameEngine.onStateChange?.('NOMAD_BRIBE', { unit: target.type, gold: cost });
  }

  /**
   * The camp fashions its own unit type — the travelling bazaar — from the
   * treasury, under the plan's say-so plus the build-cadence, in-flight and
   * six-route ceilings.
   */
  private tryBuildCaravan(round: number, plan: NomadPlan): void {
    // Only the investing stances spend here. A HIRED camp still builds —
    // the bazaar is the MERCHANTS' work, not the horde's (the horde just
    // changed employers); a settled or wiped camp has no base to build at.
    if (!plan.buildBazaar) return;
    if (this.settled || !this.campAlive()) return;
    const base = this.firstCamp;
    if (!base) return;
    if (round - this.lastCaravanBuildRound < NOMAD_CARAVAN_BUILD_ROUNDS) return;
    if (this.caravans.length >= NOMAD_CARAVAN_MAX_IN_FLIGHT) return;
    if (this.routes.length + this.caravans.length >= NOMAD_TRADE_ROUTE_LIMIT) return;
    const target = this.pickRouteTarget(base);
    if (!target) return; // every eligible city already deals with them
    const cost = UNIT_PROPS[UNIT_TYPES.NOMAD_CARAVAN]?.cost ?? 30;
    if (this.treasury < cost) return;

    const unit = this.gameEngine.createUnit(
      NOMAD_CIV_ID,
      UNIT_TYPES.NOMAD_CARAVAN,
      base.col,
      base.row,
    );
    if (!unit) return;
    this.treasury -= cost;
    this.lastCaravanBuildRound = round;
    this.caravans.push({ unitId: unit.id, targetCityId: target.id, blockedRounds: 0, ageRounds: 0 });
  }

  /** The nearest city they do not already deal with, on THIS camp's shore. */
  private pickRouteTarget(from: NomadCamp): City | null {
    const taken = new Set(this.routes.map((r) => r.partnerCityId));
    for (const c of this.caravans) taken.add(c.targetCityId);
    const landmass = this.gameEngine.getLandmassId?.(from.col, from.row) ?? -1;
    const candidates = (this.gameEngine.cities ?? []).filter((c) => {
      if (c.civilizationId === NOMAD_CIV_ID) return false; // not their own city
      if (taken.has(c.id)) return false;                   // one route per city
      if (landmass >= 0 && (this.gameEngine.getLandmassId?.(c.col, c.row) ?? -1) !== landmass) {
        return false;
      }
      return true;
    });
    const ranked = candidates
      .map((c) => ({
        c,
        d: Math.max(Math.abs(c.col - from.col), Math.abs(c.row - from.row)),
      }))
      .sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
    // A BAZAAR MUST RIDE: the nearest city is often the one beside the
    // camp — born next door it would deliver in the same round and never
    // be seen crossing the map. Take a target that is a real journey when
    // there is one; only on a small island do they take the short road.
    const journey = ranked.filter((r) => r.d >= NOMAD_CARAVAN_MIN_JOURNEY);
    return (journey[0] ?? ranked[0])?.c ?? null;
  }

  /** Walk every caravan its full movement toward the partner; deliver (and spend it) on arrival. */
  private moveCaravans(): void {
    for (let i = this.caravans.length - 1; i >= 0; i--) {
      const caravan = this.caravans[i];
      const unit = this.unitById(caravan.unitId);
      if (!unit) {
        this.caravans.splice(i, 1); // killed on the road — no route
        continue;
      }
      const city = (this.gameEngine.cities ?? []).find((c) => c.id === caravan.targetCityId);
      if (!city) {
        this.caravans.splice(i, 1); // the partner city is gone
        continue;
      }

      // The nomads have no seat in the turn order: refill the caravan's
      // moves by hand, exactly like the raid march does for the horde, then
      // take as many steps as the unit's movement buys (moveUnit charges
      // the move cost itself, rivers included).
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
      const maxSteps = Math.max(1, unit.maxMoves ?? 1);
      let moved = false;
      for (let stepNo = 0; stepNo < maxSteps; stepNo++) {
        const d = Math.max(Math.abs(unit.col - city.col), Math.abs(unit.row - city.row));
        if (d <= 1 || (unit.movesRemaining ?? 0) <= 0) break;
        const next = this.nextStepToward(unit, city);
        if (!next) break;
        if (!this.gameEngine.moveUnit(unit.id, next.col, next.row).success) break;
        moved = true;
      }

      const arrived = Math.max(Math.abs(unit.col - city.col), Math.abs(unit.row - city.row)) <= 1;
      if (arrived) {
        this.deliverRoute(i, unit.id, city);
        continue;
      }

      caravan.ageRounds += 1;
      if (moved) {
        caravan.blockedRounds = 0;
      } else {
        caravan.blockedRounds += 1;
      }
      // A caravan that cannot take a step for too long (a wide river, a
      // wall of units) or that has been on the road beyond all reckoning
      // is simply lost — no route, no refund.
      if (
        caravan.blockedRounds >= NOMAD_CARAVAN_BLOCKED_ROUNDS
        || caravan.ageRounds >= NOMAD_CARAVAN_MAX_AGE_ROUNDS
      ) {
        this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => u.id !== unit.id);
        this.caravans.splice(i, 1);
      }
    }
  }

  /**
   * The next tile toward ANY target — a partner city, the player's court,
   * the camp's own tents — via a real A* PATH around everybody's parked
   * units (a greedy walk gets lost around a bay or a garrison), falling
   * back to the nearest step if the grid has no pathfinder. The TARGET's
   * own tile is never an obstacle: a garrison (or your own tents) must not
   * look like an island — callers only ever need to ARRIVE (steps stop at
   * distance 1 before this is asked), never to enter.
   */
  private nextStepToward(
    unit: Unit,
    target: { col: number; row: number },
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const usable = (n: { col: number; row: number }) =>
      !this.gameEngine.getUnitAt?.(n.col, n.row)
      // NEVER storm a city: every caller here is a VISITOR (the envoy, the
      // commute, a bazaar) that only ever needs to ARRIVE adjacent — a
      // step onto a city tile would trigger moveUnit's assault and conquer
      // it in the walkers' name.
      && !this.gameEngine.getCityAt?.(n.col, n.row)
      && (this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false);

    if (grid?.findPath) {
      const obstacles = new Set<string>();
      for (const other of this.gameEngine.units ?? []) {
        if (other.isDefeated) continue;
        if (other.col === target.col && other.row === target.row) continue;
        obstacles.add(`${other.col},${other.row}`);
      }
      const path = grid.findPath(
        unit.col,
        unit.row,
        target.col,
        target.row,
        obstacles,
        this.gameEngine.getPassabilityFilter?.(),
      );
      if (path.length > 1) {
        // path[0] is where they stand; the road says step to path[1] — but
        // the movement pipeline has the final word on any single step (a
        // river charge, a quarrel on the road: wait a round instead).
        const next = path[1];
        return usable(next) ? next : null;
      }
      // No path at all: unreachable for now — the caller counts the round
      // (a caravan that cannot advance for long is lost, no route no fee).
      return null;
    }

    // No pathfinder on this grid: the old nearest-step.
    const neighbors = grid?.getNeighbors?.(unit.col, unit.row) ?? [];
    const step = neighbors
      .filter(usable)
      .map((n) => ({ n, d: Math.max(Math.abs(n.col - target.col), Math.abs(n.row - target.row)) }))
      .sort((a, b) => a.d - b.d || a.n.col - b.n.col || a.n.row - b.n.row)[0];
    return step?.n ?? null;
  }

  /** Arrival: the caravan is spent (Civ1 rule) and the route starts paying. */
  private deliverRoute(index: number, unitId: string, city: City): void {
    this.caravans.splice(index, 1);
    this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => u.id !== unitId);
    this.routes.push({ partnerCityId: city.id, partnerCivId: city.civilizationId });
    this.gameEngine.onStateChange?.('NOMAD_ROUTE', {
      city: city.name ?? '',
      routes: this.routes.length,
      limit: NOMAD_TRADE_ROUTE_LIMIT,
    });
  }

  /**
   * The camp gathers its own soldiers — two masters, one purse:
   *
   *  * **Steel doctrine** (v1): under the steel stance the camp musters at
   *    the muster cadence, up to `NOMAD_CAMP_MUSTER_LIMIT` beyond the spawned
   *    horde — the exception, not the norm.
   *  * **Growth** (post-deal): once the parley has been ANSWERED, "later
   *    with more" takes over — the horde no longer stands as a three-spear
   *    curiosity but gathers a rider every `NOMAD_GROWTH_ROUNDS` until the
   *    group reaches `NOMAD_GROUP_SPLIT_SIZE`, at which point it DIVIDES
   *    into two cooperating camps (see splitCamp). Growth is stance-blind:
   *    a living tribe grows, wherever its plan leans.
   *
   * Everything the camp musters is paid for like everything else; recruits
   * join the camp with room, guard it and raid with the horde. WHAT it
   * buys mirrors the players' progress (see musterOffer).
   */

  /**
   * What the chest buys THIS muster: the strongest ground soldier at least
   * one player can build right now — the tribe mirrors the players'
   * progress (as soon as somebody can field riflemen, their camp buys
   * riflemen's equivalents). Alternate musters take the MOUNTED shape when
   * the beast is affordable, so a grown camp carries both kinds. Production
   * points are never consulted: the chest is their only currency.
   */
  private musterOffer(): { type: string; cost: number } | null {
    const base = this.bestMirroredBase();
    const foot = nomadFootType(base);
    const footCost = UNIT_PROPS[foot]?.cost ?? 10;
    if (NOMAD_MOUNTED_UNITS.includes(base) && this.musteredIds.length % 2 === 1) {
      const mounted = nomadMountedType(base);
      const mountedCost = UNIT_PROPS[mounted]?.cost ?? 0;
      if (this.treasury >= mountedCost) return { type: mounted, cost: mountedCost };
    }
    return { type: foot, cost: footCost };
  }

  /**
   * The strongest ground soldier at least one player can build RIGHT NOW —
   * the bar the tribe's own recruitment mirrors. Falls back to the spear
   * (there is always one of those).
   */
  private bestMirroredBase(): string {
    let best = 'warrior';
    let bestScore = -1;
    for (const base of NOMAD_MIRRORED_UNITS) {
      const props = UNIT_PROPS[base];
      if (!props) continue;
      const available = (this.gameEngine.civilizations ?? []).some(
        (c) => c.isAlive !== false && this.canPlayerBuild(c, base),
      );
      if (!available) continue;
      const score = (props.attack ?? 0) + (props.defense ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = base;
      }
    }
    return best;
  }

  /** Can this court field that ground soldier right now? */
  private canPlayerBuild(civ: Civilization, base: string): boolean {
    const req = UNIT_PROPS[base]?.requires ?? null;
    if (!req) return true;
    const techs = civ.technologies as unknown;
    return Array.isArray(techs)
      ? (techs as string[]).includes(req)
      : (techs as Set<string>).has(req);
  }

  /**
   * Buy a unit for the chest: the type carries its own picture, except the
   * mounted equivalents — those wear their faction's BEAST (a Bedouin
   * camel, a Mongol horse, a Sámi reindeer): same stats, different
   * pictures, one tribe's uniform.
   */
  private buyUnit(type: string, col: number, row: number): Unit | null {
    const unit = this.gameEngine.createUnit(NOMAD_CIV_ID, type, col, row);
    if (!unit) return null;
    if (type.startsWith('nomad_camel_') && this.clan) {
      const mount = NOMAD_MOUNT_ICONS[this.clan.id];
      if (mount) unit.icon = mount;
    }
    return unit;
  }

  private tryMuster(round: number, plan: NomadPlan): void {
    // (No `hired` gate: a RETURN visit raises a fresh camp of the tribe's
    // own soldiers — only a settled or wiped camp cannot muster.)
    if (this.settled || !this.campAlive()) return;
    if (this.standing === 'angry') return;   // raiders raise no troops mid-riot
    const steel = plan.muster;
    // Growth is an ANSWERED-parley affair: pre-parley the horde stays the
    // classic three (the hire price the button promised stays honest).
    const answered = this.camps.filter((c) => c.parleyDone);
    if (!steel && answered.length === 0) return;
    const cadence = steel ? NOMAD_CAMP_MUSTER_ROUNDS : NOMAD_GROWTH_ROUNDS;
    if (round - this.lastMusterRound < cadence) return;

    // Two caps, one per era of the visit:
    //   * pre-parley (steel only): the v1 garrison cap beyond the horde;
    //   * post-parley: the group itself is the cap — it gathers riders
    //     until it is big enough to divide, no further splits beyond the
    //     tribe's tents.
    if (steel && answered.length === 0) {
      const alive = this.musteredIds.filter((id) => this.unitById(id) !== undefined).length;
      if (alive >= NOMAD_CAMP_MUSTER_LIMIT) return;
    }
    // Steel musters for ANY camp with room; growth only for a camp that has
    // actually answered an audience (the classic three stay classic until
    // somebody has dealt with them).
    const withRoom = (steel ? this.camps : answered).filter(
      (c) => c.unitIds.filter((id) => this.unitById(id) !== undefined).length
        < NOMAD_GROUP_SPLIT_SIZE,
    );
    if (withRoom.length === 0) return;
    const target = withRoom[0];

    // What the chest buys THIS time: the strongest soldier the players can
    // field right now — a foot copy, or (alternate musters) the same soldier
    // mounted. Production points are not the tribe's currency; gold is.
    const offer = this.musterOffer();
    if (!offer || this.treasury < offer.cost) return;

    const unit = this.buyUnit(offer.type, target.col, target.row);
    if (!unit) return;
    this.treasury -= offer.cost;
    this.lastMusterRound = round;
    this.musteredIds.push(unit.id);
    target.unitIds.push(unit.id); // guards the camp, raids with the horde

    // THE SPLIT: a camp at full strength divides while the tribe has tents
    // to spare — the parent holds the tents, the splinter plants its own.
    // (The tribe is capped at NOMAD_MAX_CAMPS, so the new camp just regrows.)
    if (this.canSplit(target)) this.splitCamp(target);
  }

  /** A split is possible: this camp is full and the tribe has room. */
  private canSplit(camp: NomadCamp): boolean {
    return (
      camp.unitIds.filter((id) => this.unitById(id) !== undefined).length
        >= NOMAD_GROUP_SPLIT_SIZE
      && this.groupsUsed() < NOMAD_MAX_CAMPS
    );
  }

  /** How many tents the tribe currently keeps. */
  private groupsUsed(): number {
    return this.camps.length;
  }

  /**
   * THE SPLIT — a camp halves itself: first half stays at the old tents,
   * the rest walk to a nearby tile and plant the splinter's tents. Both
   * halves belong to the ONE tribe: one standing, one chest, one strategy —
   * and (this is the point of the split) two camps that can stand at two
   * different courts, each free to gather riders and to run its own visit.
   *
   * The child INHERITS the visit: a split happens mid-visit, so both halves
   * are standing at the same gate with the same answer already given.
   */
  private splitCamp(parent: NomadCamp): void {
    if (this.camps.length >= NOMAD_MAX_CAMPS) return;
    const spot = this.findNearbyCampTile({ col: parent.col, row: parent.row }, NOMAD_SPLIT_DISTANCE);
    if (!spot) return; // no road to a second fire — they stay as one group
    const alive = parent.unitIds.filter((id) => this.unitById(id) !== undefined);
    const half = Math.max(1, Math.floor(alive.length / 2));
    const moving = alive.slice(0, half);
    const staying = alive.slice(half);
    for (const id of moving) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.col = spot.col;
      unit.row = spot.row;
      unit.movesRemaining = 0; // however far it was, they walked it tonight
      unit.isFortified = true; // tents ARE the ground: they hold it
    }
    parent.unitIds = staying;
    const child = newCamp(spot.col, spot.row, parent.targetCivId, parent.spawnedRound);
    child.unitIds = moving;
    child.departAt = parent.departAt;
    child.parleyEmitted = parent.parleyEmitted;
    child.parleyDone = parent.parleyDone;
    child.secondEmitted = parent.secondEmitted;
    child.parleyEmittedRound = parent.parleyEmittedRound;
    child.parleyResolvedRound = parent.parleyResolvedRound;
    this.camps.push(child);
    this.pitchTent(child);
    this.gameEngine.onStateChange?.('NOMAD_SPLIT', {
      count: half,
      col: spot.col,
      row: spot.row,
    });
  }

  /**
   * Knowledge brokerage: every NOMAD_KNOWLEDGE_ROUNDS the tribe sells a
   * technology to an AI court — the nomads are the world's traders and
   * knowledge rides with them. (The player buys the same wares at the
   * parley; this is the OTHER counter of their shop.)
   */
  private trySellKnowledge(round: number, plan: NomadPlan): void {
    if (!plan.sellKnowledge) return;
    if (round - this.lastKnowledgeRound < NOMAD_KNOWLEDGE_ROUNDS) return;
    this.lastKnowledgeRound = round;

    const humanId = this.humanCivId();
    const factor = this.clan?.techPriceFactor ?? 1;
    for (const civ of this.gameEngine.civilizations ?? []) {
      if (!civ.isAlive || civ.id === humanId || civ.isHuman === true) continue;
      if ((civ.resources?.gold ?? 0) < NOMAD_KNOWLEDGE_PRICE_MIN) continue;
      const tech = this.gameEngine.pickFreeTech(civ.id);
      if (!tech) continue;
      const raw = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.cost ?? 60;
      const price = Math.max(
        NOMAD_KNOWLEDGE_PRICE_MIN,
        Math.min(
          NOMAD_KNOWLEDGE_PRICE_MAX,
          Math.floor(Math.floor(raw / NOMAD_KNOWLEDGE_PRICE_DIVISOR) * factor),
        ),
      );
      if ((civ.resources.gold ?? 0) < price) continue;

      civ.resources.gold -= price;
      this.treasury += price;
      this.gameEngine.grantTech(civ.id, tech);
      this.gameEngine.onStateChange?.('NOMAD_KNOWLEDGE', {
        techId: tech,
        tech: TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech,
        civId: civ.id,
        civ: civ.name,
        gold: price,
      });
      return;
    }
  }

  /**
   * "Ask for money some time": broke and peaceful, the tribe swallows its
   * pride and tables a plea — your gold for their chest and their
   * friendship. A refusal counts as a refusal: push them past their clan's
   * tolerance and the plea turns into a grudge.
   */
  private tryAskForMoney(humanId: number, round: number, plan: NomadPlan): void {
    if (this.liveParley === 'request') {
      if (this.treasury >= NOMAD_MONEY_REQUEST_BELOW || !this.campAlive()) {
        // No longer broke — or the camp that asked is gone: free the slot.
        this.liveParley = null;
        this.pending = null;
      } else if (
        round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
        && this.playerNearCamp(null, humanId)
      ) {
        this.emitMoneyRequest(round); // same plea, re-tabled
      }
      return;
    }

    if (!plan.askForMoney || !this.campAlive()) return;
    if (this.liveParley !== null) return;  // another audience owns the screen
    if (this.standing === 'angry') return; // enemies beg from nobody
    if (!this.isParleyDone) return;
    if (round - this.lastMoneyRequestRound < NOMAD_MONEY_REQUEST_COOLDOWN_ROUNDS) return;
    this.emitMoneyRequest(round);
  }

  private emitMoneyRequest(round: number): void {
    const clan = this.clan;
    if (!clan) return;
    const amount = NOMAD_MONEY_REQUEST_AMOUNT;
    this.lastEmitRound = round;
    this.lastMoneyRequestRound = round;
    this.liveParley = 'request';
    const choices: AudienceChoice[] = [
      {
        id: 'give_gold',
        labelKey: 'nomad.choice.giveGold',
        labelParams: { gold: amount },
        variant: 'accept',
      },
      { id: 'refuse_gold', labelKey: 'nomad.choice.refuseGold', variant: 'pass' },
    ];
    this.liveChoices = choices;
    this.gameEngine.onStateChange?.('NOMAD_MONEY_REQUEST', {
      // Where they stand: the camera takes the viewer to the plea.
      ...(this.campTile ?? {}),
      speaker: {
        id: clan.id,
        nameKey: clan.nameKey,
        subKey: clan.epithetKey,
        icon: clan.icon,
        image: clan.image,
      },
      leadKey: 'nomad.moneyRequest.lead',
      eyebrowKey: 'nomad.moneyRequest.eyebrow',
      choices,
      goldAmount: amount,
    });
  }

  // ── Settled camps — the nomads living beside a city ───────────────────

  /**
   * The round of the settlements: camps that put down stakes beside a city.
   * The two-way deal keeps running after the horde is gone:
   *
   *  * the CITY pays — the settlement tile drains
   *    `NOMAD_SETTLEMENT_FOOD_COST` of food per turn (read straight from
   *    the map by `EconomicManager`, the same rule every projection uses),
   *  * the CAMP pays back — its day market trades `NOMAD_SETTLEMENT_TRADE_GOLD`
   *    per turn into the host city's owner, it musters its OWN soldiers
   *    (up to `NOMAD_SETTLEMENT_MUSTER_LIMIT`, the chest pays as always)
   *    around the stakes. Settled riders patrol the city's perimeter so
   *    they can answer an assault without entering the city.
   */
  private settlementPhase(round: number): void {
    for (const spot of this.settlementSpots) {
      // The day market: gold into the hand of whoever hosts the camp —
      // buy the peace with produce, the settlement is worth its beans.
      const city = (this.gameEngine.cities ?? []).find((c) => c.id === spot.cityId);
      if (city) {
        const host = this.gameEngine.civilizations?.[city.civilizationId];
        if (host?.resources) host.resources.gold = (host.resources.gold ?? 0) + NOMAD_SETTLEMENT_TRADE_GOLD;
      }

      // The camp keeps producing: one of the tribe's own every cadence,
      // while chest and headcount allow.
      const alive = spot.unitIds.filter((id) => this.unitById(id) !== undefined).length;
      if (alive >= NOMAD_SETTLEMENT_MUSTER_LIMIT) continue;
      if (round - spot.lastMusterRound < NOMAD_SETTLEMENT_MUSTER_ROUNDS) continue;
      const offer = this.musterOffer();
      if (!offer || this.treasury < offer.cost) continue;
      const unit = this.buyUnit(offer.type, spot.col, spot.row);
      if (!unit) continue; // the stakes are busy this round
      this.treasury -= offer.cost;
      spot.lastMusterRound = round;
      spot.unitIds.push(unit.id);
    }
    this.roamSettlementWanderers();
  }

  /**
   * The settlement-produced guards patrol open tiles around their host city
   * — never entering it or wandering away from its perimeter. If the city
   * is gone, they fall back to the leash (`NOMAD_ROAM_LEASH`) of their home
   * camp. They remain sightable, raidable, friendly to the barbarians, and
   * NEVER part of the camp machinery (no parley, no anger, no departing).
   */
  private roamSettlementWanderers(): void {
    const grid = this.gameEngine.squareGrid;
    for (const spot of this.settlementSpots) {
      const city = (this.gameEngine.cities ?? []).find((candidate) => candidate.id === spot.cityId);
      for (const id of spot.unitIds) {
        const unit = this.unitById(id);
        if (!unit) continue;
        unit.isFortified = false;
        unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
        const maxSteps = Math.max(1, unit.maxMoves ?? 1);
        for (let stepNo = 0; stepNo < maxSteps; stepNo++) {
          if ((unit.movesRemaining ?? 0) <= 0) break;
          const neighbors = (grid?.getNeighbors?.(unit.col, unit.row) ?? []).filter(
            (n) =>
              // Settled riders keep to the city perimeter, where they can
              // actually answer an assault. If the city no longer exists,
              // fall back to the camp leash so the units are not stranded.
              (city
                ? Math.max(Math.abs(n.col - city.col), Math.abs(n.row - city.row)) <= 1
                : Math.max(Math.abs(n.col - spot.col), Math.abs(n.row - spot.row)) <= NOMAD_ROAM_LEASH)
              && !this.gameEngine.getUnitAt?.(n.col, n.row)
              && !this.gameEngine.getCityAt?.(n.col, n.row)
              && (this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false),
          );
          const step = neighbors[Math.floor(Math.random() * neighbors.length)];
          if (!step) break;
          if (!this.gameEngine.moveUnit(unit.id, step.col, step.row).success) break;
        }
      }
    }
  }

  /**
   * A settled camp can intercept an assault on the city it joined. Only a
   * guard standing beside both the city and the attacker can engage, and it
   * does so only when the shared combat-odds calculation approves the fight.
   */
  defendCityAgainst(city: City, attacker: Unit): boolean {
    if (attacker.isDefeated === true || attacker.civilizationId === NOMAD_CIV_ID) return false;

    const guardCandidates = this.settlementSpots
      .filter((spot) => spot.cityId === city.id)
      .flatMap((spot) => [...spot.unitIds, ...spot.guardUnitIds])
      .map((id) => this.unitById(id))
      .filter((guard): guard is Unit => {
        if (!guard || guard.isDefeated === true) return false;
        // The tribe's own mustered riders and the city's gifted settlement
        // guards can both intercept while they still stand at the perimeter.
        if (guard.civilizationId !== NOMAD_CIV_ID && guard.civilizationId !== city.civilizationId) return false;
        const cityDistance = Math.max(Math.abs(guard.col - city.col), Math.abs(guard.row - city.row));
        const attackerDistance = Math.max(Math.abs(guard.col - attacker.col), Math.abs(guard.row - attacker.row));
        return cityDistance <= 1 && attackerDistance <= 1;
      });

    let best: { guard: Unit; chance: number } | null = null;
    for (const guard of guardCandidates) {
      const attackerTile = this.gameEngine.getTileAt?.(attacker.col, attacker.row);
      const decision = decideAiAttack(guard, attacker, {
        defenderTile: attackerTile ?? undefined,
        defenderTerrainKey: attackerTile
          ? String(attackerTile.type ?? attackerTile.terrain ?? '').trim().toLowerCase()
          : undefined,
        defenderInCity:
          Boolean(this.gameEngine.getCityAt?.(attacker.col, attacker.row))
          || attackerTile?.nomadTent === true
          || attackerTile?.nomadSettlement === true,
      });
      if (decision.allow && (!best || decision.chance > best.chance)) {
        best = { guard, chance: decision.chance };
      }
    }

    if (!best) return false;
    this.gameEngine.combatUnit(best.guard, attacker);
    return true;
  }

  /**
   * Barbarian friendship: when the barbarians take a city the tribe strikes
   * camp and moves in beside them, and a trade route opens between the two
   * peoples (it dies with the city, as any route does). An angry tribe keeps
   * its revenge where it is — friends can wait.
   */
  onBarbariansTookCity(city: City): void {
    // (No `hired` gate: a hired tribe has no camp to move — campUnitIds was
    // retired with the sale — but its friendship route still opens.)
    if (this.visitCount === 0 || this.settled) return;
    if (this.standing === 'angry') return;

    // The friendship route — capacity permitting, once per city.
    const already =
      this.routes.some((r) => r.partnerCityId === city.id)
      || this.caravans.some((c) => c.targetCityId === city.id);
    if (!already && this.routes.length + this.caravans.length < NOMAD_TRADE_ROUTE_LIMIT) {
      this.routes.push({ partnerCityId: city.id, partnerCivId: city.civilizationId });
      this.gameEngine.onStateChange?.('NOMAD_ROUTE', {
        city: city.name ?? '',
        routes: this.routes.length,
        limit: NOMAD_TRADE_ROUTE_LIMIT,
      });
    }

    // The whole tribe strikes tents and moves in beside the conquest — each
    // camp takes its own free spot in the ring (occupied tiles are skipped,
    // so the groups never pile onto one tile).
    let moved = false;
    for (const camp of [...this.camps]) {
      const spot = this.findMigrationSpot(city);
      if (!spot) continue;
      for (const id of camp.unitIds) {
        const unit = this.unitById(id);
        if (!unit) continue;
        unit.col = spot.col;
        unit.row = spot.row;
        unit.movesRemaining = 0; // however far it was, they walked it
      }
      camp.col = spot.col;
      camp.row = spot.row;
      moved = true;
    }
    if (moved) {
      this.gameEngine.onStateChange?.('NOMAD_MIGRATED', { city: city.name ?? '' });
    }
  }

  /** A free tile to move the camp to, within the migration radius of the city. */
  private findMigrationSpot(city: City): { col: number; row: number } | null {
    return this.findNearbyCampTile(city, NOMAD_MIGRATION_MAX_DISTANCE);
  }

  /** A free, land-passable tile near an origin — for tents, migration, splits. */
  private findNearbyCampTile(
    origin: { col: number; row: number },
    maxDistance: number,
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    for (let d = 1; d <= maxDistance; d++) {
      for (let dc = -d; dc <= d; dc++) {
        for (let dr = -d; dr <= d; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
          const col = origin.col + dc;
          const row = origin.row + dr;
          if (grid && !grid.isValidSquare(col, row)) continue;
          if (!this.gameEngine.isTilePassable?.(col, row)) continue;
          if (this.gameEngine.getUnitAt?.(col, row)) continue;
          if (this.gameEngine.getCityAt?.(col, row)) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.village) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.nomadSettlement) continue;
          return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * The city market: a rich, peaceful tribe tables an offer for one of the
   * player's cities. Serialized with the parley machinery
   * (`liveParley = 'city'`), so only ONE audience can ever be open.
   */
  private tryOfferCity(humanId: number, round: number, plan: NomadPlan): void {
    // The market is the ENVOY's voice — it speaks even after the horde
    // left, was hired out or settled (resolveParley allows those doors).

    if (this.liveParley === 'city') {
      if (!this.openCityOffer(humanId) || !this.campAlive()) {
        // The offered city is gone, or the camp that made the offer has
        // left: drop the slot so the market can speak again after its
        // cooldown. (A dismissed offer next to a living camp waits for the
        // player to stand at the camp — the parley's own re-offer rule.)
        this.liveParley = null;
        this.pending = null;
      } else if (
        round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
        && this.playerNearCamp(null, humanId)
      ) {
        this.emitCityOffer(round); // same promised terms, re-tabled
        return;
      } else {
        return; // still open — nothing else may speak
      }
    }

    if (this.liveParley !== null) return;          // another audience owns the screen
    if (this.standing === 'angry') return;         // anger and city-buying are exclusive
    if (!this.isParleyDone) return;                // the first parley is answered first
    if (round - this.lastCityOfferRound < NOMAD_CITY_OFFER_COOLDOWN_ROUNDS) return;
    // Rich enough ALWAYS opens the market; the 'market' stance is the tribe
    // meaning it — it waives the 450 gate (the price gate below still holds).
    if (this.treasury < NOMAD_CITY_OFFER_MIN_GOLD && !plan.offerCities) return;

    const city = this.bestOfferCity(humanId);
    if (!city) return;
    const price = NOMAD_CITY_PRICE_BASE + NOMAD_CITY_PRICE_PER_POP * (city.population ?? 1);
    if (this.treasury < price) return;

    this.pending = { ...(this.pending ?? {}), cityId: city.id, cityPrice: price };
    this.lastCityOfferRound = round;
    this.emitCityOffer(round);
  }

  /**
   * The player's biggest city they have not refused yet — never their LAST
   * one: selling it would end their story (`applyLastCityRule`), and a
   * market that could take your final city would not be a deal, it would
   * be a trap.
   */
  private bestOfferCity(humanId: number): City | null {
    const owned = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    if (owned.length < 2) return null;
    const best = owned
      .filter((c) => !this.refusedCityIds.has(c.id))
      .sort((a, b) => (b.population ?? 1) - (a.population ?? 1) || a.id.localeCompare(b.id))[0];
    return best ?? null;
  }

  /** Is the live offer still for a city the player owns (and may still sell)? */
  private openCityOffer(humanId: number): boolean {
    const cityId = this.pending?.cityId;
    if (!cityId) return false;
    const city = (this.gameEngine.cities ?? []).find((c) => c.id === cityId);
    return city !== undefined
      && city.civilizationId === humanId
      && !this.refusedCityIds.has(cityId);
  }

  /** Table (or re-table) the market's offer — the promised terms never change. */
  private emitCityOffer(round: number): void {
    const clan = this.clan;
    const city = (this.gameEngine.cities ?? []).find((c) => c.id === this.pending?.cityId);
    if (!clan || !city) return;
    const price = this.pending?.cityPrice ?? 0;
    this.lastEmitRound = round;
    this.liveParley = 'city';
    const choices: AudienceChoice[] = [
      {
        id: 'buy_city',
        labelKey: 'nomad.choice.buyCity',
        labelParams: { city: city.name ?? '', gold: price },
        variant: 'accept',
      },
      { id: 'refuse_city', labelKey: 'nomad.choice.refuseCity', variant: 'pass' },
    ];
    this.liveChoices = choices;
    this.gameEngine.onStateChange?.('NOMAD_CITY_OFFER', {
      // The offer is ABOUT a city — take the viewer to what is for sale.
      col: city.col,
      row: city.row,
      speaker: {
        id: clan.id,
        nameKey: clan.nameKey,
        subKey: clan.epithetKey,
        icon: clan.icon,
        image: clan.image,
      },
      leadKey: 'nomad.cityOffer.lead',
      eyebrowKey: 'nomad.cityOffer.eyebrow',
      choices,
      goldAmount: price,
    });
  }

  // ── The parley ─────────────────────────────────────────────────────────

  /**
   * Resolve one of the parley's doors. The terms are whatever the BUTTON
   * promised (`pending`), never re-rolled. A successful choice emits
   * NOMAD_RESOLVED so the store re-syncs (gold, techs, converted units).
   */
  resolveParley(choiceId: string): NomadOutcome {
    // Everything else is filtered by the LIVE-Parley lifecycle itself:
    // camp doors ('first'/'second') can only be live while a camp stands
    // (departure and hire retire `liveParley`), and the tribe's own voice
    // — the market and the plea — is valid in every state the tribe still
    // exists (it stands on the promised terms in `pending`).
    if (this.liveParley === null || this.visitCount === 0) return { ok: false };
    const humanId = this.humanCivId();
    if (humanId === null) return { ok: false };
    const human = this.gameEngine.civilizations?.[humanId];
    if (!human) return { ok: false };
    // THE GATE RULE, checked before anything is spent — and BEFORE the
    // "is this door even on the table" filter below: the hire door is no
    // longer tabled from afar (the audience shows only what can be had
    // from where you stand), so a stale click on it would otherwise fall
    // through to the generic refusal and the player would never be told
    // WHY (`notMeeting` is the documented answer, and the warning toast
    // the UI shows for it). The audience stays open — walking away is not
    // an answer.
    if (choiceId === 'hire' && this.meetingUnitIds(humanId, this.openCamp).length === 0) {
      return { ok: false, result: 'notMeeting' };
    }
    // A settlement can only be built by choosing the explicit offer currently
    // on the table. This also rejects stale or guessed choice ids after an
    // offer has been withdrawn.
    if (!this.liveChoices?.some((choice) => choice.id === choiceId)) return { ok: false };
    const wasParley = this.liveParley === 'first' || this.liveParley === 'second';
    this.liveParley = null;

    const outcome = this.applyChoice(choiceId, humanId, human);
    if (outcome.ok) {
      // A PARLEY was answered: the tribe has dealt with you — a fact no
      // departure can un-make (the market and the plea key off it).
      if (wasParley) this.parleyAnswered = true;
      this.gameEngine.onStateChange?.('NOMAD_RESOLVED', { result: outcome.result });
    }
    return outcome;
  }

  private applyChoice(
    choiceId: string,
    humanId: number,
    human: Civilization,
  ): NomadOutcome {
    // The tents this audience belongs to — the GROUP you are talking to.
    // (The tribe's own voices — the market, the plea — have no camp.)
    const camp = this.openCamp;
    switch (choiceId) {
      case 'tech':
      case 'maps': {
        if (choiceId === 'tech') {
          const tech = this.pending?.tech;
          if (!tech) return { ok: false };
          const price = this.pending?.price ?? 0;
          const gold = human.resources?.gold ?? 0;
          const free = gold < price;
          if (!free) human.resources.gold = gold - price;
          this.gameEngine.grantTech(humanId, tech);
          this.standing = 'friendly';
          if (camp) this.endVisitWithLinger(camp);
          const techName = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech;
          return {
            ok: true,
            result: free ? 'techGift' : 'tech',
            params: { tech: techName, gold: price },
          };
        }
        if (camp) {
          this.gameEngine.revealArea(camp.col, camp.row, NOMAD_MAP_REVEAL_RADIUS, humanId);
        }
        this.standing = 'friendly';
        if (camp) this.endVisitWithLinger(camp);
        return { ok: true, result: 'maps' };
      }

      case 'hire': {
        // Only the riders of THIS GROUP who STAND WITH YOU are for sale —
        // the rest of the tribe keeps its tents, its chest and its
        // neutrality. The payment lands in their chest, and being paid by
        // you makes them well-disposed (a friendly court still earns the
        // envoy's return visit).
        const meeting = this.meetingUnitIds(humanId, camp);
        if (meeting.length === 0) return { ok: false, result: 'notMeeting' };
        const cost = this.hireCost;
        if ((human.resources?.gold ?? 0) < cost) return { ok: false, result: 'noGold' };
        human.resources.gold = (human.resources.gold ?? 0) - cost;
        this.treasury += cost;
        this.playerHired = true;
        this.standing = 'friendly';
        if (camp) {
          camp.parleyDone = true;
          camp.parleyResolvedRound = this.lastRound;
          // The group keeps its tents when riders are left: it lingers (the
          // race, a later meeting) exactly as before a full sale — and if
          // the whole group came to the gate, the camp identity ends with it.
          this.sellCamp(camp, humanId, meeting, cost, false);
          if (this.camps.includes(camp)) this.endVisitWithLinger(camp);
        }
        return { ok: true, result: 'hire', params: { gold: cost, count: meeting.length } };
      }

      case 'settle': {
        const offer = this.pending?.settle;
        if (!offer) return { ok: false };
        const tile = this.gameEngine.getTileAt?.(offer.col, offer.row);
        if (!tile) return { ok: false };
        // The settlement outlives the visit: its effects are read from the
        // map (city food drain, defenders raised here).
        tile.nomadSettlement = true;
        tile.nomadTentClanId = this.clan?.id;
        const guardUnitIds: string[] = [];
        for (let i = 0; i < NOMAD_SETTLEMENT_DEFENDERS; i++) {
          const guard = this.gameEngine.createUnit(humanId, 'warriors', offer.col, offer.row);
          guardUnitIds.push(guard.id);
        }
        // The camp puts down stakes and keeps them: from now on it feeds
        // the city its keep (the tile's engine-flagged food drain) and pays
        // the host back in trade, defenders and its own musters (see
        // settlementPhase).
        this.settlementSpots.push({
          col: offer.col,
          row: offer.row,
          cityId: offer.cityId,
          unitIds: [],
          guardUnitIds,
          lastMusterRound: this.lastRound,
        });
        this.settled = true;
        if (camp) {
          camp.parleyDone = true;
          camp.parleyResolvedRound = this.lastRound;
          // The wanderers are home — THESE tents are gone (another group of
          // the tribe, if there is one, is unaffected: it keeps standing).
          this.dropCamp(camp);
        }
        this.departed = true;
        const city = (this.gameEngine.cities ?? []).find((c) => c.id === offer.cityId);
        return { ok: true, result: 'settle', params: { city: city?.name ?? '' } };
      }

      case 'buy_city': {
        const cityId = this.pending?.cityId;
        const price = this.pending?.cityPrice ?? 0;
        const city = (this.gameEngine.cities ?? []).find((c) => c.id === cityId);
        if (!city || city.civilizationId !== humanId) return { ok: false };
        if (this.treasury < price) return { ok: false, result: 'noGold' };

        this.treasury -= price;
        human.resources.gold = (human.resources.gold ?? 0) + price;
        this.transferCityToNomads(city, humanId);
        this.ownedCityIds.push(city.id);
        return {
          ok: true,
          result: 'cityBought',
          params: { city: city.name ?? '', gold: price },
        };
      }

      case 'refuse_city': {
        const cityId = this.pending?.cityId;
        if (cityId) this.refusedCityIds.add(cityId);
        const city = (this.gameEngine.cities ?? []).find((c) => c.id === cityId);
        return {
          ok: true,
          result: 'cityRefused',
          params: { city: city?.name ?? '' },
        };
      }

      case 'give_gold': {
        const amount = NOMAD_MONEY_REQUEST_AMOUNT;
        if ((human.resources?.gold ?? 0) < amount) return { ok: false, result: 'noGold' };
        human.resources.gold = (human.resources.gold ?? 0) - amount;
        this.treasury += amount;
        // They remember who filled their chest: a friendly court earns the
        // return visit (and the gift that comes with it).
        this.standing = 'friendly';
        return { ok: true, result: 'goldGiven', params: { gold: amount } };
      }

      case 'refuse_gold': {
        this.refusals += 1;
        const tolerance = this.clan?.angerTolerance ?? 2;
        if (this.refusals > tolerance) this.goAngry();
        return { ok: true, result: 'goldRefused' };
      }

      // Refusing them your fields (or walking away) is a closed hand like
      // any other — the tribe counts it, and their prices rise with it.
      case 'pass':
      case 'farewell':
      case 'refuse_settle': {
        this.refusals += 1;
        if (camp) {
          camp.parleyDone = true;
          camp.parleyResolvedRound = this.lastRound;
        }
        const tolerance = this.clan?.angerTolerance ?? 2;
        if (this.refusals > tolerance) {
          // Beyond their patience: the camp does not leave — it turns.
          this.goAngry();
          return { ok: true, result: 'pass' };
        }
        if (camp) camp.departAt = this.lastRound + NOMAD_PASS_DEPART_ROUNDS;
        return { ok: true, result: 'pass' };
      }

      default:
        return { ok: false };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * The one human seat, or null — which is every hotseat game (still out in
   * v1) and every all-AI spectator game (which runs fine: the tribe travels
   * between AI courts with no audience to open).
   */
  private humanCivId(): number | null {
    const seats = this.gameEngine.gameSettings?.humanPlayerIds ?? [0];
    if (seats.length !== 1) return null;
    const id = seats[0];
    return this.gameEngine.civilizations?.[id]?.isHuman === true ? id : null;
  }

  /** First alive AI civilization with a city — used as a starting court in all-AI games. */
  private firstAiCourtId(): number | null {
    const civs = this.gameEngine.civilizations ?? [];
    const cities = this.gameEngine.cities ?? [];
    for (const civ of civs) {
      if (!civ || civ.id < 0 || civ.isHuman === true || civ.isAlive === false) continue;
      if (cities.some((c) => c.civilizationId === civ.id)) return civ.id;
    }
    return null;
  }

  private unitById(id: string) {
    return (this.gameEngine.units ?? []).find((u) => u.id === id && !u.isDefeated);
  }

  /** Every wanderer in play, across both tents — parent camp and splinter. */
  /** Every rider in play, across all the tribe's camps. */
  private allCampUnitIds(): string[] {
    return this.camps.flatMap((c) => c.unitIds);
  }

  private campAlive(): boolean {
    return this.allCampUnitIds().some((id) => this.unitById(id) !== undefined);
  }

  /** Dealt-with visit: THESE tents linger for the race, then walk away. */
  private endVisitWithLinger(camp: NomadCamp): void {
    camp.parleyDone = true;
    camp.parleyResolvedRound = this.lastRound;
    camp.departAt = this.lastRound + NOMAD_CAMP_LINGER_ROUNDS;
  }

  /** Any camp unit hurt or missing = somebody drew first blood. */
  private wasAttacked(): boolean {
    for (const id of this.allCampUnitIds()) {
      const unit = this.unitById(id);
      if (!unit) return true;
      if (unit.health < 100) return true;
    }
    return false;
  }

  private goAngry(): void {
    if (this.standing === 'angry') return;
    this.standing = 'angry';
    this.angrySince = this.lastRound;
    // Anger tears up any open audience (and, at the next departure, the
    // promised return: a hostile tribe is friendly to nobody).
    this.liveParley = null;
    this.openCamp = null;
    // The camp wakes: no more holding position.
    for (const id of this.allCampUnitIds()) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.isFortified = false;
      unit.orders = null;
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
    }
    this.gameEngine.onStateChange?.('NOMAD_ANGRY', {});
  }

  /**
   * One round of trouble: attack anything standing next to the horde,
   * otherwise march on the nearest city — and once at the gates, raid the
   * stores (with a cooldown, so an untouched camp drains slowly).
   */
  private raidRound(humanId: number, round: number): void {
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    for (const id of this.allCampUnitIds()) {
      const unit = this.unitById(id);
      if (!unit) continue;
      if ((unit.movesRemaining ?? 0) <= 0) {
        unit.movesRemaining = unit.maxMoves ?? 1; // a raider fights every round
      }

      const grid = this.gameEngine.squareGrid;
      const neighbors = grid?.getNeighbors?.(unit.col, unit.row) ?? [];

      // Next to an enemy AND able to reach it? Fight it. `canUnitMoveTo` is
      // the authority (rivers, water, range) — a passable-looking tile can
      // still be uncrossable, and a blocked attack must not stall the raid.
      const attackTarget = neighbors.find((n) => {
        const target = this.gameEngine.getUnitAt?.(n.col, n.row);
        if (!target || target.civilizationId !== humanId || target.isDefeated) return false;
        return this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false;
      });
      if (attackTarget) {
        this.gameEngine.moveUnit(unit.id, attackTarget.col, attackTarget.row);
        continue;
      }

      // Otherwise march on the nearest city and raid what it stores.
      const city = cities
        .map((c) => ({ c, d: Math.max(Math.abs(c.col - unit.col), Math.abs(c.row - unit.row)) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!city) continue;
      if (city.d <= 1) {
        this.raidCity(city.c, humanId, round);
        continue;
      }
      // The greedy step asks the SAME gate the movement pipeline uses: a
      // tile that is passable but not enterable (a wide river the unit
      // cannot ford) would otherwise be picked every round and the horde
      // would mill against it forever.
      const step = neighbors
        .filter((n) => !this.gameEngine.getUnitAt?.(n.col, n.row))
        .filter((n) => this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false)
        .map((n) => ({ n, d: Math.max(Math.abs(n.col - city.c.col), Math.abs(n.row - city.c.row)) }))
        .sort((a, b) => a.d - b.d || a.n.col - b.n.col || a.n.row - b.n.row)[0];
      if (step) this.gameEngine.moveUnit(unit.id, step.n.col, step.n.row);
    }
  }

  private raidCity(city: { id: string; name?: string; population?: number }, humanId: number, round: number): void {
    const last = this.raidCooldowns.get(city.id) ?? -Infinity;
    if (round - last < NOMAD_RAID_COOLDOWN_ROUNDS) return;
    this.raidCooldowns.set(city.id, round);
    const human = this.gameEngine.civilizations?.[humanId];
    const treasury = human?.resources?.gold ?? 0;
    const stolen = Math.max(
      NOMAD_RAID_GOLD_MIN,
      Math.min(NOMAD_RAID_GOLD_MAX, Math.floor(treasury * NOMAD_RAID_GOLD_SHARE)),
    );
    if (human) human.resources.gold = Math.max(0, treasury - stolen);
    this.gameEngine.onStateChange?.('NOMAD_RAID', {
      city: city.name ?? '', gold: Math.min(stolen, treasury),
    });
  }

  /** Where they visit from: the human's first city, else their first unit. */
  private anchorFor(humanId: number): { col: number; row: number } | null {
    const city = (this.gameEngine.cities ?? []).find((c) => c.civilizationId === humanId);
    if (city) return city;
    const unit = (this.gameEngine.units ?? []).find(
      (u) => u.civilizationId === humanId && !u.isDefeated,
    );
    return unit ?? null;
  }

  private findCampTile(anchor: { col: number; row: number }): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const anchorLandmass = this.gameEngine.getLandmassId?.(anchor.col, anchor.row) ?? -1;
    for (let r = NOMAD_SPAWN_MIN_DISTANCE; r <= NOMAD_SPAWN_MAX_DISTANCE; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
          const col = anchor.col + dc;
          const row = anchor.row + dr;
          if (grid && !grid.isValidSquare(col, row)) continue;
          if (!this.gameEngine.isTilePassable?.(col, row)) continue;
          if (this.gameEngine.getUnitAt?.(col, row)) continue;
          if (this.gameEngine.getCityAt?.(col, row)) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.village) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.nomadSettlement) continue;
          if (
            anchorLandmass >= 0
            && typeof this.gameEngine.getLandmassId === 'function'
            && this.gameEngine.getLandmassId(col, row) !== anchorLandmass
          ) continue;
          return { col, row };
        }
      }
    }
    return null;
  }

  /** A tile beside the player's city the wanderers may plant stakes on. */
  private findSettlementTile(humanId: number): { col: number; row: number; cityId: string } | null {
    const grid = this.gameEngine.squareGrid;
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    for (const city of cities) {
      for (let dc = -NOMAD_SETTLEMENT_MAX_DISTANCE; dc <= NOMAD_SETTLEMENT_MAX_DISTANCE; dc++) {
        for (let dr = -NOMAD_SETTLEMENT_MAX_DISTANCE; dr <= NOMAD_SETTLEMENT_MAX_DISTANCE; dr++) {
          if (dc === 0 && dr === 0) continue;
          if (Math.max(Math.abs(dc), Math.abs(dr)) > NOMAD_SETTLEMENT_MAX_DISTANCE) continue;
          const col = city.col + dc;
          const row = city.row + dr;
          if (grid && !grid.isValidSquare(col, row)) continue;
          if (!this.gameEngine.isTilePassable?.(col, row)) continue;
          if (this.gameEngine.getUnitAt?.(col, row)) continue;
          if (this.gameEngine.getCityAt?.(col, row)) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.village) continue;
          if (this.gameEngine.getTileAt?.(col, row)?.nomadSettlement) continue;
          return { col, row, cityId: city.id };
        }
      }
    }
    return null;
  }

  /**
   * Raise a camp at a court: room near the anchor, tents up, riders
   * mustered. Returns false when there is no room near the court — the
   * caller retries next round of the travel spell.
   */
  private raiseCampAt(targetCivId: number, round: number): boolean {
    const anchor = this.anchorFor(targetCivId);
    if (!anchor) return false;
    const tile = this.findCampTile(anchor);
    if (!tile) return false;

    const camp = newCamp(tile.col, tile.row, targetCivId, round);
    for (const type of NOMAD_SPAWN_UNITS) {
      const unit = this.buyUnit(type, tile.col, tile.row);
      if (unit) {
        // A camp holds its ground: the horde waits for your answer — and a
        // fortified unit sits OUT its turn (moves spent), as the engine's
        // unit-state law requires.
        unit.isFortified = true;
        unit.movesRemaining = 0;
        camp.unitIds.push(unit.id);
      }
    }
    if (camp.unitIds.length === 0) return false;
    return this.openCampRecord(camp, round);
  }

  /**
   * RAISING TENTS AT A COURT — the bookkeeping every arrival shares: the
   * contact window, the pitch beside the tents, the knowledge clock, the
   * provisional hire price, and (for YOUR court) the visit itself with
   * its sighting. The spawn buys its riders first; a group that RODE in
   * brings its own — both land here.
   */
  private openCampRecord(camp: NomadCamp, round: number): boolean {
    // The CONTACT WINDOW: a court that never opens its door (an
    // unreachable island, a city with no room) must not stall this camp
    // forever — and pinning `departAt` to null holds it indefinitely.
    camp.departAt = round + NOMAD_CONTACT_TIMEOUT_ROUNDS;

    this.camps.push(camp);
    // THEY PITCH A TENT: a standing camp leaves a tent on the first free
    // tile beside its own — the visible "somebody lives here" that says why
    // the riders stand still (and, at your gate, sits beside your city).
    this.pitchTent(camp);
    this.lastTargetCivId = camp.targetCivId;
    // The knowledge counter runs from the visit: their first brokered sale
    // lands NOMAD_KNOWLEDGE_ROUNDS later, not mid-parley.
    this.lastKnowledgeRound = round;
    // Provisional: nobody has met them yet, so there is nothing to sell —
    // emitParley replaces this with the price of the riders you actually
    // meet at the gate (see meetingUnitIds).
    this.hireCost = this.hirePriceFor(camp.unitIds);

    // Only a visit to YOUR court counts as a visit with you — the tribe
    // camps at the rivals too, and their meetings are their own business.
    // In all-AI spectator games there is no "your court", but the tribe is
    // still spawned and must not re-spawn every round.
    const humanId = this.humanCivId();
    const allAi = humanId === null
      && Array.isArray(this.gameEngine.gameSettings?.humanPlayerIds)
      && this.gameEngine.gameSettings!.humanPlayerIds!.length === 0;
    if (camp.targetCivId === humanId || (allAi && this.visitCount === 0)) {
      this.visitCount += 1;
      this.departed = false;
      if (camp.targetCivId === humanId) {
        // NO FOG REVEAL — and that is the fix. The camp stands 9–13 tiles
        // out, far beyond your sight, so lighting it up marked ~50 tiles you
        // had never walked as EXPLORED the moment the wagons appeared: gray
        // fog on ground nobody had visited. Fog is earned by walking it —
        // the maps door and the hall's "find" are the deliberate, announced
        // exceptions — and you meet this horde the honest way: their riders
        // reach your city, inside your vision, and only then does the
        // envoy speak. The story still says so.
        this.gameEngine.onStateChange?.('NOMAD_SIGHTED', {
          col: camp.col,
          row: camp.row,
          clan: this.clan?.id,
          visit: this.visitCount,
        });
      }
    }
    return true;
  }

  /**
   * The game's FIRST camp — the story opens at your gate. The faction is
   * rolled here: the same people come back on every later visit.
   */
  private spawnVisit(round: number, targetCivId: number): boolean {
    if (!this.clan) {
      this.clan = NOMAD_CLANS[Math.floor(Math.random() * NOMAD_CLANS.length)];
    }
    return this.raiseCampAt(targetCivId, round);
  }

  /**
   * THE ROAD, SPELL HALF — a leg with NO riders left (the tribe was sold
   * out and re-forms) raises fresh tents at its court when its time comes.
   * A leg that is actually RIDING never comes through here: `marchRoad`
   * brings those in on their own legs, which is how one group arriving
   * never waits for another while the other is still on the way.
   */
  private raiseArrivedCamps(round: number): void {
    if (this.settled) return; // they put down stakes: the story moved on
    for (let i = this.road.length - 1; i >= 0; i--) {
      const leg = this.road[i];
      if (leg.unitIds.length > 0) continue; // riding in — see marchRoad
      if (round < leg.arriveAt) continue;
      // The tribe's own ceiling: a third camp may not appear, so the riders
      // wait on the road until one of the two strikes tents.
      if (this.camps.length >= NOMAD_MAX_CAMPS) continue;
      if (this.raiseCampAt(leg.targetCivId, round)) {
        this.road.splice(i, 1);
      } else {
        // Nothing to visit there right now (no city, no room): ride on —
        // but not through the same court every round.
        this.road[i] = { ...leg, arriveAt: round + NOMAD_TRAVEL_ROUNDS };
      }
    }
  }

  /**
   * THE REAL RIDE: a group that struck tents RIDES to its next court —
   * step by step, across the map, in the open (the nomads are drawn
   * through the fog, so you watch them come and go). Arrival is PHYSICAL:
   * somebody stands beside the host's city — the same contact rule the first
   * visit plays by — and the tents go up around the riders who actually
   * walked in. Never a timer, never a spell.
   */
  private marchRoad(round: number): void {
    for (let i = this.road.length - 1; i >= 0; i--) {
      const leg = this.road[i];
      const riders = leg.unitIds
        .map((id) => this.unitById(id))
        .filter((u): u is Unit => u !== undefined && !u.isDefeated);
      if (leg.unitIds.length > 0 && riders.length === 0) {
        // The whole group was wiped on the road: the tribe re-forms at the
        // destination instead (`raiseArrivedCamps`), so a riding group can
        // never simply vanish from the world.
        leg.unitIds = [];
        continue;
      }
      if (riders.length === 0) continue; // no riders yet: the spell raises them
      // The tribe's own ceiling: a third camp may not appear, so a group
      // that would overshoot into an occupied court waits out here. It
      // never stands ON a court with no tents — that would be a stay
      // without a dialog.
      if (this.camps.length >= NOMAD_MAX_CAMPS) continue;

      const target = this.nearestPlayerTarget(
        { col: riders[0].col, row: riders[0].row },
        leg.targetCivId,
      );
      if (!target) {
        this.reroute(leg); // that court has nobody left to visit
        continue;
      }

      // THEIR HOUR: a leg may not raise tents at a court before its
      // appointed round — the old spell's pacing, kept, but walked instead
      // of teleported. Until then they ride up to the gate and mill there.
      const waiting = round < leg.arriveAt;
      const hold = waiting ? NOMAD_RIDE_HOLD_DISTANCE : 0;
      // The leg rides as ONE pack: the rider nearest the court leads and the
      // rest hold `NOMAD_GROUP_RADIUS` around it, so the group arrives
      // together instead of strung out along the road (the scout's extra
      // move used to leave the spears behind).
      this.rideAsGroup(leg.unitIds, target, hold);

      // ARRIVAL: somebody stands beside the host's city (or beside one of
      // its units) — contact, exactly as on the first visit.
      if (!waiting && riders.some((u) => this.standsAtCourt(u, leg.targetCivId))) {
        this.raiseMarchedCamp(leg, riders, round);
        this.road.splice(i, 1);
        continue;
      }
      if (waiting) {
        // Exactly where they should be: nothing to book, nowhere to go.
        leg.sinceProgress = 0;
        continue;
      }

      // No progress for too long (a bay, a wall, an island): take another
      // court rather than milling here forever. A PROMISED return never
      // re-routes away — the promise is the whole point of it.
      const dist = Math.max(
        Math.abs(riders[0].col - target.col),
        Math.abs(riders[0].row - target.row),
      );
      if (dist < leg.bestDist) {
        leg.bestDist = dist;
        leg.sinceProgress = 0;
      } else {
        leg.sinceProgress += 1;
        if (leg.sinceProgress >= NOMAD_TRAVEL_ROUNDS && !leg.promised) {
          this.reroute(leg);
        }
      }
    }
  }

  /** That court is unreachable: take another (nowhere else? keep riding). */
  private reroute(leg: { targetCivId: number; bestDist: number; sinceProgress: number }): void {
    const next = this.pickNextCourt(leg.targetCivId, false);
    if (next === null || next === leg.targetCivId) {
      leg.sinceProgress = 0; // nowhere else to go — keep trying this one
      return;
    }
    leg.targetCivId = next;
    leg.bestDist = Number.POSITIVE_INFINITY;
    leg.sinceProgress = 0;
  }

  /** A rider standing beside that court's city, or within one tile of its units. */
  private standsAtCourt(unit: Unit, courtId: number): boolean {
    const besideCity = (this.gameEngine.cities ?? []).some(
      (c) => c.civilizationId === courtId
        && Math.max(Math.abs(c.col - unit.col), Math.abs(c.row - unit.row)) <= 1,
    );
    if (besideCity) return true;
    return (this.gameEngine.units ?? []).some(
      (u) =>
        u.id !== unit.id &&
        u.civilizationId === courtId &&
        !u.isDefeated &&
        Math.max(Math.abs(u.col - unit.col), Math.abs(u.row - unit.row)) <= 1,
    );
  }

  /**
   * THE TENTS GO UP WHERE THE RIDERS STAND: the camp is raised around the
   * group that actually rode in — no bought spares, no spell, and (at your
   * gate) the pitch lands beside your city because the tents do.
   */
  private raiseMarchedCamp(
    leg: { targetCivId: number },
    riders: Unit[],
    round: number,
  ): void {
    const arriver = riders.find((u) => this.standsAtCourt(u, leg.targetCivId)) ?? riders[0];
    const camp = newCamp(arriver.col, arriver.row, leg.targetCivId, round);
    camp.unitIds = riders.map((u) => u.id);
    for (const rider of riders) {
      // Holding ground again, exactly as at the spawn.
      rider.isFortified = true;
      rider.movesRemaining = 0;
    }
    this.openCampRecord(camp, round);
  }

  private emitParley(camp: NomadCamp, second: boolean, round: number): void {
    const humanId = this.humanCivId();
    if (humanId === null || !this.clan) return;
    const clan = this.clan;
    const returning = this.visitCount > 1;
    const choices: AudienceChoice[] = [];
    let techOffered: string | undefined;
    let goldAmount: number | undefined;
    this.pending = null;
    this.settleRolled = false;
    // THE HIRE DOOR is priced at the riders of THIS camp who STAND WITH
    // YOU — the ones this meeting can actually hand over, at five times
    // their build cost (× the clan's factor). Nobody at the gate means
    // nothing for sale: the door is not tabled at all.
    const meeting = this.meetingUnitIds(humanId, camp);
    this.hireCost = this.hirePriceFor(meeting);

    // A returning friendly court's gift: the chart they promised — given
    // the moment they actually stand at your gate (the visit itself), and
    // only once (the first parley of the return, never a re-offer).
    if (!second && returning && this.standing === 'friendly') {
      this.gameEngine.revealArea(camp.col, camp.row, NOMAD_RETURN_MAP_RADIUS, humanId);
      this.gameEngine.onStateChange?.('NOMAD_RETURN_GIFT', {});
    }

    if (!second) {
      // ANGRY TRADERS SELL NOTHING: past their patience the tribe tables
      // no knowledge and no maps — the spears (or the door) are all that
      // is left on the table.
      const trading = this.standing !== 'angry';
      const tech = trading ? this.gameEngine.pickFreeTech(humanId) : null;
      if (tech) {
        const price = this.techPriceFor(tech);
        this.pending = { tech, price };
        const gold = this.gameEngine.civilizations?.[humanId]?.resources?.gold ?? 0;
        choices.push({
          id: 'tech',
          labelKey: gold >= price ? 'nomad.choice.tech' : 'nomad.choice.techGift',
          labelParams: { tech, gold: price },
          variant: 'accept',
        });
        techOffered = tech;
        goldAmount = price;
      }
      // On a return visit the map comes as their GIFT (revealed at spawn),
      // so the paid doors remain and the door itself is gone.
      if (!returning && trading) {
        choices.push({ id: 'maps', labelKey: 'nomad.choice.maps', variant: 'accept' });
      }
      // A clan may propose to settle beside your city (their gamble, their
      // chance) — and the offered tile is remembered for the resolve. They
      // also table the REFUSAL next to it: turning them away from your
      // fields is a closed hand, and the tribe counts those.
      const settleTile = this.findSettlementTile(humanId);
      if (settleTile) {
        this.settleRolled = Math.random() < clan.settleChance;
        if (this.settleRolled) {
          const cityName =
            (this.gameEngine.cities ?? []).find((c) => c.id === settleTile.cityId)?.name ?? '';
          choices.push({
            id: 'settle',
            labelKey: 'nomad.choice.settle',
            labelParams: { city: cityName },
            detailKey: 'nomad.choice.settleTerms',
            detailParams: {
              city: cityName,
              food: NOMAD_SETTLEMENT_FOOD_COST,
              gold: NOMAD_SETTLEMENT_TRADE_GOLD,
              defenders: NOMAD_SETTLEMENT_DEFENDERS,
              routes: NOMAD_TRADE_ROUTE_SLOT_BONUS,
            },
            variant: 'accept',
          });
          choices.push({
            id: 'refuse_settle',
            labelKey: 'nomad.choice.refuseSettle',
            labelParams: { city: cityName },
            detailKey: 'nomad.choice.refuseSettleTerms',
            detailParams: { city: cityName },
            variant: 'pass',
          });
          this.pending = { ...(this.pending ?? {}), settle: settleTile };
        }
      }
      if (meeting.length > 0) {
        // Their prices remember every closed hand: each refusal adds
        // NOMAD_REFUSAL_PRICE_PENALTY to what they ask of you.
        this.hireCost = Math.ceil(this.hirePriceFor(meeting) * this.pricePenalty());
        choices.push({
          id: 'hire',
          labelKey: 'nomad.choice.hire',
          labelParams: { gold: this.hireCost, count: meeting.length },
          variant: 'accept',
        });
      }
      choices.push({ id: 'pass', labelKey: 'nomad.choice.pass', variant: 'pass' });
      // They came with a caravan: the wagon rolls up the moment the envoy
      // first speaks at these tents — never again on a re-offer.
      if (!camp.parleyEmitted) this.escortBazaar(round, camp);
      camp.parleyEmitted = true;
    } else {
      if (meeting.length > 0) {
        choices.push({
          id: 'hire',
          labelKey: 'nomad.choice.hire',
          labelParams: { gold: this.hireCost, count: meeting.length },
          variant: 'accept',
        });
      }
      choices.push({ id: 'farewell', labelKey: 'nomad.choice.farewell', variant: 'pass' });
      camp.secondEmitted = true;
    }

    camp.parleyEmittedRound = round;
    this.openCamp = camp;
    this.liveParley = second ? 'second' : 'first';
    this.liveChoices = choices;
    this.gameEngine.onStateChange?.('NOMAD_PARLEY', {
      // Where they stand — the MEETING spot at the gate: the camera takes
      // the viewer to the place this audience is about.
      ...(this.spotOf(camp) ?? {}),
      speaker: {
        id: clan.id,
        nameKey: clan.nameKey,
        subKey: clan.epithetKey,
        icon: clan.icon,
        image: clan.image,
      },
      leadKey: second ? 'nomad.parley.leadSecond'
        : returning ? clan.returnLeadKey
          : clan.leadKey,
      choices,
      techOffered,
      goldAmount,
    });
  }

  /**
   * The city screen's "speak with them": table an audience for whichever
   * camp is standing with you RIGHT NOW — the same contact rule, the same
   * promised terms (a first parley while none was answered, the farewell
   * after). Returns true when something is on the table (an already-open
   * audience counts: the caller may simply show its doors).
   */
  speakAtGate(): boolean {
    const humanId = this.humanCivId();
    if (humanId === null || this.visitCount === 0) return false;
    if (this.liveParley !== null) return true;
    const camp = this.camps.find(
      (c) => c.targetCivId === humanId && this.hasMetCourt(humanId, c),
    );
    if (!camp) return false;
    this.emitParley(camp, camp.parleyDone, this.lastRound);
    return true;
  }

  /**
   * THEY COME WITH CARAVANS: the moment the envoy stands at a court, one
   * of the tribe's travelling bazaars is with the camp — paid for like
   * everything else (the chest is the tribe's only purse), so a visit that
   * opens no door still leaves a merchant on the road to somebody. Once
   * per visit: a dismissed audience must not roll up a second wagon.
   */
  private escortBazaar(round: number, camp: NomadCamp): void {
    if (this.routes.length + this.caravans.length >= NOMAD_TRADE_ROUTE_LIMIT) return;
    if (this.caravans.length >= NOMAD_CARAVAN_MAX_IN_FLIGHT) return;
    const cost = UNIT_PROPS[UNIT_TYPES.NOMAD_CARAVAN]?.cost ?? 30;
    if (this.treasury < cost) return;
    const target = this.pickRouteTarget(camp);
    if (!target) return;
    const unit = this.gameEngine.createUnit(
      NOMAD_CIV_ID,
      UNIT_TYPES.NOMAD_CARAVAN,
      camp.col,
      camp.row,
    );
    if (!unit) return;
    this.treasury -= cost;
    this.lastCaravanBuildRound = round;
    this.caravans.push({ unitId: unit.id, targetCityId: target.id, blockedRounds: 0, ageRounds: 0 });
  }

  /** Every eligible AI court may bid for the whole camp, cheapest chance first. */
  /**
   * THE RACE — an eligible court may buy ONE GROUP of riders off this camp:
   * never the player's own court, never the tribe's LAST camp (a tribe that
   * loses its last tents is not for sale) — and always loudly, through the
   * audience, because half your problem just changed uniform.
   */
  private tryAiHire(humanId: number, camp: NomadCamp): void {
    if (this.camps.length < 2) return; // never the last group
    const ids = camp.unitIds.filter((id) => this.unitById(id) !== undefined);
    if (ids.length === 0) return;
    const cost = this.hirePriceFor(ids);
    for (const civ of this.gameEngine.civilizations ?? []) {
      if (!civ.isAlive || civ.id === humanId || civ.isHuman === true) continue;
      if ((civ.resources?.gold ?? 0) < cost) continue;
      const diplomacy = civ.personality?.diplomacy ?? 5;
      const chance = Math.min(
        0.5,
        NOMAD_AI_HIRE_BASE_CHANCE + diplomacy * NOMAD_AI_HIRE_DIPLOMACY_BONUS,
      );
      if (Math.random() < chance) {
        civ.resources.gold = (civ.resources.gold ?? 0) - cost;
        // The buyer pays the TRIBE — the chest swells when a group sells.
        this.treasury += cost;
        this.sellCamp(camp, civ.id, ids, cost, true);
        return;
      }
    }
  }

  /** The riders change colors: neutral units become the owner's units. */
  private convertUnits(ownerId: number, ids: readonly string[] = this.allCampUnitIds()): void {
    for (const id of ids) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.civilizationId = ownerId;
      unit.isFortified = false;
      // Usable at once — the hiring court may still be mid-turn (the owner's
      // next turn start would refill moves anyway).
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
      unit.orders = null;
    }
  }

  /**
   * ONE GROUP CHANGES HANDS: these riders become the buyer's, these tents
   * come down — and when the buyer is a RIVAL court the player is told, with
   * an audience (a camp sold at somebody else's gate is still your news:
   * half the problem just changed uniform). The player's own purchase at the
   * gate needs no announcement (`announce` = false): they clicked the button.
   *
   * The tribe itself is never sold here — only the group. If it happens to
   * be the last one (the player's hire can do that), the camp identity
   * retires with it.
   */
  private sellCamp(
    camp: NomadCamp,
    buyerId: number,
    ids: readonly string[],
    cost: number,
    announce: boolean,
  ): void {
    const spot = this.spotOf(camp);
    this.groupSold = true;
    this.convertUnits(buyerId, ids);
    const sold = new Set(ids);
    const left = camp.unitIds.filter((id) => !sold.has(id) && this.unitById(id) !== undefined);
    camp.unitIds = left;
    // Empty tents come down — but the riders do NOT ride off: they are the
    // buyer's units now (that would be dropCamp, which sends them away).
    if (left.length === 0) this.takeTentsDown(camp);

    if (announce) {
      const clan = this.clan;
      this.gameEngine.onStateChange?.('NOMAD_GROUP_HIRED', {
        civId: buyerId,
        count: ids.length,
        gold: cost,
        ...spot,
        speaker: clan
          ? {
            id: clan.id,
            nameKey: clan.nameKey,
            subKey: clan.epithetKey,
            icon: clan.icon,
            image: clan.image,
          }
          : undefined,
        eyebrowKey: 'nomad.groupHired.eyebrow',
        leadKey: 'nomad.groupHired.lead',
      });
    }

    if (this.camps.length === 0) {
      // Nothing left to camp with: the camp identity retires with the sale
      // (nothing may ever raid, anger, depart or migrate these riders) and
      // the tribe rides on from here.
      this.hired = true;
      this.retireCampForHire();
    }
  }

  /** Fold a camp: these riders leave the tribe's books (sold or ridden off). */
  private dropCamp(camp: NomadCamp): void {
    this.removeCampRiders(camp);
    this.takeTentsDown(camp);
  }

  /**
   * Take these tents down WITHOUT touching their riders — the sold camp's
   * riders stay on the map wearing the buyer's colors.
   */
  private takeTentsDown(camp: NomadCamp): void {
    const idx = this.camps.indexOf(camp);
    if (idx >= 0) this.camps.splice(idx, 1);
    this.strikeTent(camp);
    if (this.openCamp === camp) {
      this.openCamp = null;
      this.liveParley = null;
      this.liveChoices = null;
    }
  }

  /**
   * THE PITCH: a tent on the first free tile beside these tents — the
   * visible half of "the caravan has stopped here". It is the answer to
   * the standing still: the riders are IN CAMP, and the tent says so from
   * across the fog. A tent tile also gives city-grade defensive cover to
   * units standing there, and is struck when the camp moves on.
   */
  private pitchTent(camp: NomadCamp): void {
    this.strikeTent(camp);
    const grid = this.gameEngine.squareGrid;
    const neighbors = grid?.getNeighbors?.(camp.col, camp.row) ?? [];
    for (const n of neighbors) {
      if (!this.gameEngine.isTilePassable?.(n.col, n.row)) continue;
      if (this.gameEngine.getUnitAt?.(n.col, n.row)) continue;
      if (this.gameEngine.getCityAt?.(n.col, n.row)) continue;
      const tile = this.gameEngine.getTileAt?.(n.col, n.row);
      if (!tile || tile.nomadTent || tile.nomadSettlement || tile.village) continue;
      tile.nomadTent = true;
      tile.nomadTentClanId = this.clan?.id;
      camp.tent = { col: n.col, row: n.row };
      this.pushTiles();
      return;
    }
  }

  /** Pull the pitch out of the ground — the camp struck its tents. */
  private strikeTent(camp: NomadCamp): void {
    if (!camp.tent) return;
    const tile = this.gameEngine.getTileAt?.(camp.tent.col, camp.tent.row);
    if (tile) {
      tile.nomadTent = false;
      if (!tile.nomadSettlement) tile.nomadTentClanId = undefined;
    }
    camp.tent = null;
    this.pushTiles();
  }

  /** The store CLONES the tile array, so a flag flip has to be pushed. */
  private pushTiles(): void {
    this.gameEngine.storeActions?.updateMap?.(this.gameEngine.map);
  }

  /**
   * The riders of THIS camp (or of the whole tribe when no camp is named)
   * that stand with `courtId`: beside one of its city tiles, or within one tile
   * of one of its units. This is the envoy's contact rule applied per unit,
   * and it is exactly what the hire door may sell — the group you met.
   */
  private meetingUnitIds(courtId: number, camp?: NomadCamp | null): string[] {
    const ids = camp ? camp.unitIds : this.allCampUnitIds();
    const met: string[] = [];
    for (const id of ids) {
      const unit = this.unitById(id);
      if (!unit) continue;
      const besideCity = (this.gameEngine.cities ?? []).some(
        (c) => c.civilizationId === courtId
          && Math.max(Math.abs(c.col - unit.col), Math.abs(c.row - unit.row)) <= 1,
      );
      const besideUnit = (this.gameEngine.units ?? []).some(
        (u) =>
          u.civilizationId === courtId
          && !u.isDefeated
          && Math.max(Math.abs(u.col - unit.col), Math.abs(u.row - unit.row)) <= 1,
      );
      if (besideCity || besideUnit) met.push(id);
    }
    return met;
  }

  /** The price of THIS group of riders: build cost × 5 × the clan's factor. */
  private hirePriceFor(unitIds: readonly string[]): number {
    if (unitIds.length === 0) return 0;
    return Math.ceil(
      unitIds.reduce((sum, id) => {
        const type = String(this.unitById(id)?.type ?? '');
        return sum + (UNIT_PROPS[type]?.cost ?? 10);
      }, 0) * NOMAD_HIRE_COST_FACTOR * (this.clan?.hirePriceFactor ?? 1),
    );
  }

  /** What THEY pay for one technology: half raw research cost × clan × the refusals owed. */
  private techPriceFor(techId: string): number {
    const raw = TECHNOLOGIES_DATA.find((t) => t.id === techId)?.cost ?? 60;
    const base = Math.floor(raw / NOMAD_TECH_PRICE_DIVISOR) * (this.clan?.techPriceFactor ?? 1);
    return Math.max(
      NOMAD_TECH_PRICE_MIN,
      Math.min(NOMAD_TECH_PRICE_MAX, Math.round(base * this.pricePenalty())),
    );
  }

  /**
   * Their prices remember every closed hand: each refusal (by your court)
   * adds `NOMAD_REFUSAL_PRICE_PENALTY` to everything they ask of you.
   * Four refusals double the price — past the clan's tolerance they stop
   * selling altogether and turn hostile instead.
   */
  private pricePenalty(): number {
    return 1 + NOMAD_REFUSAL_PRICE_PENALTY * Math.min(this.refusals, 4);
  }

  /** Take THESE riders off the map (they ride off, or were sold). */
  private removeCampRiders(camp: NomadCamp): void {
    const leaving = new Set(camp.unitIds);
    this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => !leaving.has(u.id));
    camp.unitIds = [];
  }

  /**
   * The LAST camp left with its employer: the camp identity retires (the
   * riders belong to the buyer now — nothing in the machinery may ever
   * raid, anger, depart or migrate them) and the tribe rides on from here.
   */
  private retireCampForHire(): void {
    this.departed = true;
    this.liveParley = null;
    this.openCamp = null;
    this.liveChoices = null;
    this.scheduleNextVisit(this.lastTargetCivId, this.lastRound);
  }

  /**
   * THE ROUTE — the tribe travels camp by camp: this group takes the next
   * ALIVE court it has not just left (a shuffled pick, so two identical
   * games do not play the same schedule) and rides there in
   * `NOMAD_TRAVEL_ROUNDS` — or, for a friendly human court, at the promised
   * +30 rounds. Nowhere else to go (every rival is dead)? The road has
   * nowhere to lead but back to you: a tribe must never simply vanish.
   */
  private scheduleNextVisit(
    fromCivId: number,
    round: number,
    riders: readonly string[] = [],
  ): void {
    const promisedReturn =
      fromCivId === this.humanCivId()
      && this.standing === 'friendly'
      && this.visitCount < NOMAD_MAX_VISITS;

    const next = this.pickNextCourt(fromCivId, promisedReturn);
    if (next === null) return;
    this.road.push({
      targetCivId: next,
      arriveAt: round + (promisedReturn ? NOMAD_RETURN_DELAY_ROUNDS : NOMAD_TRAVEL_ROUNDS),
      // The riders DO the riding: their legs carry them across the map.
      unitIds: [...riders],
      promised: promisedReturn,
      bestDist: Number.POSITIVE_INFINITY,
      sinceProgress: 0,
    });
  }

  /**
   * A shuffled pick of every alive court but `fromCivId` — the promised
   * court first. YOUR gate is not on that list unless the return was
   * promised (or there is nowhere else to ride): a visit to the human is a
   * story event, never a coincidence.
   */
  private pickNextCourt(fromCivId: number, promisedReturn: boolean): number | null {
    const humanId = this.humanCivId();
    const route = (this.gameEngine.civilizations ?? [])
      .map((c) => c.id)
      .filter((id) => id !== fromCivId && this.gameEngine.civilizations?.[id]?.isAlive !== false);
    for (let i = route.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [route[i], route[j]] = [route[j], route[i]];
    }
    // A ride to YOUR court is a story event, never a coincidence. The tribe
    // arrives the first time because the spawn sends it, and comes back only
    // on a return it PROMISED to a friendly court — so a RANDOM leg skips
    // your gate once you have refused them (or turned them). Before this the
    // shuffle could drop the horde back on your city a few rounds after a
    // "pass", which is exactly the return visit the refusal was supposed to
    // deny. Every rival dead and you are the only court left? Then the road
    // still leads back to you — a tribe must never simply vanish.
    const earned = route.filter((id) => id !== humanId || promisedReturn);
    const road = earned.length > 0 ? earned : route;
    if (road.length === 0 && humanId !== null) road.push(humanId);
    if (promisedReturn && humanId !== null && road[0] !== humanId) road.unshift(humanId);
    return road[0] ?? null;
  }

  /**
   * ONE GROUP STRIKES TENTS: its riders ride off the map and take the next
   * court on the route — while the OTHER camp, if there is one, keeps
   * standing where it is (its own linger runs from now). That is the whole
   * point of the split: one group travels, one stays, so the tribe is never
   * simply gone from the world.
   */
  private departCamp(camp: NomadCamp, round: number): void {
    const from = camp.targetCivId;
    this.lastTargetCivId = from;
    // Any audience dies with the tents that tabled it (resolveParley guards
    // on `departed` too; this frees the slot for whoever speaks next).
    // THE TENTS GO DOWN — THE RIDERS DO NOT. They ride on across the map,
    // step by step and in the open (`marchRoad`), instead of vanishing into
    // a travel spell and reappearing at the next court.
    const riders = camp.unitIds.filter((id) => this.unitById(id) !== undefined);
    this.takeTentsDown(camp);
    if (from === this.humanCivId()) this.departed = true;
    // The rider-less record still counts as a departure for the store: the
    // units really did move (and only YOUR court's departure is news).
    this.gameEngine.onStateChange?.('NOMAD_DEPARTED', { from });

    // The staying group keeps its own clock: whoever is still standing gets
    // a travel spell more of the camp it shares the court with — without
    // this both groups would ride off in the same round.
    const staying = this.camps.find((c) => c !== camp);
    if (staying && staying.departAt !== null && staying.departAt <= round + NOMAD_TRAVEL_ROUNDS) {
      staying.departAt = round + NOMAD_TRAVEL_ROUNDS;
    }

    this.scheduleNextVisit(from, round, riders);
  }

  /**
   * Hand a bought city over — a SALE, not a conquest: no buildings are
   * destroyed, no garrison is put to the sword, nobody is plundered. What
   * does change: the seat of government cannot travel (the Palace is
   * stripped and the seller re-seats its capital), and the nomads have no
   * governor, so production stops where it stands — the city pays tribute,
   * nothing more.
   */
  private transferCityToNomads(city: City, sellerId: number): void {
    city.civilizationId = NOMAD_CIV_ID;
    if (city.isCapital === true) {
      city.isCapital = false;
      city.buildings = stripPalaceBuildings(city.buildings) as string[];
      this.gameEngine.governmentManager?.ensureCapital(sellerId);
    }
    city.currentProduction = null;
    if (Array.isArray(city.buildQueue)) city.buildQueue.length = 0;
    city.productionStored = 0;
    city.productionProgress = 0;
  }

  /**
  /** How close (Chebyshev) a player unit must stand to THESE tents — or to *any* of them, when no camp is named. */
  private playerNearCamp(camp: NomadCamp | null | undefined, humanId: number): boolean {
    const tents = camp ? [camp] : this.camps;
    return tents.some((c) =>
      (this.gameEngine.units ?? []).some(
        (u) =>
          u.civilizationId === humanId
          && !u.isDefeated
          && Math.max(Math.abs(u.col - c.col), Math.abs(u.row - c.row))
            <= NOMAD_PROXIMITY_DISTANCE,
      ),
    );
  }

  // ── The visit (contact-based) ────────────────────────────────────────

  /**
   * Where THESE tents are — every audience payload carries it so the camera
   * can take the viewer to the place the dialog is about (the meeting at
   * the gate, the camp for the market and the plea). Null when the camp has
   * no riders left to look at: nothing to pan to.
   */
  private spotOf(camp: NomadCamp): { col: number; row: number } | null {
    const alive = camp.unitIds
      .map((id) => this.unitById(id))
      .filter((u): u is Unit => u !== undefined);
    if (alive.length === 0) return null;
    // Prefer the unit standing beside a player city — that is the place the
    // dialog is about (the nomads' camp at the city's edge).
    const humanId = this.humanCivId();
    const besideCourt = humanId === null ? undefined : alive.find((u) =>
      (this.gameEngine.cities ?? []).some(
        (c) => c.civilizationId === humanId
          && Math.max(Math.abs(c.col - u.col), Math.abs(c.row - u.row)) <= 1,
      ),
    );
    const u = besideCourt ?? alive[0];
    return { col: u.col, row: u.row };
  }

  /**
   * THE VISIT'S TRIGGER: a nomad unit standing beside a host city's tile —
   * or within one tile of one of its units (the city-less settler visit).
   * The camp stays outside the city walls; once its riders reach the gate,
   * the envoy speaks. No meeting, no envoy.
   *
   * The same predicate, per unit, is what the hire door sells
   * (`meetingUnitIds`): one rule for "they are here" and for "you may buy
   * the ones who are".
   */
  private hasMetCourt(courtId: number, camp?: NomadCamp | null): boolean {
    return this.meetingUnitIds(courtId, camp).length > 0;
  }

  /**
   * A roaming round — "Nomads wander in groups over the map". Before the
   * envoy has spoken, no group beelines for the court: this camp's wanderers
   * strike out for their nearest target, but the walk is a WANDER — most
   * steps close in, some drift sideways (zig-zags, pauses in front of a
   * river, the odd sidestep). A drifting step is only ever drawn from the
   * neighbours that do NOT put the walker further from the target, so the
   * distance to the court never grows and the visit still lands; what
   * changes is the shape of the walk: groups that mill, drift and converge
   * like travellers riding with the wind.
   */
  private roamCamp(camp: NomadCamp, courtId: number): void {
    if (camp.unitIds.length === 0) return;
    const target = this.nearestPlayerTarget({ col: camp.col, row: camp.row }, courtId);
    if (!target) return;
    this.rideAsGroup(camp.unitIds, target, 0);
  }

  /**
   * THE PACK — the horde travels as ONE group. The rider closest to the
   * court LEADS: it walks first and free, and the rest hold
   * `NOMAD_GROUP_RADIUS` around it — a step toward the leader is a step
   * toward the court, so the formation never has to recede to keep together.
   * Nobody may take more steps in a round than the SLOWEST rider of the
   * group (the two spears walk 1, the scout 2), so the scout's extra move
   * cannot carry it away from its mates. A leader that could not move at all
   * releases the ring for a round, so a wall of swamp can never cage the
   * pack. The ordering is by distance then id, so no RNG enters the choice
   * and the deterministic turn stream stays put.
   */
  private rideAsGroup(
    unitIds: readonly string[],
    target: { col: number; row: number },
    stopAt: number,
  ): void {
    const riders = unitIds
      .map((id) => this.unitById(id))
      .filter((u): u is Unit => u !== undefined && u.isDefeated !== true);
    if (riders.length === 0) return;
    const dist = (u: Unit) => Math.max(Math.abs(u.col - target.col), Math.abs(u.row - target.row));
    const byId = (a: Unit, b: Unit) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const pace = Math.min(...riders.map((u) => u.maxMoves ?? 1));
    const leader = [...riders].sort((a, b) => dist(a) - dist(b) || byId(a, b))[0];
    const before = { col: leader.col, row: leader.row };
    this.rideStep(leader, target, stopAt, null, pace);
    const pack = { col: leader.col, row: leader.row };
    const leaderStuck = leader.col === before.col && leader.row === before.row;
    for (const rider of riders) {
      if (rider.id === leader.id) continue;
      this.rideStep(rider, target, stopAt, leaderStuck ? null : pack, pace);
    }
  }

  /**
   * COHESION: cut a rider's candidate steps down to the ones that keep it
   * with its group.
   *
   *  * A step that stays inside the ring wins — the normal case, and what
   *    stops the scout from running ahead of the spears.
   *  * When the ring cannot be kept (a mate on the only tile, a cliff, a
   *    river, or the pack already strung out along a single-file ford) the
   *    rider takes the step that leaves it CLOSEST to the pack instead of
   *    its ordinary step. It still moves — nobody ever holds and jams the
   *    rider behind it — but it never bolts away while a better, equally
   *    legal step would have kept the group together.
   *
   * Every candidate handed in is already non-receding toward the target, so
   * no branch can walk a rider away from the court it is visiting, and the
   * returned list is never empty while the input was not.
   */
  private keepTogether(
    steps: Array<{ col: number; row: number }>,
    pack: { col: number; row: number } | null,
  ): Array<{ col: number; row: number }> {
    if (!pack || steps.length === 0) return steps;
    const ring = (p: { col: number; row: number }) =>
      Math.max(Math.abs(p.col - pack.col), Math.abs(p.row - pack.row));
    const tight = steps.filter((s) => ring(s) <= NOMAD_GROUP_RADIUS);
    if (tight.length > 0) return tight;
    const closest = Math.min(...steps.map(ring));
    return steps.filter((s) => ring(s) === closest);
  }

  /**
   * ONE RIDER'S WALK toward `target`: the wander (most steps close in,
   * some drift sideways — a walk that meanders yet always lands) stops at
   * the city's edge. Visitors do not enter or assault cities. Shared by
   * the camp's wander and by the ride between courts.
   *
   * `pack` is the leader — the rider closest to the court, which sets the
   * line and walks free (`null` for it). Every other rider's candidate
   * steps are filtered through {@link keepTogether} so the group arrives as
   * a group.
   */
  private rideStep(
    unit: Unit,
    target: { col: number; row: number },
    stopAt = 0,
    pack: { col: number; row: number } | null = null,
    stepBudget: number | null = null,
  ): void {
    unit.isFortified = false;
    unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
    // The pack's step budget: nobody walks further in one round than the
    // slowest rider of the group, so the scout's extra move cannot carry it
    // away from the spears even where the ring cannot be kept (a single-file
    // ford, a queue around a swamp).
    const maxSteps = Math.max(
      1,
      stepBudget === null ? (unit.maxMoves ?? 1) : Math.min(unit.maxMoves ?? 1, stepBudget),
    );

    // Repair an old visitor position if the unit is already on its court's
    // city tile: move it to an open neighboring tile before continuing.
    const cityAtTarget = this.gameEngine.getCityAt?.(target.col, target.row);
    if (cityAtTarget && unit.col === target.col && unit.row === target.row) {
      const exits = this.gameEngine.squareGrid?.getNeighbors?.(target.col, target.row) ?? [];
      const exit = exits.find((n) =>
        !this.gameEngine.getUnitAt?.(n.col, n.row)
        && !this.gameEngine.getCityAt?.(n.col, n.row)
        && (this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false),
      );
      if (exit) {
        unit.col = exit.col;
        unit.row = exit.row;
        unit.movesRemaining = Math.max(0, (unit.movesRemaining ?? 1) - 1);
      }
    }

    for (let stepNo = 0; stepNo < maxSteps; stepNo++) {
      const d = Math.max(Math.abs(unit.col - target.col), Math.abs(unit.row - target.row));
      if (d <= stopAt) {
        if (stopAt === 0) break; // standing ON the court
        // NOT THEIR HOUR YET: they hold at `stopAt` and MILL on the road —
        // a rider who never moves looks broken, and a group that rushes
        // its gate before it is expected would stand at a court with no
        // tents and no dialog about it.
        const grid = this.gameEngine.squareGrid;
        const lateral = (grid?.getNeighbors?.(unit.col, unit.row) ?? []).filter(
          (n) =>
            Math.max(Math.abs(n.col - target.col), Math.abs(n.row - target.row)) === d
            && !this.gameEngine.getUnitAt?.(n.col, n.row)
            && !this.gameEngine.getCityAt?.(n.col, n.row)
            && (this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false),
        );
        if (lateral.length === 0) break;
        const milling = this.keepTogether(lateral, pack);
        if (milling.length === 0) break; // defensive: a non-empty list stays non-empty
        const step = milling[Math.floor(Math.random() * milling.length)];
        if (!this.gameEngine.moveUnit(unit.id, step.col, step.row).success) break;
        continue;
      }
      if ((unit.movesRemaining ?? 0) <= 0) break;
      if (d === 1) {
        // Stop at the city's edge or beside the unit target — no shared tile.
        break;
      }
      const next = this.wanderStepToward(unit, target, pack);
      if (!next) break;
      if (!this.gameEngine.moveUnit(unit.id, next.col, next.row).success) break;
    }
  }

  /**
   * One wander step: most steps close in on the target, some drift sideways
   * — a walk that meanders rather than beelines, yet always LANDS. Every
   * candidate step is non-receding (a closer or same-distance neighbour), so
   * the distance to the court never grows however the dice fall; a drifting
   * step is only ever taken sideways, never away. With `pack` set the
   * candidates are then cut to the ones that keep this rider with its group
   * (see {@link keepTogether}).
   */
  private wanderStepToward(
    unit: Unit,
    target: { col: number; row: number },
    pack: { col: number; row: number } | null = null,
  ): { col: number; row: number } | null {
    const grid = this.gameEngine.squareGrid;
    const enterable = (n: { col: number; row: number }) =>
      !this.gameEngine.getUnitAt?.(n.col, n.row)
      && !this.gameEngine.getCityAt?.(n.col, n.row) // a visitor never steps ON a city
      && (this.gameEngine.canUnitMoveTo?.(unit.id, n.col, n.row) ?? false);
    const distance = (n: { col: number; row: number }) =>
      Math.max(Math.abs(n.col - target.col), Math.abs(n.row - target.row));

    const here = distance(unit);
    const ranged = (grid?.getNeighbors?.(unit.col, unit.row) ?? []).filter(enterable);
    const closer = ranged.filter((n) => distance(n) < here);
    const lateral = ranged.filter((n) => distance(n) === here);
    if (closer.length === 0 && lateral.length === 0) {
      return this.nextStepToward(unit, target); // boxed in — the march knows the way out
    }
    // Close steps carry the walk; same-distance steps only drift it.
    const drift = lateral.length > 0 && Math.random() < NOMAD_WANDER_DRIFT_CHANCE;
    const options = this.keepTogether(
      drift ? lateral : closer.length > 0 ? closer : lateral,
      pack,
    );
    if (options.length === 0) return null; // defensive: a non-empty list stays non-empty
    return options[Math.floor(Math.random() * options.length)];
  }

  /** The court's front door FROM A POINT: nearest city, else nearest unit. */
  private nearestPlayerTarget(
    origin: { col: number; row: number },
    courtId: number,
  ): { col: number; row: number } | null {
    const nearest = (list: Array<{ col: number; row: number }>) => {
      let best: { col: number; row: number } | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const p of list) {
        const d = Math.max(Math.abs(p.col - origin.col), Math.abs(p.row - origin.row));
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    };
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === courtId);
    return nearest(cities)
      ?? nearest(
        (this.gameEngine.units ?? []).filter((u) => u.civilizationId === courtId && !u.isDefeated),
      );
  }

  /** The envoy's commute: everyone walks back to the tents to wait. */
  /** The envoy's commute: THESE riders walk back to THESE tents to wait. */
  private returnMarch(camp: NomadCamp): void {
    for (const id of camp.unitIds) {
      const unit = this.unitById(id);
      if (!unit) continue;
      const home = Math.max(Math.abs(unit.col - camp.col), Math.abs(unit.row - camp.row)) <= 1;
      if (home) {
        // Holding ground again, exactly as at the spawn.
        unit.isFortified = true;
        unit.movesRemaining = 0;
        continue;
      }
      unit.isFortified = false;
      unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
      const maxSteps = Math.max(1, unit.maxMoves ?? 1);
      for (let stepNo = 0; stepNo < maxSteps; stepNo++) {
        const d = Math.max(Math.abs(unit.col - camp.col), Math.abs(unit.row - camp.row));
        if (d <= 1) break; // home — gathered around the tents
        const next = this.nextStepToward(unit, camp);
        if (!next) break;
        if (!this.gameEngine.moveUnit(unit.id, next.col, next.row).success) break;
      }
    }
  }

  /** These riders all back within arm's reach of these tents? (Dead walkers count.) */
  private campHome(camp: NomadCamp): boolean {
    return camp.unitIds.every((id) => {
      const u = this.unitById(id);
      return u === undefined
        || Math.max(Math.abs(u.col - camp.col), Math.abs(u.row - camp.row)) <= 1;
    });
  }
}
