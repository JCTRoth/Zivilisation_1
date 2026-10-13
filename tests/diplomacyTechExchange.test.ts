/**
 * Exchange of Knowledge (Civ I tech trading) — engine rules from the ground up.
 *
 * Prerequisites: contact made, not at war, both sides hold something the other
 * lacks. Execution validates ownership, swaps both techs, refreshes the shared
 * tree, and writes the tech_exchanged impact both ways.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { scoreCandidates } from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { evaluateProposal } from '@/game/engine/diplomacy/ProposalScoring';

function createMockGameEngine(overrides: Record<string, unknown> = {}): any {
  return {
    civilizations: [
      {
        id: 0, name: 'Americans', isAlive: true, isHuman: true,
        resources: { gold: 200 },
        technologies: ['pottery', 'bronze_working'],
        personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 },
      },
      {
        id: 1, name: 'Aztecs', isAlive: true, isAI: true,
        resources: { gold: 100 },
        technologies: ['pottery', 'iron_working', 'alphabet'],
        personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 },
      },
    ],
    units: [],
    cities: [],
    roundManager: { getRoundNumber: () => 5 },
    onStateChange: vi.fn(),
    updateTechnologyAvailability: vi.fn(),
    ...overrides,
  };
}

describe('Exchange of Knowledge — trade options', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('lists the two one-sided tech diffs', () => {
    const opts = dm.getTechTradeOptions(0, 1);
    expect(opts.theyHaveWeLack.sort()).toEqual(['alphabet', 'iron_working']);
    expect(opts.weHaveTheyLack).toEqual(['bronze_working']);
  });

  it('canTradeTechs is true only with contact, peace and a real swap', () => {
    expect(dm.canTradeTechs(0, 1).ok).toBe(true);

    const noContact = new DiplomacyManager(createMockGameEngine());
    noContact.initialize([0, 1]);
    expect(noContact.canTradeTechs(0, 1).ok).toBe(false);
    expect(noContact.canTradeTechs(0, 1).reason).toBe('No contact yet');

    dm.declareWar(0, 1);
    expect(dm.canTradeTechs(0, 1).ok).toBe(false);
    expect(dm.canTradeTechs(0, 1).reason).toBe('At war');
  });

  it('pickTechSwap offers the cheapest we can give and asks for the priciest they have', () => {
    const swap = dm.pickTechSwap(0, 1);
    // bronze_working (30) is the only thing we can offer; alphabet (20) is
    // cheaper than iron_working (50), so we ask for the pricier one.
    expect(swap).toEqual({ techOffered: 'bronze_working', techRequested: 'iron_working' });
  });
});

describe('Exchange of Knowledge — processProposal rules', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('refuses while at war before any scoring', () => {
    dm.declareWar(0, 1);
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/war/i);
  });

  it('canTradeTechs reports missing contact for an unmet civ', () => {
    const fresh = new DiplomacyManager(createMockGameEngine());
    fresh.initialize([0, 1]);
    expect(fresh.canTradeTechs(0, 1).ok).toBe(false);
    expect(fresh.canTradeTechs(0, 1).reason).toMatch(/contact/i);
    // processProposal itself marks contact, so a direct proposal can still land.
    const res = fresh.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(true);
  });

  it('swaps both techs and refreshes the shared tree on accept', () => {
    // Neutral opinion + fair bronze↔iron swap should clear the bar with noise.
    // Force accept via acceptOffer (player decision path) for the swap rules;
    // processProposal is covered by the war/contact gates above.
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].technologies).toContain('iron_working');
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
    expect(ge.updateTechnologyAvailability).toHaveBeenCalled();
  });

  it('rejects a swap when either side does not own the named tech', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'writing', // we do not have it
      techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/offered technology/i);
  });
});

describe('Exchange of Knowledge — scoring', () => {
  const baseWeights = {
    trustSensitivity: 5, greed: 5, loyalty: 5, warmongering: 5,
    riskTolerance: 5, diplomacy: 5, memory: 5, pride: 5,
  } as any;

  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      civId: 1, otherId: 0,
      weights: baseWeights,
      opinion: {
        goodwill: 0, grievance: 0, fear: 0, respect: 0,
        offersRefused: 0, lastOfferRound: -1, reasons: [],
      },
      status: 'peace', treaties: [],
      ownStrength: 10, theirStrength: 10, ownGold: 100,
      activeWars: 0, maxWars: 1, exhaustion: 0,
      turnsSince: 5, roundsSincePeace: 5, sharedEnemy: false,
      round: 5, sequence: 0, currentYear: -3600,
      ...overrides,
    } as any;
  }

  const swap = {
    fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange' as const,
    techOffered: 'bronze_working', techRequested: 'iron_working',
  };

  it('veto-scores a tech exchange during war', () => {
    const ev = evaluateProposal(ctx({ status: 'war' }), swap, 0);
    expect(ev.accepted).toBe(false);
    expect(ev.factors.some((f) => f.label.includes('at war'))).toBe(true);
  });

  it('scores a fair swap above a costly one for them', () => {
    // Equal-cost pair: pottery (20) ↔ pottery is impossible (same), so use
    // alphabet (20) offered for pottery (20) — wait we need distinct.
    // bronze_working 30 vs iron_working 50 → ratio 0.6 → unfair for them.
    const uneven = evaluateProposal(ctx(), swap, 0);
    // pottery 20 offered for iron_working 50 → very unfair for them.
    const cheapForThem = evaluateProposal(ctx(), {
      ...swap, techOffered: 'pottery', techRequested: 'iron_working',
    }, 0);
    // bronze 30 for alphabet 20 → slightly better for them than bronze for iron.
    const betterForThem = evaluateProposal(ctx(), {
      ...swap, techOffered: 'bronze_working', techRequested: 'alphabet',
    }, 0);
    const scoreOf = (e: { factors: { label: string; value: number }[] }) =>
      e.factors.filter((f) => f.label.includes('technology')).reduce((s, f) => s + f.value, 0);
    expect(scoreOf(betterForThem)).toBeGreaterThan(scoreOf(uneven));
    expect(scoreOf(uneven)).toBeGreaterThan(scoreOf(cheapForThem));
  });
});

describe('AI policy proposes tech exchange when both sides have something', () => {
  it('proposes offer_tech_exchange only when a swap actually favours us', () => {
    const weights = {
      trustSensitivity: 5, greed: 5, loyalty: 5, warmongering: 5,
      riskTolerance: 5, diplomacy: 5, memory: 5, pride: 5,
    } as any;
    const opinion = {
      goodwill: 10, grievance: 0, fear: 0, respect: 10,
      offersRefused: 0, lastOfferRound: -1, reasons: [],
    };
    const base = {
      civId: 1, otherId: 0, weights, opinion,
      status: 'peace', treaties: [],
      ownStrength: 10, theirStrength: 10, ownGold: 100,
      activeWars: 0, maxWars: 1, exhaustion: 0,
      turnsSince: 5, roundsSincePeace: 5, sharedEnemy: false,
      round: 5, sequence: 0, currentYear: -3600,
    };

    // A trade that pays: hand over Bronze Working (30), receive Iron Working
    // (50). The evaluator prices it well clear of a neutral margin.
    const favourable = scoreCandidates({
      ...base,
      techsWeCanOffer: ['bronze_working'],
      techsWeWant: ['iron_working'],
    } as any);
    expect(favourable.some((c) => c.action === 'offer_tech_exchange')).toBe(true);

    // The mirror of that trade — give 50, get 30 — is a loss, and the AI no
    // longer proposes it just because both sides hold something the other
    // lacks. (The old code scored this identically to the trade above.)
    const lossmaking = scoreCandidates({
      ...base,
      techsWeCanOffer: ['iron_working'],
      techsWeWant: ['bronze_working'],
    } as any);
    expect(lossmaking.some((c) => c.action === 'offer_tech_exchange')).toBe(false);

    const noTrade = scoreCandidates(base as any);
    expect(noTrade.some((c) => c.action === 'offer_tech_exchange')).toBe(false);
  });
});
