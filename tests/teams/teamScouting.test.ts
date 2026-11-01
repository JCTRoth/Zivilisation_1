/**
 * Team coordination — Phase 1: scout region claims and the POI registry.
 *
 * The coordinator runs once per round and partitions a team's frontier among
 * its explorers (nearest land scout for land, nearest naval hull for water),
 * so two teammates stop sweeping the same fog. These tests pin the contract
 * member AIs rely on:
 *
 *   * every frontier cell of a multi-member team is claimed exactly once,
 *   * the claim goes to the nearest matching explorer (Chebyshev, ties by id),
 *   * `shouldYield` is a pure preference with an FFA-safe off switch,
 *   * single-member teams and single-explorer teams compute nothing,
 *   * POIs are published for the team and expire by age,
 *   * dev mode and free-for-all games are completely inert.
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
  isDefeated?: boolean;
}

interface WorldOptions {
  /** Team assignment per slot; `undefined` = free-for-all (mode off). */
  assignments?: number[];
  /** civId -> first column NOT explored (columns 0..n-1 are explored). */
  exploredColumns: Record<number, number>;
  units: FakeUnit[];
  /** Columns >= this are ocean; omit for an all-land map. */
  waterFromColumn?: number;
  devMode?: boolean;
}

interface World {
  engine: any;
  teamManager: TeamManager;
  coordinator: TeamCoordinator;
}

function makeWorld(options: WorldOptions): World {
  const waterFrom = options.waterFromColumn ?? WIDTH + 1;
  const playerStorage = new Map<number, { explored: boolean[] }>();
  const exploredRight = (civId: number): number => options.exploredColumns[civId] ?? 0;
  for (const civIdStr of Object.keys(options.exploredColumns)) {
    const civId = Number(civIdStr);
    const explored = new Array<boolean>(WIDTH * HEIGHT).fill(false);
    const right = exploredRight(civId);
    for (let row = 0; row < HEIGHT; row++) {
      for (let col = 0; col < right; col++) explored[row * WIDTH + col] = true;
    }
    playerStorage.set(civId, { explored });
  }

  const engine: any = {
    map: { width: WIDTH, height: HEIGHT },
    playerStorage,
    units: options.units.map((u) => ({ isDefeated: false, ...u })),
    cities: [],
    devMode: options.devMode ?? false,
    getTileAt(col: number, row: number) {
      if (col < 0 || row < 0 || col >= WIDTH || row >= HEIGHT) return null;
      return col >= waterFrom ? { type: 'ocean' } : { type: 'grassland' };
    },
  };

  engine.teamManager = new TeamManager(engine);
  if (options.assignments) {
    engine.teamManager.configure(teamSettings(options.assignments), options.assignments.length);
    engine.teamManager.applyToCivilizations();
  }

  engine.teamCoordinator = new TeamCoordinator(engine);
  return { engine, teamManager: engine.teamManager, coordinator: engine.teamCoordinator };
}

const scout = (id: string, col: number, row: number, civId: number): FakeUnit => ({
  id,
  type: 'scout',
  col,
  row,
  civilizationId: civId,
});
const trireme = (id: string, col: number, row: number, civId: number): FakeUnit => ({
  id,
  type: 'trireme',
  col,
  row,
  civilizationId: civId,
});

describe('TeamCoordinator — scout region claims (land)', () => {
  // Team 0 = civs 0+1 (both explored columns 0..9), team 1 = civ 2 (alone).
  // Frontier for team 0 is exactly column 10 (unexplored, neighbour col 9
  // explored). S1 (civ 0) at (2,10), S2 (civ 1) at (8,10).
  const setup = () =>
    makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 10, 1: 10, 2: 0 },
      units: [scout('s1', 2, 10, 0), scout('s2', 8, 10, 1)],
    });

  it('claims every frontier cell of a two-member team exactly once', () => {
    const { coordinator } = setup();
    coordinator.processRound(1);

    expect(coordinator.claimCount(0)).toBe(HEIGHT); // column 10, all rows
    for (let row = 0; row < HEIGHT; row++) {
      const owner = coordinator.claimOwnerAt(0, 10, row);
      expect(owner, `frontier cell (10,${row}) must be claimed`).toBeTruthy();
      expect(['s1', 's2']).toContain(owner);
    }
    // Deep fog beyond the frontier ring has no claim (nobody can see there yet).
    expect(coordinator.claimOwnerAt(0, 11, 10)).toBeNull();
    // Explorered ground is never claimed.
    expect(coordinator.claimOwnerAt(0, 9, 10)).toBeNull();
  });

  it('gives each cell to the nearest scout (Chebyshev), ties by lower id', () => {
    const { coordinator } = setup();
    coordinator.processRound(1);

    for (let row = 0; row < HEIGHT; row++) {
      const distS1 = Math.max(Math.abs(2 - 10), Math.abs(10 - row));
      const distS2 = Math.max(Math.abs(8 - 10), Math.abs(10 - row));
      const expected = distS1 < distS2 ? 's1' : distS2 < distS1 ? 's2' : 's1'; // tie -> 's1'
      expect(coordinator.claimOwnerAt(0, 10, row), `row ${row}`).toBe(expected);
    }
  });

  it('single-member teams and single-explorer teams compute nothing', () => {
    const { coordinator } = setup();
    coordinator.processRound(1);

    // Team 1 has one member — nothing to coordinate.
    expect(coordinator.claimCount(1)).toBe(0);

    // Two members but only one explorer → no claims either.
    const lone = makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 10, 1: 10, 2: 0 },
      units: [scout('s1', 2, 10, 0)],
    });
    lone.coordinator.processRound(1);
    expect(lone.coordinator.claimCount(0)).toBe(0);
  });
});

describe('TeamCoordinator — shouldYield (pure preference)', () => {
  const setup = () => {
    const world = makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 10, 1: 10, 2: 0 },
      units: [scout('s1', 2, 10, 0), scout('s2', 8, 10, 1)],
    });
    world.coordinator.processRound(1);
    return world;
  };

  it('yields to a teammate’s claim, never to its own', () => {
    const { coordinator } = setup();
    const s1 = { id: 's1', civilizationId: 0 };
    const s2 = { id: 's2', civilizationId: 1 };

    // (10,17) is nearest to s2 → s1 yields, s2 does not.
    expect(coordinator.shouldYield(s1, 10, 17)).toBe(true);
    expect(coordinator.shouldYield(s2, 10, 17)).toBe(false);

    // (10,0) ties on distance → lower id 's1' wins the claim.
    expect(coordinator.shouldYield(s1, 10, 0)).toBe(false);
    expect(coordinator.shouldYield(s2, 10, 0)).toBe(true);
  });

  it('never yields on unclaimed cells (deep fog / explored ground)', () => {
    const { coordinator } = setup();
    const s1 = { id: 's1', civilizationId: 0 };
    expect(coordinator.shouldYield(s1, 15, 15)).toBe(false); // deep fog
    expect(coordinator.shouldYield(s1, 5, 5)).toBe(false); // explored
    expect(coordinator.shouldYield(s1, 11, 10)).toBe(false); // outside frontier ring
  });

  it('is a no-op in free-for-all games', () => {
    const ffa = makeWorld({
      assignments: undefined, // mode never configured → disabled
      exploredColumns: { 0: 10, 1: 10, 2: 10 },
      units: [scout('s1', 2, 10, 0), scout('s2', 8, 10, 1)],
    });
    ffa.coordinator.processRound(1);

    expect(ffa.teamManager.enabled).toBe(false);
    expect(ffa.coordinator.claimCount(0)).toBe(0);
    expect(ffa.coordinator.shouldYield({ id: 's1', civilizationId: 0 }, 10, 10)).toBe(false);
  });
});

describe('TeamCoordinator — land/water mobility split', () => {
  // Columns >= 15 are ocean. Team 0 explored columns 0..15, so the frontier
  // is column 16 — all water. Two triremes explore it; the land scouts on the
  // team must not claim a single water cell.
  const setup = () =>
    makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 16, 1: 16, 2: 0 },
      waterFromColumn: 15,
      units: [
        trireme('n1', 16, 4, 0),
        trireme('n2', 16, 14, 1),
        scout('s1', 2, 10, 0),
        scout('s2', 8, 10, 1),
      ],
    });

  it('water frontier goes to the nearest hull, never to a land scout', () => {
    const { coordinator } = setup();
    coordinator.processRound(1);

    expect(coordinator.claimCount(0)).toBe(HEIGHT);
    for (let row = 0; row < HEIGHT; row++) {
      const owner = coordinator.claimOwnerAt(0, 16, row);
      const distN1 = Math.abs(4 - row);
      const distN2 = Math.abs(14 - row);
      const expected = distN1 < distN2 ? 'n1' : distN2 < distN1 ? 'n2' : 'n1'; // tie -> 'n1'
      expect(owner, `water cell (16,${row})`).toBe(expected);
    }
  });

  it('hulls yield to each other across the team boundary', () => {
    const { coordinator } = setup();
    coordinator.processRound(1);

    const n1 = { id: 'n1', civilizationId: 0 };
    const n2 = { id: 'n2', civilizationId: 1 };
    expect(coordinator.shouldYield(n1, 16, 15)).toBe(true); // nearer n2
    expect(coordinator.shouldYield(n2, 16, 15)).toBe(false);
    expect(coordinator.shouldYield(n1, 16, 1)).toBe(false); // nearer n1
    expect(coordinator.shouldYield(n2, 16, 1)).toBe(true);
  });
});

describe('TeamCoordinator — POI registry', () => {
  const world = () =>
    makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 10, 1: 10, 2: 0 },
      units: [scout('s1', 2, 10, 0), scout('s2', 8, 10, 1)],
    });

  it('publishes POIs for the whole team and de-duplicates per cell', () => {
    const { coordinator } = world();
    coordinator.processRound(1);

    coordinator.publishPoi({ kind: 'enemy_city', col: 14, row: 7, teamId: 0, round: 1 });
    coordinator.publishPoi({ kind: 'enemy_city', col: 14, row: 7, teamId: 0, round: 2 });

    const pois = coordinator.getPois(0);
    expect(pois).toHaveLength(1);
    expect(pois[0].round).toBe(2); // re-sighting refreshes, never duplicates
    expect(coordinator.getPois(1)).toHaveLength(0);
  });

  it('prunes POIs older than 15 rounds relative to the newest intel', () => {
    const { coordinator } = world();
    coordinator.processRound(1);

    coordinator.publishPoi({ kind: 'city_site', col: 3, row: 3, teamId: 0, round: 100 });
    coordinator.publishPoi({ kind: 'city_site', col: 4, row: 4, teamId: 0, round: 110 });
    coordinator.publishPoi({ kind: 'city_site', col: 5, row: 5, teamId: 0, round: 120 });
    coordinator.processRound(121);

    const rounds = coordinator.getPois(0).map((p) => p.round).sort();
    expect(rounds).toEqual([110, 120]); // 100 is 20 rounds behind the newest
  });

  it('publishing and queries are inert in free-for-all and dev mode', () => {
    const ffa = makeWorld({
      assignments: undefined,
      exploredColumns: { 0: 10 },
      units: [scout('s1', 2, 10, 0)],
    });
    ffa.coordinator.publishPoi({ kind: 'fish_cluster', col: 1, row: 1, teamId: 0, round: 1 });
    expect(ffa.coordinator.getPois(0)).toHaveLength(0);

    const dev = makeWorld({
      assignments: [0, 0, 1],
      exploredColumns: { 0: 10, 1: 10, 2: 0 },
      units: [scout('s1', 2, 10, 0), scout('s2', 8, 10, 1)],
      devMode: true,
    });
    dev.coordinator.processRound(1);
    dev.coordinator.publishPoi({ kind: 'fish_cluster', col: 1, row: 1, teamId: 0, round: 1 });
    expect(dev.coordinator.claimCount(0)).toBe(0);
    expect(dev.coordinator.getPois(0)).toHaveLength(0);
  });
});
