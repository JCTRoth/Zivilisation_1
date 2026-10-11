/**
 * UnitRankSystem — the four-grade rank ladder.
 *
 * Covers the pure ladder math (thresholds, multipliers, legacy fallbacks,
 * Barracks seeding), the CombatSystem strength integration, and the engine
 * wiring: XP awards on round wins / kills / city capture and the
 * UNIT_PROMOTED event.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { CombatSystem } from '@/game/engine/CombatSystem';
import {
  COMBAT_XP,
  UNIT_RANK,
  UNIT_RANK_INFO,
  UNIT_RANK_MAX,
  awardCombatExperience,
  createRookieRankState,
  experienceToNextRank,
  getUnitRank,
  getUnitRankInfo,
  normalizeUnitRankFields,
  rankForExperience,
  rankStrengthMultiplier,
  startingRankForCity,
} from '@/game/engine/UnitRankSystem';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const unit = (overrides: Record<string, unknown> = {}) => ({
  id: 'u',
  type: 'warrior',
  civilizationId: 0,
  attack: 2,
  defense: 2,
  health: 100,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnitRankSystem: the ladder', () => {
  it('has four grades with Rookie as the invisible default', () => {
    expect(UNIT_RANK.ROOKIE).toBe(1);
    expect(UNIT_RANK.TRAINED).toBe(2);
    expect(UNIT_RANK.SEASONED).toBe(3);
    expect(UNIT_RANK.BATTLE_HARDENED).toBe(4);
    expect(UNIT_RANK_MAX).toBe(UNIT_RANK.BATTLE_HARDENED);

    const rookie = createRookieRankState();
    expect(rookie).toEqual({ experience: 0, rank: UNIT_RANK.ROOKIE, isVeteran: false });
    expect(getUnitRank(rookie)).toBe(UNIT_RANK.ROOKIE);
    expect(getUnitRankInfo(rookie).name).toBe('Rookie');
    // Rookies carry no bonus and draw no insignia.
    expect(getUnitRankInfo(rookie).strengthMultiplier).toBe(1);
    expect(getUnitRankInfo(rookie).chevrons).toBe(0);
  });

  it('steps the strength multiplier up per grade, capped at ×1.5', () => {
    expect(UNIT_RANK_INFO[UNIT_RANK.ROOKIE].strengthMultiplier).toBe(1);
    expect(UNIT_RANK_INFO[UNIT_RANK.TRAINED].strengthMultiplier).toBe(1.1);
    expect(UNIT_RANK_INFO[UNIT_RANK.SEASONED].strengthMultiplier).toBe(1.25);
    expect(UNIT_RANK_INFO[UNIT_RANK.BATTLE_HARDENED].strengthMultiplier).toBe(1.5);
    // The top of the ladder is the hard cap — no unit ever exceeds ×1.5.
    expect(UNIT_RANK_INFO[UNIT_RANK_MAX].strengthMultiplier).toBe(1.5);
    // One chevron per earned grade — the ladder reads bottom to top.
    expect(UNIT_RANK_INFO[UNIT_RANK.TRAINED].chevrons).toBe(1);
    expect(UNIT_RANK_INFO[UNIT_RANK.SEASONED].chevrons).toBe(2);
    expect(UNIT_RANK_INFO[UNIT_RANK.BATTLE_HARDENED].chevrons).toBe(3);
  });

  it('ranks experience against ascending thresholds', () => {
    expect(rankForExperience(0)).toBe(UNIT_RANK.ROOKIE);
    expect(rankForExperience(39)).toBe(UNIT_RANK.ROOKIE);
    expect(rankForExperience(40)).toBe(UNIT_RANK.TRAINED);
    expect(rankForExperience(119)).toBe(UNIT_RANK.TRAINED);
    expect(rankForExperience(120)).toBe(UNIT_RANK.SEASONED);
    expect(rankForExperience(279)).toBe(UNIT_RANK.SEASONED);
    expect(rankForExperience(280)).toBe(UNIT_RANK.BATTLE_HARDENED);
    expect(rankForExperience(9999)).toBe(UNIT_RANK.BATTLE_HARDENED);
  });

  it('falls back to the legacy isVeteran flag and clamps bad ranks', () => {
    expect(getUnitRank({ isVeteran: true })).toBe(UNIT_RANK.SEASONED);
    expect(getUnitRank({ isVeteran: false })).toBe(UNIT_RANK.ROOKIE);
    expect(getUnitRank({ rank: 99 })).toBe(UNIT_RANK.BATTLE_HARDENED);
    expect(getUnitRank({ rank: -3 })).toBe(UNIT_RANK.ROOKIE);
    expect(getUnitRank(null)).toBe(UNIT_RANK.ROOKIE);
    expect(rankStrengthMultiplier(undefined)).toBe(1);
  });

  it('reports the XP still needed for the next grade (0 at the top)', () => {
    expect(experienceToNextRank({ experience: 0 })).toBe(40);
    expect(experienceToNextRank({ experience: 40 })).toBe(80);
    expect(experienceToNextRank({ experience: 279 })).toBe(1);
    expect(experienceToNextRank({ experience: 280 })).toBe(0);
  });
});

describe('UnitRankSystem: awarding experience', () => {
  it('promotes exactly at the threshold and keeps isVeteran in sync', () => {
    const rookie = createRookieRankState();

    const first = awardCombatExperience(rookie, COMBAT_XP.ROUND_WON + COMBAT_XP.UNIT_DESTROYED);
    expect(first.promoted).toBe(true);
    expect(first.rankBefore).toBe(UNIT_RANK.ROOKIE);
    expect(first.rankAfter).toBe(UNIT_RANK.TRAINED);
    expect(rookie.experience).toBe(40);
    expect(rookie.rank).toBe(UNIT_RANK.TRAINED);
    expect(rookie.isVeteran).toBe(false); // Trained is not yet "seasoned"

    const second = awardCombatExperience(rookie, 80);
    expect(second.promoted).toBe(true);
    expect(second.rankAfter).toBe(UNIT_RANK.SEASONED);
    expect(rookie.isVeteran).toBe(true); // Seasoned and up set the legacy flag
  });

  it('does not promote below a threshold and caps at Battle-Hardened', () => {
    const fresh = createRookieRankState();
    const shy = awardCombatExperience(fresh, 39);
    expect(shy.promoted).toBe(false);
    expect(getUnitRank(fresh)).toBe(UNIT_RANK.ROOKIE);

    const almostTop = createRookieRankState();
    awardCombatExperience(almostTop, UNIT_RANK_INFO[UNIT_RANK.BATTLE_HARDENED].xpThreshold - 1);
    const lastStep = awardCombatExperience(almostTop, 1);
    expect(lastStep.promoted).toBe(true);
    expect(lastStep.rankAfter).toBe(UNIT_RANK.BATTLE_HARDENED);

    const more = awardCombatExperience(almostTop, 50);
    expect(more.promoted).toBe(false);
    expect(more.rankAfter).toBe(UNIT_RANK.BATTLE_HARDENED);
  });
});

describe('UnitRankSystem: save compatibility and Barracks seeding', () => {
  it('normalizes units from saves written before the rank system', () => {
    const oldUnit = { isVeteran: false } as { experience?: number; rank?: number; isVeteran?: boolean };
    normalizeUnitRankFields(oldUnit);
    expect(oldUnit.rank).toBe(UNIT_RANK.ROOKIE);
    expect(oldUnit.experience).toBe(0);

    const oldVeteran = { isVeteran: true } as { experience?: number; rank?: number; isVeteran?: boolean };
    normalizeUnitRankFields(oldVeteran);
    expect(oldVeteran.rank).toBe(UNIT_RANK.SEASONED);
    expect(oldVeteran.experience).toBe(UNIT_RANK_INFO[UNIT_RANK.SEASONED].xpThreshold);
    expect(oldVeteran.isVeteran).toBe(true);
  });

  it('rolls Barracks combat units off the ways as Seasoned', () => {
    const barracksCity = { buildings: ['barracks', 'granary'] };
    const born = startingRankForCity(barracksCity, 'military');
    expect(born.rank).toBe(UNIT_RANK.SEASONED);
    expect(born.experience).toBe(UNIT_RANK_INFO[UNIT_RANK.SEASONED].xpThreshold);
    expect(born.isVeteran).toBe(true);

    // Civilians ignore the Barracks bonus…
    expect(startingRankForCity(barracksCity, 'civilian').rank).toBe(UNIT_RANK.ROOKIE);
    // …and a barracks-less city produces plain Rookies.
    expect(startingRankForCity({ buildings: ['granary'] }, 'military').rank).toBe(UNIT_RANK.ROOKIE);
    expect(startingRankForCity(null, 'military').rank).toBe(UNIT_RANK.ROOKIE);
  });
});

describe('CombatSystem: rank feeds the strength formulas', () => {
  it('scales attacker and defender strength by the rank multiplier (cap ×1.5)', () => {
    expect(CombatSystem.attackerStrength(unit({ attack: 4, rank: UNIT_RANK.TRAINED }))).toBeCloseTo(4.4);
    expect(CombatSystem.attackerStrength(unit({ attack: 4, rank: UNIT_RANK.SEASONED }))).toBe(5);
    expect(CombatSystem.attackerStrength(unit({ attack: 4, rank: UNIT_RANK.BATTLE_HARDENED }))).toBe(6);
    // Health still multiplies on top of the rank bonus.
    expect(CombatSystem.attackerStrength(unit({ attack: 4, health: 50, rank: UNIT_RANK.BATTLE_HARDENED }))).toBe(3);

    expect(CombatSystem.defenderStrength(unit({ defense: 2, rank: UNIT_RANK.SEASONED }))).toBe(2.5);
    // Legacy isVeteran-only units (old saves) count as Seasoned.
    expect(CombatSystem.defenderStrength(unit({ defense: 2, isVeteran: true }))).toBe(2.5);
  });

  it('stacks the rank multiplier with terrain, fortification and fortress', () => {
    const forests = { type: TERRAIN_TYPES.FOREST, terrain: TERRAIN_TYPES.FOREST };
    // Forest ×1.5 + Seasoned ×1.25 on defence 2 → 2 * 1.25 * 1.5 = 3.75.
    expect(CombatSystem.defenderStrength(unit({ defense: 2, rank: UNIT_RANK.SEASONED }), { defenderTile: forests }))
      .toBeCloseTo(3.75);
    // …plus fortify ×1.5 → 5.625.
    expect(CombatSystem.defenderStrength(
      unit({ defense: 2, rank: UNIT_RANK.SEASONED, isFortified: true }),
      { defenderTile: forests },
    )).toBeCloseTo(5.625);
  });

  it('lets a Battle-Hardened attacker overrun an otherwise equal foe', () => {
    const veteran = unit({ type: 'legion', attack: 4, rank: UNIT_RANK.BATTLE_HARDENED });
    const equal = unit({ id: 'def', type: 'legion', defense: 2 });

    const outcome = CombatSystem.resolveUnitRound(veteran, equal, { random: () => 0.5 });
    // Battle-Hardened strength 6 vs defender 2 → wins the roll and overruns.
    expect(outcome.attackerWins).toBe(true);
    expect(outcome.canOverrun).toBe(true);
    expect(outcome.defenderDestroyed).toBe(true);
  });
});

describe('Engine: combat awards experience and emits UNIT_PROMOTED', () => {
  interface TestUnitRecord {
    id: string;
    type: string;
    civilizationId: number;
    attack: number;
    defense: number;
    health: number;
    col: number;
    row: number;
    movesRemaining: number;
    isDefeated?: boolean;
    rank?: number;
    experience?: number;
    isVeteran?: boolean;
  }

  function makeEngine() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = new GameEngine(null) as any;
    e.units = [];
    e.civilizations = [];
    e.onStateChange = null;
    e.unitTurnQueue = null;
    e.diplomacyManager = null;
    e.isPaused = true;
    e.getTileAt = () => ({ type: 'plains', terrain: 'plains', improvement: null });
    e.getCityAt = () => null;
    e.checkAndEndTurnIfNoMoves = () => undefined;
    return e as GameEngine;
  }

  function addUnit(
    e: GameEngine,
    id: string,
    type: string,
    attack: number,
    defense: number,
    col: number,
    row: number,
  ) {
    const record: TestUnitRecord = {
      id, type, civilizationId: id.startsWith('def') ? 1 : 0,
      attack, defense, health: 100, col, row, movesRemaining: 1,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).units.push(record);
    return record;
  }

  it('a killing blow grants a round win + destruction bonus and promotes once', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    e.onStateChange = (type, data) => events.push({ type, data: (data ?? {}) as Record<string, unknown> });
    const attacker = addUnit(e, 'att', 'archer', 3, 2, 1, 1);
    const defender = addUnit(e, 'def', 'warrior', 1, 1, 2, 2);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).combatUnit(attacker, defender);

    expect(attacker.experience).toBe(COMBAT_XP.ROUND_WON + COMBAT_XP.UNIT_DESTROYED);
    expect(attacker.rank).toBe(UNIT_RANK.TRAINED);

    const promotion = events.find((ev) => ev.type === 'UNIT_PROMOTED');
    expect(promotion).toBeDefined();
    expect(promotion!.data.previousRank).toBe(UNIT_RANK.ROOKIE);
    expect(promotion!.data.rank).toBe(UNIT_RANK.TRAINED);
    expect(promotion!.data.unit).toBe(attacker);

    // The promotion is announced BEFORE the combat event so the UI sync
    // already carries the new rank.
    const types = events.map((ev) => ev.type);
    expect(types.indexOf('UNIT_PROMOTED')).toBeLessThan(types.indexOf('COMBAT_VICTORY'));
    random.mockRestore();
    vi.useRealTimers();
  });

  it('a defender that repels an attack earns the round-win experience', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    e.onStateChange = () => undefined;
    const attacker = addUnit(e, 'att', 'warrior', 1, 1, 1, 1);
    const defender = addUnit(e, 'def', 'riflemen', 3, 5, 2, 2);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).combatUnit(attacker, defender);

    expect(attacker.experience ?? 0).toBe(0);
    expect(defender.experience).toBe(COMBAT_XP.ROUND_WON);
    expect(defender.rank).toBe(UNIT_RANK.ROOKIE); // 10 XP is below the threshold
    random.mockRestore();
    vi.useRealTimers();
  });

  it('climbs the whole ladder across enough kills (Battle-Hardened at 7 kills)', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const promotions: number[] = [];
    e.onStateChange = (type, data) => {
      if (type === 'UNIT_PROMOTED') {
        promotions.push(((data ?? {}) as { rank?: number }).rank ?? 0);
      }
    };
    const attacker = addUnit(e, 'att', 'legion', 4, 3, 1, 1);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);

    // Each kill = 40 XP: Trained@1, Seasoned@3, Battle-Hardened@7 kills.
    for (let kill = 1; kill <= 7; kill++) {
      const defender = addUnit(e, `def${kill}`, 'warrior', 1, 1, 2, 2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).combatUnit(attacker, defender);
      defender.isDefeated = true; // linger only for the removal timer
    }

    expect(attacker.experience).toBe(7 * 40);
    expect(attacker.rank).toBe(UNIT_RANK.BATTLE_HARDENED);
    expect(attacker.isVeteran).toBe(true);
    expect(promotions).toEqual([UNIT_RANK.TRAINED, UNIT_RANK.SEASONED, UNIT_RANK.BATTLE_HARDENED]);
    random.mockRestore();
    vi.useRealTimers();
  });

  it('pays city-capture experience to the taker', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    e.onStateChange = () => undefined;
    const attacker = addUnit(e, 'att', 'legion', 4, 3, 5, 5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0 }, { id: 1 }];
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 1, col: 5, row: 5,
      population: 3, buildings: [] as string[], production: 0, food: 0, gold: 0, science: 0,
    };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = (e as any).resolveCityCombat(attacker, city);

    expect(outcome.result).toBe('captured');
    expect(attacker.experience).toBe(COMBAT_XP.CITY_CAPTURED);
    expect(attacker.rank).toBe(UNIT_RANK.TRAINED); // 60 XP clears the first threshold
    random.mockRestore();
    vi.useRealTimers();
  });

  it('pays kill experience for each garrison unit broken in a city assault', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    e.onStateChange = () => undefined;
    const attacker = addUnit(e, 'att', 'legion', 4, 3, 5, 5);
    const garrison = addUnit(e, 'def1', 'warrior', 1, 1, 5, 5);
    const city = {
      id: 'c1', name: 'Carthage', civilizationId: 1, col: 5, row: 5,
      population: 4, buildings: [] as string[], production: 0, food: 0, gold: 0, science: 0,
    };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = (e as any).resolveCityCombat(attacker, city);

    expect(outcome.result).toBe('hit');
    expect(garrison.isDefeated).toBe(true);
    expect(attacker.experience).toBe(COMBAT_XP.ROUND_WON + COMBAT_XP.UNIT_DESTROYED);
    random.mockRestore();
    vi.useRealTimers();
  });
});
