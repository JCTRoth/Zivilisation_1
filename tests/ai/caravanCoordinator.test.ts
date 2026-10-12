/**
 * The CaravanCoordinator (per-civ planning) and the route rules it plans
 * against: three slots per city, oldest evicted by newest.
 */
import { describe, it, expect } from 'vitest';
import {
  planCaravansForCiv,
  type CaravanCoordinatorWorld,
} from '@/game/engine/AI/CaravanCoordinator';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';

type City = {
  id: string;
  name?: string;
  col: number;
  row: number;
  population?: number;
  civilizationId: number;
  tradeRoutes?: Array<{ cityId: string; trade?: number; round?: number }>;
};

const routes = (n: number, from = 0): Array<{ cityId: string; trade: number; round: number }> =>
  Array.from({ length: n }, (_, i) => ({ cityId: `r${from + i}`, trade: 2, round: 10 + i }));

const world = (cities: City[], caravans: Array<{ id: string; homeCityId: string | null }> = []): CaravanCoordinatorWorld => ({
  cities,
  units: caravans.map((c) => ({
    id: c.id, type: 'caravan', civilizationId: 0, homeCityId: c.homeCityId,
  })),
  isAtWar: () => false,
  hasContacted: () => true,
});

describe('planCaravansForCiv', () => {
  it('wants a producer per free route slot', () => {
    const plan = planCaravansForCiv(world([
      { id: 'a', col: 0, row: 0, population: 4, civilizationId: 0, tradeRoutes: [] },
      { id: 'b', col: 5, row: 0, population: 4, civilizationId: 0, tradeRoutes: routes(3) },
    ]), 0);
    // City b's three slots are full, so only city a is a producer.
    expect(plan.freeSlots).toBe(3);
    expect(plan.producers.map((p) => p.cityId)).toEqual(['a']);
  });

  it('does not ask a pop-1 city to divert shields to trade', () => {
    const plan = planCaravansForCiv(world([
      { id: 'a', col: 0, row: 0, population: 1, civilizationId: 0, tradeRoutes: [] },
    ]), 0);
    expect(plan.producers).toEqual([]);
  });

  it('assigns every in-flight caravan a destination with a free slot', () => {
    const w = world(
      [
        { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
        { id: 'b', col: 4, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
        { id: 'c', col: 8, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
        { id: 'x', col: 2, row: 4, population: 6, civilizationId: 1, tradeRoutes: [] },
        { id: 'y', col: 6, row: 4, population: 6, civilizationId: 1, tradeRoutes: [] },
      ],
      [{ id: 'k1', homeCityId: 'a' }, { id: 'k2', homeCityId: 'a' }],
    );
    const plan = planCaravansForCiv(w, 0);
    expect(plan.assignments).toHaveLength(2);
    // De-duplicated: two caravans get two DIFFERENT destinations.
    expect(plan.assignments[0].targetCityId).not.toBe(plan.assignments[1].targetCityId);
  });

  it('never sends two caravans to a city with only one free slot', () => {
    const w = world(
      [
        { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
        { id: 'x', col: 3, row: 0, population: 9, civilizationId: 1, tradeRoutes: routes(2) },
      ],
      [{ id: 'k1', homeCityId: 'a' }, { id: 'k2', homeCityId: 'a' }, { id: 'k3', homeCityId: 'a' }],
    );
    const plan = planCaravansForCiv(w, 0);
    const toX = plan.assignments.filter((a) => a.targetCityId === 'x');
    // City x has exactly one free slot (3 − 2 used).
    expect(toX.length).toBeLessThanOrEqual(1);
  });

  it('marks foreign destinations and prefers them (they pay double)', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 3, civilizationId: 0, tradeRoutes: [] },
      { id: 'own', col: 4, row: 0, population: 3, civilizationId: 0, tradeRoutes: [] },
      { id: 'foreign', col: 4, row: 4, population: 3, civilizationId: 1, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }]);
    const plan = planCaravansForCiv(w, 0);
    expect(plan.assignments[0].targetCityId).toBe('foreign');
    expect(plan.assignments[0].foreign).toBe(true);
    expect(plan.assignments[0].value).toBeGreaterThan(0);
  });

  it('refuses foreign cities we are at war with', () => {
    const w: CaravanCoordinatorWorld = {
      cities: [
        { id: 'a', col: 0, row: 0, population: 3, civilizationId: 0, tradeRoutes: [] },
        { id: 'foreign', col: 4, row: 0, population: 9, civilizationId: 1, tradeRoutes: [] },
        { id: 'own', col: 4, row: 4, population: 3, civilizationId: 0, tradeRoutes: [] },
      ],
      units: [{ id: 'k1', type: 'caravan', civilizationId: 0, homeCityId: 'a' }],
      isAtWar: (a, b) => a !== b,
      hasContacted: () => true,
    };
    const plan = planCaravansForCiv(w, 0);
    expect(plan.assignments[0].targetCityId).toBe('own');
  });

  it('disbands the surplus above the free slots', () => {
    const w = world(
      [
        { id: 'a', col: 0, row: 0, population: 4, civilizationId: 0, tradeRoutes: routes(3) },
        { id: 'x', col: 6, row: 0, population: 4, civilizationId: 1, tradeRoutes: [] },
      ],
      // No free slots at all (a is full, x is foreign so not counted for own
      // slots), yet three caravans are in flight.
      [{ id: 'k1', homeCityId: 'a' }, { id: 'k2', homeCityId: 'a' }, { id: 'k3', homeCityId: 'a' }],
    );
    const plan = planCaravansForCiv(w, 0);
    expect(plan.freeSlots).toBe(0);
    expect(plan.surplus).toHaveLength(3);
    expect(plan.assignments).toHaveLength(0);
  });

  it('honours targets already committed by other caravans', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'own', col: 3, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'own2', col: 6, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }, { id: 'k2', homeCityId: 'a' }]);
    const plan = planCaravansForCiv(w, 0, new Set(['own']));
    expect(plan.assignments.some((a) => a.targetCityId === 'own')).toBe(false);
  });

  it('never assigns a city its own route home', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'b', col: 4, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }]);
    const plan = planCaravansForCiv(w, 0);
    expect(plan.assignments[0].targetCityId).toBe('b');
  });
});

describe('the route-slot rule the coordinator plans against', () => {
  it('is three per city', () => {
    expect(MAX_TRADE_ROUTES).toBe(3);
  });
});
