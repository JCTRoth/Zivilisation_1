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
  TreatyType,
} from './DiplomacyTypes';
import type { Unit, City } from '../../../types/game';
import GameEngine from './GameEngine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum turns a ceasefire must last before war can be declared again */
const CEASEFIRE_COOLDOWN = 5;
/** Reputation penalty for breaking a peace treaty */
const PEACE_BREAK_PENALTY = -30;
/** Reputation penalty for breaking an alliance */
const ALLIANCE_BREAK_PENALTY = -50;
/** Reputation penalty for surprise attack (declaring war from peace) */
const SURPRISE_ATTACK_PENALTY = -20;
/** Reputation recovered per turn toward 0 */
const REPUTATION_RECOVERY_PER_TURN = 1;
/** Base gold cost to bribe a unit (multiplied by unit attack+defense) */
const BRIBE_UNIT_BASE_COST = 25;
/** Base gold cost to bribe a city (multiplied by city population) */
/** How many turns before AI re-evaluates diplomatic stance */
const AI_DIPLOMACY_INTERVAL = 5;

// ---------------------------------------------------------------------------
// DiplomacyManager
// ---------------------------------------------------------------------------

export class DiplomacyManager {
  private gameEngine: GameEngine;
  /** Canonical relation map keyed as "civA_civB" where civA < civB */
  private relations: Map<string, DiplomaticRelation> = new Map();
  /** Log of diplomatic events (most recent first, capped at 50) */
  private eventLog: DiplomacyEvent[] = [];

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ─── Initialization ────────────────────────────────────────────────

  /** Initialize relations between all civilization pairs (call after civs are created) */
  initialize(civIds: number[]): void {
    this.relations.clear();
    this.eventLog = [];
    for (let i = 0; i < civIds.length; i++) {
      for (let j = i + 1; j < civIds.length; j++) {
        const key = this.key(civIds[i], civIds[j]);
        this.relations.set(key, {
          civA: civIds[i],
          civB: civIds[j],
          status: 'peace',
          since: 0,
          reputationModifier: 0,
          treatiesBrokenByA: 0,
          treatiesBrokenByB: 0,
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
    for (const rel of relations) {
      const key = this.key(rel.civA, rel.civB);
      this.relations.set(key, { ...rel });
    }
  }

  /** Restore event log from saved data (for load game) */
  restoreEventLog(events: DiplomacyEvent[]): void {
    this.eventLog = events.map(e => ({ ...e }));
  }

  /** Get the recent event log */
  getEventLog(): DiplomacyEvent[] {
    return [...this.eventLog];
  }

  // ─── Attitude calculation ──────────────────────────────────────────

  /** Calculate AI attitude toward another civilization */
  getAttitude(fromCivId: number, towardCivId: number): Attitude {
    const rel = this.getRelation(fromCivId, towardCivId);
    if (!rel) return 'neutral';

    const fromCiv = this.gameEngine.civilizations?.[fromCivId];
    const personality = fromCiv?.personality;

    let score = 0;

    // Base disposition from personality
    if (personality) {
      score += (personality.diplomacy - 5) * 3; // diplomatic civs start friendlier
      score -= (personality.aggression - 5) * 2; // aggressive civs are meaner
    }

    // Reputation impact
    const broken = fromCivId < towardCivId ? rel.treatiesBrokenByB : rel.treatiesBrokenByA;
    score -= broken * 15;
    score += rel.reputationModifier;

    // Current status impact
    if (rel.status === 'alliance') score += 20;
    else if (rel.status === 'war') score -= 30;
    else if (rel.status === 'ceasefire') score -= 10;

    // Active treaty bonuses
    if (rel.activeTreaties?.includes('trade_agreement')) score += 5;
    if (rel.activeTreaties?.includes('open_borders')) score += 3;
    if (rel.activeTreaties?.includes('mutual_defense')) score += 8;
    if (rel.activeTreaties?.includes('non_aggression')) score += 4;

    // Military strength comparison
    const ownStrength = this.estimateMilitaryStrength(fromCivId);
    const theirStrength = this.estimateMilitaryStrength(towardCivId);
    if (theirStrength > ownStrength * 1.5) score -= 10; // fear
    if (ownStrength > theirStrength * 2) score += 5; // contempt → more aggressive but not hostile

    // Border friction: nearby cities create tension
    const ownCities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === fromCivId) ?? [];
    const theirCities = this.gameEngine.cities?.filter((c: City) => c.civilizationId === towardCivId) ?? [];
    let minCityDist = Infinity;
    for (const oc of ownCities) {
      for (const tc of theirCities) {
        const d = this.gameEngine.squareGrid?.squareDistance?.(oc.col, oc.row, tc.col, tc.row) ?? Infinity;
        if (d < minCityDist) minCityDist = d;
      }
    }
    if (minCityDist <= 4) score -= 8;        // very close borders → friction
    else if (minCityDist <= 7) score -= 3;   // moderate proximity
    // distant civs get no penalty

    if (score >= 15) return 'friendly';
    if (score >= -5) return 'neutral';
    if (score >= -20) return 'annoyed';
    return 'hostile';
  }

  // ─── State changes ─────────────────────────────────────────────────

  /** Declare war between two civilizations */
  declareWar(aggressorId: number, targetId: number): void {
    const rel = this.getRelation(aggressorId, targetId);
    if (!rel || rel.status === 'war') return;

    const previousStatus = rel.status;
    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;

    // Apply reputation penalties for treaty-breaking
    if (previousStatus === 'peace') {
      this.applyReputationPenalty(aggressorId, targetId, SURPRISE_ATTACK_PENALTY);
      this.incrementBroken(aggressorId, targetId);
    } else if (previousStatus === 'alliance') {
      this.applyReputationPenalty(aggressorId, targetId, ALLIANCE_BREAK_PENALTY);
      this.incrementBroken(aggressorId, targetId);
    } else if (previousStatus === 'ceasefire') {
      const turnsSince = roundNumber - rel.since;
      if (turnsSince < CEASEFIRE_COOLDOWN) {
        this.applyReputationPenalty(aggressorId, targetId, PEACE_BREAK_PENALTY);
        this.incrementBroken(aggressorId, targetId);
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

    console.log(`[DIPLOMACY] Civ ${aggressorId} declared war on Civ ${targetId}`);
    this.emitEvent('WAR_DECLARED', { aggressorId, targetId });
  }

  /** Establish peace between two civilizations */
  makePeace(civA: number, civB: number): void {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status === 'peace') return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'peace';
    rel.since = roundNumber;

    this.logEvent({
      type: 'peace_made',
      fromCivId: civA,
      toCivId: civB,
    });

    console.log(`[DIPLOMACY] Peace between Civ ${civA} and Civ ${civB}`);
    this.emitEvent('PEACE_MADE', { civA, civB });
  }

  /** Establish ceasefire */
  signCeasefire(civA: number, civB: number): void {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status !== 'war') return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'ceasefire';
    rel.since = roundNumber;

    this.logEvent({
      type: 'ceasefire_signed',
      fromCivId: civA,
      toCivId: civB,
    });

    console.log(`[DIPLOMACY] Ceasefire between Civ ${civA} and Civ ${civB}`);
    this.emitEvent('CEASEFIRE_SIGNED', { civA, civB });
  }

  /** Form alliance */
  formAlliance(civA: number, civB: number): void {
    const rel = this.getRelation(civA, civB);
    if (!rel || rel.status === 'war') return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    rel.status = 'alliance';
    rel.since = roundNumber;

    this.logEvent({
      type: 'alliance_formed',
      fromCivId: civA,
      toCivId: civB,
    });

    console.log(`[DIPLOMACY] Alliance between Civ ${civA} and Civ ${civB}`);
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

    this.logEvent({
      type: eventType,
      fromCivId: civA,
      toCivId: civB,
      details: treaty === 'embargo_target' ? `Embargo on Civ ${extra?.targetCivId}` : undefined,
    });

    console.log(`[DIPLOMACY] Treaty signed: ${treaty} between Civ ${civA} and Civ ${civB}`);
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

    // Small reputation hit for cancelling treaties
    this.applyReputationPenalty(civId, otherId, -5);

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

  /** Process a diplomatic proposal. Returns whether accepted. */
  processProposal(proposal: DiplomacyProposal): DiplomacyResponse {
    const { fromCivId, toCivId, action } = proposal;
    const attitude = this.getAttitude(toCivId, fromCivId);
    const willingness = this.calculateWillingness(toCivId, fromCivId, action, attitude);
    const roll = Math.random() * 100;
    const accepted = roll < willingness;

    console.log(`[DIPLOMACY] Proposal: ${action} from Civ ${fromCivId} to Civ ${toCivId}, willingness=${willingness.toFixed(0)}%, roll=${roll.toFixed(0)}, accepted=${accepted}`);

    if (!accepted) {
      // AI may make a counter-proposal
      const counter = this.generateCounterProposal(fromCivId, toCivId, action, attitude);
      this.logEvent({
        type: 'treaty_rejected',
        fromCivId,
        toCivId,
        details: `${action} rejected${counter ? ' (counter-proposal offered)' : ''}`,
      });
      return { accepted: false, reason: this.getRejectReason(attitude), counterProposal: counter ?? undefined };
    }

    // Execute the accepted action
    return this.executeAcceptedAction(proposal);
  }

  /**
   * Execute an AI-initiated proposal that the human player explicitly accepted
   * in the negotiation screen. Unlike `processProposal` there is no willingness
   * roll — the player's accept/reject decision IS the answer, so the action is
   * executed directly.
   */
  acceptOffer(proposal: DiplomacyProposal): DiplomacyResponse {
    const { fromCivId, action } = proposal;
    console.log(`[DIPLOMACY] Player accepted ${action} from Civ ${fromCivId}`);
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

    // Bribe success chance: 60% base, modified by attitude.
    // Hostile civs are easier to bribe (units are demoralised),
    // friendly civs are harder (units are loyal).
    const attitude = this.getAttitude(unit.civilizationId, diplomatCivId);
    let chance = 60;
    if (attitude === 'hostile') chance += 20;
    else if (attitude === 'friendly') chance -= 20;

    if (Math.random() * 100 >= chance) {
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

    this.logEvent({
      type: 'unit_bribed',
      fromCivId: diplomatCivId,
      toCivId: originalCivId,
      goldAmount: cost,
      details: `Bribed ${unit.type}`,
    });

    console.log(`[DIPLOMACY] Civ ${diplomatCivId} bribed unit ${targetUnitId} for ${cost} gold`);
    this.emitEvent('UNIT_BRIBED', { diplomatCivId, unitId: targetUnitId, cost });
    return { accepted: true, goldTransferred: -cost };
  }

  // ─── Turn processing ───────────────────────────────────────────────

  /** Called once per round to recover reputation and handle AI decisions */
  processTurn(_roundNumber: number): void {
    // Recover reputation toward 0
    for (const rel of this.relations.values()) {
      if (rel.reputationModifier < 0) {
        rel.reputationModifier = Math.min(0, rel.reputationModifier + REPUTATION_RECOVERY_PER_TURN);
      } else if (rel.reputationModifier > 0) {
        rel.reputationModifier = Math.max(0, rel.reputationModifier - REPUTATION_RECOVERY_PER_TURN);
      }

      // Process trade agreement gold transfers
      if (rel.activeTreaties.includes('trade_agreement') && rel.tradeGoldPerTurn > 0) {
        const civA = this.gameEngine.civilizations?.[rel.civA];
        const civB = this.gameEngine.civilizations?.[rel.civB];
        if (civA?.resources) civA.resources.gold += rel.tradeGoldPerTurn;
        if (civB?.resources) civB.resources.gold += rel.tradeGoldPerTurn;
      }

      // Mutual defense: if ally is at war, join the war
      if (rel.activeTreaties.includes('mutual_defense') && rel.status !== 'war') {
        const aEnemies = this.getEnemies(rel.civA);
        const bEnemies = this.getEnemies(rel.civB);
        // If A is at war with someone, B should join
        for (const enemy of aEnemies) {
          if (!this.isAtWar(rel.civB, enemy) && enemy !== rel.civB) {
            this.declareWar(rel.civB, enemy);
          }
        }
        for (const enemy of bEnemies) {
          if (!this.isAtWar(rel.civA, enemy) && enemy !== rel.civA) {
            this.declareWar(rel.civA, enemy);
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
  }

  /** AI diplomacy: decide whether to propose peace, declare war, etc. */
  processAIDiplomacy(civId: number): void {
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ || civ.isHuman) return;

    const roundNumber = this.gameEngine.roundManager?.getRoundNumber?.() ?? 0;
    if (roundNumber % AI_DIPLOMACY_INTERVAL !== 0 && roundNumber > 1) return;

    const personality = civ.personality || { aggression: 5, diplomacy: 5, military: 5 };
    const ownStrength = this.estimateMilitaryStrength(civId);
    const civName = civ.name ?? `Civilization ${civId}`;

    for (const rel of this.getRelationsForCiv(civId)) {
      const otherId = rel.otherCivId;
      const otherCiv = this.gameEngine.civilizations?.[otherId];
      if (!otherCiv || !otherCiv.isAlive) continue;

      const attitude = this.getAttitude(civId, otherId);
      const theirStrength = this.estimateMilitaryStrength(otherId);
      const turnsSince = roundNumber - rel.since;
      const isPlayerTarget = otherCiv.isHuman === true;

      if (rel.status === 'war') {
        // Consider peace if losing or war has gone on long enough
        if (theirStrength > ownStrength * 1.3 && turnsSince > 5) {
          console.log(`[AI-DIPLO] Civ ${civId} proposing ceasefire to Civ ${otherId} (outmatched)`);
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'propose_ceasefire', undefined, `${civName} proposes a ceasefire.`);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'propose_ceasefire' });
          }
        } else if (turnsSince > 15 && attitude !== 'hostile') {
          console.log(`[AI-DIPLO] Civ ${civId} proposing peace to Civ ${otherId} (long war)`);
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'propose_peace', undefined, `${civName} sues for peace.`);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'propose_peace' });
          }
        }
      } else if (rel.status === 'peace' || rel.status === 'ceasefire') {
        // War for conquest: military-leaning civs with a clear strength
        // advantage attack a weaker neighbour — this is what lets the AI
        // actually capture enemy cities instead of only reacting. Civs that
        // prefer to expand/research/wonder stay peaceful until provoked.
        const strengthRatio = ownStrength / Math.max(theirStrength, 1);
        const profile = civ.productionProfile ?? 'balanced_growth';
        const conquestThreshold = profile === 'military_expansion' ? 1.6
          : profile === 'balanced_growth' ? 2.0
          : Infinity;
        const wantsConquest = personality.aggression >= 4 && strengthRatio >= conquestThreshold;
        // Classic behaviour: very aggressive + hostile civs attack with only
        // a 1.5x edge.
        const classicDoW = personality.aggression >= 7 && strengthRatio >= 1.5 && attitude === 'hostile';
        if (wantsConquest || classicDoW) {
          console.log(`[AI-DIPLO] Civ ${civId} declaring war on Civ ${otherId} (conquest ratio ${strengthRatio.toFixed(2)})`);
          this.declareWar(civId, otherId);
          if (isPlayerTarget) {
            this.emitEvent('DIPLOMACY_EVENT', {
              message: `${civName} has declared WAR on you!`,
            });
          }
        }
        // Consider demanding tribute if much stronger
        else if (personality.aggression >= 6 && ownStrength > theirStrength * 2 && turnsSince > 10) {
          const demand = Math.max(25, Math.floor((ownStrength / Math.max(theirStrength, 1)) * 20));
          console.log(`[AI-DIPLO] Civ ${civId} demanding ${demand} gold tribute from Civ ${otherId}`);
          if (isPlayerTarget) {
            this.emitOffer(civId, otherId, 'demand_tribute', demand, `${civName} demands ${demand} gold as tribute.`);
          } else {
            this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'demand_tribute', goldAmount: demand });
          }
        }
        // Consider alliance if friendly and similar strength
        else if (rel.status === 'peace' && attitude === 'friendly' && personality.diplomacy >= 6) {
          const strengthRatio = Math.min(ownStrength, theirStrength) / Math.max(ownStrength, theirStrength, 1);
          if (strengthRatio > 0.5) {
            console.log(`[AI-DIPLO] Civ ${civId} proposing alliance to Civ ${otherId}`);
            if (isPlayerTarget) {
              this.emitOffer(civId, otherId, 'propose_alliance', undefined, `${civName} proposes an alliance.`);
            } else {
              this.processProposal({ fromCivId: civId, toCivId: otherId, action: 'propose_alliance' });
            }
          }
        }
      } else if (rel.status === 'alliance') {
        // Alliances can collapse: a hostile attitude may push the AI to betray
        // outright, and very aggressive leaders occasionally backstab after a
        // long-standing pact. The reputation penalty is applied by declareWar.
        const hostileBetrayal = attitude === 'hostile' && Math.random() * 100 < 40;
        const longAllianceBetrayal = turnsSince > 20 && personality.aggression >= 7 && Math.random() * 100 < 8;
        if (hostileBetrayal || longAllianceBetrayal) {
          console.log(`[AI-DIPLO] Civ ${civId} breaking alliance with Civ ${otherId}`);
          this.declareWar(civId, otherId);
          this.logEvent({
            type: 'alliance_broken',
            fromCivId: civId,
            toCivId: otherId,
            details: 'Alliance collapsed',
          });
          this.emitEvent('ALLIANCE_BROKEN', { civA: civId, civB: otherId });
          if (isPlayerTarget) {
            this.emitEvent('DIPLOMACY_EVENT', {
              message: `${civName} has BROKEN the alliance and declared war on you!`,
            });
          }
        }
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
    console.log(`[AI-DIPLO] Offering ${action} to human Civ ${toCivId}`);
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

  private calculateWillingness(
    decidingCivId: number,
    proposerCivId: number,
    action: DiplomatAction,
    attitude: Attitude
  ): number {
    const attitudeBase: Record<Attitude, number> = {
      friendly: 75,
      neutral: 50,
      annoyed: 30,
      hostile: 10,
    };

    let willingness = attitudeBase[attitude];

    // Action-specific modifiers
    switch (action) {
      case 'propose_peace':
        // AI usually wants peace when attitude is not hostile
        willingness += 15;
        break;
      case 'propose_ceasefire':
        willingness += 20; // Ceasefires are easier to accept
        break;
      case 'propose_alliance':
        willingness -= 10; // Alliances require more trust
        break;
      case 'demand_tribute':
        willingness -= 20; // Nobody likes demands
        // Weaker civs more likely to comply
        const ownStr = this.estimateMilitaryStrength(decidingCivId);
        const proposerStr = this.estimateMilitaryStrength(proposerCivId);
        if (proposerStr > ownStr * 1.5) willingness += 25;
        break;
      case 'offer_open_borders':
        willingness += 5; // Generally harmless
        break;
      case 'propose_trade_agreement':
        willingness += 10; // Mutually beneficial
        break;
      case 'propose_mutual_defense':
        willingness -= 15; // Big commitment
        break;
      case 'propose_non_aggression':
        willingness += 15; // Easy to accept
        break;
      case 'propose_embargo':
        willingness -= 10; // Depends on relationship with target
        break;
      case 'offer_tech_exchange':
        willingness += 5; // Fair trade
        break;
    }

    // Reputation modifier
    const rel = this.getRelation(decidingCivId, proposerCivId);
    if (rel) {
      const broken = decidingCivId < proposerCivId ? rel.treatiesBrokenByB : rel.treatiesBrokenByA;
      willingness -= broken * 15;
    }

    return Math.max(0, Math.min(100, willingness));
  }

  estimateMilitaryStrength(civId: number): number {
    const units = this.gameEngine.units?.filter(
      (u: Unit) => u.civilizationId === civId && (u.attack || 0) > 0
    ) ?? [];
    return units.reduce((sum: number, u: Unit) => sum + (u.attack || 0) + (u.defense || 0) * 0.5, 0);
  }

  private applyReputationPenalty(aggressorId: number, targetId: number, penalty: number): void {
    const rel = this.getRelation(aggressorId, targetId);
    if (rel) {
      rel.reputationModifier += penalty;
    }
  }

  private incrementBroken(aggressorId: number, targetId: number): void {
    const rel = this.getRelation(aggressorId, targetId);
    if (!rel) return;
    if (aggressorId === rel.civA) rel.treatiesBrokenByA++;
    else rel.treatiesBrokenByB++;
  }

  private getRejectReason(attitude: Attitude): string {
    switch (attitude) {
      case 'hostile': return 'We have no interest in dealing with you!';
      case 'annoyed': return 'We are not inclined to accept your offer.';
      case 'neutral': return 'We must decline at this time.';
      case 'friendly': return 'Perhaps another time.';
    }
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
