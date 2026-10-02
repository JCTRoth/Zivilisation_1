/**
 * BuildingAnalyzer — which buildings are worth keeping, and the rebuy cooldown.
 *
 * The analyzer scores each building against its city's situation and returns
 * the worst few as sell candidates. These tests lock in the rules that decide
 * a sale:
 *  - a building is only sold when it is genuinely not earning its keep;
 *  - a threatened city keeps its defenses, an unhappy city its happiness
 *    buildings, and a coastal city its harbor (an inland harbor is dead weight);
 *  - the Palace and Wonders are never sold;
 *  - a just-sold building cannot be rebuilt immediately (the cooldown that stops
 *    build → sell → build churn).
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeCityBuildings,
  buildingOnRebuyCooldown,
  rememberBuildingSale,
  BUILDING_REBUY_COOLDOWN_ROUNDS,
  type CityBuildingReport,
} from '@/game/engine/AI/BuildingAnalyzer';
import type { ArmyGroup } from '@/game/engine/AI/AITypes';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import type { City, Civilization, MapState, Unit } from '../types/game';

const G = TERRAIN_TYPES.GRASSLAND;
const O = TERRAIN_TYPES.OCEAN;

const WIDTH = 24;
const HEIGHT = 24;

/** A blank grassland map, optionally with a single ocean tile. */
function makeMap(ocean?: { col: number; row: number }): MapState {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
    const col = i % WIDTH;
    const row = Math.floor(i / WIDTH);
    const isOcean = !!ocean && ocean.col === col && ocean.row === row;
    const terrain = isOcean ? O : G;
    return { col, row, terrain, type: terrain, visible: true, explored: true };
  });
  return { width: WIDTH, height: HEIGHT, tiles };
}

function makeCiv(overrides: Partial<Civilization> = {}): Civilization {
  return {
    id: 0,
    name: 'Auditians',
    isHuman: false,
    isAI: true,
    technologies: [],
    resources: { gold: 200, food: 0, production: 0, trade: 0, science: 0 },
    warWith: new Set<number>(),
    ...overrides,
  } as unknown as Civilization;
}

function makeCity(id: string, buildings: string[], overrides: Partial<City> = {}): City {
  return {
    id,
    name: id,
    civilizationId: 0,
    col: 12,
    row: 12,
    population: 6,
    production: 0,
    food: 0,
    gold: 0,
    science: 0,
    buildings,
    specialists: [],
    yields: { food: 6, production: 4, trade: 4 },
    // A comfortably content city by default. Without this the analyzer reads
    // happiness 0 / unhappiness 0 as "on the edge of disorder", which makes
    // every happiness building look load-bearing and hides every dormant one.
    happiness: 6,
    unhappiness: 1,
    tax: 2,
    ...overrides,
  } as unknown as City;
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'enemy',
    type: 'warrior',
    civilizationId: 1,
    col: 13,
    row: 12,
    attack: 2,
    defense: 1,
    isDefeated: false,
    ...overrides,
  } as unknown as Unit;
}

const analyze = (
  city: City,
  overrides: {
    civ?: Civilization;
    units?: Unit[];
    cities?: City[];
    map?: MapState;
    armyGroups?: ArmyGroup[];
  } = {},
): CityBuildingReport =>
  analyzeCityBuildings(
    city,
    overrides.civ ?? makeCiv(),
    overrides.units ?? [],
    overrides.cities ?? [city],
    overrides.map ?? makeMap(),
    overrides.armyGroups ?? [],
  );

/**
 * The report exposes only the buildings worth selling, so a building's effect
 * is observed by whether it lands in that list (and why).
 */
const isCandidate = (report: CityBuildingReport, buildingType: string): boolean =>
  report.sellCandidates.some((c) => c.buildingType === buildingType);

const reasonsFor = (report: CityBuildingReport, buildingType: string): string =>
  report.sellCandidates.find((c) => c.buildingType === buildingType)?.reasons?.join(' ') ?? '';

describe('analyzeCityBuildings — sell candidates', () => {
  it('does not recommend selling a plain, well-matched city', () => {
    const report = analyze(makeCity('town', ['temple', 'granary', 'marketplace']));
    expect(report.sellCandidates).toEqual([]);
    expect(report.totalBuildings).toBe(3);
  });

  it('vetoes a redundant bank that still pays for itself', () => {
    // Structurally this is the worst building in the city — duplicated AND
    // missing its marketplace. But a Bank's +2 trade is worth 2 gold/turn at
    // 50% tax against 1 upkeep, so the cost/usage equation says keep it. Both
    // verdicts must agree before anything is sold, and the money wins here.
    const report = analyze(makeCity('banking', ['bank', 'bank']));
    expect(reasonsFor(report, 'bank')).toBe('');
    expect(isCandidate(report, 'bank')).toBe(false);
    expect(report.economics.find(e => e.buildingType === 'bank')!.netPerTurn).toBeGreaterThan(0);
  });

  it('keeps a lone bank that has its marketplace', () => {
    expect(isCandidate(analyze(makeCity('one', ['bank', 'marketplace'])), 'bank')).toBe(false);
    // Even a redundant one survives when its prerequisite is present.
    expect(isCandidate(analyze(makeCity('two', ['bank', 'bank', 'marketplace'])), 'bank')).toBe(false);
  });

  it('vetoes a redundant university that still pays for itself', () => {
    // +2 science is a flat beaker bonus the engine credits regardless of the
    // missing library, so the money says keep it even though the structure
    // says the prerequisite is missing.
    const report = analyze(makeCity('college', ['university', 'university']));
    expect(isCandidate(report, 'university')).toBe(false);
  });

  it('sells a duplicated building that does not pay for itself', () => {
    // A redundant Colosseum: no one is unhappy, so its happiness is dormant and
    // its upkeep is pure loss. Structure and money now agree.
    const report = analyze(makeCity('twice', ['colosseum', 'colosseum'], {
      happiness: 14, unhappiness: 1,
    } as never));
    expect(isCandidate(report, 'colosseum')).toBe(true);
    expect(reasonsFor(report, 'colosseum')).toMatch(/redundant/);
    expect(report.economics.find(e => e.buildingType === 'colosseum')!.netPerTurn)
      .toBeLessThan(0);
  });

  it('sells a building the engine does nothing with at all', () => {
    // A Factory declares +2 production, which nothing in the engine reads.
    const report = analyze(makeCity('industry', ['factory']));
    expect(isCandidate(report, 'factory')).toBe(true);
    const economics = report.economics.find(e => e.buildingType === 'factory')!;
    expect(economics.verdict).toBe('inert');
    expect(economics.incomePerTurn).toBe(0);
  });

  it('caps the recommendations per city', () => {
    const lonely = ['bank', 'university', 'cathedral', 'aqueduct'].map((b) => [b]);
    const report = analyze(makeCity('broken', lonely.flat()));
    expect(report.sellCandidates.length).toBeLessThanOrEqual(3);
  });

  it('treats a second copy of a building as redundant', () => {
    // One temple is worth keeping; two of them in one city is not.
    expect(isCandidate(analyze(makeCity('one', ['temple'])), 'temple')).toBe(false);
    expect(isCandidate(analyze(makeCity('two', ['temple', 'temple'])), 'temple')).toBe(true);
    expect(reasonsFor(analyze(makeCity('two', ['temple', 'temple'])), 'temple')).toMatch(/redundant/);
  });

  it('never sells the Palace or a Wonder', () => {
    const report = analyze(makeCity('capital', ['palace', 'pyramids', 'bank']));
    expect(report.sellCandidates.map((c) => c.buildingType)).not.toContain('palace');
    expect(report.sellCandidates.map((c) => c.buildingType)).not.toContain('pyramids');
  });
});

describe('analyzeCityBuildings — situation matters', () => {
  it('sells an inland harbor and keeps a coastal one', () => {
    const inland = analyze(makeCity('inland', ['harbor']), { map: makeMap() });
    expect(isCandidate(inland, 'harbor')).toBe(true);
    expect(reasonsFor(inland, 'harbor')).toMatch(/inland/);

    const coastal = analyze(makeCity('port', ['harbor']), { map: makeMap({ col: 13, row: 12 }) });
    expect(isCandidate(coastal, 'harbor')).toBe(false);
  });

  it('keeps a happiness building in an unhappy city', () => {
    // The duplicate makes the temple a candidate in the calm city; an unhappy
    // city is exactly when the second one earns its keep.
    const calm = analyze(makeCity('calm', ['temple', 'temple']));
    expect(isCandidate(calm, 'temple')).toBe(true);

    const grim = analyze(makeCity('grim', ['temple', 'temple'], {
      happiness: 1, unhappiness: 9,
    } as never));
    expect(isCandidate(grim, 'temple')).toBe(false);
  });

  it('keeps defensive buildings when the city is threatened', () => {
    const calm = analyze(makeCity('calm', ['barracks', 'barracks']));
    expect(isCandidate(calm, 'barracks')).toBe(true);

    const front = analyze(makeCity('front', ['barracks', 'barracks']), {
      units: [makeUnit({ col: 13, row: 12 })],
    });
    expect(isCandidate(front, 'barracks')).toBe(false);
  });

  it('treats a nearby enemy city as a threat', () => {
    const city = makeCity('town', ['barracks', 'barracks']);
    const calm = analyze(city);
    const besieged = analyze(city, {
      cities: [city, makeCity('enemy-town', [], { civilizationId: 1, col: 15, row: 12 })],
    });
    expect(isCandidate(calm, 'barracks')).toBe(true);
    expect(isCandidate(besieged, 'barracks')).toBe(false);
  });

  it('treats an enemy army group aimed at the city as a threat', () => {
    const city = makeCity('town', ['barracks', 'barracks']);
    const group = {
      id: 'g', unitIds: ['a'], targetLocation: { col: 12, row: 12 },
      rallyPoint: { col: 12, row: 12 }, status: 'marching',
      requiredStrength: 5, currentStrength: 5,
    } as unknown as ArmyGroup;
    expect(isCandidate(analyze(city), 'barracks')).toBe(true);
    expect(isCandidate(analyze(city, { armyGroups: [group] }), 'barracks')).toBe(false);
  });

  it('devalues barracks against a gunpowder field', () => {
    const city = makeCity('town', ['barracks']);
    const modern = analyze(city, {
      units: [makeUnit({ id: 'gun', type: 'artillery', civilizationId: 0, col: 1, row: 1 })],
    });
    const ancient = analyze(city);
    expect(modern.averageScore).toBeLessThan(ancient.averageScore);
    expect(reasonsFor(modern, 'barracks')).toMatch(/obsolete/);
  });
});

describe('rebuy cooldown', () => {
  const makeCooldownEngine = (roundNumber: number) => {
    const turnData: Record<string, unknown> = {};
    const engine = {
      // Read through the object so a test can move the clock forward.
      roundNumber,
      turnData,
      getPlayerStorage: () => ({ turnData }),
      roundManager: { getRoundNumber: () => engine.roundNumber },
    };
    return engine;
  };

  it('blocks a building that was never sold', () => {
    const engine = makeCooldownEngine(20);
    expect(buildingOnRebuyCooldown(engine, 0, 'temple')).toBe(false);
  });

  it('blocks a building sold within the cooldown window', () => {
    const engine = makeCooldownEngine(20);
    rememberBuildingSale(engine, 0, 'temple');
    expect(buildingOnRebuyCooldown(engine, 0, 'temple')).toBe(true);
    // A different building is unaffected.
    expect(buildingOnRebuyCooldown(engine, 0, 'granary')).toBe(false);
  });

  it('releases the building once the window has passed', () => {
    const engine = makeCooldownEngine(20);
    rememberBuildingSale(engine, 0, 'temple');
    engine.roundNumber = 20 + BUILDING_REBUY_COOLDOWN_ROUNDS;
    expect(buildingOnRebuyCooldown(engine, 0, 'temple')).toBe(false);
  });

  it('survives an engine with no storage or round manager', () => {
    expect(buildingOnRebuyCooldown({}, 0, 'temple')).toBe(false);
    expect(() => rememberBuildingSale({}, 0, 'temple')).not.toThrow();
  });
});
