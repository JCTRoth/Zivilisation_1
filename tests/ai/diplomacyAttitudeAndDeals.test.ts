/**
 * Attitude scoring and the advanced deal types (custom tribute, embargo, tech
 * exchange) exposed in the negotiation UI.
 *
 * Attitude used to collapse straight to a four-word tier. These tests pin the
 * split `getAttitudeScore` / `getAttitude` and the fact that both sides — engine
 * and UI — bucket the score through the same exported bands.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { attitudeFromScore, ATTITUDE_BANDS } from '@/game/engine/DiplomacyTypes';

function createMockGameEngine(overrides: Record<string, any> = {}): any {
  return {
    civilizations: [
      { id: 0, name: 'Americans', isAlive: true, isHuman: true, resources: { gold: 200 }, technologies: ['bronze_working'], personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
      { id: 1, name: 'Aztecs', isAlive: true, isAI: true, resources: { gold: 100 }, technologies: ['iron_working'], personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
      { id: 2, name: 'Babylonians', isAlive: true, isAI: true, resources: { gold: 150 }, technologies: [], personality: { aggression: 5, diplomacy: 5, military: 5, expansion: 5, science: 5, economy: 5 } },
    ],
    units: [],
    cities: [],
    roundManager: { getRoundNumber: () => 1 },
    onStateChange: vi.fn(),
    ...overrides,
  };
}

describe('attitude score and bands', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
  });

  it('scores with no relation as 0 (neutral)', () => {
    const bare = new DiplomacyManager(createMockGameEngine());
    expect(bare.getAttitudeScore(0, 1)).toBe(0);
    expect(bare.getAttitude(0, 1)).toBe('neutral');
  });

  it('buckets the score through the shared bands', () => {
    expect(attitudeFromScore(100)).toBe('friendly');
    expect(attitudeFromScore(15)).toBe('friendly');
    expect(attitudeFromScore(14)).toBe('neutral');
    expect(attitudeFromScore(-5)).toBe('neutral');
    expect(attitudeFromScore(-6)).toBe('annoyed');
    expect(attitudeFromScore(-20)).toBe('annoyed');
    expect(attitudeFromScore(-21)).toBe('hostile');
  });

  it('keeps the bands ordered so the first match is the strongest tier', () => {
    for (let i = 1; i < ATTITUDE_BANDS.length; i++) {
      expect(ATTITUDE_BANDS[i].min).toBeLessThan(ATTITUDE_BANDS[i - 1].min);
    }
  });

  it('getAttitude always equals attitudeFromScore(getAttitudeScore)', () => {
    const rel = dm.getRelation(0, 1)!;
    // Goodwill IS the score now, so the two can only agree — this is the
    // invariant that lets the UI draw a meter without inventing thresholds.
    for (const goodwill of [80, 20, 0, -10, -30, -80]) {
      rel.opinionAtoB.goodwill = goodwill;
      const score = dm.getAttitudeScore(0, 1);
      expect(score).toBe(goodwill);
      expect(dm.getAttitude(0, 1)).toBe(attitudeFromScore(score));
    }
  });

  it('war drags the score down and alliance lifts it', () => {
    const atPeace = dm.getAttitudeScore(0, 1);
    dm.formAlliance(0, 1);
    const allied = dm.getAttitudeScore(0, 1);
    dm.declareWar(0, 1);
    const atWar = dm.getAttitudeScore(0, 1);
    expect(allied).toBeGreaterThan(atPeace);
    expect(atWar).toBeLessThan(atPeace);
  });
});

describe('tribute with a custom amount', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
  });

  it('transfers exactly the demanded amount when the target can pay', () => {
    const res = dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 80 });
    expect(res.accepted).toBe(true);
    expect(res.goldTransferred).toBe(80);
    expect(ge.civilizations[0].resources.gold).toBe(280);
    expect(ge.civilizations[1].resources.gold).toBe(20);
  });

  it('never takes more than the target holds', () => {
    const res = dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'demand_tribute', goldAmount: 500 });
    expect(res.goldTransferred).toBe(100);
    expect(ge.civilizations[1].resources.gold).toBe(0);
    expect(ge.civilizations[0].resources.gold).toBe(300);
  });
});

describe('tech exchange', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);
  });

  it('swaps the technologies when both sides have what they claim', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(true);
    expect(ge.civilizations[0].technologies).toContain('iron_working');
    expect(ge.civilizations[1].technologies).toContain('bronze_working');
  });

  it('refuses when the offerer lacks the tech it promised', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange',
      techOffered: 'nuclear_fission', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/offered technology/i);
  });

  it('refuses when the target does not have the requested tech', () => {
    const res = dm.acceptOffer({
      fromCivId: 0, toCivId: 2, action: 'offer_tech_exchange',
      techOffered: 'bronze_working', techRequested: 'iron_working',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/do not have the requested/i);
  });

  it('requires both sides of the exchange to be named', () => {
    const res = dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'offer_tech_exchange' });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/both technologies/i);
  });
});

describe('embargo', () => {
  it('records the third-party target on the treaty', () => {
    const ge = createMockGameEngine();
    const dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);

    const res = dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'propose_embargo', embargoTargetId: 2 });
    expect(res.accepted).toBe(true);
    expect(dm.hasTreaty(0, 1, 'embargo_target')).toBe(true);
    expect(dm.getRelation(0, 1)!.embargoTargetCivId).toBe(2);
  });

  it('refuses without a target', () => {
    const ge = createMockGameEngine();
    const dm = new DiplomacyManager(ge);
    dm.initialize([0, 1, 2]);

    const res = dm.acceptOffer({ fromCivId: 0, toCivId: 1, action: 'propose_embargo' });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/embargo target/i);
  });
});
