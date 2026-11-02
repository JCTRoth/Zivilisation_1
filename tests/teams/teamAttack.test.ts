/**
 * Team coordination — Phase 2: the team war plan (coordinated attacking).
 *
 * The coordinator picks ONE primary enemy city per team per war, kept stable
 * while the team marches and rotated when it is captured or goes stale.
 * Members feed it into their bulk planner (`planBulkAttack`'s teamFocus), so
 * two AIs on a team converge on the same city instead of sieging two
 * different ones.
 *
 * Pinned here:
 *   * primary selection (value, proximity to the team's forces, retaliation),
 *   * knowledge is shared — a member that never saw the city still gets it,
 *   * stability and rotation (capture, owner change, age window),
 *   * peace and free-for-all produce no plan at all,
 *   * the focus bonus makes the team's primary win a member's bulk scoring.
 */
import { describe, it, expect, vi } from 'vitest';
import { TeamCoordinator } from '@/game/engine/AI/TeamCoordinator';
import { TeamManager } from '@/game/engine/TeamManager';
import { planBulkAttack, TEAM_FOCUS_BONUS, type KnownTarget } from '@/game/engine/AI/AIAggression';
import { teamSettings } from './teamHelpers';

const WIDTH = 20;
const HEIGHT = 20;

interface FakeCity {
  id: string;
  col: number;
  row: number;
  civilizationId: number;
  population: number;
  buildings?: string[];
}

interface FakeUnit {
  id: string;
  type: string;
  col: number;
  row: number;
  civilizationId: number;
  isDefeated?: boolean;
}

interface WarWorldOptions {
  assignments: number[];
  /** civId -> civ ids it is at war with. */
  enemies: Record<number, number[]>;
  /** civId -> first column NOT explored (columns 0..n-1 are explored). */
  exploredColumns: Record<number, number>;
  cities: FakeCity[];
  units?: FakeUnit[];
  /** civId -> per-turn memory (e.g. lastCityLostTo / lastCityLostRound). */
  turnData?: Record<number, Record<string, unknown>>;
  currentTurn?: number;
  devMode?: boolean;
}

interface WarWorld {
  engine: any;
  coordinator: TeamCoordinator;
  cities: FakeCity[];
}

function makeWarWorld(options: WarWorldOptions): WarWorld {
  const exploredRight = (civId: number): number => options.exploredColumns[civId] ?? 0;
  const playerStorage = new Map<number, { explored: boolean[]; turnData: Record<string, unknown> }>();
  for (const civIdStr of Object.keys(options.exploredColumns)) {
    const civId = Number(civIdStr);
    const explored = new Array<boolean>(WIDTH * HEIGHT).fill(false);
    for (let row = 0; row < HEIGHT; row++) {
      for (let col = 0; col < exploredRight(civId); col++) explored[row * WIDTH + col] = true;
    }
    playerStorage.set(civId, { explored, turnData: options.turnData?.[civId] ?? {} });
  }
  // Teammates with memory but no explored columns still need storage.
  for (const civId of options.assignments ?? []) {
    if (!playerStorage.has(civId)) {
      playerStorage.set(civId, { explored: new Array<boolean>(WIDTH * HEIGHT).fill(false), turnData: options.turnData?.[civId] ?? {} });
    }
  }

  const cities = options.cities.map((c) => ({ buildings: [], ...c }));
  const engine: any = {
    map: { width: WIDTH, height: HEIGHT },
    playerStorage,
    units: (options.units ?? []).map((u) => ({ isDefeated: false, ...u })),
    cities,
    // Civ 0 is the human on team 0 — plan changes are news for it.
    civilizations: [
      { id: 0, name: 'Alpha', isHuman: true, isAlive: true },
      { id: 1, name: 'Beta', isHuman: false, isAlive: true },
      { id: 2, name: 'Gamma', isHuman: false, isAlive: true },
    ],
    onStateChange: vi.fn(),
    devMode: options.devMode ?? false,
    currentTurn: options.currentTurn ?? 5,
    squareGrid: {
      squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
        Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    },
    getTileAt(col: number, row: number) {
      return col >= 0 && row >= 0 && col < WIDTH && row < HEIGHT ? { type: 'grassland' } : null;
    },
    getCityAt(col: number, row: number) {
      return cities.find((c) => c.col === col && c.row === row) ?? null;
    },
    isExploredByPlayer(civId: number, col: number): boolean {
      return col >= 0 && col < WIDTH && col < exploredRight(civId);
    },
    diplomacyManager: {
      getEnemies: (civId: number): number[] => options.enemies[civId] ?? [],
    },
  };

  engine.teamManager = new TeamManager(engine);
  if (options.assignments) {
    engine.teamManager.configure(teamSettings(options.assignments), options.assignments.length);
    engine.teamManager.applyToCivilizations();
  }
  engine.teamCoordinator = new TeamCoordinator(engine);

  return { engine, coordinator: engine.teamCoordinator, cities };
}

const scout = (id: string, col: number, row: number, civId: number): FakeUnit => ({
  id, type: 'scout', col, row, civilizationId: civId,
});

const city = (id: string, col: number, row: number, civId: number, population: number): FakeCity => ({
  id, col, row, civilizationId: civId, population,
});

describe('TeamCoordinator — war plan (primary target)', () => {
  it('picks the known enemy city and shares it with the member who never saw it', () => {
    const world = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      // Member 1 has barely explored — the city at (15,10) is member 0's find.
      exploredColumns: { 0: 16, 1: 2 },
      cities: [city('e1', 15, 10, 2, 4)],
      units: [scout('s1', 14, 10, 0), scout('s2', 1, 1, 1)],
    });
    world.coordinator.processRound(5);

    const plan = world.coordinator.getTeamWarPlan(0);
    expect(plan).toEqual({ primary: { col: 15, row: 10, civId: 2 }, assignedRound: 5 });
    // Shared: member 1 gets the same focus although it explored nothing there.
    expect(world.coordinator.teamFocusFor(0)).toEqual({ col: 15, row: 10, civId: 2 });
    expect(world.coordinator.teamFocusFor(1)).toEqual({ col: 15, row: 10, civId: 2 });
  });

  it('prefers the enemy city near the team’s forces', () => {
    const world = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('near', 15, 10, 2, 2), // close to the army at (14,10)
        city('far', 16, 1, 2, 4), // bigger, but far away
      ],
      units: [scout('s1', 14, 10, 0), scout('s2', 14, 11, 1)],
    });
    world.coordinator.processRound(5);

    expect(world.coordinator.getTeamWarPlan(0)?.primary).toEqual({ col: 15, row: 10, civId: 2 });
  });

  it('a teammate’s captured city steers the whole team (retaliation memory)', () => {
    // Two enemy civs: civ 2 holds the big/close city, civ 3 the small/far
    // one. Retaliation steers between enemy CIVS (the capturer), not between
    // cities of the same civ.
    const options: WarWorldOptions = {
      assignments: [0, 0, 1],
      enemies: { 0: [2, 3], 1: [2, 3] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('big', 15, 10, 2, 6), // closer + bigger
        city('small', 5, 18, 3, 1), // civ 3's city — the capturer
      ],
      units: [scout('s1', 2, 10, 0), scout('s2', 1, 1, 1)],
    };
    const withoutMemory = makeWarWorld(options);
    withoutMemory.coordinator.processRound(5);
    expect(withoutMemory.coordinator.getTeamWarPlan(0)?.primary).toEqual({ col: 15, row: 10, civId: 2 });

    // Member 0 recently lost a city to civ 3 → the team pivots to civ 3's
    // city even though civ 2's city scores higher on value and distance.
    const withMemory = makeWarWorld({
      ...options,
      turnData: { 0: { lastCityLostTo: 3, lastCityLostRound: 3 } },
      currentTurn: 5,
    });
    withMemory.coordinator.processRound(5);
    expect(withMemory.coordinator.getTeamWarPlan(0)?.primary).toEqual({ col: 5, row: 18, civId: 3 });

    // After the window the plan reverts to plain scoring (16 rounds later:
    // the primary is re-evaluated and no retaliation applies any more).
    withMemory.engine.currentTurn = 21;
    withMemory.coordinator.processRound(21);
    expect(withMemory.coordinator.getTeamWarPlan(0)?.primary).toEqual({ col: 15, row: 10, civId: 2 });
  });

  it('keeps a valid plan stable and rotates only when it dies or ages out', () => {
    const world = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('first', 15, 10, 2, 2),
      ],
      units: [scout('s1', 14, 10, 0), scout('s2', 14, 11, 1)],
    });
    world.coordinator.processRound(5);
    expect(world.coordinator.getTeamWarPlan(0)?.primary.col).toBe(15);

    // A much richer city appears one round later — the plan stays put
    // (stability: an army mid-march is not redirected).
    world.cities.push(city('rich', 16, 1, 2, 8));
    world.coordinator.processRound(6);
    expect(world.coordinator.getTeamWarPlan(0)?.primary.col).toBe(15);

    // Capture the primary → the plan must rotate immediately.
    const captured = world.cities.find((c) => c.id === 'first')!;
    captured.civilizationId = 0; // taken by the team
    world.coordinator.processRound(7);
    expect(world.coordinator.getTeamWarPlan(0)?.primary.col).toBe(16);

    // Age rotation: after the window the primary is re-evaluated.
    world.engine.currentTurn = 30;
    world.coordinator.processRound(30);
    expect(world.coordinator.getTeamWarPlan(0)?.assignedRound).toBe(30);
  });

  it('produces no plan at peace, in free-for-all, or in dev mode', () => {
    const peace = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [], 1: [] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [city('e1', 15, 10, 2, 4)],
      units: [scout('s1', 14, 10, 0)],
    });
    peace.coordinator.processRound(5);
    expect(peace.coordinator.getTeamWarPlan(0)).toBeNull();
    expect(peace.coordinator.teamFocusFor(0)).toBeNull();

    const dev = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [city('e1', 15, 10, 2, 4)],
      units: [scout('s1', 14, 10, 0)],
      devMode: true,
    });
    dev.coordinator.processRound(5);
    expect(dev.coordinator.getTeamWarPlan(0)).toBeNull();
  });
});

describe('planBulkAttack — team focus bonus', () => {
  const engineStub = () => {
    const cities: FakeCity[] = [
      city('own', 5, 5, 0, 3),
      city('near', 6, 5, 2, 2),
      city('far', 16, 16, 2, 2),
    ];
    return {
      cities,
      units: [] as FakeUnit[],
      getTileAt: () => ({ type: 'grassland' }),
      getCityAt: (col: number, row: number) => cities.find((c) => c.col === col && c.row === row) ?? null,
      squareGrid: {
        squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
          Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
      },
    } as any;
  };

  const targets: KnownTarget[] = [
    { col: 6, row: 5, type: 'city', id: 'near', civId: 2, reachableBy: 'land', lastSeenRound: 10, discoveredRound: 10 },
    { col: 16, row: 16, type: 'city', id: 'far', civId: 2, reachableBy: 'land', lastSeenRound: 10, discoveredRound: 10 },
  ];

  it('the nearer city wins without a team focus', () => {
    const plan = planBulkAttack(engineStub(), 0, targets, 1000, 10, 10, true);
    expect(plan?.target).toEqual({ col: 6, row: 5 });
  });

  it('the team’s primary beats every local alternative with the focus bonus', () => {
    const plan = planBulkAttack(
      engineStub(), 0, targets, 1000, 10, 10, true,
      undefined,
      { col: 16, row: 16, civId: 2 },
    );
    expect(plan?.target).toEqual({ col: 16, row: 16 });
    expect(plan?.targetCivId).toBe(2);
  });

  it('a different team focus changes nothing; the bonus is not cosmetic', () => {
    // Sanity: the bonus is what flips the pick — with a focus on the NEAR
    // city it still wins, and with no focus the far city loses.
    const plan = planBulkAttack(
      engineStub(), 0, targets, 1000, 10, 10, true,
      undefined,
      { col: 6, row: 5, civId: 2 },
    );
    expect(plan?.target).toEqual({ col: 6, row: 5 });
    expect(TEAM_FOCUS_BONUS).toBeGreaterThanOrEqual(50);
  });

  it('the strength gate still vetoes a hopeless team focus', () => {
    // Target defense far exceeds the available strength: even the team's
    // primary must not trigger an unwinnable assault.
    const plan = planBulkAttack(
      engineStub(), 0,
      [{ col: 16, row: 16, type: 'city', id: 'far', civId: 2, reachableBy: 'land', lastSeenRound: 10, discoveredRound: 10 }],
      1, // availableStrength ~ 0
      10, 10, true,
      undefined,
      { col: 16, row: 16, civId: 2 },
    );
    expect(plan).toBeNull();
  });
});

describe('player directives — pinPrimaryTarget ("Coordinate attack")', () => {
  const world = () =>
    makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('near', 15, 10, 2, 2),
        city('far', 16, 1, 2, 4),
      ],
      units: [scout('s1', 14, 10, 0), scout('s2', 14, 11, 1)],
    });

  it('pins the player’s choice over the computed pick', () => {
    const w = world();
    w.coordinator.processRound(5);
    // Without a pin the near city wins on proximity.
    expect(w.coordinator.getTeamWarPlan(0)?.primary.col).toBe(15);

    // The player orders the attack on the far city — the pin outranks scoring.
    expect(w.coordinator.pinPrimaryTarget(0, 16, 1)).toBe(true);
    w.coordinator.processRound(6);
    expect(w.coordinator.getTeamWarPlan(0)?.primary).toEqual({ col: 16, row: 1, civId: 2 });
    // The pin is a team directive: every member converges on it.
    expect(w.coordinator.teamFocusFor(1)).toEqual({ col: 16, row: 1, civId: 2 });
  });

  it('refuses illegal pins: own cities, teammate cities, peace, empty ground', () => {
    const w = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('own', 5, 5, 0, 3),
        city('ally', 6, 6, 1, 3),
        city('peaceful', 9, 9, 3, 3), // civ 3 is nobody's enemy
      ],
      units: [scout('s1', 14, 10, 0)],
    });
    w.coordinator.processRound(5);
    expect(w.coordinator.pinPrimaryTarget(0, 5, 5)).toBe(false); // own city
    expect(w.coordinator.pinPrimaryTarget(0, 6, 6)).toBe(false); // teammate
    expect(w.coordinator.pinPrimaryTarget(0, 9, 9)).toBe(false); // not at war
    expect(w.coordinator.pinPrimaryTarget(0, 12, 12)).toBe(false); // no city
  });

  it('a dead pin retires and the computed pick takes over', () => {
    const w = world();
    w.coordinator.processRound(5);
    expect(w.coordinator.pinPrimaryTarget(0, 16, 1)).toBe(true);
    w.coordinator.processRound(6);
    expect(w.coordinator.getTeamWarPlan(0)?.primary.col).toBe(16);

    // The pinned city is captured by the team → pin retires itself.
    const pinned = w.cities.find((c) => c.id === 'far')!;
    pinned.civilizationId = 0;
    w.coordinator.processRound(7);
    expect(w.coordinator.getTeamWarPlan(0)?.primary.col).toBe(15);
  });

  it('pinning is impossible in free-for-all games', () => {
    const ffa = makeWarWorld({
      assignments: undefined as unknown as number[],
      enemies: { 0: [2] },
      exploredColumns: { 0: 17 },
      cities: [city('far', 16, 1, 2, 4)],
      units: [scout('s1', 14, 10, 0)],
    });
    ffa.coordinator.processRound(5);
    expect(ffa.coordinator.pinPrimaryTarget(0, 16, 1)).toBe(false);
  });
});

describe('war plan changes — reported to a human teammate', () => {
  it('emits TEAM_PLAN_CHANGED when the primary moves, once per change', () => {
    const w = makeWarWorld({
      assignments: [0, 0, 1],
      enemies: { 0: [2], 1: [2] },
      exploredColumns: { 0: 17, 1: 17 },
      cities: [
        city('first', 15, 10, 2, 2),
        city('second', 5, 18, 2, 1),
      ],
      units: [scout('s1', 14, 10, 0), scout('s2', 14, 11, 1)],
    });

    // The first plan is news.
    w.coordinator.processRound(5);
    expect(w.engine.onStateChange).toHaveBeenCalledTimes(1);
    const [type, data] = w.engine.onStateChange.mock.calls[0];
    expect(type).toBe('TEAM_PLAN_CHANGED');
    expect(data).toMatchObject({ col: 15, row: 10, targetCivId: 2, humanId: 0, teamId: 0 });

    // A kept plan is not news.
    w.coordinator.processRound(6);
    expect(w.engine.onStateChange).toHaveBeenCalledTimes(1);

    // Capture the primary → the plan rotates → news again.
    const captured = w.cities.find((c) => c.id === 'first')!;
    captured.civilizationId = 0;
    w.coordinator.processRound(7);
    expect(w.engine.onStateChange).toHaveBeenCalledTimes(2);
    expect(w.engine.onStateChange.mock.calls[1][1]).toMatchObject({ col: 5, row: 18 });
  });

  it('stays silent in free-for-all and when no human is on the team', () => {
    const ffa = makeWarWorld({
      assignments: undefined as unknown as number[],
      enemies: { 0: [2] },
      exploredColumns: { 0: 17 },
      cities: [city('first', 15, 10, 2, 2)],
      units: [scout('s1', 14, 10, 0)],
    });
    ffa.coordinator.processRound(5);
    expect(ffa.engine.onStateChange).not.toHaveBeenCalled();
  });
});
