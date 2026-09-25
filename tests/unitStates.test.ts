/**
 * Unit states: what each one means for the turn, the queue and the actions.
 *
 * Every state below is a promise to the player about when a unit acts again:
 *
 *   fortified  sits out the turn AND the next one until unfortified/woken;
 *              no movement, not queued, and moving breaks it (Civ1)
 *   sleeping   keeps its movement so a wake-up is actionable, but is never
 *              called up — it only acts when something wakes it or the player
 *              orders it somewhere
 *   skipped    out for THIS turn only; fresh next turn
 *   waiting    deliberately left in the unit cycle, moved to the back
 *   embarked   a passenger aboard a ferry: travels with the ship, cannot act
 *   defeated   dead; only lingers for the death animation
 *
 * The suite is intentionally explicit about the turn-reset, the unit queue and
 * the "can I act" API, because those three disagreed before: a fortified unit
 * used to be handed fresh movement and called up, and a moved sleeping unit
 * stayed flagged asleep and got skipped again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { UnitActionManager } from '@/game/engine/UnitActionManager';
import { RESEARCH_UNLOCK_ROUND, AUTO_END_TURN_OFFER_TURN, AUTO_END_TURN_OFFER_FLAG } from '@/data/GameConstants';

type AnyUnit = Record<string, unknown>;

describe('Unit states', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      // Pinned: this suite searches the generated map for a passable tile, so a
      // random world made it fail whenever a start position happened to be
      // boxed in by ocean (it threw "no passable neighbour" on ~1 run in 8).
      mapSeed: 20260925,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  const spawn = (id: string, col: number, row: number, civ = 0, type = 'warrior'): AnyUnit => {
    const unit: AnyUnit = {
      id, civilizationId: civ, type, col, row,
      movesRemaining: 1, maxMoves: 1, health: 100, attack: 2, defense: 1,
      icon: type, orders: 'none', areTurnsDone: false, isSkipped: false,
      isDefeated: false, isFortified: false, isSleeping: false,
    };
    (engine.units as unknown as AnyUnit[]).push(unit);
    return unit;
  };

  const unit = (id: string) => engine.units.find((u) => u.id === id) as unknown as AnyUnit;
  const startTurn = () =>
    (engine.roundManager as unknown as { resetUnitsForPlayer: (id: number) => void })
      .resetUnitsForPlayer(0);

  /**
   * A passable land neighbour of (col,row). The map is generated per run, so a
   * hardcoded target can land on ocean and make a movement assertion flaky.
   */
  const landNeighbour = (col: number, row: number): { col: number; row: number } => {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
      const c = col + dc;
      const r = row + dr;
      if (engine.isTilePassable(c, r) && !engine.getUnitAt(c, r)) return { col: c, row: r };
    }
    throw new Error(`no passable neighbour for (${col},${row})`);
  };

  // ── Fortified ────────────────────────────────────────────────────────────

  describe('fortified', () => {
    it('spends its movement and is done for the turn', () => {
      const garrison = spawn('fort', 5, 5);
      engine.unitFortify('fort');

      expect(unit('fort').isFortified).toBe(true);
      expect(garrison.movesRemaining).toBe(0);
      expect(garrison.areTurnsDone).toBe(true);
    });

    it('cannot be moved while fortified', () => {
      spawn('fort', 5, 5);
      engine.unitFortify('fort');

      const to = landNeighbour(5, 5);
      expect(engine.canUnitMoveTo('fort', to.col, to.row)).toBe(false);
      const result = engine.moveUnit('fort', to.col, to.row);
      expect(result.success).toBe(false);
      expect(unit('fort').col).toBe(5); // it did not budge
    });

    it('stays out of the next turn: no fresh movement, never queued', () => {
      const garrison = spawn('fort', 5, 5);
      spawn('ready', 6, 5);
      engine.unitFortify('fort');

      startTurn();
      expect(garrison.movesRemaining).toBe(0);
      expect(garrison.areTurnsDone).toBe(true);

      engine.unitTurnQueue.initializeQueue(0);
      const queued = engine.unitTurnQueue.getQueue(0);
      expect(queued).toContain('ready');
      expect(queued).not.toContain('fort');
    });

    it('unfortifying hands the movement back and clears the flag', () => {
      spawn('fort', 5, 5);
      engine.unitFortify('fort');
      startTurn();
      expect(unit('fort').movesRemaining).toBe(0);

      engine.unfortifyUnit('fort');

      const woken = unit('fort');
      expect(woken.isFortified).toBe(false);
      expect(woken.movesRemaining).toBeGreaterThan(0);
      expect(woken.areTurnsDone).toBe(false);
      const to = landNeighbour(5, 5);
      expect(engine.canUnitMoveTo('fort', to.col, to.row)).toBe(true);
    });

    it('moving breaks the fortification (Civ1)', () => {
      // A fortified unit cannot move at all, so the flag must also be cleared
      // by the paths that do act on a unit (an unfortify-then-move chain, and
      // the attack below) — otherwise the +50% defense sticks to a marching
      // unit.
      spawn('fort', 5, 6);
      engine.unitFortify('fort');
      startTurn();
      engine.unfortifyUnit('fort');
      const to = landNeighbour(5, 6);
      const result = engine.moveUnit('fort', to.col, to.row);

      expect(result.success).toBe(true);
      expect(unit('fort').isFortified).toBe(false);
    });

    it('attacking clears the fortification', () => {
      spawn('fort', 5, 7);
      spawn('enemy', 6, 7, 1);
      engine.unitFortify('fort');
      startTurn();
      engine.unfortifyUnit('fort');
      engine.combatUnit(engine.units.find((u) => u.id === 'fort') as never, engine.units.find((u) => u.id === 'enemy') as never);

      expect(unit('fort').isFortified).toBe(false);
    });
  });

  // ── Sleeping ─────────────────────────────────────────────────────────────

  describe('sleeping', () => {
    it('keeps its movement but is marked done for the turn', () => {
      const napper = spawn('nap', 5, 8);
      engine.unitSleep('nap');

      expect(unit('nap').isSleeping).toBe(true);
      // Movement survives, so a wake-up is actionable …
      expect(napper.movesRemaining).toBeGreaterThan(0);
      // … but the unit is not this turn's actor.
      expect(napper.areTurnsDone).toBe(true);
    });

    it('is never called up by the unit queue', () => {
      spawn('nap', 5, 9);
      spawn('ready', 6, 9);
      engine.unitSleep('nap');

      engine.unitTurnQueue.initializeQueue(0);
      const queued = engine.unitTurnQueue.getQueue(0);
      expect(queued).not.toContain('nap');
      expect(queued).toContain('ready');
    });

    it('stays out of the next turn as well, with its movement intact', () => {
      const napper = spawn('nap', 5, 10);
      engine.unitSleep('nap');
      startTurn();

      expect(napper.movesRemaining).toBeGreaterThan(0);
      expect(napper.areTurnsDone).toBe(true);
      engine.unitTurnQueue.initializeQueue(0);
      expect(engine.unitTurnQueue.getQueue(0)).not.toContain('nap');
    });

    it('waking makes it act again', () => {
      const napper = spawn('nap', 5, 11);
      engine.unitSleep('nap');
      startTurn();

      engine.unitWake('nap');

      expect(napper.isSleeping).toBe(false);
      const to = landNeighbour(5, 11);
      expect(engine.canUnitMoveTo('nap', to.col, to.row)).toBe(true);
      engine.unitTurnQueue.initializeQueue(0);
      expect(engine.unitTurnQueue.getQueue(0)).toContain('nap');
    });

    it('being ordered somewhere wakes it — it must not be skipped again', () => {
      // Regression: moving never cleared isSleeping, so a manually moved unit
      // kept the flag and `areTurnsDone` stayed true — the unit moved and was
      // then skipped again at the start of the next turn.
      const napper = spawn('nap', 5, 12);
      engine.unitSleep('nap');
      startTurn();

      const to = landNeighbour(5, 12);
      const result = engine.moveUnit('nap', to.col, to.row);
      expect(result.success).toBe(true);
      expect(napper.isSleeping).toBe(false);
      // The move spent its single movement, so the turn is over for it …
      expect(napper.movesRemaining).toBe(0);
      expect(napper.areTurnsDone).toBe(true);
      // … but next turn it is a normal, acting unit again.
      startTurn();
      expect(napper.isSleeping).toBe(false);
      expect(napper.movesRemaining).toBeGreaterThan(0);
      expect(napper.areTurnsDone).toBe(false);
      engine.unitTurnQueue.initializeQueue(0);
      expect(engine.unitTurnQueue.getQueue(0)).toContain('nap');
    });

    it('attacking wakes it', () => {
      const napper = spawn('nap', 5, 13);
      spawn('enemy', 6, 13, 1);
      engine.unitSleep('nap');
      startTurn();

      engine.combatUnit(engine.units.find((u) => u.id === 'nap') as never, engine.units.find((u) => u.id === 'enemy') as never);
      expect(napper.isSleeping).toBe(false);
    });
  });

  // ── Skipped ──────────────────────────────────────────────────────────────

  describe('skipped for the turn', () => {
    it('spends its movement and returns to normal next turn', () => {
      const unit0 = spawn('skipper', 6, 14);
      UnitActionManager.skipUnit(engine.units.find((u) => u.id === 'skipper') as never);

      expect(unit0.movesRemaining).toBe(0);
      expect(unit0.isSkipped).toBe(true);
      expect(engine.canUnitMoveTo('skipper', 7, 14)).toBe(false);

      startTurn();
      expect(unit0.movesRemaining).toBeGreaterThan(0);
      expect(unit0.isSkipped).toBe(false);
      expect(unit0.areTurnsDone).toBe(false);
    });

    it('is not queued while skipped', () => {
      spawn('skipper', 6, 15);
      UnitActionManager.skipUnit(engine.units.find((u) => u.id === 'skipper') as never);
      spawn('ready', 7, 15);

      engine.unitTurnQueue.initializeQueue(0);
      const queued = engine.unitTurnQueue.getQueue(0);
      expect(queued).not.toContain('skipper');
      expect(queued).toContain('ready');
    });
  });

  // ── Waiting ──────────────────────────────────────────────────────────────

  describe('waiting (still in this turn)', () => {
    it('moves to the back of the queue instead of leaving it', () => {
      spawn('a', 6, 16);
      spawn('b', 7, 16);
      spawn('c', 8, 16);
      engine.unitTurnQueue.initializeQueue(0);

      const before = engine.unitTurnQueue.getQueue(0);
      const current = engine.unitTurnQueue.getCurrentUnitId(0);
      expect(current).not.toBeNull();
      expect(before.filter((id) => ['a', 'b', 'c'].includes(id))).toHaveLength(3);

      engine.unitTurnQueue.waitUnit(0);

      // Waiting keeps the unit in this turn but sends it to the back.
      const after = engine.unitTurnQueue.getQueue(0);
      expect(after).toHaveLength(before.length);
      expect(after[after.length - 1]).toBe(current);
      expect(after).toContain(current);
    });
  });

  // ── Embarked passenger ───────────────────────────────────────────────────

  describe('embarked on a ferry', () => {
    it('cannot act and gets no fresh movement', () => {
      const passenger = spawn('cargo', 6, 17);
      (passenger as { embarkedOn?: string }).embarkedOn = 'ferry-1';

      expect(engine.canUnitMoveTo('cargo', 7, 17)).toBe(false);

      startTurn();
      expect(passenger.movesRemaining).toBe(0);
      expect(passenger.areTurnsDone).toBe(true);
      engine.unitTurnQueue.initializeQueue(0);
      expect(engine.unitTurnQueue.getQueue(0)).not.toContain('cargo');
    });
  });

  // ── Defeated ─────────────────────────────────────────────────────────────

  describe('defeated', () => {
    it('is out of the game: no movement, not queued, no fresh turn', () => {
      const corpse = spawn('corpse', 6, 18);
      (corpse as { isDefeated?: boolean }).isDefeated = true;
      (corpse as { isDefeated?: boolean }).isDefeated = true;

      expect(engine.canUnitMoveTo('corpse', 7, 18)).toBe(false);
      startTurn();
      expect(corpse.movesRemaining).toBe(0);
      expect(corpse.areTurnsDone).toBe(true);
      engine.unitTurnQueue.initializeQueue(0);
      expect(engine.unitTurnQueue.getQueue(0)).not.toContain('corpse');
    });
  });

  // ── The turn-done rule in one place ─────────────────────────────────────

  describe('the turn-done rule', () => {
    it('treats no movement, fortified, sleeping and skipped as "done"', () => {
      const cases: Array<{ id: string; patch: AnyUnit; done: boolean }> = [
        { id: 'fresh', patch: {}, done: false },
        { id: 'spent', patch: { movesRemaining: 0 }, done: true },
        { id: 'fortified', patch: { isFortified: true, movesRemaining: 0 }, done: true },
        { id: 'asleep', patch: { isSleeping: true }, done: true },
        { id: 'skipped', patch: { movesRemaining: 0, isSkipped: true }, done: true },
      ];
      for (const { id, patch, done } of cases) {
        const u = spawn(id, 7, 19);
        Object.assign(u, patch);
        (engine as unknown as { updateUnitTurnsDoneFlag: (unit: unknown) => void })
          .updateUnitTurnsDoneFlag(u);
        expect(u.areTurnsDone, id).toBe(done);
      }
    });
  });
});

/**
 * The opening-rounds rules that decide when the player is first asked to do
 * something optional. They are constants, so they get a guard rail: a change to
 * either number is a design decision and should be a deliberate edit.
 */
describe('Opening-round constants', () => {
  it('research unlocks after the first five rounds', () => {
    expect(RESEARCH_UNLOCK_ROUND).toBe(5);
  });

  it('the auto-end-turn offer comes after 15 moves and is only asked once', () => {
    expect(AUTO_END_TURN_OFFER_TURN).toBe(15);
    expect(AUTO_END_TURN_OFFER_FLAG).toBe('civ1_auto_end_turn_offered');
  });
});
