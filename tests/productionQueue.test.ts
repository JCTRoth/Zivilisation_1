/**
 * Regression test for the build queue ("Add to Queue adds nothing"):
 *
 *  - Civ1 lets a city build the same UNIT over and over (three Warriors in a
 *    row), so `ProductionManager.setCityProduction(queue=true)` must accept
 *    repeat units. A blanket "same item already in queue" guard silently
 *    swallowed those clicks and the UI still claimed success.
 *  - Only BUILDINGS are unique per city, so queueing one twice is rejected
 *    with a reason the UI can show (`already_queued` /
 *    `already_in_production` / `already_built`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type { City, ProductionItem } from '../types/game';

const warrior: ProductionItem = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 };
const barracks: ProductionItem = { type: 'building', itemType: 'barracks', name: 'Barracks', cost: 40 };

/** Count queued entries of a given item type. */
const queued = (city: City, itemType: string): number =>
  (city.buildQueue ?? []).filter((q) => (q.itemType ?? q.type) === itemType).length;

describe('production queue duplicates', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  /** Boot a 2-civ game and found a city for civilization 0. */
  async function setupCity(): Promise<GameEngine> {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });

    const settler = engine.units.find((u) => u.type === 'settler');
    if (settler) engine.foundCityWithSettler(settler.id);
    const city = engine.cities.find((c) => c.civilizationId === 0);
    expect(city).toBeDefined();
    return engine;
  }

  const cityOf = (e: GameEngine): City => e.cities.find((c) => c.civilizationId === 0) as City;

  it('queues the same unit multiple times (the reported Add to Queue bug)', async () => {
    const e = await setupCity();
    const city = cityOf(e);

    // Put something in production first so queued items stay in the queue.
    e.productionManager.setCityProduction(city.id, warrior, false);

    // Two more Warriors, one click each — both must land in the queue.
    const first = e.productionManager.setCityProduction(city.id, warrior, true);
    expect(first.success).toBe(true);
    expect(queued(city, 'warrior')).toBe(1);

    const second = e.productionManager.setCityProduction(city.id, warrior, true);
    expect(second.success).toBe(true);
    expect(queued(city, 'warrior')).toBe(2);
  });

  it('rejects queueing the same building twice — with a reason', async () => {
    const e = await setupCity();
    const city = cityOf(e);
    // Civ 0 starts with irrigation/mining/roads only.
    (e.civilizations[0].technologies as string[]).push('bronze_working');

    const first = e.productionManager.setCityProduction(city.id, barracks, true);
    expect(first.success).toBe(true);
    expect(queued(city, 'barracks')).toBe(1);

    const second = e.productionManager.setCityProduction(city.id, barracks, true);
    expect(second.success).toBe(false);
    expect(second.reason).toBe('already_queued');
    // Nothing was added, so the queue is unchanged.
    expect(queued(city, 'barracks')).toBe(1);
  });

  it('rejects queueing a building that is already being produced', async () => {
    const e = await setupCity();
    const city = cityOf(e);
    (e.civilizations[0].technologies as string[]).push('bronze_working');

    // Barracks as the current production, nothing queued.
    const started = e.productionManager.setCityProduction(city.id, barracks, false);
    expect(started.success).toBe(true);
    expect(queued(city, 'barracks')).toBe(0);

    const again = e.productionManager.setCityProduction(city.id, barracks, true);
    expect(again.success).toBe(false);
    expect(again.reason).toBe('already_in_production');
  });

  it('rejects queueing a building the city already owns', async () => {
    const e = await setupCity();
    const city = cityOf(e);
    (e.civilizations[0].technologies as string[]).push('bronze_working');
    city.buildings = [...(city.buildings ?? []), 'barracks'];

    const result = e.productionManager.setCityProduction(city.id, barracks, true);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('already_built');
    expect(queued(city, 'barracks')).toBe(0);
  });

  it('"Add" only appends to the queue — the current production stays untouched', async () => {
    const e = await setupCity();
    const city = cityOf(e);

    // Something is already being built.
    const settler: ProductionItem = { type: 'unit', itemType: 'settler', name: 'Settlers', cost: 40 };
    e.productionManager.setCityProduction(city.id, settler, false);
    expect(city.currentProduction?.itemType).toBe('settler');

    // Two Add clicks → exactly two queue entries, production unchanged.
    expect(e.productionManager.setCityProduction(city.id, warrior, true).success).toBe(true);
    expect(e.productionManager.setCityProduction(city.id, warrior, true).success).toBe(true);

    expect(city.currentProduction?.itemType).toBe('settler');
    expect(queued(city, 'warrior')).toBe(2);
  });
});
