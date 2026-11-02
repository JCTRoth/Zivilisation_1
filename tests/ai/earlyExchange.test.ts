/**
 * The opening era of tech diplomacy — "the AI seeks you".
 *
 * Inside the window (EARLY_TECH_EXCHANGE_MAX_ROUND) an AI court that has met
 * a human player always wants the Exchange of Knowledge: the policy scores it
 * above everything else, a diplomat becomes the envoy and walks to the human
 * court, and the deal made in person (inPerson) travels with the messenger —
 * no second diplomat has to stand next to it. After the window the ordinary
 * benefit arithmetic decides again.
 *
 * Pinned here:
 *   * the early-window policy pushes (human target only, window only),
 *   * acceptance of an in-person offer with no diplomat contact anywhere,
 *   * the envoy's destination (nearest known peaceful human city, approached
 *     to an adjacent tile) and its window/contact/war guards,
 *   * the envoy visit tables a deal even without an embassy — the visit IS
 *     the channel — while ordinary visits keep the embassy gate,
 *   * the visit cooldown: one knock, not a knock per turn.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  scoreCandidates,
  type PolicyContext,
} from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { diplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion } from '@/game/engine/diplomacy/DiplomaticOpinion';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { AIManager } from '@/game/engine/AI/AIManager';
import { EARLY_TECH_EXCHANGE_MAX_ROUND } from '@/data/GameConstants';

// ── Policy: the window guarantees the exchange toward a human ──────────────

const WARLORD = { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 };

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    civId: 1,
    otherId: 0,
    weights: diplomaticWeights({ id: 1, personality: WARLORD }),
    opinion: createOpinion(),
    status: 'peace',
    treaties: [],
    ownStrength: 100,
    theirStrength: 100,
    ownGold: 300,
    theirGold: 50,
    activeWars: 0,
    maxWars: 3,
    exhaustion: 0,
    turnsSince: 30,
    roundsSincePeace: Infinity,
    sharedEnemy: false,
    round: 5,
    sequence: 1,
    targetIsHuman: true,
    techsWeCanOffer: ['writing'],
    techsWeWant: ['bronze_working'],
    ...over,
  };
}

const find = (cands: ReturnType<typeof scoreCandidates>, action: string) =>
  cands.find((c) => c.action === action);

describe('early window — scoreCandidates', () => {
  it('the exchange dominates the round toward a human in the opening era', () => {
    const cands = scoreCandidates(context());
    const exchange = find(cands, 'offer_tech_exchange');
    expect(exchange, 'offer_tech_exchange candidate').toBeDefined();
    expect(exchange!.score).toBeGreaterThanOrEqual(45);
    // It wins the round: nothing else in a peace-time context scores higher.
    expect(cands[0].action).toBe('offer_tech_exchange');
  });

  it('one-way knowledge still produces a guaranteed gift to the human', () => {
    const cands = scoreCandidates(context({ techsWeWant: [] }));
    const gift = find(cands, 'gift_technology');
    expect(gift, 'gift_technology candidate').toBeDefined();
    expect(gift!.score).toBeGreaterThanOrEqual(30);
    expect(cands[0].action).toBe('gift_technology');
  });

  it('a non-human court gets none of the early pushes', () => {
    const cands = scoreCandidates(context({ targetIsHuman: false }));
    expect(find(cands, 'offer_tech_exchange')).toBeUndefined();
    expect(find(cands, 'gift_technology')).toBeUndefined();
  });

  it('after the window the benefit arithmetic decides again', () => {
    const cands = scoreCandidates(
      context({ round: EARLY_TECH_EXCHANGE_MAX_ROUND + 1 }),
    );
    expect(find(cands, 'offer_tech_exchange')).toBeUndefined();
    expect(find(cands, 'gift_technology')).toBeUndefined();
  });

  it('the very last window round still counts as early', () => {
    const cands = scoreCandidates(context({ round: EARLY_TECH_EXCHANGE_MAX_ROUND }));
    expect(find(cands, 'offer_tech_exchange')).toBeDefined();
  });
});

// ── In-person acceptance: the deal travels with the messenger ─────────────

function makeManager(): { dm: DiplomacyManager; ge: any } {
  const personality = { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 };
  const ge: any = {
    civilizations: [
      {
        id: 0, name: 'Americans', isAlive: true, isHuman: true,
        resources: { gold: 100 }, personality,
        technologies: ['pottery', 'bronze_working'],
      },
      {
        id: 1, name: 'Aztecs', isAlive: true,
        resources: { gold: 100 }, personality,
        technologies: ['pottery', 'writing'],
      },
    ],
    units: [], // nobody stands anywhere — no diplomat contact exists
    cities: [],
    roundManager: { getRoundNumber: () => 5 },
    onStateChange: vi.fn(),
  };
  const dm = new DiplomacyManager(ge);
  dm.initialize([0, 1]);
  return { dm, ge };
}

describe('in-person offers — acceptOffer', () => {
  it('accepts a tech exchange with no diplomat contact when the deal is in person', () => {
    const { dm } = makeManager();
    const result = dm.acceptOffer({
      fromCivId: 1,
      toCivId: 0,
      action: 'offer_tech_exchange',
      techOffered: 'writing',
      techRequested: 'bronze_working',
      inPerson: true,
    });
    expect(result.accepted, String(result.reason)).toBe(true);
  });

  it('the same offer without in person is refused — no diplomat contact', () => {
    const { dm } = makeManager();
    const result = dm.acceptOffer({
      fromCivId: 1,
      toCivId: 0,
      action: 'offer_tech_exchange',
      techOffered: 'writing',
      techRequested: 'bronze_working',
    });
    expect(result.accepted).toBe(false);
    expect(String(result.reason)).toMatch(/diplomat contact/i);
  });
});

// ── The envoy: AIManager walks to the human court and knocks ──────────────

function makeEnvoyWorld(over: {
  round?: number;
  contacted?: boolean;
  atWar?: boolean;
  diplomatAt?: { col: number; row: number };
  embassy?: boolean;
} = {}) {
  let round = over.round ?? 5;
  const diplomat: any = {
    id: 'envoy', type: 'diplomat', civilizationId: 1,
    col: over.diplomatAt?.col ?? 2, row: over.diplomatAt?.row ?? 2,
    movesRemaining: 2, health: 100, attack: 0, defense: 1,
  };
  const dm = {
    isAtWar: () => over.atWar ?? false,
    hasEmbassy: () => over.embassy ?? false,
    hasContacted: () => over.contacted ?? true,
    getTechTradeOptions: () => ({ weHaveTheyLack: ['writing'], theyHaveWeLack: ['bronze_working'] }),
    pickTechSwap: () => null, // the evaluator refuses; the early window must not
    pickTechGiftTerm: () => ({ techOffered: 'writing' }),
    pickTechForGoldTerm: () => null,
    getAttitudeScore: () => 0,
    presentOffer: vi.fn(),
    processProposal: vi.fn(),
  };
  const ge: any = {
    map: { width: 40, height: 40 },
    devMode: false,
    units: [diplomat],
    cities: [
      // The human court at (10,10), civ 0 is human; civ 1 is the AI envoy's.
      { id: 'humanCity', name: 'Washington', civilizationId: 0, col: 10, row: 10, population: 3 },
    ],
    civilizations: [
      { id: 0, name: 'Americans', isHuman: true, isAlive: true },
      { id: 1, name: 'Aztecs', isHuman: false, isAlive: true },
    ],
    diplomacyManager: dm,
    roundManager: { getRoundNumber: () => round },
    getPlayerStorage: () => ({ enemyLocations: new Map() }),
    squareGrid: {
      squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
        Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
      getNeighbors: (c: number, r: number) => [
        { col: c + 1, row: r }, { col: c - 1, row: r },
        { col: c, row: r + 1 }, { col: c, row: r - 1 },
      ],
    },
    getUnitAt: (col: number, row: number) =>
      ge.units.find((u: any) => u.col === col && u.row === row && !u.isDefeated) ?? null,
    getCityAt: (col: number, row: number) =>
      ge.cities.find((c: any) => c.col === col && c.row === row) ?? null,
    getTileAt: (col: number, row: number) => ({ col, row, type: 'grassland' }),
    isTilePassable: () => true,
    isExploredByPlayer: () => true,
  };
  const ai = new AIManager(ge);
  return { ai, ge, dm, setRound: (r: number) => { round = r; } };
}

describe('AIManager — the opening-era envoy', () => {
  it('targets a tile adjacent to the nearest known human city', () => {
    const { ai } = makeEnvoyWorld();
    const envoy = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 2, row: 2 } as never;
    const target = (ai as any).earlyEnvoyTarget(envoy);
    expect(target).not.toBeNull();
    // Adjacent to (10,10) by Chebyshev.
    expect(Math.max(Math.abs(target.col - 10), Math.abs(target.row - 10))).toBe(1);
  });

  it('stops being an envoy outside the window, without contact, or at war', () => {
    const envoy = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 2, row: 2 } as never;

    const late = makeEnvoyWorld({ round: EARLY_TECH_EXCHANGE_MAX_ROUND + 1 });
    expect((late.ai as any).earlyEnvoyTarget(envoy)).toBeNull();

    const cold = makeEnvoyWorld({ contacted: false });
    expect((cold.ai as any).earlyEnvoyTarget(envoy)).toBeNull();

    const war = makeEnvoyWorld({ atWar: true });
    expect((war.ai as any).earlyEnvoyTarget(envoy)).toBeNull();
  });

  it('returns null when the envoy already stands at the court — the visit tables the deal', () => {
    const { ai } = makeEnvoyWorld({ diplomatAt: { col: 11, row: 10 } });
    const envoy = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 11, row: 10 } as never;
    expect((ai as any).earlyEnvoyTarget(envoy)).toBeNull();
  });

  it('a diplomat envoy tables the exchange in person — even with no embassy', () => {
    const { ai, dm } = makeEnvoyWorld({ diplomatAt: { col: 11, row: 10 }, embassy: false });
    const envoy: any = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 11, row: 10, movesRemaining: 2 };

    const visited = (ai as any).considerTradeVisit(envoy);
    expect(visited).toBe(true);
    expect(dm.presentOffer).toHaveBeenCalledTimes(1);
    const [from, to, action, , , techOffered, techRequested] = dm.presentOffer.mock.calls[0];
    expect(from).toBe(1);
    expect(to).toBe(0);
    expect(action).toBe('offer_tech_exchange');
    expect(techOffered).toBe('writing'); // our cheapest spare
    expect(techRequested).toBe('bronze_working'); // their dearest
  });

  it('one-way knowledge becomes a free gift of the most valuable secret', () => {
    const { ai, dm } = makeEnvoyWorld({ diplomatAt: { col: 11, row: 10 }, embassy: false });
    dm.getTechTradeOptions = () => ({ weHaveTheyLack: ['writing'], theyHaveWeLack: [] });
    const envoy: any = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 11, row: 10, movesRemaining: 2 };

    expect((ai as any).considerTradeVisit(envoy)).toBe(true);
    expect(dm.presentOffer.mock.calls[0][2]).toBe('gift_technology');
    expect(dm.presentOffer.mock.calls[0][5]).toBe('writing');
  });

  it('an ordinary warrior visit keeps the embassy gate (no channel, no deal)', () => {
    const { ai, dm } = makeEnvoyWorld({ diplomatAt: { col: 11, row: 10 }, embassy: false });
    const warrior: any = { id: 'warrior', type: 'warriors', civilizationId: 1, col: 11, row: 10, movesRemaining: 2 };
    expect((ai as any).considerTradeVisit(warrior)).toBe(false);
    expect(dm.presentOffer).not.toHaveBeenCalled();
  });

  it('a diplomat outside the window is back to its own menu', () => {
    const { ai, dm } = makeEnvoyWorld({ round: EARLY_TECH_EXCHANGE_MAX_ROUND + 1, diplomatAt: { col: 11, row: 10 } });
    const envoy: any = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 11, row: 10, movesRemaining: 2 };
    expect((ai as any).considerTradeVisit(envoy)).toBe(false);
    expect(dm.presentOffer).not.toHaveBeenCalled();
  });

  it('the envoy knocks once, not every turn — the cooldown holds', () => {
    const { ai, dm } = makeEnvoyWorld({ diplomatAt: { col: 11, row: 10 }, embassy: false });
    const envoy: any = { id: 'envoy', type: 'diplomat', civilizationId: 1, col: 11, row: 10, movesRemaining: 2 };

    expect((ai as any).considerTradeVisit(envoy)).toBe(true);
    // Same round: refused by the cooldown.
    envoy.movesRemaining = 2;
    expect((ai as any).considerTradeVisit(envoy)).toBe(false);
    expect(dm.presentOffer).toHaveBeenCalledTimes(1);
  });
});
