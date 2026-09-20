/**
 * Regression test for "all buildings and units producable" (tech requirements
 * were not enforced anywhere):
 *
 *  - ProductionManager.setCityProduction / purchaseCityProduction now reject
 *    any item whose required technology the owning civ hasn't researched.
 *  - Unit definitions now carry `requires` tech data.
 *  - Buildings/wonders that were missing tech requirements have them now.
 */
import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '@/data/BuildingConstants';

describe('production tech-gating', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  it('unit definitions carry requires tech data', () => {
    expect(UNIT_PROPERTIES.phalanx?.requires).toBe('bronze_working');
    expect(UNIT_PROPERTIES.chariot?.requires).toBe('the_wheel');
    expect(UNIT_PROPERTIES.tank?.requires).toBe('combustion');
    expect(UNIT_PROPERTIES.diplomat?.requires).toBe('writing');
    expect(UNIT_PROPERTIES.caravan?.requires).toBe('trade');
    // No-tech units stay ungated.
    expect(UNIT_PROPERTIES.archer?.requires ?? null).toBeNull();
    expect(UNIT_PROPERTIES.settler?.requires ?? null).toBeNull();
  });

  it('buildings and wonders that should need tech have it', () => {
    expect(BUILDING_PROPERTIES.harbor?.requiredTechnology).toBe('masonry');
    expect(BUILDING_PROPERTIES.colosseum?.requiredTechnology).toBe('construction');
    expect(BUILDING_PROPERTIES.bank?.requiredTechnology).toBe('banking');
    expect(BUILDING_PROPERTIES.cathedral?.requiredTechnology).toBe('monotheism');
    expect(BUILDING_PROPERTIES.university?.requiredTechnology).toBe('university');
    expect(BUILDING_PROPERTIES.stock_exchange?.requiredTechnology).toBe('banking');
    expect(BUILDING_PROPERTIES.sdi_defense?.requiredTechnology).toBe('space_flight');
    expect(WONDER_PROPERTIES.pyramids?.requiredTechnology).toBe('masonry');
    expect(WONDER_PROPERTIES.newton?.requiredTechnology).toBe('university');
  });

  it('ProductionManager rejects unresearched items and allows researched/no-tech ones', async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });

    // Found the first city so there is a production target.
    const settler = engine.units.find((u) => u.type === 'settler');
    if (settler) engine.foundCityWithSettler(settler.id);
    const city = engine.cities.find((c) => c.civilizationId === 0);
    expect(city).toBeDefined();

    const set = (item: { type: string; itemType: string; name: string; cost: number }): { success: boolean; reason?: string } =>
      engine!.productionManager.setCityProduction(city!.id, item, false) as { success: boolean; reason?: string };

    // Civ 0 starts with irrigation/mining/roads only.
    const harbor = set({ type: 'building', itemType: 'harbor', name: 'Harbor', cost: 60 });
    expect(harbor.success).toBe(false);
    expect(harbor.reason).toBe('requires_tech_masonry');

    const granary = set({ type: 'building', itemType: 'granary', name: 'Granary', cost: 60 });
    expect(granary.success).toBe(false);
    expect(granary.reason).toBe('requires_tech_pottery');

    const phalanx = set({ type: 'unit', itemType: 'phalanx', name: 'Phalanx', cost: 50 });
    expect(phalanx.success).toBe(false);
    expect(phalanx.reason).toBe('requires_tech_bronze_working');

    // No-tech items are allowed.
    const warrior = set({ type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 });
    expect(warrior.success).toBe(true);

    // Purchase path is gated too.
    const buy = engine.productionManager.purchaseCityProduction(city!.id, { type: 'building', itemType: 'factory', name: 'Factory', cost: 200 });
    expect(buy.success).toBe(false);
    expect(buy.reason).toBe('requires_tech_industrialization');
  });
});
