/**
 * DiplomacyTypes - Shared type definitions for the Civ I–style diplomacy system.
 *
 * Diplomatic relations between two civilizations are always symmetric:
 * if A is at war with B then B is at war with A.
 */

// ---------------------------------------------------------------------------
// Diplomatic state between two civilizations
// ---------------------------------------------------------------------------

/** Possible diplomatic states (ordered by hostility, low → high) */
export type DiplomaticStatus = 'alliance' | 'peace' | 'ceasefire' | 'war';

/** AI attitude toward another civilization */
export type Attitude = 'friendly' | 'neutral' | 'annoyed' | 'hostile';

/**
 * Score thresholds for the attitude tiers, highest band first. Shared by the
 * engine (which buckets the score) and the UI (which draws the meter) so the
 * two can never disagree about what "Friendly" means.
 */
export const ATTITUDE_BANDS: ReadonlyArray<{ min: number; attitude: Attitude }> = [
  { min: 15, attitude: 'friendly' },
  { min: -5, attitude: 'neutral' },
  { min: -20, attitude: 'annoyed' },
  { min: Number.NEGATIVE_INFINITY, attitude: 'hostile' },
];

/** Bucket a raw attitude score into its tier. */
export function attitudeFromScore(score: number): Attitude {
  for (const band of ATTITUDE_BANDS) {
    if (score >= band.min) return band.attitude;
  }
  return 'hostile';
}

// ---------------------------------------------------------------------------
// Directed opinion: the single diplomatic currency
// ---------------------------------------------------------------------------

/**
 * Every act one civ commits against another is turned into goodwill points by
 * the impact funnel, so "anything you do matters" is literally true: there is
 * exactly one place where an act becomes points. The delta is
 *
 *     base × personality weight × relationship-state multiplier × magnitude
 *
 * (see diplomacy/DiplomaticImpacts.ts), which is why a surprise attack costs a
 * paranoid, diplomatic civ far more than it costs a belligerent one, and why
 * breaking an alliance costs more than breaking a peace.
 */
export type ImpactEvent =
  // things done TO you by the other civ
  | 'first_contact'
  | 'surprise_attack'
  | 'ceasefire_break'
  | 'late_ceasefire_break'
  | 'alliance_break'
  | 'tribute_extorted'
  | 'tribute_gift'
  | 'unit_bribed'
  | 'spy_detected'
  | 'treaty_cancelled'
  | 'border_pressure'
  // things done FOR you
  | 'peace_made'
  | 'ceasefire_signed'
  | 'alliance_formed'
  | 'open_borders_signed'
  | 'trade_signed'
  | 'mutual_defense_signed'
  | 'non_aggression_signed'
  | 'embargo_signed'
  | 'tech_exchanged'
  | 'common_enemy_defeated'
  | 'refused_peace'
  | 'ally_abandoned';

/** One recorded impact — the human-readable "why" behind the goodwill number. */
export interface ImpactReason {
  event: ImpactEvent;
  /** Points actually applied, after all multipliers (negative = the other side is worse off). */
  delta: number;
  round: number;
  detail?: string;
}

/**
 * One civ's directed opinion of another. Stored per direction, because
 * "Rome thinks Rome is trustworthy" and "Rome thinks Babylon is trustworthy"
 * are different facts and the diplomacy screen has to be able to show both.
 */
export interface Opinion {
  /** The single currency, -100..100. Feeds `attitudeFromScore` directly. */
  goodwill: number;
  /** Accumulated hurts, 0..100. Decays slowly; blocks extreme demands when high. */
  grievance: number;
  /** How much this civ fears the other, 0..100. Drives alliance seeking and tribute compliance. */
  fear: number;
  /** Whether the other civ has kept its word, 0..100. Cheap talk is worth less to you. */
  respect: number;
  /** Proposals this civ refused from the other — proposal spam costs goodwill. */
  offersRefused: number;
  /** Round the last proposal arrived, or -1. Refusing a repeat is remembered. */
  lastOfferRound: number;
  /** Most recent impacts, newest first (capped — this feeds the UI list). */
  reasons: ImpactReason[];
}

/** Which side of a relation a directed `Opinion` describes. */
export type OpinionDir = 'aToB' | 'bToA';

// ---------------------------------------------------------------------------
// Per-pair relation record
// ---------------------------------------------------------------------------

/** Active treaty types beyond basic diplomatic status */
export type TreatyType = 'open_borders' | 'trade_agreement' | 'mutual_defense' | 'non_aggression' | 'embargo_target';

export interface DiplomaticRelation {
  /** The two civilization IDs involved (sorted ascending for canonical key) */
  civA: number;
  civB: number;
  status: DiplomaticStatus;
  /** Turn the current status was established */
  since: number;
  /**
   * Round a peace treaty was last SIGNED, or undefined if these civs have
   * never made peace. This is deliberately not `since`: every pair starts at
   * peace, and the "a peace must be given time to stick" rule must not
   * therefore forbid war on turn one of the game.
   */
  peaceSignedAt?: number;
  /** civA's opinion of civB. Always present — restored saves are normalized. */
  opinionAtoB: Opinion;
  /** civB's opinion of civA. */
  opinionBtoA: Opinion;
  /** Active treaties beyond the basic status */
  activeTreaties: TreatyType[];
  /** Turn each treaty was established */
  treatySince: Record<string, number>;
  /** Gold-per-turn from trade agreement (positive = A receives, negative = B receives) */
  tradeGoldPerTurn: number;
  /** Embargo target civ id (if either side has an embargo agreement) */
  embargoTargetCivId?: number;
}

// ---------------------------------------------------------------------------
// Diplomat unit action results
// ---------------------------------------------------------------------------

export type DiplomatAction =
  | 'propose_peace'
  | 'propose_ceasefire'
  | 'propose_alliance'
  | 'demand_tribute'
  | 'bribe_unit'
  | 'bribe_city'
  | 'gather_intelligence'
  | 'offer_open_borders'
  | 'propose_trade_agreement'
  | 'offer_tech_exchange'
  | 'propose_mutual_defense'
  | 'propose_embargo'
  | 'propose_non_aggression';

export interface DiplomacyProposal {
  fromCivId: number;
  toCivId: number;
  action: DiplomatAction;
  /** Gold offered / demanded */
  goldAmount?: number;
  /** Technology id offered in exchange */
  techOffered?: string;
  /** Technology id requested in exchange */
  techRequested?: string;
  /** Target civ for embargo */
  embargoTargetId?: number;
}

export interface DiplomacyResponse {
  accepted: boolean;
  reason?: string;
  /** Gold transferred (positive = to proposer, negative = from proposer) */
  goldTransferred?: number;
  /** Counter-proposal (AI may suggest alternative terms) */
  counterProposal?: DiplomacyProposal;
}

/** One named term in a proposal's arithmetic, so the UI can explain the maths. */
export interface ScoreFactor {
  label: string;
  value: number;
}

/**
 * The full arithmetic behind an accept/refuse decision. The engine resolves
 * with it and the negotiation screen renders it, so the player sees exactly
 * the same numbers the AI used — the model never has a hidden second opinion.
 */
export interface ProposalEvaluation {
  accepted: boolean;
  /** Total points for the proposal. */
  score: number;
  /** Personality-scaled bar the score has to clear. */
  threshold: number;
  /** Bounded seeded noise actually applied (0 for previews and human accepts). */
  noise: number;
  /** The arithmetic, in the order it was summed. */
  factors: ScoreFactor[];
  /** The single largest term — the reason, in one line, for the UI. */
  decisiveFactor: string;
  /** True when pride (grievance) vetoed the deal regardless of score. */
  vetoed: boolean;
}

// ---------------------------------------------------------------------------
// Intelligence report (from diplomat spy action)
// ---------------------------------------------------------------------------

export interface IntelligenceReport {
  civId: number;
  civName: string;
  gold: number;
  numCities: number;
  numMilitaryUnits: number;
  currentResearch: string | null;
  government: string;
  attitude: Attitude;
}

// ---------------------------------------------------------------------------
// Diplomacy event (emitted via onStateChange)
// ---------------------------------------------------------------------------

export interface DiplomacyEvent {
  type: 'war_declared' | 'peace_made' | 'ceasefire_signed' | 'alliance_formed'
      | 'alliance_broken' | 'tribute_demanded' | 'tribute_paid' | 'unit_bribed'
      | 'intelligence_gathered' | 'treaty_rejected'
      | 'open_borders_signed' | 'trade_agreement_signed' | 'mutual_defense_signed'
      | 'non_aggression_signed' | 'embargo_declared' | 'treaty_cancelled'
      | 'tech_exchanged' | 'counter_proposal';
  fromCivId: number;
  toCivId: number;
  details?: string;
  goldAmount?: number;
}
