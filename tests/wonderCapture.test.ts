/**
 * Wonder ownership transfer on city capture (spec: "Capturing a city that
 * contains a Wonder transfers ownership (and all effects) to the conqueror").
 *
 * Two things are proven here:
 *  1. the wonder physically survives the capture — Civ 1 destroys ONE random
 *     improvement on capture, and wonders are exempt (the palace and walls
 *     have their own rules);
 *  2. ownership — and therefore every effect — flips to the conqueror.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { world as wrapWorld, type TestWorld } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import type { City } from '../types/game';

describe('wonder transfer on city capture', () => {
  let engine: GameEngine;
  let w: TestWorld;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    engine.onStateChange = null;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      mapSeed: 99,
    });
    w = wrapWorld(engine);
    randomSpy = vi.spyOn(Math, 'random');
    // Combat rolls: low random = attacker wins (see tests/cityCapture.test.ts).
    randomSpy.mockReturnValue(0.05);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    engine.onStateChange = null;
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  /** A city guaranteed to sit on passable land (capture needs a reachable tile). */
  const settleOnLand = (name: string, civId: number, population: number): City => {
    const spot = w.landNear(Math.floor((engine.map?.width ?? 40) / 2), Math.floor((engine.map?.height ?? 24) / 2), 12);
    return w.settle(name, spot.col, spot.row, civId, population);
  };

  /** Move a fresh attacker onto the city tile to trigger a capture. */
  const capture = (city: City, attackerCivId = 0) => {
    const spot = w.landNear(city.col, city.row, 1);
    const attacker = w.spawnUnit({
      id: `attacker_${attackerCivId}_${city.id}`,
      col: spot.col,
      row: spot.row,
      type: 'tank',
      civilizationId: attackerCivId,
    });
    (attacker as unknown as { attack: number }).attack = 99;
    const result = engine.moveUnit(attacker.id, city.col, city.row) as { success?: boolean; reason?: string };
    expect(result.success, `capture move failed: ${result.reason}`).toBe(true);
  };

  it('the wonder survives the capture and changes hands', () => {
    const city = settleOnLand('WonderCity', 1, 2);
    city.buildings = ['hanging_gardens', 'city_walls', 'granary'];
    city.wonders = ['hanging_gardens'];

    capture(city);

    expect(city.civilizationId, 'city changed hands').toBe(0);
    expect(city.buildings, 'wonder survives capture').toContain('hanging_gardens');
    // Civ 1-style capture losses still apply to the ordinary improvements.
    expect(city.buildings).not.toContain('city_walls');
    // The registry follows the city — no stale owner anywhere.
    expect(engine.wonderManager?.ownerCivId('hanging_gardens')).toBe(0);
    expect(engine.wonderManager?.findWonderCity('hanging_gardens')?.id).toBe(city.id);
  });

  it('wonder effects follow the conqueror, not the previous owner', () => {
    const city = settleOnLand('WonderCity', 1, 2);
    // Civilization-scoped wonder: reaches every city of whoever holds it, so
    // the assertion cannot depend on continent geometry.
    city.buildings = ['cure_for_cancer'];
    const capturer = engine.civilizations[0];
    const previousOwner = engine.civilizations[1];

    const civ0City = w.settle('HomeOfCiv0', 0, 0, 0, 1);
    const civ1City = w.settle('HomeOfCiv1', 8, 8, 1, 1);

    // Before: the happiness belongs to civ 1's cities.
    expect(engine.economicManager.wonderHappinessForCity(civ1City)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(civ0City)).toBe(0);

    capture(city);

    // After: the conqueror's cities enjoy it, the loser does not.
    expect(engine.economicManager.wonderHappinessForCity(civ0City)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(civ1City)).toBe(0);
    expect(engine.wonderManager?.isActive('cure_for_cancer', capturer.id)).toBe(true);
    expect(engine.wonderManager?.isActive('cure_for_cancer', previousOwner.id)).toBe(false);
    expect(engine.wonderManager?.wondersOfCiv(0)).toContain('cure_for_cancer');
    expect(engine.wonderManager?.wondersOfCiv(1)).not.toContain('cure_for_cancer');
  });

  it('the captured city still cannot rebuild a wonder it already holds', () => {
    const city = settleOnLand('WonderCity', 1, 2);
    city.buildings = ['pyramids'];
    capture(city);

    expect(city.civilizationId).toBe(0);
    engine.civilizations[0].technologies = ['masonry'];
    const attempt = engine.productionManager.setCityProduction(city.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    // The conqueror technically "owns" it already (it sits in THIS city).
    expect(attempt.success).toBe(false);
    expect(attempt.reason).toBe('already_built');
    // And no other city of the conqueror may start it either.
    const other = w.settle('OtherCity', 2, 6, 0, 1);
    const elsewhere = engine.productionManager.setCityProduction(other.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(elsewhere.success).toBe(false);
    expect(elsewhere.reason).toBe('wonder_already_completed');
  });
});
