/**
 * Espionage — the diplomat inside a foreign city.
 *
 * Four actions, each with its own Civ I contract:
 *  - Establish Embassy: opens the channel the whole negotiation screen is
 *    gated on, and is remembered across save/load.
 *  - Steal Technology: takes ONE blind random tech from the pool the target
 *    holds and we do not, always blows the cover, always ends in war.
 *  - Investigate City: reads a city's internals, no side effects.
 *  - Industrial Sabotage: wipes the shields a city has banked.
 *
 * The detection rolls are seeded, so every branch here is deterministic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { scoreCandidates } from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import type { City } from '../types/game';

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
        technologies: ['pottery', 'iron_working', 'alphabet', 'writing'],
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

function makeCity(overrides: Partial<City> = {}): City {
  return {
    id: 'city-1',
    name: 'Tenochtitlan',
    civilizationId: 1,
    col: 4,
    row: 4,
    population: 5,
    buildings: ['granary', 'barracks'],
    currentProduction: { type: 'warrior', itemType: 'warrior', name: 'Warrior', cost: 20 },
    productionProgress: 14,
    ...overrides,
  } as City;
}

describe('Espionage — embassies', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('starts without an embassy', () => {
    expect(dm.hasEmbassy(0, 1)).toBe(false);
    expect(dm.getEmbassyCivs(0)).toEqual([]);
  });

  it('founding one opens the channel for both sides', () => {
    const result = dm.establishEmbassy(0, 1);
    expect(result.success).toBe(true);
    expect(result.outcome).toBe('embassy_established');
    expect(dm.hasEmbassy(0, 1)).toBe(true);
    expect(dm.hasEmbassy(1, 0)).toBe(true);
    expect(dm.getEmbassyCivs(0)).toEqual([1]);
  });

  it('refuses to found a second one', () => {
    dm.establishEmbassy(0, 1);
    const again = dm.establishEmbassy(0, 1);
    expect(again.success).toBe(false);
    expect(again.outcome).toBe('embassy_already');
  });

  it('cannot be founded while the two are at war', () => {
    dm.declareWar(0, 1);
    const result = dm.establishEmbassy(0, 1);
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('embassy_refused');
    expect(dm.hasEmbassy(0, 1)).toBe(false);
  });

  it('announces the new channel to the UI', () => {
    dm.establishEmbassy(0, 1);
    expect(ge.onStateChange).toHaveBeenCalledWith(
      'EMBASSY_ESTABLISHED',
      expect.objectContaining({ civA: 0, civB: 1 }),
    );
  });

  it('survives a save/load round trip', () => {
    dm.establishEmbassy(0, 1);
    const saved = dm.exportEmbassyPairs();
    expect(saved.length).toBe(1);

    const restored = new DiplomacyManager(createMockGameEngine());
    restored.initialize([0, 1]);
    restored.restoreEmbassyPairs(saved);
    expect(restored.hasEmbassy(0, 1)).toBe(true);
  });

  it('blocks the AI from proposing an Exchange of Knowledge without one', () => {
    // The swap has to be one the evaluator would actually take, or the
    // embassy gate would never be what is doing the blocking: give Bronze
    // Working (30), get Iron Working (50) back.
    ge.civilizations[1].technologies = ['pottery', 'bronze_working'];
    ge.civilizations[0].technologies = ['pottery', 'iron_working'];
    const ctx = {
      status: 'peace' as const,
      techsWeCanOffer: ['bronze_working'],
      techsWeWant: ['iron_working'],
    };
    // scoreCandidates reads a full PolicyContext; the embassy flag is the only
    // field under test here, so the rest is left at the policy's defaults.
    const base = {
      civId: 1, otherId: 0,
      weights: { warmongering: 5, hostility: 5, trustSensitivity: 5, greed: 5, loyalty: 5, paranoia: 5, vengeance: 5, xenophobia: 5, patience: 5 },
      opinion: { goodwill: 0, grievance: 0, fear: 0, respect: 0, offersRefused: 0, lastOfferRound: -1, reasons: [] },
      treaties: [], ownStrength: 10, theirStrength: 10, ownGold: 0,
      activeWars: 0, maxWars: 2, exhaustion: 0, turnsSince: 20, roundsSincePeace: 20,
      sharedEnemy: false, round: 5, sequence: 0,
      ...ctx,
    } as any;

    const without = scoreCandidates({ ...base, hasEmbassy: false });
    const withEmbassy = scoreCandidates({ ...base, hasEmbassy: true });

    expect(without.some((c: { action: string }) => c.action === 'offer_tech_exchange')).toBe(false);
    expect(withEmbassy.some((c: { action: string }) => c.action === 'offer_tech_exchange')).toBe(true);
  });
});

describe('Espionage — steal technology', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  /**
   * Run one attempt per round. The detection roll is seeded per
   * (operative, target, kind, round), so a fixed round would be the same
   * attempt forever; and once the cover is blown the pair is at war and every
   * further attempt is refused, so peace is made between attempts (which keeps
   * the opinion ledger — re-initialising would wipe it).
   */
  function sweepSteal(rounds = 40): Array<ReturnType<DiplomacyManager['stealTechnology']>> {
    const results: Array<ReturnType<DiplomacyManager['stealTechnology']>> = [];
    for (let round = 1; round <= rounds; round++) {
      ge.roundManager.getRoundNumber = () => round;
      results.push(dm.stealTechnology(0, 1));
      if (dm.getStatus(0, 1) === 'war') dm.makePeace(0, 1);
    }
    return results;
  }

  it('only ever offers techs the target holds and we do not', () => {
    const stealable = new Set(dm.getTechTradeOptions(0, 1).theyHaveWeLack);
    expect(stealable.size).toBeGreaterThan(0);
    for (const outcome of sweepSteal()) {
      if (outcome.techId) expect(stealable.has(outcome.techId)).toBe(true);
    }
  });

  it('grants the stolen tech and reports a blown cover', () => {
    const successes = sweepSteal().filter((r) => r.success);
    expect(successes.length).toBeGreaterThan(0);
    for (const result of successes) {
      expect(result.outcome).toBe('stolen');
      expect(result.coverBlown).toBe(true);
      expect(result.warDeclared).toBe(true);
      expect(result.techId).toBeTruthy();
    }
  });

  it('declares war the moment the cover is blown', () => {
    let warDeclared = 0;
    for (let round = 1; round <= 40; round++) {
      ge.roundManager.getRoundNumber = () => round;
      const result = dm.stealTechnology(0, 1);
      // Civ I never let a stolen secret stay quiet: every attempt — caught or
      // successful — ends with the cover blown.
      expect(result.coverBlown).toBe(true);
      if (result.warDeclared) {
        warDeclared++;
        expect(dm.getStatus(0, 1)).toBe('war');
        dm.makePeace(0, 1);
      }
    }
    expect(warDeclared).toBeGreaterThan(0);
  });

  it('writes the victim a stolen-tech grievance', () => {
    sweepSteal();
    const reasons = dm.getImpactReasons(1, 0);
    expect(reasons.some((r) => r.event === 'technology_stolen' || r.event === 'spy_detected')).toBe(true);
  });

  it('has nothing to steal when we already know everything they know', () => {
    ge.civilizations[0].technologies = [...ge.civilizations[1].technologies];
    const result = dm.stealTechnology(0, 1);
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('nothing_to_steal');
    expect(dm.getStatus(0, 1)).toBe('peace');
  });

  it('cannot be run at war', () => {
    dm.declareWar(0, 1);
    const result = dm.stealTechnology(0, 1);
    expect(result.success).toBe(false);
  });
});

describe('Espionage — city investigation and sabotage', () => {
  let dm: DiplomacyManager;
  let ge: any;

  beforeEach(() => {
    ge = createMockGameEngine();
    dm = new DiplomacyManager(ge);
    dm.initialize([0, 1]);
    dm.markContact(0, 1);
  });

  it('reports a city\'s internals without touching them', () => {
    const city = makeCity();
    const result = dm.investigateCity(0, city);
    expect(result.success).toBe(true);
    expect(result.report).toMatchObject({
      cityName: 'Tenochtitlan',
      population: 5,
      production: 'Warrior',
      productionProgress: 14,
    });
    expect(result.report?.buildings).toEqual(['granary', 'barracks']);
    // Untouched.
    expect(city.productionProgress).toBe(14);
    expect(city.civilizationId).toBe(1);
  });

  it('copies the building list, so a later change cannot rewrite history', () => {
    const city = makeCity();
    const result = dm.investigateCity(0, city);
    city.buildings!.push('library');
    expect(result.report?.buildings).toEqual(['granary', 'barracks']);
  });

  it('sabotage wipes the shields a city has banked', () => {
    const city = makeCity();
    // The detection roll is seeded per (operative, target, kind, round), so the
    // attempt has to move to a new round to be a new attempt.
    let sawSuccess = false;
    for (let round = 1; round <= 40 && !sawSuccess; round++) {
      ge.roundManager.getRoundNumber = () => round;
      city.productionProgress = 14;
      const result = dm.industrialSabotage(0, city);
      if (result.success) {
        sawSuccess = true;
        expect(result.outcome).toBe('sabotaged');
        expect(city.productionProgress).toBe(0);
      }
    }
    expect(sawSuccess).toBe(true);
  });

  it('a caught saboteur starts a war and leaves the city untouched', () => {
    const city = makeCity();
    let sawCaught = false;
    for (let round = 1; round <= 40 && !sawCaught; round++) {
      dm.initialize([0, 1]);
      dm.markContact(0, 1);
      ge.roundManager.getRoundNumber = () => round;
      city.productionProgress = 14;
      const result = dm.industrialSabotage(0, city);
      if (result.outcome === 'caught_sabotaging') {
        sawCaught = true;
        expect(result.coverBlown).toBe(true);
        expect(result.warDeclared).toBe(true);
        expect(city.productionProgress).toBe(14);
        expect(dm.getStatus(0, 1)).toBe('war');
      }
    }
    expect(sawCaught).toBe(true);
  });

  it('sabotage is refused at war', () => {
    const city = makeCity();
    dm.declareWar(0, 1);
    const result = dm.industrialSabotage(0, city);
    expect(result.success).toBe(false);
    expect(city.productionProgress).toBe(14);
  });
});
