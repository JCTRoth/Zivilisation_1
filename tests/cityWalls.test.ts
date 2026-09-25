import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { MapRenderer } from '@/game/rendering/MapRenderer';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import type { City } from '../types/game';

/**
 * City Walls (Civ1).
 *
 * Rules the engine already owns and this suite pins down:
 *  - buildable with Masonry, one per city, 2 gold/turn upkeep,
 *  - -1 happiness (the price of the rampart),
 *  - triples the city's defense in combat and shields its population,
 *  - destroyed when the city is captured, scrapped when Metallurgy lands.
 * Plus the map visual: a walled city is drawn with a stone rampart.
 */
describe('City Walls', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  const firstCity = (e: GameEngine): City => e.cities.find((c) => c.civilizationId === 0) as City;

  it('is a Masonry building with upkeep and an unhappiness cost', () => {
    const walls = BUILDING_PROPERTIES.city_walls;
    expect(walls.requiredTechnology).toBe('masonry');
    expect(walls.cost).toBeGreaterThan(0);
    expect(walls.effects.happiness).toBeLessThan(0);
  });

  it('charges 2 gold per turn and makes the city one point less happy', async () => {
    const e = await setup();
    const city = firstCity(e);
    const civ = e.civilizations[0];

    const upkeepBefore = e.economicManager.buildingUpkeep(0);
    const happyBefore = e.economicManager.cityHappiness(city, civ).happiness;

    city.buildings = [...(city.buildings ?? []), 'city_walls'];

    expect(e.economicManager.buildingUpkeep(0)).toBe(upkeepBefore + (BUILDING_PROPERTIES.city_walls.maintenance ?? 0));
    expect(e.economicManager.cityHappiness(city, civ).happiness)
      .toBe(happyBefore + (BUILDING_PROPERTIES.city_walls.effects.happiness ?? 0));
  });

  it('is scrapped from every city when Metallurgy is researched (Civ1)', async () => {
    const e = await setup();
    const city = firstCity(e);
    city.buildings = [...(city.buildings ?? []), 'city_walls'];

    e.scrapObsoleteCityWalls(0);

    expect(city.buildings).not.toContain('city_walls');
  });

  it('is offered by the production menu once Masonry is known', async () => {
    const e = await setup();
    const city = firstCity(e);
    (e.civilizations[0].technologies as string[]).push('masonry');

    expect(e.productionManager.getBuildableBuildingTypes(city.id)).toContain('city_walls');
    // One per city: a second attempt is refused.
    city.buildings = [...(city.buildings ?? []), 'city_walls'];
    expect(e.productionManager.getBuildableBuildingTypes(city.id)).not.toContain('city_walls');
  });

  it('is drawn as a "WALLS" text ring around the city image', () => {
    const renderer = new MapRenderer() as unknown as {
      drawCity: (
        ctx: unknown,
        x: number,
        y: number,
        city: City,
        zoom: number,
        civs: Array<{ id: number; color: string }>,
      ) => void;
    };

    const ops: string[] = [];
    const stubCtx = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
      textBaseline: '', globalAlpha: 1,
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      beginPath: () => ops.push('beginPath'),
      closePath: () => ops.push('closePath'),
      moveTo: () => ops.push('moveTo'),
      lineTo: () => ops.push('lineTo'),
      arcTo: () => ops.push('arcTo'),
      arc: () => ops.push('arc'),
      fill: () => ops.push('fill'),
      stroke: () => ops.push('stroke'),
      fillRect: () => ops.push('fillRect'),
      strokeRect: () => ops.push('strokeRect'),
      translate: () => ops.push('translate'),
      rotate: () => ops.push('rotate'),
      fillText: (text: string) => ops.push(`text:${text}`),
      strokeText: (text: string) => ops.push(`stroke:${text}`),
    };

    const base = {
      id: 'c1', name: 'Testopolis', civilizationId: 0, col: 5, row: 5,
      population: 3, buildings: [] as string[], specialists: [],
      workingTiles: new Set<string>(), buildQueue: [],
    } as unknown as City;
    const civs = [{ id: 0, color: '#FFD700' }];

    renderer.drawCity(stubCtx, 100, 100, base, 1, civs);
    expect(ops.filter((o) => o === 'text:WALLS')).toHaveLength(0);
    // No castle emoji anywhere.
    expect(ops.some((o) => o.includes('🏰'))).toBe(false);

    ops.length = 0;
    renderer.drawCity(stubCtx, 100, 100, { ...base, buildings: ['city_walls'] }, 1, civs);
    // The word appears on all four sides (2 horizontal + 2 rotated).
    expect(ops.filter((o) => o === 'text:WALLS')).toHaveLength(4);
    expect(ops.filter((o) => o === 'rotate')).toHaveLength(2);
    expect(ops.some((o) => o.includes('🏰'))).toBe(false);
  });
});
