/**
 * Central CombatSystem — the single source of truth for fighting.
 *
 * Covers the formulas (strength, terrain/fortification/city/fortress bonuses),
 * the round resolution (overrun rule, damage, destruction) and the
 * player-facing summary strings. A final block verifies the engine emits the
 * exact damage numbers the UI renders as floating popups, and that a
 * victorious attacker never advances into the defender's tile.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { CombatSystem } from '@/game/engine/CombatSystem';
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

describe('CombatSystem: strength formulas', () => {
  it('scales attack strength with remaining health', () => {
    expect(CombatSystem.attackerStrength(unit({ attack: 4, health: 100 }))).toBe(4);
    expect(CombatSystem.attackerStrength(unit({ attack: 4, health: 50 }))).toBe(2);
    expect(CombatSystem.attackerStrength(unit({ attack: 4, health: 25 }))).toBe(1);
  });

  it('stacks terrain, fortification, city and fortress defence', () => {
    const forests = { type: TERRAIN_TYPES.FOREST, terrain: TERRAIN_TYPES.FOREST };
    // Forest +50% → 2 * 1.5 = 3.
    expect(CombatSystem.defenderStrength(unit(), { defenderTile: forests })).toBeCloseTo(3);
    // Fortified → another ×1.5 → 4.5.
    expect(CombatSystem.defenderStrength(unit({ isFortified: true }), { defenderTile: forests })).toBeCloseTo(4.5);
    // Inside a city is automatic fortification when no explicit order is set.
    expect(CombatSystem.defenderStrength(unit(), { defenderTile: forests, defenderInCity: true })).toBeCloseTo(4.5);
    // Fortress (+100%) applied last on top of hills (+100%): 2 * 2 * 2 = 8.
    const hillsFortress = { type: TERRAIN_TYPES.HILLS, terrain: TERRAIN_TYPES.HILLS, improvement: 'fortress' };
    expect(CombatSystem.defenderStrength(unit(), { defenderTile: hillsFortress })).toBeCloseTo(8);
  });

  it('reports the attacker win chance as the strength share', () => {
    expect(CombatSystem.winChance(3, 9)).toBeCloseTo(0.25);
    expect(CombatSystem.winChance(0, 0)).toBe(0);
  });
});

describe('CombatSystem: unit rounds', () => {
  it('a weaker attacker only wounds — it cannot overrun', () => {
    const scout = unit({ type: 'scout', attack: 0.5, defense: 1 });
    const riflemen = unit({ type: 'riflemen', attack: 3, defense: 5 });

    const outcome = CombatSystem.resolveUnitRound(scout, riflemen, { random: () => 0 });

    expect(outcome.attackerWins).toBe(true);
    expect(outcome.canOverrun).toBe(false);
    expect(outcome.defenderDamage).toBe(25);
    expect(outcome.defenderDestroyed).toBe(false);
    expect(outcome.attackerDamage).toBe(0);
  });

  it('an equal-or-stronger attacker overruns and destroys the defender', () => {
    const archer = unit({ type: 'archer', attack: 3, defense: 2 });
    const warrior = unit({ type: 'warrior', attack: 1, defense: 1 });

    const outcome = CombatSystem.resolveUnitRound(archer, warrior, { random: () => 0.01 });

    expect(outcome.attackerWins).toBe(true);
    expect(outcome.canOverrun).toBe(true);
    expect(outcome.defenderDamage).toBe(100); // lethal = all remaining health
    expect(outcome.defenderDestroyed).toBe(true);
    expect(outcome.attackerDamage).toBe(0);
  });

  it('the defender winning the roll damages the attacker by 25', () => {
    const warrior = unit({ type: 'warrior', attack: 1, defense: 1 });
    const riflemen = unit({ type: 'riflemen', attack: 3, defense: 5 });

    const outcome = CombatSystem.resolveUnitRound(warrior, riflemen, { random: () => 0.99 });

    expect(outcome.attackerWins).toBe(false);
    expect(outcome.attackerDamage).toBe(25);
    expect(outcome.attackerDestroyed).toBe(false);
    expect(outcome.defenderDamage).toBe(0);
  });

  it('marks a low-health attacker as destroyed when it loses the round', () => {
    const wounded = unit({ attack: 1, defense: 1, health: 20 });
    const riflemen = unit({ type: 'riflemen', attack: 3, defense: 5 });

    const outcome = CombatSystem.resolveUnitRound(wounded, riflemen, { random: () => 0.99 });

    expect(outcome.attackerDestroyed).toBe(true);
  });
});

describe('CombatSystem: city rounds', () => {
  it('triples defence with walls unless the attacker ignores them', () => {
    const attacker = unit({ attack: 12, defense: 1 });
    const city = { population: 2, buildings: ['city_walls'] };

    const normal = CombatSystem.resolveCityRound(attacker, city, { random: () => 0.5 });
    expect(normal.cityHasWalls).toBe(true);
    expect(normal.wallsApplied).toBe(true);
    expect(normal.cityDefense).toBe(6); // 2 * 3

    const bomber = CombatSystem.resolveCityRound(attacker, city, { random: () => 0.5, ignoresWalls: true });
    expect(bomber.cityHasWalls).toBe(true);
    expect(bomber.wallsApplied).toBe(false);
    expect(bomber.cityDefense).toBe(2);

    const open = CombatSystem.resolveCityRound(attacker, { population: 2, buildings: [] }, { random: () => 0.5 });
    expect(open.cityHasWalls).toBe(false);
    expect(open.cityDefense).toBe(2);
  });

  it('a failed assault costs the attacker 25 HP and a won one costs nothing', () => {
    const attacker = unit({ attack: 2 });
    const city = { population: 4, buildings: [] };

    expect(CombatSystem.resolveCityRound(attacker, city, { random: () => 0.99 }).attackerDamage).toBe(25);
    expect(CombatSystem.resolveCityRound(attacker, city, { random: () => 0.01 }).attackerDamage).toBe(0);
  });
});

describe('CombatSystem: player-facing summaries', () => {
  it('describes victory, hit and defeat with the damage numbers', () => {
    const damage = { attackerDamage: 0, defenderDamage: 25 };
    expect(CombatSystem.describeUnitRound('victory', 'Legion', 'Warrior', { attackerDamage: 0, defenderDamage: 100 }))
      .toBe('Legion destroyed Warrior (−100 HP)');
    expect(CombatSystem.describeUnitRound('hit', 'Scout', 'Riflemen', damage))
      .toBe('Scout hit Riflemen for 25 HP');
    expect(CombatSystem.describeUnitRound('defeat', 'Warrior', 'Riflemen', { attackerDamage: 25, defenderDamage: 0 }))
      .toBe('Riflemen hit Warrior for 25 HP');
  });
});

describe('Engine unit combat: event payload feeds the popups', () => {
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

  function addUnit(e: GameEngine, id: string, type: string, attack: number, defense: number, col: number, row: number, health = 100) {
    const record: TestUnitRecord = {
      id, type, civilizationId: 0, attack, defense, health, col, row, movesRemaining: 1,
    };
    // Defender belongs to the other civ.
    if (id.startsWith('def')) record.civilizationId = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).units.push(record);
    return record;
  }

  it('emits defenderDamage on victory and keeps the attacker in place', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    e.onStateChange = (type, data) => events.push({ type, data: (data ?? {}) as Record<string, unknown> });
    const attacker = addUnit(e, 'att', 'archer', 3, 2, 1, 1);
    const defender = addUnit(e, 'def', 'warrior', 1, 1, 2, 2);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).combatUnit(attacker, defender);

    const victory = events.find((ev) => ev.type === 'COMBAT_VICTORY');
    expect(victory).toBeDefined();
    expect(victory!.data.defenderDamage).toBe(100);
    expect(victory!.data.attackerDamage).toBe(0);
    // Attacker survives but does NOT advance into the defender's tile.
    expect(attacker.col).toBe(1);
    expect(attacker.row).toBe(1);
    expect(attacker.movesRemaining).toBe(0);
    random.mockRestore();
    vi.useRealTimers();
  });

  it('emits attackerDamage on defeat', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    e.onStateChange = (type, data) => events.push({ type, data: (data ?? {}) as Record<string, unknown> });
    const attacker = addUnit(e, 'att', 'warrior', 1, 1, 1, 1);
    const defender = addUnit(e, 'def', 'riflemen', 3, 5, 2, 2);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).combatUnit(attacker, defender);

    const defeat = events.find((ev) => ev.type === 'COMBAT_DEFEAT');
    expect(defeat).toBeDefined();
    expect(defeat!.data.attackerDamage).toBe(25);
    expect(defeat!.data.defenderDamage).toBe(0);
    expect(attacker.health).toBe(75);
    expect(attacker.col).toBe(1);
    random.mockRestore();
    vi.useRealTimers();
  });
});
