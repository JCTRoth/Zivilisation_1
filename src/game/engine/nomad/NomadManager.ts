/**
 * Nomads — a relationship, not an event.
 *
 * Three clans (the Sandborne traders, the Ironhoof riders, the Greywind
 * seers) with three temperaments visit once per single-human game. What
 * happens after is remembered:
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
 *   * **Fair by construction.** Half research cost (clan-adjusted), above
 *     build cost for the horde (clan-adjusted), the promised terms are what
 *     the BUTTON said.
 */
import type GameEngine from '../GameEngine';
import type { AudienceChoice, Civilization, City, Unit } from '../../../../types/game';
import { UNIT_PROPS } from '@/utils/Constants';
import { UNIT_TYPES } from '@/data/UnitConstants';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import { bribeUnitCost } from '../DiplomacyManager';
import { stripPalaceBuildings } from '../BuildingEffects';
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
  NOMAD_CARAVAN_MAX_AGE_ROUNDS,
  NOMAD_CITY_OFFER_COOLDOWN_ROUNDS,
  NOMAD_CITY_OFFER_MIN_GOLD,
  NOMAD_CITY_PRICE_BASE,
  NOMAD_CITY_PRICE_PER_POP,
  NOMAD_CITY_TRIBUTE_PER_POP,
  NOMAD_CLANS,
  NOMAD_CIV_ID,
  NOMAD_CARAVAN_BUILD_ROUNDS,
  NOMAD_CARAVAN_MAX_IN_FLIGHT,
  NOMAD_GROWTH_ROUNDS,
  NOMAD_GROUP_SPLIT_SIZE,
  NOMAD_HIRE_COST_FACTOR,
  NOMAD_KNOWLEDGE_PRICE_DIVISOR,
  NOMAD_KNOWLEDGE_PRICE_MAX,
  NOMAD_KNOWLEDGE_PRICE_MIN,
  NOMAD_KNOWLEDGE_ROUNDS,
  NOMAD_MAP_REVEAL_RADIUS,
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
  NOMAD_RETURN_DELAY_ROUNDS,
  NOMAD_RETURN_MAP_RADIUS,
  NOMAD_ROUTE_INCOME_BASE,
  NOMAD_ROAM_LEASH,
  NOMAD_SETTLEMENT_DEFENDERS,
  NOMAD_SETTLEMENT_MAX_DISTANCE,
  NOMAD_SETTLEMENT_MUSTER_LIMIT,
  NOMAD_SETTLEMENT_MUSTER_ROUNDS,
  NOMAD_SETTLEMENT_TRADE_GOLD,
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
  NOMAD_TRIGGER_FALLBACK_ROUND,
  NOMAD_TRIGGER_ROUND,
  type NomadClan,
  type NomadPersonality,
} from '@/data/NomadConstants';

/** What a resolved parley did — the UI turns this into a localized toast. */
export interface NomadOutcome {
  ok: boolean;
  /** `noGold`: the treasury cannot meet the hire price (UI shows the hint). */
  result?:
    | 'tech' | 'techGift' | 'maps' | 'hire' | 'settle' | 'pass' | 'noGold'
    | 'cityBought' | 'cityRefused'
    | 'goldGiven' | 'goldRefused';
  params?: Record<string, string | number>;
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

export class NomadManager {
  private readonly gameEngine: GameEngine;

  // ── The relationship (one per game) ────────────────────────────────────
  private clan: NomadClan | null = null;
  private standing: NomadStanding = 'neutral';
  private refusals = 0;
  private visitCount = 0;
  private settled = false;
  private hired = false;
  private angrySince = -1;
  private pendingReturnAt: number | null = null;
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

  // ── The current camp (per visit) ──────────────────────────────────────
  private camp: { col: number; row: number } | null = null;
  private campUnitIds: string[] = [];
  private hireCost = 0;
  private departed = false;

  // ── The splinter camp (the split; same tribe, second tent) ────────────
  private splinter: { col: number; row: number } | null = null;
  private splinterUnitIds: string[] = [];

  // ── Settled camps — the nomads living beside a city ───────────────────
  private settlementSpots: Array<{
    col: number;
    row: number;
    cityId: string;
    /** The wanderers the camp produced since it moved in. */
    unitIds: string[];
    lastMusterRound: number;
  }> = [];

  // ── The current parley ────────────────────────────────────────────────
  private parleyEmitted = false;
  private parleyDone = false;
  private secondEmitted = false;
  private liveParley: 'first' | 'second' | 'city' | 'request' | null = null;
  private lastEmitRound = -1;
  private parleyResolvedRound = -1;
  private departAt: number | null = null;
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
  get isParleyDone(): boolean { return this.parleyDone && this.visitCount > 0 && this.campAlive(); }
  get isHired(): boolean { return this.hired; }
  get isDeparted(): boolean { return this.departed && !this.campAlive(); }
  get isSettled(): boolean { return this.settled; }
  get isAngry(): boolean { return this.standing === 'angry'; }
  get currentStanding(): NomadStanding { return this.standing; }
  get visits(): number { return this.visitCount; }
  get currentClan(): NomadClan | null { return this.clan ? { ...this.clan } : null; }
  /** The rolled clan's temperament ('trader' | 'warrior' | 'mystic'). */
  get currentPersonality(): NomadPersonality | null { return this.clan?.personality ?? null; }
  /** What the tribe is currently about — 'roads' until the first review. */
  get currentStance(): NomadStance { return this.ai.currentStance; }
  get campTile(): { col: number; row: number } | null { return this.camp ? { ...this.camp } : null; }

  /** Drop all state (new game / load): v1 nomads never survive a save. */
  reset(): void {
    this.clan = null;
    this.standing = 'neutral';
    this.refusals = 0;
    this.visitCount = 0;
    this.settled = false;
    this.hired = false;
    this.angrySince = -1;
    this.pendingReturnAt = null;
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
    this.camp = null;
    this.campUnitIds = [];
    this.splinter = null;
    this.splinterUnitIds = [];
    this.settlementSpots = [];
    this.hireCost = 0;
    this.departed = false;
    this.parleyEmitted = false;
    this.parleyDone = false;
    this.secondEmitted = false;
    this.liveParley = null;
    this.lastEmitRound = -1;
    this.parleyResolvedRound = -1;
    this.departAt = null;
    this.lastRound = 0;
    this.pending = null;
    this.settleRolled = false;
  }

  // ── The per-round state machine ───────────────────────────────────────

  processRound(round: number): void {
    this.lastRound = round;
    if (this.gameEngine.isGameOver) return;
    const humanId = this.humanCivId();
    if (humanId === null) return;

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

    // Angry camps prey on the player, then leave for good.
    if (this.standing === 'angry') {
      if (!this.campAlive()) return; // wiped out — nothing left to raid with
      this.raidRound(humanId, round);
      if (round >= this.angrySince + NOMAD_RAID_ROUNDS) this.depart();
      return;
    }

    // The first visit.
    if (this.visitCount === 0) {
      const hasCity = (this.gameEngine.cities ?? []).some((c) => c.civilizationId === humanId);
      const due = (round >= NOMAD_TRIGGER_ROUND && hasCity)
        || round >= NOMAD_TRIGGER_FALLBACK_ROUND;
      if (due) this.spawnVisit(round, humanId);
      return;
    }

    // The standing camp: the VISIT (contact!), the parley, the race, the
    // departure.
    if (this.campAlive()) {
      // THE VISIT: their units walk to YOUR units or cities — the envoy
      // only ever speaks when the two sides actually meet, never on a
      // timer. Until then the horde WANDERS (never receding from the way
      // to the court); on contact the parley opens.
      if (!this.parleyEmitted) {
        if (this.hasMetPlayer(humanId)) {
          this.emitParley(false, round);
        } else {
          this.roamRound(humanId);
        }
        return;
      }

      // The envoy's commute: after delivering (or being dismissed) they
      // walk home to wait for the answer. Never blocks the machinery
      // below — a stranded straggler just keeps trying.
      if (!this.campHome()) this.returnMarch();

      if (!this.parleyDone) {
        if (
          this.liveParley !== null
          && round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
          && this.playerNearCamp(humanId)
        ) {
          this.emitParley(false, round);
        }
        return;
      }
      if (this.liveParley === null && round >= this.parleyResolvedRound + NOMAD_AI_HIRE_MIN_ROUND_GAP) {
        this.tryAiHire(humanId);
        if (this.hired) return;
      }
      if (
        this.liveParley === null
        && !this.secondEmitted
        && round >= this.lastEmitRound + NOMAD_REOFFER_COOLDOWN_ROUNDS
        && this.playerNearCamp(humanId)
      ) {
        this.emitParley(true, round);
        return;
      }
      if (this.departAt !== null && round >= this.departAt) {
        this.depart();
      }
      return;
    }

    // No camp: a friendly court has earned its return visit — the ENVOY's
    // return, scheduled by departure or by the horde being sold. (Never for
    // a settled tribe: they put down roots; the story moved into yours.)
    if (
      this.pendingReturnAt !== null
      && round >= this.pendingReturnAt
      && this.visitCount < NOMAD_MAX_VISITS
      && !this.settled
    ) {
      this.pendingReturnAt = null;
      // The promised chart comes at the MEETING — when the envoy actually
      // visits — not at the spawn (see emitParley).
      this.spawnVisit(round, humanId);
    }
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
  private economyPhase(round: number, humanId: number): void {
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
    this.tryBribe(humanId, round, plan);
    this.tryBuildCaravan(round, plan);
    this.tryMuster(round, plan);
    this.moveCaravans();
    this.trySellKnowledge(round, plan);
    this.tryOfferCity(humanId, round, plan);
    this.tryAskForMoney(humanId, round, plan);
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
    const horde = this.campUnitIds
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
    const hordeGroup =
      this.splinter
      && (!this.camp
        || Math.max(Math.abs(target.col - this.splinter.col), Math.abs(target.row - this.splinter.row))
          < Math.max(Math.abs(target.col - this.camp.col), Math.abs(target.row - this.camp.row)))
      ? this.splinterUnitIds
      : this.campUnitIds;
    hordeGroup.push(target.id);
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
    if (this.settled || !this.campAlive() || !this.camp) return;
    if (round - this.lastCaravanBuildRound < NOMAD_CARAVAN_BUILD_ROUNDS) return;
    if (this.caravans.length >= NOMAD_CARAVAN_MAX_IN_FLIGHT) return;
    if (this.routes.length + this.caravans.length >= NOMAD_TRADE_ROUTE_LIMIT) return;
    const target = this.pickRouteTarget();
    if (!target) return; // every eligible city already deals with them
    const cost = UNIT_PROPS[UNIT_TYPES.NOMAD_CARAVAN]?.cost ?? 30;
    if (this.treasury < cost) return;

    const unit = this.gameEngine.createUnit(
      NOMAD_CIV_ID,
      UNIT_TYPES.NOMAD_CARAVAN,
      this.camp.col,
      this.camp.row,
    );
    if (!unit) return;
    this.treasury -= cost;
    this.lastCaravanBuildRound = round;
    this.caravans.push({ unitId: unit.id, targetCityId: target.id, blockedRounds: 0, ageRounds: 0 });
  }

  /** The nearest city they do not already deal with, on the camp's own shore. */
  private pickRouteTarget(): City | null {
    if (!this.camp) return null;
    const taken = new Set(this.routes.map((r) => r.partnerCityId));
    for (const c of this.caravans) taken.add(c.targetCityId);
    const landmass = this.gameEngine.getLandmassId?.(this.camp.col, this.camp.row) ?? -1;
    const candidates = (this.gameEngine.cities ?? []).filter((c) => {
      if (c.civilizationId === NOMAD_CIV_ID) return false; // not their own city
      if (taken.has(c.id)) return false;                   // one route per city
      if (landmass >= 0 && (this.gameEngine.getLandmassId?.(c.col, c.row) ?? -1) !== landmass) {
        return false;
      }
      return true;
    });
    const nearest = candidates
      .map((c) => ({
        c,
        d: Math.max(Math.abs(c.col - this.camp!.col), Math.abs(c.row - this.camp!.row)),
      }))
      .sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id))[0];
    return nearest?.c ?? null;
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
   * join the camp with room, guard it and raid with the horde.
   */
  private tryMuster(round: number, plan: NomadPlan): void {
    // (No `hired` gate: a RETURN visit raises a fresh camp of the tribe's
    // own soldiers — only a settled or wiped camp cannot muster.)
    if (this.settled || !this.campAlive()) return;
    if (this.standing === 'angry') return;   // raiders raise no troops mid-riot
    const steel = plan.muster;
    // Growth is an ANSWERED-parley affair: pre-parley the horde stays the
    // classic three (the hire price the button promised stays honest).
    if (!steel && !this.parleyDone) return;
    const cadence = steel ? NOMAD_CAMP_MUSTER_ROUNDS : NOMAD_GROWTH_ROUNDS;
    if (round - this.lastMusterRound < cadence) return;

    // Two caps, one per era of the visit:
    //   * pre-parley (steel only): the v1 garrison cap beyond the horde;
    //   * post-parley: the group itself is the cap — it gathers riders
    //     until it is big enough to divide, no further splits beyond the
    //     tribe's tents.
    if (steel && !this.parleyDone) {
      const alive = this.musteredIds.filter((id) => this.unitById(id) !== undefined).length;
      if (alive >= NOMAD_CAMP_MUSTER_LIMIT) return;
    }
    const spots = this.groups();
    const withRoom = spots.filter(([, ids]) =>
      ids.filter((id) => this.unitById(id) !== undefined).length < NOMAD_GROUP_SPLIT_SIZE);
    if (withRoom.length === 0) return;
    const [center, group] = withRoom[0];

    const cost = UNIT_PROPS[UNIT_TYPES.WARRIOR]?.cost ?? 40;
    if (this.treasury < cost) return;

    const unit = this.gameEngine.createUnit(
      NOMAD_CIV_ID,
      UNIT_TYPES.WARRIOR,
      center!.col,
      center!.row,
    );
    if (!unit) return;
    this.treasury -= cost;
    this.lastMusterRound = round;
    this.musteredIds.push(unit.id);
    group.push(unit.id); // guards the camp, raids with the horde

    // THE SPLIT: a group at full strength divides while the tribe has
    // tents to spare — the parent holds the tents, the splinter takes the
    // road fresh-found. (The splinter camp itself never splits: the tribe
    // is capped at NOMAD_MAX_CAMPS, so those groups just regrow.)
    if (this.canSplit()) this.splitCamp();
  }

  /** A split is possible: the parent camp is full and the tribe has room. */
  private canSplit(): boolean {
    return (
      this.camp !== null
      && this.splinter === null
      && this.campUnitIds.filter((id) => this.unitById(id) !== undefined).length
        >= NOMAD_GROUP_SPLIT_SIZE
      && this.groupsUsed() < NOMAD_MAX_CAMPS
    );
  }

  /** How many tents the tribe currently keeps. */
  private groupsUsed(): number {
    if (this.camp === null) return 0;
    return this.splinter === null ? 1 : 2;
  }

  /**
   * THE SPLIT — the parent camp halves itself: first half stays at the old
   * tents, the rest walk to a nearby tile and plant the splinter's tents.
   * Both groups belong to the ONE tribe: one standing, one chest, one
   * strategy — but two camps, each free to gather riders again.
   */
  private splitCamp(): void {
    const parent = this.camp;
    if (!parent || this.splinter) return;
    const spot = this.findNearbyCampTile(parent, NOMAD_SPLIT_DISTANCE);
    if (!spot) return; // no road to a second fire — they stay as one group
    const aliveParent = this.campUnitIds.filter(
      (id) => this.unitById(id) !== undefined,
    );
    const half = Math.max(1, Math.floor(aliveParent.length / 2));
    const moving = aliveParent.slice(0, half);
    const staying = aliveParent.slice(half);
    for (const id of moving) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.col = spot.col;
      unit.row = spot.row;
      unit.movesRemaining = 0; // however far it was, they walked it tonight
      unit.isFortified = true; // tents ARE the ground: they hold it
    }
    this.campUnitIds = staying;
    this.splinter = { ...spot };
    this.splinterUnitIds = moving;
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
        && this.playerNearCamp(humanId)
      ) {
        this.emitMoneyRequest(round); // same plea, re-tabled
      }
      return;
    }

    if (!plan.askForMoney || !this.campAlive()) return;
    if (this.liveParley !== null) return;  // another audience owns the screen
    if (this.standing === 'angry') return; // enemies beg from nobody
    if (!this.parleyDone) return;
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
    this.gameEngine.onStateChange?.('NOMAD_MONEY_REQUEST', {
      speaker: {
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
   *    around the stakes, and those wanderers keep in shape by roaming the
   *    land beyond the settlement — life, not scenery.
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
      const cost = UNIT_PROPS[UNIT_TYPES.WARRIOR]?.cost ?? 40;
      if (this.treasury < cost) continue;
      const unit = this.gameEngine.createUnit(
        NOMAD_CIV_ID,
        UNIT_TYPES.WARRIOR,
        spot.col,
        spot.row,
      );
      if (!unit) continue; // the stakes are busy this round
      this.treasury -= cost;
      spot.lastMusterRound = round;
      spot.unitIds.push(unit.id);
    }
    this.roamSettlementWanderers();
  }

  /**
   * The settlement-produced wanderers stretch their legs: a full random
   * walk among the passable, unowned tiles — never onto a city, never off
   * the leash (`NOMAD_ROAM_LEASH`) of their home camp. They are the map's
   * living texture: sightable, raidable, friendly to the barbarians, and
   * NEVER part of the camp machinery (no parley, no anger, no departing).
   */
  private roamSettlementWanderers(): void {
    const grid = this.gameEngine.squareGrid;
    for (const spot of this.settlementSpots) {
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
              Math.max(Math.abs(n.col - spot.col), Math.abs(n.row - spot.row)) <= NOMAD_ROAM_LEASH
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

    if (!this.campAlive() || !this.camp) return;
    const spot = this.findMigrationSpot(city);
    if (!spot) return;
    for (const id of this.campUnitIds) {
      const unit = this.unitById(id);
      if (!unit) continue;
      unit.col = spot.col;
      unit.row = spot.row;
      unit.movesRemaining = 0; // however far it was, they walked it
    }
    this.camp = { ...spot };
    this.gameEngine.onStateChange?.('NOMAD_MIGRATED', { city: city.name ?? '' });
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
        && this.playerNearCamp(humanId)
      ) {
        this.emitCityOffer(round); // same promised terms, re-tabled
        return;
      } else {
        return; // still open — nothing else may speak
      }
    }

    if (this.liveParley !== null) return;          // another audience owns the screen
    if (this.standing === 'angry') return;         // anger and city-buying are exclusive
    if (!this.parleyDone) return;                  // the first parley is answered first
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
    this.gameEngine.onStateChange?.('NOMAD_CITY_OFFER', {
      speaker: {
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
    this.liveParley = null;

    const outcome = this.applyChoice(choiceId, humanId, human);
    if (outcome.ok) {
      this.gameEngine.onStateChange?.('NOMAD_RESOLVED', { result: outcome.result });
    }
    return outcome;
  }

  private applyChoice(
    choiceId: string,
    humanId: number,
    human: Civilization,
  ): NomadOutcome {
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
          this.endVisitWithLinger();
          const techName = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.name ?? tech;
          return {
            ok: true,
            result: free ? 'techGift' : 'tech',
            params: { tech: techName, gold: price },
          };
        }
        this.gameEngine.revealArea(this.camp!.col, this.camp!.row, NOMAD_MAP_REVEAL_RADIUS, humanId);
        this.standing = 'friendly';
        this.endVisitWithLinger();
        return { ok: true, result: 'maps' };
      }

      case 'hire': {
        const cost = this.hireCost;
        if ((human.resources?.gold ?? 0) < cost) return { ok: false, result: 'noGold' };
        human.resources.gold = (human.resources.gold ?? 0) - cost;
        // The horde is SOLD, not given: the payment lands in the tribe's
        // chest (the same purse the market and the bazaars draw from), and
        // being paid by you makes them well-disposed — a friendly court
        // earns the envoy's return visit even though the horde marched off.
        this.treasury += cost;
        this.convertUnits(humanId);
        this.hired = true;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        this.standing = 'friendly';
        this.retireCampForHire();
        return { ok: true, result: 'hire', params: { gold: cost } };
      }

      case 'settle': {
        const offer = this.pending?.settle;
        if (!offer) return { ok: false };
        const tile = this.gameEngine.getTileAt?.(offer.col, offer.row);
        if (!tile) return { ok: false };
        // The settlement outlives the visit: its effects are read from the
        // map (city food drain, defenders raised here).
        tile.nomadSettlement = true;
        for (let i = 0; i < NOMAD_SETTLEMENT_DEFENDERS; i++) {
          this.gameEngine.createUnit(humanId, 'warriors', offer.col, offer.row);
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
          lastMusterRound: this.lastRound,
        });
        this.settled = true;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        this.removeCampUnits(); // the wanderers are home — the camp is gone
        this.camp = null;
        this.splinter = null;
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

      case 'pass':
      case 'farewell': {
        this.refusals += 1;
        this.parleyDone = true;
        this.parleyResolvedRound = this.lastRound;
        const tolerance = this.clan?.angerTolerance ?? 2;
        if (this.refusals > tolerance) {
          // Beyond their patience: the camp does not leave — it turns.
          this.goAngry();
          return { ok: true, result: 'pass' };
        }
        this.departAt = this.lastRound + NOMAD_PASS_DEPART_ROUNDS;
        return { ok: true, result: 'pass' };
      }

      default:
        return { ok: false };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** The one human seat, or null (hotseat / all-AI games are out in v1). */
  private humanCivId(): number | null {
    const seats = this.gameEngine.gameSettings?.humanPlayerIds ?? [0];
    if (seats.length !== 1) return null;
    const id = seats[0];
    return this.gameEngine.civilizations?.[id]?.isHuman === true ? id : null;
  }

  private unitById(id: string) {
    return (this.gameEngine.units ?? []).find((u) => u.id === id && !u.isDefeated);
  }

  /** Every wanderer in play, across both tents — parent camp and splinter. */
  private allCampUnitIds(): string[] {
    return [...this.campUnitIds, ...this.splinterUnitIds];
  }

  private campAlive(): boolean {
    return this.allCampUnitIds().some((id) => this.unitById(id) !== undefined);
  }

  /** Dealt-with visit: the camp lingers for the race, then walks away. */
  private endVisitWithLinger(): void {
    this.parleyDone = true;
    this.parleyResolvedRound = this.lastRound;
    this.departAt = this.lastRound + NOMAD_CAMP_LINGER_ROUNDS;
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
    this.liveParley = null;
    this.departAt = null;
    this.pendingReturnAt = null;
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
   * Raise the camp. The SAME clan returns on a return visit (they are who
   * you met); the first visit rolls one. Returns false when there is no
   * room near the court — the caller retries next round.
   */
  private spawnVisit(round: number, humanId: number): boolean {
    if (!this.clan) {
      this.clan = NOMAD_CLANS[Math.floor(Math.random() * NOMAD_CLANS.length)];
    }
    const anchor = this.anchorFor(humanId);
    if (!anchor) return false;
    const tile = this.findCampTile(anchor);
    if (!tile) return false;

    const ids: string[] = [];
    for (const type of NOMAD_SPAWN_UNITS) {
      const unit = this.gameEngine.createUnit(NOMAD_CIV_ID, type, tile.col, tile.row);
      if (unit) {
        // A camp holds its ground: the horde waits for your answer — and a
        // fortified unit sits OUT its turn (moves spent), as the engine's
        // unit-state law requires.
        unit.isFortified = true;
        unit.movesRemaining = 0;
        ids.push(unit.id);
      }
    }
    if (ids.length === 0) return false;

    this.camp = { ...tile };
    this.campUnitIds = ids;
    this.splinter = null;
    this.splinterUnitIds = [];
    this.departed = false;
    this.parleyEmitted = false;
    this.parleyDone = false;
    this.secondEmitted = false;
    this.liveParley = null;
    this.pending = null;
    this.settleRolled = false;
    // The PREVIOUS visit's clocks must not leak into this one — a stale
    // departAt would send the fresh camp away the moment it arrives.
    this.departAt = null;
    this.parleyResolvedRound = -1;
    this.lastEmitRound = -1;
    // The knowledge counter runs from the visit: their first brokered sale
    // lands NOMAD_KNOWLEDGE_ROUNDS later, not mid-parley.
    this.lastKnowledgeRound = round;
    this.hireCost = Math.ceil(
      ids.reduce((sum, id) => {
        const type = String(this.unitById(id)?.type ?? '');
        return sum + (UNIT_PROPS[type]?.cost ?? 10);
      }, 0) * NOMAD_HIRE_COST_FACTOR * (this.clan?.hirePriceFactor ?? 1),
    );
    this.visitCount += 1;
    // You SEE the strangers arrive — and so does the story.
    this.gameEngine.revealArea(tile.col, tile.row, 4, humanId);
    this.gameEngine.onStateChange?.('NOMAD_SIGHTED', {
      col: tile.col,
      row: tile.row,
      clan: this.clan?.id,
      visit: this.visitCount,
    });
    return true;
  }

  private emitParley(second: boolean, round: number): void {
    const humanId = this.humanCivId();
    if (humanId === null || !this.clan) return;
    const clan = this.clan;
    const returning = this.visitCount > 1;
    const choices: AudienceChoice[] = [];
    let techOffered: string | undefined;
    let goldAmount: number | undefined;
    this.pending = null;
    this.settleRolled = false;
    // The horde is what it IS at the moment of speaking: a camp that has
    // gathered riders since the first meeting now hires for more — the
    // price is again the horde's build cost × 1.1 × the clan's factor.
    this.hireCost = Math.ceil(
      this.allCampUnitIds().reduce((sum, id) => {
        const type = String(this.unitById(id)?.type ?? '');
        return sum + (UNIT_PROPS[type]?.cost ?? 10);
      }, 0) * NOMAD_HIRE_COST_FACTOR * (this.clan?.hirePriceFactor ?? 1),
    );

    // A returning friendly court's gift: the chart they promised — given
    // the moment they actually stand at your gate (the visit itself), and
    // only once (the first parley of the return, never a re-offer).
    if (!second && returning && this.standing === 'friendly' && this.camp) {
      this.gameEngine.revealArea(this.camp.col, this.camp.row, NOMAD_RETURN_MAP_RADIUS, humanId);
      this.gameEngine.onStateChange?.('NOMAD_RETURN_GIFT', {});
    }

    if (!second) {
      const tech = this.gameEngine.pickFreeTech(humanId);
      if (tech) {
        const raw = TECHNOLOGIES_DATA.find((t) => t.id === tech)?.cost ?? 60;
        const price = Math.max(
          NOMAD_TECH_PRICE_MIN,
          Math.min(
            NOMAD_TECH_PRICE_MAX,
            Math.floor((Math.floor(raw / NOMAD_TECH_PRICE_DIVISOR)) * clan.techPriceFactor),
          ),
        );
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
      if (!returning) {
        choices.push({ id: 'maps', labelKey: 'nomad.choice.maps', variant: 'accept' });
      }
      // A clan may propose to settle beside your city (their gamble, their
      // chance) — and the offered tile is remembered for the resolve.
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
            variant: 'accept',
          });
          this.pending = { ...(this.pending ?? {}), settle: settleTile };
        }
      }
      choices.push({
        id: 'hire',
        labelKey: 'nomad.choice.hire',
        labelParams: { gold: this.hireCost },
        variant: 'accept',
      });
      choices.push({ id: 'pass', labelKey: 'nomad.choice.pass', variant: 'pass' });
      this.parleyEmitted = true;
    } else {
      choices.push({
        id: 'hire',
        labelKey: 'nomad.choice.hire',
        labelParams: { gold: this.hireCost },
        variant: 'accept',
      });
      choices.push({ id: 'farewell', labelKey: 'nomad.choice.farewell', variant: 'pass' });
      this.secondEmitted = true;
    }

    this.lastEmitRound = round;
    this.liveParley = second ? 'second' : 'first';
    this.gameEngine.onStateChange?.('NOMAD_PARLEY', {
      speaker: {
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

  /** Every eligible AI court may bid for the horde, cheapest chance first. */
  private tryAiHire(humanId: number): void {
    const cost = this.hireCost;
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
        // The buyer pays the TRIBE — the chest swells when the horde sells.
        this.treasury += cost;
        this.convertUnits(civ.id);
        this.hired = true;
        this.retireCampForHire();
        this.gameEngine.onStateChange?.('NOMAD_HIRED', { civId: civ.id });
        return;
      }
    }
  }

  /** The horde changes colors: neutral units become the owner's units. */
  private convertUnits(ownerId: number): void {
    for (const id of this.allCampUnitIds()) {
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

  private removeCampUnits(): void {
    const leaving = new Set(this.allCampUnitIds());
    this.gameEngine.units = (this.gameEngine.units ?? []).filter((u) => !leaving.has(u.id));
    this.campUnitIds = [];
    this.splinterUnitIds = [];
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
   * The horde left with its employer: the CAMP ends, the tribe does not.
   * Retires the camp identity (the units belong to the buyer now — nothing
   * in the machinery may ever raid, anger, depart or migrate them) and, if
   * the court was friendly, opens the door for the ENVOY's return visit.
   */
  private retireCampForHire(): void {
    this.camp = null;
    this.campUnitIds = [];
    this.splinter = null;
    this.splinterUnitIds = [];
    this.departed = true;
    this.liveParley = null;
    if (this.standing === 'friendly' && this.visitCount < NOMAD_MAX_VISITS) {
      this.pendingReturnAt = this.lastRound + NOMAD_RETURN_DELAY_ROUNDS;
    }
  }

  /**
   * The camp walks off. Only a dealt-with (friendly) court earns the return
   * visit — the door for it opens on this departure.
   */
  private depart(): void {
    this.removeCampUnits();
    this.camp = null;
    this.splinter = null;
    this.departed = true;
    // Any audience dies with the camp: an open parley or city offer must
    // never outlive the envoy who tabled it (resolveParley already guards
    // on `departed`; this frees the slot for the next visit).
    this.liveParley = null;
    this.gameEngine.onStateChange?.('NOMAD_DEPARTED', {});
    if (this.standing === 'friendly' && this.visitCount < NOMAD_MAX_VISITS) {
      this.pendingReturnAt = this.lastRound + NOMAD_RETURN_DELAY_ROUNDS;
    }
  }

  private playerNearCamp(humanId: number): boolean {
    return [this.camp, this.splinter].some((c) => {
      if (!c) return false;
      return (this.gameEngine.units ?? []).some(
        (u) =>
          u.civilizationId === humanId
          && !u.isDefeated
          && Math.max(Math.abs(u.col - c.col), Math.abs(u.row - c.row))
            <= NOMAD_PROXIMITY_DISTANCE,
      );
    });
  }

  // ── The visit (contact-based) ────────────────────────────────────────

  /**
   * THE VISIT'S TRIGGER: a nomad unit beside a player unit or a player
   * city — "units from them meeting YOUR units or cities". Face to face
   * (Chebyshev ≤ 1), never on a timer: no meeting, no envoy.
   */
  private hasMetPlayer(humanId: number): boolean {
    const camp = this.allCampUnitIds()
      .map((id) => this.unitById(id))
      .filter((u): u is Unit => u !== undefined);
    if (camp.length === 0) return false;
    const theirs = [
      ...(this.gameEngine.units ?? []).filter((u) => u.civilizationId === humanId && !u.isDefeated),
      ...(this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId),
    ];
    return camp.some((c) =>
      theirs.some((t) => Math.max(Math.abs(c.col - t.col), Math.abs(c.row - t.row)) <= 1),
    );
  }

  /**
   * A roaming round — "Nomads wander in groups over the map". Before the
   * envoy has spoken, no group beelines for the court: each camp's wanderers
   * strike out for their nearest target, but the walk is a WANDER — most
   * steps close in, some drift sideways (zig-zags, pauses in front of a
   * river, the odd sidestep). A drifting step is only ever drawn from the
   * neighbours that do NOT put the walker further from the target, so the
   * distance to the court never grows and the visit still lands; what
   * changes is the shape of the walk: groups that mill, drift and converge
   * like travellers riding with the wind.
   */
  private roamRound(humanId: number): void {
    for (const [center, ids] of this.groups()) {
      if (ids.length === 0) continue;
      const target = this.nearestPlayerTarget(center, humanId);
      if (!target) continue;
      for (const id of ids) {
        const unit = this.unitById(id);
        if (!unit) continue;
        unit.isFortified = false;
        unit.movesRemaining = unit.maxMoves ?? unit.movesRemaining;
        const maxSteps = Math.max(1, unit.maxMoves ?? 1);
        for (let stepNo = 0; stepNo < maxSteps; stepNo++) {
          const d = Math.max(Math.abs(unit.col - target.col), Math.abs(unit.row - target.row));
          if (d <= 1 || (unit.movesRemaining ?? 0) <= 0) break; // at the gate
          const next = this.wanderStepToward(unit, target);
          if (!next) break;
          if (!this.gameEngine.moveUnit(unit.id, next.col, next.row).success) break;
        }
      }
    }
  }

  /** Every living group as (tents, unit ids) — the parent camp, then the splinter. */
  private groups(): Array<[
    { col: number; row: number } | null,
    string[],
  ]> {
    return [
      [this.camp, this.campUnitIds],
      [this.splinter, this.splinterUnitIds],
    ].filter(([c]) => c !== null) as Array<[
      { col: number; row: number } | null,
      string[],
    ]>;
  }

  /**
   * One wander step: most steps close in on the target, some drift sideways
   * — a walk that meanders rather than beelines, yet always LANDS. Every
   * candidate step is non-receding (a closer or same-distance neighbour), so
   * the distance to the court never grows however the dice fall; a drifting
   * step is only ever taken sideways, never away.
   */
  private wanderStepToward(
    unit: Unit,
    target: { col: number; row: number },
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
    const options = drift ? lateral : closer.length > 0 ? closer : lateral;
    return options[Math.floor(Math.random() * options.length)];
  }

  /** The court's front door FROM A POINT: nearest player city, else unit. */
  private nearestPlayerTarget(
    origin: { col: number; row: number },
    humanId: number,
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
    const cities = (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === humanId);
    return nearest(cities)
      ?? nearest(
        (this.gameEngine.units ?? []).filter((u) => u.civilizationId === humanId && !u.isDefeated),
      );
  }

  /** The envoy's commute: everyone walks back to the tents to wait. */
  private returnMarch(): void {
    const camp = this.camp;
    if (!camp) return;
    for (const id of this.campUnitIds) {
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

  /** Everyone back within arm's reach of the tents? (Dead walkers count.) */
  private campHome(): boolean {
    const camp = this.camp;
    if (!camp) return false;
    return this.campUnitIds.every((id) => {
      const u = this.unitById(id);
      return u === undefined
        || Math.max(Math.abs(u.col - camp.col), Math.abs(u.row - camp.row)) <= 1;
    });
  }
}
