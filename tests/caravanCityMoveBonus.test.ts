/**
 * A Caravan standing near a city gets a second move for the turn — and only
 * then.
 *
 * The camel plods at movement 1 across empty ground (`UNIT_PROPS.caravan.
 * movement` stays 1, so every table reader — production cost, pathfinding
 * weights, the governor's travel estimates — keeps seeing the honest base). The
 * bonus is CONTEXTUAL: `TurnManager.resetUnitsForPlayer` grants the extra move
 * while the caravan stands within `CARAVAN_CITY_MOVE_RADIUS` of any city, and it
 * writes `maxMoves` so the movement preview, GoTo, pathfinding and the AI's step
 * budget all agree with what the unit can actually do.
 *
 * What it buys: the last leg. A caravan two tiles out walks in and onto the
 * market tile in ONE turn instead of two, so a 10-tile route is 10 turns, not 11.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import {
  CARAVAN_CITY_MOVE_BONUS,
  CARAVAN_CITY_MOVE_RADIUS,
} from '@/data/GameConstants';
import { makeGridEngine, useSeededRandom } from './helpers/world';
import type { City, Unit } from '../types/game';

const G = 'grassland';

/** A 9x9 grass world with one human civ (owner of the caravan) and a rival. */
function makeWorld(): GameEngine {
  const row = Array.from({ length: 9 }, () => G);
  return makeGridEngine(Array.from({ length: 9 }, () => [...row]));
}

/** The turn reset, called exactly the way TurnManager calls it. */
function startOfTurn(engine: GameEngine, civId = 0): void {
  (
    engine.turnManager as unknown as { resetUnitsForPlayer: (id: number) => void }
  ).resetUnitsForPlayer(civId);
}

const movesOf = (u: Unit) => ({
  movesRemaining: u.movesRemaining,
  maxMoves: (u as unknown as { maxMoves?: number }).maxMoves,
});

describe('caravan move bonus near a city', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('grants two moves standing beside a city (distance 1)', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const camel = {
      id: 'cam', type: 'caravan', civilizationId: 0, col: 5, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(camel);

    startOfTurn(e);
    expect(movesOf(camel)).toEqual({
      movesRemaining: CARAVAN_CITY_MOVE_BONUS,
      maxMoves: CARAVAN_CITY_MOVE_BONUS,
    });
  });

  it('grants two moves ON the city tile (distance 0)', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const camel = {
      id: 'cam', type: 'caravan', civilizationId: 0, col: 4, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(camel);

    startOfTurn(e);
    expect(camel.movesRemaining).toBe(CARAVAN_CITY_MOVE_BONUS);
  });

  it('grants two moves at the radius boundary but not one tile past it', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    // Exactly on the radius: Chebyshev distance 2 in both axes.
    const near = {
      id: 'near', type: 'caravan', civilizationId: 0, col: 6, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    // One tile past it.
    const far = {
      id: 'far', type: 'caravan', civilizationId: 0, col: 7, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(near, far);

    startOfTurn(e);
    expect(near.movesRemaining).toBe(CARAVAN_CITY_MOVE_BONUS);
    expect(far.movesRemaining).toBe(1); // the honest base
    expect(far.maxMoves).toBe(1);
  });

  it('restores ONE move the moment the city is out of range', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const camel = {
      id: 'cam', type: 'caravan', civilizationId: 0, col: 5, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(camel);
    startOfTurn(e);
    expect(camel.movesRemaining).toBe(2);

    // Walk away and re-reset: the bonus is position-derived, so it must go.
    camel.col = 8; camel.row = 0;
    camel.movesRemaining = 0;
    startOfTurn(e);
    expect(movesOf(camel)).toEqual({ movesRemaining: 1, maxMoves: 1 });
  });

  it('works on the diagonal (Chebyshev distance)', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const camel = {
      id: 'cam', type: 'caravan', civilizationId: 0, col: 6, row: 6,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(camel);

    startOfTurn(e);
    expect(camel.movesRemaining).toBe(CARAVAN_CITY_MOVE_BONUS);
  });

  it('counts ANY city, including a rival\'s', () => {
    // A market is a market: the camel is fast near somebody's walls whether
    // they are ours or not.
    const e = makeWorld();
    useSeededRandom(1);
    const foreign = {
      id: 'foe', name: 'Carthage', civilizationId: 1, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(foreign);
    const camel = {
      id: 'cam', type: 'caravan', civilizationId: 0, col: 5, row: 4,
      movesRemaining: 0, maxMoves: 1,
    } as unknown as Unit;
    (e as unknown as { units: Unit[] }).units.push(camel);

    startOfTurn(e);
    expect(camel.movesRemaining).toBe(CARAVAN_CITY_MOVE_BONUS);
  });

  it('leaves other unit types alone', () => {
    // The rule is a caravan rule: a settler and a warrior beside the same city
    // keep their own movement (each read from the raw table).
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const units = (e as unknown as { units: Unit[] }).units;
    units.push(
      { id: 's', type: 'settler', civilizationId: 0, col: 5, row: 4, movesRemaining: 0, maxMoves: 1 } as unknown as Unit,
      { id: 'w', type: 'warrior', civilizationId: 0, col: 5, row: 5, movesRemaining: 0, maxMoves: 1 } as unknown as Unit,
    );

    startOfTurn(e);
    expect(units[0].movesRemaining).toBe(1); // settler: 1, as in the table
    expect(units[1].movesRemaining).toBe(1); // warrior: 1, as in the table
  });

  it('does not resurrect a fortified or defeated caravan', () => {
    const e = makeWorld();
    useSeededRandom(1);
    const city = {
      id: 'c1', name: 'Rome', civilizationId: 0, col: 4, row: 4,
      population: 5, buildings: [], tradeRoutes: [],
    } as unknown as City;
    (e as unknown as { cities: City[] }).cities.push(city);
    const units = (e as unknown as { units: Unit[] }).units;
    units.push(
      { id: 'f', type: 'caravan', civilizationId: 0, col: 5, row: 4, movesRemaining: 0, maxMoves: 1, isFortified: true } as unknown as Unit,
      { id: 'd', type: 'caravan', civilizationId: 0, col: 5, row: 4, movesRemaining: 0, maxMoves: 1, isDefeated: true } as unknown as Unit,
      // A SLEEPING caravan is not called up, but waking it must leave it ready
      // to act — so it keeps the movement it would have had, bonus included.
      { id: 'z', type: 'caravan', civilizationId: 0, col: 5, row: 4, movesRemaining: 0, maxMoves: 1, isSleeping: true } as unknown as Unit,
    );

    startOfTurn(e);
    expect(units[0].movesRemaining).toBe(0); // fortified: out of the turn
    expect(units[1].movesRemaining).toBe(0); // dead: must not come back
    expect(units[2].movesRemaining).toBe(CARAVAN_CITY_MOVE_BONUS); // sleeping keeps it
  });

  it('the raw table still says 1 — the bonus is contextual, not a stat', () => {
    // Everything that reads the table keeps seeing the honest camel; only the
    // unit in play is faster.
    const props = (GameEngine as unknown as { UNIT_PROPS: Record<string, { movement?: number }> }).UNIT_PROPS;
    expect(props.caravan.movement).toBe(1);
    expect(CARAVAN_CITY_MOVE_RADIUS).toBeGreaterThan(0);
  });
});
