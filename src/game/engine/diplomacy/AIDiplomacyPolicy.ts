/**
 * AIDiplomacyPolicy — what an AI civ actually decides, scored rather than
 * branch-selected.
 *
 * The old `processAIDiplomacy` was an if/else with a conquest gate:
 *
 *     wantsConquest = aggression >= 4 && strengthRatio >= 1.6
 *
 * which opened wars with no cap on how many, no cost to being in one, no
 * check that the target had allies, and a 40% coin-flip betrayal of any
 * alliance. Combined with mutual defence dragging allies into every war, that
 * produced the 17-wars-in-465-rounds runs this replaces.
 *
 * Now every candidate action is scored from the same primitives the human
 * faces, and the best one wins — so AI-to-AI behaviour is legible, testable,
 * and subject to the same restraint the player experiences.
 */

import type { DiplomaticStatus, TreatyType } from '../DiplomacyTypes';
import type { DiplomaticWeights } from './DiplomaticWeights';
import type { Opinion } from '../DiplomacyTypes';
import { seededNoise } from './ProposalScoring';

/** One thing a civ might do this evaluation, with its reasoning. */
export interface DiplomaticCandidate {
  action: string;
  /** Above zero = act. Kept separate from score so a threshold is explicit. */
  score: number;
  /** Short terms for the console log and for tests. */
  because: string;
}

export interface PolicyContext {
  civId: number;
  otherId: number;
  weights: DiplomaticWeights;
  /** How the civ feels about the other. */
  opinion: Opinion;
  status: DiplomaticStatus;
  treaties: TreatyType[];
  ownStrength: number;
  theirStrength: number;
  ownGold: number;
  /** How many wars the civ is already fighting. */
  activeWars: number;
  /** Max wars this civ's temperament permits. */
  maxWars: number;
  /** 0 (fresh) … 20 (exhausted). */
  exhaustion: number;
  /** Turns since the current status began. */
  turnsSince: number;
  /** Rounds since a peace treaty was signed with this pair. */
  roundsSincePeace: number;
  /** Both are at war with this third party. */
  sharedEnemy: boolean;
  /** Round number, for the seeded tiebreak. */
  round: number;
  sequence: number;
}

const POWER_FLOOR = 1;

/** War appetite shrinks as a civ tires. Never below 0.2 so it never hard-stops. */
export function warAppetite(exhaustion: number): number {
  return Math.max(0.2, 1 - exhaustion / 25);
}

/**
 * How much a civ's temperament allows it to start a war, 0 … 1.25. A warmongering
 * of 4 or less (the defensive end of the range) cannot conquer anyone; 10 gives
 * a small bonus over 1.0.
 */
export function temperament(weights: DiplomaticWeights): number {
  return Math.max(0, Math.min(1.25, (weights.warmongering - 4) / 4));
}

/** Peace appetite is the mirror image: exhaustion makes a civ want out. */
export function peaceAppetite(exhaustion: number): number {
  return 1 + exhaustion / 12;
}

/**
 * Concurrent wars a civ will tolerate. Driven by `warmongering`, so a
 * military_expansion civ (≈8.6) will hold three fronts while a defensive_turtle
 * (≈3.2) holds one.
 */
export function maxConcurrentWars(weights: DiplomaticWeights): number {
  return 1 + Math.floor((weights.warmongering - 1) / 3);
}

/**
 * Whether this civ is willing to fight another war at all. All three gates
 * matter: capacity, exhaustion, and the post-peace cooldown that stops the
 * declare-war-the-moment-peace-is-signed loop.
 */
export function mayDeclareWar(ctx: PolicyContext): { ok: boolean; why: string } {
  if (ctx.activeWars >= ctx.maxWars) {
    return { ok: false, why: `already fighting ${ctx.activeWars} war(s) (limit ${ctx.maxWars})` };
  }
  if (ctx.exhaustion >= 18) {
    return { ok: false, why: 'exhausted from war' };
  }
  if (ctx.status === 'peace' && ctx.roundsSincePeace < 8) {
    return { ok: false, why: 'peace is too young to abandon' };
  }
  return { ok: true, why: '' };
}

/**
 * Whether an ally should be dragged into its partner's war. The old code said
 * "always" (`processTurn` looped over every enemy), which is what turned one
 * war into a continent-wide one. An ally now only honours the pact when the
 * shared enemy is plausibly beatable and it is not already worn down.
 */
export function shouldHonourMutualDefence(ctx: PolicyContext): { honour: boolean; why: string } {
  if (ctx.status === 'war') return { honour: false, why: 'already at war with them' };
  if (ctx.exhaustion >= 14) return { honour: false, why: 'too exhausted to take on another front' };
  if (ctx.activeWars >= ctx.maxWars) return { honour: false, why: 'no capacity for another front' };
  if (ctx.theirStrength > ctx.ownStrength * 1.8) {
    return { honour: false, why: 'the enemy outclasses us both' };
  }
  return { honour: true, why: 'pact honoured' };
}

/**
 * How much a candidate has to score before it is acted on. Starting a war needs
 * more justification than signing a trade pact, and betraying a partner needs
 * less than either because the alliance is already in place.
 */
const ACT_THRESHOLDS: Record<string, number> = {
  declare_war: 10,
  break_alliance: 2,
  demand_tribute: 8,
  propose_alliance: 6,
  default: 6,
};

function actThreshold(action: string): number {
  return ACT_THRESHOLDS[action] ?? ACT_THRESHOLDS.default;
}

/** Add a value to a candidate, keeping a human-readable trail. */
function push(list: DiplomaticCandidate[], action: string, value: number, because: string): void {
  const existing = list.find((c) => c.action === action);
  if (existing) {
    existing.score += value;
    if (value >= 0) existing.because = `${existing.because}; ${because}`;
    return;
  }
  list.push({ action, score: value, because });
}

/**
 * Score every action worth considering for this counterpart. Returned sorted,
 * best first, with the arithmetic in `because` so a test can assert *why* a
 * civ acted rather than just that it did.
 */
export function scoreCandidates(ctx: PolicyContext): DiplomaticCandidate[] {
  const out: DiplomaticCandidate[] = [];
  const ratio = ctx.ownStrength / Math.max(POWER_FLOOR, ctx.theirStrength);
  const goodwill = ctx.opinion.goodwill;
  const fear = ctx.opinion.fear;
  const grievance = ctx.opinion.grievance;

  if (ctx.status === 'war') {
    // Losing: sue for terms. Winning: press on — but not forever. A war that
    // has dragged on stops being worth it even for the stronger side, which
    // is what stops the endless-grind stalemates the old model produced.
    const losing = ratio < 1;
    if (losing) {
      push(out, 'propose_ceasefire', 20 * peaceAppetite(ctx.exhaustion), 'losing the war');
      push(out, 'propose_peace', 12 * peaceAppetite(ctx.exhaustion), 'wants out');
    } else {
      push(out, 'propose_ceasefire', 4, 'pressing an advantage');
      if (ctx.exhaustion > 8) {
        push(out, 'propose_peace', 6 * peaceAppetite(ctx.exhaustion), 'war-weary');
      }
    }
    // A long war drags its own conclusion, winner or not: even the stronger
    // side pays for it, and without this term AI wars never actually end.
    if (ctx.turnsSince > 12) {
      push(out, 'propose_peace', ctx.turnsSince - 12, `war has run ${ctx.turnsSince} turns`);
    }
  } else if (ctx.status === 'peace' || ctx.status === 'ceasefire') {
    // Courting. Value scales with how well they think of us and how much we
    // want something from them. Deliberately NOT offered to an existing ally:
    // an alliance is already a closer relationship than a trade pact, so
    // proposing one to them was pure noise (and used to outscore a genuine
    // reason to break the alliance).
    const courtship = 6 + (goodwill / 20) + (fear / 25);
    push(out, 'offer_open_borders', courtship - 4, 'wants their trust');
    push(out, 'propose_trade_agreement', courtship * 0.9, 'wants their trade');
    push(out, 'propose_non_aggression', courtship * 0.7 + fear / 20, 'wants peace of mind');

    // Alliance: the strategic case the old flat −10 never had.
    if (ctx.sharedEnemy) {
      push(out, 'propose_alliance', 30, 'we share an enemy');
    } else if (ctx.opinion.respect > 40) {
      push(out, 'propose_alliance', 12, 'they keep their word');
    }
    if (ctx.treaties.includes('mutual_defense')) {
      push(out, 'propose_alliance', 6, 'we already defend each other');
    }

    // Tribute: only worth trying when we are clearly stronger AND they are
    // actually afraid. That combination is what makes it feel calculated
    // instead of random.
    if (ratio > 2 && fear > 30) {
      push(out, 'demand_tribute', (ratio - 1) * 8 + fear / 12 - 8, 'they are weaker and afraid');
    }

    // War. Gated hard, then scored by how much the target is worth.
    const gate = mayDeclareWar(ctx);
    if (gate.ok) {
      // Two things must both be true: the target has to be worth taking, AND
      // this civ has to want to. Multiplying a linear "worth" by a small
      // personality fraction was not enough — a defensive_turtle at 5:1 still
      // cleared the bar, which is the "always aggressive" complaint. Temperament
      // is now a gate that can reach zero, and a turtle therefore never opens a
      // war of conquest at all (as in the old profile-gated model), while a
      // military civ is not much discouraged.
      const appetite = warAppetite(ctx.exhaustion) * temperament(ctx.weights);
      const targetWorth = Math.max(0, ratio - 1.6) * 25;
      // Every war already being fought makes the next one less appealing.
      const warFatigue = ctx.activeWars * 12;
      const worth = targetWorth * appetite
        - warFatigue
        - grievance / 8
        - fear / 20;
      if (ctx.sharedEnemy) {
        push(out, 'declare_war', worth + 12, 'removing a rival from a shared front');
      } else {
        push(out, 'declare_war', worth, `strength margin ${ratio.toFixed(2)}`);
      }
    }
  }

  if (ctx.status === 'alliance') {
    // An alliance has exactly one live question: is it still worth keeping?
    // Betray a partner we have come to fear or resent — but never for a whim.
    // This replaces a flat 40% coin-flip on hostile attitude plus an 8% roll
    // for "aggressive leaders backstab after a while", which is why alliances
    // used to feel arbitrary. Now it is arithmetic a test can pin.
    // Each reason to break is clamped at zero: having no fear and no grievance
    // is NEUTRAL, not a penalty. (They used to contribute a phantom −13 for a
    // civ that had never been given a reason to be unhappy.)
    const becauseFrightened = Math.max(0, (fear - 35) / 4);
    const becauseResentful = Math.max(0, (grievance - 20) / 5);
    // Only being the weaker party gives a reason to STAY — needing your ally.
    const becauseNeeded = -Math.max(0, 1.5 - ratio) * 4;
    const loyaltyBrake = -(ctx.weights.loyalty / 10) * 4;
    const betrayal = becauseFrightened + becauseResentful + becauseNeeded + loyaltyBrake;
    push(out, 'break_alliance', betrayal, 'the alliance has stopped being worth it');
    // A warlike leader eventually stops needing a partner it has outgrown; a
    // diplomatic one never does, and that difference is the whole point.
    if (ctx.turnsSince > 15) {
      const restlessness = (ctx.turnsSince - 15) * 1.2 * (ctx.weights.warmongering / 10);
      push(out, 'break_alliance', restlessness, `alliance is ${ctx.turnsSince} turns old`);
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Pick the action to take: highest score above the act threshold, with a
 * deterministic ±2 tiebreak so two equally-sensible options do not always
 * resolve the same way but still replay identically.
 */
/**
 * Deterministic tiebreak, deliberately tiny (±0.5). At the ±2 it started at, a
 * 0.8-point margin could be flipped by noise — which would reintroduce exactly
 * the "feels random" behaviour the scored model exists to remove. Noise breaks
 * ties between near-equal options; it never decides anything on its own.
 */
const TIEBREAK_AMPLITUDE = 0.5;

export function chooseAction(candidates: DiplomaticCandidate[], ctx: PolicyContext): DiplomaticCandidate | null {
  for (const candidate of candidates) {
    const jitter = seededNoise([ctx.civId, ctx.otherId, candidate.action, ctx.round, ctx.sequence]) * TIEBREAK_AMPLITUDE;
    if (candidate.score + jitter >= actThreshold(candidate.action)) {
      return { ...candidate, score: Math.round((candidate.score + jitter) * 100) / 100 };
    }
  }
  return null;
}

/** Per-turn wear: fighting costs, peace heals. Keeps stalemates resolving. */
export function exhaustionDelta(status: DiplomaticStatus, atWarWithAllies: boolean): number {
  if (status === 'war') return atWarWithAllies ? 1.5 : 1;
  return -0.5;
}

export const EXHAUSTION_MAX = 20;
