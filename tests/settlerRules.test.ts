import { afterEach, describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

describe('Civ1 settler rules', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    e.isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  function city(population: number) {
    return {
      id: 'city_rules',
      name: 'Rules City',
      civilizationId: 0,
      col: 1,
      row: 1,
      population,
      food: 0,
      gold: 0,
      science: 0,
      foodStored: 0,
      foodNeeded: population * 20,
      production: 1,
      productionStored: 0,
      yields: { food: 2, production: 1, trade: 0 },
      hitPoints: population,
      buildings: [],
    };
  }

  it('uses the original settler statistics and no technology prerequisite', () => {
    expect(UNIT_PROPERTIES.settler).toMatchObject({
      attack: 0,
      defense: 1,
      movement: 1,
      hitPoints: 2,
      cost: 40,
    });
    expect(UNIT_PROPERTIES.settler.requires).toBeUndefined();
  });

  it('consumes one population when a settler completes in a larger city', async () => {
    const e = await setup();
    const c = city(3);
    (e as any).cities = [c];
    (e as any).units = [];

    const destroyed = (e.roundManager as any).createProducedUnit(c, 'settler');

    expect(destroyed).toBe(false);
    expect(c.population).toBe(2);
    expect((e as any).units[0]).toMatchObject({
      type: 'settler',
      defense: 1,
      hitPoints: 2,
      homeCityId: c.id,
      foodSupport: 1,
      shieldSupport: 1,
    });
  });

  it('destroys a size-1 city and releases the settler as NONE', async () => {
    const e = await setup();
    const c = city(1);
    (e as any).cities = [c];
    (e as any).units = [];
    (e as any).gameSettings.difficulty = 'PRINCE';

    const destroyed = (e.roundManager as any).createProducedUnit(c, 'settler');

    expect(destroyed).toBe(true);
    expect((e as any).cities).toHaveLength(0);
    expect((e as any).units[0]).toMatchObject({
      type: 'settler',
      homeCityId: null,
      isNoneUnit: true,
      foodSupport: 0,
      shieldSupport: 0,
    });
  });

  it('keeps a size-1 city on Chieftain when it completes a settler', async () => {
    const e = await setup();
    const c = city(1);
    (e as any).cities = [c];
    (e as any).units = [];
    (e as any).gameSettings.difficulty = 'CHIEFTAIN';

    const destroyed = (e.roundManager as any).createProducedUnit(c, 'settler');

    expect(destroyed).toBe(false);
    expect((e as any).cities).toHaveLength(1);
    expect(c.population).toBe(1);
    expect((e as any).units[0].homeCityId).toBe(c.id);
  });

  it('joins a friendly city up to population 10', async () => {
    const e = await setup();
    const c = city(4);
    const settler = {
      id: 'joiner',
      type: 'settler',
      civilizationId: 0,
      col: c.col,
      row: c.row,
      movesRemaining: 1,
      health: 100,
      homeCityId: c.id,
    };
    (e as any).cities = [c];
    (e as any).units = [settler];

    expect(e.canJoinCity(settler.id)).toBe(true);
    expect(e.foundCityWithSettler(settler.id)).toBe(true);
    expect(c.population).toBe(5);
    expect((e as any).units).toHaveLength(0);
  });

  it('blocks settlers from entering ocean tiles and consumes one food for support', async () => {
    const e = await setup();
    const c = city(1);
    const settler = {
      id: 'worker',
      type: 'settler',
      civilizationId: 0,
      col: c.col,
      row: c.row,
      movesRemaining: 1,
      health: 100,
      homeCityId: c.id,
    };
    (e as any).cities = [c];
    (e as any).units = [settler];

    const neighbor = e.squareGrid!.getNeighbors(c.col, c.row)[0];
    const water = e.getTileAt(neighbor.col, neighbor.row) as any;
    water.type = TERRAIN_TYPES.OCEAN;
    water.terrain = TERRAIN_TYPES.OCEAN;
    expect(e.canUnitMoveTo(settler.id, neighbor.col, neighbor.row)).toBe(false);

    (e.roundManager as any).processCityGrowth(c);
    // The city's 2 food is consumed by its citizen and the supported settler.
    expect(c.foodStored).toBe(0);
  });

  it('blocks land units from entering water tiles even when the tile uses terrain and uppercase ocean naming', async () => {
    const e = await setup();
    const c = city(1);
    const warrior = {
      id: 'warrior',
      type: 'warrior',
      civilizationId: 0,
      col: c.col,
      row: c.row,
      movesRemaining: 2,
      health: 100,
      homeCityId: c.id,
    };
    (e as any).cities = [c];
    (e as any).units = [warrior];

    const neighbor = e.squareGrid!.getNeighbors(c.col, c.row)[0];
    const water = e.getTileAt(neighbor.col, neighbor.row) as any;
    water.type = undefined;
    water.terrain = 'OCEAN';

    expect(e.canUnitMoveTo(warrior.id, neighbor.col, neighbor.row)).toBe(false);
    expect(e.moveUnit(warrior.id, neighbor.col, neighbor.row).success).toBe(false);
  });
});
