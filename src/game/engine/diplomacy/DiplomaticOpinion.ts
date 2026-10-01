/**
 * DiplomaticOpinion — the directed ledger that replaces the old
 * attitude-score / willingness / reputationModifier trio.
 *
 * The old model kept three numbers that partly measured the same thing
 * (attitude added `reputationModifier` AND subtracted `brokenTreaties × 15`,
 * then willingness subtracted `brokenTreaties × 15` again), and none of them
 * survived a save/load without losing information. This module keeps exactly
 * one ledger per direction, with explicit bounds and a capped reason log so
 * the UI can always answer "why do they hate me?".
 *
 * Nothing here reaches into the engine: it is pure data in, pure data out, so
 * the arithmetic is unit-testable without a GameEngine.
 */

import type {
  DiplomaticRelation,
  ImpactEvent,
  ImpactReason,
  Opinion,
  OpinionDir,
} from '../DiplomacyTypes';

/** Goodwill is the meter's source, so it is clamped to the ±100 the UI draws. */
const GOODWILL_MIN = -100;
const GOODWILL_MAX = 100;
/** Grievance/fear/respect are 0..100 intensity meters, not signed scores. */
const INTENSITY_MAX = 100;
/** How many impacts to remember per direction (the UI only shows a handful). */
export const REASON_HISTORY = 8;

/** A neutral ledger: no opinion formed, nothing owed, nothing feared. */
export function createOpinion(): Opinion {
  return {
    goodwill: 0,
    grievance: 0,
    fear: 0,
    respect: 0,
    offersRefused: 0,
    lastOfferRound: -1,
    reasons: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Fill in anything a (possibly older) save is missing, keeping the invariant. */
export function normalizeOpinion(partial: Partial<Opinion> | undefined): Opinion {
  const base = createOpinion();
  if (!partial) return base;
  return {
    goodwill: clamp(partial.goodwill ?? 0, GOODWILL_MIN, GOODWILL_MAX),
    grievance: clamp(partial.grievance ?? 0, 0, INTENSITY_MAX),
    fear: clamp(partial.fear ?? 0, 0, INTENSITY_MAX),
    respect: clamp(partial.respect ?? 0, 0, INTENSITY_MAX),
    offersRefused: Math.max(0, Math.floor(partial.offersRefused ?? 0)),
    lastOfferRound: partial.lastOfferRound ?? -1,
    reasons: Array.isArray(partial.reasons) ? partial.reasons.slice(0, REASON_HISTORY) : [],
  };
}

/** Which side of the relation `civId` sits on. Null when the civ is not in it. */
function directionOf(rel: DiplomaticRelation, civId: number): OpinionDir | null {
  if (rel.civA === civId) return 'aToB';
  if (rel.civB === civId) return 'bToA';
  return null;
}

/** Read one side's ledger. Always a live reference — mutate via the apply* fns. */
export function readOpinion(rel: DiplomaticRelation, civId: number): Opinion {
  const dir = directionOf(rel, civId);
  if (dir === 'aToB') return rel.opinionAtoB;
  if (dir === 'bToA') return rel.opinionBtoA;
  return createOpinion();
}

/**
 * The OTHER civilization's opinion of `civId` — i.e. "how do THEY feel about
 * us". For the diplomacy screen's "their fear of you" read-out.
 *
 * This is NOT the same as `readOpinion(rel, civId)`, and confusing the two
 * silently reads the wrong ledger: a proposal must be judged by the
 * RESPONDER's opinion of the proposer, which is `readOpinion(rel, responder)`.
 */
export function readOpinionHeldByOther(rel: DiplomaticRelation, civId: number): Opinion {
  const dir = directionOf(rel, civId);
  if (dir === 'aToB') return rel.opinionBtoA;
  if (dir === 'bToA') return rel.opinionAtoB;
  return createOpinion();
}

/**
 * Apply one impact's point delta plus its reason string, in a single
 * place. Everything that happens between two civs funnels through here, so
 * the ledger and the explanation can never drift apart.
 */
export function applyImpact(
  rel: DiplomaticRelation,
  holderCivId: number,
  event: ImpactEvent,
  delta: number,
  round: number,
  detail?: string,
): ImpactReason {
  const dir = directionOf(rel, holderCivId);
  if (dir === null) {
    return { event, delta: 0, round, detail };
  }
  const opinion = dir === 'aToB' ? rel.opinionAtoB : rel.opinionBtoA;
  const applied = clamp(opinion.goodwill + delta, GOODWILL_MIN, GOODWILL_MAX);
  opinion.goodwill = applied;

  // Harsh acts wound pride; kindness builds it. Grievance never heals as fast
  // as goodwill rises, which is what makes an apology worth less than a gift.
  if (delta < 0) opinion.grievance = clamp(opinion.grievance - delta * 0.6, 0, INTENSITY_MAX);
  else opinion.grievance = clamp(opinion.grievance - delta * 0.15, 0, INTENSITY_MAX);

  // Keeping promises is what respect is made of; betrayal destroys it.
  const keepsWord = event === 'tribute_gift' || event === 'peace_made' || event === 'trade_signed'
    || event === 'alliance_formed' || event === 'tech_exchanged' || event === 'common_enemy_defeated';
  const breaksWord = event === 'alliance_break' || event === 'ceasefire_break'
    || event === 'treaty_cancelled' || event === 'surprise_attack' || event === 'unit_bribed';
  if (keepsWord) opinion.respect = clamp(opinion.respect + delta * 0.5, 0, INTENSITY_MAX);
  if (breaksWord) opinion.respect = clamp(opinion.respect - Math.abs(delta) * 0.5, 0, INTENSITY_MAX);

  const reason: ImpactReason = { event, delta, round, detail };
  opinion.reasons.unshift(reason);
  if (opinion.reasons.length > REASON_HISTORY) opinion.reasons.length = REASON_HISTORY;
  return reason;
}

/** Record that a proposal was refused: proposal spam must have a cost. */
export function recordRefusal(rel: DiplomaticRelation, holderCivId: number, round: number): void {
  const opinion = readOpinion(rel, holderCivId);
  opinion.offersRefused = Math.min(20, opinion.offersRefused + 1);
  opinion.lastOfferRound = round;
}

/** Note that a proposal arrived, so a repeat within the same era is remembered. */
export function noteOffer(rel: DiplomaticRelation, holderCivId: number, round: number): void {
  readOpinion(rel, holderCivId).lastOfferRound = round;
}
