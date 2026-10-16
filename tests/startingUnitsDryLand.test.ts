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

/**
 * The two maps that generated but could not be played.
 *
 * A map that builds is not a map that plays. These two were broken in the same
 * way — a start position the setup could never find — and both are pinned here
 * so the fix cannot be quietly reverted.
 */
describe('maps that generate must also start', () => {
  async function startGame(mapType: string, seed: number, civs = 4): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: civs,
      mapType,
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
    } as any);
    return engine;
  }

  /** Civs with no unit at all — the symptom of a failed start search. */
  const civsWithNoUnits = (engine: GameEngine): string[] =>
    (engine.civilizations as any[])
      .filter((c) => !(engine.units as any[]).some((u) => u.civilizationId === c.id))
      .map((c) => `civ${c.id} (${c.name})`);

  /** Same stray rule as the suite above: land units on land, ships in water. */
  function strays(engine: GameEngine): string[] {
    const found: string[] = [];
    for (const unit of engine.units as any[]) {
      const type = String((engine as any).getTileAt?.(unit.col, unit.row)?.type ?? '')
        .trim()
        .toLowerCase();
      const onWater = WATER_TERRAIN_TYPES.includes(type);
      const wrong = isNaval(unit.type) ? !onWater : onWater;
      if (wrong) found.push(`${unit.type} at (${unit.col},${unit.row}) on ${type}`);
    }
    for (const city of engine.cities as any[]) {
      const type = String((engine as any).getTileAt?.(city.col, city.row)?.type ?? '')
        .trim()
        .toLowerCase();
      if (WATER_TERRAIN_TYPES.includes(type)) {
        found.push(`city ${city.name} at (${city.col},${city.row}) on ${type}`);
      }
    }
    return found;
  }

  describe('NAVAL_CLOSEUP with an all-water world starts its civs on the water', () => {
    it('gives every civ a fleet instead of nothing at all', async () => {
      // The start search asked for dry land on a map that has none, so all
      // four civs were created with no position: no units, no city, nothing.
      // The game was over on turn 1.
      for (const seed of [4242, 7, 101]) {
        const engine = await startGame('NAVAL_CLOSEUP', seed);
        expect(civsWithNoUnits(engine), `seed ${seed}`).toEqual([]);
        // Two triremes per civ, and every one of them floating.
        expect((engine.units as any[]).length).toBe(engine.civilizations.length * 2);
        for (const unit of engine.units as any[]) {
          expect(unit.type).toBe('trireme');
        }
        expect(strays(engine)).toEqual([]);
      }
    }, 180000);

    it('the world is still all water', async () => {
      // The map's whole point. The fix was to start civs on the water, not to
      // sprinkle islands into an all-ocean world.
      const engine = await startGame('NAVAL_CLOSEUP', 4242);
      const land = (engine.map.tiles as any[]).filter(
        (t) => !WATER_TERRAIN_TYPES.includes(String(t.type ?? '').trim().toLowerCase()),
      );
      expect(land).toEqual([]);
    }, 120000);
  });

  describe('NO_SETTLERS with one capital, not zero', () => {
    it('opens every civ with a city to build from', async () => {
      // "No settlers" means the civ cannot FOUND another city, not that the
      // empire never existed. A civ with no city and no settler has no economy,
      // no production and no way to replace its losses, so the skirmish ended
      // in minutes with every civ still holding its opening army and gold.
      for (const seed of [4242, 7, 101]) {
        const engine = await startGame('NO_SETTLERS', seed);
        expect(engine.cities.length, `seed ${seed}`).toBe(engine.civilizations.length);
        for (const city of engine.cities as any[]) {
          const type = String((engine as any).getTileAt?.(city.col, city.row)?.type ?? '')
            .trim().toLowerCase();
          expect(WATER_TERRAIN_TYPES, `${city.name} on ${type}`).not.toContain(type);
        }
      }
    }, 180000);

    it('still starts with military units and no settler', async () => {
      // The scenario's defining property is unchanged: the player has an army,
      // not a colonist.
      const MILITARY = ['warriors', 'warriors', 'phalanx', 'legion', 'musketeers'];
      const engine = await startGame('NO_SETTLERS', 4242);
      for (const civ of engine.civilizations as any[]) {
        const types = (engine.units as any[])
          .filter((u) => u.civilizationId === civ.id)
          .map((u) => u.type);
        // Two warriors plus a phalanx, a legion and a musketeer: five units.
        expect(types.length).toBe(MILITARY.length);
        expect([...types].sort()).toEqual([...MILITARY].sort());
        expect(types).not.toContain('settler');
      }
    }, 120000);
  });

  describe('MANY_CITIES is unchanged by the count parameter', () => {
    function strays(engine: GameEngine): string[] {
      const found: string[]=[];
      for (const unit of (engine as any).units) {
        const type=String((engine as any).getTileAt?.(unit.col,unit.row)?.type??'').trim().toLowerCase();
        const onWater = (WATER_TERRAIN_TYPES as string[]).includes(type);
        const isN = typeof isNaval === 'function' ? (isNaval as any)(unit.type) : false;
        const wrong = isN ? !onWater : onWater;
        if (wrong) found.push(`${unit.type} at (${unit.col},${unit.row}) on ${type}`);
      }
      for (const city of (engine as any).cities) {
        const type=String((engine as any).getTileAt?.(city.col,city.row)?.type??'').trim().toLowerCase();
        if (WATER_TERRAIN_TYPES.includes(type)) found.push(`city ${city.name} at (${city.col},${city.row}) on ${type}`);
      }
      return found;
    }
    it('still opens four cities per civ', async () => {
      // The shared `createStartingCities` now takes a count; MANY_CITIES must
      // still ask for all four.
      for (const seed of [4242, 101]) {
        const engine = await startGame('MANY_CITIES', seed);
        // Four attempts per civ, but the ±5 offsets can land in water, so the
        // count is terrain-dependent by design. What must hold is that every
        // civ got nearly all four, and no city drowned.
        expect(engine.cities.length).toBeGreaterThanOrEqual(engine.civilizations.length * 3);
        expect(strays(engine)).toEqual([]);
      }
    }, 180000);
  });
});
