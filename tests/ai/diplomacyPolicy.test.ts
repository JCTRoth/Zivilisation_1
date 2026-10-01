/**
 * AI diplomatic policy: what an AI civ decides, and why.
 *
 * The old policy was a single gate — `aggression >= 4 && strengthRatio >=
 * 1.6` — with no war capacity, no cost to fighting, and coin-flip alliance
 * betrayal. These tests pin the replacements as behaviour, so the AI-vs-AI
 * behaviour in `scripts/run-ai-batch.mjs` is the product of a model rather than
 * an accident.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import {
  chooseAction,
  maxConcurrentWars,
  mayDeclareWar,
  scoreCandidates,
  shouldHonourMutualDefence,
  temperament,
  warAppetite,
  peaceAppetite,
  exhaustionDelta,
  EXHAUSTION_MAX,
  type PolicyContext,
} from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { diplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion } from '@/game/engine/diplomacy/DiplomaticOpinion';

const WARLORD = { aggression: 9, diplomacy: 2, military: 9, expansion: 6, science: 3, economy: 4 };
const TURTLE = { aggression: 2, diplomacy: 6, military: 7, expansion: 4, science: 6, economy: 6 };
const MERCHANT = { aggression: 4, diplomacy: 7, military: 3, expansion: 5, science: 6, economy: 9 };

function makeEngine(civs: Array<Record<string, unknown>>, round = 20): any {
  return {
    civilizations: civs.map((c, i) => ({
      id: i,
      name: `Civ${i}`,
      isAlive: true,
      isHuman: i === 0,
      isAI: i !== 0,
      resources: { gold: 300 },
      personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5, ...(c.personality as object) },
      ...c,
    })),
    units: [] as unknown[],
    cities: [] as unknown[],
    roundManager: { getRoundNumber: () => round },
    onStateChange: vi.fn(),
  };
}

/** Give a civ `n` legions, so strength is a known number. */
function army(ge: any, civId: number, n: number, attack = 10): void {
  for (let i = 0; i < n; i++) {
    ge.units.push({ id: `${civId}-${i}`, type: 'legion', civilizationId: civId, attack, defense: 5, col: i, row: i, movesRemaining: 1 });
  }
}

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    civId: 1,
    otherId: 0,
    weights: diplomaticWeights({ id: 1, personality: WARLORD }),
    opinion: createOpinion(),
    status: 'peace',
    treaties: [],
    ownStrength: 100,
    theirStrength: 20,
    ownGold: 300,
    activeWars: 0,
    maxWars: 3,
    exhaustion: 0,
    turnsSince: 30,
    roundsSincePeace: Infinity,
    sharedEnemy: false,
    round: 20,
    sequence: 1,
    ...over,
  };
}

describe('AI diplomatic policy', () => {
  describe('war capacity', () => {
    it('scales with temperament, and a turtle is held to one war', () => {
      const warlord = maxConcurrentWars(diplomaticWeights({ id: 1, personality: WARLORD }));
      const turtle = maxConcurrentWeights();
      expect(warlord).toBeGreaterThan(turtle);
      expect(turtle).toBe(1);
    });

    function maxConcurrentWeights(): number {
      return maxConcurrentWars(diplomaticWeights({ id: 2, personality: TURTLE }));
    }

    it('refuses another war at capacity, and says why', () => {
      const gate = mayDeclareWar(context({ activeWars: 3, maxWars: 3 }));
      expect(gate.ok).toBe(false);
      expect(gate.why).toMatch(/already fighting/);
    });

    it('refuses when exhausted, however good the target', () => {
      const gate = mayDeclareWar(context({ exhaustion: 19 }));
      expect(gate.ok).toBe(false);
      expect(gate.why).toMatch(/exhausted/);
    });

    it('refuses to break a peace that has not had time to stick', () => {
      const gate = mayDeclareWar(context({ roundsSincePeace: 2 }));
      expect(gate.ok).toBe(false);
      expect(gate.why).toMatch(/peace is too young/);
    });

    it('a civ that has never signed a peace is not on cooldown', () => {
      expect(mayDeclareWar(context({ roundsSincePeace: Infinity })).ok).toBe(true);
    });
  });

  describe('temperament', () => {
    it('a peaceful leader cannot conquer at any strength ratio', () => {
      expect(temperament(diplomaticWeights({ id: 2, personality: TURTLE }))).toBe(0);
      const candidates = scoreCandidates(context({
        weights: diplomaticWeights({ id: 2, personality: TURTLE }),
        ownStrength: 1000,
        theirStrength: 1,
      }));
      const war = candidates.find((c) => c.action === 'declare_war');
      expect(war?.score ?? 0).toBeLessThan(10);
    });

    it('a warlord will, and that is the whole difference', () => {
      const candidates = scoreCandidates(context({
        weights: diplomaticWeights({ id: 1, personality: WARLORD }),
        ownStrength: 1000,
        theirStrength: 1,
      }));
      const war = candidates.find((c) => c.action === 'declare_war');
      expect(war!.score).toBeGreaterThan(10);
    });

    it('an even match is not worth a war', () => {
      const candidates = scoreCandidates(context({ ownStrength: 100, theirStrength: 100 }));
      const war = candidates.find((c) => c.action === 'declare_war');
      expect(war!.score).toBeLessThan(10);
    });
  });

  describe('exhaustion', () => {
    it('dulls aggression and sharpens the desire for terms', () => {
      expect(warAppetite(0)).toBe(1);
      expect(warAppetite(20)).toBeLessThan(0.25);
      expect(peaceAppetite(20)).toBeGreaterThan(peaceAppetite(0));
    });

    it('is earned by fighting and heals at peace', () => {
      expect(exhaustionDelta('war', false)).toBeGreaterThan(0);
      expect(exhaustionDelta('peace', false)).toBeLessThan(0);
      expect(exhaustionDelta('war', true)).toBeGreaterThan(exhaustionDelta('war', false));
    });

    it('accumulates and recovers through processTurn, and is capped', () => {
      const ge = makeEngine([{}, { personality: WARLORD }]);
      const dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      dm.markContact(0, 1);
      army(ge, 0, 8);
      army(ge, 1, 2);
      dm.declareWar(1, 0);

      for (let r = 0; r < 6; r++) dm.processTurn(r);
      const worn = dm.getWarExhaustion(1);
      expect(worn).toBeGreaterThan(2);
      expect(dm.getWarExhaustion(1)).toBeLessThanOrEqual(EXHAUSTION_MAX);

      dm.makePeace(1, 0);
      for (let r = 0; r < 20; r++) dm.processTurn(r);
      expect(dm.getWarExhaustion(1)).toBeLessThan(worn);
    });

    it('a worn civ seeks peace instead of pressing its advantage', () => {
      const fresh = scoreCandidates(context({ ownStrength: 200, theirStrength: 20, status: 'war', exhaustion: 0 }));
      const worn = scoreCandidates(context({ ownStrength: 200, theirStrength: 20, status: 'war', exhaustion: 16 }));
      const scoreOf = (list: typeof fresh, action: string) => list.find((c) => c.action === action)?.score ?? -999;
      expect(scoreOf(worn, 'propose_peace')).toBeGreaterThan(scoreOf(fresh, 'propose_peace'));
    });
  });

  describe('alliances have a reason', () => {
    it('a shared enemy is worth an alliance', () => {
      const without = scoreCandidates(context({ sharedEnemy: false }));
      const with_ = scoreCandidates(context({ sharedEnemy: true }));
      const scoreOf = (list: typeof without, action: string) => list.find((c) => c.action === action)?.score ?? -999;
      expect(scoreOf(with_, 'propose_alliance')).toBeGreaterThan(scoreOf(without, 'propose_alliance') + 10);
    });

    it('an alliance is not offered to an existing ally', () => {
      const candidates = scoreCandidates(context({ status: 'alliance' }));
      expect(candidates.find((c) => c.action === 'propose_alliance')).toBeUndefined();
      expect(candidates.find((c) => c.action === 'offer_open_borders')).toBeUndefined();
      expect(candidates.find((c) => c.action === 'propose_trade_agreement')).toBeUndefined();
    });

    it('an alliance survives while it is going well', () => {
      // A diplomatic partner with no reason to leave: no fear, no grievance,
      // even strength, and a leader who does not tire of pacts.
      const opinion = createOpinion();
      opinion.respect = 70;
      const candidates = scoreCandidates(context({
        status: 'alliance',
        opinion,
        ownStrength: 100,
        theirStrength: 100,
        turnsSince: 6,
        weights: diplomaticWeights({ id: 1, personality: MERCHANT }),
      }));
      expect(candidates.find((c) => c.action === 'break_alliance')!.score).toBeLessThan(2);
    });

    it('a warlike leader eventually outgrows it', () => {
      const candidates = scoreCandidates(context({
        status: 'alliance',
        turnsSince: 24,
        weights: diplomaticWeights({ id: 1, personality: WARLORD }),
      }));
      expect(candidates.find((c) => c.action === 'break_alliance')!.score).toBeGreaterThanOrEqual(2);
    });
  });

  describe('tribute is leverage, not a coin flip', () => {
    it('is worth asking for only when they are weaker AND afraid', () => {
      const opinion = createOpinion();
      opinion.fear = 80;
      const candidates = scoreCandidates(context({ opinion, ownStrength: 400, theirStrength: 40 }));
      expect(candidates.find((c) => c.action === 'demand_tribute')?.score).toBeGreaterThanOrEqual(8);
    });

    it('is not worth asking when they are not afraid', () => {
      const candidates = scoreCandidates(context({ ownStrength: 400, theirStrength: 40 }));
      expect(candidates.find((c) => c.action === 'demand_tribute')).toBeUndefined();
    });
  });

  describe('mutual defence has consent', () => {
    it('is honoured against a beatable enemy', () => {
      expect(shouldHonourMutualDefence(context({ theirStrength: 50 })).honour).toBe(true);
    });

    it('is declined when the enemy outclasses us both', () => {
      const decision = shouldHonourMutualDefence(context({ theirStrength: 500, ownStrength: 100 }));
      expect(decision.honour).toBe(false);
      expect(decision.why).toMatch(/outclasses/);
    });

    it('is declined when the ally has no capacity left', () => {
      expect(shouldHonourMutualDefence(context({ activeWars: 3, maxWars: 3 })).honour).toBe(false);
    });

    it('is declined when the ally is worn down', () => {
      expect(shouldHonourMutualDefence(context({ exhaustion: 16 })).honour).toBe(false);
    });

    it('an abandoned ally is affected by being left', () => {
      const ge = makeEngine([{}, { personality: WARLORD }, { personality: TURTLE }]);
      const dm = new DiplomacyManager(ge);
      dm.initialize([0, 1, 2]);
      dm.markContact(1, 2);
      dm.formAlliance(1, 2);
      dm.signTreaty(1, 2, 'mutual_defense'); // the pact that needs consent
      dm.declareWar(1, 0);
      // Civ 0's army dwarfs the alliance's, so honouring the pact would be
      // hopeless — the consent check must decline.
      army(ge, 0, 30, 20);
      army(ge, 1, 1);
      const before = dm.getOpinion(1, 2).goodwill;
      dm.processTurn(5);
      expect(dm.isAtWar(2, 0)).toBe(false);
      expect(dm.getOpinion(1, 2).goodwill).toBeLessThan(before);
    });
  });

  describe('determinism', () => {
    it('the same state always produces the same decision', () => {
      const random = vi.spyOn(Math, 'random');
      const a = chooseAction(scoreCandidates(context()), context());
      random.mockClear();
      const b = chooseAction(scoreCandidates(context()), context());
      expect(a?.action).toBe(b?.action);
      // Nothing in the decision path rolls dice at all.
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();
    });

    it('a war decided by policy is not decided by a roll', () => {
      const ge = makeEngine([{}, { personality: WARLORD }], 20);
      const dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      dm.markContact(0, 1);
      army(ge, 1, 10);
      army(ge, 0, 1);
      const random = vi.spyOn(Math, 'random');
      dm.processAIDiplomacy(1);
      expect(dm.isAtWar(1, 0)).toBe(true);
      random.mockRestore();
    });
  });

  describe('proposal resolution', () => {
    let ge: any;
    let dm: DiplomacyManager;

    beforeEach(() => {
      ge = makeEngine([{}, { personality: MERCHANT }]);
      dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      dm.markContact(0, 1);
    });

    it('the terms decide it: a fortune asked of a pauper is refused', () => {
      army(ge, 0, 6);
      army(ge, 1, 1);
      ge.civilizations[1].resources.gold = 10;
      const preview = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 500 });
      expect(preview.accepted).toBe(false);
      // ...and the UI is told which term did it.
      expect(preview.decisiveFactor).toMatch(/spare|gold/);
      // The explanation is the size of the ask, not the power ratio.
      expect(preview.decisiveFactor).not.toMatch(/hurt me/);
    });

    it('the same demand is routine for a treasury that can absorb it', () => {
      army(ge, 0, 6);
      army(ge, 1, 1);
      ge.civilizations[1].resources.gold = 900;
      const preview = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 60 });
      expect(preview.score).toBeGreaterThan(-10);
    });

    it('proposal spam is self-defeating', () => {
      army(ge, 0, 6);
      army(ge, 1, 1);
      ge.civilizations[1].resources.gold = 120;
      // A borderline ask: refused at first, and every refusal makes the next
      // attempt worse instead of free.
      const proposal = { fromCivId: 0, toCivId: 1, action: 'demand_tribute' as const, goldAmount: 200 };
      const first = dm.previewProposal(proposal);
      for (let i = 0; i < 4; i++) dm.processProposal(proposal);
      const afterSpam = dm.previewProposal(proposal);
      expect(dm.getOpinion(1, 0).offersRefused).toBeGreaterThan(0);
      expect(afterSpam.score).toBeLessThan(first.score);
      expect(afterSpam.factors.some((f) => f.label.includes('refused their last'))).toBe(true);
    });

    it('a refusal is explained, and pride can veto outright', () => {
      const opinion = dm.getOpinion(1, 0);
      opinion.grievance = 95;
      const preview = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 10 });
      expect(preview.vetoed).toBe(true);
      expect(preview.accepted).toBe(false);
    });

    it('a goodwill relationship opens agreements that power alone would not', () => {
      army(ge, 0, 1);
      army(ge, 1, 1);
      const cold = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'propose_alliance' });
      dm.getOpinion(1, 0).goodwill = 60;
      dm.getOpinion(1, 0).respect = 60;
      const warm = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'propose_alliance' });
      expect(warm.score).toBeGreaterThan(cold.score);
    });

    it('an accepted demand leaves a mark on both sides', () => {
      army(ge, 0, 6);
      army(ge, 1, 1);
      ge.civilizations[1].resources.gold = 900;
      const before = dm.getTheirOpinion(1, 0).goodwill;
      const result = dm.processProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 50 });
      expect(result.accepted).toBe(true);
      expect(dm.getTheirOpinion(1, 0).goodwill).toBeLessThan(before);
    });
  });

  describe('restraint in a real engine', () => {
    it('an AI already fighting to its limit opens no new front', () => {
      // The warlord, the human, a turtle neighbour worth attacking, and enough
      // extra targets to fill the war quota.
      const ge = makeEngine(
        [{}, { personality: WARLORD }, { personality: TURTLE }, {}, {}, {}],
        20,
      );
      const dm = new DiplomacyManager(ge);
      dm.initialize([0, 1, 2, 3, 4, 5]);
      for (const id of [0, 2, 3, 4, 5]) dm.markContact(1, id);

      army(ge, 1, 12);
      army(ge, 0, 1);
      army(ge, 2, 1);
      for (const id of [3, 4, 5]) army(ge, id, 1);

      const limit = maxConcurrentWars(dm.weightsFor(1));
      for (let w = 0; w < limit; w++) dm.declareWar(1, 3 + w);
      expect(dm.getEnemies(1).length).toBeGreaterThanOrEqual(limit);

      // Civ 2 is a lone, weak turtle — the perfect target — but the quota is
      // full, so it is courted rather than attacked.
      dm.processAIDiplomacy(1);
      expect(dm.isAtWar(1, 2)).toBe(false);
    });
  });
});
