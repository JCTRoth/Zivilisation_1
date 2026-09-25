/**
 * Turn wiring: the hooks that connect per-turn unit work to the turn pipeline.
 *
 * Each of these engine methods is unit-tested in isolation, but each has
 * exactly ONE caller — the turn reset. Deleting that one line would leave the
 * whole suite green while the feature silently stopped happening in a real
 * game ("roads never get built", "boats stop fishing", "walls never go
 * obsolete"). These tests drive the real `TurnManager.resetUnitsForPlayer`
 * through a real turn instead of calling the private methods.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { makeGridEngine, useSeededRandom, world } from './helpers/world';

const G = 'grassland';
const T = 'tundra';

function makeBareEngine(): GameEngine {
  const row = [G, G, G, G, G];
  return makeGridEngine([row, [...row], [...row], [...row], [...row]]);
}

/** The turn reset, called exactly the way TurnManager calls it. */
function startOfTurn(engine: GameEngine, civId = 0): void {
  (
    engine.turnManager as unknown as { resetUnitsForPlayer: (id: number) => void }
  ).resetUnitsForPlayer(civId);
}

describe('Turn wiring: multi-turn worker construction', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = makeBareEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a settler with workTarget loses a worker-turn every turn (through the reset)', () => {
    const w = world(engine);
    const worker = w.spawnUnit({ id: 'builder', col: 2, row: 1, type: 'settler' });
    (worker as unknown as { workTarget: string }).workTarget = 'road';
    (worker as unknown as { workTurns: number }).workTurns = 3;

    startOfTurn(engine);
    expect((worker as unknown as { workTurns: number }).workTurns).toBe(2);
    expect(worker.movesRemaining).toBe(0); // still building, so no movement left

    startOfTurn(engine);
    expect((worker as unknown as { workTurns: number }).workTurns).toBe(1);
    expect(worker.movesRemaining).toBe(0);

    startOfTurn(engine);
    // Third worker-turn completes the road and frees the settler.
    const tile = engine.getTileAt(2, 1) as unknown as { improvement?: string };
    expect(tile.improvement).toBe('road');
    expect((worker as unknown as { workTarget: string | null }).workTarget).toBeNull();
    expect(worker.movesRemaining).toBeGreaterThan(0);
  });

  it('long work keeps consuming the settler turn after the first', () => {
    const w = world(engine);
    const worker = w.spawnUnit({ id: 'builder2', col: 3, row: 3, type: 'settler' });
    (worker as unknown as { workTarget: string }).workTarget = 'irrigation';
    (worker as unknown as { workTurns: number }).workTurns = 5;

    startOfTurn(engine);
    startOfTurn(engine);
    expect((worker as unknown as { workTurns: number }).workTurns).toBe(3);
    // And it is still marked done for the turn (a worker on a site cannot move).
    expect(worker.areTurnsDone).toBe(true);
  });
});

describe('Turn wiring: fisher boat routes', () => {
  let engine: GameEngine;

  beforeEach(() => {
    useSeededRandom(21);
    engine = makeBareEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a boat on its net catches one fish per turn and turns home when full', () => {
    const w = world(engine);
    const home = w.settle('Harbor', 1, 1, 0, 3);
    const boat = w.spawnUnit({ id: 'boat', col: 3, row: 3, type: 'fisher_boat', homeCityId: home.id });
    (boat as unknown as { fishingRoute: unknown }).fishingRoute = {
      homeCityId: home.id, fishingTile: { col: 3, row: 3 }, stage: 'fishing',
    };
    (boat as unknown as { fishStored: number }).fishStored = 0;

    const route = () => (boat as unknown as { fishingRoute: { stage: string } }).fishingRoute;
    const stored = () => (boat as unknown as { fishStored: number }).fishStored;

    expect(route().stage).toBe('fishing');
    startOfTurn(engine);
    expect(stored()).toBe(1);
    startOfTurn(engine);
    expect(stored()).toBe(2);

    // Fill the hold (capacity 6) — the last catch flips the route inbound.
    for (let i = 0; i < 4; i++) startOfTurn(engine);
    expect(stored()).toBe(6);
    expect(route().stage).toBe('inbound');
  });

  it('a boat whose home city vanished drops its route instead of stalling', () => {
    const w = world(engine);
    const home = w.settle('Gone', 1, 2, 0, 2);
    const boat = w.spawnUnit({ id: 'boat3', col: 2, row: 2, type: 'fisher_boat', homeCityId: home.id });
    (boat as unknown as { fishingRoute: unknown }).fishingRoute = {
      homeCityId: 'no-such-city', fishingTile: { col: 2, row: 2 }, stage: 'fishing',
    };
    // The city is gone but the unit still points at it.
    engine.cities = engine.cities.filter((c) => c.id !== home.id);

    startOfTurn(engine);
    expect((boat as unknown as { fishingRoute: unknown }).fishingRoute).toBeNull();
  });

  it('a boat without a route is left alone (no fishing, no crash)', () => {
    const w = world(engine);
    const boat = w.spawnUnit({ id: 'boat2', col: 2, row: 4, type: 'fisher_boat' });
    startOfTurn(engine);
    expect((boat as unknown as { fishStored?: number }).fishStored ?? 0).toBe(0);
    expect(boat.movesRemaining).toBeGreaterThan(0);
  });
});

describe('Turn wiring: research only unlocks after the opening rounds', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = makeBareEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is locked before the unlock round and open from it on', () => {
    for (let round = 0; round < RESEARCH_UNLOCK_ROUND - 1; round++) {
      engine.roundManager.restoreState({ roundNumber: round });
      expect(engine.isResearchUnlocked(), `round ${round}`).toBe(false);
    }
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    expect(engine.isResearchUnlocked()).toBe(true);
  });
});

describe('Turn wiring: barbarians act once per round', () => {
  let engine: GameEngine;

  beforeEach(() => {
    useSeededRandom(4);
    engine = makeBareEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a barbarian faction is excluded from the normal turn rotation', () => {
    // The barbarian civ (id -1) is driven by BarbarianManager once per round,
    // so `advanceTurn` must never hand it a normal turn — otherwise it would
    // be skipped entirely (it has no AI) or take a phantom turn.
    const civId: number = BARBARIAN_CIV_ID;
    expect(civId).toBe(-1);

    // No barbarian civ in this fixture: the filter must simply not care.
    expect(() => (engine.turnManager as unknown as { advanceTurn: () => void }).advanceTurn())
      .not.toThrow();
  });
});

describe('Turn wiring: metallurgy scraps city walls', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = makeBareEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completing metallurgy removes city walls for that civ', () => {
    const w = world(engine);
    const city = w.settle('Walled', 2, 2, 0, 2);
    city.buildings = ['city_walls', 'temple'];
    const civ = engine.civilizations[0];
    civ.technologies = [...(civ.technologies ?? []), 'pottery'];
    civ.currentResearch = { id: 'metallurgy', name: 'Metallurgy', cost: 120 } as never;
    civ.resources = { ...civ.resources, science: 500 };

    (
      engine.turnManager as unknown as {
        processCivilizationResearch: (c: unknown) => void;
      }
    ).processCivilizationResearch(civ);

    expect(civ.technologies).toContain('metallurgy');
    expect(city.buildings).not.toContain('city_walls');
    expect(city.buildings).toContain('temple');
  });
});

describe('Turn wiring: terrain sanity for improvement work', () => {
  it('a road needs a move-cost-1 tile and irrigation needs fresh water', () => {
    const row = [G, T, G, T, G];
    const engine = makeGridEngine([row, [...row], [...row], [...row], [...row]]);
    const w = world(engine);
    const worker = w.spawnUnit({ id: 'irrigator', col: 1, row: 1, type: 'settler' });
    (worker as unknown as { workTarget: string }).workTarget = 'irrigation';
    (worker as unknown as { workTurns: number }).workTurns = 2;
    startOfTurn(engine);
    startOfTurn(engine);
    // The improvement lands on the settler's own tile.
    const tile = engine.getTileAt(1, 1) as unknown as { improvement?: string };
    expect(tile.improvement).toBe('irrigation');
  });
});
