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
import { AIManager } from '@/game/engine/AI/AIManager';

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

describe('the plan is made before production asks for it', () => {
  /**
   * The city-production phase that follows an AI turn asks the coordinator
   * which cities want caravans. That question used to be answered by the
   * producer's own guesswork, because the plan was only built lazily under the
   * first caravan unit the turn found — and a civ that has never built a caravan
   * has none to find. So the plan is now made at the top of the turn.
   *
   * The observable consequence: a civ with ZERO caravans in the field already
   * has producers, which is what lets the first one get built.
   */
  const engineFor = () => {
    const civ1 = {
      id: 1, name: 'Planner', isAI: true, isHuman: false,
      technologies: new Set(['trade']), resources: { gold: 20 },
      taxRate: 50, scienceRate: 30, luxuryRate: 20,
      productionProfile: 'balanced_growth',
      personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5 },
    };
    const cities = [
      { id: 'a', name: 'A', civilizationId: 1, col: 0, row: 0, population: 4, buildings: [], tradeRoutes: [] },
      { id: 'b', name: 'B', civilizationId: 1, col: 5, row: 0, population: 4, buildings: [], tradeRoutes: [] },
    ];
    return {
      civilizations: [null, civ1], cities, units: [],
      activePlayer: 1, isPaused: false,
      map: { width: 30, height: 30 },
      squareGrid: { squareDistance: () => 1, getNeighbors: () => [], isValidSquare: () => true, findPath: () => [] },
      getTileAt: () => null, getUnitAt: () => null, getCityAt: () => null,
      getPlayerStorage: () => ({ turnData: {} }),
      roundManager: { getRoundNumber: () => 3 },
      diplomacyManager: { isAtWar: () => false, hasContacted: () => true },
      // The coordinator's world shape reads these off the ENGINE itself.
      isAtWar: () => false,
      hasContacted: () => true,
      log: () => {},
      currentYear: -4000, gameSettings: { difficulty: 'PRINCE' },
    } as unknown as ConstructorParameters<typeof AIManager>[never] as never;
  };

  it('names producer cities for a civ that owns no caravan at all', async () => {
    const engine = engineFor();
    const ai = new AIManager(engine);
    // City b's slots are the free ones; a has none left.
    (engine as unknown as { cities: Array<Record<string, unknown>> }).cities[1].tradeRoutes =
      Array.from({ length: MAX_TRADE_ROUTES }, (_, n) => ({ cityId: `r${n}`, trade: 4, round: 1 }));

    await (ai as unknown as { processAITurn: (id: number) => Promise<void> }).processAITurn(1);

    const wanting = ai.citiesWantingCaravans(1);
    expect(wanting).toContain('a');
    expect(wanting).not.toContain('b');
  });

  it('re-plans only on a new round, so the plan cannot flip mid-turn', async () => {
    const engine = engineFor();
    const ai = new AIManager(engine);
    const plan = ai as unknown as {
      coordinateCaravans: (id: number, r: number) => void;
      caravanProducerCities: Map<number, string[]>;
    };

    await (ai as unknown as { processAITurn: (id: number) => Promise<void> }).processAITurn(1);
    const before = plan.caravanProducerCities.get(1);
    expect(before).toEqual(['a', 'b']); // both have room

    // The world changes but the round does not: the coordinator must still serve
    // the plan it made, or a city could be told to build a caravan and then be
    // told not to within the same turn.
    (engine as unknown as { cities: Array<Record<string, unknown>> }).cities[0].population = 1;
    (engine as unknown as { cities: Array<Record<string, unknown>> }).cities[1].tradeRoutes =
      Array.from({ length: MAX_TRADE_ROUTES }, (_, n) => ({ cityId: `r${n}`, trade: 9, round: 1 }));
    plan.coordinateCaravans(1, 3);

    expect(plan.caravanProducerCities.get(1)).toEqual(before);
  });
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
describe('reach — a caravan must be able to WALK there', () => {
  // Water between two cities used to be invisible to the planner: it handed the
  // target over, the governor could never route to it, the caravan spent its
  // patience blacklisting it, and was then disbanded. On a map of islands that
  // was every caravan the civ ever built.
  it('skips a city that is not land-connected to the caravan\'s home', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'b', col: 4, row: 4, population: 9, civilizationId: 1, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }]);
    (w as { areLandConnected: (c1: number, r1: number, c2: number, r2: number) => boolean })
      .areLandConnected = (_c1, r1, _c2, r2) => r1 === r2;

    const plan = planCaravansForCiv(w, 0);
    // The big foreign city across the water is worth the most and is refused;
    // with nothing reachable the caravan gets no mission instead of a doomed one.
    expect(plan.assignments).toEqual([]);
  });

  it('takes the reachable route when one exists', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'near', col: 3, row: 0, population: 4, civilizationId: 1, tradeRoutes: [] },
      { id: 'far', col: 9, row: 9, population: 12, civilizationId: 1, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }]);
    (w as { areLandConnected: (c1: number, r1: number, c2: number, r2: number) => boolean })
      .areLandConnected = (_c1, r1, _c2, r2) => r1 === r2;

    const plan = planCaravansForCiv(w, 0);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].targetCityId).toBe('near');
  });

  // The island civ: one city, three free route slots, and NO partner on the
  // same shore. It used to build three caravans that walked nowhere, idled
  // out their patience and were disbanded — production churn on a trade route
  // that could never exist. One scout caravan is all it may have.
  it('an island civ keeps ONE caravan, not one per free slot', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'far', col: 9, row: 9, population: 12, civilizationId: 1, tradeRoutes: [] },
    ], [{ id: 'k1', homeCityId: 'a' }, { id: 'k2', homeCityId: 'a' }, { id: 'k3', homeCityId: 'a' }]);
    (w as { areLandConnected: (c1: number, r1: number, c2: number, r2: number) => boolean })
      .areLandConnected = (_c1, r1, _c2, r2) => r1 === r2;

    const plan = planCaravansForCiv(w, 0);
    // Three caravans in flight, but the civ may only keep one: the surplus is
    // disbanded instead of wandering.
    expect(plan.surplus).toHaveLength(2);
    // And exactly one city builds the next one.
    expect(plan.producers.map((p) => p.cityId)).toEqual(['a']);
  });

  it('an island civ nominates ONE producer, not every city with a free slot', () => {
    const w = world([
      { id: 'a', col: 0, row: 0, population: 5, civilizationId: 0, tradeRoutes: [] },
      { id: 'b', col: 0, row: 2, population: 4, civilizationId: 0, tradeRoutes: [] },
      { id: 'far', col: 9, row: 9, population: 12, civilizationId: 1, tradeRoutes: [] },
    ]);
    (w as { areLandConnected: (c1: number, r1: number, c2: number, r2: number) => boolean })
      .areLandConnected = (_c1, r1, _c2, r2) => r1 === r2;

    const plan = planCaravansForCiv(w, 0);
    expect(plan.producers).toHaveLength(1);
  });
});
