import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { DEFEATED_UNIT_REMOVAL_DELAY_MS } from '@/game/engine/GameEngine';
import { MathUtils } from '@/utils/MathUtils';

/**
 * A unit killed in combat only lingers in `units` so its 💥/death-blink
 * animation can finish. During that window it is already out of the game.
 *
 * Regression (found in the AI-vs-AI game log): the delayed removal gave dead
 * units a second life — the next turn reset their movement points and the AI
 * moved/attacked with them, so a corpse fought again and could be "defeated"
 * a second time.
 */
describe('Defeated units stay dead', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  const spawn = (
    e: GameEngine,
    id: string,
    civ: number,
    type: string,
    col: number,
    row: number,
  ): Record<string, unknown> => {
    const unit: Record<string, unknown> = {
      id, civilizationId: civ, type, col, row,
      movesRemaining: 1, maxMoves: 1, health: 100,
      attack: 1, defense: 1, isFortified: false, hasMovedThisTurn: false,
    };
    (e as unknown as { units: Record<string, unknown>[] }).units.push(unit);
    return unit;
  };

  it('a defeated unit cannot be moved or ordered into a fight', async () => {
    const e = await setup();
    const corpse = spawn(e, 'corpse', 1, 'warrior', 5, 5);
    const enemy = spawn(e, 'enemy', 1, 'warrior', 6, 5);
    spawn(e, 'attacker', 0, 'legion', 4, 5);
    corpse.isDefeated = true;
    // The corpse still has movement points (the removal has not fired yet).
    corpse.movesRemaining = 1;

    expect(e.canUnitMoveTo('corpse', 6, 5)).toBe(false);
    expect(e.canMoveUnit('corpse', 6, 5)).toBe(false);
    expect(e.moveUnit('corpse', 6, 5)).toEqual({ success: false, reason: 'unit_defeated' });
    expect(corpse.col).toBe(5);
    // It cannot attack either.
    expect(e.combatUnit(corpse as never, enemy as never)).toBe(false);
  });

  it('a defeated unit is not put back in the turn queue', async () => {
    const e = await setup();
    spawn(e, 'fresh', 0, 'warrior', 5, 5);
    const corpse = spawn(e, 'corpse2', 0, 'warrior', 6, 5);
    corpse.isDefeated = true;
    corpse.movesRemaining = 1;

    e.unitTurnQueue.initializeQueue(0);

    const queue = e.unitTurnQueue.getQueue(0);
    expect(queue).toContain('fresh');
    expect(queue).not.toContain('corpse2');
  });

  it('a defeated unit gets no fresh movement points at the start of a turn', async () => {
    const e = await setup();
    const corpse = spawn(e, 'corpse3', 0, 'warrior', 5, 5);
    const fresh = spawn(e, 'fresh3', 0, 'warrior', 6, 5);
    corpse.isDefeated = true;
    corpse.movesRemaining = 0;
    fresh.movesRemaining = 0;

    // The turn-rollover reset (called by TurnManager.advanceTurn).
    (e.roundManager as unknown as { resetUnitsForPlayer: (id: number) => void })
      .resetUnitsForPlayer(0);

    expect(fresh.movesRemaining).toBeGreaterThan(0);
    expect(corpse.movesRemaining).toBe(0);
    expect(corpse.areTurnsDone).toBe(true);
  });

  it('the corpse lingers long enough for the combat animation to finish', () => {
    // 💥 cloud 800 ms + a 450 ms death fade must fit inside the removal delay.
    expect(DEFEATED_UNIT_REMOVAL_DELAY_MS).toBeGreaterThanOrEqual(1300);
  });
});

/**
 * The delayed removal must only ever take the LOSER with it.
 *
 * Bug (TODO "attacking unit disappears when winning"): after winning a fight the
 * attacker's unit vanished from the map a moment later. Two mechanisms had to
 * be ruled out, and both are pinned here:
 *  1. the removal timer filtered the wrong unit, and
 *  2. the city counter-strike resolved in the same action killed the winner.
 * Every winning path is exercised past the removal deadline with fake timers,
 * so no test has to wait in real time.
 */
describe('The winner of a fight survives the corpse cleanup', () => {
  let engine: GameEngine | null = null;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
    vi.useRealTimers();
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  const spawn = (
    e: GameEngine,
    id: string,
    civ: number,
    type: string,
    col: number,
    row: number,
    attack = 2,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unit: any = {
      id, civilizationId: civ, type, col, row,
      movesRemaining: 1, maxMoves: 1, health: 100, attack, defense: 1,
      icon: type, orders: 'none', areTurnsDone: false, isSkipped: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as unknown as { units: any[] }).units.push(unit);
    return unit;
  };

  /** An enemy city of civ 1 on a free, reachable land tile. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeEnemyCity = (e: GameEngine, population: number): any => {
    const width = (e as any).map?.width ?? 80;
    const height = (e as any).map?.height ?? 50;
    for (let row = 2; row < height - 2; row++) {
      for (let col = 2; col < width - 2; col++) {
        const terrain = String((e as any).getTileAt?.(col, row)?.type ?? '').toLowerCase();
        if (!['grassland', 'plains', 'desert', 'tundra'].includes(terrain)) continue;
        if (e.cities.some((c) => Math.abs(c.col - col) + Math.abs(c.row - row) < 4)) continue;
        if (e.units.some((u) => Math.max(Math.abs(u.col - col), Math.abs(u.row - row)) <= 1)) continue;
        const city = {
          id: `enemy_city_${col}_${row}`,
          name: 'Enemy City',
          civilizationId: 1,
          col,
          row,
          population,
          foodStored: 0,
          foodNeeded: population * 20,
          yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
          buildings: [],
          wonders: [],
          isCapital: false,
          buildQueue: [],
          currentProduction: null,
          productionStored: 0,
          productionProgress: 0,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as unknown as { cities: any[] }).cities.push(city);
        return city;
      }
    }
    throw new Error('no free spot for an enemy city');
  };

  const adjacentLand = (e: GameEngine, col: number, row: number) => {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = col + dc;
      const r = row + dr;
      const terrain = String((e as any).getTileAt?.(c, r)?.type ?? '').toLowerCase();
      if (terrain === 'ocean' || terrain === 'water' || terrain === 'lake') continue;
      if ((e as any).getUnitAt(c, r)) continue;
      return { col: c, row: r };
    }
    throw new Error('no adjacent land tile');
  };

  /** Run past the removal deadline so the corpse timer has fired. */
  const passRemovalDeadline = () => {
    vi.advanceTimersByTime(DEFEATED_UNIT_REMOVAL_DELAY_MS + 200);
  };

  it('field fight: the loser is removed, the winner stays', () => {
    const e = engine as GameEngine;
    const attacker = spawn(e, 'atk_field', 0, 'legion', 10, 10, 3);
    const defender = spawn(e, 'def_field', 1, 'warrior', 11, 10, 1);
    randomSpy.mockReturnValue(0.01); // attacker wins and overkills

    expect(e.combatUnit(attacker as never, defender as never)).toBe(true);
    passRemovalDeadline();

    expect(e.units.some((u) => u.id === 'atk_field')).toBe(true);
    expect(e.units.find((u) => u.id === 'atk_field')?.isDefeated).not.toBe(true);
    expect(e.units.some((u) => u.id === 'def_field')).toBe(false);
  });

  it('undefended city: capturing attacker stays after the cleanup', () => {
    const e = engine as GameEngine;
    const city = makeEnemyCity(e, 2);
    const spot = adjacentLand(e, city.col, city.row);
    spawn(e, 'atk_capture', 0, 'legion', spot.col, spot.row, 3);
    randomSpy.mockReturnValue(0.05);

    e.moveUnit('atk_capture', city.col, city.row);
    passRemovalDeadline();

    expect(e.cities.find((c) => c.id === city.id)?.civilizationId).toBe(0);
    const attacker = e.units.find((u) => u.id === 'atk_capture');
    expect(attacker).toBeDefined();
    expect(attacker?.isDefeated).not.toBe(true);
    expect(attacker?.health).toBe(100);
  });

  it('city that repels after a won garrison fight: the winner stays', () => {
    // 0.01 wins the unit round (the garrison dies), 0.99 then repels the city
    // roll. The city must NOT counter-strike the unit that just won.
    const e = engine as GameEngine;
    const city = makeEnemyCity(e, 2);
    spawn(e, 'guard_repel', 1, 'warrior', city.col, city.row, 1);
    const spot = adjacentLand(e, city.col, city.row);
    spawn(e, 'atk_repel', 0, 'legion', spot.col, spot.row, 3);
    randomSpy.mockReturnValueOnce(0.01).mockReturnValue(0.99);

    e.moveUnit('atk_repel', city.col, city.row);
    passRemovalDeadline();

    // The garrison is gone, the city still belongs to civ 1 …
    expect(e.cities.find((c) => c.id === city.id)?.civilizationId).toBe(1);
    expect(e.units.some((u) => u.id === 'guard_repel')).toBe(false);
    // … and the attacker that won the fight is still on the map, undamaged.
    const attacker = e.units.find((u) => u.id === 'atk_repel');
    expect(attacker).toBeDefined();
    expect(attacker?.isDefeated).not.toBe(true);
    expect(attacker?.health).toBe(100);
  });

  it('a LOSING attacker is still removed on time', () => {
    const e = engine as GameEngine;
    // A losing round costs COMBAT_DAMAGE (25) HP, so a 20 HP unit dies — that is
    // the case the corpse cleanup has to collect without touching the winner.
    const attacker = spawn(e, 'atk_lose', 0, 'warrior', 12, 12, 1);
    attacker.health = 20;
    spawn(e, 'def_win', 1, 'legion', 13, 12, 8);
    randomSpy.mockReturnValue(0.99); // defender wins

    e.combatUnit(attacker as never, e.units.find((u) => u.id === 'def_win') as never);
    // Still around (the death animation needs it), then gone.
    expect(e.units.some((u) => u.id === 'atk_lose')).toBe(true);
    passRemovalDeadline();
    expect(e.units.some((u) => u.id === 'atk_lose')).toBe(false);
    expect(e.units.some((u) => u.id === 'def_win')).toBe(true);
  });
});

describe('Damage number formatting', () => {
  it('never renders a negative zero', () => {
    expect(MathUtils.formatDamage(0)).toBe('0');
    expect(MathUtils.formatDamage(-0)).toBe('0');
    expect(MathUtils.formatDamage(0.4)).toBe('0');
    expect(MathUtils.formatDamage(25)).toBe('25');
    expect(MathUtils.formatDamage(12.5)).toBe('12.5');
    expect(MathUtils.formatDamage(Number.NaN)).toBe('0');
  });
});


/**
 * A fortified or sleeping unit has already chosen to sit this one out, so the
 * turn manager must never call it up — a garrison inside a city is not even
 * drawn on the map, so the player could not act with it anyway. Waking it
 * (unfortify / wake, including the AI's "enemy in sight" reaction) has to give
 * it its movement back, or the wake-up would be a no-op.
 */
describe('Fortified and sleeping units are not called up', () => {
  let engine: GameEngine | null = null;

  beforeEach(async () => {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
  });

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  const spawn = (e: GameEngine, id: string, col: number, row: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unit: any = {
      id, civilizationId: 0, type: 'warrior', col, row,
      movesRemaining: 1, maxMoves: 1, health: 100, attack: 2, defense: 1,
      icon: 'warrior', orders: 'none', areTurnsDone: false, isSkipped: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as unknown as { units: any[] }).units.push(unit);
    return unit;
  };

  const startOfTurn = (e: GameEngine) => {
    (e.roundManager as unknown as { resetUnitsForPlayer: (id: number) => void })
      .resetUnitsForPlayer(0);
  };

  it('a fortified unit keeps 0 movement and is not queued', () => {
    const e = engine as GameEngine;
    const garrison = spawn(e, 'fort', 5, 5);
    spawn(e, 'ready', 6, 5);

    e.unitFortify('fort');
    startOfTurn(e);

    expect(garrison.movesRemaining).toBe(0);
    expect(garrison.areTurnsDone).toBe(true);

    e.unitTurnQueue.initializeQueue(0);
    const queued = e.unitTurnQueue.getQueue(0);
    expect(queued).toContain('ready');
    expect(queued).not.toContain('fort');
    // Whatever the first queued unit is, the fortified one is never called up.
    expect(e.unitTurnQueue.getCurrentUnit(0)?.id).not.toBe('fort');
  });

  it('a sleeping unit keeps its movement but is not queued', () => {
    const e = engine as GameEngine;
    const napper = spawn(e, 'nap', 5, 6);
    spawn(e, 'ready2', 6, 6);

    e.unitSleep('nap');
    startOfTurn(e);

    // Movement is intact so a wake-up is actionable …
    expect(napper.movesRemaining).toBeGreaterThan(0);
    // … but the queue never calls it up.
    e.unitTurnQueue.initializeQueue(0);
    expect(e.unitTurnQueue.getQueue(0)).not.toContain('nap');
    expect(e.unitTurnQueue.getQueue(0)).toContain('ready2');
  });

  it('unfortifying hands the unit its movement back', () => {
    const e = engine as GameEngine;
    const garrison = spawn(e, 'fort2', 5, 7);
    e.unitFortify('fort2');
    startOfTurn(e);
    expect(garrison.movesRemaining).toBe(0);

    e.unfortifyUnit('fort2');

    expect(garrison.isFortified).toBe(false);
    expect(garrison.movesRemaining).toBeGreaterThan(0);
    expect(garrison.areTurnsDone).toBe(false);
  });

  it('waking a unit that lost its movement makes it actionable', () => {
    const e = engine as GameEngine;
    const unit = spawn(e, 'wake', 5, 8);
    e.unitSleep('wake');
    startOfTurn(e);
    unit.movesRemaining = 0; // e.g. it was skipped this turn

    e.unitWake('wake');

    expect(unit.isSleeping).toBe(false);
    expect(unit.movesRemaining).toBeGreaterThan(0);
  });
});
