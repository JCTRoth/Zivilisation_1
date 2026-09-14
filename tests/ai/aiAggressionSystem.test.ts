import { describe, expect, it } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';
import {
  computeAggression,
  shouldTriggerAggression,
  planBulkAttack,
  estimateCityDefense,
  AGGRESSION_TRIGGER_THRESHOLD,
  AGGRESSION_TRIGGER_BAND,
  UNKNOWN_CITY_DEFENSE,
} from '@/game/engine/AI/AIAggression';
import type { EnemyLocation } from '@/game/engine/EnemySearcher';

// ---------------------------------------------------------------------------
// Shared mock engine (mirrors tests/ai/AIManagerStrategic.test.ts)
// ---------------------------------------------------------------------------

const createMockEngine = () => {
  const storage = {
    enemyLocations: new Map<number, EnemyLocation[]>(),
    visibility: [],
    explored: [],
    turnData: {},
  } as any;

  const squareGrid = {
    squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
      Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    getNeighbors: () => [],
    isValidSquare: () => true,
    findPath: () => [] as { col: number; row: number }[],
  };

  const engine: any = {
    civilizations: [{ id: 1, personality: { aggression: 8, diplomacy: 3, military: 9 } }],
    cities: [],
    units: [],
    map: { width: 20, height: 20 },
    squareGrid,
    gameSettings: { difficulty: 'PRINCE' },
    currentYear: -4000,
    getTileAt: () => ({ type: 'grassland', movement: 1, passable: true }),
    getUnitAt: () => null,
    getCityAt: (col: number, row: number) =>
      engine.cities.find((c: any) => c.col === col && c.row === row) ?? null,
    getPlayerStorage: () => storage,
    isVisibleToPlayer: () => true,
    isExploredByPlayer: () => true,
    assignScoutZones: () => {},
    isInScoutZone: () => true,
    recordEnemyLocation: () => {},
    autoProduction: { processAutoProductionForCivilization: () => {} },
    sleep: () => Promise.resolve(),
    onStateChange: () => {},
    log: () => {},
    measurePerformance: (_: string, fn: () => any) => fn(),
    roundManager: {
      getRoundNumber: () => 10,
      setUnitPath: () => {},
    },
  };

  return { engine, storage };
};

const enemyCityAt = (col: number, row: number, lastSeen = 9): EnemyLocation => ({
  col,
  row,
  type: 'city',
  id: `enemy-city-${col}-${row}`,
  discoveredRound: 1,
  lastSeenRound: lastSeen,
});

const archer = (id: string, civId: number, col: number, row: number) => ({
  id,
  type: 'archer',
  civilizationId: civId,
  col,
  row,
  attack: 3,
  defense: 2,
  movesRemaining: 1,
});

// ---------------------------------------------------------------------------
// Situational aggression score
// ---------------------------------------------------------------------------

describe('AIAggression.computeAggression', () => {
  it('is aggressive when cities are secured and the army has the advantage', () => {
    const result = computeAggression({
      personalityAggression: 8,
      ownArmyStrength: 20,
      enemyArmyStrength: 8,
      criticalThreats: 0,
      threatenedCities: 0,
      knownEnemyCities: 1,
      numOwnCities: 3,
      numEnemyCities: 2,
      isAtWar: false,
      currentYear: -3000,
    });

    expect(result.score).toBeGreaterThanOrEqual(AGGRESSION_TRIGGER_THRESHOLD + AGGRESSION_TRIGGER_BAND);
    expect(result.aggressive).toBe(true);
    expect(result.reasons).toContain('cities secured');
    expect(result.reasons).toContain('early rush window');
  });

  it('is NOT aggressive when a city is critically threatened', () => {
    const result = computeAggression({
      personalityAggression: 8,
      ownArmyStrength: 20,
      enemyArmyStrength: 8,
      criticalThreats: 2,
      threatenedCities: 2,
      knownEnemyCities: 1,
      numOwnCities: 3,
      numEnemyCities: 2,
      isAtWar: false,
      currentYear: -3000,
    });

    expect(result.score).toBeLessThan(AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND);
    expect(result.aggressive).toBe(false);
    expect(result.reasons.some((r) => r.includes('critical threat'))).toBe(true);
  });

  it('is NOT aggressive when severely outmatched', () => {
    const result = computeAggression({
      personalityAggression: 8,
      ownArmyStrength: 5,
      enemyArmyStrength: 20,
      criticalThreats: 0,
      threatenedCities: 0,
      knownEnemyCities: 1,
      numOwnCities: 3,
      numEnemyCities: 2,
      isAtWar: false,
      currentYear: -3000,
    });

    expect(result.score).toBeLessThan(AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND);
    expect(result.aggressive).toBe(false);
  });
});

describe('AIAggression.shouldTriggerAggression (random near threshold)', () => {
  it('always triggers far above the threshold and never far below', () => {
    expect(shouldTriggerAggression(100, () => 0)).toBe(true);
    expect(shouldTriggerAggression(100, () => 0.999)).toBe(true);
    expect(shouldTriggerAggression(0, () => 0)).toBe(false);
    expect(shouldTriggerAggression(0, () => 0.999)).toBe(false);
  });

  it('is a weighted coin-flip inside the band (close to triggering)', () => {
    // Exactly at the threshold → 50% chance.
    const mid = AGGRESSION_TRIGGER_THRESHOLD;
    expect(shouldTriggerAggression(mid, () => 0.2)).toBe(true);
    expect(shouldTriggerAggression(mid, () => 0.8)).toBe(false);

    // Just below the band edge → ~0% chance.
    const nearLow = AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND + 1;
    expect(shouldTriggerAggression(nearLow, () => 0.999)).toBe(false);

    // Just above the band edge → ~100% chance.
    const nearHigh = AGGRESSION_TRIGGER_THRESHOLD + AGGRESSION_TRIGGER_BAND - 1;
    expect(shouldTriggerAggression(nearHigh, () => 0.001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Target strength estimation & bulk planning
// ---------------------------------------------------------------------------

describe('AIAggression.estimateCityDefense', () => {
  it('counts population, walls and nearby garrison', () => {
    const { engine } = createMockEngine();
    const city = {
      id: 'ec', civilizationId: 2, col: 4, row: 4, population: 4, buildings: ['city_walls'],
      name: 'Enemy', production: 0, food: 0, gold: 0, science: 0,
    };
    engine.cities = [city];
    engine.units = [
      { id: 'g1', type: 'warrior', civilizationId: 2, col: 4, row: 4, attack: 1, defense: 3 },
      { id: 'g2', type: 'archer', civilizationId: 2, col: 5, row: 4, attack: 3, defense: 2 },
    ];

    // population 4 * walls 3 = 12, plus garrison (1 + 1.5) + (3 + 1) = 6.5
    expect(estimateCityDefense(engine, city)).toBeCloseTo(18.5, 5);
  });
});

describe('AIAggression.planBulkAttack', () => {
  it('does not trigger a bulk attack when the target is too strong', () => {
    const { engine } = createMockEngine();
    const strongCity = {
      id: 'strong', civilizationId: 2, col: 6, row: 6, population: 10, buildings: ['city_walls'],
    };
    engine.cities = [strongCity];
    engine.units = [
      { id: 'g1', type: 'warrior', civilizationId: 2, col: 6, row: 6, attack: 1, defense: 3 },
      { id: 'g2', type: 'warrior', civilizationId: 2, col: 7, row: 6, attack: 1, defense: 3 },
    ];

    const plan = planBulkAttack(
      engine, 1, [enemyCityAt(6, 6)], 8, 3, 10, true,
    );

    // availableStrength 8 < defense (~37.5) * ratio → no plan.
    expect(plan).toBeNull();
  });

  it('plans a bulk city assault with at least 3 units when strong enough', () => {
    const { engine } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 }];

    const plan = planBulkAttack(
      engine, 1, [enemyCityAt(4, 4)], 12, 5, 10, true,
    );

    expect(plan).not.toBeNull();
    expect(plan!.target).toEqual({ col: 4, row: 4 });
    expect(plan!.targetType).toBe('city');
    expect(plan!.targetDefense).toBe(UNKNOWN_CITY_DEFENSE);
    expect(plan!.requiredUnits).toBeGreaterThanOrEqual(3);
  });

  it('does not plan anything when the posture is defensive', () => {
    const { engine } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 }];

    const plan = planBulkAttack(
      engine, 1, [enemyCityAt(4, 4)], 50, 5, 10, false,
    );

    expect(plan).toBeNull();
  });

  it('skips enemy cities already captured by us', () => {
    const { engine } = createMockEngine();
    const captured = { id: 'captured', civilizationId: 1, col: 4, row: 4, population: 1 };
    engine.cities = [captured];

    const plan = planBulkAttack(
      engine, 1, [enemyCityAt(4, 4)], 12, 5, 10, true,
    );

    expect(plan).toBeNull();
  });

  it('still plans a bulk assault with older (but not ancient) intelligence', () => {
    const { engine } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 }];

    // lastSeen at round 0, planning at round 40 → intel 40 rounds old. Two
    // fronts that met once and separated must not lose the only known enemy
    // city after 20 rounds — that was the "aggression never fires" stalemate.
    const plan = planBulkAttack(
      engine, 1, [enemyCityAt(4, 4, 0)], 12, 5, 40, true,
    );

    expect(plan).not.toBeNull();
    expect(plan!.target).toEqual({ col: 4, row: 4 });
  });
});

// ---------------------------------------------------------------------------
// AIManager integration: updateOffensivePlan creates/withdraws bulk attacks
// ---------------------------------------------------------------------------

describe('AIManager bulk-attack integration', () => {
  it('creates an offensive plan when cities are secured and the army is strong', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [{ id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 }];
    engine.units = [
      archer('u1', 1, 0, 0),
      archer('u2', 1, 1, 0),
      archer('u3', 1, 0, 1),
    ];
    storage.enemyLocations.set(2, [enemyCityAt(4, 4)]);

    const aiManager = new AIManager(engine);
    (aiManager as any).updateOffensivePlan(1, storage, 10);

    expect(storage.turnData.offensivePlan).toBeTruthy();
    expect(storage.turnData.offensivePlan.target).toEqual({ col: 4, row: 4 });
    expect(storage.turnData.offensivePlan.targetType).toBe('city');
    expect(storage.turnData.offensivePlan.requiredUnits).toBeGreaterThanOrEqual(3);
    expect(storage.turnData.aiState.aggression.posture).toBe('aggressive');
  });

  it('does NOT create an offensive plan when the target is too strong', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [
      { id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 },
    ];
    engine.units = [
      archer('u1', 1, 0, 0),
      archer('u2', 1, 1, 0),
      archer('u3', 1, 0, 1),
    ];
    // Enemy capital: walls + population + a garrison of two warriors.
    const strong = { id: 'strong', civilizationId: 2, col: 6, row: 6, population: 8, buildings: ['city_walls'] };
    engine.cities.push(strong);
    engine.units.push(
      { id: 'g1', type: 'warrior', civilizationId: 2, col: 6, row: 6, attack: 1, defense: 3 },
      { id: 'g2', type: 'warrior', civilizationId: 2, col: 7, row: 6, attack: 1, defense: 3 },
    );
    storage.enemyLocations.set(2, [enemyCityAt(6, 6)]);

    const aiManager = new AIManager(engine);
    (aiManager as any).updateOffensivePlan(1, storage, 10);

    expect(storage.turnData.offensivePlan).toBeNull();
  });

  it('withdraws assigned units when the target has become too strong', () => {
    const { engine, storage } = createMockEngine();
    engine.cities = [
      { id: 'friendly', civilizationId: 1, col: 0, row: 0, population: 1 },
    ];
    engine.units = [archer('u1', 1, 0, 0)];

    // A plan that promised an assault on an (initially) weak city.
    storage.turnData.offensivePlan = {
      target: { col: 4, row: 4 },
      targetType: 'city',
      score: 8,
      requiredUnits: 3,
      assignedUnitIds: [],
      roundPrepared: 9,
      targetDefense: UNKNOWN_CITY_DEFENSE,
      targetCivId: 2,
    };

    const aiManager = new AIManager(engine);
    // availableStrength for 1 archer = 4 < 8 * BULK_ATTACK_STRENGTH_RATIO → withdraw.
    const target = (aiManager as any).getOffensivePlanTarget(engine.units[0], storage);

    expect(target).toBeNull();
  });
});
