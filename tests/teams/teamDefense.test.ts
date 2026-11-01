/**
 * Team coordination — Phase 3: mutual defense.
 *
 * When a teammate's city is threatened, the TeamCoordinator assesses it from
 * the OWNER's perspective (garrison = owner + stacked teammates, teammate
 * units never count as threats) and assigns the job to the nearest member
 * that shares the city's landmass. `AIManager.findDefensiveAssignment`
 * consumes those directives for its mobile surplus — after own threats,
 * committed offensives and the city reserve, which all rank above it.
 *
 * Pinned here:
 *   * assignment to the nearest non-owner, land-reachable member,
 *   * no directive when the city is safe or unreachable for every helper,
 *   * stacked teammate units count as garrison and are filtered from samples,
 *   * owner never gets its own city back as a "helper job",
 *   * free-for-all produces no directives at all.
 */
import { describe, it, expect } from 'vitest';
import { TeamCoordinator } from '@/game/engine/AI/TeamCoordinator';
import { TeamManager } from '@/game/engine/TeamManager';
import { teamSettings } from './teamHelpers';

const WIDTH = 20;
const HEIGHT = 20;

interface FakeUnit {
  id: string;
  type: string;
  col: number;
  row: number;
  civilizationId: number;
  attack?: number;
  defense?: number;
  isDefeated?: boolean;
}

interface FakeCity {
  id: string;
  col: number;
  row: number;
  civilizationId: number;
  population: number;
}

interface DefenseWorldOptions {
  assignments: number[];
  cities: FakeCity[];
  units: FakeUnit[];
  /** civId -> stale sighting memory entries ({col,row,type,attack,lastSeenRound}). */
  enemyLocations?: Record<number, Array<{ col: number; row: number; type: 'city' | 'unit'; lastSeenRound?: number }>>;
  /** Landmass id per column band (default: one landmass). */
  landmassByColumn?: (col: number) => number;
  currentTurn?: number;
  devMode?: boolean;
}

interface DefenseWorld {
  engine: any;
  coordinator: TeamCoordinator;
}

function makeDefenseWorld(options: DefenseWorldOptions): DefenseWorld {
  const landmass = options.landmassByColumn ?? (() => 0);
  const playerStorage = new Map<number, { explored: boolean[]; turnData: Record<string, unknown>; enemyLocations: Map<number, unknown[]> }>();
  const storageFor = (civId: number) => {
    if (!playerStorage.has(civId)) {
      playerStorage.set(civId, {
        explored: new Array<boolean>(WIDTH * HEIGHT).fill(false),
        turnData: {},
        enemyLocations: new Map(),
      });
    }
    return playerStorage.get(civId)!;
  };
  for (const civId of options.assignments ?? []) storageFor(civId);
  for (const [civStr, locations] of Object.entries(options.enemyLocations ?? {})) {
    storageFor(Number(civStr)).enemyLocations.set(1, locations);
  }

  const cities = options.cities.map((c) => ({ buildings: [], ...c }));
  const engine: any = {
    map: { width: WIDTH, height: HEIGHT },
    playerStorage,
    units: (options.units ?? []).map((u) => ({ isDefeated: false, ...u })),
    cities,
    devMode: options.devMode ?? false,
    currentTurn: options.currentTurn ?? 10,
    currentYear: -4000,
    gameSettings: { difficulty: 'PRINCE' },
    squareGrid: {
      squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
        Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    },
    getTileAt: (col: number, row: number) =>
      col >= 0 && row >= 0 && col < WIDTH && row < HEIGHT ? { type: 'grassland' } : null,
    getCityAt: (col: number, row: number) => cities.find((c) => c.col === col && c.row === row) ?? null,
    getLandmassId: (col: number) => landmass(col),
    isExploredByPlayer: () => false,
    diplomacyManager: { getEnemies: () => [] },
  };

  engine.teamManager = new TeamManager(engine);
  if (options.assignments) {
    engine.teamManager.configure(teamSettings(options.assignments), options.assignments.length);
    engine.teamManager.applyToCivilizations();
  }
  engine.teamCoordinator = new TeamCoordinator(engine);
  return { engine, coordinator: engine.teamCoordinator };
}

const unit = (id: string, col: number, row: number, civId: number, stats: Partial<FakeUnit> = {}): FakeUnit => ({
  id, type: 'warriors', col, row, civilizationId: civId, ...stats,
});
const city = (id: string, col: number, row: number, civId: number, population = 3): FakeCity => ({
  id, col, row, civilizationId: civId, population,
});

describe('TeamCoordinator — mutual defense directives', () => {
  it('assigns a threatened teammate city to the nearest non-owner member', () => {
    // Owner civ 0's city at (10,10), no garrison; an enemy stack at (11,10).
    // Helper must be civ 1 (owner excluded), reachable, nearest to its unit.
    const world = makeDefenseWorld({
      assignments: [0, 0, 1],
      cities: [city('home', 10, 10, 0)],
      units: [
        unit('e1', 11, 10, 2, { attack: 6 }),
        unit('h1', 14, 10, 1, { attack: 2 }),
      ],
    });
    world.coordinator.processRound(10);

    const directives = world.coordinator.getTeamDefenseDirectives(0);
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      cityId: 'home', col: 10, row: 10, ownerCivId: 0, helperCivId: 1,
    });
    expect(directives[0].netThreat).toBeGreaterThanOrEqual(0.8);
    // The owner never gets its own city back as a helper job.
    expect(world.coordinator.defenseDirectivesFor(0)).toHaveLength(0);
    expect(world.coordinator.defenseDirectivesFor(1)).toHaveLength(1);
  });

  it('produces no directive when the city is safe', () => {
    const world = makeDefenseWorld({
      assignments: [0, 0, 1],
      cities: [city('home', 10, 10, 0)],
      units: [unit('h1', 14, 10, 1)], // no enemy in range
    });
    world.coordinator.processRound(10);
    expect(world.coordinator.getTeamDefenseDirectives(0)).toHaveLength(0);
  });

  it('produces no directive when no member shares the city’s landmass', () => {
    // A water channel splits the map: the city sits on landmass 0, the only
    // other member lives entirely on landmass 1 — nobody can walk there.
    const world = makeDefenseWorld({
      assignments: [0, 0, 1],
      cities: [city('home', 10, 10, 0)],
      units: [
        unit('e1', 11, 10, 2, { attack: 6 }),
        unit('h1', 14, 10, 1, { attack: 2 }),
      ],
      landmassByColumn: (col) => (col >= 12 ? 1 : 0),
    });
    world.coordinator.processRound(10);
    expect(world.coordinator.getTeamDefenseDirectives(0)).toHaveLength(0);
  });

  it('a stacked teammate counts as garrison and is never a threat sample', () => {
    // A teammate already standing in the city must (a) add garrison strength
    // and (b) not be reported as a threat sample — even when the owner's
    // stale sighting memory still has an entry on that very tile.
    const enemySighting = [{ col: 10, row: 10, type: 'unit' as const, lastSeenRound: 9 }];
    const options: DefenseWorldOptions = {
      assignments: [0, 0, 1],
      cities: [city('home', 10, 10, 0)],
      units: [
        unit('e1', 11, 10, 2, { attack: 6 }),
        unit('helper', 10, 10, 1, { attack: 0, defense: 4 }),
      ],
      enemyLocations: { 0: enemySighting },
    };

    const withHelper = makeDefenseWorld(options);
    withHelper.coordinator.processRound(10);
    expect(withHelper.coordinator.getTeamDefenseDirectives(0)).toHaveLength(0);

    // Without the stacked teammate: the stale sample on the city tile counts
    // (nothing friendly sits there to filter it), garrison is 0 → help needed.
    const withoutHelper = makeDefenseWorld({
      ...options,
      units: [options.units[0], unit('h1', 14, 10, 1, { attack: 2 })],
    });
    withoutHelper.coordinator.processRound(10);
    expect(withoutHelper.coordinator.getTeamDefenseDirectives(0)).toHaveLength(1);
  });

  it('produces no directives in free-for-all games', () => {
    const world = makeDefenseWorld({
      assignments: undefined as unknown as number[], // mode never configured
      cities: [city('home', 10, 10, 0)],
      units: [unit('e1', 11, 10, 2, { attack: 6 })],
    });
    world.coordinator.processRound(10);
    expect(world.coordinator.getTeamDefenseDirectives(0)).toHaveLength(0);
    expect(world.coordinator.defenseDirectivesFor(1)).toHaveLength(0);
  });
  it('dev mode produces no directives', () => {
    const world = makeDefenseWorld({
      assignments: [0, 0, 1],
      cities: [city('home', 10, 10, 0)],
      units: [unit('e1', 11, 10, 2, { attack: 6 }), unit('h1', 14, 10, 1)],
      devMode: true,
    });
    world.coordinator.processRound(10);
    expect(world.coordinator.getTeamDefenseDirectives(0)).toHaveLength(0);
  });
});
