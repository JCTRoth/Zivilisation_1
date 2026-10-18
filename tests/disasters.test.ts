/**
 * The seven Civ1 city disasters — triggers, prevention, effects and the
 * tuned clock.
 *
 * Every roll is `Math.random`, so the suite drives it: `forceRandom(0)` makes
 * every roll land (the first eligible, unprevented disaster in
 * DISASTER_CHECK_ORDER strikes) and `forceRandom(0.999)` makes none. That
 * turns "is this rare enough?" into arithmetic on the exported constants and
 * keeps each effect test deterministic: terrain, techs and buildings decide
 * which disaster is even rolled, and the stub decides whether it lands.
 *
 * The user-facing promises these tests pin, beyond Civ1 fidelity:
 *  - disasters are far rarer than Civ1's own clock, and the flood — the one
 *    that pestered the player — is the rarest of the seven;
 *  - the losses are real (the manual's percentages raised a notch) but a
 *    disaster never razes a city and never touches a unit.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { City, Unit } from '../types/game';
import type GameEngine from '@/game/engine/GameEngine';
import {
  DISASTER_CHANCE_PER_CITY_TURN,
  DISASTER_CHECK_ORDER,
  DISASTER_POPULATION_SHARE,
  PIRATE_GOLD_FLOOR,
} from '@/game/engine/DisasterManager';
import { checkInvariants, makeEngine, makeGridEngine } from './helpers/world';

// ── Fixtures ───────────────────────────────────────────────────────────────

const SIZE = 8;
const CITY_COL = 3;
const CITY_ROW = 3;

/** An 8×8 grassland world with the named tiles overridden ("col,row"). */
function gridWith(overrides: Record<string, string> = {}): string[][] {
  const rows = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => 'grassland'),
  );
  for (const [key, terrain] of Object.entries(overrides)) {
    const [col, row] = key.split(',').map(Number);
    rows[row][col] = terrain;
  }
  return rows;
}

let cityCounter = 0;

/** A plain city fixture — the engine cities are plain objects, not the class. */
function putCity(engine: GameEngine, overrides: Partial<City> = {}): City {
  const city = {
    id: `disaster-city-${cityCounter++}`,
    name: 'Doomtown',
    civilizationId: 0,
    col: CITY_COL,
    row: CITY_ROW,
    population: 6,
    foodStored: 10,
    foodNeeded: 70,
    yields: { food: 2, production: 1, trade: 1 },
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    productionStored: 5,
    productionProgress: 5,
    carriedOverProgress: 0,
    specialists: [],
    workingTiles: new Set<string>([`${CITY_COL},${CITY_ROW}`]),
    userAssignedTiles: new Set<string>(),
    governor: 'balanced',
    tradeRoutes: [],
    isCapital: false,
    maxPopulation: 10,
    ...overrides,
  } as unknown as City;
  engine.cities.push(city);
  return city;
}

function grantTechs(engine: GameEngine, civId: number, ...techs: string[]): void {
  const civ = engine.civilizations[civId];
  (civ.technologies as string[]).push(...techs);
}

function captureEvents(
  engine: GameEngine,
): Array<{ type: string } & Record<string, unknown>> {
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  engine.onStateChange = (type, data) => events.push({ type, ...(data ?? {}) });
  return events;
}

/** Build an engine + city, install the "every roll lands" stub. */
function strikingEngine(
  overrides: Record<string, string> = {},
): { engine: GameEngine; city: City; techs: (...t: string[]) => void } {
  const engine = makeGridEngine(gridWith(overrides));
  const city = putCity(engine);
  const techs = (...t: string[]) => grantTechs(engine, 0, ...t);
  engine.disasterManager.random = () => 0;
  return { engine, city, techs };
}

const strike = (engine: GameEngine, city: City, civId = 0) =>
  engine.disasterManager.processCity(city, engine.civilizations[civId]);

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Triggers ───────────────────────────────────────────────────────────────

describe('DisasterManager triggers', () => {
  it('famine: size 2+, Pottery known, inland', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery');
    expect(strike(engine, city)?.kind).toBe('famine');
  });

  it('famine needs Pottery first', () => {
    const { engine, city } = strikingEngine();
    expect(strike(engine, city)).toBeNull();
  });

  it('flood: on or next to a river, Masonry known', () => {
    const { engine, city, techs } = strikingEngine({ '3,4': 'river' });
    techs('masonry');
    expect(strike(engine, city)?.kind).toBe('flood');
  });

  it('flood needs a river — Masonry alone does nothing', () => {
    const { engine, city, techs } = strikingEngine();
    techs('masonry');
    expect(strike(engine, city)).toBeNull();
  });

  it('fire: Construction known and something to burn', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction');
    city.buildings = ['granary'];
    expect(strike(engine, city)?.kind).toBe('fire');
  });

  it('plague: size 2+, Construction known (fire comes first when there is a building)', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction');
    expect(strike(engine, city)?.kind).toBe('plague');
  });

  it('pirates: a coastal city with something worth taking', () => {
    const { engine, city } = strikingEngine({ '3,4': 'ocean' });
    expect(strike(engine, city)?.kind).toBe('pirates');
  });

  it('pirates skip a broke city with empty stores', () => {
    const { engine, city } = strikingEngine({ '3,4': 'ocean' });
    city.foodStored = 0;
    city.productionStored = 0;
    engine.civilizations[0].resources.gold = 0;
    expect(strike(engine, city)).toBeNull();
  });

  it('volcano: a mountain next door, Ceremonial Burial known', () => {
    const { engine, city, techs } = strikingEngine({ '4,4': 'mountains' });
    techs('ceremonial_burial');
    expect(strike(engine, city)?.kind).toBe('volcano');
  });

  it('volcano needs the mountain', () => {
    const { engine, city, techs } = strikingEngine();
    techs('ceremonial_burial');
    expect(strike(engine, city)).toBeNull();
  });

  it('earthquake: a hill next door and a building to crack', () => {
    const { engine, city } = strikingEngine({ '2,4': 'hills' });
    city.buildings = ['granary'];
    expect(strike(engine, city)?.kind).toBe('earthquake');
  });

  it('earthquake skips a city with nothing to destroy', () => {
    const { engine, city } = strikingEngine({ '2,4': 'hills' });
    expect(strike(engine, city)).toBeNull();
  });

  it('every disaster needs an established city (size 2+)', () => {
    const { engine, city, techs } = strikingEngine({
      '3,4': 'river',
      '4,4': 'mountains',
      '2,4': 'hills',
    });
    techs('pottery', 'masonry', 'construction', 'ceremonial_burial');
    city.population = 1;
    city.buildings = ['granary'];
    expect(strike(engine, city)).toBeNull();
  });

  it('a made-up roll almost never lands', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery', 'masonry', 'construction', 'ceremonial_burial');
    city.buildings = ['barracks', 'temple'];
    engine.disasterManager.random = () => 0.9999;
    expect(strike(engine, city)).toBeNull();
  });

  it('rolls for AI cities too — the manager does not care who owns the city', () => {
    const { engine, city } = strikingEngine();
    grantTechs(engine, 1, 'pottery');
    city.civilizationId = 1;
    const result = engine.disasterManager.processCity(city, engine.civilizations[1]);
    expect(result?.kind).toBe('famine');
  });

  it('barbarian camps are outside the disaster system', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery');
    city.civilizationId = -1;
    expect(strike(engine, city)).toBeNull();
  });

  it('at most one disaster per city per turn', () => {
    // Everything is eligible: coast, river, mountain, hills, buildings and all
    // four tech gates. Famine is first in DISASTER_CHECK_ORDER, so it is the
    // one that lands — and nothing else follows it in the same turn.
    const { engine, city, techs } = strikingEngine({
      '3,4': 'river',
      '4,3': 'ocean',
      '4,4': 'mountains',
      '2,4': 'hills',
    });
    techs('pottery', 'masonry', 'construction', 'ceremonial_burial');
    city.buildings = ['barracks', 'temple', 'city_walls', 'aqueduct'];
    const events = captureEvents(engine);

    const result = strike(engine, city);
    expect(result?.kind).toBe('famine');
    expect(events.filter((e) => e.type === 'CITY_DISASTER')).toHaveLength(1);
  });
});

// ── Prevention ─────────────────────────────────────────────────────────────

describe('DisasterManager prevention', () => {
  it('Granary turns famine away', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery');
    city.buildings = ['granary'];
    expect(strike(engine, city)).toBeNull();
  });

  it('City Walls turn the flood away', () => {
    const { engine, city, techs } = strikingEngine({ '3,4': 'river' });
    techs('masonry');
    city.buildings = ['city_walls'];
    expect(strike(engine, city)).toBeNull();
  });

  it('Aqueduct turns both fire and plague away', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction');
    city.buildings = ['granary', 'aqueduct'];
    // Fire first: prevented by the Aqueduct. Then plague: prevented by it too.
    expect(strike(engine, city)).toBeNull();
  });

  it('Medicine lifts the plague — without an Aqueduct', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction', 'medicine');
    expect(strike(engine, city)).toBeNull();
  });

  it('Barracks keep the pirates out', () => {
    const { engine, city } = strikingEngine({ '3,4': 'ocean' });
    city.buildings = ['barracks'];
    expect(strike(engine, city)).toBeNull();
  });

  it('Temple keeps the volcano quiet', () => {
    const { engine, city, techs } = strikingEngine({ '4,4': 'mountains' });
    techs('ceremonial_burial');
    city.buildings = ['temple'];
    expect(strike(engine, city)).toBeNull();
  });

  it('nothing prevents an earthquake — not even its own rubble', () => {
    const { engine, city } = strikingEngine({ '2,4': 'hills' });
    city.buildings = ['granary', 'temple', 'city_walls', 'aqueduct'];
    expect(strike(engine, city)?.kind).toBe('earthquake');
  });
});

// ── Effects ────────────────────────────────────────────────────────────────

describe('DisasterManager effects', () => {
  it('famine kills 40% and empties the stores', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery');
    city.population = 10;
    const events = captureEvents(engine);

    const result = strike(engine, city);
    expect(result?.kind).toBe('famine');
    expect(result?.lostPopulation).toBe(4);
    expect(city.population).toBe(6);
    expect(city.foodStored).toBe(0);
    expect(city.foodNeeded).toBe(70); // (6 + 1) × 10
    expect(events[0]).toMatchObject({
      type: 'CITY_DISASTER',
      civilizationId: 0,
      kind: 'famine',
      lostPopulation: 4,
      destroyedBuilding: null,
      goldStolen: 0,
    });
  });

  it('flood drowns a third of the city', () => {
    const { engine, city, techs } = strikingEngine({ '3,4': 'river' });
    techs('masonry');
    city.population = 9;

    expect(strike(engine, city)?.lostPopulation).toBe(2); // floor(9 × 0.33)
    expect(city.population).toBe(7);
  });

  it('plague takes a third', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction');
    city.population = 6;

    expect(strike(engine, city)?.lostPopulation).toBe(1); // floor(6 × 0.33)
    expect(city.population).toBe(5);
  });

  it('fire burns one building — never the Palace, never a Wonder', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction');
    city.buildings = ['palace', 'pyramids', 'granary'];

    const result = strike(engine, city);
    expect(result?.kind).toBe('fire');
    expect(result?.destroyedBuilding).toBe('granary');
    expect(city.buildings).toEqual(['palace', 'pyramids']);
  });

  it('fire passes a city that holds only the Palace', () => {
    const { engine, city, techs } = strikingEngine();
    techs('construction', 'medicine'); // plague is prevented, so nothing else fires
    city.buildings = ['palace'];
    expect(strike(engine, city)).toBeNull();
  });

  it('pirates rob the treasury and wipe the food AND shield stocks', () => {
    const { engine, city } = strikingEngine({ '3,4': 'ocean' });
    city.foodStored = 13;
    city.productionStored = 7;
    city.productionProgress = 7;
    city.carriedOverProgress = 4;
    engine.civilizations[0].resources.gold = 100;

    const result = strike(engine, city);
    expect(result?.kind).toBe('pirates');
    expect(result?.goldStolen).toBe(20); // max(10%, 20)
    expect(engine.civilizations[0].resources.gold).toBe(80);
    expect(city.foodStored).toBe(0);
    expect(city.productionStored).toBe(0);
    expect(city.productionProgress).toBe(0);
    expect(city.carriedOverProgress).toBe(0);
  });

  it('pirates take the whole till when it is smaller than the floor', () => {
    const { engine, city } = strikingEngine({ '3,4': 'ocean' });
    engine.civilizations[0].resources.gold = 5;

    const result = strike(engine, city);
    expect(result?.goldStolen).toBe(5);
    expect(engine.civilizations[0].resources.gold).toBe(0);
  });

  it('the volcano kills and burns', () => {
    const { engine, city, techs } = strikingEngine({ '4,4': 'mountains' });
    techs('ceremonial_burial');
    city.population = 10;
    // A marketplace prevents nothing (only a Temple does), so the eruption
    // lands — and takes the market with it.
    city.buildings = ['granary', 'marketplace'];

    const result = strike(engine, city);
    expect(result?.kind).toBe('volcano');
    expect(result?.lostPopulation).toBe(4);
    expect(city.population).toBe(6);
    expect(result?.destroyedBuilding).toBe('granary');
    expect(city.buildings).toEqual(['marketplace']);
  });

  it('an eruption with nothing to burn still kills', () => {
    const { engine, city, techs } = strikingEngine({ '4,4': 'mountains' });
    techs('ceremonial_burial');
    city.population = 6;

    const result = strike(engine, city);
    expect(result?.kind).toBe('volcano');
    expect(result?.lostPopulation).toBe(2); // floor(6 × 0.4)
    expect(result?.destroyedBuilding).toBeNull();
  });

  it('earthquake cracks one building and spills no blood', () => {
    const { engine, city } = strikingEngine({ '2,4': 'hills' });
    city.buildings = ['granary'];
    city.population = 6;

    const result = strike(engine, city);
    expect(result?.kind).toBe('earthquake');
    expect(result?.destroyedBuilding).toBe('granary');
    expect(city.population).toBe(6);
    expect(city.buildings).toEqual([]);
  });

  it('a disaster never removes the last citizen', () => {
    const { engine, city, techs } = strikingEngine();
    techs('pottery');
    city.population = 2;

    expect(strike(engine, city)?.lostPopulation).toBe(1);
    expect(city.population).toBe(1);
  });

  it('never touches military units — floods included', () => {
    // The player's complaint about Civ1 disasters was exactly this: armies
    // standing in a city got swept away by events they could not dodge. No
    // disaster in this manager has a code path to a unit.
    const { engine, city, techs } = strikingEngine({ '3,4': 'river' });
    techs('masonry', 'construction');
    city.buildings = ['granary'];
    const unit = {
      id: 'legion-1',
      type: 'legion',
      civilizationId: 0,
      col: CITY_COL,
      row: CITY_ROW,
      health: 100,
      isDefeated: false,
    } as unknown as Unit;
    engine.units.push(unit);

    const result = strike(engine, city);
    expect(result?.kind).toBe('flood');
    expect(unit.health).toBe(100);
    expect(unit.isDefeated).toBe(false);
    expect(engine.units).toContain(unit);
  });
});

// ── The tuned clock ────────────────────────────────────────────────────────

describe('DisasterManager frequency', () => {
  it('every disaster has a real, tiny chance', () => {
    for (const kind of DISASTER_CHECK_ORDER) {
      expect(DISASTER_CHANCE_PER_CITY_TURN[kind], kind).toBeGreaterThan(0);
      expect(DISASTER_CHANCE_PER_CITY_TURN[kind], kind).toBeLessThan(0.005);
    }
  });

  it('the flood is the rarest of the seven', () => {
    const flood = DISASTER_CHANCE_PER_CITY_TURN.flood;
    for (const kind of DISASTER_CHECK_ORDER) {
      expect(flood, kind).toBeLessThanOrEqual(DISASTER_CHANCE_PER_CITY_TURN[kind]);
    }
  });

  it('the sum stays under half a percent per city per turn', () => {
    const total = DISASTER_CHECK_ORDER.reduce(
      (sum, kind) => sum + DISASTER_CHANCE_PER_CITY_TURN[kind],
      0,
    );
    expect(total).toBeLessThan(0.005);
  });

  it('population losses sit a notch above the manual', () => {
    // Civ1: famine 33%, flood/plague 25%, volcano 33%. "Less frequent, hits a
    // little harder" raised each one.
    expect(DISASTER_POPULATION_SHARE.famine).toBeGreaterThan(0.33);
    expect(DISASTER_POPULATION_SHARE.flood).toBeGreaterThan(0.25);
    expect(DISASTER_POPULATION_SHARE.plague).toBeGreaterThan(0.25);
    expect(DISASTER_POPULATION_SHARE.volcano).toBeGreaterThan(0.33);
  });

  it('the pirate floor is a real loss, not pocket change', () => {
    expect(PIRATE_GOLD_FLOOR).toBeGreaterThanOrEqual(20);
  });
});

// ── The real pipeline ──────────────────────────────────────────────────────

describe('DisasterManager in the turn pipeline', () => {
  it('strikes a settled city during real turn processing and keeps the world valid', async () => {
    const testWorld = await makeEngine({ seed: 4711 });
    const { engine } = testWorld;
    const civ = engine.civilizations[0];
    (civ.technologies as string[]).push('pottery');
    const spot = testWorld.landNear(10, 10);
    const city = testWorld.settle('Doomtown', spot.col, spot.row, 0, 2);

    const events = captureEvents(engine);
    engine.disasterManager.random = () => 0; // every disaster roll lands: famine (pottery, size 2) fires

    await testWorld.runTurns(2);

    const mine = events.filter(
      (event) => event.type === 'CITY_DISASTER' && event.civilizationId === 0,
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((event) => event.kind === 'famine')).toBe(true);
    expect(city.population).toBeGreaterThanOrEqual(1);
    expect(checkInvariants(engine)).toEqual([]);
  });
});
