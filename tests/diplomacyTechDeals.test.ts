/**
 * One-sided Exchange of Knowledge — a sale, a purchase, a free gift — plus the
 * contact rule that gates every table and the gold requests that ride alongside.
 *
 * What is pinned here:
 *
 *  1. The DIRECTION the gold moves, which the old code got wrong: on a sale the
 *     responder pays the proposer, on a purchase (or a swap) the proposer pays
 *     the responder. An outright ask for free knowledge is refused.
 *  2. A technology handed over with no price on it records `tech_gift` in BOTH
 *     ledgers — the receiver's goodwill and the giver's own word — which is
 *     what makes "gifting improves opinion immensely" an arithmetic fact.
 *  3. Contact is a live spatial check: a unit beside a unit, or a unit beside
 *     the other civ's city. Not a permanent flag, not diplomats only.
 *  4. `request_gold` is scored as a COST to the responder: high goodwill opens
 *     the purse, a low one refuses, and a bigger ask is strictly worse —
 *     including the "more than they can spare" refusal on its own.
 *  5. The AI tables one-sided deals only when no swap was worth picking, only
 *     through an embassy, and only in the shapes `aiTechDealTerms` can fill in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { evaluateProposal } from '@/game/engine/diplomacy/ProposalScoring';
import { scoreCandidates } from '@/game/engine/diplomacy/AIDiplomacyPolicy';

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
    units: [
      { id: 'dip0', type: 'diplomat', civilizationId: 0, col: 5, row: 5 },
      { id: 'dip1', type: 'diplomat', civilizationId: 1, col: 5, row: 5 },
    ],
    cities: [],
    roundManager: { getRoundNumber: () => 5 },
    onStateChange: vi.fn(),
    updateTechnologyAvailability: vi.fn(),
    ...overrides,
  };
}

describe('One-sided Exchange of Knowledge — who pays', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('a sale makes the responder pay, and the proposer keep the gold', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', goldAmount: 30,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].resources.gold).toBe(230);
    expect(ge.civilizations[1].resources.gold).toBe(70);
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
    // Positive = the responder settled the bill.
    expect(res.goldTransferred).toBe(30);
  });

  it('a purchase makes the proposer pay, exactly as a swap does', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techRequested: 'iron_working', goldAmount: 50,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].resources.gold).toBe(150);
    expect(ge.civilizations[1].resources.gold).toBe(150);
    expect(ge.civilizations[0].technologies).toContain('iron_working');
    expect(res.goldTransferred).toBe(-50);
  });

  it('refuses an outright ask for free knowledge', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/free technology/i);
    expect(ge.civilizations[0].technologies).not.toContain('iron_working');
  });

  it('a free gift moves no gold and records tech_gift in both ledgers', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working',
    });
    expect(res.accepted).toBe(true);
    expect(res.goldTransferred).toBeUndefined();
    expect(ge.civilizations[0].resources.gold).toBe(200);
    expect(ge.civilizations[1].resources.gold).toBe(100);
    expect(ge.civilizations[1].technologies).toContain('bronze_working');

    // Both courts write it down: the receiver likes the giver more, and the
    // giver's own court records the generosity (keepsWord counts it).
    const theirs = dm.getTheirOpinion(0, 1);
    const ours = dm.getTheirOpinion(1, 0);
    expect(theirs.reasons.some((r) => r.event === 'tech_gift')).toBe(true);
    expect(ours.reasons.some((r) => r.event === 'tech_gift')).toBe(true);
    expect(theirs.goodwill).toBeGreaterThan(0);
    expect(ours.goodwill).toBeGreaterThan(0);
  });

  it('a paid one-sided deal records tech_exchanged, not tech_gift', () => {
    dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', goldAmount: 30,
    });
    const theirs = dm.getTheirOpinion(0, 1);
    expect(theirs.reasons.some((r) => r.event === 'tech_exchanged')).toBe(true);
    expect(theirs.reasons.some((r) => r.event === 'tech_gift')).toBe(false);
  });
});

describe('Contact between the two peoples', () => {
  function contactEngine(units: any[], cities: any[] = []): { dm: DiplomacyManager; ge: any } {
    const ge = createMockGameEngine({ units, cities });
    const dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    return { dm, ge };
  }

  it('a unit beside a unit of the other civ is contact', () => {
    const { dm } = contactEngine([
      { id: 'u0', type: 'warrior', civilizationId: 0, col: 10, row: 10 },
      { id: 'u1', type: 'warrior', civilizationId: 1, col: 11, row: 10 },
    ]);
    expect(dm.hasUnitContact(0, 1)).toBe(true);
    expect(dm.hasUnitContact(1, 0)).toBe(true);
  });

  it('units apart are not contact', () => {
    const { dm } = contactEngine([
      { id: 'u0', type: 'warrior', civilizationId: 0, col: 10, row: 10 },
      { id: 'u1', type: 'warrior', civilizationId: 1, col: 30, row: 30 },
    ]);
    expect(dm.hasUnitContact(0, 1)).toBe(false);
  });

  it('a unit standing beside the other civs city is contact, either way', () => {
    const { dm } = contactEngine(
      [{ id: 'u0', type: 'warrior', civilizationId: 0, col: 10, row: 10 }],
      [{ id: 'c1', name: 'Tenochtitlan', civilizationId: 1, col: 11, row: 10, size: 1 }],
    );
    expect(dm.hasUnitContact(0, 1)).toBe(true);
    // …and the mirror: their unit at OUR doorstep.
    const mirrored = contactEngine(
      [{ id: 'u1', type: 'warrior', civilizationId: 1, col: 10, row: 10 }],
      [{ id: 'c0', name: 'Washington', civilizationId: 0, col: 11, row: 10, size: 1 }],
    );
    expect(mirrored.dm.hasUnitContact(0, 1)).toBe(true);
  });

  it('no units and no cities of the other civ is no contact', () => {
    const { dm } = contactEngine([]);
    expect(dm.hasUnitContact(0, 1)).toBe(false);
  });
});

describe('Requesting gold — the responder decides from the terms', () => {
  const baseWeights = {
    trustSensitivity: 5, greed: 5, loyalty: 5, warmongering: 5,
    riskTolerance: 5, diplomacy: 5, memory: 5, pride: 5,
  } as any;

  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      responder: 1, proposer: 0, action: 'request_gold',
      weights: baseWeights,
      opinion: {
        goodwill: 0, grievance: 0, fear: 0, respect: 0,
        offersRefused: 0, lastOfferRound: -1, reasons: [],
      },
      status: 'peace', treaties: [],
      ownStrength: 10, theirStrength: 10, ownGold: 100,
      round: 5, sequence: 0,
      ...overrides,
    } as any;
  }

  const ask = (goldAmount: number) => ({
    fromCivId: 0, toCivId: 1, action: 'request_gold' as const, goldAmount,
  });

  it('a warm relationship opens the purse; a cold one refuses', () => {
    const warm = evaluateProposal(ctx({
      opinion: { goodwill: 80, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
    }), ask(50), 0);
    const cold = evaluateProposal(ctx(), ask(50), 0);
    expect(warm.accepted).toBe(true);
    expect(cold.accepted).toBe(false);
    expect(warm.score).toBeGreaterThan(cold.score);
  });

  it('a bigger ask is strictly worse, and past what they can spare is refused alone', () => {
    const opinion = {
      goodwill: 80, grievance: 0, fear: 0, respect: 0,
      offersRefused: 0, lastOfferRound: -1, reasons: [],
    };
    const small = evaluateProposal(ctx({ opinion }), ask(50), 0);
    const huge = evaluateProposal(ctx({ opinion }), ask(300), 0);
    expect(small.score).toBeGreaterThan(huge.score);
    expect(small.accepted).toBe(true);
    expect(huge.accepted).toBe(false);
    expect(huge.factors.some((f) => f.label.includes('more than they can spare'))).toBe(true);
    // The gold itself is named as a cost, not as something offered.
    expect(small.factors.some((f) => f.label.includes('asking us for 50 gold'))).toBe(true);
  });
});

describe('AI one-sided tech tables', () => {
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

  const techCandidate = (c: { action: string }[]) =>
    c.find((x) => x.action === 'offer_tech_exchange');

  it('offers a sale when our treasury is thin and theirs can pay', () => {
    const c = scoreCandidates({
      ...base, techsWeCanOffer: ['bronze_working'], ownGold: 40, theirGold: 200,
    } as any);
    const tech = techCandidate(c);
    expect(tech).toBeDefined();
    expect((tech as any).because).toMatch(/treasury/i);
  });

  it('offers a free gift when the goodwill is overwhelming', () => {
    const c = scoreCandidates({
      ...base, techsWeCanOffer: ['bronze_working'],
      opinion: { ...opinion, goodwill: 70 },
    } as any);
    const tech = techCandidate(c);
    expect(tech).toBeDefined();
    expect((tech as any).because).toMatch(/goodwill/i);
  });

  it('stays silent without an embassy', () => {
    const c = scoreCandidates({
      ...base, techsWeCanOffer: ['bronze_working'], ownGold: 40, theirGold: 200,
      hasEmbassy: false,
    } as any);
    expect(techCandidate(c)).toBeUndefined();
  });

  it('lets a good swap win: no one-sided terms ride along', () => {
    const c = scoreCandidates({
      ...base, techsWeCanOffer: ['bronze_working'], techsWeWant: ['iron_working'],
      ownGold: 40, theirGold: 200,
    } as any);
    const tech = techCandidate(c);
    expect(tech).toBeDefined();
    expect((tech as any).because).not.toMatch(/treasury|goodwill too great/);
  });
});

describe('aiTechDealTerms — swap, then sale, then gift', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('prefers a favourable swap when one exists', () => {
    // civ0 gives Bronze Working (30) for Iron Working (50) — a trade that pays.
    expect(dm.aiTechDealTerms(0, 1)).toEqual({
      kind: 'swap', techOffered: 'bronze_working', techRequested: 'iron_working',
    });
  });

  it('buys a technology when it has nothing to offer but gold', () => {
    // civ1 holds nothing civ0 lacks, but civ0 holds two secrets civ1 needs.
    ge.civilizations[1].technologies = ['pottery'];
    ge.civilizations[1].resources.gold = 200;
    const deal = dm.aiTechDealTerms(1, 0);
    expect(deal?.kind).toBe('purchase');
    expect(deal?.techOffered).toBeUndefined();
    expect(deal?.techRequested).toBe('bronze_working');
    expect(deal?.goldAmount).toBe(30);
  });

  it('falls back to a sale priced at research cost when no swap is on', () => {
    // civ1's only secret is worth more than anything it would get back, so no
    // swap clears the evaluator — and its treasury is thin.
    ge.civilizations[1].technologies = ['pottery', 'iron_working'];
    ge.civilizations[1].resources.gold = 50;
    const deal = dm.aiTechDealTerms(1, 0);
    expect(deal?.kind).toBe('sale');
    expect(deal?.techOffered).toBe('iron_working');
    expect(deal?.techRequested).toBeUndefined();
    expect(deal?.goldAmount).toBe(50);
  });

  it('falls back to a free gift when goodwill is overwhelming', () => {
    ge.civilizations[1].technologies = ['pottery', 'iron_working'];
    ge.civilizations[1].resources.gold = 400;
    const rel = dm.getRelation(0, 1)!;
    rel.opinionAtoB.goodwill = 70;
    rel.opinionBtoA.goodwill = 70;
    const deal = dm.aiTechDealTerms(1, 0);
    expect(deal?.kind).toBe('gift');
    expect(deal?.goldAmount).toBeUndefined();
    // The only secret we can part with — handed over, not sold.
    expect(deal?.techOffered).toBe('iron_working');
  });

  it('returns null when there is nothing worth tabling', () => {
    // Rich, cold, and with no swap: neither a sale nor a gift is motivated.
    ge.civilizations[1].technologies = ['pottery', 'iron_working'];
    ge.civilizations[1].resources.gold = 400;
    expect(dm.aiTechDealTerms(1, 0)).toBeNull();
  });
});
