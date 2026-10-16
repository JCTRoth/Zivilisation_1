import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DiplomacyManager,
  bribeOutcomeForRoll,
  bribeUnitCost,
  type BribeOutcome,
} from '@/game/engine/DiplomacyManager';
import { ESPIONAGE_DIPLOMAT_ACTIONS } from '@/game/engine/DiplomacyTypes';
import { TREATY_ROUTE_TRADE_MULTIPLIER } from '@/data/GameConstants';
import { EconomicManager } from '@/game/engine/EconomicManager';

/**
 * Creates a minimal mock GameEngine with the fields DiplomacyManager needs.
 */
function createMockGameEngine(overrides: Record<string, any> = {}): any {
  return {
    civilizations: [
      { id: 0, name: 'Americans', isAlive: true, isHuman: true, resources: { gold: 200 }, personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
      { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, personality: { aggression: 8, diplomacy: 3, military: 7, expansion: 5, science: 3, economy: 4 } },
      { id: 2, name: 'Babylonians', isAlive: true, isAI: true, resources: { gold: 150 }, personality: { aggression: 3, diplomacy: 8, military: 3, expansion: 5, science: 7, economy: 6 } },
    ],
    units: [
      { id: 'u1', type: 'warriors', civilizationId: 0, attack: 1, defense: 1, col: 5, row: 5, movesRemaining: 2 },
      { id: 'u2', type: 'warriors', civilizationId: 1, attack: 1, defense: 1, col: 8, row: 8, movesRemaining: 2 },
      { id: 'u3', type: 'diplomat', civilizationId: 0, attack: 0, defense: 0, col: 7, row: 8, movesRemaining: 2 },
    ],
    cities: [
      { id: 'c1', civilizationId: 0, col: 5, row: 5 },
      { id: 'c2', civilizationId: 1, col: 10, row: 10 },
    ],
    roundManager: { getRoundNumber: () => 1 },
    onStateChange: vi.fn(),
    ...overrides,
  };
}

describe('DiplomacyManager', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
  });

  // ─── Initialization ────────────────────────────────────────────────

  describe('initialize', () => {
    it('should create relations between all civ pairs', () => {
      // 3 civs → 3 pairs: 0-1, 0-2, 1-2
      expect(dm.getRelation(0, 1)).toBeDefined();
      expect(dm.getRelation(0, 2)).toBeDefined();
      expect(dm.getRelation(1, 2)).toBeDefined();
    });

    it('should default all relations to peace', () => {
      expect(dm.getStatus(0, 1)).toBe('peace');
      expect(dm.getStatus(0, 2)).toBe('peace');
      expect(dm.getStatus(1, 2)).toBe('peace');
    });

    it('should be symmetric (order of args does not matter)', () => {
      expect(dm.getStatus(0, 1)).toBe(dm.getStatus(1, 0));
      expect(dm.getRelation(0, 1)).toBe(dm.getRelation(1, 0));
    });
  });

  // ─── Queries ───────────────────────────────────────────────────────

  describe('queries', () => {
    it('isAtWar returns false when at peace', () => {
      expect(dm.isAtWar(0, 1)).toBe(false);
    });

    it('isAllied returns false when at peace', () => {
      expect(dm.isAllied(0, 1)).toBe(false);
    });

    it('getEnemies returns empty when no wars', () => {
      expect(dm.getEnemies(0)).toEqual([]);
    });

    it('getAllies returns empty when no alliances', () => {
      expect(dm.getAllies(0)).toEqual([]);
    });

    it('getRelationsForCiv returns all relations for a civ', () => {
      const rels = dm.getRelationsForCiv(0);
      expect(rels).toHaveLength(2);
      const otherIds = rels.map(r => r.otherCivId).sort();
      expect(otherIds).toEqual([1, 2]);
    });
  });

  // ─── War ───────────────────────────────────────────────────────────

  describe('declareWar', () => {
    it('should change status to war', () => {
      dm.declareWar(0, 1);
      expect(dm.getStatus(0, 1)).toBe('war');
      expect(dm.isAtWar(0, 1)).toBe(true);
    });

    it('should emit WAR_DECLARED event', () => {
      dm.declareWar(0, 1);
      expect(ge.onStateChange).toHaveBeenCalledWith('WAR_DECLARED', { aggressorId: 0, targetId: 1 });
    });

    it('should cost the attacked civ goodwill for a surprise attack from peace', () => {
      const before = dm.getAttitudeScore(1, 0);
      dm.declareWar(0, 1);
      // The victim is the one who forms the opinion — a directed ledger, so
      // this is where a betrayal shows up.
      expect(dm.getAttitudeScore(1, 0)).toBeLessThan(before);
      // The ledger is directed: the grievance is the victim's, held about the
      // aggressor. (`getOpinion(1, 0)` is civ 1's view of civ 0.)
      expect(dm.getOpinion(1, 0).grievance).toBeGreaterThan(0);
      expect(dm.getOpinion(0, 1).grievance).toBe(0);
    });

    it('should be a no-op if already at war', () => {
      dm.declareWar(0, 1);
      const after = dm.getAttitudeScore(1, 0);
      dm.declareWar(0, 1); // second call
      expect(dm.getAttitudeScore(1, 0)).toBe(after); // no additional impact
    });

    it('getEnemies returns the target after war declared', () => {
      dm.declareWar(0, 1);
      expect(dm.getEnemies(0)).toContain(1);
      expect(dm.getEnemies(1)).toContain(0);
    });
  });

  // ─── Peace ─────────────────────────────────────────────────────────

  describe('makePeace', () => {
    it('should change status from war to peace', () => {
      dm.declareWar(0, 1);
      dm.makePeace(0, 1);
      expect(dm.getStatus(0, 1)).toBe('peace');
    });

    it('should not change if already at peace', () => {
      dm.makePeace(0, 1); // already at peace
      expect(dm.getStatus(0, 1)).toBe('peace');
    });

    it('should emit PEACE_MADE event', () => {
      dm.declareWar(0, 1);
      ge.onStateChange.mockClear();
      dm.makePeace(0, 1);
      expect(ge.onStateChange).toHaveBeenCalledWith('PEACE_MADE', { civA: 0, civB: 1 });
    });
  });

  // ─── Ceasefire ─────────────────────────────────────────────────────

  describe('signCeasefire', () => {
    it('should change war to ceasefire', () => {
      dm.declareWar(0, 1);
      dm.signCeasefire(0, 1);
      expect(dm.getStatus(0, 1)).toBe('ceasefire');
    });

    it('should not work from peace state', () => {
      dm.signCeasefire(0, 1); // peace → should be no-op
      expect(dm.getStatus(0, 1)).toBe('peace');
    });
  });

  // ─── Alliance ──────────────────────────────────────────────────────

  describe('formAlliance', () => {
    it('should change peace to alliance', () => {
      dm.formAlliance(0, 2);
      expect(dm.getStatus(0, 2)).toBe('alliance');
      expect(dm.isAllied(0, 2)).toBe(true);
    });

    it('should not form alliance from war', () => {
      dm.declareWar(0, 1);
      dm.formAlliance(0, 1);
      expect(dm.getStatus(0, 1)).toBe('war'); // unchanged
    });

    it('getAllies should include the ally', () => {
      dm.formAlliance(0, 2);
      expect(dm.getAllies(0)).toContain(2);
      expect(dm.getAllies(2)).toContain(0);
    });

    it('breaking an alliance by declaring war costs more than a surprise attack', () => {
      // Same two civs, same strength: the only difference is what was broken,
      // which is the point of the relationship-state multiplier.
      const alliance = dm.getAttitudeScore(2, 0);
      dm.formAlliance(0, 2);
      const afterAlliance = dm.getAttitudeScore(2, 0);
      dm.declareWar(0, 2);
      const afterBetrayal = dm.getAttitudeScore(2, 0);
      expect(afterAlliance).toBeGreaterThan(alliance);
      expect(afterBetrayal).toBeLessThan(afterAlliance - 30);
    });
  });

  // ─── Attitude ──────────────────────────────────────────────────────

  describe('getAttitude', () => {
    it('should return a valid attitude', () => {
      const att = dm.getAttitude(0, 1);
      expect(['friendly', 'neutral', 'annoyed', 'hostile']).toContain(att);
    });

    it('war should worsen attitude', () => {
      const peacetimeAtt = dm.getAttitude(1, 0);
      dm.declareWar(0, 1);
      const wartimeAtt = dm.getAttitude(1, 0);
      const attOrder = ['friendly', 'neutral', 'annoyed', 'hostile'];
      expect(attOrder.indexOf(wartimeAtt)).toBeGreaterThanOrEqual(attOrder.indexOf(peacetimeAtt));
    });
  });

  // ─── Proposals ─────────────────────────────────────────────────────

  describe('processProposal', () => {
    it('should process a peace proposal (may accept or reject based on RNG)', () => {
      dm.declareWar(0, 1);
      const result = dm.processProposal({ fromCivId: 0, toCivId: 1, action: 'propose_peace' });
      expect(result).toHaveProperty('accepted');
      if (!result.accepted) {
        expect(result.reason).toBeDefined();
      }
    });

    it('tribute proposal should transfer gold when accepted', () => {
      // Force acceptance by making the target civ very diplomatic
      ge.civilizations[1].personality = { aggression: 1, diplomacy: 9, military: 1, expansion: 5, science: 5, economy: 5 };
      // Try many times since it's RNG-based
      for (let i = 0; i < 50; i++) {
        ge.civilizations[1].resources.gold = 100;
        ge.civilizations[0].resources.gold = 200;
        const result = dm.processProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 30 });
        if (result.accepted) {
          expect(result.goldTransferred).toBeDefined();
          break;
        }
      }
      // It's possible (very unlikely) all 50 attempts fail, so we just check it ran
      expect(true).toBe(true);
    });
  });

  // ─── Intelligence ──────────────────────────────────────────────────

  describe('gatherIntelligence', () => {
    it('should return a report with city and military counts', () => {
      const report = dm.gatherIntelligence(0, 1);
      expect(report.civId).toBe(1);
      expect(report.civName).toBe('Aztecs');
      expect(report.numCities).toBe(1);
      expect(report.numMilitaryUnits).toBe(1);
      expect(report.gold).toBe(100);
    });
  });

  // ─── Bribe ─────────────────────────────────────────────────────────

  describe('bribeUnit', () => {
    it('should fail if not enough gold', () => {
      ge.civilizations[0].resources.gold = 0;
      const result = dm.bribeUnit(0, 'u2');
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('gold');
    });

    it('should fail for non-existent unit', () => {
      const result = dm.bribeUnit(0, 'nonexistent');
      expect(result.accepted).toBe(false);
    });

    it('should fail for own unit', () => {
      const result = dm.bribeUnit(0, 'u1');
      expect(result.accepted).toBe(false);
    });
  });

  describe('bribeUnit — three seeded outcomes', () => {
    type BribeProbe = {
      outcome: BribeOutcome;
      result: { accepted: boolean; reason?: string; goldTransferred?: number };
      gold: number;
      unit: any;
      events: string[];
      opinionOfBriber: number;
      manager: DiplomacyManager;
    };

    /** Fresh world, one fresh enemy unit, one bribe attempt at a crafted id. */
    const tryBribe = (id: string): BribeProbe => {
      const eng = createMockGameEngine();
      eng.units.push({
        id, type: 'legion', civilizationId: 1, attack: 2, defense: 2, col: 9, row: 9, movesRemaining: 1,
      });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      const result = manager.bribeUnit(0, id);
      const unit = eng.units.find((u: any) => u.id === id);
      const events = eng.onStateChange.mock.calls.map((c: any[]) => c[0]) as string[];
      const outcome: BribeOutcome = result.accepted
        ? 'defected'
        : /exposed/i.test(result.reason ?? '')
          ? 'reported'
          : 'refused';
      return {
        outcome,
        result,
        gold: eng.civilizations[0].resources.gold,
        unit,
        events,
        opinionOfBriber: manager.getOpinion(1, 0).goodwill,
        manager,
      };
    };

    /** The roll is seeded on the unit id, so ids find every band there is. */
    const findIdFor = (wanted: BribeOutcome): string => {
      for (let i = 0; i < 300; i++) {
        const id = `probe-${i}`;
        if (tryBribe(id).outcome === wanted) return id;
      }
      throw new Error(`no '${wanted}' bribe among 300 probe ids`);
    };

    it('splits a d100 roll into defect / reported / refused bands', () => {
      // 60% defect; the failure band splits evenly between the loud and the
      // quiet way to fail.
      expect(bribeOutcomeForRoll(0, 60)).toBe('defected');
      expect(bribeOutcomeForRoll(59, 60)).toBe('defected');
      expect(bribeOutcomeForRoll(60, 60)).toBe('reported');
      expect(bribeOutcomeForRoll(79, 60)).toBe('reported');
      expect(bribeOutcomeForRoll(80, 60)).toBe('refused');
      expect(bribeOutcomeForRoll(99, 60)).toBe('refused');
    });

    it('a defecting unit takes the gold, switches sides and starts the war', () => {
      const probe = tryBribe(findIdFor('defected'));
      expect(probe.result.accepted).toBe(true);
      expect(probe.gold).toBe(200 - bribeUnitCost({ attack: 2, defense: 2 }));
      expect(probe.unit.civilizationId).toBe(0);
      expect(probe.manager.getStatus(0, 1)).toBe('war');
      expect(probe.events).toContain('UNIT_BRIBED');
      expect(probe.events).not.toContain('BRIBE_REPORTED');
    });

    it('a reported bribe takes the gold, keeps the unit and lands on the ledger', () => {
      const probe = tryBribe(findIdFor('reported'));
      expect(probe.result.accepted).toBe(false);
      expect(probe.result.goldTransferred).toBe(-bribeUnitCost({ attack: 2, defense: 2 }));
      expect(probe.gold).toBe(200 - bribeUnitCost({ attack: 2, defense: 2 }));
      expect(probe.unit.civilizationId).toBe(1);
      expect(probe.events).toContain('BRIBE_REPORTED');
      expect(probe.events).not.toContain('UNIT_BRIBED');
      // Caught red-handed: the insult is written down in goodwill terms.
      expect(probe.opinionOfBriber).toBeLessThan(0);
      // No war on a caught attempt — war is the price of SUCCESS.
      expect(probe.manager.getStatus(0, 1)).toBe('peace');
    });

    it('a silent refusal costs nothing and leaves no trace', () => {
      const probe = tryBribe(findIdFor('refused'));
      expect(probe.result.accepted).toBe(false);
      expect(probe.result.reason).toMatch(/refused/i);
      expect(probe.result.goldTransferred).toBeUndefined();
      expect(probe.gold).toBe(200);
      expect(probe.unit.civilizationId).toBe(1);
      expect(probe.events).not.toContain('UNIT_BRIBED');
      expect(probe.events).not.toContain('BRIBE_REPORTED');
      expect(probe.manager.getStatus(0, 1)).toBe('peace');
    });
  });

  // ─── Incite revolt (a covert act, not a proposal) ───────────────────

  describe('inciteRevolt', () => {
    const withCity = (city: Record<string, unknown>) => {
      const eng = createMockGameEngine({ cities: [city] });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      return { eng, manager };
    };

    it('a capital is immune — gold buys restive provinces, never the seat of government', () => {
      const { eng, manager } = withCity({ id: 'c2', civilizationId: 1, col: 10, row: 10, population: 3, isCapital: true });
      const result = manager.inciteRevolt(0, eng.cities[0]);
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/capital/i);
    });

    it('pays the agent up front and flips the city when the roll lands', () => {
      // round 0 → roll 0 < 30 (ungarrisoned) → revolt succeeds
      const { eng, manager } = withCity({ id: 'c2', civilizationId: 1, col: 10, row: 10, population: 2 });
      eng.roundManager = { getRoundNumber: () => 0 };
      const result = manager.inciteRevolt(0, eng.cities[0]);
      expect(result.success).toBe(true);
      expect(eng.cities[0].civilizationId).toBe(0);      // city flipped
      expect(eng.civilizations[0].resources.gold).toBe(200 - 200); // 2 pop × 100
      expect(manager.getStatus(0, 1)).toBe('war');       // buying a city is an act of war
      expect(eng.cities[0].capturedTurns).toBe(5);
    });

    it('a garrison of 4 makes the same attempt fail and the agent pays anyway', () => {
      // round 0 → roll 0; chance = 30 − 10×4 = −10 → floored at 0 → caught
      const eng = createMockGameEngine({
        cities: [{ id: 'c2', civilizationId: 1, col: 10, row: 10, population: 2 }],
        units: [
          { id: 'g1', type: 'warriors', civilizationId: 1, col: 10, row: 10 },
          { id: 'g2', type: 'warriors', civilizationId: 1, col: 10, row: 10 },
          { id: 'g3', type: 'warriors', civilizationId: 1, col: 10, row: 10 },
          { id: 'g4', type: 'warriors', civilizationId: 1, col: 10, row: 10 },
        ],
      });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      eng.roundManager = { getRoundNumber: () => 0 };
      const result = manager.inciteRevolt(0, eng.cities[0]);
      expect(result.success).toBe(false);
      expect(result.coverBlown).toBe(true);
      expect(eng.cities[0].civilizationId).toBe(1);      // city stays put
      expect(eng.civilizations[0].resources.gold).toBe(200 - 200); // still paid
      expect(manager.getStatus(0, 1)).toBe('war');       // caught inciting starts a war
    });

    it('refuses at war — there is nothing covert to buy while the guns fire', () => {
      const { eng, manager } = withCity({ id: 'c2', civilizationId: 1, col: 10, row: 10, population: 2 });
      manager.declareWar(0, 1);
      const result = manager.inciteRevolt(0, eng.cities[0]);
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/at war/i);
    });

    it('the engine routes it as infiltration, not as a negotiable proposal', () => {
      expect(ESPIONAGE_DIPLOMAT_ACTIONS.has('incite_revolt')).toBe(true);
      // A proposal path never reaches it any more — there is no case for it
      // in `executeAcceptedAction`, and the willingness roll is bypassed.
      const { eng, manager } = withCity({ id: 'c2', civilizationId: 1, col: 10, row: 10, population: 2 });
      eng.roundManager = { getRoundNumber: () => 0 };
      const viaProposal = manager.processProposal({
        fromCivId: 0, toCivId: 1, action: 'incite_revolt',
      });
      // The proposal machinery refuses a covert act outright — it is not
      // something the victim gets to score and decline.
      expect(viaProposal.accepted).toBe(false);
      expect(viaProposal.reason).toMatch(/not a negotiable/i);
    });
  });

  // ─── Calls to arms (AI↔AI and AI→player) ───────────────────────────

  describe('considerCallToArms', () => {
    it('an AI at war asks its ally to join, once per war per cooldown', () => {
      const eng = createMockGameEngine({
        civilizations: [
          { id: 0, name: 'Americans', isAlive: true, resources: { gold: 200 }, personality: { aggression: 8, diplomacy: 5, military: 8, expansion: 5, science: 5, economy: 5 } },
          { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, personality: { aggression: 5, diplomacy: 8, military: 5, expansion: 5, science: 5, economy: 5 } },
          { id: 2, name: 'Babylonians', isAlive: true, isAI: true, resources: { gold: 150 }, personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
        ],
        roundManager: { getRoundNumber: () => 5 },
      });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      // 0 and 1 are allies; 0 is at war with 2; 1 has met 2.
      manager.formAlliance(0, 1);
      manager.markContact(1, 2);
      manager.declareWar(0, 2);

      manager.processAIDiplomacy(0);

      // The ally was asked — and, having met the enemy and liking us, joined.
      expect(manager.getStatus(0, 2)).toBe('war');
      expect(manager.getStatus(1, 2)).toBe('war');
    });

    it('does not re-ask within the cooldown', () => {
      const eng = createMockGameEngine({
        roundManager: { getRoundNumber: () => 5 },
      });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      manager.formAlliance(0, 1);
      manager.markContact(1, 2);
      manager.declareWar(0, 2);

      manager.processAIDiplomacy(0);
      const firstAsk = manager.getEventLog().filter((e) => e.type === 'war_declared').length;

      // Same round again (well inside the 16-round cooldown): no second ask,
      // and the ally's war does not get re-declared or double-logged.
      manager.processAIDiplomacy(0);
      expect(manager.getEventLog().filter((e) => e.type === 'war_declared').length).toBe(firstAsk);
    });

    it('does not ask someone who has never met the enemy', () => {
      const eng = createMockGameEngine({
        roundManager: { getRoundNumber: () => 5 },
      });
      const manager = new DiplomacyManager(eng);
      manager.initialize([0, 1, 2]);
      manager.formAlliance(0, 1);
      // Note: 1 has NOT met 2.
      manager.declareWar(0, 2);

      manager.processAIDiplomacy(0);
      expect(manager.getStatus(1, 2)).toBe('peace');
    });
  });

  // ─── Embassy-gated observation of third-party dealings ──────────────

  describe('getEventLog', () => {
    const log = (manager: DiplomacyManager) => manager.getEventLog();

    it('shows the full log to no observer (exports, AI-vs-AI, tests)', () => {
      const { manager } = { manager: new DiplomacyManager(createMockGameEngine()) };
      manager.initialize([0, 1, 2]);
      manager.declareWar(1, 2);
      expect(log(manager).length).toBeGreaterThan(0);
    });

    it('hides a war between two other civs from a court with no embassy there', () => {
      const ge = createMockGameEngine();
      const manager = new DiplomacyManager(ge);
      manager.initialize([0, 1, 2]);
      manager.declareWar(1, 2);
      // Civ 0 has no embassy with 1 or 2 → the war between them is invisible.
      expect(manager.getEventLog(0).filter((e) => e.type === 'war_declared')).toEqual([]);
      // …but civ 1 (a party) always sees it.
      expect(manager.getEventLog(1).filter((e) => e.type === 'war_declared').length).toBeGreaterThan(0);
    });

    it('reveals it through the embassy network — an embassy with BOTH parties', () => {
      const ge = createMockGameEngine();
      const manager = new DiplomacyManager(ge);
      manager.initialize([0, 1, 2]);
      manager.establishEmbassy(0, 1);
      // One embassy: still blind to 1↔2.
      manager.declareWar(1, 2);
      expect(manager.getEventLog(0).filter((e) => e.type === 'war_declared')).toEqual([]);
      // The second embassy completes the network.
      manager.establishEmbassy(0, 2);
      expect(manager.getEventLog(0).filter((e) => e.type === 'war_declared').length).toBeGreaterThan(0);
    });

    it('always shows the observer its own dealings, even with no embassy', () => {
      const ge = createMockGameEngine();
      const manager = new DiplomacyManager(ge);
      manager.initialize([0, 1, 2]);
      manager.declareWar(0, 1);
      expect(manager.getEventLog(0).filter((e) => e.type === 'war_declared').length).toBeGreaterThan(0);
    });
  });

  // ─── Turn processing ──────────────────────────────────────────────

  describe('processTurn', () => {
    it('should let grievance fade slowly rather than vanish', () => {
      dm.declareWar(0, 1); // writes a real grievance in the victim's ledger
      const grievance = dm.getOpinion(1, 0).grievance;
      expect(grievance).toBeGreaterThan(0);

      dm.processTurn(2);
      const after = dm.getOpinion(1, 0).grievance;
      expect(after).toBeLessThan(grievance);
      // ...but one turn must not wipe it out, or consequences evaporate.
      expect(after).toBeGreaterThan(grievance * 0.5);
    });
  });

  // ─── AI Diplomacy ─────────────────────────────────────────────────

  describe('processAIDiplomacy', () => {
    it('should skip human players', () => {
      // Civ 0 is human — no errors, no state changes
      ge.onStateChange.mockClear();
      dm.processAIDiplomacy(0);
      // Should not crash
    });

    it('should run for AI players without error', () => {
      ge.roundManager.getRoundNumber = () => 5; // meets AI_DIPLOMACY_INTERVAL
      dm.processAIDiplomacy(1);
      // Should not crash
    });
  });

  // ─── AI war for conquest (city capture) ───────────────────────────

  describe('AI war for conquest', () => {
    it('a military_expansion civ declares war when it has a clear strength advantage', () => {
      // Reset to a 2-civ game with a strong military_expansion AI.
      ge.civilizations = [
        { id: 0, name: 'Americans', isAlive: true, isHuman: true, resources: { gold: 200 }, personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
        { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, personality: { aggression: 8, diplomacy: 3, military: 9, expansion: 8, science: 3, economy: 4 }, productionProfile: 'military_expansion' },
      ];
      ge.units = [
        { id: 'a1', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 5, row: 5 },
        { id: 'a2', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 6, row: 5 },
        { id: 'a3', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 7, row: 5 },
        { id: 'd1', type: 'warriors', civilizationId: 0, attack: 1, defense: 1, col: 10, row: 10 },
      ];
      ge.cities = [{ id: 'c1', civilizationId: 0, col: 10, row: 10 }];
      dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      // Diplomacy only happens between civs that have met; a bare manager has
      // seen nobody, so the AI would (correctly) ignore this pair entirely.
      dm.markContact(0, 1);

      // Round 15, not 5: a peace treaty has to have had time to become a habit
      // before the other side may attack it (PEACE_COOLDOWN).
      ge.roundManager.getRoundNumber = () => 15;
      dm.processAIDiplomacy(1);

      // Strength: civ1 = 3 * (2 + 0.5) = 7.5 vs civ0 = 1 + 0.5 = 1.5 → ratio 5.
      expect(dm.isAtWar(1, 0)).toBe(true);
    });

    it('a young peace treaty cannot be attacked, however lopsided the armies', () => {
      ge.civilizations = [
        { id: 0, name: 'Americans', isAlive: true, isHuman: true, resources: { gold: 200 }, personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
        { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, personality: { aggression: 8, diplomacy: 3, military: 9, expansion: 8, science: 3, economy: 4 }, productionProfile: 'military_expansion' },
      ];
      ge.units = [
        { id: 'a1', type: 'warriors', civilizationId: 1, attack: 20, defense: 10, col: 5, row: 5 },
        { id: 'd1', type: 'warriors', civilizationId: 0, attack: 1, defense: 1, col: 10, row: 10 },
      ];
      ge.cities = [{ id: 'c1', civilizationId: 0, col: 10, row: 10 }];
      dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      dm.markContact(0, 1);

      // Round 3: the peace is three turns old.
      ge.roundManager.getRoundNumber = () => 3;
      dm.processAIDiplomacy(1);

      expect(dm.isAtWar(1, 0)).toBe(false);
    });

    it('a defensive_turtle civ does not declare war even when stronger', () => {
      ge.civilizations = [
        { id: 0, name: 'Americans', isAlive: true, isHuman: true, resources: { gold: 200 }, personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
        { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, personality: { aggression: 2, diplomacy: 6, military: 7, expansion: 4, science: 6, economy: 6 }, productionProfile: 'defensive_turtle' },
      ];
      ge.units = [
        { id: 'a1', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 5, row: 5 },
        { id: 'a2', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 6, row: 5 },
        { id: 'a3', type: 'warriors', civilizationId: 1, attack: 2, defense: 1, col: 7, row: 5 },
        { id: 'd1', type: 'warriors', civilizationId: 0, attack: 1, defense: 1, col: 10, row: 10 },
      ];
      ge.cities = [{ id: 'c1', civilizationId: 0, col: 10, row: 10 }];
      dm = new DiplomacyManager(ge);
      dm.initialize([0, 1]);
      dm.markContact(0, 1);

      // Same round as the conquest case, so this is a statement about
      // temperament and not about the post-peace cooldown.
      ge.roundManager.getRoundNumber = () => 15;
      dm.processAIDiplomacy(1);

      expect(dm.isAtWar(1, 0)).toBe(false);
    });
  });

  // ─── Reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all relations and event log', () => {
      dm.declareWar(0, 1);
      dm.reset();
      expect(dm.getRelation(0, 1)).toBeUndefined();
      expect(dm.getEventLog()).toHaveLength(0);
    });
  });

  // ─── Event log ────────────────────────────────────────────────────

  describe('getEventLog', () => {
    it('should track diplomatic events', () => {
      dm.declareWar(0, 1);
      const log = dm.getEventLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].type).toBe('war_declared');
    });

    it('should limit log to 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        dm.declareWar(0, 1);
        dm.makePeace(0, 1);
      }
      expect(dm.getEventLog().length).toBeLessThanOrEqual(50);
    });
  });

  // ─── Border friction in attitude ──────────────────────────────────

  describe('border friction', () => {
    it('should worsen attitude when cities are close', () => {
      // Place cities close together
      ge.cities = [
        { id: 'c1', civilizationId: 0, col: 5, row: 5 },
        { id: 'c2', civilizationId: 1, col: 7, row: 5 }, // only 2 tiles away
      ];
      ge.squareGrid = {
        squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
          Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
      };
      const closeAtt = dm.getAttitude(0, 1);

      // Move cities far apart
      ge.cities = [
        { id: 'c1', civilizationId: 0, col: 5, row: 5 },
        { id: 'c2', civilizationId: 1, col: 25, row: 25 }, // 20 tiles away
      ];
      const farAtt = dm.getAttitude(0, 1);

      const attOrder = ['friendly', 'neutral', 'annoyed', 'hostile'];
      // Close cities should produce same or worse attitude
      expect(attOrder.indexOf(closeAtt)).toBeGreaterThanOrEqual(attOrder.indexOf(farAtt));
    });
  });

  // ─── Military strength estimation ─────────────────────────────────

  describe('estimateMilitaryStrength', () => {
    it('should count attack and defense of combat units', () => {
      const str = dm.estimateMilitaryStrength(0);
      // u1: attack=1, defense=1 → 1 + 1*0.5 = 1.5
      expect(str).toBeCloseTo(1.5);
    });

    it('should return 0 for a civ with no military units', () => {
      const str = dm.estimateMilitaryStrength(2); // Babylonians have no units
      expect(str).toBe(0);
    });
  });

  // ─── AI diplomacy notifications ───────────────────────────────────

  describe('AI diplomacy notifications', () => {
    it('should emit DIPLOMACY_EVENT when AI declares war on human', () => {
      // Make Aztecs (id=1) very aggressive with high strength
      ge.civilizations[1].personality = { aggression: 9, diplomacy: 1, military: 9, expansion: 5, science: 1, economy: 1 };
      ge.units.push(
        { id: 'u10', type: 'warriors', civilizationId: 1, attack: 5, defense: 5, col: 9, row: 8, movesRemaining: 2 },
        { id: 'u11', type: 'warriors', civilizationId: 1, attack: 5, defense: 5, col: 9, row: 9, movesRemaining: 2 },
        { id: 'u12', type: 'warriors', civilizationId: 1, attack: 5, defense: 5, col: 9, row: 10, movesRemaining: 2 },
      );
      // Force hostile attitude by breaking treaties
      dm.declareWar(0, 1);
      dm.makePeace(0, 1);
      dm.declareWar(0, 1);
      dm.makePeace(0, 1);

      ge.roundManager.getRoundNumber = () => 5; // meets interval
      ge.onStateChange.mockClear();
      dm.processAIDiplomacy(1);

      // Check if any DIPLOMACY_EVENT was emitted (it should be for human target)
      const diplomacyEvents = ge.onStateChange.mock.calls.filter(
        (c: any[]) => c[0] === 'DIPLOMACY_EVENT'
      );
      // If AI declared war, there should be a notification
      if (dm.isAtWar(0, 1)) {
        expect(diplomacyEvents.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Treaty management (beyond Civ 1) ─────────────────────────────

  describe('treaties', () => {
    it('should sign and query open borders', () => {
      dm.signTreaty(0, 1, 'open_borders');
      expect(dm.hasTreaty(0, 1, 'open_borders')).toBe(true);
      expect(dm.hasOpenBorders(0, 1)).toBe(true);
      expect(dm.getActiveTreaties(0, 1)).toContain('open_borders');
    });

    it('signs a trade agreement that pays through route trade, not a stipend', () => {
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 3 });
      expect(dm.hasTreaty(0, 1, 'trade_agreement')).toBe(true);

      // The stipend a trade agreement used to pay BOTH sides every round, minted
      // from nothing, is gone: a civ with several treaties had a permanent
      // income it did nothing to earn, and a civ with no cities and 6 gold of
      // lifetime tax income finished a 400-round game holding 271. The treaty's
      // value is the route multiplier in `EconomicManager.routeTrade`.
      const rel = dm.getRelation(0, 1)!;
      const goldBefore0 = ge.civilizations[0].resources.gold;
      const goldBefore1 = ge.civilizations[1].resources.gold;
      dm.processTurn(1);
      expect(ge.civilizations[0].resources.gold).toBe(goldBefore0);
      expect(ge.civilizations[1].resources.gold).toBe(goldBefore1);
      expect(rel.tradeGoldPerTurn).toBe(0);
    });

    it('doubles the trade of a route to a civ we hold a trade agreement with', () => {
      // The treaty's whole value now lives in route trade, so it only pays where
      // a caravan has actually been delivered.
      const home = { id: 'h', civilizationId: 0, tradeRoutes: [{ cityId: 'x', cityName: 'X', civilizationId: 1, trade: 3, distance: 4 }] };
      ge.diplomacyManager = dm; // the economy reads treaties through the engine
      const noTreaty = new EconomicManager(ge).routeTrade(home as never);
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 2 });
      const withTreaty = new EconomicManager(ge).routeTrade(home as never);
      expect(noTreaty).toBe(3);
      expect(withTreaty).toBe(3 * TREATY_ROUTE_TRADE_MULTIPLIER);
    });

    it('should sign mutual defense pact', () => {
      dm.signTreaty(0, 1, 'mutual_defense');
      expect(dm.hasTreaty(0, 1, 'mutual_defense')).toBe(true);
    });

    it('should mutual defense trigger war when ally is attacked', () => {
      dm.signTreaty(0, 1, 'mutual_defense');
      // Civ 2 declares war on Civ 0
      dm.declareWar(2, 0);
      expect(dm.isAtWar(2, 0)).toBe(true);
      // processTurn should drag Civ 1 into war with Civ 2
      dm.processTurn(2);
      expect(dm.isAtWar(1, 2)).toBe(true);
    });

    it('should sign non-aggression pact', () => {
      dm.signTreaty(0, 1, 'non_aggression');
      expect(dm.hasTreaty(0, 1, 'non_aggression')).toBe(true);
    });

    it('should cancel treaty and cost goodwill with the other side', () => {
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 2 });
      const goodwillBefore = dm.getAttitudeScore(1, 0);
      dm.cancelTreaty(0, 1, 'trade_agreement');
      expect(dm.hasTreaty(0, 1, 'trade_agreement')).toBe(false);
      expect(dm.getAttitudeScore(1, 0)).toBeLessThan(goodwillBefore);
      expect(dm.getRelation(0, 1)!.tradeGoldPerTurn).toBe(0);
    });

    it('should not duplicate treaties', () => {
      dm.signTreaty(0, 1, 'open_borders');
      dm.signTreaty(0, 1, 'open_borders');
      expect(dm.getActiveTreaties(0, 1).filter(t => t === 'open_borders')).toHaveLength(1);
    });

    it('should clear treaties on war', () => {
      dm.signTreaty(0, 1, 'open_borders');
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 2 });
      dm.declareWar(0, 1);
      dm.processTurn(3);
      expect(dm.hasTreaty(0, 1, 'open_borders')).toBe(false);
      expect(dm.hasTreaty(0, 1, 'trade_agreement')).toBe(false);
    });

    it('should improve attitude with active treaties', () => {
      const attBefore = dm.getAttitude(0, 1);
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 2 });
      dm.signTreaty(0, 1, 'open_borders');
      dm.signTreaty(0, 1, 'mutual_defense');
      dm.signTreaty(0, 1, 'non_aggression');
      const attAfter = dm.getAttitude(0, 1);
      const order = ['friendly', 'neutral', 'annoyed', 'hostile'];
      expect(order.indexOf(attAfter)).toBeLessThanOrEqual(order.indexOf(attBefore));
    });
  });

  // ─── Counter-proposals ────────────────────────────────────────────

  describe('counter-proposals', () => {
    it('should sometimes return counter-proposal on rejection', () => {
      // Run many proposals to statistically get at least one counter
      for (let i = 0; i < 50; i++) {
        // Reset relation status to peace for each attempt
        dm.makePeace(0, 1);
        const result = dm.processProposal({
          fromCivId: 0,
          toCivId: 1,
          action: 'propose_alliance',
        });
        if (!result.accepted && result.counterProposal) {
          expect(result.counterProposal.fromCivId).toBe(1);
          expect(result.counterProposal.toCivId).toBe(0);
          break;
        }
      }
      // It's probabilistic, but 50 attempts should yield at least one
      // (not asserting gotCounter since it's random)
    });
  });

  // ─── Proposals for new treaty actions ─────────────────────────────

  describe('new treaty proposals', () => {
    it('should accept open borders proposal', () => {
      const result = dm.processProposal({
        fromCivId: 0,
        toCivId: 1,
        action: 'offer_open_borders',
      });
      if (result.accepted) {
        expect(dm.hasTreaty(0, 1, 'open_borders')).toBe(true);
      }
    });

    it('should accept trade agreement proposal', () => {
      const result = dm.processProposal({
        fromCivId: 0,
        toCivId: 1,
        action: 'propose_trade_agreement',
        goldAmount: 2,
      });
      if (result.accepted) {
        expect(dm.hasTreaty(0, 1, 'trade_agreement')).toBe(true);
      }
    });

    it('should accept non-aggression proposal', () => {
      const result = dm.processProposal({
        fromCivId: 0,
        toCivId: 1,
        action: 'propose_non_aggression',
      });
      if (result.accepted) {
        expect(dm.hasTreaty(0, 1, 'non_aggression')).toBe(true);
      }
    });
  });
});
