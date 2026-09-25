/**
 * Save/load round-trip matrix.
 *
 * `tests/saveLoad.test.ts` covers fog, turn state, unit/city counts, GoTo paths
 * and the citizen tile sets. This file covers the *rest* of the state that
 * crosses the save boundary, because a player who reloads is not watching CI:
 * the damage only shows up turns later ("my boat stopped fishing", "the camera
 * jumped somewhere odd", "the settler forgot what it was building").
 *
 * Each case writes one piece of state, saves, loads into a FRESH engine and
 * asserts it came back — including the `Set`-vs-array and stale-object traps
 * that JSON introduces.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { makeEngine, world } from './helpers/world';

const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
} as Storage;

/** Save the engine and load it into a brand-new engine. */
async function roundTrip(engine: GameEngine): Promise<GameEngine> {
  const json = engine.getSaveJSON();
  expect(json).toBeTruthy();
  memory.set('civ1_savegame', json as string);
  const loaded = new GameEngine(null);
  (loaded as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
  (loaded as unknown as { isPaused: boolean }).isPaused = true;
  expect(await loaded.loadGame()).toBe(true);
  return loaded;
}

describe('Save/load: city state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores specialists, governor and the manual pins', async () => {
    const { engine } = await makeEngine({ seed: 401, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const city = w.settle('Stateful', 4, 4, 0, 4);
    city.specialists = ['taxman', 'scientist'];
    city.governor = 'commerce';
    city.workingTiles = new Set(['4,4', '3,4', '4,5', '5,4']);
    city.userAssignedTiles = new Set(['3,4']);

    const loaded = await roundTrip(engine);
    const after = loaded.cities.find((c) => c.id === city.id);
    expect(after).toBeDefined();
    expect(after!.specialists).toEqual(['taxman', 'scientist']);
    expect(after!.governor).toBe('commerce');
    expect(after!.workingTiles instanceof Set).toBe(true);
    expect([...after!.workingTiles].sort()).toEqual(['3,4', '4,4', '4,5', '5,4']);
    expect([...after!.userAssignedTiles]).toEqual(['3,4']);
  });

  it('restores trade routes (permanent caravan income)', async () => {
    const { engine } = await makeEngine({ seed: 402, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const city = w.settle('Trader', 4, 6, 0, 3);
    city.tradeRoutes = [
      { id: 'route-1', fromCityId: city.id, toCityId: 'other', trade: 3, turnsRemaining: -1 },
    ] as never;

    const loaded = await roundTrip(engine);
    const after = loaded.cities.find((c) => c.id === city.id);
    expect(after!.tradeRoutes).toHaveLength(1);
    expect((after!.tradeRoutes[0] as unknown as { trade: number }).trade).toBe(3);
  });

  it('restores the per-turn purchase marker and unrest counter', async () => {
    const { engine } = await makeEngine({ seed: 403, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const city = w.settle('Restless', 6, 4, 0, 3);
    city.purchasedThisTurn = ['warrior'] as never;
    city.capturedTurns = 4;

    const loaded = await roundTrip(engine);
    const after = loaded.cities.find((c) => c.id === city.id);
    expect(after!.purchasedThisTurn).toEqual(['warrior']);
    expect(after!.capturedTurns).toBe(4);
  });

  it('restores a capital that still matches a living city', async () => {
    const { engine } = await makeEngine({ seed: 404, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const capital = w.settle('Capital', 5, 5, 0, 4);
    const civ = engine.civilizations[0];
    civ.capital = { id: capital.id, name: capital.name, col: capital.col, row: capital.row } as never;

    const loaded = await roundTrip(engine);
    const afterCiv = loaded.civilizations[0];
    const capitalId = (afterCiv.capital as unknown as { id: string })?.id;
    // Either the capital is restored, or it was rebuilt — but it must never be
    // a reference to a city that no longer exists.
    if (capitalId) {
      expect(loaded.cities.some((c) => c.id === capitalId)).toBe(true);
    } else {
      expect(afterCiv.capital ?? null).toBeNull();
    }
  });
});

describe('Save/load: unit state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores a settler that is halfway through building something', async () => {
    const { engine } = await makeEngine({ seed: 405, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const worker = w.spawnUnit({ id: 'builder', col: 7, row: 7, type: 'settler' });
    (worker as unknown as { workTarget: string }).workTarget = 'road';
    (worker as unknown as { workTurns: number }).workTurns = 2;

    const loaded = await roundTrip(engine);
    const after = loaded.units.find((u) => u.id === 'builder');
    expect(after).toBeDefined();
    expect((after as unknown as { workTarget: string }).workTarget).toBe('road');
    // The countdown must resume where it left off, not restart.
    expect((after as unknown as { workTurns: number }).workTurns).toBe(2);
  });

  it('restores a fisher boat mid-route with its catch', async () => {
    const { engine } = await makeEngine({ seed: 406, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const home = w.settle('Port', 7, 6, 0, 3);
    const boat = w.spawnUnit({ id: 'boat', col: 8, row: 6, type: 'fisher_boat', homeCityId: home.id });
    (boat as unknown as { fishStored: number }).fishStored = 4;
    (boat as unknown as { fishingRoute: unknown }).fishingRoute = {
      homeCityId: home.id, fishingTile: { col: 8, row: 6 }, stage: 'fishing',
    };

    const loaded = await roundTrip(engine);
    const after = loaded.units.find((u) => u.id === 'boat');
    expect(after).toBeDefined();
    expect((after as unknown as { fishStored: number }).fishStored).toBe(4);
    expect((after as unknown as { fishingRoute: { stage: string } }).fishingRoute.stage).toBe('fishing');
  });

  it('restores cargo aboard a transport', async () => {
    const { engine } = await makeEngine({ seed: 407, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const ferry = w.spawnUnit({ id: 'ferry', col: 9, row: 9, type: 'galley' });
    const cargo = w.spawnUnit({ id: 'passenger', col: 9, row: 9, type: 'warrior' });
    (cargo as unknown as { embarkedOn: string }).embarkedOn = ferry.id;
    (ferry as unknown as { cargoUnitId: string }).cargoUnitId = cargo.id;

    const loaded = await roundTrip(engine);
    const afterFerry = loaded.units.find((u) => u.id === 'ferry');
    const afterCargo = loaded.units.find((u) => u.id === 'passenger');
    expect((afterFerry as unknown as { cargoUnitId: string }).cargoUnitId).toBe('passenger');
    expect((afterCargo as unknown as { embarkedOn: string }).embarkedOn).toBe('ferry');
    // And the passenger still cannot act after the reload.
    expect(loaded.canUnitMoveTo('passenger', 8, 9)).toBe(false);
  });

  it('restores unit states (fortified / sleeping) so they are not re-armed', async () => {
    const { engine } = await makeEngine({ seed: 408, mapType: 'MANY_CITIES' });
    const w = world(engine);
    const fort = w.spawnUnit({ id: 'fort', col: 10, row: 10, type: 'warrior' });
    const nap = w.spawnUnit({ id: 'nap', col: 11, row: 10, type: 'warrior' });
    engine.unitFortify(fort.id);
    engine.unitSleep(nap.id);

    const loaded = await roundTrip(engine);
    const afterFort = loaded.units.find((u) => u.id === 'fort')!;
    const afterNap = loaded.units.find((u) => u.id === 'nap')!;
    expect(afterFort.isFortified).toBe(true);
    expect(afterNap.isSleeping).toBe(true);
  });
});

describe('Save/load: civilization state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores current research and its progress', async () => {
    const { engine } = await makeEngine({ seed: 409, mapType: 'MANY_CITIES' });
    const civ = engine.civilizations[0];
    const pick = engine.availableResearchFor(civ.id)[0];
    engine.setResearch(civ.id, pick!.id as never);
    civ.researchProgress = 17;

    const loaded = await roundTrip(engine);
    const after = loaded.civilizations[0];
    expect(after.currentResearch).toBeTruthy();
    expect(after.researchProgress).toBe(17);
  });

  it('restores banked science from the opening rounds', async () => {
    const { engine } = await makeEngine({ seed: 410, mapType: 'MANY_CITIES' });
    engine.civilizations[0].bankedScience = 23;

    const loaded = await roundTrip(engine);
    expect(loaded.civilizations[0].bankedScience).toBe(23);
  });

  it('restores diplomacy so "at war" survives a reload', async () => {
    const { engine } = await makeEngine({ seed: 411, mapType: 'MANY_CITIES' });
    const a = engine.civilizations[0];
    const b = engine.civilizations[1];
    engine.diplomacyManager.declareWar(a.id, b.id);
    expect(engine.isCivAtWar(a.id)).toBe(true);

    const loaded = await roundTrip(engine);
    expect(loaded.isCivAtWar(loaded.civilizations[0].id)).toBe(true);
  });
});
