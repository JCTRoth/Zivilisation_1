/**
 * Combat system scenarios.
 *
 * Regression focus — "runs over" one-shots:
 *   Combat used to be resolved by a SINGLE random roll whose loser was
 *   destroyed outright, regardless of either side's remaining health. That let
 *   a Scout (attack 0.5) annihilate a full-health Riflemen (defense 5) whenever
 *   its ~9% roll landed — a "run over" that ignores unit power entirely.
 *
 *   Combat rounds now only OVERRUN (destroy the defender and advance) when the
 *   attacker is at least as strong as the defender. A weaker attacker that wins
 *   the roll merely WEARS THE DEFENDER DOWN (25% health) and holds its tile, so
 *   a weak unit can no longer one-shot a much stronger full-health defender.
 *
 * These tests drive `GameEngine.combatUnit` directly with a stubbed map/city so
 * the outcome is fully deterministic (Math.random mocked).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

interface TestUnit {
  id: string;
  type: string;
  civilizationId: number;
  attack: number;
  defense: number;
  health: number;
  col: number;
  row: number;
  movesRemaining: number;
  isFortified?: boolean;
  isDefeated?: boolean;
  areTurnsDone?: boolean;
}

/**
 * Build a GameEngine whose tile/city lookups are stubbed so combat resolves
 * purely from the two units' stats. Optionally marks the defender's tile as a
 * city (auto-fortification +50%).
 */
function makeCombatEngine(
  defenderTerrain: string,
  opts: { fortress?: boolean; city?: boolean } = {},
): GameEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.civilizations = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.getTileAt = () => ({
    type: defenderTerrain,
    terrain: defenderTerrain,
    improvement: opts.fortress ? 'fortress' : null,
  });
  e.getCityAt = () => (opts.city ? { civilizationId: 1, population: 4 } : null);
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return e as GameEngine;
}

function unit(
  id: string,
  civ: number,
  type: string,
  attack: number,
  defense: number,
  col: number,
  row: number,
  overrides: Partial<TestUnit> = {},
): TestUnit {
  return {
    id,
    type,
    civilizationId: civ,
    attack,
    defense,
    health: 100,
    col,
    row,
    movesRemaining: 1,
    ...overrides,
  };
}

/** Add both units to the engine and return a typed accessor. */
function stage(e: GameEngine, attacker: TestUnit, defender: TestUnit) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = e as any;
  engine.units = [attacker, defender];
  return {
    attack: () => (engine.combatUnit as (a: TestUnit, d: TestUnit) => boolean)(attacker, defender),
  };
}

function spyRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The reported bug: weak attacker cannot overrun a strong, full-health unit
// ---------------------------------------------------------------------------

describe('Combat: no weak-attacker one-shots', () => {
  it('a Scout cannot destroy a full-health Riflemen in a single attack', () => {
    vi.useFakeTimers();
    const random = spyRandom(0); // force the attacker to "win" the roll
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const scout = unit('scout', 0, 'scout', 0.5, 1, 1, 1);
    const riflemen = unit('rifle', 1, 'riflemen', 3, 5, 2, 2);
    const { attack } = stage(e, scout, riflemen);

    const result = attack();

    // The weaker attacker did NOT overrun: the defender is wounded, not dead.
    expect(result).toBe(false);
    expect(riflemen.isDefeated).toBeFalsy();
    expect(riflemen.health).toBe(75);
    // The attacker never took the defender's tile and was not damaged either.
    expect(scout.col).toBe(1);
    expect(scout.row).toBe(1);
    expect(scout.health).toBe(100);
    // Attacking still spends the attacker's move.
    expect(scout.movesRemaining).toBe(0);
    random.mockRestore();
  });

  it('a Scout cannot one-shot a Battleship (defense 12) either', () => {
    vi.useFakeTimers();
    const random = spyRandom(0);
    const e = makeCombatEngine(TERRAIN_TYPES.OCEAN);
    const scout = unit('scout2', 0, 'scout', 0.5, 1, 1, 1);
    const battleship = unit('bb', 1, 'battleship', 18, 12, 2, 2);
    const { attack } = stage(e, scout, battleship);

    const result = attack();

    expect(result).toBe(false);
    expect(battleship.isDefeated).toBeFalsy();
    expect(battleship.health).toBe(75);
    random.mockRestore();
  });

  it('repeated hits eventually wear the stronger defender down (attrition works)', () => {
    vi.useFakeTimers();
    const random = spyRandom(0);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const scout = unit('scout3', 0, 'scout', 0.5, 1, 1, 1);
    const riflemen = unit('rifle3', 1, 'riflemen', 3, 5, 2, 2);
    const { attack } = stage(e, scout, riflemen);

    // 100 → 75 → 50 → 25 → 0 : four successful pushes finish the defender.
    expect(attack()).toBe(false);
    expect(riflemen.health).toBe(75);
    scout.movesRemaining = 1;
    expect(attack()).toBe(false);
    expect(riflemen.health).toBe(50);
    scout.movesRemaining = 1;
    expect(attack()).toBe(false);
    expect(riflemen.health).toBe(25);
    scout.movesRemaining = 1;
    expect(attack()).toBe(true); // the finish blow is now lethal
    expect(riflemen.isDefeated).toBe(true);
    random.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Stronger / equal attackers still decide combat
// ---------------------------------------------------------------------------

describe('Combat: decisive victories still work', () => {
  it('an attacker at least as strong destroys the defender and takes its tile', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.01);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const archer = unit('archer', 0, 'archer', 3, 2, 1, 1);
    const warrior = unit('warrior', 1, 'warrior', 1, 1, 2, 2);
    const { attack } = stage(e, archer, warrior);

    expect(attack()).toBe(true);
    expect(warrior.isDefeated).toBe(true);
    expect(archer.col).toBe(2);
    expect(archer.row).toBe(2);
    expect(archer.movesRemaining).toBe(0);
    random.mockRestore();
  });

  it('equal-strength units trade decisively on a winning roll', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.4); // 0.4 < 1 / (1 + 1)
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const attacker = unit('att', 0, 'warrior', 1, 1, 1, 1);
    const defender = unit('def', 1, 'warrior', 1, 1, 2, 2);
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(true);
    expect(defender.isDefeated).toBe(true);
    random.mockRestore();
  });

  it('the win roll threshold is the strength share (3 vs 9 → 25%)', () => {
    vi.useFakeTimers();

    // 0.24 < 0.25 → the attacker wins the roll (a wound, since 3 < 9).
    const wound = spyRandom(0.24);
    const e1 = makeCombatEngine(TERRAIN_TYPES.MOUNTAINS); // defender 3 → D = 3 * 3 = 9
    const a1 = unit('att2', 0, 'archer', 3, 1, 1, 1);
    const d1 = unit('def2', 1, 'archer', 3, 3, 2, 2);
    const first = stage(e1, a1, d1);
    expect(first.attack()).toBe(false);
    expect(d1.health).toBe(75);
    expect(a1.health).toBe(100);
    wound.mockRestore();

    // 0.26 > 0.25 → the defender wins the roll, the attacker takes 25 damage.
    const loss = spyRandom(0.26);
    const e2 = makeCombatEngine(TERRAIN_TYPES.MOUNTAINS);
    const a2 = unit('att3', 0, 'archer', 3, 1, 1, 1);
    const d2 = unit('def3', 1, 'archer', 3, 3, 2, 2);
    const second = stage(e2, a2, d2);
    expect(second.attack()).toBe(false);
    expect(a2.health).toBe(75);
    expect(d2.health).toBe(100);
    loss.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Terrain / fortification / city modify the defender's strength
// ---------------------------------------------------------------------------

describe('Combat: defensive modifiers', () => {
  it('mountain terrain stops a mid-strength attacker from overrunning', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.1); // attacker 3 / (3 + 9) = 25% → wins the roll

    const mountains = makeCombatEngine(TERRAIN_TYPES.MOUNTAINS);
    const a1 = unit('a1', 0, 'archer', 3, 1, 1, 1);
    const d1 = unit('d1', 1, 'archer', 3, 3, 2, 2);
    const m = stage(mountains, a1, d1);
    expect(m.attack()).toBe(false);
    expect(d1.isDefeated).toBeFalsy();

    // Same fight on plains: 3 >= 3 → decisive.
    const plains = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const a2 = unit('a2', 0, 'archer', 3, 1, 1, 1);
    const d2 = unit('d2', 1, 'archer', 3, 3, 2, 2);
    const p = stage(plains, a2, d2);
    expect(p.attack()).toBe(true);
    expect(d2.isDefeated).toBe(true);

    random.mockRestore();
  });

  it('fortification (+50%) prevents an even fight from being a one-shot', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.1);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const attacker = unit('fa', 0, 'warrior', 2, 1, 1, 1);
    const defender = unit('fd', 1, 'warrior', 2, 2, 2, 2, { isFortified: true });
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(false);
    expect(defender.isDefeated).toBeFalsy();
    expect(defender.health).toBe(75);
    random.mockRestore();
  });

  it('units inside a city are automatically fortified (+50%)', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.1);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS, { city: true });
    const attacker = unit('ca', 0, 'warrior', 2, 1, 1, 1);
    const defender = unit('cd', 1, 'warrior', 2, 2, 2, 2);
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(false);
    expect(defender.isDefeated).toBeFalsy();
    random.mockRestore();
  });

  it('a fortress stacks on top of terrain defense', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.1);
    const e = makeCombatEngine(TERRAIN_TYPES.HILLS, { fortress: true }); // D = 1 * 2 * 2 = 4
    const attacker = unit('fpa', 0, 'warrior', 1, 1, 1, 1);
    const defender = unit('fpd', 1, 'warrior', 1, 1, 2, 2);
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(false);
    expect(defender.isDefeated).toBeFalsy();
    random.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The defender's winning round
// ---------------------------------------------------------------------------

describe('Combat: when the defender wins the round', () => {
  it('damages the attacker by 25 and keeps it in place', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.99);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const attacker = unit('la', 0, 'warrior', 1, 1, 1, 1);
    const defender = unit('ld', 1, 'riflemen', 3, 5, 2, 2);
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(false);
    expect(attacker.health).toBe(75);
    expect(attacker.col).toBe(1);
    expect(attacker.row).toBe(1);
    expect(attacker.movesRemaining).toBe(0);
    expect(defender.isDefeated).toBeFalsy();
    expect(defender.health).toBe(100);
    random.mockRestore();
  });

  it('destroys the attacker once its health reaches 0', () => {
    vi.useFakeTimers();
    const random = spyRandom(0.99);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const attacker = unit('da', 0, 'warrior', 1, 1, 1, 1, { health: 20 });
    const defender = unit('dd', 1, 'riflemen', 3, 5, 2, 2);
    const { attack } = stage(e, attacker, defender);

    expect(attack()).toBe(false);
    expect(attacker.health).toBeLessThanOrEqual(0);
    expect(attacker.isDefeated).toBe(true);
    // The defender never moves.
    expect(defender.col).toBe(2);
    expect(defender.row).toBe(2);
    random.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// A weaker attacker that wins the roll reports a non-lethal hit
// ---------------------------------------------------------------------------

describe('Combat: wear-down event', () => {
  it('emits COMBAT_HIT (not COMBAT_VICTORY) when a weaker attacker wounds', () => {
    vi.useFakeTimers();
    const random = spyRandom(0);
    const e = makeCombatEngine(TERRAIN_TYPES.PLAINS);
    const emitted: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).onStateChange = (type: string) => emitted.push(type);
    const scout = unit('eh', 0, 'scout', 0.5, 1, 1, 1);
    const riflemen = unit('ehd', 1, 'riflemen', 3, 5, 2, 2);
    const { attack } = stage(e, scout, riflemen);

    expect(attack()).toBe(false);
    expect(emitted).toContain('COMBAT_HIT');
    expect(emitted).not.toContain('COMBAT_VICTORY');
    expect(emitted).not.toContain('UNIT_DEFEATED');
    random.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Defeated units must never linger as visible blockers / targets
// ---------------------------------------------------------------------------

describe('Defeated units must not linger on the board', () => {
  it('getUnitAt ignores a defeated unit (no ghost targeting)', () => {
    const e = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = e as any;
    engine.units = [
      {
        id: 'ghost', type: 'warrior', civilizationId: 1, col: 5, row: 5,
        health: 0, isDefeated: true, movesRemaining: 0, attack: 1, defense: 1, icon: '⚔️',
      },
    ];

    expect(engine.getUnitAt(5, 5)).toBeNull();
  });

  it('getUnitAt still returns a living unit sharing the tile with a ghost', () => {
    const e = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = e as any;
    const living = {
      id: 'living', type: 'archer', civilizationId: 0, col: 5, row: 5,
      health: 100, movesRemaining: 1, attack: 3, defense: 2, icon: '🏹',
    };
    engine.units = [
      {
        id: 'ghost2', type: 'warrior', civilizationId: 1, col: 5, row: 5,
        health: 0, isDefeated: true, movesRemaining: 0, attack: 1, defense: 1, icon: '⚔️',
      },
      living,
    ];

    // The attacker that just overran the defender shares the tile until the
    // defeated unit is removed — getUnitAt must resolve to the survivor.
    expect(engine.getUnitAt(5, 5)).toBe(living);
  });
});
