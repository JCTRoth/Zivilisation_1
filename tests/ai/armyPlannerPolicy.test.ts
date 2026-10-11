import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type { Civilization } from '../../types/game';
import { AIEconomicManager } from '@/game/engine/AI/AIEconomicManager';

/**
 * The army cap must be planned at a tax rate the rate controller is actually
 * willing to hold — not at a hard-coded 50 %.
 *
 * The bug this pins: `sustainableUnits` planned at `max(taxRate, 50)` while
 * `adjustRatesForAI` defends `maxTaxRate − luxury − science floor` and never
 * drops below AI_MIN_TAX (35). A civ at 35 % tax therefore had an army sized
 * for an income it never ran, went negative, and paid the difference with the
 * disbander (196–419 UNIT_DISBANDED events per measured 400-round game).
 *
 * These tests drive the REAL planner against a real engine, so the numbers are
 * the ones the production code computes.
 */
describe('AI army planning uses the rate the controller will hold', () => {
  /** A comfortable early-game civ: solvent, resting at the healthy 35 % tax. */
  const makeCiv = (engine: GameEngine, government = 'despotism') => {
    const civ = {
      id: 0,
      government,
      resources: { gold: 100 },   // above zero, so the deep floor does not kick in
      taxRate: 35, scienceRate: 45, luxuryRate: 20,
    };
    (engine as unknown as { civilizations: unknown[] }).civilizations = [civ];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { units: unknown[] }).units = [];
    return civ as unknown as Civilization;
  };

  it('plans at the controller ceiling, not at 50 %', () => {
    const engine = new GameEngine(null);
    const planner = new AIEconomicManager(
      engine,
      (engine as unknown as { economicManager: never }).economicManager ??
        (engine as unknown as { economicManager: never }).economicManager,
    );
    const econ = (planner as unknown as { econ: Record<string, unknown> }).econ;
    const civ = makeCiv(engine);

    // maxTaxIncome 100, no buildings, no units → the policy ceiling decides.
    econ.maxTaxIncome = () => 100;
    econ.maxSpecialistGold = () => 0;
    econ.buildingUpkeep = () => 0;

    const planning = (planner as unknown as { policyTaxRate: (c: unknown, l: number, s: number) => number })
      .policyTaxRate(civ, 0, 20);   // content cities, normal science floor
    // despotism caps at 100 → 100 − 0 luxury − 20 science = 80, and 80 > 35.
    expect(planning).toBeCloseTo(0.8, 5);
  });

  it('gives a small army under Democracy, whose tax cap is 10', () => {
    const engine = new GameEngine(null);
    const planner = new AIEconomicManager(engine, (engine as unknown as { economicManager: never }).economicManager);
    const civ = makeCiv(engine);
    civ.government = 'democracy';

    const planning = (planner as unknown as { policyTaxRate: (c: unknown, l: number, s: number) => number })
      .policyTaxRate(civ, 0, 20);
    expect(planning).toBeCloseTo(0.1, 5);
  });

  it('never plans below AI_MIN_TAX, even when luxury+science eat the room', () => {
    const engine = new GameEngine(null);
    const planner = new AIEconomicManager(engine, (engine as unknown as { economicManager: never }).economicManager);
    const civ = makeCiv(engine);
    const planning = (planner as unknown as { policyTaxRate: (c: unknown, l: number, s: number) => number })
      .policyTaxRate(civ, 45, 20);   // luxury need larger than the free room
    expect(planning).toBeGreaterThanOrEqual(0.35);
  });

  it('prices the next unit at the most expensive unit the civ owns', () => {
    const engine = new GameEngine(null);
    const planner = new AIEconomicManager(engine, (engine as unknown as { economicManager: never }).economicManager);
    const civ = makeCiv(engine);

    engine.units.push(
      { id: 'u1', type: 'riflemen', civilizationId: civ.id, col: 1, row: 1, maintenance: 1, isDefeated: false } as never,
      { id: 'u2', type: 'tank', civilizationId: civ.id, col: 2, row: 2, maintenance: 4, isDefeated: false } as never,
    );
    const price = (planner as unknown as { planningUnitMaintenance: (c: unknown) => number })
      .planningUnitMaintenance(civ);
    expect(price).toBe(4);
  });
});
