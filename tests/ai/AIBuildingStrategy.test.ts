import { describe, it, expect } from 'vitest';
import { AIBuildingStrategy } from '@/game/engine/AI/AIBuildingStrategy';
import type { BuildingPlan, Personality } from '@/game/engine/AI/AITypes';

interface TestCity {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  production: number;
  food: number;
  gold: number;
  science: number;
  buildings: string[];
}

const makeCity = (overrides: Record<string, unknown> = {}): TestCity => ({
  id: 'city-1',
  name: 'TestCity',
  civilizationId: 1,
  col: 5,
  row: 5,
  population: 4,
  production: 0,
  food: 0,
  gold: 0,
  science: 0,
  buildings: [],
  ...overrides,
} as TestCity);

interface TestCiv {
  id: number;
  name: string;
  color: string;
  isAlive: boolean;
  resources: { food: number; production: number; trade: number; science: number; gold: number };
  technologies: string[];
  personality: Personality;
}

const makeCiv = (overrides: Record<string, unknown> = {}): TestCiv => ({
  id: 1,
  name: 'TestCiv',
  color: '#ff0000',
  isAlive: true,
  resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
  technologies: ['pottery', 'masonry'],
  personality: {
    aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
  } as Personality,
  ...overrides,
} as TestCiv);

const baseBuildingGameState = (overrides: Record<string, unknown> = {}) => ({
  currentYear: -2000,
  roundNumber: 20,
  isBorderCity: false,
  isUnderThreat: false,
  numCities: 2,
  ...overrides,
});

const baseWonderGameState = (overrides: Record<string, unknown> = {}) => ({
  currentYear: -2000,
  isUnderThreat: false,
  builtWonders: [] as string[],
  ...overrides,
});

describe('AIBuildingStrategy.evaluateBuildings', () => {
  it('should return an array of BuildingPlans', () => {
    const city = makeCity();
    const civ = makeCiv();
    const plans = AIBuildingStrategy.evaluateBuildings(city, civ, 'balanced_growth', baseBuildingGameState());

    expect(Array.isArray(plans)).toBe(true);
    if (plans.length > 0) {
      expect(plans[0]).toHaveProperty('buildingType');
      expect(plans[0]).toHaveProperty('priority');
      expect(plans[0]).toHaveProperty('reason');
    }
  });

  it('should not suggest already-built buildings', () => {
    const city = makeCity({ buildings: ['granary'] });
    const civ = makeCiv();
    const plans = AIBuildingStrategy.evaluateBuildings(city, civ, 'balanced_growth', baseBuildingGameState());

    const granaryPlan = plans.find(p => p.buildingType === 'granary');
    expect(granaryPlan).toBeUndefined();
  });

  it('should prioritize city_walls when under threat', () => {
    const city = makeCity();
    const civ = makeCiv({ technologies: ['pottery', 'masonry'] });
    const plans = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'defensive_turtle',
      baseBuildingGameState({ isUnderThreat: true })
    );

    // City walls should rank high when threatened
    const wallsPlan = plans.find(p => p.buildingType === 'city_walls');
    if (wallsPlan) {
      expect(wallsPlan.priority).toBeGreaterThan(10);
    }
  });

  it('should return sorted results (highest priority first)', () => {
    const city = makeCity();
    const civ = makeCiv({ technologies: ['pottery', 'masonry', 'writing', 'bronze_working'] });
    const plans = AIBuildingStrategy.evaluateBuildings(city, civ, 'balanced_growth', baseBuildingGameState());

    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].priority).toBeGreaterThanOrEqual(plans[i].priority);
    }
  });

  it('marketplace priority rises in the late game', () => {
    const city = makeCity({ population: 6 });
    const civ = makeCiv({ technologies: ['currency', 'banking', 'pottery', 'masonry'] });
    const early = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', baseBuildingGameState({ currentYear: -3000 })
    );
    const late = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', baseBuildingGameState({ currentYear: 1 })
    );
    const earlyMarket = early.find(p => p.buildingType === 'marketplace');
    const lateMarket = late.find(p => p.buildingType === 'marketplace');
    expect(earlyMarket).toBeDefined();
    expect(lateMarket).toBeDefined();
    // Late-game market is worth ~15 more than the early-era one.
    expect(lateMarket!.priority).toBeGreaterThan(earlyMarket!.priority);
  });

  it('bank priority rises in the very late game', () => {
    const city = makeCity({ population: 9, buildings: ['marketplace'] });
    const civ = makeCiv({ technologies: ['currency', 'banking', 'pottery', 'masonry'] });
    const early = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', baseBuildingGameState({ currentYear: -3000 })
    );
    const late = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', baseBuildingGameState({ currentYear: 1600 })
    );
    const earlyBank = early.find(p => p.buildingType === 'bank');
    const lateBank = late.find(p => p.buildingType === 'bank');
    expect(earlyBank).toBeDefined();
    expect(lateBank).toBeDefined();
    // Very-late-game bank is worth ~20 more than the early-era one.
    expect(lateBank!.priority).toBeGreaterThan(earlyBank!.priority);
  });

  it('prioritizes a temple when a safe city is unhappy', () => {
    // Unhappy: unhappiness (3) outweighs happiness (1), but NOT under threat.
    const city = makeCity({
      population: 5,
      happiness: 1,
      unhappiness: 3,
      disorder: false,
    });
    const civ = makeCiv({ technologies: ['pottery', 'masonry', 'ceremonial_burial'] });
    const happyCityPlans = AIBuildingStrategy.evaluateBuildings(
      makeCity({ population: 5 }),
      civ, 'balanced_growth', baseBuildingGameState()
    );
    const unhappyCityPlans = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', baseBuildingGameState()
    );
    const happyTemple = happyCityPlans.find(p => p.buildingType === 'temple');
    const unhappyTemple = unhappyCityPlans.find(p => p.buildingType === 'temple');
    expect(unhappyTemple).toBeDefined();
    expect(happyTemple).toBeDefined();
    // A temple for an unhappy, safe city scores meaningfully higher.
    expect(unhappyTemple!.priority).toBeGreaterThan(happyTemple!.priority + 15);
    expect(unhappyTemple!.reason).toContain('city-unhappy');
  });

  it('does NOT prioritize a temple for an unhappy city under threat (defense wins)', () => {
    const civ = makeCiv({ technologies: ['pottery', 'masonry', 'ceremonial_burial'] });
    const unsafe = AIBuildingStrategy.evaluateBuildings(
      makeCity({ population: 5, happiness: 1, unhappiness: 3, disorder: false }),
      civ, 'balanced_growth', baseBuildingGameState({ isUnderThreat: true })
    );
    const safe = AIBuildingStrategy.evaluateBuildings(
      makeCity({ population: 5, happiness: 1, unhappiness: 3, disorder: false }),
      civ, 'balanced_growth', baseBuildingGameState({ isUnderThreat: false })
    );
    const unsafeTemple = unsafe.find(p => p.buildingType === 'temple');
    const safeTemple = safe.find(p => p.buildingType === 'temple');
    expect(unsafeTemple).toBeDefined();
    expect(safeTemple).toBeDefined();
    // Same unhappy city: the safe one scores higher for temple; the threatened
    // one keeps temple low so city_walls/defenders win the decision.
    expect(safeTemple!.priority).toBeGreaterThan(unsafeTemple!.priority);
  });
});

describe('AIBuildingStrategy.evaluateWonders', () => {
  it('should return empty array when under threat', () => {
    const city = makeCity();
    const civ = makeCiv();
    const plans = AIBuildingStrategy.evaluateWonders(
      city, civ, 'balanced_growth',
      baseWonderGameState({ isUnderThreat: true })
    );
    expect(plans).toEqual([]);
  });

  it('should exclude already-built wonders', () => {
    const city = makeCity();
    const civ = makeCiv({ technologies: ['ceremonial_burial', 'masonry', 'pottery'] });
    const plans = AIBuildingStrategy.evaluateWonders(
      city, civ, 'wonder_rush',
      baseWonderGameState({ builtWonders: ['pyramids'] })
    );

    const pyramidsPlan = plans.find(p => p.buildingType === 'pyramids');
    expect(pyramidsPlan).toBeUndefined();
  });
});

describe('AIBuildingStrategy.shouldBuildOverUnit', () => {
  const plan: BuildingPlan = { buildingType: 'granary', priority: 20, reason: 'growth' };

  it('should return false if no defender exists', () => {
    expect(AIBuildingStrategy.shouldBuildOverUnit(plan, false, false, 3, 2)).toBe(false);
  });

  it('should return true for critical priority buildings', () => {
    const criticalPlan: BuildingPlan = { buildingType: 'aqueduct', priority: 35, reason: 'pop cap' };
    expect(AIBuildingStrategy.shouldBuildOverUnit(criticalPlan, true, false, 3, 2)).toBe(true);
  });

  it('should return false when under threat with low-priority building', () => {
    const lowPlan: BuildingPlan = { buildingType: 'temple', priority: 5, reason: 'culture' };
    expect(AIBuildingStrategy.shouldBuildOverUnit(lowPlan, true, true, 3, 2)).toBe(false);
  });

  it('should prefer buildings when military ratio is healthy', () => {
    // 6 military units / 2 cities = 3.0 ratio, well above 1.5 threshold
    expect(AIBuildingStrategy.shouldBuildOverUnit(plan, true, false, 6, 2)).toBe(true);
  });
});
