/**
 * Diplomacy of knowledge and money.
 *
 * Three threads from the design notes, tested from the ground up:
 *
 *  1. KNOWLEDGE. A technology can be swapped, sold, or given away — and the
 *     last of those is worth enormously more goodwill than any sum of gold,
 *     because the giver gets nothing back. A technology is only ever handed
 *     to a civ that does not know it yet, and only while two diplomats are
 *     actually standing together.
 *  2. MONEY. Sending gold improves the other court's opinion of you;
 *     asking for gold works either because you are liked or because you are
 *     feared, and which of the two it is decides whether the payment is
 *     remembered as a gift or as tribute.
 *  3. THE CALL. An ally that is attacked can be called to arms, and a call
 *     that is answered puts the ally in the war beside its partner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { evaluateProposal } from '@/game/engine/diplomacy/ProposalScoring';
import { scoreCandidates } from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { goldPayerFor } from '@/game/engine/DiplomacyTypes';

function createMockGameEngine(overrides: Record<string, unknown> = {}): any {
  return {
    civilizations: [
      {
        id: 0, name: 'Americans', isAlive: true, isHuman: true,
        resources: { gold: 300 },
        technologies: ['pottery', 'bronze_working'],
        personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 },
      },
      {
        id: 1, name: 'Aztecs', isAlive: true, isAI: true,
        resources: { gold: 200 },
        technologies: ['pottery', 'iron_working', 'alphabet'],
        personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 },
      },
      {
        id: 2, name: 'Babylonians', isAlive: true, isAI: true,
        resources: { gold: 150 },
        technologies: ['pottery'],
        personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 },
      },
    ],
    units: [
      { id: 'dip0', type: 'diplomat', civilizationId: 0, col: 5, row: 5 },
      { id: 'dip1', type: 'diplomat', civilizationId: 1, col: 5, row: 5 },
      { id: 'dip2', type: 'diplomat', civilizationId: 2, col: 5, row: 5 },
    ],
    cities: [],
    roundManager: { getRoundNumber: () => 5 },
    onStateChange: vi.fn(),
    updateTechnologyAvailability: vi.fn(),
    ...overrides,
  };
}

describe('A gift of knowledge', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
    dm.markContact(0, 1);
  });

  it('hands the technology over and improves the receiver\'s opinion enormously', () => {
    const before = dm.getTheirOpinion(0, 1).goodwill;
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'bronze_working',
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
    expect(ge.updateTechnologyAvailability).toHaveBeenCalled();
    // The gift is the one act that buys goodwill without buying anything
    // back, so it moves the ledger a long way.
    expect(dm.getTheirOpinion(0, 1).goodwill - before).toBeGreaterThan(20);
  });

  it('refuses a gift of something the receiver already knows', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'pottery',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/already have/i);
  });

  it('refuses a gift the giver does not own', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'nuclear_fission',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/do not have/i);
  });

  it('needs two units to meet — knowledge is only handed over face to face', () => {
    // The diplomats are moved apart: no contact, no gift.
    ge.units = [
      { id: 'dip0', type: 'diplomat', civilizationId: 0, col: 5, row: 5 },
      { id: 'dip1', type: 'diplomat', civilizationId: 1, col: 40, row: 40 },
    ];
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'bronze_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/diplomat contact/i);
  });

  it('is refused while the two of you are at war', () => {
    dm.declareWar(0, 1);
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'bronze_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/war/i);
  });

  it('a deal made in person lands without a diplomat crossing over', () => {
    // A unit that walked up to the other court's own door carries the
    // knowledge with it — the meeting IS the messenger.
    ge.units = [
      { id: 'dip0', type: 'diplomat', civilizationId: 0, col: 40, row: 40 },
      { id: 'dip1', type: 'diplomat', civilizationId: 1, col: 41, row: 41 },
    ];
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology',
      techOffered: 'bronze_working', inPerson: true,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
  });

  it('is recorded in the ledger of both courts', () => {
    dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_technology', techOffered: 'bronze_working',
    });
    const theirReasons = dm.getTheirOpinion(0, 1).reasons;
    expect(theirReasons[0].event).toBe('technology_gifted');
    expect(theirReasons[0].delta).toBeGreaterThan(0);
  });
});

describe('Knowledge for money', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
    dm.markContact(0, 1);
  });

  it('knows who pays: a one-sided deal is paid to the side giving the knowledge', () => {
    expect(goldPayerFor({ techOffered: 'bronze_working' })).toBe('responder');
    expect(goldPayerFor({ techRequested: 'iron_working' })).toBe('proposer');
    expect(goldPayerFor({ techOffered: 'bronze_working', techRequested: 'iron_working' })).toBe('proposer');
  });

  it('pays the seller when the player offers a technology for gold', () => {
    const goldBefore = ge.civilizations[1].resources.gold;
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_for_gold',
      techOffered: 'bronze_working', goldAmount: 60,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
    // The buyer pays the seller — the gold runs to the proposer.
    expect(ge.civilizations[1].resources.gold).toBe(goldBefore - 60);
    expect(ge.civilizations[0].resources.gold).toBe(360);
    expect(res.goldTransferred).toBe(60);
  });

  it('pays the seller when the AI offers a technology for gold', () => {
    const goldBefore = ge.civilizations[0].resources.gold;
    const res = dm.acceptOffer({
      fromCivId: 1, toCivId: 0, action: 'offer_tech_for_gold',
      techOffered: 'iron_working', goldAmount: 60,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].technologies).toContain('iron_working');
    expect(ge.civilizations[0].resources.gold).toBe(goldBefore - 60);
    expect(ge.civilizations[1].resources.gold).toBe(260);
    // The money went TO the proposer, so the sign is positive.
    expect(res.goldTransferred).toBe(60);
  });

  it('pays the buyer when the player asks for a technology and names a price', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_for_gold',
      techRequested: 'alphabet', goldAmount: 40,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].technologies).toContain('alphabet');
    expect(ge.civilizations[0].resources.gold).toBe(260);
    expect(ge.civilizations[1].resources.gold).toBe(240);
  });

  it('refuses a price the payer cannot afford', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_for_gold',
      techOffered: 'bronze_working', goldAmount: 5000,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/afford/i);
  });

  it('never hands over knowledge the receiver already has', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_for_gold',
      techOffered: 'pottery', goldAmount: 10,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/already have/i);
  });
});

describe('Money between courts', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
    dm.markContact(0, 1);
  });

  it('sending gold improves the other court\'s opinion of you', () => {
    const before = dm.getTheirOpinion(0, 1).goodwill;
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'gift_gold', goldAmount: 100,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].resources.gold).toBe(200);
    expect(ge.civilizations[1].resources.gold).toBe(300);
    expect(dm.getTheirOpinion(0, 1).goodwill).toBeGreaterThan(before);
  });

  it('a gift of gold is accepted even by a court that dislikes the giver', () => {
    // A gift is not a negotiation: the money is the offer, and the point of
    // sending it is to win a court over.
    dm.getOpinion(1, 0).goodwill = -40;
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'gift_gold', goldAmount: 50,
    });
    expect(res.accepted).toBe(true);
    expect(dm.getTheirOpinion(0, 1).goodwill).toBeGreaterThan(-40);
  });

  it('a request for money is granted by a court that likes the asker', () => {
    dm.getOpinion(1, 0).goodwill = 70;
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].resources.gold).toBe(350);
    expect(ge.civilizations[1].resources.gold).toBe(150);
  });

  it('a request for money is refused by a court that neither likes nor fears the asker', () => {
    dm.getOpinion(1, 0).goodwill = 0;
    dm.getOpinion(1, 0).fear = 0;
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50,
    });
    expect(res.accepted).toBe(false);
  });

  it('a request for money is granted by a court that fears the asker', () => {
    dm.getOpinion(1, 0).goodwill = 0;
    dm.getOpinion(1, 0).fear = 90;
    // The asker is also the stronger party, which is the other half of a
    // threat.
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 0 ? 100 : 10));
    const res = dm.processProposal({
      fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50,
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].resources.gold).toBe(350);
  });

  it('a payment made in fear is remembered as tribute, not as a gift', () => {
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 0 ? 100 : 10));
    dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50 });
    const reasons = dm.getTheirOpinion(0, 1).reasons;
    expect(reasons[0].event).toBe('tribute_extorted');
  });

  it('a payment made in friendship is remembered as a gift', () => {
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation(() => 10);
    dm.getOpinion(1, 0).goodwill = 60;
    dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50 });
    const reasons = dm.getTheirOpinion(0, 1).reasons;
    expect(reasons[0].event).toBe('tribute_gift');
  });

  it('refuses a request the payer cannot afford', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 5000,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/cannot afford/i);
  });
});

describe('Scoring of money', () => {
  const weights = {
    hostility: 5, warmongering: 5, trustSensitivity: 5, greed: 5,
    loyalty: 5, paranoia: 5, vengeance: 5, xenophobia: 5, patience: 5,
  };

  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      responder: 1, proposer: 0, action: 'request_gold',
      weights,
      opinion: {
        goodwill: 0, grievance: 0, fear: 0, respect: 0,
        offersRefused: 0, lastOfferRound: -1, reasons: [],
      },
      status: 'peace', treaties: [],
      ownStrength: 10, theirStrength: 10, ownGold: 200,
      activeWars: 0, maxWars: 1, exhaustion: 0,
      turnsSince: 5, roundsSincePeace: 5, sharedEnemy: false,
      round: 5, sequence: 0,
      ...overrides,
    } as any;
  }

  it('a request costs the responder the gold it asks for', () => {
    const ev = evaluateProposal(ctx(), {
      fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 100,
    }, 0);
    const ask = ev.factors.find((f) => f.label.includes('asking us for'));
    expect(ask).toBeDefined();
    expect(ask!.value).toBeLessThan(0);
  });

  it('friendship and fear are the two ways a request lands', () => {
    const friendly = evaluateProposal(ctx({
      opinion: { goodwill: 70, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
    }), { fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50 }, 0);
    expect(friendly.accepted).toBe(true);

    const feared = evaluateProposal(ctx({
      theirStrength: 100,
      opinion: { goodwill: 0, grievance: 0, fear: 90, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
    }), { fromCivId: 0, toCivId: 1, action: 'request_gold', goldAmount: 50 }, 0);
    expect(feared.accepted).toBe(true);
  });

  it('a gift of gold is worth having, whatever the sum', () => {
    const ev = evaluateProposal(ctx({ action: 'gift_gold' }), {
      fromCivId: 0, toCivId: 1, action: 'gift_gold', goldAmount: 50,
    }, 0);
    expect(ev.accepted).toBe(true);
  });
});

describe('The AI deals in knowledge and money too', () => {
  const weights = {
    hostility: 5, warmongering: 5, trustSensitivity: 5, greed: 5,
    loyalty: 5, paranoia: 5, vengeance: 5, xenophobia: 5, patience: 5,
  };

  function policy(overrides: Record<string, unknown> = {}) {
    return {
      civId: 1, otherId: 0, weights,
      opinion: { goodwill: 50, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
      status: 'peace', treaties: [],
      ownStrength: 10, theirStrength: 10, ownGold: 300,
      theirGold: 300, activeWars: 0, maxWars: 1, exhaustion: 0,
      turnsSince: 5, roundsSincePeace: 5, sharedEnemy: false,
      round: 5, sequence: 0, currentYear: -3600,
      ...overrides,
    } as any;
  }

  it('offers a technology for gold when it is ahead in learning', () => {
    const candidates = scoreCandidates(policy({
      techsWeCanOffer: ['bronze_working'],
      techsWeWant: ['iron_working'],
      ourTechCount: 12,
      theirTechCount: 4,
    }));
    expect(candidates.some((c) => c.action === 'offer_tech_for_gold')).toBe(true);
  });

  it('gifts a technology to a court it likes', () => {
    const candidates = scoreCandidates(policy({
      techsWeCanOffer: ['bronze_working'],
      techsWeWant: [],
      ourTechCount: 4,
      theirTechCount: 4,
    }));
    expect(candidates.some((c) => c.action === 'gift_technology')).toBe(true);
  });

  it('does not gift a technology to a court it dislikes', () => {
    const candidates = scoreCandidates(policy({
      techsWeCanOffer: ['bronze_working'],
      techsWeWant: [],
      opinion: { goodwill: -40, grievance: 20, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
    }));
    expect(candidates.some((c) => c.action === 'gift_technology')).toBe(false);
  });

  it('names a price for the technology it puts on the table', () => {
    const dm = new DiplomacyManager(createMockGameEngine());
    dm.initialize([0, 1, 2]);
    dm.markContact(0, 1);
    const terms = dm.pickTechForGoldTerm(1, 0);
    expect(terms.techOffered ?? terms.techRequested).toBeTruthy();
    expect(terms.goldAmount).toBeGreaterThan(0);
  });
});

describe('Calling an ally for help', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) dm.markContact(a, b);
  });

  it('an ally that answers the call joins the war beside its partner', () => {
    dm.formAlliance(1, 2);
    expect(dm.getStatus(1, 2)).toBe('alliance');
    // Civ 0 attacks civ 2's partner... rather: civ 0 attacks civ 1, and civ 1
    // calls its ally civ 2 for help.
    const events: Array<{ type: string; data: any }> = [];
    (ge as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.declareWar(0, 1);
    // The call is resolved through the ordinary proposal pipeline for AI
    // allies, so the ally (civ 2) is now at war with the aggressor.
    expect(dm.getStatus(2, 0)).toBe('war');
  });

  it('records the call in the ledger so the player can see it happened', () => {
    dm.formAlliance(1, 2);
    dm.declareWar(0, 1);
    const events = dm.getEventLog();
    expect(events.some((e) => e.type === 'call_for_help_sent')).toBe(true);
  });

  it('a refused call breaks the mutual defence pact', () => {
    dm.signTreaty(1, 2, 'mutual_defense');
    // An ally that is worn down to a stub, and that would be facing an enemy
    // it cannot beat, says no.
    dm.declareWar(2, 0);
    for (let round = 1; round <= 15; round++) dm.processTurn(round);
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 0 ? 100 : 10));
    const res = dm.processProposal({
      fromCivId: 1, toCivId: 2, action: 'call_for_help', embargoTargetId: 0,
    });
    expect(res.accepted).toBe(false);
    expect(dm.hasTreaty(1, 2, 'mutual_defense')).toBe(false);
  });
});
