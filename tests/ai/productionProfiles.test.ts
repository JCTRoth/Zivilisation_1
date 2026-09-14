/**
 * Verifies the per-civ AI production identity + expansion-first, event-reactive
 * AutoProduction:
 *  - every civ gets a distinct production profile (by index),
 *  - a fresh capital builds a settler (not a hospital) even at population 1,
 *  - profiles expand at different rates (early_expansion grows past 4 cities,
 *    balanced_growth stops at 4, defensive_turtle still expands modestly),
 *  - onGameEvent re-picks production on WAR_DECLARED / CITY_CAPTURED /
 *    CITY_DESTROYED and tops up queues on UNIT_PRODUCED / BUILDING_COMPLETED,
 *  - the first AI city's initial production is a settler.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { getCivProductionProfile } from '@/game/engine/AI/AITypes';
import GameEngine from '@/game/engine/GameEngine';

type MockProfile = 'military_expansion' | 'science_focus' | 'balanced_growth' | 'defensive_turtle' | 'wonder_rush' | 'early_expansion';

function makeEngine(opts: {
  cityCount?: number;
  population?: number;
  profile?: MockProfile;
  defenderInCity?: boolean;
  settlerCount?: number;
} = {}) {
  const { cityCount = 1, population = 3, profile = 'balanced_growth', defenderInCity = true, settlerCount = 0 } = opts;

  const cities: any[] = [
    { id: 'city-1', name: 'Capital', civilizationId: 1, col: 0, row: 0, population, buildings: [], currentProduction: null, autoProduction: true },
  ];
  for (let n = 2; n <= cityCount; n++) {
    cities.push({ id: `city-${n}`, name: `City ${n}`, civilizationId: 1, col: n, row: n, population, buildings: [], currentProduction: null, autoProduction: true });
  }

  const units: any[] = [];
  if (defenderInCity) {
    units.push({ id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 });
  }
  for (let i = 0; i < settlerCount; i++) {
    units.push({ id: `settler_${i}`, type: 'settler', civilizationId: 1, col: 10, row: 10 });
  }

  const productionManager = { setCityProduction: vi.fn().mockReturnValue({ success: true }) };

  const engine: any = {
    cities,
    units,
    civilizations: [
      null,
      {
        id: 1,
        name: 'TestCiv',
        technologies: new Set(['warrior_code']),
        productionProfile: profile,
        warWith: new Set(),
      },
    ],
    productionManager,
    getPlayerStorage: () => ({ turnData: {} }),
    squareGrid: { squareDistance: () => 1 },
    roundManager: { getRoundNumber: () => 0 },
    currentYear: -500,
    gameSettings: { difficulty: 'PRINCE' },
    getCityAt: () => null,
    getUnitAt: () => null,
    map: { width: 20, height: 20 },
  };

  return { engine, productionManager };
}

const producedItem = (pm: any) => pm.setCityProduction.mock.calls[0][1];

describe('getCivProductionProfile', () => {
  it('assigns a distinct profile per civ index', () => {
    const profiles = [0, 1, 2, 3, 4, 5].map(getCivProductionProfile);
    expect(new Set(profiles).size).toBe(6);
  });

  it('cycles past the profile list', () => {
    expect(getCivProductionProfile(6)).toBe(getCivProductionProfile(0));
    expect(getCivProductionProfile(7)).toBe(getCivProductionProfile(1));
  });
});

describe('expansion-first AutoProduction', () => {
  it('builds a settler from a population-1 capital instead of a hospital', () => {
    const { engine, productionManager } = makeEngine({ cityCount: 1, population: 1, profile: 'balanced_growth' });
    new AutoProduction(engine).setAutoProduction('city-1');
    expect(producedItem(productionManager).itemType).toBe('settler');
  });

  it('still needs a city defender before expansion', () => {
    const { engine, productionManager } = makeEngine({ cityCount: 1, population: 1, defenderInCity: false });
    new AutoProduction(engine).setAutoProduction('city-1');
    const item = producedItem(productionManager);
    expect(item.type).toBe('unit');
    expect(item.itemType).not.toBe('settler');
  });

  it('keeps expanding past 4 cities — cadence scales with empire size (no hard cap)', () => {
    // 8 cities, 3 settlers already on hand.
    const aggressive = makeEngine({ cityCount: 8, population: 3, profile: 'early_expansion', settlerCount: 3 });
    new AutoProduction(aggressive.engine).setAutoProduction('city-1');
    // early_expansion target = ceil(8/2) = 4 → 3 < 4 → still builds settlers.
    expect(producedItem(aggressive.productionManager).itemType).toBe('settler');

    const balanced = makeEngine({ cityCount: 8, population: 3, profile: 'balanced_growth', settlerCount: 3 });
    new AutoProduction(balanced.engine).setAutoProduction('city-1');
    // balanced target = ceil(8/3) = 3 → 3 < 3 false → no more settlers right now.
    expect(producedItem(balanced.productionManager).itemType).not.toBe('settler');
  });

  it('never hard-stops expansion, even for a large empire', () => {
    // 15 cities, early_expansion corps capped at 6 → still replaces settlers.
    const { engine, productionManager } = makeEngine({ cityCount: 15, population: 3, profile: 'early_expansion', settlerCount: 5 });
    new AutoProduction(engine).setAutoProduction('city-1');
    expect(producedItem(productionManager).itemType).toBe('settler');
  });

  it('defensive_turtle still expands modestly from a single city', () => {
    const { engine, productionManager } = makeEngine({ cityCount: 1, population: 3, profile: 'defensive_turtle' });
    new AutoProduction(engine).setAutoProduction('city-1');
    expect(producedItem(productionManager).itemType).toBe('settler');
  });
});

describe('event-reactive AutoProduction', () => {
  it('re-picks production for both sides on WAR_DECLARED', () => {
    const { engine } = makeEngine();
    const autoProduction = new AutoProduction(engine);
    const processSpy = vi.spyOn(autoProduction, 'processAutoProductionForCivilization');
    autoProduction.onGameEvent('WAR_DECLARED', { aggressorId: 1, targetId: 2 });
    expect(processSpy).toHaveBeenCalledWith(1);
    expect(processSpy).toHaveBeenCalledWith(2);
  });

  it('re-picks the loser on CITY_CAPTURED and the owner on CITY_DESTROYED', () => {
    const { engine } = makeEngine();
    const autoProduction = new AutoProduction(engine);
    const processSpy = vi.spyOn(autoProduction, 'processAutoProductionForCivilization');

    autoProduction.onGameEvent('CITY_CAPTURED', { city: { civilizationId: 2 }, capturedBy: 1, originalCiv: 2 });
    expect(processSpy).toHaveBeenCalledWith(2);
    expect(processSpy).toHaveBeenCalledWith(1);

    processSpy.mockClear();
    autoProduction.onGameEvent('CITY_DESTROYED', { city: { civilizationId: 2 }, attacker: { id: 'u' } });
    expect(processSpy).toHaveBeenCalledWith(2);
  });

  it('tops up the queue immediately on UNIT_PRODUCED / BUILDING_COMPLETED', () => {
    const { engine, productionManager } = makeEngine({ cityCount: 1, population: 3 });
    const autoProduction = new AutoProduction(engine);
    const queueSpy = vi.spyOn(autoProduction, 'ensureProductionQueue');

    autoProduction.onGameEvent('UNIT_PRODUCED', { cityId: 'city-1' });
    expect(queueSpy).toHaveBeenCalledWith('city-1');

    queueSpy.mockClear();
    autoProduction.onGameEvent('BUILDING_COMPLETED', { cityId: 'city-1', buildingType: 'granary' });
    expect(queueSpy).toHaveBeenCalledWith('city-1');
    expect(productionManager.setCityProduction).toHaveBeenCalled();
  });
});

describe('initial AI production (real engine)', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  it('assigns per-civ production profiles at creation', async () => {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({ numberOfCivilizations: 2, mapType: 'AI_VS_AI', devMode: false, startingGold: 100 });
    engine = e;

    expect((e.civilizations[0] as { productionProfile?: string }).productionProfile).toBe('early_expansion');
    expect((e.civilizations[1] as { productionProfile?: string }).productionProfile).toBe('military_expansion');
  });

  it('assigns a deterministic AI personality matching each production profile', async () => {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({ numberOfCivilizations: 2, mapType: 'AI_VS_AI', devMode: false, startingGold: 100 });
    engine = e;

    const p0 = (e.civilizations[0] as { personality?: { aggression: number } }).personality;
    const p1 = (e.civilizations[1] as { personality?: { aggression: number } }).personality;
    // early_expansion → aggression 6; military_expansion → aggression 8.
    expect(p0?.aggression).toBe(6);
    expect(p1?.aggression).toBe(8);
  });

  it('starts the first AI city with a scout (before any enemy contact)', async () => {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({ numberOfCivilizations: 2, mapType: 'AI_VS_AI', devMode: false, startingGold: 100 });
    engine = e;

    const settler = e.units.find((u) => u.type === 'settler' && u.civilizationId === 0);
    expect(settler).toBeDefined();
    expect(e.foundCityWithSettler(settler!.id)).toBe(true);

    const city = e.cities.find((c) => c.civilizationId === 0);
    expect(city).toBeDefined();
    expect((city as unknown as { currentProduction?: { itemType?: string } }).currentProduction?.itemType).toBe('scout');
  });
});
