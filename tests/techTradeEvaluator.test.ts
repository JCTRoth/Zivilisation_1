/**
 * TechTradeEvaluator — is this Exchange of Knowledge worth doing?
 *
 * The old `pickTechSwap` handed over the cheapest tech we held and asked for
 * the dearest, which picks a pair but never asks whether the trade leaves the
 * civ better off. These tests pin the arithmetic that replaced it: what we
 * receive minus what we give, each weighted by what that kind of knowledge is
 * worth right now, against the margin this personality demands.
 */
import { describe, it, expect } from 'vitest';
import {
  TechTradeEvaluator,
  evaluateTechTrade,
  pickFavourableSwap,
  techFlavour,
  tradeMargin,
  wouldProposeExchange,
  type TechTradeContext,
} from '@/game/engine/diplomacy/TechTradeEvaluator';
import type { DiplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';

const NEUTRAL: DiplomaticWeights = {
  hostility: 5, warmongering: 5, trustSensitivity: 5, greed: 5,
  loyalty: 5, paranoia: 5, vengeance: 5, xenophobia: 5, patience: 5,
};

function ctx(overrides: Partial<TechTradeContext> = {}): TechTradeContext {
  return {
    civId: 0,
    otherId: 1,
    weights: NEUTRAL,
    status: 'peace',
    exhaustion: 0,
    ourTechCount: 5,
    theirTechCount: 5,
    strengthRatio: 1,
    round: 5,
    sequence: 0,
    ...overrides,
  };
}

describe('TechTradeEvaluator — classification', () => {
  it('classifies weapons as military and granaries as economic', () => {
    expect(techFlavour('iron_working')).toBe('military');
    expect(techFlavour('gunpowder')).toBe('military');
    expect(techFlavour('pottery')).toBe('economic');
    expect(techFlavour('banking')).toBe('economic');
  });

  it('falls back to science for anything unlisted', () => {
    // An unknown tech must still be priced; treating it as science keeps it
    // on the compounding side rather than dropping it from the sum.
    expect(techFlavour('some_future_tech')).toBe('science');
  });
});

describe('TechTradeEvaluator — what a tech is worth right now', () => {
  it('lets war amplify a military trade, in both directions', () => {
    // Bronze Working (30, military) for Iron Working (50, military). Both sides
    // carry the same flavour, so the wartime multiplier scales the pair rather
    // than cancelling: a military exchange matters MORE when there is a war on,
    // which is the point.
    const proposal = { techOffered: 'bronze_working', techRequested: 'iron_working' };
    const atWar = evaluateTechTrade(proposal, ctx({ status: 'war' }));
    const atPeace = evaluateTechTrade(proposal, ctx({ status: 'peace' }));

    expect(atPeace.netValue).toBe(20);   // 50 − 30
    expect(atWar.netValue).toBe(28);     // (50 − 30) × 1.4
    expect(atWar.netValue).toBeGreaterThan(atPeace.netValue);
  });

  it('prices an economic secret above a civic one of the same cost, in peace', () => {
    // Currency and Monarchy both cost 60. Give Writing (40, science → 46) and
    // the difference between them is purely the flavour multiplier: economic
    // pays 1.3× in a quiet century, civic a flat 1.15×.
    const base = { techOffered: 'writing' };
    const economic = evaluateTechTrade({ ...base, techRequested: 'currency' }, ctx());
    const civic = evaluateTechTrade({ ...base, techRequested: 'monarchy' }, ctx());

    expect(economic.netValue).toBeGreaterThan(civic.netValue);
  });

  it('values an economic secret more in peace than in war', () => {
    const proposal = { techOffered: 'pottery', techRequested: 'currency' };
    const inPeace = evaluateTechTrade(proposal, ctx({ status: 'peace' }));
    const inWar = evaluateTechTrade(proposal, ctx({ status: 'war' }));
    expect(inPeace.netValue).toBeGreaterThan(inWar.netValue);
  });

  it('stops valuing industry highly while the enemy outnumbers us', () => {
    // A civ that is losing cannot afford to prize granaries: it needs spears
    // now, and what it builds later may be someone else's. Currency (60,
    // economic) for Pottery (20, economic) is worth far less to a civ that is
    // being beaten than to one that is holding its own.
    const proposal = { techOffered: 'pottery', techRequested: 'currency' };
    const stronger = evaluateTechTrade(proposal, ctx({ strengthRatio: 2 }));
    const weaker = evaluateTechTrade(proposal, ctx({ strengthRatio: 0.5 }));

    expect(stronger.netValue).toBe(52); // (60 − 20) × 1.3
    expect(weaker.netValue).toBe(42);   // (60 − 20) × 1.05
    expect(stronger.netValue).toBeGreaterThan(weaker.netValue);
  });
});

describe('TechTradeEvaluator — the margin a personality demands', () => {
  it('a greedy civ demands a positive margin', () => {
    expect(tradeMargin({ ...NEUTRAL, greed: 10 }, ctx())).toBeGreaterThan(0);
  });

  it('a trusting civ settles for an even trade', () => {
    expect(tradeMargin({ ...NEUTRAL, trustSensitivity: 10 }, ctx())).toBeLessThan(0);
  });

  it('a suspicious civ wants paying for its knowledge', () => {
    expect(tradeMargin({ ...NEUTRAL, xenophobia: 10 }, ctx())).toBeGreaterThan(0);
  });

  it('a civ that is behind in learning accepts less', () => {
    const ahead = tradeMargin(NEUTRAL, ctx({ ourTechCount: 10, theirTechCount: 5 }));
    const behind = tradeMargin(NEUTRAL, ctx({ ourTechCount: 3, theirTechCount: 9 }));
    expect(behind).toBeLessThan(ahead);
  });

  it('war wear makes a civ less picky', () => {
    expect(tradeMargin(NEUTRAL, ctx({ exhaustion: 20 }))).toBeLessThan(tradeMargin(NEUTRAL, ctx()));
  });

  it('reads a partial or missing weight vector as neutral rather than NaN', () => {
    // An `undefined` trait would poison the sum with NaN, which compares false
    // against everything and silently turns the civ into one that never trades.
    expect(tradeMargin(undefined, ctx())).toBe(tradeMargin(NEUTRAL, ctx()));
    expect(tradeMargin({} as DiplomaticWeights, ctx())).toBe(tradeMargin(NEUTRAL, ctx()));
    expect(Number.isFinite(tradeMargin({ greed: NaN } as DiplomaticWeights, ctx()))).toBe(true);
  });
});

describe('TechTradeEvaluator — verdicts', () => {
  it('accepts a trade that pays and rejects the mirror of it', () => {
    // Give 30, get 50.
    const good = evaluateTechTrade({ techOffered: 'bronze_working', techRequested: 'iron_working' }, ctx());
    // Give 50, get 30.
    const bad = evaluateTechTrade({ techOffered: 'iron_working', techRequested: 'bronze_working' }, ctx());
    expect(good.favourable).toBe(true);
    expect(bad.favourable).toBe(false);
    expect(good.netValue).toBe(-bad.netValue);
  });

  it('names the term that decided it', () => {
    const verdict = evaluateTechTrade({ techOffered: 'iron_working', techRequested: 'bronze_working' }, ctx());
    expect(verdict.because).toContain('margin');
    expect(verdict.factors.length).toBeGreaterThan(0);
  });

  it('an even trade is favourable for a neutral court', () => {
    // writing (40, science) for philosophy (80, science) is not even — use two
    // techs of the same cost and flavour.
    const verdict = evaluateTechTrade({ techOffered: 'writing', techRequested: 'literacy' }, ctx({}));
    expect(verdict.favourable).toBe(true); // 60 back for 40 given
  });
});

describe('TechTradeEvaluator — picking a pair', () => {
  it('picks the pair that pays best, not the cheapest to give', () => {
    // We hold a cheap economic tech and an expensive military one; they hold
    // several. Sorting by "cheapest we can give" would offer pottery for
    // whatever they hold — the evaluator should find the pair with the widest
    // margin instead.
    const pick = pickFavourableSwap(
      ['pottery', 'iron_working'],       // we could give 20 or 50
      ['bronze_working', 'navigation'],  // they could give 30 or 80
      ctx(),
    );
    expect(pick).not.toBeNull();
    // pottery (20) for navigation (80) is the widest gap available.
    expect(pick!.proposal.techOffered).toBe('pottery');
    expect(pick!.proposal.techRequested).toBe('navigation');
  });

  it('returns null when every pairing loses', () => {
    // Everything we hold is more valuable than everything they hold.
    expect(pickFavourableSwap(['space_flight'], ['pottery'], ctx())).toBeNull();
  });

  it('picks the same pair every time for the same inputs', () => {
    const offer = ['pottery', 'iron_working'];
    const want = ['bronze_working', 'navigation'];
    const first = pickFavourableSwap(offer, want, ctx());
    for (let i = 0; i < 5; i++) {
      expect(pickFavourableSwap(offer, want, ctx())).toEqual(first);
    }
  });

  it('spreads a near-tied pick across rounds rather than always the first', () => {
    // A genuine tie, not a near one: we hold Code of Laws and Mysticism (both
    // civic, both 40), they hold Monarchy and Polytheism (both civic, both 60).
    // All four pairings price identically, so list order would otherwise pick
    // the same one every time and the scoring would be decoration.
    const picks = new Set<string>();
    for (let round = 1; round <= 40; round++) {
      const pick = pickFavourableSwap(
        ['code_of_laws', 'mysticism'],
        ['monarchy', 'polytheism'],
        ctx({ round }),
      );
      if (pick) picks.add(`${pick.proposal.techOffered}>${pick.proposal.techRequested}`);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('TechTradeEvaluator — the gate before any of it matters', () => {
  it('refuses to trade while at war', () => {
    expect(wouldProposeExchange(['pottery'], ['iron_working'], ctx({ status: 'war' }))).toBeNull();
  });

  it('refuses when either side has nothing the other lacks', () => {
    expect(wouldProposeExchange([], ['iron_working'], ctx())).toBeNull();
    expect(wouldProposeExchange(['pottery'], [], ctx())).toBeNull();
  });

  it('refuses when the civ is worn out from war', () => {
    expect(wouldProposeExchange(['pottery'], ['iron_working'], ctx({ exhaustion: 20 }))).toBeNull();
  });

  it('proposes a paying trade at peace', () => {
    expect(wouldProposeExchange(['bronze_working'], ['iron_working'], ctx())).not.toBeNull();
  });

  it('a greedy civ turns down a trade a neutral one would take', () => {
    // Writing (40, science → 46 valued) for Iron Working (50, military → 50
    // valued in a quiet standoff) leaves us 4 ahead — enough for a neutral
    // court, not enough for a greedy one, which demands 10.
    const tight = { techOffered: 'writing', techRequested: 'iron_working' };
    expect(evaluateTechTrade(tight, ctx()).netValue).toBe(4);
    expect(evaluateTechTrade(tight, ctx()).favourable).toBe(true);
    expect(evaluateTechTrade(tight, ctx({ weights: { ...NEUTRAL, greed: 10 } })).favourable).toBe(false);
  });
});

describe('TechTradeEvaluator — the façade', () => {
  it('exposes the same arithmetic as the pure functions', () => {
    const evaluator = new TechTradeEvaluator();
    const proposal = { techOffered: 'bronze_working', techRequested: 'iron_working' };
    expect(evaluator.evaluate(proposal, ctx())).toEqual(evaluateTechTrade(proposal, ctx()));
    expect(evaluator.flavourOf('iron_working')).toBe(techFlavour('iron_working'));
    expect(evaluator.wouldPropose(['bronze_working'], ['iron_working'], ctx()))
      .toEqual(wouldProposeExchange(['bronze_working'], ['iron_working'], ctx()));
  });
});
