import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { WATER_TERRAIN_TYPES } from '@/data/TerrainConstants';
import { UNIT_PROPS } from '@/utils/Constants';

/** Whether a unit type belongs in the water rather than on it. */
const isNaval = (type: string): boolean =>
  (UNIT_PROPS[type] as { naval?: boolean } | undefined)?.naval === true;

/**
 * Starting units must never be placed on water.
 *
 * The dry-land rule used to be written out at seven different sites and most
 * of them wrote only part of it: the start-position search checked the full
 * water list, `createStartingCities` checked `OCEAN` alone (so an inland lake
 * was fine), and `ALL_UNITS` — which lays its grid out two tiles apart —
 * checked only that the coordinates were inside the map. On a seed-4242
 * ALL_UNITS game that placed a carrier, a phalanx, a chariot and a submarine
 * on lakes, and the settler in the same grid could land on one too.
 *
 * These tests pin the invariant rather than any one call site, because the
 * failure was specifically that the rule lived in several places.
 */
describe('starting units are never placed on water', () => {
  const MAP_TYPES = [
    'NORMAL_SKIRMISH',
    'CLOSEUP_1V1',
    'TECH_LEVEL_10',
    'ALL_UNITS',
    'CLOSEUP_BEATUP',
    'NO_SETTLERS',
    'MANY_CITIES',
  ];

  async function startGame(mapType: string, seed: number): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType,
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
    } as any);
    return engine;
  }

  /**
   * Every unit or city standing on the wrong kind of terrain: a land unit in
   * the water, or a ship on land. A trireme on a lake is correct and is not a
   * stray — which is exactly the distinction the original code lacked.
   */
  function strays(engine: GameEngine): string[] {
    const found: string[] = [];
    const tileAt = (engine as any).getTileAt?.bind(engine);
    for (const unit of engine.units as any[]) {
      const type = String(tileAt?.(unit.col, unit.row)?.type ?? '').trim().toLowerCase();
      const onWater = WATER_TERRAIN_TYPES.includes(type);
      const wrong = isNaval(unit.type) ? !onWater : onWater;
      if (wrong) {
        found.push(`${unit.type} at (${unit.col},${unit.row}) on ${type}`);
      }
    }
    for (const city of engine.cities as any[]) {
      const type = String(tileAt?.(city.col, city.row)?.type ?? '').trim().toLowerCase();
      if (WATER_TERRAIN_TYPES.includes(type)) {
        found.push(`city ${city.name} at (${city.col},${city.row}) on ${type}`);
      }
    }
    return found;
  }

  it.each(MAP_TYPES)('%s never strands a unit or a city in water', async (mapType) => {
    // Several seeds: the bug was seed-dependent, so a single map that happens
    // to be dry proves nothing. ALL_UNITS is the case that regressed — its
    // two-tile grid walked over lakes.
    for (const seed of [4242, 101, 7, 99991]) {
      const engine = await startGame(mapType, seed);
      expect(strays(engine)).toEqual([]);
    }
  }, 240000);

  it('a settler is always on land in the standard game', async () => {
    for (const seed of [4242, 101, 7]) {
      const engine = await startGame('NORMAL_SKIRMISH', seed);
      const settlers = (engine.units as any[]).filter((u) => u.type === 'settler');
      // The standard scenario starts each civ with exactly one settler.
      expect(settlers.length).toBeGreaterThan(0);
      for (const settler of settlers) {
        const type = String((engine as any).getTileAt?.(settler.col, settler.row)?.type ?? '')
          .trim()
          .toLowerCase();
        expect(WATER_TERRAIN_TYPES).not.toContain(type);
      }
    }
  }, 120000);

  it('every starting unit sits on the right kind of terrain in ALL_UNITS', async () => {
    // ALL_UNITS lays one of every unit type out on a grid two tiles apart,
    // which is how a lake swallowed four of them.
    const engine = await startGame('ALL_UNITS', 4242);
    // One settler per civ: a missing one would mean the spawn dropped a unit
    // rather than moving it off the water.
    const settlers = (engine.units as any[]).filter((u) => u.type === 'settler');
    expect(settlers.length).toBe(engine.civilizations.length);
    expect(strays(engine)).toEqual([]);
  }, 120000);

  it('a starting city is never founded on an inland lake', async () => {
    // The city placement checked `OCEAN` but not `lake` or the legacy `sea`
    // alias, which is the same rule written out incompletely.
    for (const mapType of ['MANY_CITIES']) {
      for (const seed of [4242, 101]) {
        const engine = await startGame(mapType, seed);
        for (const city of engine.cities as any[]) {
          const type = String((engine as any).getTileAt?.(city.col, city.row)?.type ?? '')
            .trim()
            .toLowerCase();
          expect(WATER_TERRAIN_TYPES).not.toContain(type);
        }
      }
    }
  }, 120000);
});
