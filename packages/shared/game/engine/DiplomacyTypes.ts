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
  | 'bribe_exposed'
  | 'spy_detected'
  | 'technology_stolen'
  | 'city_sabotaged'
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
  | 'embassy_established'
  | 'tech_exchanged'
  | 'technology_gifted'
  | 'tech_gift'
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
export type TreatyType = 'open_borders' | 'trade_agreement' | 'mutual_defense' | 'non_aggression' | 'embargo_target' | 'embassy';

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

/**
 * Everything a diplomat can do. This union is the whole diplomat ability set —
 * the menu the player is shown, the list the AI chooses from and the switch
 * `executeDiplomatAction` dispatches on are all built from it, so an ability
 * can never be listed without being implemented (and vice versa).
 *
 * (A `bribe_city` member used to sit here with no mechanic behind it and no way
 * to reach it: taking a city with gold instead of an army would bypass the
 * whole military model. It was removed rather than left as a promise.)
 */
export type DiplomatAction =
  | 'propose_peace'
  | 'propose_ceasefire'
  | 'propose_alliance'
  | 'demand_tribute'
  | 'offer_gift'
  | 'gift_gold'
  | 'request_gold'
  | 'bribe_unit'
  | 'gather_intelligence'
  | 'offer_open_borders'
  | 'propose_trade_agreement'
  | 'offer_tech_exchange'
  | 'offer_tech_for_gold'
  | 'gift_technology'
  | 'propose_mutual_defense'
  | 'propose_embargo'
  | 'propose_non_aggression'
  | 'propose_joint_war'
  | 'call_for_help'
  | 'establish_embassy'
  | 'investigate_city'
  | 'industrial_sabotage'
  | 'steal_technology'
  | 'incite_revolt';

/**
 * Covert acts — the ones nobody is asked about, because they are not negotiable.
 *
 * Shared by the player-facing UI (an infiltration reports in its own window
 * instead of the negotiation screen) and by the AI (which runs them outright
 * rather than surfacing them as an offer), so "what counts as espionage" is one
 * list rather than two that can disagree.
 */
export const ESPIONAGE_DIPLOMAT_ACTIONS: ReadonlySet<DiplomatAction> = new Set<DiplomatAction>([
  'establish_embassy',
  'investigate_city',
  'industrial_sabotage',
  'steal_technology',
  // Inciting a revolt is bought from agents inside a city, not negotiated
  // with its owner — the victim is never asked, so it belongs here.
  'incite_revolt',
]);

/**
 * One thing a diplomat can act on: a foreign city or a foreign unit standing
 * next to it, together with the complete list of abilities that make sense
 * there *right now*.
 *
 * This is the single source of truth behind the player's menu, the AI's
 * choice and `executeDiplomatAction`'s validation — the three can never
 * disagree about what is legal, because all three read the same list.
 */
export interface DiplomatTarget {
  /** Civilization that owns the city or unit. */
  targetCivId: number;
  kind: 'city' | 'unit';
  /** The city, when `kind === 'city'`. */
  cityId?: string;
  cityName?: string;
  /** The unit, when `kind === 'unit'`. */
  unitId?: string;
  unitType?: string;
  /** Diplomatic status with that civ at this moment. */
  status: DiplomaticStatus;
  /** Every ability the diplomat has here — the ONLY menu that may be shown. */
  actions: DiplomatAction[];
}

/**
 * The terms an action needs beyond its name. All optional: every one of them
 * has a sensible default the engine supplies, so a bare `executeDiplomatAction`
 * call from the AI or from a test still resolves to a complete proposal.
 */
export interface DiplomatActionOptions {
  /** Pick a specific adjacent city when several of the same civ stand nearby. */
  cityId?: string;
  /** Pick a specific adjacent unit when several of the same civ stand nearby. */
  unitId?: string;
  /** Tribute demanded, or the trade agreement's gold-per-turn rate. */
  goldAmount?: number;
  /** Technology we hand over in an Exchange of Knowledge. */
  techOffered?: string;
  /** Technology we ask for in an Exchange of Knowledge. */
  techRequested?: string;
  /** The third party an embargo would be declared against. */
  embargoTargetId?: number;
}

/** What `executeDiplomatAction` reports back to its caller. */
export interface DiplomatActionResult {
  success: boolean;
  /** Which family of outcome this was, so the UI can pick a report window. */
  type?: 'intelligence' | 'proposal' | 'bribe' | 'espionage';
  /** Report payload for `intelligence` (an `IntelligenceReport`). */
  report?: unknown;
  /** Response payload for `proposal` / `bribe` (a `DiplomacyResponse`). */
  response?: unknown;
  /** Outcome payload for `espionage` (an `EspionageResult`). */
  espionage?: unknown;
  /** English fallback reason when the action could not be performed. */
  reason?: string;
  /** The target the action resolved against, for callers that need to report it. */
  target?: DiplomatTarget;
}

/** Who ends up paying the gold named in a proposal. */
export type GoldPayer = 'proposer' | 'responder';

/**
 * Who pays the gold in a technology exchange.
 *
 * A swap names a technology in each direction, and any gold on top of it is a
 * sweetener the PROPOSER adds — the responder is being offered a favour, not
 * a bill. A ONE-SIDED exchange is a sale, and the money runs the other way:
 * the side handing over the knowledge is paid for it. Without this rule a
 * "tech for money" deal would have the buyer handing the money to the seller.
 *
 * The engine and the scoring read this one function, so the two can never
 * disagree about who pays.
 */
export function goldPayerFor(proposal: {
  techOffered?: string;
  techRequested?: string;
}): GoldPayer {
  if (proposal.techOffered && !proposal.techRequested) return 'responder';
  return 'proposer';
}

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
  /**
   * The two units met face to face — the offer was made in person, at the
   * other court's own doorstep, so the knowledge travels with the messenger
   * and no diplomat has to cross between the two.
   *
   * This is what makes a trade visit different from a negotiation: a warrior
   * who walks up to a foreign city can deal there and then, while a deal
   * struck from the other side of the world needs a diplomat to carry it.
   */
  inPerson?: boolean;
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
// Espionage (diplomat actions inside a foreign city)
// ---------------------------------------------------------------------------

/** What an espionage action did, in the engine's own words. */
type EspionageOutcome =
  | 'stolen'
  | 'caught_stealing'
  | 'nothing_to_steal'
  | 'embassy_established'
  | 'embassy_already'
  | 'embassy_refused'
  | 'city_investigated'
  | 'sabotaged'
  | 'caught_sabotaging'
  | 'city_revolted'
  | 'caught_inciting'
  | 'incite_impossible';

/** What a city's owner is up to, as an infiltrated diplomat reports it. */
export interface CityIntelligence {
  cityId: string;
  cityName: string;
  population: number;
  buildings: string[];
  /** Name of whatever is being built (null when the city produces nothing). */
  production: string | null;
  productionProgress: number;
  ownerCivId: number;
}

/**
 * The result of one espionage action. The engine resolves the tech / the
 * detection roll / the war declaration; the UI only has to render the outcome
 * in the player's language — which is why ids, not names, travel here.
 */
export interface EspionageResult {
  success: boolean;
  outcome: EspionageOutcome;
  /** Technology the operative walked out with (outcome 'stolen'). */
  techId?: string;
  /**
   * The target knows what happened. Civ I: stealing technology and being
   * caught both end a diplomat's career, and both start a war.
   */
  coverBlown?: boolean;
  /** Whether the target declared war as a consequence. */
  warDeclared?: boolean;
  /** City the action targeted, when it targeted one. */
  cityId?: string;
  /** Name of that city, so the report can name it without another lookup. */
  cityName?: string;
  /** Intelligence gathered by 'investigate_city'. */
  report?: CityIntelligence;
  /** English fallback reason, mirroring `DiplomacyResponse.reason`. */
  reason?: string;
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
      | 'bribe_reported'
      | 'intelligence_gathered' | 'treaty_rejected'
      | 'open_borders_signed' | 'trade_agreement_signed' | 'mutual_defense_signed'
      | 'non_aggression_signed' | 'embargo_declared' | 'treaty_cancelled'
      | 'tech_exchanged' | 'tech_gifted' | 'counter_proposal'
      | 'embassy_established' | 'technology_stolen' | 'city_sabotaged'
  | 'bribe_reported' | 'gold_transferred' | 'call_for_help_accepted' | 'call_for_help_sent';
  fromCivId: number;
  toCivId: number;
  details?: string;
  goldAmount?: number;
  /** The technology that changed hands, for tech events. */
  techId?: string;
}
