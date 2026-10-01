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
} from './DiplomacyTypes';
import { attitudeFromScore } from './DiplomacyTypes';
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
import type { Unit, City } from '../../../types/game';
import GameEngine from './GameEngine';
import { debugLog } from '../../utils/DevLog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base gold cost to bribe a unit (multiplied by unit attack+defense) */
const BRIBE_UNIT_BASE_COST = 25;
/** How many turns before AI re-evaluates diplomatic stance */
const AI_DIPLOMACY_INTERVAL = 5;
/**
 * Base chance a spying attempt is noticed, before paranoia scales it. Spying
 * was previously free and consequence-free; a civ that catches you now writes
 * a real negative impact, scaled up to 3× by how suspicious it is.
 */
const SPY_DETECTION_BASE = 15;
/**
 * Rounds of peace a civ remembers you for, which is what makes a broken peace
 * treaty expensive long after the fact.
 */
const GRIEVANCE_DECAY_PER_TURN = 0.5;

/** How an AI proposal is phrased to the human, per action. */
const AI_OFFER_MESSAGES: Partial<Record<DiplomatAction, (civName: string) => string>> = {
  propose_peace: (n) => `${n} sues for peace.`,
  propose_ceasefire: (n) => `${n} proposes a ceasefire.`,
  propose_alliance: (n) => `${n} proposes an alliance.`,
  offer_open_borders: (n) => `${n} proposes open borders.`,
  propose_trade_agreement: (n) => `${n} proposes a trade agreement.`,
  propose_non_aggression: (n) => `${n} proposes a non-aggression pact.`,
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
   * Civilization pairs that have physically met, keyed exactly like
   * `relations`. Contact is a PAIR fact: when one side sees the other, both
   * learn of each other. Barbarians are never recorded.
   */
  private contactedPairs: Set<string> = new Set();
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
    this.warExhaustion.clear();
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
    this.warExhaustion.clear();
    this.proposalSequence = 0;
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
    return this.contactedPairs.has(this.key(civA, civB));
  }

  /** Every counterpart this civilization has already met. */
  getMetCivs(civId: number): number[] {
    const met: number[] = [];
    for (const rel of this.relations.values()) {
      const other = rel.civA === civId ? rel.civB : rel.civB === civId ? rel.civA : null;
      if (other === null) continue;
      if (this.contactedPairs.has(this.key(civId, other))) met.push(other);
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

  // ─── Key helpers ───────────────────────────────────────────────────

  private key(a: number, b: number): string {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  // ─── Queries ───────────────────────────────────────────────────────

  getRelation(civA: number, civB: number): DiplomaticRelation | undefined {
    return this.relations.get(this.key(civA, civB));
  }

  getStatus(civA: number, civB: number): DiplomaticStatus {
    return this.getRelation(civA, civB)?.status ?? 'peace';
  }

  isAtWar(civA: number, civB: number): boolean {
    return this.getStatus(civA, civB) === 'war';
  }

  isAllied(civA: number, civB: number): boolean {
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
    return enemies;
  }

  /** Get all civilizations allied with the given civ */
  getAllies(civId: number): number[] {
    const allies: number[] = [];
    for (const rel of this.relations.values()) {
      if (rel.status !== 'alliance') continue;
      if (rel.civA === civId) allies.push(rel.civB);
      else if (rel.civB === civId) allies.push(rel.civA);
    }
    return allies;
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
  getEventLog(): DiplomacyEvent[] {
    return [...this.eventLog];
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

  /** Declare war between two civilizations */
  declareWar(aggressorId: number, targetId: number): void {
    const rel = this.getRelation(aggressorId, targetId);
    if (!rel || rel.status === 'war') return;
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
    for (const third of this.gameEngine.civilizations ?? []) {
      if (third.id === aggressorId || third.id === targetId) continue;
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

    rel.status = 'war';
    rel.since = roundNumber;

    this.logEvent({
      type: 'war_declared',
      fromCivId: aggressorId,
      toCivId: targetId,
      details: `War declared (was: ${previousStatus})`,
    });

    debugLog(`[DIPLOMACY] Civ ${aggressorId} declared war on Civ ${targetId}`);
    this.emitEvent('WAR_DECLARED', { aggressorId, targetId });
  }

  /** Establish peace between two civilizations */
  makePeace(civA: number, civB: number): void {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status === 'peace') return;
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
  }

  /** Establish ceasefire */
  signCeasefire(civA: number, civB: number): void {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status !== 'war') return;
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
  }

  /** Form alliance */
  formAlliance(civA: number, civB: number): void {
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
    const rel = this.getRelation(civA, civB);
    return rel?.activeTreaties?.includes(treaty) ?? false;
  }

  /** Get all active treaties between two civs */
  getActiveTreaties(civA: number, civB: number): TreatyType[] {
    return this.getRelation(civA, civB)?.activeTreaties ?? [];
  }

  /** Sign a treaty between two civs */
  signTreaty(civA: number, civB: number, treaty: TreatyType, extra?: { goldPerTurn?: number; targetCivId?: number; [key: string]: unknown }): void {
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
    }[treaty] as DiplomacyEvent['type'];

    // Signing is a positive act, and which treaty it is decides how much it is
    // worth: a mercantile civ loves trade, a paranoid one is glad of a pact.
    const impactEvent: ImpactEvent = {
      open_borders: 'open_borders_signed',
      trade_agreement: 'trade_signed',
      mutual_defense: 'mutual_defense_signed',
      non_aggression: 'non_aggression_signed',
      embargo_target: 'embargo_signed',
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
    const ownStrength = this.estimateMilitaryStrength(toCivId);
    const theirStrength = this.estimateMilitaryStrength(fromCivId);
    // "Share an enemy" is what gives an alliance its strategic value, and it is
    // the term the old flat −10 alliance penalty had no room for.
    const ownEnemies = new Set(this.getEnemies(toCivId));
    const sharedEnemy = this.getEnemies(fromCivId).some((e) => ownEnemies.has(e));
    return {
      responder: toCivId,
      proposer: fromCivId,
      action,
      // The RESPONDER's opinion of the proposer. (Not `getTheirOpinion`:
      // that is the reverse direction, and reading it here made every proposal
      // be judged on what the proposer thought of the responder.)
      opinion: rel ? readOpinion(rel, toCivId) : createOpinion(),
      weights: this.weightsFor(toCivId),
      status: rel?.status ?? 'peace',
      treaties: rel?.activeTreaties ?? [],
      ownStrength,
      theirStrength,
      ownGold: this.gameEngine.civilizations?.[toCivId]?.resources?.gold ?? 0,
      goldAmount: proposal.goldAmount,
      sharedEnemy,
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

      case 'propose_embargo': {
        const target = proposal.embargoTargetId;
        if (target === undefined) return { accepted: false, reason: 'No embargo target specified' };
        this.signTreaty(fromCivId, toCivId, 'embargo_target', { targetCivId: target });
        return { accepted: true };
      }

      case 'offer_tech_exchange': {
        const { techOffered, techRequested } = proposal;
        if (!techOffered || !techRequested) return { accepted: false, reason: 'Must specify both technologies' };
        const fromCiv = this.gameEngine.civilizations?.[fromCivId];
        const toCiv = this.gameEngine.civilizations?.[toCivId];
        // Engine civs store technologies as a string[] (Set methods would throw).
        const fromTechs = fromCiv?.technologies;
        const toTechs = toCiv?.technologies;
        // Verify both sides have what they claim
        const fromHas = !!fromTechs && fromTechs.includes(techOffered);
        const toHas = !!toTechs && toTechs.includes(techRequested);
        if (!fromHas) return { accepted: false, reason: 'You do not have the offered technology' };
        if (!toHas) return { accepted: false, reason: 'They do not have the requested technology' };
        // Exchange: add techs to both sides
        if (fromTechs && !fromTechs.includes(techRequested)) fromTechs.push(techRequested);
        if (toTechs && !toTechs.includes(techOffered)) toTechs.push(techOffered);
        // A fair swap is one of the few unambiguously good acts in the game.
        const exchangeRel = this.getRelation(toCivId, fromCivId);
        if (exchangeRel) {
          this.recordImpactOn(exchangeRel, toCivId, 'tech_exchanged',
            { tech: true }, `${techOffered} ↔ ${techRequested}`);
          this.recordImpactOn(exchangeRel, fromCivId, 'tech_exchanged',
            { tech: true }, `${techOffered} ↔ ${techRequested}`);
        }
        this.logEvent({
          type: 'tech_exchanged',
          fromCivId,
          toCivId,
          details: `${techOffered} ↔ ${techRequested}`,
        });
        return { accepted: true };
      }

      default:
        return { accepted: false, reason: 'Unknown action' };
    }
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

  /** Attempt to bribe an enemy unit with a diplomat */
  bribeUnit(diplomatCivId: number, targetUnitId: string): DiplomacyResponse {
    const unit = this.gameEngine.units?.find((u: Unit) => u.id === targetUnitId);
    if (!unit) return { accepted: false, reason: 'Unit not found' };
    if (unit.civilizationId === diplomatCivId) return { accepted: false, reason: 'Cannot bribe own unit' };

    const cost = BRIBE_UNIT_BASE_COST * ((unit.attack || 1) + (unit.defense || 1));
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
    if (roll >= chance) {
      return { accepted: false, reason: 'Bribe failed — the unit refused' };
    }

    // Success: transfer the unit
    const originalCivId = unit.civilizationId;
    fromCiv.resources.gold -= cost;
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
      if (this.hasContacted(rel.civA, rel.civB) && this.minCityDistance(rel.civA, rel.civB) <= 4) {
        this.recordImpactOn(rel, rel.civB, 'border_pressure', undefined, 'cities on the border');
      }

      // Process trade agreement gold transfers
      if (rel.activeTreaties.includes('trade_agreement') && rel.tradeGoldPerTurn > 0) {
        const civA = this.gameEngine.civilizations?.[rel.civA];
        const civB = this.gameEngine.civilizations?.[rel.civB];
        if (civA?.resources) civA.resources.gold += rel.tradeGoldPerTurn;
        if (civB?.resources) civB.resources.gold += rel.tradeGoldPerTurn;
      }

      // Mutual defence, with consent. This used to read "if my ally is at war,
      // join it" unconditionally, which turned any single war into a
      // continent-wide one. An ally now weighs it: a beaten ally whose enemy
      // outclasses them both is not worth a second front.
      if (rel.activeTreaties.includes('mutual_defense') && rel.status !== 'war') {
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
    return {
      civId,
      otherId,
      weights,
      opinion: readOpinion(rel, civId),
      status: rel.status,
      treaties: rel.activeTreaties ?? [],
      ownStrength: this.estimateMilitaryStrength(civId),
      theirStrength: this.estimateMilitaryStrength(otherId),
      ownGold: this.gameEngine.civilizations?.[civId]?.resources?.gold ?? 0,
      activeWars: this.getEnemies(civId).length,
      maxWars: maxConcurrentWars(weights),
      exhaustion: this.getWarExhaustion(civId),
      turnsSince: round - statusSince,
      roundsSincePeace,
      sharedEnemy,
      round,
      sequence: this.proposalSequence++,
    };
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
      const chosen = chooseAction(scoreCandidates(ctx), ctx);
      if (!chosen) continue;

      debugLog(
        `[AI-DIPLO] Civ ${civId} → ${otherId}: ${chosen.action} `
        + `(${chosen.score}, because ${chosen.because})`,
      );

      switch (chosen.action) {
        case 'declare_war':
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

        case 'offer_open_borders':
        case 'propose_trade_agreement':
        case 'propose_non_aggression':
        case 'propose_alliance':
        case 'propose_ceasefire':
        case 'propose_peace': {
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
  ): void {
    debugLog(`[AI-DIPLO] Offering ${action} to human Civ ${toCivId}`);
    this.emitEvent('AI_DIPLOMACY_OFFER', {
      fromCivId,
      toCivId,
      action,
      goldAmount,
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
  ): void {
    // A civ cannot negotiate with someone it has never met. Visibility normally
    // records this; asserting it here keeps the invariant airtight.
    this.markContact(fromCivId, toCivId);
    this.emitOffer(fromCivId, toCivId, action, goldAmount, message);
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
