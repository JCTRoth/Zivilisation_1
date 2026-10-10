import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeEngine, type TestWorld } from './helpers/world';
import type GameEngine from '@/game/engine/GameEngine';
import { createLocalSession, isCommandRejection, sendCommand, setActiveSession } from '@/utils/session';
import type { CommandContext } from '../types/commands';

/**
 * Command layer — authorisation rules.
 *
 * The layer decides WHO may act (turn + ownership); the engine still decides
 * WHAT is legal. Both halves are pinned here, and so is the seam itself: the
 * UI sends a command to a session, never touches the engine directly.
 */
describe('Command layer', () => {
  let engine: GameEngine;
  let world: TestWorld;
  let seq: number;

  const ctx = (overrides: Partial<CommandContext> = {}): CommandContext => ({
    actorId: 0,
    turn: engine.currentTurn,
    seq: ++seq,
    ...overrides,
  });

  /** A free land tile near the human's starting position, with a warrior on it. */
  const warriorNear = (id: string, extra: Record<string, unknown> = {}) => {
    const origin = world.units.find((u) => u.civilizationId === 0)!;
    const spot = world.landNear(origin.col, origin.row, 5);
    return world.spawnUnit({
      id,
      type: 'warrior',
      col: spot.col,
      row: spot.row,
      movesRemaining: 2,
      maxMoves: 2,
      ...extra,
    });
  };

  beforeEach(async () => {
    seq = 0;
    world = await makeEngine();
    engine = world.engine;
  });

  afterEach(() => {
    setActiveSession(null);
  });

  describe('MOVE_UNIT', () => {
    it('moves the acting seat\'s own unit', () => {
      const unit = warriorNear('cmd_move_ok');
      const target = world.landNear(unit.col, unit.row, 3);

      const result = engine.submit({ type: 'MOVE_UNIT', unitId: unit.id, col: target.col, row: target.row }, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok || result.command !== 'MOVE_UNIT') throw new Error('expected a move result');
      expect(result.move.success).toBe(true);
      expect({ col: unit.col, row: unit.row }).toEqual({ col: target.col, row: target.row });
    });

    it('refuses another civilization\'s unit', () => {
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const enemy = world.spawnUnit({
        id: 'cmd_move_foreign',
        type: 'warrior',
        civilizationId: 1,
        col: origin.col,
        row: origin.row,
      });

      const result = engine.submit({ type: 'MOVE_UNIT', unitId: enemy.id, col: enemy.col + 1, row: enemy.row }, ctx());

      expect(isCommandRejection(result)).toBe(true);
      if (!isCommandRejection(result)) throw new Error('expected a rejection');
      expect(result.reason).toBe('NOT_YOUR_UNIT');
    });

    it('refuses a unit that does not exist', () => {
      const result = engine.submit({ type: 'MOVE_UNIT', unitId: 'nope', col: 3, row: 3 }, ctx());
      expect(isCommandRejection(result) && result.reason).toBe('UNIT_NOT_FOUND');
    });

    it('refuses a command that claims a different turn', () => {
      const unit = warriorNear('cmd_move_turn');
      const result = engine.submit({ type: 'MOVE_UNIT', unitId: unit.id, col: unit.col + 1, row: unit.row }, ctx({ turn: 999 }));
      expect(isCommandRejection(result) && result.reason).toBe('NOT_YOUR_TURN');
    });

    it('refuses a seat that is not the active player', () => {
      const unit = warriorNear('cmd_move_seat');
      const result = engine.submit({ type: 'MOVE_UNIT', unitId: unit.id, col: unit.col + 1, row: unit.row }, ctx({ actorId: 1 }));
      expect(isCommandRejection(result) && result.reason).toBe('NOT_YOUR_TURN');
    });

    it('authorises the seat but still lets the engine rules reject the move', () => {
      // Defeated units linger for the death animation and must not be orderable.
      const dead = warriorNear('cmd_move_dead', { isDefeated: true });
      const result = engine.submit({ type: 'MOVE_UNIT', unitId: dead.id, col: dead.col + 1, row: dead.row }, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok || result.command !== 'MOVE_UNIT') throw new Error('expected a move result');
      expect(result.move.success).toBe(false);
      expect(result.move.reason).toBe('unit_defeated');
    });

    it('rejects a move the rules forbid without touching the seat gate', () => {
      const spent = warriorNear('cmd_move_spent', { movesRemaining: 0 });
      const result = engine.submit({ type: 'MOVE_UNIT', unitId: spent.id, col: spent.col + 1, row: spent.row }, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok || result.command !== 'MOVE_UNIT') throw new Error('expected a move result');
      expect(result.move.success).toBe(false);
      expect(typeof result.move.reason).toBe('string');
    });
  });

  describe('SET_RATES', () => {
    it('applies the rates of the acting seat only', () => {
      const result = engine.submit({ type: 'SET_RATES', tax: 30, science: 60, luxury: 10 }, ctx());
      expect(result.ok).toBe(true);
      expect(engine.civilizations[0].taxRate).toBe(30);
      expect(engine.civilizations[0].scienceRate).toBe(60);
      expect(engine.civilizations[0].luxuryRate).toBe(10);
    });

    it('refuses when the seat is not the active player', () => {
      const result = engine.submit({ type: 'SET_RATES', tax: 0, science: 100, luxury: 0 }, ctx({ actorId: 1 }));
      expect(isCommandRejection(result) && result.reason).toBe('NOT_YOUR_TURN');
    });
  });

  describe('SET_CITY_PRODUCTION', () => {
    it('queues an item in the acting seat\'s own city', () => {
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const spot = world.landNear(origin.col, origin.row, 5);
      const city = world.settle('Cinnamon', spot.col, spot.row, 0);
      const result = engine.submit(
        { type: 'SET_CITY_PRODUCTION', cityId: city.id, item: { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }, queue: true },
        ctx(),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.command !== 'SET_CITY_PRODUCTION') throw new Error('expected a production result');
      expect(result.production.success).toBe(true);
    });

    it('refuses a city owned by somebody else', () => {
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const enemyCity = world.settle('Enemyburg', origin.col, origin.row, 1);
      const result = engine.submit(
        { type: 'SET_CITY_PRODUCTION', cityId: enemyCity.id, item: { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }, queue: true },
        ctx(),
      );
      expect(isCommandRejection(result) && result.reason).toBe('NOT_YOUR_CITY');
    });
  });

  describe('FOUND_CITY', () => {
    it('founds a city with the acting seat\'s own settler', () => {
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const spot = world.landNear(origin.col, origin.row, 5);
      const settler = world.spawnUnit({ id: 'cmd_settler_ok', type: 'settler', col: spot.col, row: spot.row });

      const result = engine.submit({ type: 'FOUND_CITY', settlerId: settler.id }, ctx());

      expect(result.ok).toBe(true);
      if (!result.ok || result.command !== 'FOUND_CITY') throw new Error('expected a found-city result');
      expect(result.founded).toBe(true);
    });

    it('refuses another civilization\'s settler', () => {
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const spot = world.landNear(origin.col, origin.row, 5);
      const settler = world.spawnUnit({ id: 'cmd_settler_foreign', type: 'settler', civilizationId: 1, col: spot.col, row: spot.row });

      const result = engine.submit({ type: 'FOUND_CITY', settlerId: settler.id }, ctx());

      expect(isCommandRejection(result) && result.reason).toBe('NOT_YOUR_UNIT');
    });
  });

  describe('session', () => {
    it('builds the acting context from the human seat and applies the command', async () => {
      const unit = warriorNear('sess_move');
      const target = world.landNear(unit.col, unit.row, 3);
      setActiveSession(createLocalSession(engine));

      const result = await sendCommand({ type: 'MOVE_UNIT', unitId: unit.id, col: target.col, row: target.row });

      expect(result.ok).toBe(true);
      expect({ col: unit.col, row: unit.row }).toEqual({ col: target.col, row: target.row });
    });

    it('reports a dropped command instead of throwing when no session is bound', async () => {
      setActiveSession(null);
      const result = await sendCommand({ type: 'MOVE_UNIT', unitId: 'x', col: 1, row: 1 });
      expect(isCommandRejection(result)).toBe(true);
    });
  });
});
