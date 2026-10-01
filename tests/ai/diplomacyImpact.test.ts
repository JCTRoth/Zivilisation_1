/**
 * The diplomacy model itself: `delta = base × personality × state × magnitude`.
 *
 * These tests pin the *shape* of the arithmetic rather than any one number, so
 * retuning a base value is a deliberate act and not an accident. The three
 * multipliers are checked independently because that is the property that makes
 * diplomacy strategic: the same act must land differently on a paranoid civ,
 * from a different relationship state, and at a different scale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { computeImpact, magnitudeOf, stateMultiplier, warEventFor } from '@/game/engine/diplomacy/DiplomaticImpacts';
import { diplomaticWeights, personalityMultiplier } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion, normalizeOpinion, REASON_HISTORY } from '@/game/engine/diplomacy/DiplomaticOpinion';

/** A civ with a chosen personality, so weights are controllable. */
function civ(id: number, name: string, personality: Record<string, number>, extra: Record<string, unknown> = {}): any {
  return {
    id,
    name,
    isAlive: true,
    resources: { gold: 200 },
    personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5, ...personality },
    ...extra,
  };
}

/** Paranoid and diplomatic: punished hardest, trusts least. */
const SUSPICIOUS = { aggression: 3, diplomacy: 8, military: 4, economy: 5 };
/** Belligerent: shrugs most things off. */
const BRUTE = { aggression: 9, diplomacy: 2, military: 9, economy: 3 };

/** The civ record for an id — the barbarian occupies index 0, so index ≠ id. */
function civOf(ge: any, id: number): any {
  const found = (ge.civilizations as any[]).find((c) => c.id === id);
  expect(found, `civ ${id} should exist`).toBeTruthy();
  return found;
}

function createEngine(overrides: Record<string, any> = {}): any {
  return {
    civilizations: [
      { id: -1, name: 'Barbarians', isAlive: true, resources: { gold: 0 } },
      civ(0, 'Rome', { aggression: 5, diplomacy: 5, military: 5, economy: 5 }, { isHuman: true }),
      civ(1, 'Carthage', SUSPICIOUS, { isAI: true }),
      civ(2, 'Babylon', BRUTE, { isAI: true }),
    ],
    units: [],
    cities: [],
    roundManager: { getRoundNumber: () => 10 },
    onStateChange: vi.fn(),
    ...overrides,
  };
}

describe('diplomacy impact model', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
    dm.markContact(0, 1);
    dm.markContact(0, 2);
    dm.markContact(1, 2);
  });

  // ─── The multiplier pipeline ───────────────────────────────────────

  describe('the multiplier pipeline', () => {
    it('every impact is base × personality × state × magnitude', () => {
      const weights = diplomaticWeights(ge.civilizations[1]);
      const result = computeImpact('surprise_attack', weights, 'peace');
      // The product is exactly the recorded delta — no hidden extra term.
      expect(result.delta).toBe(
        Math.round(result.base * result.personality * result.state * result.magnitude),
      );
      expect(result.base).toBeLessThan(0);
    });

    it('personality is a multiplier, not an offset: a suspicious civ feels it more', () => {
      const suspicious = diplomaticWeights(civOf(ge, 1));
      const brute = diplomaticWeights(civOf(ge, 2));
      const a = computeImpact('surprise_attack', suspicious, 'peace').delta;
      const b = computeImpact('surprise_attack', brute, 'peace').delta;
      // Same act, same state — only the personality differs.
      expect(a).toBeLessThan(b);
      expect(personalityMultiplier(suspicious, 'surprise_attack'))
        .toBeGreaterThan(personalityMultiplier(brute, 'surprise_attack'));
    });

    it('state matters: betraying an alliance costs more than attacking from peace', () => {
      const weights = diplomaticWeights(ge.civilizations[1]);
      const fromPeace = Math.abs(computeImpact('surprise_attack', weights, 'peace').delta);
      const fromAlliance = Math.abs(computeImpact('alliance_break', weights, 'alliance').delta);
      expect(fromAlliance).toBeGreaterThan(fromPeace);
      // ...and the state multiplier is what does it, for the same event.
      expect(stateMultiplier('alliance_break', weights, 'alliance'))
        .toBeGreaterThan(stateMultiplier('surprise_attack', weights, 'peace'));
    });

    it('magnitude scales with the size of the deal', () => {
      expect(magnitudeOf(undefined)).toBe(1);
      expect(magnitudeOf({ gold: 10 })).toBeLessThan(1);
      expect(magnitudeOf({ gold: 100 })).toBeCloseTo(1, 1);
      expect(magnitudeOf({ gold: 500 })).toBeGreaterThan(1.5);
      // A technology is a big gesture.
      expect(magnitudeOf({ tech: true })).toBeGreaterThan(1);
      // Bounded, so no deal can produce an absurd delta.
      expect(magnitudeOf({ gold: 1_000_000 })).toBeLessThanOrEqual(2);
    });

    it('a big exaction costs more goodwill than a small one', () => {
      dm.getRelation(0, 1)!.status = 'peace';
      const small = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 20 });
      const large = dm.previewProposal({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 800 });
      expect(large.score).toBeLessThan(small.score);
    });
  });

  // ─── War is the directed consequence ───────────────────────────────

  describe('declaring war', () => {
    it('costs the VICTIM goodwill, not the aggressor', () => {
      const aggressorBefore = dm.getAttitudeScore(0, 1);
      const victimBefore = dm.getAttitudeScore(1, 0);
      dm.declareWar(0, 1);
      // The wounded side is the one whose ledger moves: it is directed, so
      // Rome's opinion of Carthage is not what the attack costs.
      expect(dm.getAttitudeScore(1, 0)).toBeLessThan(victimBefore);
      expect(dm.getAttitudeScore(0, 1)).toBe(aggressorBefore);
    });

    it('sours the aggressor too when it breaks something it signed', () => {
      dm.formAlliance(0, 1);
      const before = dm.getAttitudeScore(0, 1);
      dm.declareWar(0, 1);
      expect(dm.getAttitudeScore(0, 1)).toBeLessThan(before);
    });

    it('hurts the victim far more when it had signed a pact', () => {
      dm.declareWar(0, 1);
      const fromPeace = dm.getOpinion(1, 0).grievance;
      const dm2 = new DiplomacyManager(createEngine());
      dm2.initialize([0, 1, 2]);
      dm2.markContact(0, 1);
      dm2.formAlliance(0, 1);
      dm2.declareWar(0, 1);
      expect(dm2.getOpinion(1, 0).grievance).toBeGreaterThan(fromPeace);
    });

    it('classifies the wrong act by what it interrupted', () => {
      expect(warEventFor('peace', 0)).toBe('surprise_attack');
      expect(warEventFor('alliance', 30)).toBe('alliance_break');
      expect(warEventFor('ceasefire', 2)).toBe('ceasefire_break');
      expect(warEventFor('ceasefire', 40)).toBe('late_ceasefire_break');
    });

    it('hardens a third party that knows both sides', () => {
      const before = dm.getAttitudeScore(1, 0);
      dm.declareWar(0, 2); // Babylon attacks Rome; Carthage knows both
      expect(dm.getAttitudeScore(1, 0)).toBeLessThan(before);
    });

    it('leaves a third party that has not met the aggressor alone', () => {
      const fresh = new DiplomacyManager(createEngine());
      fresh.initialize([0, 1, 2]);
      fresh.markContact(1, 0); // Carthage has met Rome, never Babylon
      const before = fresh.getAttitudeScore(1, 0);
      fresh.declareWar(0, 2);
      expect(fresh.getAttitudeScore(1, 0)).toBe(before);
    });
  });

  // ─── The ledger ────────────────────────────────────────────────────

  describe('the opinion ledger', () => {
    it('records a readable reason for everything that moves goodwill', () => {
      dm.declareWar(0, 1);
      const reasons = dm.getImpactReasons(1, 0);
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons[0].event).toBe('surprise_attack');
      expect(reasons[0].delta).toBeLessThan(0);
      expect(dm.impactLabel('surprise_attack')).toMatch(/warning/i);
    });

    it('keeps only the most recent reasons', () => {
      for (let i = 0; i < 20; i++) {
        dm.getRelation(0, 1)!.tradeGoldPerTurn = 0;
        dm.cancelTreaty(0, 1, 'open_borders');
        dm.signTreaty(0, 1, 'open_borders');
      }
      expect(dm.getImpactReasons(0, 1).length).toBeLessThanOrEqual(REASON_HISTORY);
    });

    it('clamps goodwill at both ends of the meter range', () => {
      const rel = dm.getRelation(0, 1)!;
      // Push it to the floor with real acts, not by writing the field.
      for (let i = 0; i < 10; i++) {
        dm.declareWar(0, 1);
        dm.makePeace(0, 1);
      }
      expect(rel.opinionBtoA.goodwill).toBeGreaterThanOrEqual(-100);
      // And it cannot be pushed past the top either.
      for (let i = 0; i < 60; i++) dm.formAlliance(0, 1);
      expect(rel.opinionAtoB.goodwill).toBeLessThanOrEqual(100);
    });

    it('goodwill is what the attitude meter reads', () => {
      const rel = dm.getRelation(0, 1)!;
      rel.opinionAtoB.goodwill = 40;
      expect(dm.getAttitudeScore(0, 1)).toBe(40);
      rel.opinionAtoB.goodwill = -40;
      expect(dm.getAttitudeScore(0, 1)).toBe(-40);
    });

    it('trust and grievance move in opposite directions for good and bad acts', () => {
      // Trust is earned first: a trade pact gives Carthage reason to rate Rome
      // as a reliable partner, so there is something for the betrayal to cost.
      dm.signTreaty(0, 1, 'trade_agreement', { goldPerTurn: 2 });
      const opinion = dm.getOpinion(1, 0);
      expect(opinion.respect).toBeGreaterThan(0);

      const respectBefore = opinion.respect;
      dm.declareWar(0, 1);
      expect(opinion.grievance).toBeGreaterThan(0);
      expect(opinion.respect).toBeLessThan(respectBefore);
    });
  });

  // ─── Persistence ───────────────────────────────────────────────────

  describe('persistence', () => {
    it('round-trips both directions through save and load', () => {
      dm.declareWar(0, 1);
      dm.formAlliance(0, 2);
      const saved = dm.getAllRelations().map((r) => ({ ...r, opinionAtoB: { ...r.opinionAtoB }, opinionBtoA: { ...r.opinionBtoA } }));

      const loaded = new DiplomacyManager(createEngine());
      loaded.restoreRelations(saved);
      expect(loaded.getAttitudeScore(1, 0)).toBe(dm.getAttitudeScore(1, 0));
      expect(loaded.getOpinion(1, 0).grievance).toBe(dm.getOpinion(1, 0).grievance);
      expect(loaded.getOpinion(0, 2).goodwill).toBe(dm.getOpinion(0, 2).goodwill);
    });

    it('repairs a v3 save that has no opinions at all', () => {
      const loaded = new DiplomacyManager(createEngine());
      loaded.restoreRelations([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { civA: 0, civB: 1, status: 'war', since: 3, reputationModifier: -20, treatiesBrokenByA: 1, treatiesBrokenByB: 0, activeTreaties: [], treatySince: {}, tradeGoldPerTurn: 0 } as any,
      ]);
      // Normalized rather than crashing the maths.
      expect(loaded.getAttitudeScore(0, 1)).toBe(0);
      expect(loaded.getOpinion(0, 1).grievance).toBe(0);
      expect(loaded.getOpinion(0, 1).reasons).toEqual([]);
    });

    it('normalizeOpinion fills every field and clamps hostile input', () => {
      expect(normalizeOpinion(undefined)).toEqual(createOpinion());
      const wild = normalizeOpinion({ goodwill: 9999, grievance: -5, fear: 400, respect: -1, offersRefused: -3 });
      expect(wild.goodwill).toBe(100);
      expect(wild.grievance).toBe(0);
      expect(wild.fear).toBe(100);
      expect(wild.respect).toBe(0);
      expect(wild.offersRefused).toBe(0);
    });
  });

  // ─── Fear tracks power, not events ─────────────────────────────────

  describe('fear', () => {
    it('rises when a neighbour outgrows you and fades when it weakens', () => {
      const relation = dm.getRelation(0, 1)!;
      // Give Rome a large army and run a turn.
      ge.units = Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`, type: 'legion', civilizationId: 0, attack: 10, defense: 5, col: i, row: i, movesRemaining: 1,
      }));
      ge.units.push({ id: 'b1', type: 'warriors', civilizationId: 1, attack: 1, defense: 1, col: 20, row: 20, movesRemaining: 1 });
      dm.processTurn(10);
      const feared = relation.opinionBtoA.fear;
      expect(feared).toBeGreaterThan(0);

      // Carthage arms to match, and the fear recedes.
      ge.units = ge.units.concat(Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`, type: 'legion', civilizationId: 1, attack: 10, defense: 5, col: 30 + i, row: 30, movesRemaining: 1,
      })));
      dm.processTurn(11);
      expect(relation.opinionBtoA.fear).toBeLessThan(feared);
    });
  });
});
