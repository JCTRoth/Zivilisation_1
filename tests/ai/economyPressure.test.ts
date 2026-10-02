/**
 * Economic management: the AI has to notice when the money runs out, and it
 * has to be able to SPEND the money it does have.
 *
 * Three concrete failures these tests pin:
 *  1. `EconomicManager.AI_MIN_GOLD_RESERVE` was declared but never assigned,
 *     so every caller read `?? 8` — the reserve existed only as folklore.
 *  2. `GameEngine.rushCityProduction` returned false for any non-human civ,
 *     so `AutoProduction.evaluateGoldSpending` — which has a full reserve /
 *     affordability policy — could never actually buy anything for an AI. Gold
 *     accumulated while cities ticked toward builds it could have finished.
 *  3. Marketplace/bank priority was driven purely by the calendar (year gates
 *     landing around round 200/225/300), so a civ bleeding gold at round 60
 *     kept building soldiers instead of income.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AIBuildingStrategy } from '@/game/engine/AI/AIBuildingStrategy';
import type { BuildingPlan, Personality } from '@/game/engine/AI/AITypes';

const ECON_TECHS = ['pottery', 'masonry', 'currency', 'banking', 'writing'];

const makeCity = (overrides: Record<string, unknown> = {}) => ({
  id: 'city-1',
  name: 'TestCity',
  civilizationId: 1,
  col: 5,
  row: 5,
  population: 6,
  production: 4,
  food: 0,
  gold: 0,
  science: 0,
  buildings: [] as string[],
  yields: { food: 2, production: 3, trade: 5 },
  ...overrides,
}) as never;

const makeCiv = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'TestCiv',
  color: '#ff0000',
  isAlive: true,
  resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
  technologies: ECON_TECHS,
  personality: {
    aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
  } as Personality,
  ...overrides,
}) as never;

const gameState = (over: Record<string, unknown> = {}) => ({
  currentYear: -3000,
  roundNumber: 20,
  isBorderCity: false,
  isUnderThreat: false,
  numCities: 2,
  ...over,
});

const priorityOf = (plans: BuildingPlan[], type: string): number =>
  plans.find((p) => p.buildingType === type)?.priority ?? -Infinity;

describe('upkeep pressure reaches the building ladder', () => {
  it('promotes the marketplace when the treasury is under its reserve', () => {
    const city = makeCity();
    const civ = makeCiv();
    const calm = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState({ economyPressure: false }),
    );
    const pressed = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState({ economyPressure: true }),
    );

    expect(priorityOf(pressed, 'marketplace')).toBeGreaterThan(priorityOf(calm, 'marketplace'));
    const plan = pressed.find((p) => p.buildingType === 'marketplace');
    expect(plan?.reason).toContain('upkeep-pressure');
  });

  it('promotes the bank the same way, without waiting for the year gate', () => {
    const city = makeCity({ population: 9, buildings: ['marketplace'] });
    const civ = makeCiv();
    // Year -3000: the calendar says a bank is not worth building yet.
    const calm = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState({ economyPressure: false }),
    );
    const pressed = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState({ economyPressure: true }),
    );

    expect(priorityOf(pressed, 'bank')).toBeGreaterThan(priorityOf(calm, 'bank'));
    const plan = pressed.find((p) => p.buildingType === 'bank');
    expect(plan?.reason).toContain('upkeep-pressure');
  });

  it('is a no-op for a treasury that is comfortably above its reserve', () => {
    const city = makeCity();
    const civ = makeCiv();
    const absent = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState(),
    );
    const explicit = AIBuildingStrategy.evaluateBuildings(
      city, civ, 'balanced_growth', gameState({ economyPressure: false }),
    );
    expect(priorityOf(explicit, 'marketplace')).toBe(priorityOf(absent, 'marketplace'));
  });
});

describe('AIEconomicManager.isUnderEconomicPressure', () => {
  it('flags a treasury below the reserve and clears one above it', async () => {
    const engine = new GameEngine(null);
    engine.sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 500,
    });
    const aiEcon = engine.aiEconomicManager!;
    const civ = engine.civilizations.find((c) => !c.isHuman) ?? engine.civilizations[1];

    civ.resources.gold = 10_000;
    expect(aiEcon.isUnderEconomicPressure(civ)).toBe(false);

    civ.resources.gold = 0;
    expect(aiEcon.isUnderEconomicPressure(civ)).toBe(true);

    civ.resources.gold = -5;
    expect(aiEcon.isUnderEconomicPressure(civ)).toBe(true);
  });

  it('treats a never-assigned reserve field as the documented floor', () => {
    const engine = new GameEngine(null);
    expect(engine.economicManager.AI_MIN_GOLD_RESERVE).toBe(8);
  });
});

type RushableCity = {
  id: string;
  currentProduction: unknown;
  productionStored: number;
};

/** Any city the engine will accept, narrowed to what these tests touch. */
function cityFor(engine: GameEngine, civId: number, col: number, row: number, name: string): RushableCity {
  const existing = engine.cities.find((c) => c.civilizationId === civId);
  const city = existing ?? engine.foundCity(col, row, civId, name);
  expect(city).toBeTruthy();
  return city as unknown as RushableCity;
}

describe('AI gold can actually be spent on rushing production', () => {
  it('rushes a non-human civ city (the isHuman gate that dead-ended AI gold)', async () => {
    const engine = new GameEngine(null);
    engine.sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 500,
    });
    const civ = engine.civilizations.find((c) => !c.isHuman) ?? engine.civilizations[1];
    const city = cityFor(engine, civ.id, 10, 10, 'Aurum');

    city.currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 40 };
    city.productionStored = 10;
    civ.resources.gold = 500;

    expect(engine.rushCityProduction(city.id)).toBe(true);
    // 30 shields remaining × 2 = 60 gold.
    expect(civ.resources.gold).toBe(440);
    expect(city.productionStored).toBe(40);
  });

  it('still refuses when the treasury cannot cover the rush', async () => {
    const engine = new GameEngine(null);
    engine.sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 500,
    });
    const civ = engine.civilizations.find((c) => !c.isHuman) ?? engine.civilizations[1];
    const city = cityFor(engine, civ.id, 12, 12, 'Paupers');

    city.currentProduction = { type: 'building', itemType: 'granary', name: 'Granary', cost: 200 };
    city.productionStored = 0;
    civ.resources.gold = 10;

    expect(engine.rushCityProduction(city.id)).toBe(false);
    expect(civ.resources.gold).toBe(10);
  });
});
