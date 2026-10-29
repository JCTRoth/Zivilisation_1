/**
 * DiplomacyManager - Manages all diplomatic relations between civilizations.
 *
 * Responsibilities:
 *  - Track diplomatic status between every pair of civilizations
 *  - Process proposals (peace, ceasefire, alliance, tribute, bribery)
 *  - Calculate AI willingness to accept proposals
 *  - Maintain reputation tracking
 *  - Generate intelligence reports
 *  - Provide AI diplomatic decision-making each turn
 */

import type {
  DiplomaticStatus,
  DiplomaticRelation,
  Attitude,
  DiplomacyProposal,
  DiplomacyResponse,
  DiplomacyEvent,
  IntelligenceReport,
  DiplomatAction,
  ImpactEvent,
  TreatyType,
  ProposalEvaluation,
  EspionageResult,
  CityIntelligence,
} from './DiplomacyTypes';
import { ESPIONAGE_DIPLOMAT_ACTIONS, attitudeFromScore, goldPayerFor } from './DiplomacyTypes';
import {
  applyImpact,
  createOpinion,
  normalizeOpinion,
  readOpinion,
  readOpinionHeldByOther,
  recordRefusal,
  noteOffer,
} from './diplomacy/DiplomaticOpinion';
import { diplomaticWeights, type DiplomaticWeights } from './diplomacy/DiplomaticWeights';
import { computeImpact, impactText, warEventFor, type ImpactTerms } from './diplomacy/DiplomaticImpacts';
import {
  evaluateProposal,
  proposalNoise,
  rejectionReason,
  seededNoise,
  type ProposalContext,
} from './diplomacy/ProposalScoring';
import {
  chooseAction,
  exhaustionDelta,
  EXHAUSTION_MAX,
  maxConcurrentWars,
  scoreCandidates,
  shouldHonourMutualDefence,
  type PolicyContext,
} from './diplomacy/AIDiplomacyPolicy';
import { wouldProposeExchange, type TechTradeContext } from './diplomacy/TechTradeEvaluator';
import type { Unit, City } from '../../../types/game';
import GameEngine from './GameEngine';
import { debugLog } from '../../utils/DevLog';
import { TECHNOLOGIES_DATA } from '../../data/TechnologyData';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base gold cost to bribe a unit (multiplied by unit attack+defense) */
const BRIBE_UNIT_BASE_COST = 25;

/**
 * What bribing this unit would actually cost. Exported so the AI can decide
 * whether a bribe is worth attempting BEFORE offering one — a price
 * re-derived on the AI side is a price that quietly drifts from the charge.
 */
export function bribeUnitCost(unit: { attack?: number; defense?: number }): number {
  return BRIBE_UNIT_BASE_COST * ((unit.attack || 1) + (unit.defense || 1));
}

/** The three ways a bribe attempt can end — see `bribeUnit`. */
export type BribeOutcome = 'defected' | 'reported' | 'refused';

/**
 * Map a d100 roll onto the three bribe outcomes.
 *
 * The defect band is `[0, chance)` — the odds the caller computed from
 * opinion and paranoia. The FAILURE band splits evenly between the two ways
 * a bribe can go wrong: a refusal leaves no trace at all, but as often as
 * not the offer is carried straight to the commander's desk — who pockets
 * the gold and reports the attempt, and the insult lands on the owner's
 * ledger for everyone to see.
 */
export function bribeOutcomeForRoll(roll: number, chance: number): BribeOutcome {
  if (roll < chance) return 'defected';
  if (roll < chance + (100 - chance) / 2) return 'reported';
  return 'refused';
}
/** How many turns before AI re-evaluates diplomatic stance */
const AI_DIPLOMACY_INTERVAL = 5;
/**
 * Minimum rounds between two calls to arms against the same enemy. A civ at
 * war asks its friends once when the war opens; re-asking every round would
 * spam the audience modal (and every refusal, remembered, would sour the
 * friendship the ask was counting on).
 */
const CALL_TO_ARMS_COOLDOWN = 16;
/**
 * Base chance a spying attempt is noticed, before paranoia scales it. Spying
 * was previously free and consequence-free; a civ that catches you now writes
 * a real negative impact, scaled up to 3× by how suspicious it is.
 */
const SPY_DETECTION_BASE = 15;
/**
 * Detection odds for the two infiltrations that end careers: stealing a
 * technology and sabotaging a city. Both are louder than simply reading a
 * city's ledgers, and both cost the target a war when they succeed — the odds
 * have to be high enough that espionage is a decision, not an auto-claim.
 */
const STEAL_DETECTION_BASE = 45;
const SABOTAGE_DETECTION_BASE = 50;
/**
 * Rounds of peace a civ remembers you for, which is what makes a broken peace
 * treaty expensive long after the fact.
 */
const GRIEVANCE_DECAY_PER_TURN = 0.5;

/**
 * Actions that would harm a locked teammate. They are refused at the
 * `processProposal` / `executeDiplomatAction` chokepoints, so a UI bug or an
 * over-eager AI cannot bypass the team lock.
 */
const TEAM_HOSTILE_ACTIONS: ReadonlySet<DiplomatAction> = new Set<DiplomatAction>([
  'demand_tribute',
  'bribe_unit',
  'gather_intelligence',
  'investigate_city',
  'industrial_sabotage',
  'steal_technology',
  'incite_revolt',
]);

/**
 * Actions that make no sense between locked allies: they are already allied,
 * already have open borders and an embassy, and automatically join each
 * other's wars. Refusing them keeps the diplomacy screen honest.
 */
const TEAM_REDUNDANT_ACTIONS: ReadonlySet<DiplomatAction> = new Set<DiplomatAction>([
  'propose_peace',
  'propose_ceasefire',
  'propose_alliance',
  'offer_open_borders',
  'propose_mutual_defense',
  'propose_non_aggression',
  'propose_joint_war',
  'call_for_help',
  'establish_embassy',
]);

/** Treaties a locked teammate may never cancel: they are part of the lock. */
const TEAM_LOCKED_TREATIES: ReadonlySet<TreatyType> = new Set<TreatyType>([
  'open_borders',
  'mutual_defense',
  'embargo_target',
]);

/** How an AI proposal is phrased to the human, per action. */
const AI_OFFER_MESSAGES: Partial<Record<DiplomatAction, (civName: string) => string>> = {
  propose_peace: (n) => `${n} sues for peace.`,
  propose_ceasefire: (n) => `${n} proposes a ceasefire.`,
  propose_alliance: (n) => `${n} proposes an alliance.`,
  offer_open_borders: (n) => `${n} proposes open borders.`,
  propose_trade_agreement: (n) => `${n} proposes a trade agreement.`,
  propose_non_aggression: (n) => `${n} proposes a non-aggression pact.`,
  offer_tech_exchange: (n) => `${n} offers an Exchange of Knowledge.`,
  offer_tech_for_gold: (n) => `${n} offers a technology for gold.`,
  gift_technology: (n) => `${n} offers a gift of knowledge.`,
  gift_gold: (n) => `${n} offers a gift of gold.`,
  request_gold: (n) => `${n} requests a gift of gold.`,
  establish_embassy: (n) => `${n} proposes to establish an embassy.`,
};

// ---------------------------------------------------------------------------
// DiplomacyManager
// ---------------------------------------------------------------------------

export class DiplomacyManager {
  private gameEngine: GameEngine;
  /** Canonical relation map keyed as "civA_civB" where civA < civB */
  private relations: Map<string, DiplomaticRelation> = new Map();
  /** Log of diplomatic events (most recent first, capped at 50) */
  private eventLog: DiplomacyEvent[] = [];
  /**
   * Cooldown ledger for war-time calls to arms, keyed `caller:friend:enemy`
   * → the round the ask was made. In-memory on purpose: a cooldown is a
   * pacing rule, not game state that has to survive a save.
   */
  private callToArmsAsked = new Map<string, number>();
  /**
   * Civilization pairs that have physically met, keyed exactly like
   * `relations`. Contact is a PAIR fact: when one side sees the other, both
   * learn of each other. Barbarians are never recorded.
   */
  private contactedPairs: Set<string> = new Set();
  /**
   * Pairs that have an embassy, keyed exactly like `relations`. An embassy is
   * what unlocks real negotiation: without one the diplomacy screen will not
   * let the player talk terms.
   */
  private embassyPairs: Set<string> = new Set();
  /**
   * Per-civ war wear, 0…EXHAUSTION_MAX. Fighting costs, peace heals. This is
   * what turns a grinding stalemate into a negotiated one instead of a war that
   * runs to the end of the game.
   */
  private warExhaustion: Map<number, number> = new Map();
  /** Monotonic counter so repeated identical proposals are not identical draws. */
  private proposalSequence = 0;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ─── Initialization ────────────────────────────────────────────────

  /** Initialize relations between all civilization pairs (call after civs are created) */
  initialize(civIds: number[]): void {
    this.relations.clear();
    this.eventLog = [];
    this.contactedPairs.clear();
    this.embassyPairs.clear();
    this.warExhaustion.clear();
    this.callToArmsAsked.clear();
    this.proposalSequence = 0;
    for (let i = 0; i < civIds.length; i++) {
      for (let j = i + 1; j < civIds.length; j++) {
        const key = this.key(civIds[i], civIds[j]);
        this.relations.set(key, {
          civA: civIds[i],
          civB: civIds[j],
          status: 'peace',
          since: 0,
          opinionAtoB: createOpinion(),
          opinionBtoA: createOpinion(),
          activeTreaties: [],
          treatySince: {},
          tradeGoldPerTurn: 0,
        });
      }
    }
  }

  /** Reset for new game */
  reset(): void {
    this.relations.clear();
    this.eventLog = [];
    this.contactedPairs.clear();
    this.embassyPairs.clear();
    this.warExhaustion.clear();
    this.proposalSequence = 0;
  }

  /**
   * Force every locked-team invariant onto the relation table.
   *
   * Called after `initialize()` on a new game and again after restoring a save.
   * It is idempotent and deliberately runs LAST on load: an older or
   * hand-edited save may contain a war between teammates, and the team lock
   * must win over the saved relation.
   */
  applyTeamInvariants(): void {
    const teams = this.gameEngine.teamManager;
    if (!teams?.enabled) return;

    for (const teamId of teams.getTeamIds()) {
      const members = teams.getTeamMembers(teamId);
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const civA = members[i];
          const civB = members[j];
          const rel = this.getRelation(civA, civB);
          if (!rel) continue;

          rel.status = 'alliance';
          rel.since = 0;
          rel.peaceSignedAt = undefined;
          rel.activeTreaties = rel.activeTreaties.filter(
            (treaty) => treaty !== 'embargo_target' && treaty !== 'mutual_defense',
          );
          if (!rel.activeTreaties.includes('open_borders')) {
            rel.activeTreaties.push('open_borders');
            rel.treatySince.open_borders = 0;
          }
          if (rel.embargoTargetCivId === civA || rel.embargoTargetCivId === civB) {
            rel.embargoTargetCivId = undefined;
          }
          this.contactedPairs.add(this.key(civA, civB));
          this.embassyPairs.add(this.key(civA, civB));
          this.warExhaustion.set(civA, 0);
          this.warExhaustion.set(civB, 0);

          const first = this.gameEngine.civilizations?.find((civ) => civ.id === civA);
          const second = this.gameEngine.civilizations?.find((civ) => civ.id === civB);
          first?.warWith?.delete(civB);
          second?.warWith?.delete(civA);
        }
      }
    }
  }

  /** Locked allies may never fight, spy on or betray one another. */
  private isTeammate(civA: number, civB: number): boolean {
    return this.gameEngine.teamManager?.isTeammate(civA, civB) ?? false;
  }

  /** The civ itself plus its locked teammates (or just the civ). */
  private teamMembersOf(civId: number): number[] {
    return this.gameEngine.teamManager?.getTeamMembersOf(civId) ?? [civId];
  }

  // ─── Contact / first meeting ───────────────────────────────────────

  /**
   * Record that two civilizations have met. Returns true only when this was a
   * NEW contact, so the caller can announce it exactly once. Ignored for
   * barbarians and for pairs that have no relation record.
   */
  markContact(civA: number, civB: number): boolean {
    if (civA === civB) return false;
    if (civA < 0 || civB < 0) return false;
    const rel = this.relations.get(this.key(civA, civB));
    if (!rel) return false;
    if (this.contactedPairs.has(this.key(civA, civB))) return false;
    this.contactedPairs.add(this.key(civA, civB));
    // Meeting is itself a (small) event: a xenophobic civ is not delighted by
    // it, a diplomatic one mildly is. Both sides form an opinion.
    this.recordImpactOn(rel, civA, 'first_contact');
    this.recordImpactOn(rel, civB, 'first_contact');
    return true;
  }

  /** Whether these two civilizations have met. */
  hasContacted(civA: number, civB: number): boolean {
    if (civA === civB) return true;
    if (this.isTeammate(civA, civB)) return true;
    if (this.contactedPairs.has(this.key(civA, civB))) return true;
    // Fixed alliances share intelligence: a civ has met everyone its OWN locked
    // teammates have met, so one scout's contact is the whole team's contact.
    // Shared within the team only — an outsider does not inherit the team's
    // contacts. Derived (not stored), so save files keep the per-civ pairs.
    const teams = this.gameEngine.teamManager;
    if (teams?.enabled) {
      for (const mate of teams.getTeammates(civA)) {
        if (this.contactedPairs.has(this.key(mate, civB))) return true;
      }
    }
    return false;
  }

  /** Every counterpart this civilization has already met (teammates always). */
  getMetCivs(civId: number): number[] {
    const met: number[] = [];
    for (const rel of this.relations.values()) {
      const other = rel.civA === civId ? rel.civB : rel.civB === civId ? rel.civA : null;
      if (other === null) continue;
      if (this.hasContacted(civId, other)) met.push(other);
    }
    return met;
  }

  /** Serialize met pairs (for save/load). */
  exportContactedPairs(): string[] {
    return Array.from(this.contactedPairs);
  }

  restoreContactedPairs(pairs: string[]): void {
    this.contactedPairs = new Set(pairs);
  }

  /**
   * Treat every known pair as met. Used when loading a save that predates
   * contact tracking, so the diplomacy screen does not suddenly empty out.
   */
  markAllContactsMet(): void {
    for (const key of this.relations.keys()) this.contactedPairs.add(key);
  }

  /**
   * Whether the two civs currently have diplomat units in physical proximity —
   * on the same tile or on adjacent tiles (Chebyshev distance <= 1). Unlike
   * `hasContacted`, this is a live spatial check: an Exchange of Knowledge can
   * only be negotiated while both diplomats are actually standing together.
   */
  hasDiplomatContact(fromCivId: number, toCivId: number): boolean {
    const units = this.gameEngine.units ?? [];
    const fromDiplomats = units.filter(
      (u: Unit) => u.civilizationId === fromCivId && u.type === 'diplomat',
    );
    const toDiplomats = units.filter(
      (u: Unit) => u.civilizationId === toCivId && u.type === 'diplomat',
    );
    if (fromDiplomats.length === 0 || toDiplomats.length === 0) return false;
    const dist = (a: Unit, b: Unit): number =>
      this.gameEngine.squareGrid?.chebyshevDistance?.(a.col, a.row, b.col, b.row)
      ?? Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
    return fromDiplomats.some((a: Unit) => toDiplomats.some((b: Unit) => dist(a, b) <= 1));
  }

  // ─── Key helpers ───────────────────────────────────────────────────

  private key(a: number, b: number): string {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  // ─── Queries ───────────────────────────────────────────────────────

  getRelation(civA: number, civB: number): DiplomaticRelation | undefined {
    return this.relations.get(this.key(civA, civB));
  }

  getStatus(civA: number, civB: number): DiplomaticStatus {
    if (this.isTeammate(civA, civB)) return 'alliance';
    return this.getRelation(civA, civB)?.status ?? 'peace';
  }

  isAtWar(civA: number, civB: number): boolean {
    if (this.isTeammate(civA, civB)) return false;
    return this.getStatus(civA, civB) === 'war';
  }

  isAllied(civA: number, civB: number): boolean {
    if (this.isTeammate(civA, civB)) return true;
    return this.getStatus(civA, civB) === 'alliance';
  }

  /** Get all civilizations at war with the given civ */
  getEnemies(civId: number): number[] {
    const enemies: number[] = [];
    for (const rel of this.relations.values()) {
      if (rel.status !== 'war') continue;
      if (rel.civA === civId) enemies.push(rel.civB);
      else if (rel.civB === civId) enemies.push(rel.civA);
    }
    return enemies.filter((id) => !this.isTeammate(civId, id));
  }

  /**
   * Number of distinct enemy TEAMS. A three-civ team is one war, not three:
   * the AI's war-cap must not punish it for fighting a coalition.
   */
  getEnemyTeamCount(civId: number): number {
    const teamIds = new Set<number>();
    for (const enemy of this.getEnemies(civId)) {
      const teamId = this.gameEngine.teamManager?.getTeamId(enemy);
      teamIds.add(teamId ?? enemy);
    }
    return teamIds.size;
  }

  /**
   * Military strength of a whole team. AI target selection uses this instead
   * of one civ's strength, otherwise it happily attacks a 3-civ alliance
   * believing it faces a single opponent.
   */
  estimateTeamStrength(civId: number): number {
    return this.teamMembersOf(civId).reduce(
      (total, memberId) => total + this.estimateMilitaryStrength(memberId),
      0,
    );
  }

  /** Get all civilizations allied with the given civ (locked teammates included). */
  getAllies(civId: number): number[] {
    const allies = new Set<number>(this.teamMembersOf(civId).filter((id) => id !== civId));
    for (const rel of this.relations.values()) {
      if (rel.status !== 'alliance') continue;
      if (rel.civA === civId) allies.add(rel.civB);
      else if (rel.civB === civId) allies.add(rel.civA);
    }
    return [...allies];
  }

  /** Get all relations for a given civ (for UI display) */
  getRelationsForCiv(civId: number): Array<DiplomaticRelation & { otherCivId: number }> {
    const result: Array<DiplomaticRelation & { otherCivId: number }> = [];
    for (const rel of this.relations.values()) {
      if (rel.civA === civId) result.push({ ...rel, otherCivId: rel.civB });
      else if (rel.civB === civId) result.push({ ...rel, otherCivId: rel.civA });
    }
    return result;
  }

  /** Get all diplomatic relations (for save/load serialization) */
  getAllRelations(): DiplomaticRelation[] {
    return Array.from(this.relations.values());
  }

  /** Restore relations from saved data (for load game) */
  restoreRelations(relations: DiplomaticRelation[]): void {
    this.relations.clear();
    this.warExhaustion.clear();
    for (const rel of relations) {
      const key = this.key(rel.civA, rel.civB);
      // Saves written before the opinion ledger (v3 and earlier) have no
      // opinions at all; normalizeOpinion fills a neutral one so the maths can
      // never read undefined. See backfillOpinion in GameEngine for the
      // migration that turns those old numbers into goodwill.
      this.relations.set(key, {
        ...rel,
        opinionAtoB: normalizeOpinion(rel.opinionAtoB),
        opinionBtoA: normalizeOpinion(rel.opinionBtoA),
        activeTreaties: rel.activeTreaties ?? [],
        treatySince: rel.treatySince ?? {},
      });
    }
  }

  /**
   * War wear for a civ, 0…EXHAUSTION_MAX. Public because the diplomacy screen
   * shows it and the AI tests assert on it.
   */
  getWarExhaustion(civId: number): number {
    return this.warExhaustion.get(civId) ?? 0;
  }

  /** Restore event log from saved data (for load game) */
  restoreEventLog(events: DiplomacyEvent[]): void {
    this.eventLog = events.map(e => ({ ...e }));
  }

  /** Get the recent event log */
  /**
   * The diplomacy ledger, as far as `observerCivId` can see it.
   *
   * Without an observer the full log is returned (AI-vs-AI runs, tests,
   * exports). With one, entries a court could not know about are dropped: an
   * event between two OTHER civs is only visible through the observer's
   * embassy network — you must hold an embassy with BOTH parties to hear of
   * their dealings. Events touching the observer are always visible.
   */
  getEventLog(observerCivId?: number): DiplomacyEvent[] {
    if (observerCivId === undefined) return [...this.eventLog];
    return this.eventLog.filter((event) => {
      if (event.fromCivId === observerCivId || event.toCivId === observerCivId) return true;
      return this.hasEmbassy(observerCivId, event.fromCivId)
        && this.hasEmbassy(observerCivId, event.toCivId);
    });
  }

  // ─── Opinion & attitude ────────────────────────────────────────────

  /** Calculate the attitude `fromCivId` holds toward `towardCivId`. */
  getAttitude(fromCivId: number, towardCivId: number): Attitude {
    return attitudeFromScore(this.getAttitudeScore(fromCivId, towardCivId));
  }

  /**
   * Raw goodwill `fromCivId` holds toward `towardCivId` — the single number
   * the meter draws and the bands bucket.
   *
   * This used to be recomputed from scratch on every read, mixing personality
   * offsets, a reputation term and a broken-treaty term that were ALSO
   * counted in `calculateWillingness`. It is now a stored ledger that only
   * moves when something actually happens, which is both cheaper and the only
   * way "every act has a lasting effect" can be true.
   */
  getAttitudeScore(fromCivId: number, towardCivId: number): number {
    const rel = this.getRelation(fromCivId, towardCivId);
    if (!rel) return 0;
    return readOpinion(rel, fromCivId).goodwill;
  }

  /** The full directed ledger one civ holds about another (for the UI). */
  getOpinion(aboutCivId: number, towardCivId: number) {
    const rel = this.getRelation(aboutCivId, towardCivId);
    if (!rel) return readOpinion({ civA: aboutCivId, civB: towardCivId } as DiplomaticRelation, aboutCivId);
    return readOpinion(rel, aboutCivId);
  }

  /** How THEY feel about us — the direction the diplomacy screen shows. */
  getTheirOpinion(usCivId: number, themCivId: number) {
    const rel = this.getRelation(usCivId, themCivId);
    if (!rel) return createOpinion();
    return readOpinionHeldByOther(rel, usCivId);
  }

  /**
   * Live spatial contact check: a unit of one civ standing beside a unit or
   * city of the other. Contact is symmetric — either side's proximity counts.
   */
  hasUnitContact(usCivId: number, themCivId: number): boolean {
    const units = (this.gameEngine.getAllUnits?.() ?? this.gameEngine.units ?? []) as Unit[];
    const cities = (this.gameEngine.getAllCities?.() ?? this.gameEngine.cities ?? []) as City[];
    const ours = units.filter((u) => u.civilizationId === usCivId);
    const theirs = units.filter((u) => u.civilizationId === themCivId);
    const theirCities = cities.filter((c) => c.civilizationId === themCivId);
    const ourCities = cities.filter((c) => c.civilizationId === usCivId);

    const adjacent = (a: { col: number; row: number }, b: { col: number; row: number }) =>
      Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1;

    const contactFrom = (sideUnits: Unit[], otherUnits: Unit[], otherCities: City[]) =>
      sideUnits.some((u) => otherUnits.some((t) => adjacent(u, t))
        || otherCities.some((c) => adjacent(u, c)));

    return contactFrom(ours, theirs, theirCities) || contactFrom(theirs, ours, ourCities);
  }

  /** The diplomatic weight vector for a civ (personality as multipliers). */
  weightsFor(civId: number): DiplomaticWeights {
    return diplomaticWeights(this.gameEngine.civilizations?.[civId]);
  }

  /**
   * The single point where an act becomes goodwill. Every diplomatic action
   * funnels through here, so the ledger and its reason list can never drift
   * apart, and rebalancing the whole model means editing one table.
   */
  private recordImpactOn(
    rel: DiplomaticRelation,
    holderCivId: number,
    event: ImpactEvent,
    terms?: ImpactTerms,
    detail?: string,
  ): number {
    const weights = this.weightsFor(holderCivId);
    const round = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const { delta } = computeImpact(event, weights, rel.status, terms);
    const reason = applyImpact(rel, holderCivId, event, delta, round, detail);
    return reason.delta;
  }

  /** Public reason list, newest first — the "why do they hate me" feed. */
  getImpactReasons(aboutCivId: number, towardCivId: number) {
    return this.getOpinion(aboutCivId, towardCivId).reasons;
  }

  /** Human-readable label for an impact event, for the UI. */
  impactLabel(event: ImpactEvent): string {
    return impactText(event);
  }

  // ─── State changes ─────────────────────────────────────────────────

  /**
   * Declare war between two civilizations.
   *
   * In a fixed-alliance game the declaration expands to the cross-product of
   * the two teams: attacking one member brings the whole alliance in, on both
   * sides. `declareWarPair` does the actual relation transition; the
   * orchestrator ensures the global reputation hit and the UI event happen
   * once per team war, not once per pair.
   *
   * `propagateCalls` is false when the war comes from an ally ANSWERING a
   * call for help: the friend joined the war its partner was already in, and
   * that must not set off another round of calls.
   */
  declareWar(aggressorId: number, targetId: number, options?: { propagateCalls?: boolean }): void {
    if (this.isTeammate(aggressorId, targetId)) {
      debugLog(`[DIPLOMACY] Ignored war between locked teammates ${aggressorId} and ${targetId}`);
      return;
    }

    const aggressors = this.teamMembersOf(aggressorId);
    const targets = this.teamMembersOf(targetId);
    let announced = false;
    let reputationDone = false;
    let anyChanged = false;

    for (const a of aggressors) {
      for (const t of targets) {
        if (this.isTeammate(a, t)) continue;
        const changed = this.declareWarPair(a, t, {
          globalReputation: !reputationDone,
          announce: !announced,
        });
        if (changed) {
          anyChanged = true;
          announced = true;
          reputationDone = true;
        }
      }
    }

    if (anyChanged && options?.propagateCalls !== false) {
      // Ask outside allies once, for the original defender. Locked teammates
      // are already in the war and are skipped by `callForHelp`.
      this.callForHelp(targetId, aggressorId);
    }
  }

  /**
   * The actual war transition for one pair. Returns true when the pair
   * changed from non-war to war.
   */
  private declareWarPair(
    aggressorId: number,
    targetId: number,
    flags: { globalReputation: boolean; announce: boolean },
  ): boolean {
    const rel = this.getRelation(aggressorId, targetId);
    if (!rel || rel.status === 'war') return false;
    // You cannot declare war on someone you have never met.
    this.markContact(aggressorId, targetId);

    const previousStatus = rel.status;
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const turnsIntoStatus = roundNumber - rel.since;

    // The victim forms the strong opinion: how much this hurts depends on what
    // was broken and on how the victim's personality weighs betrayal. There is
    // no flat penalty any more — that was the SURPRISE_ATTACK_PENALTY pair.
    const event = warEventFor(previousStatus, turnsIntoStatus);
    this.recordImpactOn(rel, targetId, event, undefined,
      `war from ${previousStatus} after ${turnsIntoStatus} turn(s)`);

    // The aggressor's own opinion sours too, but far less: a loyal civ is
    // genuinely uneasy about attacking a former partner, a ruthless one is not.
    if (previousStatus === 'alliance' || previousStatus === 'ceasefire') {
      this.recordImpactOn(rel, aggressorId, event, undefined, 'our own aggression');
    }

    // Everyone else finds out: an attack on a civ they know hardens them
    // against the aggressor. This is how one war cascades into reputational
    // damage across the whole map, and it only touches civs that have met.
    // Locked teammates of either side are not "third parties": they are
    // already in the war and must not sour on their own ally.
    if (flags.globalReputation) {
      for (const third of this.gameEngine.civilizations ?? []) {
        if (third.id === aggressorId || third.id === targetId) continue;
        if (this.isTeammate(third.id, aggressorId) || this.isTeammate(third.id, targetId)) continue;
        if (third.isAlive === false || !this.hasContacted(third.id, aggressorId)) continue;
        if (!this.hasContacted(third.id, targetId)) continue;
        const heard = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
        const fear = this.estimateMilitaryStrength(aggressorId)
          / Math.max(1, this.estimateMilitaryStrength(third.id));
        const thirdRel = this.getRelation(third.id, aggressorId);
        if (!thirdRel) continue;
        applyImpact(thirdRel, third.id, 'surprise_attack',
          -Math.round(6 * (fear > 1.5 ? 1.5 : 0.5)), heard, `heard about the war on ${targetId}`);
      }
    }

    rel.status = 'war';
    rel.since = roundNumber;

    this.logEvent({
      type: 'war_declared',
      fromCivId: aggressorId,
      toCivId: targetId,
      details: `War declared (was: ${previousStatus})`,
    });

    if (flags.announce) {
      debugLog(`[DIPLOMACY] Civ ${aggressorId} declared war on Civ ${targetId}`);
      // The plain free-for-all payload stays exactly as it always was. Team
      // information is added only when fixed alliances are on, so existing
      // listeners (and the event contract) are untouched in normal games.
      const teams = this.gameEngine.teamManager;
      this.emitEvent('WAR_DECLARED', {
        aggressorId,
        targetId,
        ...(teams?.enabled
          ? {
              teamWar: true,
              aggressorTeamId: teams.getTeamId(aggressorId),
              targetTeamId: teams.getTeamId(targetId),
            }
          : {}),
      });
    }
    return true;
  }

  /**
   * Establish peace between two civilizations. In a fixed-alliance game every
   * pair between the two teams signs at once — a peace that left one teammate
   * still at war would be a contradiction.
   */
  makePeace(civA: number, civB: number): void {
    if (this.isTeammate(civA, civB)) return;
    for (const a of this.teamMembersOf(civA)) {
      for (const b of this.teamMembersOf(civB)) {
        if (this.isTeammate(a, b)) continue;
        this.makePeacePair(a, b);
      }
    }
  }

  private makePeacePair(civA: number, civB: number): boolean {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status === 'peace') return false;
    this.markContact(civA, civB);

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'peace';
    rel.since = roundNumber;
    // Marks the pair as having signed a peace, which arms the cooldown that
    // stops the "declare war the instant peace is signed" loop.
    rel.peaceSignedAt = roundNumber;

    // A signed peace is worth goodwill, scaled by how open the civ is — and
    // reaching it after a long war is worth more than a walkout.
    this.recordImpactOn(rel, civA, 'peace_made');
    this.recordImpactOn(rel, civB, 'peace_made');

    this.logEvent({
      type: 'peace_made',
      fromCivId: civA,
      toCivId: civB,
    });

    debugLog(`[DIPLOMACY] Peace between Civ ${civA} and Civ ${civB}`);
    this.emitEvent('PEACE_MADE', { civA, civB });
    return true;
  }

  /**
   * Establish a ceasefire. Like peace, this is team-wide in a fixed-alliance
   * game: a ceasefire with one member is a ceasefire with the alliance.
   */
  signCeasefire(civA: number, civB: number): void {
    if (this.isTeammate(civA, civB)) return;
    for (const a of this.teamMembersOf(civA)) {
      for (const b of this.teamMembersOf(civB)) {
        if (this.isTeammate(a, b)) continue;
        this.signCeasefirePair(a, b);
      }
    }
  }

  private signCeasefirePair(civA: number, civB: number): boolean {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status !== 'war') return false;
    this.markContact(civA, civB);

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'ceasefire';
    rel.since = roundNumber;

    this.recordImpactOn(rel, civA, 'ceasefire_signed');
    this.recordImpactOn(rel, civB, 'ceasefire_signed');

    this.logEvent({
      type: 'ceasefire_signed',
      fromCivId: civA,
      toCivId: civB,
    });

    debugLog(`[DIPLOMACY] Ceasefire between Civ ${civA} and Civ ${civB}`);
    this.emitEvent('CEASEFIRE_SIGNED', { civA, civB });
    return true;
  }

  /** Form alliance */
  formAlliance(civA: number, civB: number): void {
    // Locked teammates are already allied; re-assert the invariants instead of
    // emitting a redundant alliance event.
    if (this.isTeammate(civA, civB)) {
      this.applyTeamInvariants();
      return;
    }
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status === 'war') return;
    this.markContact(civA, civB);

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'alliance';
    rel.since = roundNumber;

    this.recordImpactOn(rel, civA, 'alliance_formed');
    this.recordImpactOn(rel, civB, 'alliance_formed');

    this.logEvent({
      type: 'alliance_formed',
      fromCivId: civA,
      toCivId: civB,
    });

    debugLog(`[DIPLOMACY] Alliance between Civ ${civA} and Civ ${civB}`);
    this.emitEvent('ALLIANCE_FORMED', { civA, civB });
  }

  // ─── Treaty management (beyond Civ 1) ──────────────────────────────

  /** Check if a specific treaty is active between two civs */
  hasTreaty(civA: number, civB: number, treaty: TreatyType): boolean {
    // Locked allies have open borders by definition, even if an older save
    // lost the treaty entry.
    if (this.isTeammate(civA, civB)
      && (treaty === 'open_borders' || treaty === 'mutual_defense')) {
      return true;
    }
    const rel = this.getRelation(civA, civB);
    return rel?.activeTreaties?.includes(treaty) ?? false;
  }

  /** Get all active treaties between two civs */
  getActiveTreaties(civA: number, civB: number): TreatyType[] {
    const treaties = [...(this.getRelation(civA, civB)?.activeTreaties ?? [])];
    if (this.isTeammate(civA, civB) && !treaties.includes('open_borders')) {
      treaties.push('open_borders');
    }
    return treaties;
  }

  /** Sign a treaty between two civs */
  signTreaty(civA: number, civB: number, treaty: TreatyType, extra?: { goldPerTurn?: number; targetCivId?: number; [key: string]: unknown }): void {
    // A locked teammate may not embargo another teammate; the rest of the
    // treaties are either already active (open borders/embassy) or harmless
    // (trade agreement).
    if (this.isTeammate(civA, civB)) {
      if (treaty === 'embargo_target') return;
      if (treaty === 'open_borders' || treaty === 'mutual_defense' || treaty === 'embassy') {
        this.applyTeamInvariants();
        return;
      }
    }
    const rel = this.getRelation(civA, civB);
    if (!rel) return;
    this.markContact(civA, civB);

    // Can't sign treaties while at war (except non-aggression after ceasefire)
    if (rel.status === 'war' && treaty !== 'non_aggression') return;

    // Don't duplicate
    if (rel.activeTreaties.includes(treaty)) return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.activeTreaties.push(treaty);
    rel.treatySince[treaty] = roundNumber;

    if (treaty === 'trade_agreement') {
      // Trade generates 2 gold/turn for both sides
      rel.tradeGoldPerTurn = extra?.goldPerTurn ?? 2;
    }
    if (treaty === 'embargo_target' && extra?.targetCivId !== undefined) {
      rel.embargoTargetCivId = extra.targetCivId;
    }

    const eventType = {
      open_borders: 'open_borders_signed',
      trade_agreement: 'trade_agreement_signed',
      mutual_defense: 'mutual_defense_signed',
      non_aggression: 'non_aggression_signed',
      embargo_target: 'embargo_declared',
      embassy: 'embassy_established',
    }[treaty] as DiplomacyEvent['type'];

    // Signing is a positive act, and which treaty it is decides how much it is
    // worth: a mercantile civ loves trade, a paranoid one is glad of a pact.
    const impactEvent: ImpactEvent = {
      open_borders: 'open_borders_signed',
      trade_agreement: 'trade_signed',
      mutual_defense: 'mutual_defense_signed',
      non_aggression: 'non_aggression_signed',
      embargo_target: 'embargo_signed',
      embassy: 'embassy_established',
    }[treaty] as ImpactEvent;
    const detail = treaty === 'embargo_target' ? `Embargo on Civ ${extra?.targetCivId}` : undefined;
    // The trade rate is part of the magnitude, so 2 gold/turn and 20 gold/turn
    // are not the same deal.
    const terms: ImpactTerms | undefined = treaty === 'trade_agreement'
      ? { gold: rel.tradeGoldPerTurn }
      : undefined;
    this.recordImpactOn(rel, civB, impactEvent, terms, detail);
    this.recordImpactOn(rel, civA, impactEvent, terms, detail);

    this.logEvent({
      type: eventType,
      fromCivId: civA,
      toCivId: civB,
      details: detail,
    });

    debugLog(`[DIPLOMACY] Treaty signed: ${treaty} between Civ ${civA} and Civ ${civB}`);
  }

  /** Cancel a treaty between two civs */
  cancelTreaty(civId: number, otherId: number, treaty: TreatyType): void {
    // The team lock includes open borders and the mutual-defence guarantee.
    // Trade agreements may still be renegotiated between teammates.
    if (this.isTeammate(civId, otherId) && TEAM_LOCKED_TREATIES.has(treaty)) {
      debugLog(`[DIPLOMACY] Refused to cancel locked team treaty ${treaty} between ${civId} and ${otherId}`);
      return;
    }
    const rel = this.getRelation(civId, otherId);
    if (!rel) return;

    const idx = rel.activeTreaties.indexOf(treaty);
    if (idx < 0) return;

    rel.activeTreaties.splice(idx, 1);
    delete rel.treatySince[treaty];

    if (treaty === 'trade_agreement') rel.tradeGoldPerTurn = 0;
    if (treaty === 'embargo_target') rel.embargoTargetCivId = undefined;

    // Walking out of a signed agreement costs goodwill, and it costs a loyal
    // civ considerably more than a cynical one.
    this.recordImpactOn(rel, otherId, 'treaty_cancelled', undefined, treaty);
    this.recordImpactOn(rel, civId, 'treaty_cancelled', undefined, treaty);

    this.logEvent({
      type: 'treaty_cancelled',
      fromCivId: civId,
      toCivId: otherId,
      details: `Cancelled ${treaty}`,
    });
  }

  /** Check if open borders allow passage */
  hasOpenBorders(civA: number, civB: number): boolean {
    if (this.isTeammate(civA, civB)) return true;
    return this.hasTreaty(civA, civB, 'open_borders');
  }


  // ─── Proposals (human or AI initiated) ─────────────────────────────

  /**
   * Gather everything a proposal's decision depends on. Shared by
   * `previewProposal` (so the UI can show the arithmetic before the player
   * commits) and `processProposal` (so the engine and the preview can never
   * disagree) — one model, two callers.
   */
  private proposalContext(proposal: DiplomacyProposal): ProposalContext {
    const { fromCivId, toCivId, action } = proposal;
    const rel = this.getRelation(toCivId, fromCivId);
    // Team strength, not one civ's: in a fixed-alliance game a proposal is
    // answered with the whole team's weight behind the responder, and judged
    // against the proposer's whole team. In free-for-all a team is one civ, so
    // this is identical to the per-civ estimate.
    const ownStrength = this.estimateTeamStrength(toCivId);
    const theirStrength = this.estimateTeamStrength(fromCivId);
    // "Share an enemy" is what gives an alliance its strategic value, and it is
    // the term the old flat −10 alliance penalty had no room for.
    const ownEnemies = new Set(this.getEnemies(toCivId));
    const sharedEnemy = this.getEnemies(fromCivId).some((e) => ownEnemies.has(e));
    const responderWeights = this.weightsFor(toCivId);
    return {
      responder: toCivId,
      proposer: fromCivId,
      action,
      // The RESPONDER's opinion of the proposer. (Not `getTheirOpinion`:
      // that is the reverse direction, and reading it here made every proposal
      // be judged on what the proposer thought of the responder.)
      opinion: rel ? readOpinion(rel, toCivId) : createOpinion(),
      weights: responderWeights,
      status: rel?.status ?? 'peace',
      treaties: rel?.activeTreaties ?? [],
      ownStrength,
      theirStrength,
      ownGold: this.gameEngine.civilizations?.[toCivId]?.resources?.gold ?? 0,
      goldAmount: proposal.goldAmount,
      sharedEnemy,
      // War capacity: a call for help is a request to open another front, and
      // the responder has to be able to answer it. Distinct enemy *teams*, so
      // a coalition war is one front, not three.
      activeWars: this.getEnemyTeamCount(toCivId),
      maxWars: maxConcurrentWars(responderWeights, this.gameEngine.currentYear),
      exhaustion: this.getWarExhaustion(toCivId),
      // The enemy a call to arms names, when the proposal names one: the ally
      // has to weigh whether it could win that war at all — against the enemy
      // team as a whole, not just the named civ.
      targetStrength: proposal.embargoTargetId !== undefined
        ? this.estimateTeamStrength(proposal.embargoTargetId)
        : undefined,
      round: this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      sequence: this.proposalSequence++,
    };
  }

  /**
   * The same arithmetic the engine uses, with the noise term left out, so the
   * negotiation screen can show a player exactly why a deal will or will not
   * land — including which term is doing the most damage.
   */
  previewProposal(proposal: DiplomacyProposal): ProposalEvaluation {
    return evaluateProposal(this.proposalContext(proposal), proposal, 0);
  }

  /**
   * Resolve a proposal. The decision is a readable score against a
   * personality-scaled bar plus ±5 points of seeded noise — not a fresh 0-100
   * roll — so the same terms at the same state are reliably answerable, a
   * 500-gold demand is treated differently from a 5-gold one, and refusing
   * costs the proposer something.
   */
  processProposal(proposal: DiplomacyProposal): DiplomacyResponse {
    const { fromCivId, toCivId, action } = proposal;
    // Negotiating with someone is how you meet them, if sight did not.
    this.markContact(fromCivId, toCivId);

    // Locked teammates can trade and share knowledge, but cannot threaten,
    // spy on or re-negotiate the alliance itself.
    if (this.isTeammate(fromCivId, toCivId)) {
      if (TEAM_HOSTILE_ACTIONS.has(action)) {
        return { accepted: false, reason: 'Locked allies cannot take hostile action against each other.' };
      }
      if (TEAM_REDUNDANT_ACTIONS.has(action)) {
        return { accepted: false, reason: 'You are already locked allies.' };
      }
      if (action === 'propose_embargo'
        && proposal.embargoTargetId !== undefined
        && this.isTeammate(fromCivId, proposal.embargoTargetId)) {
        return { accepted: false, reason: 'Locked allies cannot embargo each other.' };
      }
    }

    // Covert acts are not proposals: the victim is never consulted, so the
    // willingness roll would only produce a refusal nobody asked for. They
    // run through the espionage path (`inciteRevolt` and friends), which
    // resolves on its own seeded terms.
    if (ESPIONAGE_DIPLOMAT_ACTIONS.has(action)) {
      return { accepted: false, reason: 'Not a negotiable proposal' };
    }

    // Civ I: no Exchange of Knowledge while the guns are still firing —
    // refuse with a plain reason instead of burying it in the score. A gift of
    // technology is an exchange of the same kind, so it follows the same rule.
    if (action === 'offer_tech_exchange' || action === 'offer_tech_for_gold' || action === 'gift_technology') {
      const tradeRel = this.getRelation(fromCivId, toCivId);
      if (tradeRel?.status === 'war') {
        return { accepted: false, reason: 'They will not trade while the two of you are at war' };
      }
      // Civ I: an Exchange of Knowledge needs both diplomats physically
      // present — same tile or adjacent — not just a permanent contact flag.
      // The one exception is a deal made in person: a unit that walked up to
      // the other court's own doorstep carries the knowledge with it.
      if (!proposal.inPerson && !this.hasDiplomatContact(fromCivId, toCivId)) {
        return { accepted: false, reason: 'No diplomat contact' };
      }
      // A swap where either side already knows the tech is not a swap.
      const { techOffered, techRequested } = proposal;
      const fromTechs = this.gameEngine.civilizations?.[fromCivId]?.technologies;
      const toTechs = this.gameEngine.civilizations?.[toCivId]?.technologies;
      if (techOffered && toTechs?.includes(techOffered)) {
        return { accepted: false, reason: 'You already have this technology' };
      }
      if (techRequested && fromTechs?.includes(techRequested)) {
        return { accepted: false, reason: 'They already have this technology' };
      }
    }

    const ctx = this.proposalContext(proposal);
    const evaluation = evaluateProposal(ctx, proposal, proposalNoise(ctx, fromCivId));
    const rel = this.getRelation(toCivId, fromCivId);

    debugLog(
      `[DIPLOMACY] Proposal: ${action} from Civ ${fromCivId} to Civ ${toCivId}, `
      + `score=${evaluation.score} vs threshold=${evaluation.threshold} `
      + `noise=${evaluation.noise} → ${evaluation.accepted ? 'accepted' : 'refused'} `
      + `(${evaluation.decisiveFactor})`,
    );

    if (rel) noteOffer(rel, toCivId, ctx.round);

    if (!evaluation.accepted) {
      // Refusing is remembered, so proposal spam is self-defeating: each
      // refusal makes the next one less likely to land.
      if (rel) recordRefusal(rel, toCivId, ctx.round);
      // An AI ignores a peace offer it does not want, and takes it personally.
      if ((action === 'propose_peace' || action === 'propose_ceasefire') && rel) {
        this.recordImpactOn(rel, fromCivId, 'refused_peace', undefined,
          `our ${action.replace(/_/g, ' ')} was turned down`);
      }
      // Refusing a call for help breaks the alliance.
      if (action === 'call_for_help' && rel) {
        this.recordImpactOn(rel, fromCivId, 'ally_abandoned', undefined, 'refused call for help');
        if (rel.activeTreaties.includes('mutual_defense')) {
          this.cancelTreaty(toCivId, fromCivId, 'mutual_defense');
        }
        this.logEvent({
          type: 'call_for_help_sent',
          fromCivId,
          toCivId,
          details: `Civ ${toCivId} refused the call for help`,
        });
      }
      const counter = this.generateCounterProposal(fromCivId, toCivId, action, this.getAttitude(toCivId, fromCivId));
      this.logEvent({
        type: 'treaty_rejected',
        fromCivId,
        toCivId,
        details: `${action} rejected (${evaluation.decisiveFactor})${counter ? ' (counter-proposal offered)' : ''}`,
      });
      return {
        accepted: false,
        reason: rejectionReason(evaluation, ctx.opinion),
        counterProposal: counter ?? undefined,
      };
    }

    // An accepted offer clears the refusal memory — the proposer has paid
    // attention at last.
    if (rel) {
      readOpinion(rel, toCivId).offersRefused = 0;
    }

    return this.executeAcceptedAction(proposal);
  }

  /**
   * Execute an AI-initiated proposal that the human player explicitly accepted
   * in the negotiation screen. Unlike `processProposal` there is no scoring
   * pass at all — the player's accept/reject decision IS the answer.
   */
  acceptOffer(proposal: DiplomacyProposal): DiplomacyResponse {
    const { fromCivId, action } = proposal;
    debugLog(`[DIPLOMACY] Player accepted ${action} from Civ ${fromCivId}`);
    return this.executeAcceptedAction(proposal);
  }

  /**
   * Apply the effects of an accepted proposal (shared by `processProposal` —
   * where the AI's willingness roll decided — and `acceptOffer` — where the
   * human decided).
   */
  private executeAcceptedAction(proposal: DiplomacyProposal): DiplomacyResponse {
    const { fromCivId, toCivId, action, goldAmount } = proposal;

    // `acceptOffer` bypasses the scoring pass, so the team lock has to be
    // re-checked here as well. This is the last gate before the switch.
    if (this.isTeammate(fromCivId, toCivId)) {
      if (TEAM_HOSTILE_ACTIONS.has(action)) {
        return { accepted: false, reason: 'Locked allies cannot take hostile action against each other.' };
      }
      if (TEAM_REDUNDANT_ACTIONS.has(action)) {
        return { accepted: false, reason: 'You are already locked allies.' };
      }
      if (action === 'propose_embargo'
        && proposal.embargoTargetId !== undefined
        && this.isTeammate(fromCivId, proposal.embargoTargetId)) {
        return { accepted: false, reason: 'Locked allies cannot embargo each other.' };
      }
    }

    switch (action) {
      case 'propose_peace':
        this.makePeace(fromCivId, toCivId);
        return { accepted: true };

      case 'propose_ceasefire':
        this.signCeasefire(fromCivId, toCivId);
        return { accepted: true };

      case 'propose_alliance':
        this.formAlliance(fromCivId, toCivId);
        return { accepted: true };

      case 'demand_tribute': {
        const demanded = goldAmount ?? 50;
        const targetCiv = this.gameEngine.civilizations?.[toCivId];
        const fromCiv = this.gameEngine.civilizations?.[fromCivId];
        const available = targetCiv?.resources?.gold ?? 0;
        const paid = Math.min(demanded, available);

        if (targetCiv?.resources) targetCiv.resources.gold -= paid;
        if (fromCiv?.resources) fromCiv.resources.gold += paid;

        // Being milked is remembered: the payer likes the extractor less, and
        // the size of the payment scales the insult. A 20-gold exaction is an
        // annoyance; a 400-gold one shapes the next twenty turns of diplomacy.
        const tributeRel = this.getRelation(toCivId, fromCivId);
        if (tributeRel) {
          this.recordImpactOn(tributeRel, toCivId, 'tribute_extorted',
            { gold: paid }, `${paid} gold`);
          // The extractor gets no credit for it — this is not a gift.
          this.recordImpactOn(tributeRel, fromCivId, 'tribute_extorted',
            { gold: paid }, `we took ${paid} gold`);
        }

        this.logEvent({
          type: 'tribute_paid',
          fromCivId: toCivId,
          toCivId: fromCivId,
          goldAmount: paid,
        });
        return { accepted: true, goldTransferred: paid };
      }

      case 'gift_gold': {
        const amount = goldAmount ?? 0;
        if (amount <= 0) return { accepted: false, reason: 'No gold specified' };
        if (!this.canAffordGold(fromCivId, amount)) {
          return { accepted: false, reason: 'You cannot afford that gift' };
        }
        this.transferGold(fromCivId, toCivId, amount);
        const giftRel = this.getRelation(toCivId, fromCivId);
        if (giftRel) {
          // Both ledgers move: the receiver likes the giver, and the giver's
          // own court records the generosity (which counts as keeping a word).
          this.recordImpactOn(giftRel, toCivId, 'tribute_gift',
            { gold: amount }, `${amount} gold gift`);
          this.recordImpactOn(giftRel, fromCivId, 'tribute_gift',
            { gold: amount }, `gave ${amount} gold`);
        }
        this.logEvent({
          type: 'gold_transferred',
          fromCivId,
          toCivId,
          goldAmount: amount,
          details: `Gift of ${amount} gold`,
        });
        // Sign convention: positive means the money went TO the proposer.
        return { accepted: true, goldTransferred: -amount };
      }

      case 'request_gold': {
        const amount = goldAmount ?? 0;
        if (amount <= 0) return { accepted: false, reason: 'No gold specified' };
        if (!this.canAffordGold(toCivId, amount)) {
          return { accepted: false, reason: 'They cannot afford that request' };
        }
        this.transferGold(toCivId, fromCivId, amount);
        const requestRel = this.getRelation(toCivId, fromCivId);
        if (requestRel) {
          // A payment made under duress is remembered as tribute; one made out
          // of friendship is remembered as a kindness. Which of the two it was
          // is decided by the balance of power, not by the amount.
          if (this.isCoercedPayment(fromCivId, toCivId)) {
            this.recordImpactOn(requestRel, toCivId, 'tribute_extorted',
              { gold: amount }, `${amount} gold paid to avoid trouble`);
            this.recordImpactOn(requestRel, fromCivId, 'tribute_extorted',
              { gold: amount }, `we took ${amount} gold`);
          } else {
            this.recordImpactOn(requestRel, toCivId, 'tribute_gift',
              { gold: amount }, `${amount} gold given to a friend`);
          }
        }
        this.logEvent({
          type: 'gold_transferred',
          fromCivId: toCivId,
          toCivId: fromCivId,
          goldAmount: amount,
          details: `Request of ${amount} gold`,
        });
        return { accepted: true, goldTransferred: amount };
      }

      case 'call_for_help': {
        const aggressorId = proposal.embargoTargetId;
        if (aggressorId === undefined) return { accepted: false, reason: 'No aggressor specified' };
        // The ALLY joins the war — the defender is already in it, so it is the
        // responder that has to take up arms against the aggressor. The war
        // does not call for further help: the call is one ring deep.
        this.declareWar(toCivId, aggressorId, { propagateCalls: false });
        const helpRel = this.getRelation(toCivId, fromCivId);
        if (helpRel) {
          // An ally that answered the call is an ally that kept its word.
          this.recordImpactOn(helpRel, fromCivId, 'common_enemy_defeated',
            undefined, `answered our call for help against ${aggressorId}`);
        }
        this.logEvent({
          type: 'call_for_help_accepted',
          fromCivId: toCivId,
          toCivId: aggressorId,
          details: `Civ ${toCivId} answered the call for help`,
        });
        return { accepted: true };
      }

      case 'gather_intelligence':
        return { accepted: true };

      case 'offer_open_borders':
        this.signTreaty(fromCivId, toCivId, 'open_borders');
        return { accepted: true };

      case 'propose_trade_agreement':
        this.signTreaty(fromCivId, toCivId, 'trade_agreement', { goldPerTurn: goldAmount ?? 2 });
        return { accepted: true };

      case 'propose_mutual_defense':
        this.signTreaty(fromCivId, toCivId, 'mutual_defense');
        return { accepted: true };

      case 'propose_non_aggression':
        this.signTreaty(fromCivId, toCivId, 'non_aggression');
        return { accepted: true };

      case 'establish_embassy':
        this.signTreaty(fromCivId, toCivId, 'embassy');
        return { accepted: true };

      case 'propose_embargo': {
        const target = proposal.embargoTargetId;
        if (target === undefined) return { accepted: false, reason: 'No embargo target specified' };
        this.signTreaty(fromCivId, toCivId, 'embargo_target', { targetCivId: target });
        return { accepted: true };
      }

      case 'offer_tech_exchange':
      case 'offer_tech_for_gold': {
        const { techOffered, techRequested } = proposal;
        const sweetener = Math.max(0, Math.floor(goldAmount ?? 0));
        if (!techOffered && !techRequested) return { accepted: false, reason: 'Must specify at least one technology' };

        // Civ I rule: no Exchange of Knowledge while at war.
        const tradeRel = this.getRelation(fromCivId, toCivId);
        if (tradeRel?.status === 'war') {
          return { accepted: false, reason: 'They will not trade while the two of you are at war' };
        }

        // Both diplomats must still be standing together — the player may have
        // accepted the offer after the units moved apart. A deal made in
        // person does not need that: the messenger is already there.
        if (!proposal.inPerson && !this.hasDiplomatContact(fromCivId, toCivId)) {
          return { accepted: false, reason: 'No diplomat contact' };
        }

        const fromCiv = this.gameEngine.civilizations?.[fromCivId];
        const toCiv = this.gameEngine.civilizations?.[toCivId];
        // Engine civs store technologies as a string[] (Set methods would throw).
        const fromTechs = fromCiv?.technologies;
        const toTechs = toCiv?.technologies;
        // Verify each side has what it claims — either side may be absent when
        // gold covers its half of the deal (tech-for-gold).
        const fromHas = !techOffered || (!!fromTechs && fromTechs.includes(techOffered));
        const toHas = !techRequested || (!!toTechs && toTechs.includes(techRequested));
        if (!fromHas) return { accepted: false, reason: 'You do not have the offered technology' };
        if (!toHas) return { accepted: false, reason: 'They do not have the requested technology' };
        // A technology is only ever handed to a civ that does not know it yet —
        // otherwise the deal is a gift of nothing at all.
        if (techOffered && toTechs?.includes(techOffered)) {
          return { accepted: false, reason: 'They already have this technology' };
        }
        if (techRequested && fromTechs?.includes(techRequested)) {
          return { accepted: false, reason: 'You already have this technology' };
        }
        // An outright ask for free knowledge is refused — knowledge has a price.
        if (techRequested && !techOffered && sweetener <= 0) {
          return { accepted: false, reason: 'They will not give away free technology' };
        }

        // WHO pays the gold. In a swap the proposer sweetens the deal and the
        // money runs to the responder. In a one-sided exchange the money is
        // the PRICE of the knowledge, so it runs the other way — to whoever
        // hands the technology over. Without this a "tech for money" deal
        // would have the buyer paying the seller.
        const responderPays = goldPayerFor({ techOffered, techRequested }) === 'responder';
        const payerId = responderPays ? toCivId : fromCivId;
        const payeeId = responderPays ? fromCivId : toCivId;
        const payerCiv = this.gameEngine.civilizations?.[payerId];
        // A sweetener must be real money, not a promise.
        if (sweetener > 0 && (payerCiv?.resources?.gold ?? 0) < sweetener) {
          return {
            accepted: false,
            reason: responderPays
              ? 'They cannot afford the price you are asking'
              : 'You cannot afford the gold you offered',
          };
        }
        // Exchange: each side learns what the other knew. A technology is only
        // ever handed over to a civ that does not know it yet.
        if (techRequested && fromTechs && !fromTechs.includes(techRequested)) fromTechs.push(techRequested);
        if (techOffered && toTechs && !toTechs.includes(techOffered)) toTechs.push(techOffered);
        if (sweetener > 0) this.transferGold(payerId, payeeId, sweetener);
        // Refresh the shared tree UI so newly learned techs light up.
        this.gameEngine.updateTechnologyAvailability?.();
        // A fair swap is one of the few unambiguously good acts in the game.
        const exchangeRel = this.getRelation(toCivId, fromCivId);
        if (exchangeRel) {
          const terms = [techOffered, techRequested].filter(Boolean).join(' ↔ ')
            + (sweetener > 0 ? ` + ${sweetener} gold` : '');
          // A free one-sided gift is recorded as a gift of knowledge, not a
          // trade — the two move goodwill very differently.
          const impactEvent = (sweetener === 0 && techOffered && !techRequested)
            ? 'tech_gift' : 'tech_exchanged';
          this.recordImpactOn(exchangeRel, toCivId, impactEvent,
            { tech: true, gold: sweetener }, terms);
          this.recordImpactOn(exchangeRel, fromCivId, impactEvent,
            { tech: true, gold: sweetener }, terms);
        }
        this.logEvent({
          type: (sweetener === 0 && techOffered && !techRequested) ? 'tech_gifted' : 'tech_exchanged',
          fromCivId,
          toCivId,
          details: [techOffered, techRequested].filter(Boolean).join(' ↔ ')
            + (sweetener > 0 ? ` + ${sweetener} gold` : ''),
        });
        // Sign convention: positive means the money went TO the proposer.
        return { accepted: true, goldTransferred: sweetener > 0 ? (responderPays ? sweetener : -sweetener) : undefined };
      }

      case 'gift_technology': {
        const techId = proposal.techOffered;
        if (!techId) return { accepted: false, reason: 'Name a technology to give' };
        const giftTradeRel = this.getRelation(fromCivId, toCivId);
        if (giftTradeRel?.status === 'war') {
          return { accepted: false, reason: 'They will not trade while the two of you are at war' };
        }
        // Knowledge is only ever handed over face to face.
        if (!proposal.inPerson && !this.hasDiplomatContact(fromCivId, toCivId)) {
          return { accepted: false, reason: 'No diplomat contact' };
        }
        const giver = this.gameEngine.civilizations?.[fromCivId];
        const receiver = this.gameEngine.civilizations?.[toCivId];
        const giverTechs = giver?.technologies;
        const receiverTechs = receiver?.technologies;
        if (!giverTechs?.includes(techId)) {
          return { accepted: false, reason: 'You do not have the technology to give' };
        }
        // A gift of something the receiver already knows is no gift at all.
        if (receiverTechs?.includes(techId)) {
          return { accepted: false, reason: 'They already have this technology' };
        }
        receiverTechs?.push(techId);
        this.gameEngine.updateTechnologyAvailability?.();
        // A gift of knowledge is the one act that buys goodwill without buying
        // anything back — so it is worth a great deal to the receiver.
        const giftRel = this.getRelation(toCivId, fromCivId);
        if (giftRel) {
          const terms = { tech: true, techValue: this.techCost(techId) };
          this.recordImpactOn(giftRel, toCivId, 'technology_gifted', terms, `gift of ${techId}`);
          this.recordImpactOn(giftRel, fromCivId, 'technology_gifted', terms, `we gave ${techId}`);
        }
        this.logEvent({
          type: 'tech_gifted',
          fromCivId,
          toCivId,
          details: techId,
          techId,
        });
        return { accepted: true };
      }

      case 'propose_joint_war': {
        const enemyId = proposal.embargoTargetId;
        if (typeof enemyId !== 'number' || enemyId === fromCivId || enemyId === toCivId) {
          return { accepted: false, reason: 'Name the common enemy' };
        }
        // The responder declares war on the enemy; Civ I cascade (allies of the
        // defender) is handled by the existing declareWar path. A call to arms
        // is one ring deep, though: joining a friend's war does not set off
        // another round of calls.
        if (this.getRelation(toCivId, enemyId)?.status !== 'war') {
          this.declareWar(toCivId, enemyId, { propagateCalls: false });
        }
        const rel = this.getRelation(toCivId, fromCivId);
        if (rel) this.recordImpactOn(rel, fromCivId, 'common_enemy_defeated', { thirdParty: true }, 'called to arms');
        this.logEvent({ type: 'war_declared', fromCivId: toCivId, toCivId: enemyId, details: 'joint war called' });
        return { accepted: true };
      }

      case 'offer_gift': {
        const gift = Math.max(0, Math.floor(goldAmount ?? 0));
        if (gift <= 0) return { accepted: false, reason: 'Name an amount of gold to give' };
        const fromCiv = this.gameEngine.civilizations?.[fromCivId];
        const toCiv = this.gameEngine.civilizations?.[toCivId];
        if ((fromCiv?.resources?.gold ?? 0) < gift) {
          return { accepted: false, reason: 'You cannot afford that gift' };
        }
        if (fromCiv?.resources) fromCiv.resources.gold -= gift;
        if (toCiv?.resources) toCiv.resources.gold += gift;
        // Goodwill in both ledgers: the receiver likes the giver, and the
        // giver's own court records the generosity (keepsWord counts it).
        const giftRel = this.getRelation(toCivId, fromCivId);
        if (giftRel) {
          this.recordImpactOn(giftRel, toCivId, 'tribute_gift',
            { gold: gift }, `${gift} gold`);
          this.recordImpactOn(giftRel, fromCivId, 'tribute_gift',
            { gold: gift }, `gave ${gift} gold`);
        }
        this.logEvent({
          type: 'tribute_paid',
          fromCivId,
          toCivId,
          goldAmount: gift,
        });
        return { accepted: true, goldTransferred: -gift };
      }

      default:
        return { accepted: false, reason: 'Unknown action' };
    }
  }

  /**
   * Passively isEmbassy: the embassy gives a standing (and slightly stale)
   * view of the other court — much coarser than an active gatherIntelligence
   * run and entirely legal, so it never risks detection but likewise updates
   * only when the embassy (or a spy) refreshes it.
   */
  getEmbassyReport(viewerCivId: number, targetCivId: number): IntelligenceReport | null {
    if (!this.hasEmbassy(viewerCivId, targetCivId)) return null;
    return this.gatherIntelligence(viewerCivId, targetCivId);
  }

  /** Generate an intelligence report on a civilization */
  gatherIntelligence(spyCivId: number, targetCivId: number): IntelligenceReport {
    const civ = this.gameEngine.civilizations?.[targetCivId];
    const cities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === targetCivId) ?? [];
    const military = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === targetCivId && (u.attack || 0) > 0
    ) ?? [];

    // Spying used to be free and consequence-free. It still works, but a
    // suspicious civ may notice, and being caught writes a real negative
    // impact — up to 3× for the most paranoid. Deterministic per (spy, target,
    // round) so a replay matches.
    const round = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const paranoia = this.weightsFor(targetCivId).paranoia;
    const detectionChance = SPY_DETECTION_BASE + (paranoia - 5) * 8;
    const noticed = seededNoise([spyCivId, targetCivId, 'spy', round]) * 50 + 50 < detectionChance;
    const spyRel = this.getRelation(targetCivId, spyCivId);
    if (noticed && spyRel) {
      this.recordImpactOn(spyRel, targetCivId, 'spy_detected', undefined, 'our diplomat');
      this.logEvent({
        type: 'intelligence_gathered',
        fromCivId: spyCivId,
        toCivId: targetCivId,
        details: 'Caught in the act',
      });
    }

    this.logEvent({
      type: 'intelligence_gathered',
      fromCivId: spyCivId,
      toCivId: targetCivId,
    });

    return {
      civId: targetCivId,
      civName: civ?.name ?? 'Unknown',
      gold: civ?.resources?.gold ?? 0,
      numCities: cities.length,
      numMilitaryUnits: military.length,
      currentResearch: civ?.currentResearch?.id ?? null,
      government: civ?.government ?? 'despotism',
      attitude: this.getAttitude(targetCivId, spyCivId),
    };
  }

  /**
   * Attempt to bribe an enemy unit with a diplomat.
   *
   * Three seeded outcomes, all reproducible for the same attempt at the same
   * moment:
   *  - DEFECT: the unit takes the gold and switches sides (war follows);
   *  - REPORTED: the commander takes the gold and reports the offer — no unit
   *    changes hands, the money is still gone, and the insult lands on the
   *    owner's diplomatic ledger (`bribe_exposed`);
   *  - REFUSED: the commander refuses quietly — no gold, no trace.
   */
  bribeUnit(diplomatCivId: number, targetUnitId: string): DiplomacyResponse {
    const unit = this.gameEngine.units?.find((u: Unit) => u.id === targetUnitId);
    if (!unit) return { accepted: false, reason: 'Unit not found' };
    if (unit.civilizationId === diplomatCivId) return { accepted: false, reason: 'Cannot bribe own unit' };
    if (this.isTeammate(diplomatCivId, unit.civilizationId)) {
      return { accepted: false, reason: 'Locked allies cannot bribe each other' };
    }

    const cost = bribeUnitCost(unit);
    const fromCiv = this.gameEngine.civilizations?.[diplomatCivId];
    const gold = fromCiv?.resources?.gold ?? 0;

    if (gold < cost) {
      return { accepted: false, reason: `Requires ${cost} gold (have ${gold})` };
    }

    // Bribe success: 60% base, tilted by how the unit's owner feels about us
    // (morale in a hostile civ, loyalty in a friendly one) and made harsher by
    // the target's suspicion. Seeded, so the same bribe attempt at the same
    // moment always resolves the same way.
    const ownerOpinion = this.getTheirOpinion(diplomatCivId, unit.civilizationId);
    let chance = 60;
    chance += (ownerOpinion.goodwill < -20 ? 20 : ownerOpinion.goodwill > 20 ? -20 : 0);
    chance += (this.weightsFor(unit.civilizationId).paranoia - 5) * 2;
    const round = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const roll = seededNoise([diplomatCivId, unit.civilizationId, targetUnitId, 'bribe', round]) * 50 + 50;
    const outcome = bribeOutcomeForRoll(roll, chance);

    const originalCivId = unit.civilizationId;

    if (outcome === 'refused') {
      // Quiet refusal: the gold stays in the treasury and nobody learns
      // anything — the diplomat may simply try again elsewhere.
      this.emitEvent('BRIBE_REFUSED', {
        diplomatCivId, unitId: targetUnitId, originalCivId, cost, unitType: unit.type,
      });
      return { accepted: false, reason: 'Bribe failed — the unit refused' };
    }

    // From here the gold is on the table: both remaining outcomes take it.
    fromCiv.resources.gold -= cost;

    if (outcome === 'reported') {
      // The offer went straight up the chain of command. No unit changes
      // hands, but the attempt is caught red-handed and written down — a
      // smaller sting than losing the unit, and a lasting insult besides.
      const rel = this.getRelation(originalCivId, diplomatCivId);
      if (rel) {
        this.recordImpactOn(rel, originalCivId, 'bribe_exposed',
          { gold: cost }, unit.type);
      }
      this.logEvent({
        type: 'bribe_reported',
        fromCivId: diplomatCivId,
        toCivId: originalCivId,
        goldAmount: cost,
        details: `Bribe attempt on ${unit.type} reported`,
      });
      debugLog(`[DIPLOMACY] Civ ${diplomatCivId}'s bribe of unit ${targetUnitId} was reported`);
      // `originalCivId` routes the notification to the human when it was
      // THEIR commander who took the money and reported it.
      this.emitEvent('BRIBE_REPORTED', {
        diplomatCivId, unitId: targetUnitId, originalCivId, cost, unitType: unit.type,
      });
      return {
        accepted: false,
        reason: `Bribe exposed — the ${unit.type}'s commander took the gold and reported the offer`,
        goldTransferred: -cost,
      };
    }

    // Defected: transfer the unit.
    unit.civilizationId = diplomatCivId;
    unit.movesRemaining = 0;

    // Bribing is a hostile act — declare war automatically (Civ1 behaviour).
    const targetCiv = this.gameEngine.civilizations?.[originalCivId];
    if (targetCiv) {
      this.declareWar(diplomatCivId, originalCivId);
    }

    // Losing a unit to bribery is a humiliation, and it stings hardest for a
    // civ that takes loyalty seriously.
    const bribeRel = this.getRelation(originalCivId, diplomatCivId);
    if (bribeRel) {
      this.recordImpactOn(bribeRel, originalCivId, 'unit_bribed',
        { gold: cost }, unit.type);
    }

    this.logEvent({
      type: 'unit_bribed',
      fromCivId: diplomatCivId,
      toCivId: originalCivId,
      goldAmount: cost,
      details: `Bribed ${unit.type}`,
    });

    debugLog(`[DIPLOMACY] Civ ${diplomatCivId} bribed unit ${targetUnitId} for ${cost} gold`);
    // `originalCivId` is included so the UI can route the notification to the
    // human when it was THEIR unit that was bought out.
    this.emitEvent('UNIT_BRIBED', { diplomatCivId, unitId: targetUnitId, originalCivId, cost });
    return { accepted: true, goldTransferred: -cost };
  }

  // ─── Espionage: embassies, city infiltration, tech theft ──────────

  /**
   * Whether an embassy exists between two civs. An embassy is what turns a
   * first contact into a working diplomatic channel: without one the
   * negotiation screen shows the rival but keeps every button locked.
   */
  hasEmbassy(civA: number, civB: number): boolean {
    if (civA === civB) return true;
    if (this.isTeammate(civA, civB)) return true;
    return this.embassyPairs.has(this.key(civA, civB));
  }

  /** Every counterpart the civ has an embassy with (for the UI's roster). */
  getEmbassyCivs(civId: number): number[] {
    const result: number[] = [];
    for (const key of this.embassyPairs) {
      const [a, b] = key.split('_').map(Number);
      if (a === civId) result.push(b);
      else if (b === civId) result.push(a);
    }
    return result;
  }

  /** Serialize embassy pairs (for save/load). */
  exportEmbassyPairs(): string[] {
    return Array.from(this.embassyPairs);
  }

  restoreEmbassyPairs(pairs: string[]): void {
    this.embassyPairs = new Set(pairs);
  }

  /** A diplomat presents its credentials: an embassy is founded. */
  establishEmbassy(diplomatCivId: number, targetCivId: number): EspionageResult {
    if (this.isAtWar(diplomatCivId, targetCivId)) {
      return this.announce({ success: false, outcome: 'embassy_refused', reason: 'At war' }, diplomatCivId, targetCivId);
    }
    if (this.hasEmbassy(diplomatCivId, targetCivId)) {
      return this.announce(
        { success: false, outcome: 'embassy_already', reason: 'Embassy already established' },
        diplomatCivId,
        targetCivId,
      );
    }
    this.embassyPairs.add(this.key(diplomatCivId, targetCivId));
    this.logEvent({
      type: 'embassy_established',
      fromCivId: diplomatCivId,
      toCivId: targetCivId,
    });
    // The UI keeps its own mirror of the embassy list so the negotiation
    // screen unlocks the moment the diplomat reports success.
    this.emitEvent('EMBASSY_ESTABLISHED', { civA: diplomatCivId, civB: targetCivId });
    return this.announce({ success: true, outcome: 'embassy_established' }, diplomatCivId, targetCivId);
  }

  /**
   * Infiltrate a city and steal ONE technology — a random one of the techs the
   * owner knows and we do not, picked blind (Civ I: the player never chooses).
   *
   * Stealing is not a quiet act: Civ I always blows the diplomat's cover, and
   * the victim declares war on the spot. Getting caught BEFORE the theft is
   * worse — the secrets stay home and the diplomat is lost all the same.
   */
  stealTechnology(diplomatCivId: number, targetCivId: number): EspionageResult {
    if (this.isAtWar(diplomatCivId, targetCivId)) {
      return this.announce(
        { success: false, outcome: 'caught_stealing', reason: 'At war' },
        diplomatCivId,
        targetCivId,
      );
    }
    const pool = this.getTechTradeOptions(diplomatCivId, targetCivId).theyHaveWeLack;
    if (pool.length === 0) {
      return this.announce(
        { success: false, outcome: 'nothing_to_steal', reason: 'Nothing left to learn' },
        diplomatCivId,
        targetCivId,
      );
    }

    const caught = this.spyDetection(diplomatCivId, targetCivId, 'steal', STEAL_DETECTION_BASE);
    if (caught) {
      const warDeclared = this.blowCover(diplomatCivId, targetCivId, 'spy_detected', 'caught stealing');
      return this.announce(
        { success: false, outcome: 'caught_stealing', coverBlown: true, warDeclared, reason: 'Caught in the act' },
        diplomatCivId,
        targetCivId,
      );
    }

    const techId = pool[Math.floor(Math.random() * pool.length)];
    // The victim finds out anyway: a stolen secret is discovered eventually,
    // and Civ I makes that discovery immediate.
    const warDeclared = this.blowCover(diplomatCivId, targetCivId, 'technology_stolen', `stole ${techId}`);
    this.logEvent({
      type: 'technology_stolen',
      fromCivId: diplomatCivId,
      toCivId: targetCivId,
      details: techId,
    });
    return this.announce(
      { success: true, outcome: 'stolen', techId, coverBlown: true, warDeclared },
      diplomatCivId,
      targetCivId,
    );
  }

  /**
   * Announce an espionage outcome to whoever is watching.
   *
   * The operative's own side already has the result in hand — it is the return
   * value of `executeDiplomatAction`, which the human's UI turns into its
   * report window. The *victim* has nothing: an AI diplomat that steals from
   * the player would otherwise be a silent event, and the player would only
   * notice the war declaration. So the event carries both civ ids and the
   * router decides which side (if any) needs telling.
   */
  private announce(result: EspionageResult, operativeCivId: number, targetCivId: number): EspionageResult {
    this.emitEvent('ESPIONAGE_RESULT', {
      operativeCivId,
      targetCivId,
      outcome: result.outcome,
      success: result.success,
      techId: result.techId,
      coverBlown: result.coverBlown ?? false,
      warDeclared: result.warDeclared ?? false,
      cityId: result.cityId,
      cityName: result.cityName,
      city: result.report ? {
        name: result.report.cityName,
        population: result.report.population,
        production: result.report.production,
      } : undefined,
    });
    return result;
  }

  /** Read a city from the inside: production, buildings, population. */
  investigateCity(diplomatCivId: number, city: City): EspionageResult {
    const report: CityIntelligence = {
      cityId: city.id,
      cityName: city.name,
      population: city.population ?? 0,
      buildings: city.buildings ? [...city.buildings] : [],
      production: city.currentProduction?.name ?? null,
      productionProgress: city.productionProgress ?? 0,
      ownerCivId: city.civilizationId,
    };
    this.logEvent({
      type: 'intelligence_gathered',
      fromCivId: diplomatCivId,
      toCivId: city.civilizationId,
      details: `Investigated ${city.name}`,
    });
    return this.announce(
      { success: true, outcome: 'city_investigated', cityId: city.id, cityName: city.name, report },
      diplomatCivId,
      city.civilizationId,
    );
  }

  /**
   * Sabotage a city's industry: the accumulated shields are lost, and a city
   * with nothing to destroy is set back to a single unit's worth of work.
   * Getting caught costs the diplomat and starts a war.
   */
  industrialSabotage(diplomatCivId: number, city: City): EspionageResult {
    if (this.isAtWar(diplomatCivId, city.civilizationId)) {
      return this.announce(
        { success: false, outcome: 'caught_sabotaging', reason: 'At war', cityId: city.id, cityName: city.name },
        diplomatCivId,
        city.civilizationId,
      );
    }
    const caught = this.spyDetection(diplomatCivId, city.civilizationId, 'sabotage', SABOTAGE_DETECTION_BASE);
    if (caught) {
      const warDeclared = this.blowCover(diplomatCivId, city.civilizationId, 'spy_detected', 'caught sabotaging');
      return this.announce(
        {
          success: false,
          outcome: 'caught_sabotaging',
          coverBlown: true,
          warDeclared,
          cityId: city.id,
          cityName: city.name,
          reason: 'Caught in the act',
        },
        diplomatCivId,
        city.civilizationId,
      );
    }

    city.productionProgress = 0;
    const rel = this.getRelation(city.civilizationId, diplomatCivId);
    if (rel) {
      this.recordImpactOn(rel, city.civilizationId, 'city_sabotaged', undefined, city.name);
    }
    this.logEvent({
      type: 'city_sabotaged',
      fromCivId: diplomatCivId,
      toCivId: city.civilizationId,
      details: city.name,
    });
    return this.announce(
      { success: true, outcome: 'sabotaged', cityId: city.id, cityName: city.name },
      diplomatCivId,
      city.civilizationId,
    );
  }

  /**
   * Covert act: bribe a foreign city into revolt.
   *
   * The purse is carried by the agent and spent up front — 100 gold per
   * citizen — whether the town rises or the offer is carried to its
   * governor's desk instead. The capital is immune: gold may buy a restless
   * province, never the rival's seat of government. Success flips the city
   * and puts the two civs openly at war; being caught is an act of espionage
   * like any other (the agent's career ends, and usually a war begins).
   *
   * Deterministic per (city, round): the same agent pitching the same town
   * on the same turn always resolves the same way.
   */
  inciteRevolt(diplomatCivId: number, city: City): EspionageResult {
    const victimId = city.civilizationId;
    if (this.isAtWar(diplomatCivId, victimId)) {
      return this.announce(
        { success: false, outcome: 'incite_impossible', reason: 'At war', cityId: city.id, cityName: city.name },
        diplomatCivId,
        victimId,
      );
    }
    if (city.isCapital === true) {
      return this.announce(
        {
          success: false, outcome: 'incite_impossible',
          reason: 'A capital cannot be incited', cityId: city.id, cityName: city.name,
        },
        diplomatCivId,
        victimId,
      );
    }
    const cost = 100 * Math.max(1, city.population ?? 1);
    const fromCiv = this.gameEngine.civilizations?.[diplomatCivId];
    if ((fromCiv?.resources?.gold ?? 0) < cost) {
      return this.announce(
        {
          success: false, outcome: 'incite_impossible',
          reason: `Incitement costs ${cost} gold`, cityId: city.id, cityName: city.name,
        },
        diplomatCivId,
        victimId,
      );
    }
    // Paid up front — the agent carries the purse, success or not.
    if (fromCiv?.resources) fromCiv.resources.gold -= cost;

    // Deterministic chance: 30% − 10% per garrison unit, floored at 0.
    const garrison = (this.gameEngine.units ?? []).filter(
      (u) => u.civilizationId === victimId && u.col === city.col && u.row === city.row,
    ).length;
    const roll = (this.gameEngine.roundManager?.getRoundNumber?.() ?? 0) % 100;
    const chance = Math.max(0, 30 - garrison * 10);

    if (roll < chance) {
      city.civilizationId = diplomatCivId;
      city.capturedTurns = 5;
      this.markContact(diplomatCivId, victimId);
      const rel = this.getRelation(diplomatCivId, victimId);
      if (rel) {
        this.recordImpactOn(rel, victimId, 'city_sabotaged', { gold: cost }, 'incited revolt');
      }
      // Buying a city off its owner is an act of war in all but name.
      if (!this.isAtWar(diplomatCivId, victimId)) {
        this.declareWar(diplomatCivId, victimId);
      }
      this.logEvent({
        type: 'city_sabotaged',
        fromCivId: diplomatCivId,
        toCivId: victimId,
        goldAmount: cost,
        details: `${city.name} incited into revolt`,
      });
      return this.announce(
        { success: true, outcome: 'city_revolted', cityId: city.id, cityName: city.name },
        diplomatCivId,
        victimId,
      );
    }

    // Caught: the offer goes straight to the governor's desk.
    const warDeclared = this.blowCover(diplomatCivId, victimId, 'spy_detected', 'caught inciting revolt');
    return this.announce(
      {
        success: false, outcome: 'caught_inciting', coverBlown: true, warDeclared,
        reason: 'Our agent was caught', cityId: city.id, cityName: city.name,
      },
      diplomatCivId,
      victimId,
    );
  }

  /**
   * Seeded detection roll for an infiltration attempt. Deterministic per
   * (operative, target, kind, round) so a replay resolves identically, and
   * scaled by how paranoid the victim is.
   */
  private spyDetection(
    diplomatCivId: number,
    targetCivId: number,
    kind: string,
    base: number,
  ): boolean {
    const round = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    const paranoia = this.weightsFor(targetCivId).paranoia;
    const chance = Math.max(5, Math.min(90, base + (paranoia - 5) * 6));
    return seededNoise([diplomatCivId, targetCivId, kind, round]) * 50 + 50 < chance;
  }

  /**
   * The target learns what happened and declares war on the spy's civ (Civ I:
   * a caught agent is an act of war). Returns whether war was declared — false
   * when the two were already fighting.
   */
  private blowCover(
    diplomatCivId: number,
    targetCivId: number,
    event: ImpactEvent,
    detail: string,
  ): boolean {
    const alreadyAtWar = this.isAtWar(diplomatCivId, targetCivId);
    const rel = this.getRelation(targetCivId, diplomatCivId);
    if (rel) this.recordImpactOn(rel, targetCivId, event, undefined, detail);
    if (alreadyAtWar) return false;
    this.declareWar(targetCivId, diplomatCivId);
    return true;
  }

  // ─── Turn processing ───────────────────────────────────────────────

  /**
   * Called once per round: ledgers settle, fear tracks the balance of power,
   * and treaties do their work.
   *
   * The old version "recovered reputation toward 0" by 1/turn, which meant a
   * -50 alliance betrayal had fully evaporated in 50 turns and left no trace.
   * Grievance now decays slowly and independently of goodwill, so a betrayal
   * is never fully forgiven by arithmetic — only by a later good act.
   */
  processTurn(roundNumber: number): void {
    const round = roundNumber || this.gameEngine.roundManager?.getRoundNumber?.() || 0;
    for (const rel of this.relations.values()) {
      for (const holder of [rel.civA, rel.civB]) {
        const opinion = readOpinion(rel, holder);
        // Slow, partial healing: a civ never forgets entirely, it just stops
        // being the first thing on its mind.
        opinion.grievance = Math.max(0, opinion.grievance - GRIEVANCE_DECAY_PER_TURN);
        // Fear follows the balance of power and fades when the threat recedes.
        // This is what lets a shrinking rival be courted again, and what makes
        // an expanding one dangerous even without a single battle.
        const theirId = holder === rel.civA ? rel.civB : rel.civA;
        const ratio = this.estimateMilitaryStrength(theirId)
          / Math.max(1, this.estimateMilitaryStrength(holder));
        const target = Math.max(0, Math.min(100, (ratio - 1.1) * 70));
        opinion.fear += (target - opinion.fear) * 0.25;
      }

      // Cities pressed against the border sour relations slowly and
      // permanently — this used to be recomputed inside every attitude read,
      // which was both expensive and invisible.
      if (!this.isTeammate(rel.civA, rel.civB)
        && this.hasContacted(rel.civA, rel.civB)
        && this.minCityDistance(rel.civA, rel.civB) <= 4) {
        this.recordImpactOn(rel, rel.civB, 'border_pressure', undefined, 'cities on the border');
      }

      // A trade agreement is worth something (it doubles the trade of the
      // routes between the two civs — `EconomicManager.routeTrade`), but it
      // used to also pay a flat stipend to BOTH sides every round, minted from
      // nothing. That was an unbounded faucet: a civ with no cities and 6 gold
      // of lifetime tax income finished a 400-round game holding 271 gold. The
      // stipend is gone; the route multiplier is the benefit. `tradeGoldPerTurn`
      // is kept on the relation for save compatibility and is no longer paid.
      if (rel.tradeGoldPerTurn > 0) rel.tradeGoldPerTurn = 0;

      // Mutual defence, with consent. This used to read "if my ally is at war,
      // join it" unconditionally, which turned any single war into a
      // continent-wide one. An ally now weighs it: a beaten ally whose enemy
      // outclasses them both is not worth a second front.
      if (!this.isTeammate(rel.civA, rel.civB)
        && rel.activeTreaties.includes('mutual_defense')
        && rel.status !== 'war') {
        for (const [ally, partner] of [[rel.civA, rel.civB], [rel.civB, rel.civA]] as const) {
          for (const enemy of this.getEnemies(partner)) {
            if (enemy === ally || this.isAtWar(ally, enemy)) continue;
            const decision = shouldHonourMutualDefence(this.policyContext(ally, enemy, rel, round));
            if (decision.honour) {
              debugLog(`[DIPLO] Civ ${ally} honours its pact with ${partner} vs ${enemy} (${decision.why})`);
              this.declareWar(ally, enemy);
            } else {
              // Being left to fight alone is remembered by the abandoned ally.
              debugLog(`[DIPLO] Civ ${ally} declines to aid ${partner} vs ${enemy} (${decision.why})`);
              this.recordImpactOn(rel, partner, 'ally_abandoned', undefined, `war with ${enemy}`);
            }
          }
        }
      }

      // War invalidates open borders and trade
      if (rel.status === 'war') {
        const toRemove = rel.activeTreaties.filter(t => t !== 'embargo_target');
        for (const t of toRemove) {
          const idx = rel.activeTreaties.indexOf(t);
          if (idx >= 0) rel.activeTreaties.splice(idx, 1);
          delete rel.treatySince[t];
        }
        rel.tradeGoldPerTurn = 0;
      }
    }

    // War wear. Fighting a war costs, being at peace heals, and the total
    // drives both the AI's appetite for another war and its desire for terms.
    for (const c of this.gameEngine.civilizations ?? []) {
      if (c.isHuman || c.isAlive === false || c.id < 0) continue;
      const fightingSomething = this.getEnemies(c.id).length > 0;
      const next = this.getWarExhaustion(c.id)
        + exhaustionDelta(fightingSomething ? 'war' : 'peace', false);
      this.warExhaustion.set(c.id, Math.max(0, Math.min(EXHAUSTION_MAX, next)));
    }
  }

  /** Closest pair of cities between two civs, or Infinity when either is empty. */
  private minCityDistance(civA: number, civB: number): number {
    const aCities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === civA) ?? [];
    const bCities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === civB) ?? [];
    if (aCities.length === 0 || bCities.length === 0) return Infinity;
    let min = Infinity;
    for (const a of aCities) {
      for (const b of bCities) {
        const d = this.gameEngine.squareGrid?.squareDistance?.(a.col, a.row, b.col, b.row) ?? Infinity;
        if (d < min) min = d;
      }
    }
    return min;
  }

  /**
   * The two one-sided tech lists Civ I's Exchange of Knowledge screen shows:
   * what they know that you do not, and what you know that they do not.
   * Both are filtered to *met* civs by the caller — the engine never leaks
   * an unmet civ's research.
   */
  getTechTradeOptions(fromCivId: number, toCivId: number): {
    theyHaveWeLack: string[];
    weHaveTheyLack: string[];
  } {
    const fromTechs = this.gameEngine.civilizations?.[fromCivId]?.technologies ?? [];
    const toTechs = this.gameEngine.civilizations?.[toCivId]?.technologies ?? [];
    return {
      theyHaveWeLack: toTechs.filter((t: string) => !fromTechs.includes(t)),
      weHaveTheyLack: fromTechs.filter((t: string) => !toTechs.includes(t)),
    };
  }

  /**
   * Whether an Exchange of Knowledge is even possible between two civs
   * (contact made, not at war, both sides hold something the other lacks).
   */
  canTradeTechs(fromCivId: number, toCivId: number): { ok: boolean; reason?: string } {
    if (!this.hasContacted(fromCivId, toCivId)) {
      return { ok: false, reason: 'No contact yet' };
    }
    const rel = this.getRelation(fromCivId, toCivId);
    if (rel?.status === 'war') {
      return { ok: false, reason: 'At war' };
    }
    // Contact is not enough: both civs need a diplomat in physical proximity.
    if (!this.hasDiplomatContact(fromCivId, toCivId)) {
      return { ok: false, reason: 'No diplomat contact' };
    }
    const opts = this.getTechTradeOptions(fromCivId, toCivId);
    if (opts.theyHaveWeLack.length === 0 || opts.weHaveTheyLack.length === 0) {
      return { ok: false, reason: 'Nothing to swap' };
    }
    return { ok: true };
  }

  /**
   * Pick a Civ I swap the proposing civ actually benefits from.
   *
   * This used to be mechanical — hand over the cheapest thing we hold, ask for
   * the dearest thing they hold. That picks a *pair*, but never asks whether
   * the trade leaves us better off: giving away Iron Working for Alphabet
   * looked like a fair swap simply because Alphabet was the thing we lacked.
   * The trade is now scored by `TechTradeEvaluator` (what we receive minus what
   * we give, each weighted by what that kind of knowledge is worth to us right
   * now), and returns null when nothing on offer clears the civ's margin.
   */
  pickTechSwap(fromCivId: number, toCivId: number): { techOffered: string; techRequested: string } | null {
    const opts = this.getTechTradeOptions(fromCivId, toCivId);
    const pick = wouldProposeExchange(opts.weHaveTheyLack, opts.theyHaveWeLack, this.tradeContext(fromCivId, toCivId));
    return pick ? pick.proposal : null;
  }

  /**
   * The technology to hand over in a GIFT of knowledge: the most valuable one
   * we hold that the other court does not. A gift is worth what it saves the
   * receiver, so the dearest secret is the most generous one to give away.
   */
  pickTechGiftTerm(fromCivId: number, toCivId: number): { techOffered?: string } {
    const opts = this.getTechTradeOptions(fromCivId, toCivId);
    if (opts.weHaveTheyLack.length === 0) return {};
    const techOffered = opts.weHaveTheyLack.reduce(
      (best, id) => (this.techCost(id) > this.techCost(best) ? id : best),
      opts.weHaveTheyLack[0],
    );
    return { techOffered };
  }

  /**
   * The terms of a knowledge-for-money deal: either we sell a secret they
   * lack, or we buy one they hold, priced at the research cost of the
   * technology — the one figure both courts can compute without haggling.
   *
   * Which side of the deal this civ takes is decided by where it stands in
   * the learning race: a civ that is ahead can afford to sell, and one that
   * is behind wants to buy.
   */
  pickTechForGoldTerm(fromCivId: number, toCivId: number): {
    techOffered?: string;
    techRequested?: string;
    goldAmount?: number;
  } {
    const opts = this.getTechTradeOptions(fromCivId, toCivId);
    const ourCount = this.gameEngine.civilizations?.[fromCivId]?.technologies?.length ?? 0;
    const theirCount = this.gameEngine.civilizations?.[toCivId]?.technologies?.length ?? 0;
    const ourGold = this.gameEngine.civilizations?.[fromCivId]?.resources?.gold ?? 0;

    // Ahead in learning: our spare knowledge is worth more to them than to
    // us, so it is the one we sell.
    if (ourCount > theirCount && opts.weHaveTheyLack.length > 0) {
      const techOffered = opts.weHaveTheyLack.reduce(
        (best, id) => (this.techCost(id) < this.techCost(best) ? id : best),
        opts.weHaveTheyLack[0],
      );
      return { techOffered, goldAmount: this.techCost(techOffered) };
    }
    // Behind: we want what they know, and a secret has a price. Only offer a
    // purchase the treasury can actually pay for.
    if (opts.theyHaveWeLack.length > 0) {
      const techRequested = opts.theyHaveWeLack.reduce(
        (best, id) => (this.techCost(id) > this.techCost(best) ? id : best),
        opts.theyHaveWeLack[0],
      );
      const price = this.techCost(techRequested);
      if (ourGold >= price) return { techRequested, goldAmount: price };
    }
    // Whatever we can spare beats nothing at all.
    if (opts.weHaveTheyLack.length > 0) {
      const techOffered = opts.weHaveTheyLack.reduce(
        (best, id) => (this.techCost(id) < this.techCost(best) ? id : best),
        opts.weHaveTheyLack[0],
      );
      return { techOffered, goldAmount: this.techCost(techOffered) };
    }
    return {};
  }

  /**
   * The AI's preferred one-sided knowledge deal (swap first, then sale, then
   * gift), or null when nothing is worth tabling.
   */
  aiTechDealTerms(fromCivId: number, toCivId: number): {
    kind: 'swap' | 'purchase' | 'sale' | 'gift';
    techOffered?: string;
    techRequested?: string;
    goldAmount?: number;
  } | null {
    const opts = this.getTechTradeOptions(fromCivId, toCivId);
    const civ = this.gameEngine.civilizations?.[fromCivId];
    const ourGold = civ?.resources?.gold ?? 0;

    // 1. Swap first.
    const swap = this.pickTechSwap(fromCivId, toCivId);
    if (swap) {
      return { kind: 'swap', techOffered: swap.techOffered, techRequested: swap.techRequested };
    }

    // 2. Sale: a thin treasury motivates selling a secret they lack.
    if (opts.weHaveTheyLack.length > 0 && ourGold < 100) {
      const techOffered = opts.weHaveTheyLack.reduce(
        (best, id) => (this.techCost(id) < this.techCost(best) ? id : best),
        opts.weHaveTheyLack[0],
      );
      const price = this.techCost(techOffered);
      return { kind: 'sale', techOffered, goldAmount: price };
    }

    // 3. Gift: overwhelming goodwill motivates giving a secret away.
    if (opts.weHaveTheyLack.length > 0) {
      const techOffered = opts.weHaveTheyLack.reduce(
        (best, id) => (this.techCost(id) < this.techCost(best) ? id : best),
        opts.weHaveTheyLack[0],
      );
      const goodwill = this.getAttitudeScore(fromCivId, toCivId);
      if (goodwill >= 60) {
        return { kind: 'gift', techOffered };
      }
    }

    // 4. Purchase: we are behind, have nothing to offer, and can afford what they know.
    if (opts.weHaveTheyLack.length === 0 && opts.theyHaveWeLack.length > 0) {
      const techRequested = opts.theyHaveWeLack.reduce(
        (best, id) => (this.techCost(id) > this.techCost(best) ? id : best),
        opts.theyHaveWeLack[0],
      );
      const price = this.techCost(techRequested);
      if (ourGold >= price) {
        return { kind: 'purchase', techRequested, goldAmount: price };
      }
    }

    return null;
  }

  /**
   * The facts `TechTradeEvaluator` needs to price a trade for this civ. Built
   * here so the human-facing preview and the AI's own deliberation ask the
   * identical question.
   */
  tradeContext(civId: number, otherId: number): TechTradeContext {
    // A team bargains with the whole alliance's weight, not one member's.
    const own = this.estimateTeamStrength(civId);
    const theirs = this.estimateTeamStrength(otherId);
    return {
      civId,
      otherId,
      weights: this.weightsFor(civId),
      status: this.getStatus(civId, otherId),
      exhaustion: this.getWarExhaustion(civId),
      ourTechCount: this.gameEngine.civilizations?.[civId]?.technologies?.length ?? 0,
      theirTechCount: this.gameEngine.civilizations?.[otherId]?.technologies?.length ?? 0,
      // Floor of 1 so a civ with no army is not read as infinitely weak.
      strengthRatio: own / Math.max(theirs, 1),
      round: this.gameEngine.roundManager?.getRoundNumber?.() ?? 0,
      sequence: this.proposalSequence++,
    };
  }

  /**
   * Build the policy context for one pairing. Shared by the AI's own
   * deliberation and by the mutual-defence check, so both apply the same
   * capacity, exhaustion and cooldown rules.
   */
  private policyContext(
    civId: number,
    otherId: number,
    rel: DiplomaticRelation,
    round: number,
  ): PolicyContext {
    const weights = this.weightsFor(civId);
    const ownEnemies = new Set(this.getEnemies(civId));
    const sharedEnemy = this.getEnemies(otherId).some((e) => ownEnemies.has(e));
    // A SIGNED peace has to have had time to become a habit before it can be
    // thrown away — this is the gate that stops declare-war-the-instant-peace-
    // is-signed, which the old code only penalised after the fact. Pairs that
    // have never signed one are unrestricted, so turn-one conquest still works.
    const statusSince = rel.since;
    const roundsSincePeace = rel.status === 'war'
      ? Infinity
      : (rel.peaceSignedAt === undefined ? Infinity : round - rel.peaceSignedAt);
    const tradeOpts = this.getTechTradeOptions(civId, otherId);
    return {
      civId,
      otherId,
      weights,
      opinion: readOpinion(rel, civId),
      // Locked teammates are always allied, whatever the stored relation says.
      status: this.getStatus(civId, otherId),
      treaties: this.getActiveTreaties(civId, otherId),
      // Team strength, not one civ's: an AI must not attack a three-civ
      // alliance believing it faces a single opponent.
      ownStrength: this.estimateTeamStrength(civId),
      theirStrength: this.estimateTeamStrength(otherId),
      ownGold: this.gameEngine.civilizations?.[civId]?.resources?.gold ?? 0,
      theirGold: this.gameEngine.civilizations?.[otherId]?.resources?.gold ?? 0,
      // Distinct enemy teams: a coalition war is one front, not three.
      activeWars: this.getEnemyTeamCount(civId),
      maxWars: maxConcurrentWars(weights, this.gameEngine.currentYear),
      teammate: this.isTeammate(civId, otherId),
      exhaustion: this.getWarExhaustion(civId),
      turnsSince: round - statusSince,
      roundsSincePeace,
      sharedEnemy,
      round,
      sequence: this.proposalSequence++,
      currentYear: this.gameEngine.currentYear ?? -4000,
      techsWeCanOffer: tradeOpts.weHaveTheyLack,
      techsWeWant: tradeOpts.theyHaveWeLack,
      // How far ahead each side already is — the trade evaluator uses it to
      // decide whether a court can afford to be generous.
      ourTechCount: this.gameEngine.civilizations?.[civId]?.technologies?.length ?? 0,
      theirTechCount: this.gameEngine.civilizations?.[otherId]?.technologies?.length ?? 0,
      // No working channel, no Exchange of Knowledge: the AI waits for the
      // player (or one of its own diplomats) to found an embassy first — and
      // the two diplomats have to be standing together for knowledge to
      // change hands at all.
      hasEmbassy: this.hasEmbassy(civId, otherId),
      hasDiplomatContact: this.hasDiplomatContact(civId, otherId),
    };
  }

  /**
   * The same policy context, built for a pair whether or not a relation record
   * already exists.
   *
   * AI diplomat units deliberate with it: a diplomat that walks up to a court
   * has to weigh the same terms the per-turn pass weighs, or "the AI uses the
   * abilities correctly" would only be true of the abilities that happen to be
   * in both ladders.
   */
  policyContextFor(civId: number, otherId: number): PolicyContext | null {
    const rel = this.getRelation(civId, otherId);
    if (!rel) return null;
    return this.policyContext(civId, otherId, rel, this.gameEngine.roundManager?.getRoundNumber?.() ?? 0);
  }

  /**
   * War-time call to arms: ask the friends to join the current war.
   *
   * The civ picks its MAIN enemy (the one holding the most cities under
   * dispute) and asks every ally / mutual-defence partner to join against
   * it — the player through the audience modal, AIs through the ordinary
   * proposal machinery, where the joint-war scoring (goodwill, shared enemy,
   * power ratio) decides. A fresh ask per (caller, friend, enemy) triple may
   * be made every {@link CALL_TO_ARMS_COOLDOWN} rounds.
   */
  private considerCallToArms(civId: number, civName: string, roundNumber: number): void {
    const enemies = this.getEnemies(civId);
    if (enemies.length === 0) return;

    const citiesOf = (id: number): City[] =>
      (this.gameEngine.cities ?? []).filter((c) => c.civilizationId === id);
    // The main enemy: the one under dispute holding the most cities.
    const enemyId = enemies.reduce(
      (best, id) => (citiesOf(id).length > citiesOf(best).length ? id : best),
      enemies[0],
    );
    const enemyCiv = this.gameEngine.civilizations?.[enemyId];
    if (!enemyCiv || enemyCiv.isAlive === false) return;

    for (const otherId of this.getAllies(civId)) {
      if (otherId === civId) continue;
      // Locked teammates are already in the war; asking them to join would
      // only spam the audience modal.
      if (this.isTeammate(civId, otherId)) continue;
      const otherCiv = this.gameEngine.civilizations?.[otherId];
      if (!otherCiv || otherCiv.isAlive === false) continue;
      if (!this.hasContacted(civId, otherId)) continue;

      const key = `${civId}:${otherId}:${enemyId}`;
      const askedAt = this.callToArmsAsked.get(key);
      if (askedAt !== undefined && roundNumber - askedAt < CALL_TO_ARMS_COOLDOWN) continue;
      this.callToArmsAsked.set(key, roundNumber);

      const enemyName = enemyCiv.name ?? 'their enemy';
      const message = `${civName} calls on you to join its war against ${enemyName}.`;
      debugLog(`[AI-DIPLO] Civ ${civId} calls ${otherId} to arms against ${enemyId}`);
      if (otherCiv.isHuman === true) {
        this.emitOffer(civId, otherId, 'propose_joint_war', undefined, message,
          undefined, undefined, enemyId);
      } else {
        this.processProposal({
          fromCivId: civId, toCivId: otherId, action: 'propose_joint_war', embargoTargetId: enemyId,
        });
      }
    }
  }

  /**
   * AI deliberation: score every action worth taking toward this counterpart
   * and act on the best one.
   *
   * The previous version was an if/else ladder whose only real decision was
   * `aggression >= 4 && strengthRatio >= 1.6` — which is why diplomacy felt
   * uniformly aggressive and random. Actions are now scored from the same
   * ledger the human is judged by, gated on war capacity and exhaustion, and
   * the reasoning is logged so behaviour can be asserted in tests.
   */
  processAIDiplomacy(civId: number): void {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ || civ.isHuman) return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    if (roundNumber % AI_DIPLOMACY_INTERVAL !== 0 && roundNumber > 1) return;

    const civName = civ.name ?? `Civilization ${civId}`;

    // A civ at war calls on its friends BEFORE it does anything else on the
    // diplomatic round: every ally and mutual-defence partner is asked to
    // join against the enemy holding the most cities under dispute. Player
    // targets answer through the audience modal; AIs answer through the same
    // proposal machinery, so the joint-war scoring decides — an AI never
    // starts a war for free, only for a friend it likes and can afford.
    this.considerCallToArms(civId, civName, roundNumber);

    for (const rel of this.getRelationsForCiv(civId)) {
      const otherId = rel.otherCivId;
      const otherCiv = this.gameEngine.civilizations?.[otherId];
      if (!otherCiv || otherCiv.isAlive === false) continue;
      // No negotiating with someone you have never met.
      if (!this.hasContacted(civId, otherId)) continue;

      const source = this.getRelation(civId, otherId);
      if (!source) continue;
      const ctx = this.policyContext(civId, otherId, source, roundNumber);
      const isPlayerTarget = otherCiv.isHuman === true;

      // Locked teammates may still trade, share knowledge and give gifts, but
      // never threaten, spy on, embargo or re-negotiate the alliance itself.
      const teammate = this.isTeammate(civId, otherId);
      const candidates = scoreCandidates(ctx).filter((candidate) => {
        if (!teammate) return true;
        if (candidate.action === 'declare_war' || candidate.action === 'break_alliance') return false;
        // `DiplomaticCandidate.action` is a plain string by design (the AI
        // policy is engine-free); the membership sets are typed.
        const action = candidate.action as DiplomatAction;
        if (TEAM_HOSTILE_ACTIONS.has(action)) return false;
        if (TEAM_REDUNDANT_ACTIONS.has(action)) return false;
        return true;
      });
      const chosen = chooseAction(candidates, ctx);
      if (!chosen) continue;

      debugLog(
        `[AI-DIPLO] Civ ${civId} → ${otherId}: ${chosen.action} `
        + `(${chosen.score}, because ${chosen.because})`,
      );

      switch (chosen.action) {
        case 'declare_war':
          // Ask our allies to join the offensive before we commit.
          this.callForOffense(civId, otherId);
          this.declareWar(civId, otherId);
          if (isPlayerTarget) {
            this.emitEvent('DIPLOMACY_EVENT', { message: `${civName} has declared WAR on you!` });
          }
          break;

        case 'break_alliance': {
          this.declareWar(civId, otherId);
          this.logEvent({
            type: 'alliance_broken',
            fromCivId: civId,
            toCivId: otherId,
            details: chosen.because,
          });
          this.emitEvent('ALLIANCE_BROKEN', { civA: civId, civB: otherId });
          if (isPlayerTarget) {
            this.emitEvent('DIPLOMACY_EVENT', {
              message: `${civName} has BROKEN the alliance and declared war on you!`,
            });
          }
          break;
        }

        case 'demand_tribute': {
          // Ask for a share of their income, capped by what they plausibly have.
          const demand = Math.max(25, Math.min(400,
            Math.floor((ctx.theirStrength === 0 ? 0 : ctx.ownStrength / Math.max(1, ctx.theirStrength)) * 20)));
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'demand_tribute', demand, `${civName} demands ${demand} gold as tribute.`);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'demand_tribute', goldAmount: demand });
          }
          break;
        }

        case 'establish_embassy': {
          // Not a negotiation — a channel being opened. Nobody is asked,
          // because an embassy is not a concession: it is the civ saying "we
          // will have an address here". Both sides' screens unlock from the
          // EMBASSY_ESTABLISHED event the manager emits.
          this.establishEmbassy(civId, otherId);
          break;
        }

        case 'offer_open_borders':
        case 'propose_trade_agreement':
        case 'propose_alliance':
        case 'propose_ceasefire':
        case 'propose_peace':{
          const action = chosen.action as DiplomatAction;
          const message = AI_OFFER_MESSAGES[action]?.(civName)
            ?? `${civName} proposes ${action.replace(/_/g, ' ')}.`;
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, action, undefined, message);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action });
          }
          break;
        }

        case 'offer_tech_exchange': {
          const deal = this.aiTechDealTerms(civId, otherId);
          if (!deal) break;
          // Only table it when the two peoples are actually standing
          // together — otherwise the offer would be refused on arrival.
          if (!this.hasUnitContact(civId, otherId)) break;
          const techName = (id: string): string =>
            TECHNOLOGIES_DATA.find((t) => t.id === id)?.name ?? id;
          const message = deal.kind === 'sale'
            ? `${civName} offers to sell you ${techName(deal.techOffered ?? '')} for ${deal.goldAmount} gold.`
            : deal.kind === 'purchase'
              ? `${civName} offers to buy ${techName(deal.techRequested ?? '')} from you for ${deal.goldAmount} gold.`
              : deal.kind === 'gift'
                ? `${civName} offers you the secrets of ${techName(deal.techOffered ?? '')} — freely, asking nothing in return.`
                : `${civName} offers an Exchange of Knowledge: `
                  + `their ${techName(deal.techRequested ?? '')} for your ${techName(deal.techOffered ?? '')}.`;
          if (isPlayerTarget) {
            this.emitOffer(
              civId, otherId, 'offer_tech_exchange', deal.goldAmount, message,
              deal.techOffered, deal.techRequested,
            );
          } else {
            this.processProposal({
              fromCivId: civId,
              toCivId: otherId,
              action: 'offer_tech_exchange',
              techOffered: deal.techOffered,
              techRequested: deal.techRequested,
              goldAmount: deal.goldAmount,
            });
          }
          break;
        }

        case 'offer_tech_for_gold': {
          // Knowledge for money. The terms decide which side of the deal this
          // civ is on: it either sells a secret the other lacks, or buys one
          // it wants.
          const terms = this.pickTechForGoldTerm(civId, otherId);
          if (!terms.techOffered && !terms.techRequested) break;
          if (!this.hasDiplomatContact(civId, otherId)) break;
          const techName = (id: string): string =>
            TECHNOLOGIES_DATA.find((t) => t.id === id)?.name ?? id;
          const message = terms.techOffered
            ? `${civName} offers its knowledge of ${techName(terms.techOffered)} for ${terms.goldAmount} gold.`
            : `${civName} offers ${terms.goldAmount} gold for its knowledge of ${techName(terms.techRequested ?? '')}.`;
          if (isPlayerTarget) {
            this.emitOffer(
              civId, otherId, 'offer_tech_for_gold', terms.goldAmount, message,
              terms.techOffered, terms.techRequested,
            );
          } else {
            this.processProposal({
              fromCivId: civId,
              toCivId: otherId,
              action: 'offer_tech_for_gold',
              goldAmount: terms.goldAmount,
              techOffered: terms.techOffered,
              techRequested: terms.techRequested,
            });
          }
          break;
        }

        case 'gift_technology': {
          // A gift of knowledge: no money changes hands, and the receiver's
          // opinion of the giver improves enormously.
          const terms = this.pickTechGiftTerm(civId, otherId);
          if (!terms.techOffered) break;
          if (!this.hasDiplomatContact(civId, otherId)) break;
          const techName = (id: string): string =>
            TECHNOLOGIES_DATA.find((t) => t.id === id)?.name ?? id;
          const message = `${civName} offers its knowledge of ${techName(terms.techOffered)} as a gift.`;
          if (isPlayerTarget) {
            this.emitOffer(
              civId, otherId, 'gift_technology', undefined, message,
              terms.techOffered, undefined,
            );
          } else {
            this.processProposal({
              fromCivId: civId,
              toCivId: otherId,
              action: 'gift_technology',
              techOffered: terms.techOffered,
            });
          }
          break;
        }

        case 'gift_gold': {
          // Give a modest gift scaled by what we can spare and how they feel.
          const ourGold = ctx.ownGold;
          const giftAmount = Math.max(10, Math.min(200, Math.floor(ourGold * 0.1)));
          const message = `${civName} offers a gift of ${giftAmount} gold.`;
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'gift_gold', giftAmount, message);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'gift_gold', goldAmount: giftAmount });
          }
          break;
        }

        case 'request_gold': {
          // Request gold scaled by how much we think they'll part with — and
          // by WHY they will part with it. A friend gives a little out of
          // goodwill; a rival that has been threatened gives a great deal
          // more, and that is the whole point of the threat.
          const theirGold = ctx.theirGold ?? 0;
          const friendly = ctx.opinion.goodwill > 30;
          const threatening = ctx.ownStrength > ctx.theirStrength * 2;
          const share = friendly ? 0.15 : threatening ? 0.4 : 0.25;
          const requestAmount = Math.max(10, Math.min(400, Math.floor(theirGold * share)));
          const message = `${civName} requests ${requestAmount} gold.`;
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'request_gold', requestAmount, message);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'request_gold', goldAmount: requestAmount });
          }
          break;
        }

        default:
          break;
      }
    }
  }

  /**
   * Surface a negotiable AI proposal to the human player. The proposal is NOT
   * auto-resolved: the engine event carries it to the UI, which opens the
   * negotiation screen so the player can accept (via acceptOffer) or reject.
   */
  private emitOffer(
    fromCivId: number,
    toCivId: number,
    action: DiplomatAction,
    goldAmount: number | undefined,
    message: string,
    techOffered?: string,
    techRequested?: string,
    /** Third-party civ this proposal names (joint war target, embargo enemy). */
    targetId?: number,
    /** The two units met face to face, so no diplomat has to cross over. */
    inPerson?: boolean,
  ): void {
    debugLog(`[AI-DIPLO] Offering ${action} to human Civ ${toCivId}`);
    this.emitEvent('AI_DIPLOMACY_OFFER', {
      fromCivId,
      toCivId,
      action,
      goldAmount,
      techOffered,
      techRequested,
      embargoTargetId: targetId,
      inPerson,
      message,
    });
  }

  /**
   * Public wrapper around `emitOffer` used by AI diplomat units: when an AI
   * diplomat makes contact with the human, its proposal is surfaced as an
   * interactive offer (AI_DIPLOMACY_OFFER) instead of being auto-resolved.
   */
  presentOffer(
    fromCivId: number,
    toCivId: number,
    action: DiplomatAction,
    goldAmount: number | undefined,
    message: string,
    techOffered?: string,
    techRequested?: string,
    targetId?: number,
    inPerson?: boolean,
  ): void {
    // A civ cannot negotiate with someone it has never met. Visibility normally
    // records this; asserting it here keeps the invariant airtight.
    this.markContact(fromCivId, toCivId);
    this.emitOffer(
      fromCivId, toCivId, action, goldAmount, message,
      techOffered, techRequested, targetId, inPerson,
    );
  }

  // ─── Gold transfer helpers ─────────────────────────────────────────

  /** Whether a civ can afford to part with the given amount of gold. */
  private canAffordGold(civId: number, amount: number): boolean {
    const civ = this.gameEngine.civilizations?.[civId];
    return (civ?.resources?.gold ?? 0) >= amount;
  }

  /** Transfer gold from one civ to another. */
  private transferGold(fromId: number, toId: number, amount: number): void {
    const fromCiv = this.gameEngine.civilizations?.[fromId];
    const toCiv = this.gameEngine.civilizations?.[toId];
    if (fromCiv?.resources) fromCiv.resources.gold -= amount;
    if (toCiv?.resources) toCiv.resources.gold += amount;
  }

  /**
   * Whether a payment was made under duress rather than out of goodwill.
   *
   * The same request for money means two very different things depending on
   * why it was granted: a court that parts with its gold because it likes the
   * asker is making a gift, and one that parts with it because it is afraid
   * is paying tribute. The balance of power decides which of the two happened.
   */
  private isCoercedPayment(askerCivId: number, payerCivId: number): boolean {
    const rel = this.getRelation(askerCivId, payerCivId);
    if (rel?.status === 'war') return true;
    const asker = this.estimateMilitaryStrength(askerCivId);
    const payer = this.estimateMilitaryStrength(payerCivId);
    return payer > 0 && asker > payer * 1.5;
  }

  /**
   * The research cost of a technology — what a gift of it is worth. Unknown
   * ids fall back to a middling figure so the arithmetic never reads NaN.
   */
  private techCost(techId: string): number {
    return TECHNOLOGIES_DATA.find((t) => t.id === techId)?.cost ?? 50;
  }

  // ─── Alliance call for help ────────────────────────────────────────

  /**
   * When a civ is attacked, send a call_for_help to every ally it has — a
   * mutual-defence partner, or a plain alliance partner, which is a friend
   * with a treaty of friendship and no written obligation. The ally can
   * accept (joining the war on the defender's side) or refuse (breaking the
   * pact and recording an ally_abandoned impact). Only human allies are
   * offered the choice via AI_DIPLOMACY_OFFER; AI allies resolve immediately
   * through processProposal.
   */
  private callForHelp(defenderId: number, aggressorId: number): void {
    const defender = this.gameEngine.civilizations?.[defenderId];
    const defenderName = defender?.name ?? `Civilization ${defenderId}`;
    for (const rel of this.getRelationsForCiv(defenderId)) {
      const allyId = rel.otherCivId;
      // Locked teammates are already at war with the aggressor through the
      // team-wide declaration; they must not be asked to join their own war.
      if (this.isTeammate(defenderId, allyId)) continue;
      if (!this.isAllyOf(defenderId, allyId)) continue;
      if (this.isAtWar(allyId, aggressorId)) continue;
      const ally = this.gameEngine.civilizations?.[allyId];
      if (!ally || ally.isAlive === false) continue;

      this.logEvent({
        type: 'call_for_help_sent',
        fromCivId: defenderId,
        toCivId: allyId,
        details: `${defenderName} calls for help against Civ ${aggressorId}`,
      });

      if (ally.isHuman) {
        const message = `${defenderName} calls for your help against Civilisation ${aggressorId}!`;
        this.emitEvent('AI_DIPLOMACY_OFFER', {
          fromCivId: defenderId,
          toCivId: allyId,
          action: 'call_for_help',
          embargoTargetId: aggressorId,
          message,
        });
      } else {
        // AI ally decides immediately through the normal proposal pipeline.
        this.processProposal({
          fromCivId: defenderId,
          toCivId: allyId,
          action: 'call_for_help',
          embargoTargetId: aggressorId,
        });
      }
    }
  }

  /**
   * Offensive mirror of `callForHelp`: when a civ is about to attack, ask its
   * allies to join the war on the attacker's side. The ally accepts
   * (declaring war on the target, via the same `call_for_help` action) or
   * refuses (breaking the pact and recording an ally_abandoned impact, as
   * in the defensive case). Human allies get an interactive prompt; AI allies
   * resolve immediately through processProposal.
   */
  private callForOffense(attackerId: number, targetId: number): void {
    const attacker = this.gameEngine.civilizations?.[attackerId];
    const attackerName = attacker?.name ?? `Civilization ${attackerId}`;
    for (const rel of this.getRelationsForCiv(attackerId)) {
      const allyId = rel.otherCivId;
      if (allyId === targetId) continue;
      // Locked teammates join automatically through team-wide war.
      if (this.isTeammate(attackerId, allyId)) continue;
      if (!this.isAllyOf(attackerId, allyId)) continue;
      if (this.isAtWar(allyId, targetId)) continue;
      const ally = this.gameEngine.civilizations?.[allyId];
      if (!ally || ally.isAlive === false) continue;

      this.logEvent({
        type: 'call_for_help_sent',
        fromCivId: attackerId,
        toCivId: allyId,
        details: `${attackerName} calls its allies to join the attack on Civ ${targetId}`,
      });

      if (ally.isHuman) {
        const message = `${attackerName} calls for your help in their war against Civilisation ${targetId}!`;
        this.emitEvent('AI_DIPLOMACY_OFFER', {
          fromCivId: attackerId,
          toCivId: allyId,
          action: 'call_for_help',
          embargoTargetId: targetId,
          message,
        });
      } else {
        // AI ally decides immediately through the normal proposal pipeline.
        this.processProposal({
          fromCivId: attackerId,
          toCivId: allyId,
          action: 'call_for_help',
          embargoTargetId: targetId,
        });
      }
    }
  }

  /**
   * Whether two civs are bound to each other: a mutual-defence pact, or a
   * plain alliance. Both are friendships the other court can be called on —
   * the pact obliges, the alliance invites.
   */
  private isAllyOf(civId: number, otherId: number): boolean {
    const rel = this.getRelation(civId, otherId);
    if (!rel) return false;
    return rel.status === 'alliance' || rel.activeTreaties?.includes('mutual_defense') === true;
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  /** Generate a counter-proposal when the AI rejects an offer */
  private generateCounterProposal(
    fromCivId: number,
    toCivId: number,
    originalAction: DiplomatAction,
    attitude: Attitude,
  ): DiplomacyProposal | null {
    // Only counter sometimes — hostile civs rarely counter
    const counterChance = attitude === 'friendly' ? 60 : attitude === 'neutral' ? 40 : attitude === 'annoyed' ? 20 : 5;
    if (Math.random() * 100 >= counterChance) return null;

    switch (originalAction) {
      case 'propose_alliance':
        // Counter with a lesser treaty
        if (attitude !== 'hostile') {
          return { fromCivId: toCivId, toCivId: fromCivId, action: 'propose_non_aggression' };
        }
        return null;

      case 'propose_peace':
        // Demand tribute as condition for peace
        if (attitude === 'annoyed' || attitude === 'hostile') {
          const strength = this.estimateMilitaryStrength(toCivId);
          const goldDemand = Math.max(20, Math.floor(strength * 5));
          return { fromCivId: toCivId, toCivId: fromCivId, action: 'demand_tribute', goldAmount: goldDemand };
        }
        // Counter with ceasefire instead
        return { fromCivId: toCivId, toCivId: fromCivId, action: 'propose_ceasefire' };

      case 'demand_tribute':
        // Counter with trade agreement instead
        if (attitude !== 'hostile') {
          return { fromCivId: toCivId, toCivId: fromCivId, action: 'propose_trade_agreement', goldAmount: 2 };
        }
        return null;

      case 'offer_open_borders':
        // Want trade agreement too
        return { fromCivId: toCivId, toCivId: fromCivId, action: 'propose_trade_agreement', goldAmount: 2 };

      default:
        return null;
    }
  }

  estimateMilitaryStrength(civId: number): number {
    const units = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === civId && (u.attack || 0) > 0
    ) ?? [];
    return units.reduce((sum: number, u: Unit) => sum + (u.attack || 0) + (u.defense || 0) * 0.5, 0);
  }

  private logEvent(event: DiplomacyEvent): void {
    this.eventLog.unshift(event);
    if (this.eventLog.length > 50) this.eventLog.length = 50;
  }

  private emitEvent(type: string, data: Record<string, unknown>): void {
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange(type, data);
    }
  }
}
