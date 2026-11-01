/**
 * Team coordination — Phase 4: solidarity economy.
 *
 * Inside a team, knowledge converges from the leading member to the trailing
 * one (never charged for it), broke teammates get bootstrapped from a member
 * that can spare the gold, teammate trade agreements are proposed, and a
 * member already fighting the team's war does not open an independent second
 * front.
 *
 * Structural note: a locked teammate pair is ALWAYS 'alliance' status, which
 * skips the courtship block in `scoreCandidates` — so the team flows live in
 * their own top-level block, and these tests deliberately use status
 * 'alliance' to mirror reality.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  scoreCandidates,
  mayDeclareWar,
  type PolicyContext,
} from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { diplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion } from '@/game/engine/diplomacy/DiplomaticOpinion';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import { RECONCILE_GOLD_FLOOR } from '@/data/GameConstants';

const WARLORD = { aggression: 9, diplomacy: 2, military: 9, expansion: 6, science: 3, economy: 4 };

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    civId: 1,
    otherId: 0,
    weights: diplomaticWeights({ id: 1, personality: WARLORD }),
    opinion: createOpinion(), // goodwill 0 — team flows must not need friendship
    status: 'alliance', // what a locked teammate pair always looks like
    treaties: ['open_borders', 'mutual_defense'],
    ownStrength: 100,
    theirStrength: 100,
    ownGold: 300,
    theirGold: 100,
    activeWars: 0,
    maxWars: 3,
    exhaustion: 0,
    turnsSince: 30,
    roundsSincePeace: Infinity,
    sharedEnemy: false,
    round: 20,
    sequence: 1,
    teammate: true,
    ...over,
  };
}

const find = (cands: ReturnType<typeof scoreCandidates>, action: string) =>
  cands.find((c) => c.action === action);

describe('team solidarity — scoreCandidates', () => {
  it('a leading teammate gifts knowledge to the trailing one, no friendship needed', () => {
    const cands = scoreCandidates(context({
      techsWeCanOffer: ['writing', 'alphabet'],
      ourTechCount: 6,
      theirTechCount: 3,
    }));
    const gift = find(cands, 'gift_technology');
    expect(gift, 'gift_technology candidate').toBeDefined();
    expect(gift!.score).toBeGreaterThanOrEqual(16);
    expect(gift!.because).toContain('team learns together');
  });

  it('no knowledge gift when the teammate is NOT behind', () => {
    const cands = scoreCandidates(context({
      techsWeCanOffer: ['writing'],
      ourTechCount: 3,
      theirTechCount: 6,
    }));
    // Regular friendship gifting needs goodwill > 35 — at 0 there must be none.
    expect(find(cands, 'gift_technology')).toBeUndefined();
  });

  it('a broke teammate gets bootstrapped even with zero goodwill', () => {
    const cands = scoreCandidates(context({
      ownGold: 300,
      theirGold: RECONCILE_GOLD_FLOOR - 1,
    }));
    const gift = find(cands, 'gift_gold');
    expect(gift, 'gift_gold candidate').toBeDefined();
    expect(gift!.score).toBeGreaterThanOrEqual(15);
    expect(gift!.because).toContain('solvent');
  });

  it('no bootstrap when the teammate is solvent or the donor is poor', () => {
    expect(find(scoreCandidates(context({ theirGold: RECONCILE_GOLD_FLOOR })), 'gift_gold')).toBeUndefined();
    expect(find(scoreCandidates(context({ ownGold: 100, theirGold: 10 })), 'gift_gold')).toBeUndefined();
  });

  it('teammate trade agreements are proposed (routes pay double)', () => {
    const cands = scoreCandidates(context());
    const trade = find(cands, 'propose_trade_agreement');
    expect(trade).toBeDefined();
    expect(trade!.score).toBeGreaterThanOrEqual(6);
  });

  it('a regular alliance (not a locked teammate) gets none of the team flows', () => {
    const cands = scoreCandidates(context({
      teammate: false,
      techsWeCanOffer: ['writing', 'alphabet'],
      ourTechCount: 6,
      theirTechCount: 3,
      theirGold: 10,
    }));
    expect(find(cands, 'gift_technology')).toBeUndefined();
    expect(find(cands, 'gift_gold')).toBeUndefined();
  });

  it('forbidden hostile actions stay filtered for teammates', () => {
    const cands = scoreCandidates(context({
      ownStrength: 500, theirStrength: 1, opinion: { ...createOpinion(), fear: 80 },
    }));
    expect(find(cands, 'declare_war')).toBeUndefined();
    expect(find(cands, 'break_alliance')).toBeUndefined();
    expect(find(cands, 'demand_tribute')).toBeUndefined();
  });
});

describe('war-focus discipline — mayDeclareWar', () => {
  it('a team member does not open a second front while the team is at war', () => {
    const result = mayDeclareWar(context({ teamMode: true, activeWars: 1, maxWars: 3 }));
    expect(result.ok).toBe(false);
    expect(result.why).toContain('one front at a time');
  });

  it('the same member may declare when the team is at peace', () => {
    expect(mayDeclareWar(context({ teamMode: true, activeWars: 0 })).ok).toBe(true);
  });

  it('free-for-all temperament limits are unchanged', () => {
    // Not a team game: the old concurrent-war limit alone applies.
    expect(mayDeclareWar(context({ teamMode: false, activeWars: 1, maxWars: 3 })).ok).toBe(true);
    expect(mayDeclareWar(context({ teamMode: false, activeWars: 3, maxWars: 3 })).ok).toBe(false);
  });
});

describe('teammates are never charged for knowledge — aiTechDealTerms', () => {
  function makeManager(teammates: boolean) {
    const personality = { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 };
    const ge: any = {
      civilizations: [
        // Thin treasury: a non-teammate would take the SALE branch here.
        { id: 0, name: 'Americans', isAlive: true, resources: { gold: 50 }, personality, technologies: ['pottery', 'writing', 'alphabet'] },
        { id: 1, name: 'Aztecs', isAlive: true, resources: { gold: 100 }, personality, technologies: ['pottery'] },
      ],
      units: [],
      cities: [],
      roundManager: { getRoundNumber: () => 1 },
      onStateChange: vi.fn(),
      teamManager: {
        enabled: teammates,
        isTeammate: (a: number, b: number) => teammates && a !== b,
        getTeamMembersOf: (civId: number) => (teammates ? [0, 1] : [civId]),
        getTeammates: (civId: number) => (teammates ? [0, 1].filter((id) => id !== civId) : []),
      },
    };
    const dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    return dm;
  }

  it('gives the most valuable missing secret away as a gift', () => {
    const dm = makeManager(true);
    const terms = dm.aiTechDealTerms(0, 1);
    expect(terms?.kind).toBe('gift');
    // Most valuable = highest research cost of what they lack.
    const missing = ['writing', 'alphabet'];
    const expected = missing.reduce((best, id) => {
      const cost = (t: string) => TECHNOLOGIES_DATA.find((x) => x.id === t)?.cost ?? 50;
      return cost(id) > cost(best) ? id : best;
    }, missing[0]);
    expect(terms?.techOffered).toBe(expected);
  });

  it('a non-teammate with the same thin treasury still sells', () => {
    const dm = makeManager(false);
    const terms = dm.aiTechDealTerms(0, 1);
    expect(terms?.kind).toBe('sale');
    expect(terms?.goldAmount).toBeGreaterThan(0);
  });
});
