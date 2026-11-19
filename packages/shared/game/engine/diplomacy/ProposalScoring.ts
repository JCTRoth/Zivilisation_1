/**
 * ProposalScoring — the accept/refuse arithmetic, shared by the engine and the UI.
 *
 * The old rule was `Math.random() * 100 < willingness`, where `willingness`
 * ignored the proposal's actual terms: a 500-gold demand and a 5-gold demand
 * had exactly the same odds, and refusing cost nothing, so clicking the button
 * again was free. That is the "feels random" complaint in one line of code.
 *
 * Now the decision is a readable sum with a personality-scaled bar, and only
 * ±5 points of it are noise — seeded from the pair, round and action, so the
 * same game replays identically and tests never have to mock Math.random.
 */

import type {
  DiplomaticStatus,
  DiplomacyProposal,
  Opinion,
  ProposalEvaluation,
  ScoreFactor,
  TreatyType,
} from '../DiplomacyTypes';
import type { DiplomaticWeights } from './DiplomaticWeights';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';

/** Base beaker cost of a tech id (0 if unknown — scoring still works). */
function techBaseCost(techId: string): number {
  return TECHNOLOGIES_DATA.find((t) => t.id === techId)?.cost ?? 50;
}

/** How goodwill converts to willingness, per action. */
const GOODWILL_WEIGHT: Record<string, number> = {
  propose_peace: 0.12,
  propose_ceasefire: 0.10,
  propose_alliance: 0.30,
  demand_tribute: 0.10,
  offer_gift: 0.30,
  gift_gold: 0.25,
  request_gold: 0.30,
  offer_open_borders: 0.08,
  propose_trade_agreement: 0.12,
  propose_mutual_defense: 0.26,
  propose_non_aggression: 0.18,
  propose_embargo: 0.14,
  offer_tech_exchange: 0.16,
  offer_tech_for_gold: 0.20,
  gift_technology: 0.35,
  call_for_help: 0.30,
  propose_joint_war: 0.24,
  incite_revolt: 0.06,
};

/** Starting willingness by action, before any context. */
const BASE_WILLINGNESS: Record<string, number> = {
  propose_peace: 18,
  propose_ceasefire: 26,
  propose_alliance: 2,
  demand_tribute: -18,
  // A gift of gold is not a negotiation: the responder keeps the money and
  // may refuse the giver, but the money itself is never the obstacle.
  offer_gift: 20,
  gift_gold: 20,
  // Asking for money is an imposition. It is accepted out of friendship or out
  // of fear — never out of goodwill of the responder's own accord.
  request_gold: -12,
  offer_open_borders: 8,
  propose_trade_agreement: 12,
  propose_mutual_defense: -4,
  propose_non_aggression: 18,
  propose_embargo: -6,
  offer_tech_exchange: 10,
  offer_tech_for_gold: 8,
  gift_technology: 10,
  call_for_help: 0,
  propose_joint_war: -2,
  incite_revolt: -10,
};

/** Grievance at which pride simply refuses the deal, whatever the score. */
const PRIDE_VETO = 85;

/** Ceiling on the raw power-ratio nudge, in points. */
const POWER_TERM_CAP = 25;

export interface ProposalContext {
  /** The civ deciding on the proposal. */
  responder: number;
  /** The civ that made it. */
  proposer: number;
  action: string;
  /** Opinion the RESPONDER holds of the proposer. */
  opinion: Opinion;
  weights: DiplomaticWeights;
  status: DiplomaticStatus;
  treaties: TreatyType[];
  /** Responder's military strength. */
  ownStrength: number;
  /** Proposer's military strength. */
  theirStrength: number;
  /** Responder's treasury — what they can actually afford to be asked for. */
  ownGold: number;
  /** Gold named in the proposal (demand or gift). */
  goldAmount?: number;
  /** Both civs currently share this enemy — the reason to ally. */
  sharedEnemy?: boolean;
  /** How many wars the responder is already fighting. */
  activeWars?: number;
  /** How many wars the responder's temperament permits. */
  maxWars?: number;
  /** The responder's war wear, 0…EXHAUSTION_MAX. */
  exhaustion?: number;
  /**
   * The strength of the third party a proposal names — the enemy an ally is
   * being called to fight. Zero when the proposal names nobody.
   */
  targetStrength?: number;
  /** Round, for refusal memory and the seeded noise. */
  round: number;
  /** Extra entropy so repeated identical proposals vary a little. */
  sequence: number;
}

/**
 * Bounded, deterministic noise in [-1, 1] from the pair/round/action/sequence.
 * FNV-1a over the parts, then a final avalanche — the same trick the village
 * decision roll uses, for the same reason: reproducibility without a PRNG
 * instance.
 */
export function seededNoise(parts: Array<string | number>): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** The bar the score has to clear, tilted by personality. */
function thresholdFor(weights: DiplomaticWeights): number {
  // A trusting civ accepts slightly more; a greedy one demands better terms.
  return (weights.trustSensitivity - 5) * 1.2 - (weights.greed - 5) * 0.8;
}

/**
 * What a given sum of gold is worth to the responder, in points. This is the
 * term the old model lacked entirely: the same demand is routine for a
 * treasury of 800 and impossible for one holding 40.
 */
function goldTermValue(amount: number, weights: DiplomaticWeights, ownGold: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  // How many "ordinary asks" this is, saturating. 60 gold ≈ 1 ask.
  const asks = amount / 60;
  const saturation = asks / (1 + asks);
  // Tolerance scales with wealth, and a greedy civ tolerates more.
  const tolerance = 20 + ownGold * 0.02 + (weights.greed - 5) * 2;
  return -(saturation * 200) / Math.max(8, tolerance);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Score a proposal without resolving it. `noise` is 0 for previews and for
 * human-accepted offers (the player's decision IS the answer there).
 */
export function evaluateProposal(
  ctx: ProposalContext,
  proposal: DiplomacyProposal,
  noiseAmount: number,
): ProposalEvaluation {
  const { opinion, weights, status, action } = ctx;
  const factors: ScoreFactor[] = [];

  const base = BASE_WILLINGNESS[action] ?? 0;
  factors.push({ label: 'base appetite', value: base });

  // Power. The proposer being stronger is what makes threats work; the
  // responder being stronger is what makes peace offers work.
  const ratio = ctx.theirStrength / Math.max(1, ctx.ownStrength);
  // Capped on purpose. An uncapped `(ratio - 1) * 22` gave +110 at 6:1, which
  // made the size of the ask irrelevant — a pauper paid a fortune because the
  // proposer simply had a bigger army. Fear is the proper channel for pressure
  // (see below); the raw ratio is only a nudge, and how much a civ will pay is
  // decided by the gold term.
  if (action === 'demand_tribute') {
    factors.push({ label: 'they can hurt me', value: round2(Math.min(POWER_TERM_CAP, (ratio - 1) * 12)) });
  } else if (action === 'request_gold') {
    // A request is answered by a court that can be leaned on. The size of the
    // asker's army is half the threat, and the other half is the fear meter.
    factors.push({ label: 'they can hurt me', value: round2(Math.min(POWER_TERM_CAP, (ratio - 1) * 12)) });
  } else if (action === 'propose_peace' || action === 'propose_ceasefire') {
    factors.push({ label: 'I am losing', value: round2(Math.min(POWER_TERM_CAP, (ratio - 1) * 14)) });
  } else if (action === 'offer_open_borders' || action === 'propose_non_aggression') {
    factors.push({ label: 'they are the stronger neighbour', value: round2(Math.max(-8, (1 - ratio) * 8)) });
  } else {
    factors.push({ label: 'power balance', value: round2(Math.max(-8, Math.min(8, (ratio - 1) * 4))) });
  }

  // Goodwill does the work the old brokenTreaties × 15 was doing, but through
  // the single ledger and scaled per action.
  const goodwillWeight = GOODWILL_WEIGHT[action] ?? 0.1;
  factors.push({ label: 'what they think of me', value: round2(opinion.goodwill * goodwillWeight) });

  // An alliance with a shared enemy is the strategic case that used to be
  // worth nothing (it was a flat −10).
  if (ctx.sharedEnemy && (action === 'propose_alliance' || action === 'propose_mutual_defense')) {
    factors.push({ label: 'we share an enemy', value: 20 });
  }

  // A call for help. The enemy that is hurting one of us is asking to hurt
  // the other as well, so the case for answering is obvious — but an ally
  // weighs it like any other war, and a court already fighting two wars, worn
  // down to a stub, or facing an enemy it cannot beat says no.
  if (action === 'call_for_help' || action === 'propose_joint_war') {
    factors.push({
      label: 'our friend is in the war already',
      value: action === 'call_for_help' ? 18 : 12,
    });
    if (ctx.treaties.includes('mutual_defense')) {
      factors.push({ label: 'we have a defence pact', value: 12 });
    }
    if ((ctx.activeWars ?? 0) >= (ctx.maxWars ?? 99)) {
      factors.push({ label: 'we have no capacity for another front', value: -30 });
    }
    if ((ctx.exhaustion ?? 0) >= 14) {
      factors.push({ label: 'we are worn down from war', value: -20 });
    }
    if (
      typeof ctx.targetStrength === 'number'
      && ctx.targetStrength > 0
      && ctx.targetStrength > ctx.ownStrength * 1.8
    ) {
      factors.push({ label: 'the enemy outclasses us', value: -25 });
    }
  }

  // Fear makes demands payable and pacts attractive.
  if (action === 'demand_tribute') {
    factors.push({ label: 'fear of them', value: round2((opinion.fear / 100) * 12) });
  }
  // A gift is one-sided and cannot be negotiated: the money is the offer, and
  // refusing it would be refusing a kindness. A court that despises the giver
  // may still spurn it, but nobody has to be talked into accepting one.

  // Terms. A demand is a cost; a gift is a sweetener. The actions that have
  // their own gold arithmetic below are excluded here so that the same gold is
  // never counted twice — and, more importantly, so that a payment is scored
  // from the point of view of whoever actually pays it.
  if (
    typeof proposal.goldAmount === 'number'
    && proposal.goldAmount > 0
    && action !== 'offer_gift'
    && action !== 'gift_gold'
    && action !== 'request_gold'
    && action !== 'offer_tech_exchange'
    && action !== 'gift_technology'
  ) {
    const goldValue = goldTermValue(proposal.goldAmount, weights, ctx.ownGold);
    if (action === 'demand_tribute') {
      factors.push({ label: `demanding ${Math.round(proposal.goldAmount)} gold`, value: round2(goldValue) });
      // Asking for more than they can spare is a different act from asking for
      // a contribution, and needs to be refused on that ground alone — the
      // saturation term above is too gentle to say so by itself.
      const beyondSparing = (proposal.goldAmount - ctx.ownGold * 1.5) / Math.max(10, ctx.ownGold);
      if (beyondSparing > 0) {
        factors.push({
          label: 'more than they can spare',
          value: round2(-30 * Math.min(1, beyondSparing)),
        });
      }
    } else {
      // Trade pips and gifts are worth having.
      factors.push({ label: `${Math.round(proposal.goldAmount)} gold/turn offered`, value: round2(-goldValue * 0.6) });
    }
  }

  // A gift of money: the responder keeps it, so the only question is whether
  // the size of the gesture makes it worth accepting. A bigger gift is a
  // friendlier gift.
  if (action === 'offer_gift' || action === 'gift_gold') {
    if (typeof proposal.goldAmount === 'number' && proposal.goldAmount > 0) {
      const goldValue = goldTermValue(proposal.goldAmount, weights, ctx.ownGold);
      factors.push({ label: `${Math.round(proposal.goldAmount)} gold offered`, value: round2(-goldValue * 0.6) });
    }
  }

  // A request for money is the one proposal the responder can accept for two
  // very different reasons, and the difference matters: a court that likes the
  // asker pays out of friendship, and a court that fears the asker pays to
  // keep the peace. Personality decides how much each of those is worth.
  if (action === 'request_gold') {
    const friendship = 0.5 + weights.trustSensitivity / 10;
    const dread = 0.6 + (weights.paranoia ?? 5) / 10;
    factors.push({ label: 'our friendship', value: round2((opinion.goodwill / 100) * 34 * friendship) });
    factors.push({ label: 'fear of them', value: round2((opinion.fear / 100) * 24 * dread) });
    if (status === 'war') {
      // Money is what buys the peace.
      factors.push({ label: 'pay to end the war', value: 20 });
    }
    if (typeof proposal.goldAmount === 'number' && proposal.goldAmount > 0) {
      const goldValue = goldTermValue(proposal.goldAmount, weights, ctx.ownGold);
      factors.push({ label: `asking us for ${Math.round(proposal.goldAmount)} gold`, value: round2(goldValue) });
      const beyondSparing = (proposal.goldAmount - ctx.ownGold * 1.5) / Math.max(10, ctx.ownGold);
      if (beyondSparing > 0) {
        factors.push({
          label: 'more than they can spare',
          value: round2(-45 * Math.min(1, beyondSparing)),
        });
      }
    }
  }

  if (action === 'gift_technology') {
    // A gift of knowledge: pure generosity, no price attached. The knowledge
    // itself is worth something to the receiver, and the relationship decides
    // whether a court accepts charity from this particular giver at all.
    if (status === 'war') {
      factors.push({ label: 'at war — no trade', value: -80 });
    } else {
      const value = techBaseCost(proposal.techOffered ?? '');
      factors.push({ label: 'a gift of knowledge', value: round2(2 + value / 25) });
    }
  } else if (proposal.techOffered && proposal.techRequested) {
    // Civ I: no Exchange of Knowledge while the guns are still firing.
    if (status === 'war') {
      factors.push({ label: 'at war — no trade', value: -80 });
    } else {
      // Fairness by research cost: equal costs are a clean swap; giving a
      // cheaper tech for a pricier one is what they want; the reverse is what
      // they refuse. Base +8 is the old flat term, scaled by the cost ratio.
      const costOffered = techBaseCost(proposal.techOffered);
      const costRequested = techBaseCost(proposal.techRequested);
      const ratio = costOffered / Math.max(1, costRequested);
      // ratio 1.0 → 0; ratio 2.0 (twice as valuable for them) → +16; 0.5 → −8
      const fairness = Math.round((ratio - 1) * 16);
      factors.push({
        label: fairness >= 0 ? 'technology exchange (fair or better)' : 'technology exchange (uneven)',
        value: 8 + fairness,
      });
      // Gold on top of the swap buys back an uneven trade: ~100 gold ≈ +4.
      if (typeof proposal.goldAmount === 'number' && proposal.goldAmount > 0) {
        const sweetener = Math.min(16, Math.round(proposal.goldAmount / 25));
        factors.push({ label: `${Math.round(proposal.goldAmount)} gold sweetens the trade`, value: sweetener });
      }
    }
  } else if (proposal.techOffered || proposal.techRequested) {
    // A one-sided deal: knowledge for money. WHO pays decides how the
    // responder reads the price — a seller wants a high price, a buyer does
    // not.
    if (status === 'war') {
      factors.push({ label: 'at war — no trade', value: -80 });
    } else if (typeof proposal.goldAmount === 'number' && proposal.goldAmount > 0) {
      const techId = (proposal.techRequested ?? proposal.techOffered) as string;
      const price = techBaseCost(techId);
      const ratio = proposal.goldAmount / Math.max(1, price);
      // The proposer sells (it names the tech it wants) → the responder is
      // selling, and a high price is good news. The responder sells (the
      // proposer names the tech it gives) → the responder is buying, and a
      // high price is a bill.
      const responderIsSeller = !proposal.techOffered;
      const fairness = responderIsSeller
        ? Math.round((ratio - 1) * 20)
        : Math.round((1 - ratio) * 20);
      factors.push({
        label: fairness >= 0 ? 'technology at a fair price' : 'technology at a bad price',
        value: 6 + fairness,
      });
    } else {
      factors.push({ label: 'a free technology is never given away', value: -60 });
    }
  }

  // Memory. Refusals and grievance are what stop proposal spam working.
  if (opinion.offersRefused > 0) {
    factors.push({
      label: `refused their last ${opinion.offersRefused} offer${opinion.offersRefused === 1 ? '' : 's'}`,
      value: round2(-opinion.offersRefused * 5),
    });
  }
  if (opinion.grievance > 0) {
    factors.push({ label: 'unresolved grievance', value: round2(-opinion.grievance * 0.25) });
  }

  // A peace offer into an active war is worth a lot more than into peace.
  if (status === 'war' && (action === 'propose_peace' || action === 'propose_ceasefire')) {
    factors.push({ label: 'we are still at war', value: 12 });
  }

  const score = factors.reduce((sum, f) => sum + f.value, 0);
  const threshold = thresholdFor(weights);
  const vetoed = opinion.grievance >= PRIDE_VETO
    && (action === 'demand_tribute' || action === 'propose_alliance');

  // Decisive factor = the largest absolute contributor that is not the base
  // appetite, which is what a player wants to read in one line.
  let decisive = 'even footing';
  let best = -1;
  for (const f of factors) {
    if (f.label === 'base appetite') continue;
    if (Math.abs(f.value) > best) {
      best = Math.abs(f.value);
      decisive = f.value >= 0 ? `${f.label} (+${f.value})` : `${f.label} (${f.value})`;
    }
  }

  const noise = round2(noiseAmount);
  const accepted = !vetoed && score + noise > threshold;
  return {
    accepted,
    score: round2(score),
    threshold: round2(threshold),
    noise,
    factors,
    decisiveFactor: decisive,
    vetoed,
  };
}

/** Noise amplitude: ±5 points. Enough for variety, far too little to dominate. */
const NOISE_AMPLITUDE = 5;

export function proposalNoise(ctx: ProposalContext, proposer: number): number {
  return seededNoise([proposer, ctx.responder, ctx.action, ctx.round, ctx.sequence]) * NOISE_AMPLITUDE;
}

/** Wording for a refusal, so the reason matches the mood of the ledger. */
export function rejectionReason(evaluation: ProposalEvaluation, opinion: Opinion): string {
  if (evaluation.vetoed) return 'Pride forbids it — too many insults to answer.';
  if (opinion.fear < 25) return 'We have no interest in dealing with you!';
  if (evaluation.score < 0) return 'Your terms make no sense to us.';
  if (opinion.offersRefused >= 2) return 'We have grown tired of your proposals.';
  return 'Perhaps another time.';
}
