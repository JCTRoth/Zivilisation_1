/**
 * TechTradeEvaluator — is this Exchange of Knowledge worth doing?
 *
 * `pickTechSwap` used to be mechanical: hand over the cheapest thing we hold,
 * ask for the dearest thing they hold. That picks a pair, but it never asks the
 * only question that matters — whether the trade leaves us better off. A civ
 * that gives away Iron Working for Alphabet is being robbed, and the old code
 * would have called it a fair swap because Alphabet is what it lacked.
 *
 * So the swap is now valued the way the rest of the diplomacy model scores an
 * act: what we receive, minus what we give, each weighted by what that kind of
 * knowledge is worth to us *right now*. A military secret is worth more while
 * a war is brewing or while the enemy outnumbers us; an economic one is worth
 * more in peace, when there is time to build what it unlocks. Governance and
 * science compound either way.
 *
 * On top of that sits a margin the civ demands, drawn from its personality: a
 * greedy or suspicious court wants something extra for its knowledge, a
 * trusting one will settle for an even trade, and a civ that is already ahead
 * in learning can afford to be generous — it has more to give and less to gain.
 *
 * Pure functions and a stateless class — the caller assembles the context, so
 * a test can pin the arithmetic without standing up an engine.
 */

import type { DiplomaticStatus } from '../DiplomacyTypes';
import type { DiplomaticWeights } from './DiplomaticWeights';
import { TECHNOLOGIES_DATA } from '../../../data/TechnologyData';

/** What a technology is *for* — which decides when it is worth more. */
export type TechFlavour = 'military' | 'economic' | 'civic' | 'science';

/**
 * Classification by id. Deliberately explicit rather than derived from the
 * description text: a designer can read this table and move a tech, and a test
 * can assert where something landed without regexing prose.
 */
const FLAVOUR: Record<string, TechFlavour> = {
  // Spears, siege engines, armour, and the explosives that obsolete them.
  bronze_working: 'military',
  iron_working: 'military',
  the_wheel: 'military',
  mathematics: 'military',
  horseback_riding: 'military',
  engineering: 'military',
  metallurgy: 'military',
  gunpowder: 'military',
  steel: 'military',
  combustion: 'military',
  flight: 'military',
  nuclear_power: 'military',
  nuclear_fission: 'military',

  // Granaries, walls, harbours, workshops — everything that fills the box.
  pottery: 'economic',
  masonry: 'economic',
  sailing: 'economic',
  map_making: 'economic',
  construction: 'economic',
  currency: 'economic',
  trade: 'economic',
  banking: 'economic',
  industrialization: 'economic',
  railroad: 'economic',
  automobile: 'economic',
  mass_production: 'economic',
  navigation: 'economic',
  magnetism: 'economic',

  // Laws, faiths, and the shape of the state.
  ceremonial_burial: 'civic',
  mysticism: 'civic',
  code_of_laws: 'civic',
  monarchy: 'civic',
  republic: 'civic',
  democracy: 'civic',
  communism: 'civic',
  religion: 'civic',
  theology: 'civic',
  monotheism: 'civic',
  polytheism: 'civic',
  medicine: 'civic',
  genetic_engineering: 'civic',

  // Everything that makes the academies faster, plus the endgame sciences.
  alphabet: 'science',
  writing: 'science',
  literacy: 'science',
  philosophy: 'science',
  astronomy: 'science',
  theory_of_gravity: 'science',
  university: 'science',
  invention: 'science',
  science_theory: 'science',
  electricity: 'science',
  electronics: 'science',
  computers: 'science',
  space_flight: 'science',
  moonshot: 'science',
};

export function techFlavour(techId: string): TechFlavour {
  return FLAVOUR[techId] ?? 'science';
}

export interface TechTradeProposal {
  /** What the proposing civ hands over. */
  techOffered: string;
  /** What it wants back. */
  techRequested: string;
}

export interface TechTradeContext {
  civId: number;
  otherId: number;
  weights: DiplomaticWeights;
  status: DiplomaticStatus;
  /** Rounds of war wear, 0…EXHAUSTION_MAX. */
  exhaustion: number;
  /** How many technologies each side holds — "who is already ahead". */
  ourTechCount: number;
  theirTechCount: number;
  /** Our military strength divided by theirs (>= 1 means we are stronger). */
  strengthRatio: number;
  /** Round number, for the seeded tiebreak. */
  round: number;
  sequence: number;
}

/**
 * One term of the arithmetic. Not exported: consumers read it off
 * `verdict.factors`, and nobody needs to name the type to do that.
 */
interface TechTradeFactor {
  label: string;
  value: number;
}

export interface TechTradeVerdict {
  /** Whether the proposer comes out ahead once the margin is applied. */
  favourable: boolean;
  /** Net value minus the margin the civ demands. */
  score: number;
  /** The margin this personality demands before it will part with knowledge. */
  threshold: number;
  /** What we receive, minus what we give, before the margin. */
  netValue: number;
  /** The arithmetic, in the order it was summed — for the log and for tests. */
  factors: TechTradeFactor[];
  /** The single largest term, in one line. */
  because: string;
}

const DEFAULT_COST = 50;

/**
 * Where a personality trait sits on the 1..10 scale when it is not known.
 * Neutral is the honest default: an unreadable trait must not tip a trade one
 * way or the other.
 */
const NEUTRAL_TRAIT = 5;

function costOf(techId: string): number {
  return TECHNOLOGIES_DATA.find((t) => t.id === techId)?.cost ?? DEFAULT_COST;
}

/**
 * How much more (or less) a technology is worth to this civ than its research
 * cost suggests, given the world it is walking into.
 *
 * Multipliers sit around 1.0 so cost stays the dominant term — this tilts a
 * trade, it does not invent one.
 */
function contextMultiplier(flavour: TechFlavour, ctx: TechTradeContext): number {
  switch (flavour) {
    case 'military':
      // Knowledge of weapons is worth paying for when the guns are pointed at
      // you, and worth little when nobody is fighting.
      if (ctx.status === 'war') return 1.4;
      return ctx.strengthRatio < 1 ? 1.25 : 1.0;

    case 'economic':
      // Industry needs peace and time to pay off — the same granary is worth
      // more in a quiet century than in a losing war. A civ that is being
      // beaten cannot afford to value workshops highly: it needs spears now,
      // and what it builds later will be someone else's unless it survives.
      if (ctx.status === 'war') return 1.0;
      return ctx.strengthRatio < 1 ? 1.05 : 1.3;

    case 'civic':
      // Laws and faiths shape every city you own, at war or at peace.
      return 1.15;

    case 'science':
      // Science compounds: it makes everything after it cheaper, so it is
      // never a bad buy.
      return 1.15;
    default:
      return 1.0;
  }
}

/**
 * The margin this personality demands before it will call a trade favourable.
 * Zero means "an even swap is fine"; positive means "I want something extra".
 *
 * Every trait is read defensively. A `DiplomaticWeights` built by hand — a
 * test fixture, a saved game from an older version, a bare policy context —
 * may be missing a field, and an `undefined` there would poison the whole sum
 * with `NaN`, which compares false against everything and silently turns the
 * civ into one that never trades. Neutral (5) is the safe reading.
 */
export function tradeMargin(weights: Partial<DiplomaticWeights> | undefined, ctx: TechTradeContext): number {
  const trait = (key: keyof DiplomaticWeights): number => {
    const value = weights?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : NEUTRAL_TRAIT;
  };

  let margin = 0;
  // A greedy court prices its own knowledge above the market.
  margin += (trait('greed') - NEUTRAL_TRAIT) * 2;
  // A suspicious one assumes the offer is a trap and wants paying for it.
  margin += (trait('xenophobia') - NEUTRAL_TRAIT) * 1;
  // A trusting one will take an even trade.
  margin -= (trait('trustSensitivity') - NEUTRAL_TRAIT) * 1.5;
  // Where a civ sits in the learning race changes how hard it bargains, and
  // the two directions are not symmetrical. A civ that is BEHIND is
  // desperate — it has little to give and much to gain, so it accepts well
  // under an even trade. A civ that is AHEAD is merely generous: it can afford
  // the loss, but it has no reason to hand knowledge away cheaply.
  if (ctx.ourTechCount < ctx.theirTechCount) margin -= 3;
  else if (ctx.ourTechCount > ctx.theirTechCount + 2) margin -= 1;
  // War wear makes a civ less picky about terms and more eager to trade.
  margin -= ctx.exhaustion * 0.25;
  return margin;
}

/** Value of one technology to this civ, right now. */
function valueOf(techId: string, ctx: TechTradeContext): number {
  return costOf(techId) * contextMultiplier(techFlavour(techId), ctx);
}

/** Amount ± `TIEBREAK_AMPLITUDE`, matching the other diplomacy policies. */
const TIEBREAK_AMPLITUDE = 2;

/**
 * Score one proposed swap. `favourable` is what the caller acts on; the rest
 * of the verdict is there so the console log and the tests can say *why*.
 */
export function evaluateTechTrade(
  proposal: TechTradeProposal,
  ctx: TechTradeContext,
): TechTradeVerdict {
  const received = valueOf(proposal.techRequested, ctx);
  const given = valueOf(proposal.techOffered, ctx);
  const netValue = received - given;
  const threshold = tradeMargin(ctx.weights, ctx);

  const factors: TechTradeFactor[] = [
    { label: `receive ${proposal.techRequested} (${techFlavour(proposal.techRequested)})`, value: Math.round(received) },
    { label: `give ${proposal.techOffered} (${techFlavour(proposal.techOffered)})`, value: Math.round(-given) },
    { label: 'margin demanded', value: Math.round(-threshold) },
  ];

  const score = netValue - threshold;
  // Named for the term that actually decided it, not the largest number.
  const because = score >= 0
    ? `gain of ${Math.round(netValue)} against a margin of ${Math.round(threshold)}`
    : `gain of ${Math.round(netValue)} does not clear the margin of ${Math.round(threshold)}`;

  return {
    favourable: score >= 0,
    score: Math.round(score * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
    netValue: Math.round(netValue * 100) / 100,
    factors,
    because,
  };
}

export interface TechTradePick {
  proposal: TechTradeProposal;
  verdict: TechTradeVerdict;
}

/**
 * Best favourable swap out of everything the two civs could offer each other,
 * or null when no pairing is worth doing.
 *
 * Every pair is scored rather than sorted by cost, because the pair that looks
 * cheapest to give may be the one that costs the most: handing over a military
 * secret in wartime is expensive at any research price.
 */
export function pickFavourableSwap(
  weHaveTheyLack: string[],
  theyHaveWeLack: string[],
  ctx: TechTradeContext,
): TechTradePick | null {
  let best: TechTradePick | null = null;

  for (const techOffered of weHaveTheyLack) {
    for (const techRequested of theyHaveWeLack) {
      const proposal = { techOffered, techRequested };
      const verdict = evaluateTechTrade(proposal, ctx);
      if (!verdict.favourable) continue;
      if (!best || verdict.score > best.verdict.score) {
        best = { proposal, verdict };
      }
    }
  }

  // Two pairings within the tiebreak amplitude are genuinely close, so break
  // them by seed rather than by list order — otherwise the first pair in the
  // arrays would win every time and the scoring would be decoration.
  if (best) {
    const close = collectWithinAmplitude(weHaveTheyLack, theyHaveWeLack, ctx, best.verdict.score);
    if (close.length > 1) {
      const index = seededIndex(close, ctx);
      return close[index];
    }
  }
  return best;
}

function collectWithinAmplitude(
  weHaveTheyLack: string[],
  theyHaveWeLack: string[],
  ctx: TechTradeContext,
  bestScore: number,
): TechTradePick[] {
  const out: TechTradePick[] = [];
  for (const techOffered of weHaveTheyLack) {
    for (const techRequested of theyHaveWeLack) {
      const proposal = { techOffered, techRequested };
      const verdict = evaluateTechTrade(proposal, ctx);
      if (!verdict.favourable) continue;
      if (bestScore - verdict.score < TIEBREAK_AMPLITUDE) out.push({ proposal, verdict });
    }
  }
  return out;
}

/** Deterministic index into the tied candidates. */
function seededIndex(candidates: TechTradePick[], ctx: TechTradeContext): number {
  let h = 2166136261 >>> 0;
  const parts = [
    ctx.civId, ctx.otherId, ctx.round, ctx.sequence,
    ...candidates.map((c) => `${c.proposal.techOffered}>${c.proposal.techRequested}`),
  ];
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
  return (h >>> 0) % candidates.length;
}

/**
 * Whether this civ would propose an Exchange of Knowledge at all, judged on
 * the best pair available. Used by the AI's periodic diplomacy pass and by a
 * unit paying a visit, so both ask the same question.
 */
export function wouldProposeExchange(
  weHaveTheyLack: string[],
  theyHaveWeLack: string[],
  ctx: TechTradeContext,
): TechTradePick | null {
  // Civ I: no Exchange of Knowledge while the two of you are fighting.
  if (ctx.status === 'war') return null;
  if (weHaveTheyLack.length === 0 || theyHaveWeLack.length === 0) return null;
  // Exhaustion is not a licence to give everything away.
  if (ctx.exhaustion >= 20) return null;
  return pickFavourableSwap(weHaveTheyLack, theyHaveWeLack, ctx);
}

/**
 * The stateless evaluator, kept as a class so the engine can hold one instance
 * and tests can construct it directly. Every method is a thin façade over the
 * pure functions above.
 */
export class TechTradeEvaluator {
  readonly flavourOf = techFlavour;
  readonly evaluate = evaluateTechTrade;
  readonly pick = pickFavourableSwap;
  readonly wouldPropose = wouldProposeExchange;
}
