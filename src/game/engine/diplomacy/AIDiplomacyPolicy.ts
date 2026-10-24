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
import { pickFavourableSwap, type TechTradeContext } from './TechTradeEvaluator';

/**
 * A `PolicyContext` is the deliberation's own shape; the trade evaluator wants
 * a narrower one. Rather than widen the evaluator to every field a policy
 * happens to carry, the two are joined here — so the arithmetic stays readable
 * on both sides of the seam.
 */
function tradeContextFrom(ctx: PolicyContext): TechTradeContext {
  return {
    civId: ctx.civId,
    otherId: ctx.otherId,
    weights: ctx.weights,
    status: ctx.status,
    exhaustion: ctx.exhaustion,
    ourTechCount: ctx.ourTechCount ?? 0,
    theirTechCount: ctx.theirTechCount ?? 0,
    strengthRatio: ctx.ownStrength / Math.max(ctx.theirStrength, 1),
    round: ctx.round,
    sequence: ctx.sequence,
  };
}

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
  /** The other civ's treasury — what they can afford to give or be asked for. */
  theirGold?: number;
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
  /**
   * Calendar year, for the late-game push. Optional so a caller with no
   * calendar (and every existing test) keeps the early-game behaviour.
   */
  currentYear?: number;
  /** Techs this civ has that the other lacks (Exchange of Knowledge supply). */
  techsWeCanOffer?: string[];
  /** Techs the other has that this civ lacks (Exchange of Knowledge demand). */
  techsWeWant?: string[];
  /** How many technologies each side holds — "who is already ahead". */
  ourTechCount?: number;
  theirTechCount?: number;
  /**
   * Whether an embassy exists with this counterpart. Civ I: knowledge is only
   * exchanged through a working diplomatic channel, so a civ with no embassy
   * never proposes an Exchange of Knowledge — the player has to found one.
   */
  hasEmbassy?: boolean;
  /**
   * Whether the two courts have diplomats standing together. Knowledge is
   * only ever handed over face to face, so a civ whose diplomats are far
   * away does not put a technology on the table.
   */
  hasDiplomatContact?: boolean;
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
 *
 * `currentYear` is optional: as the calendar runs out a civ can afford one
 * more front, because a rival left standing at the end of the game wins by
 * default. The base (no year) behaviour is unchanged.
 */
export function maxConcurrentWars(weights: DiplomaticWeights, currentYear?: number): number {
  const base = 1 + Math.floor((weights.warmongering - 1) / 3);
  if (currentYear === undefined) return base;
  if (currentYear >= 1750) return base + 2;
  if (currentYear >= 1000) return base + 1;
  return base;
}

/**
 * How much weaker than us a target has to be before conquering it is worth a
 * war. Early on only a clearly weaker neighbour qualifies (1.6×); as the
 * calendar runs out the margin closes, because holding peace while a rival
 * outgrows you is itself a loss — at 1500 AD a near-parity target is fair
 * game.
 */
export function warTargetMargin(currentYear?: number): number {
  if (currentYear === undefined) return 1.6;
  if (currentYear >= 1500) return 1.1;
  if (currentYear >= 1000) return 1.25;
  if (currentYear >= 0) return 1.4;
  return 1.6;
}

/**
 * Flat late-game push added to a war's score — the diplomacy-side twin of
 * `AIAggression.lateGameAggression`, so the declaration model and the
 * aggression model lean the same way as the game ages.
 */
export function lateGameWarPush(currentYear?: number): number {
  if (currentYear === undefined) return 0;
  if (currentYear >= 1750) return 10;
  if (currentYear >= 1500) return 7;
  if (currentYear >= 1000) return 4;
  if (currentYear >= 0) return 2;
  return 0;
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
  /**
   * Founding an embassy is the cheapest thing a civ can do and the gateway to
   * every term below — without a channel there is no Exchange of Knowledge at
   * all. Low bar on purpose: it must not lose to a marginal treaty pitch.
   */
  establish_embassy: 3,
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

    // Open a channel first. Everything below — and the player's own
    // negotiation screen — stays locked until an embassy exists, so a civ that
    // has not founded one is being polite with nowhere to sit down. A
    // diplomatic civ hurries; a xenophobic one dawdles.
    if (ctx.hasEmbassy === false) {
      push(
        out,
        'establish_embassy',
        4 + (ctx.weights.trustSensitivity / 10) * 4 - (ctx.weights.xenophobia / 10) * 4,
        'no channel to this court yet',
      );
    }

    // Exchange of Knowledge (Civ I): only when both sides hold something the
    // other lacks AND a diplomatic channel exists. `hasEmbassy === false` is
    // the explicit "no channel yet" case; a bare policy context (tests) leaves
    // it unset and is allowed.
    //
    // The score is no longer "you both hold something the other lacks", which
    // proposed swaps that left the civ worse off — it is the evaluator's own
    // arithmetic (what we receive minus what we give, weighted by what that
    // kind of knowledge is worth right now, against the margin this personality
    // demands). A swap that cannot clear its margin is not a candidate at all.
    const canOffer = ctx.techsWeCanOffer?.length ?? 0;
    const canWant = ctx.techsWeWant?.length ?? 0;
    // Knowledge changes hands face to face: no diplomats together, no deal.
    const canDeal = ctx.hasEmbassy !== false && ctx.hasDiplomatContact !== false;
    if (canOffer > 0 && canWant > 0 && canDeal) {
      const tradeCtx = tradeContextFrom(ctx);
      const pick = pickFavourableSwap(ctx.techsWeCanOffer ?? [], ctx.techsWeWant ?? [], tradeCtx);
      if (pick) {
        push(
          out,
          'offer_tech_exchange',
          // The margin the civ demanded is already inside `score`, so the
          // policy's own scale only needs to rank it against the treaties.
          10 + pick.verdict.score / 4 + goodwill / 15,
          `${pick.verdict.because}; we each hold ${Math.min(canOffer, canWant)} tech${Math.min(canOffer, canWant) === 1 ? '' : 's'} the other lacks`,
        );
      }
    }

    // One-sided terms (a sale or a gift) only when no favourable swap was
    // available: a swap that clears its margin takes priority over selling or
    // giving knowledge away. These ride on `offer_tech_exchange` so the
    // negotiation screen can fill in the gold and the technology.
    const swapPick = (canOffer > 0 && canWant > 0 && canDeal)
      ? pickFavourableSwap(ctx.techsWeCanOffer ?? [], ctx.techsWeWant ?? [], tradeContextFrom(ctx))
      : null;
    if (!swapPick && canDeal && canOffer > 0) {
      const ourGold = ctx.ownGold ?? 0;
      const theirGold = ctx.theirGold ?? 0;
      if (ourGold < 120 && theirGold >= 100) {
        push(
          out,
          'offer_tech_exchange',
          5,
          'our treasury is thin and they can pay',
        );
      }
      if (goodwill > 60) {
        push(
          out,
          'offer_tech_exchange',
          6 + goodwill / 12,
          'goodwill too great to charge for it',
        );
      }
    }

    // Knowledge for money. A civ that is ahead in learning has something the
    // other court wants and can name a price for it; a civ that is behind can
    // buy what it lacks.
    if (canDeal && (canOffer > 0 || canWant > 0)) {
      const ourTechs = ctx.ourTechCount ?? 0;
      const theirTechs = ctx.theirTechCount ?? 0;
      if (canOffer > 0 && ourTechs > theirTechs) {
        push(
          out,
          'offer_tech_for_gold',
          5 + (ourTechs - theirTechs) * 2,
          'we are ahead in learning and can sell a secret',
        );
      } else if (canWant > 0 && ctx.ownGold > 120) {
        push(
          out,
          'offer_tech_for_gold',
          4 + Math.min(6, ctx.ownGold / 150),
          'we want what they know and can pay for it',
        );
      }
    }

    // A gift of knowledge buys goodwill that gold cannot buy: the receiver
    // learns something it could not have learned cheaply, and gets nothing
    // but goodwill for it. A court that likes us is worth a gift.
    if (canDeal && canOffer > 0 && goodwill > 35) {
      push(
        out,
        'gift_technology',
        6 + goodwill / 12,
        'we are friends and we can share what we know',
      );
    }

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

    // Gold gifting: when the relationship is very good and we have surplus,
    // a gift reinforces the bond. Scaled by how much gold we can spare.
    if (goodwill > 50 && ctx.ownGold > 100) {
      push(out, 'gift_gold', 8 + goodwill / 10 + Math.min(10, ctx.ownGold / 100), 'we are friends and have surplus');
    }

    // Gold requesting: when the relationship is good (they're likely to say yes)
    // or when we are much stronger militarily (can threaten war).
    const theirGold = ctx.theirGold ?? 0;
    if ((goodwill > 30 && theirGold > 50) || (ratio > 2.5 && theirGold > 80)) {
      push(out, 'request_gold', 6 + (goodwill > 30 ? goodwill / 15 : 0) + (ratio > 2.5 ? (ratio - 1) * 4 : 0) - 6, goodwill > 30 ? 'they trust us enough' : 'we can threaten them');
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
      const targetWorth = Math.max(0, ratio - warTargetMargin(ctx.currentYear)) * 25;
      // Every war already being fought makes the next one less appealing.
      const warFatigue = ctx.activeWars * 12;
      const endgamePush = lateGameWarPush(ctx.currentYear);
      const worth = targetWorth * appetite
        - warFatigue
        - grievance / 8
        - fear / 20
        + endgamePush;
      if (ctx.sharedEnemy) {
        push(out, 'declare_war', worth + 12, 'removing a rival from a shared front');
      } else {
        push(out, 'declare_war', worth,
          `strength margin ${ratio.toFixed(2)}${endgamePush > 0 ? `, endgame push +${endgamePush}` : ''}`);
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
