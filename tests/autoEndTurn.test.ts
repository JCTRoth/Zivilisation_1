import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { MIN_CITY_CENTER_DISTANCE } from '@/game/engine/SettlementEvaluator';

/**
 * Auto End Turn + city founding behavior.
 *
 * Requirements under test:
 * 1. After a settler founds a city, the settler is removed from the turn queue
 *    so the queue can empty (previously the ghost settler blocked auto-end).
 * 2. A newly founded city must NOT duplicate its current production in the
 *    build queue (Warrior was both currentProduction AND queue[0]).
 * 3. Auto End Turn triggers when no unit has moves left — including when the
 *    player has ZERO units (e.g. their only settler just founded a city).
 * 4. Auto End Turn does NOT trigger while any unit still has moves.
 * 5. Skipped / sleeping / fortified units do not block auto end turn.
 */
describe('Auto End Turn + city founding', () => {
  let engine: GameEngine;
  let emitted: string[];

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, _data?: any) => {
      emitted.push(type);
    };

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });
  });

  /** Find a non-ocean tile far enough from all cities for a valid settlement. */
  const findValidTile = (): { col: number; row: number } => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = (engine as any).getTileAt?.(col, row);
        if (!tile || tile.type === 'OCEAN' || tile.type === 'ocean') continue;
        const tooClose = engine.cities.some((c: any) => {
          // foundCityWithSettler enforces MIN_CITY_CENTER_DISTANCE (Chebyshev).
          const d = Math.max(Math.abs(c.col - col), Math.abs(c.row - row));
          return d < MIN_CITY_CENTER_DISTANCE;
        });
        if (!tooClose) return { col, row };
      }
    }
    throw new Error('No valid tile found');
  };

  const addSettler = (civId = 0) => {
    const pos = findValidTile();
    const settler = {
      id: `settler_test_${civId}`,
      civilizationId: civId,
      type: 'settler',
      col: pos.col,
      row: pos.row,
      movesRemaining: 1,
      attack: 0,
      defense: 1,
      maxMoves: 1,
      isSleeping: false,
      isFortified: false,
      isSkipped: false,
      areTurnsDone: false
    };
    (engine as any).units.push(settler);
    return settler;
  };

  it('founding a city removes the settler from the turn queue', () => {
    const settler = addSettler(0);
    const queue = (engine as any).unitTurnQueue;
    if (!queue) throw new Error('unitTurnQueue missing');

    queue.initializeQueue(0);
    expect(queue.getQueue(0)).toContain(settler.id);

    engine.foundCityWithSettler(settler.id);

    expect(engine.units.find((u: any) => u.id === settler.id)).toBeUndefined();
    expect(queue.getQueue(0)).not.toContain(settler.id);
  });

  it('a newly founded city does not duplicate current production in the queue', () => {
    const settler = addSettler(0);
    const beforeCount = engine.cities.length;
    engine.foundCityWithSettler(settler.id);

    const city = engine.cities.find((c: any) => c.civilizationId === 0 && engine.cities.indexOf(c) >= beforeCount);
    expect(city).toBeTruthy();
    expect(city!.currentProduction).toBeTruthy();
    expect(Array.isArray(city!.buildQueue)).toBe(true);
    // Auto-production lines up follow-ups so the queue isn't empty right away,
    // but the current production must NOT also sit at the front of the queue
    // — that would be a duplicate.
    const currentName = city!.currentProduction?.name || city!.currentProduction?.itemType;
    const frontName = city!.buildQueue[0]?.name || city!.buildQueue[0]?.itemType;
    expect(frontName).not.toBe(currentName);
  });

  it('auto-end turn fires when the player has no units left (founded last settler)', () => {
    // Clear all human units, leaving only the settler to found the city.
    (engine as any).units = (engine as any).units.filter((u: any) => u.civilizationId !== 0);
    const settler = addSettler(0);
    emitted = [];
    engine.foundCityWithSettler(settler.id);

    expect(emitted).toContain('CHECK_AUTO_END_TURN');
  });

  it('auto-end turn does NOT fire while any unit still has moves', () => {
    // Ensure the human player has a unit with moves left.
    const units = (engine as any).units.filter((u: any) => u.civilizationId === 0);
    for (const u of units) {
      u.movesRemaining = 1;
      u.isSleeping = false;
      u.isFortified = false;
      u.isSkipped = false;
      u.areTurnsDone = false;
    }
    expect(units.length).toBeGreaterThan(0);

    emitted = [];
    (engine as any).checkAndEndTurnIfNoMoves();

    expect(emitted).not.toContain('CHECK_AUTO_END_TURN');
  });

  it('skipped / sleeping / fortified units do not block auto end turn', () => {
    const units = (engine as any).units.filter((u: any) => u.civilizationId === 0);
    for (const u of units) {
      u.isSleeping = true;
      u.areTurnsDone = true;
      u.movesRemaining = 1; // sleeping keeps moves but is not actionable
    }
    expect(units.length).toBeGreaterThan(0);

    emitted = [];
    (engine as any).checkAndEndTurnIfNoMoves();

    expect(emitted).toContain('CHECK_AUTO_END_TURN');
  });

  it('records a skipped-unit recap for the post-end summary', () => {
    // One human unit that is explicitly skipped.
    (engine as any).units = (engine as any).units.filter((u: any) => u.civilizationId !== 0);
    (engine as any).units.push({
      id: 'warrior-a', civilizationId: 0, type: 'warrior', col: 5, row: 5,
      movesRemaining: 0, attack: 1, defense: 1, maxMoves: 1,
      isSleeping: false, isFortified: false, isSkipped: true, areTurnsDone: true
    });

    (engine as any).checkAndEndTurnIfNoMoves();

    expect((engine as any).lastAutoEndSummary).toContain('warrior');
  });
});

/**
 * Regression: after the last human unit attacks (combat), the spent attacker
 * used to stay in the turn queue, so the queue never emptied and auto-end-turn
 * never triggered. The attacker must be removed from the queue after combat so
 * the queue can empty and auto-end can fire.
 */
describe('Auto End Turn after combat', () => {
  let engine: GameEngine;
  let emitted: string[];
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, _data?: any) => {
      emitted.push(type);
    };
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  /** Find two adjacent passable land tiles away from all cities. */
  const findAdjacentPair = (): { a: { col: number; row: number }; b: { col: number; row: number } } => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    const isLand = (col: number, row: number): boolean => {
      const tile = (engine as any).getTileAt?.(col, row);
      if (!tile) return false;
      const type = String(tile.type ?? '').toLowerCase();
      return type !== 'ocean' && type !== 'water';
    };
    const far = (col: number, row: number): boolean =>
      !engine.cities.some((c: any) => Math.abs(c.col - col) + Math.abs(c.row - row) < 3);
    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        if (!isLand(col, row) || !far(col, row)) continue;
        const nbs = [
          { col: col + 1, row },
          { col: col - 1, row },
          { col, row: row + 1 },
          { col, row: row - 1 }
        ];
        for (const nb of nbs) {
          if (isLand(nb.col, nb.row) && far(nb.col, nb.row)) {
            return { a: { col, row }, b: { col: nb.col, row: nb.row } };
          }
        }
      }
    }
    throw new Error('No adjacent land pair found');
  };

  const addWarrior = (id: string, civId: number, pos: { col: number; row: number }, attack: number) => {
    const unit = {
      id,
      civilizationId: civId,
      type: 'warrior',
      col: pos.col,
      row: pos.row,
      movesRemaining: 1,
      health: 100,
      attack,
      defense: 1,
      maxMoves: 1,
      movement: 1,
      icon: 'warrior',
      isSleeping: false,
      isFortified: false,
      isSkipped: false,
      areTurnsDone: false
    };
    (engine as any).units.push(unit);
    return unit;
  };

  it('fires CHECK_AUTO_END_TURN after the last human unit attacks and wins', () => {
    // Keep only the two combatants.
    (engine as any).units = (engine as any).units.filter(
      (u: any) => u.civilizationId !== 0 && u.civilizationId !== 1
    );
    const pair = findAdjacentPair();
    addWarrior('human-warrior', 0, pair.a, 100);
    addWarrior('ai-warrior', 1, pair.b, 1);

    const queue = (engine as any).unitTurnQueue;
    queue.initializeQueue(0);
    expect(queue.getQueue(0)).toContain('human-warrior');

    // Force attacker victory.
    randomSpy.mockReturnValue(0.01);
    emitted = [];
    const result = engine.moveUnit('human-warrior', pair.b.col, pair.b.row);

    expect(result.success).toBe(true);
    // The spent attacker must be removed from the queue so the queue empties…
    expect(queue.getQueue(0)).not.toContain('human-warrior');
    // …and auto-end-turn fires.
    expect(emitted).toContain('CHECK_AUTO_END_TURN');
  });

  it('does NOT fire while another unit still has moves after combat', () => {
    (engine as any).units = (engine as any).units.filter(
      (u: any) => u.civilizationId !== 0 && u.civilizationId !== 1
    );
    const pair = findAdjacentPair();
    addWarrior('human-warrior', 0, pair.a, 100);
    addWarrior('ai-warrior', 1, pair.b, 1);
    // A second human unit with moves elsewhere.
    addWarrior('human-warrior-2', 0, { col: pair.a.col + 3, row: pair.a.row }, 1);

    const queue = (engine as any).unitTurnQueue;
    queue.initializeQueue(0);
    // Second unit is NOT queued here; the check counts ALL player units.
    (engine as any).units.find((u: any) => u.id === 'human-warrior-2').movesRemaining = 1;

    randomSpy.mockReturnValue(0.01);
    emitted = [];
    engine.moveUnit('human-warrior', pair.b.col, pair.b.row);

    expect(emitted).not.toContain('CHECK_AUTO_END_TURN');
  });
});

describe('Auto End Turn defers while a city still has production queued', () => {
  let engine: GameEngine;
  let emitted: string[];

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, _data?: any) => {
      emitted.push(type);
    };

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });
  });

  /** Leave the player with no movable units so only the city-queue decides. */
  const clearMovableHumanUnits = () => {
    (engine as any).units = (engine as any).units.filter(
      (u: any) => u.civilizationId !== 0
    );
    (engine as any).unitTurnQueue?.clearQueue?.(0);
  };

  it('does NOT auto-end when a MANUALLY-managed human city has a non-empty production queue', () => {
    clearMovableHumanUnits();

    // Give one MANUALLY-managed human city (Auto Production OFF) queued
    // production (stuff the player still needs to review).
    const humanCity = engine.cities.find((c: any) => c.civilizationId === 0);
    expect(humanCity).toBeTruthy();
    (humanCity as any).autoProduction = false;
    (humanCity as any).buildQueue = [
      { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 },
      { type: 'building', itemType: 'granary', name: 'Granary', cost: 60 }
    ];

    (engine as any).checkAndEndTurnIfNoMoves();

    expect(emitted).not.toContain('CHECK_AUTO_END_TURN');
  });

  it('auto-ends when all human cities have an empty production queue', () => {
    clearMovableHumanUnits();

    // Ensure the human city queues are empty.
    for (const city of engine.cities.filter((c: any) => c.civilizationId === 0)) {
      (city as any).buildQueue = [];
    }

    (engine as any).checkAndEndTurnIfNoMoves();

    expect(emitted).toContain('CHECK_AUTO_END_TURN');
  });
});
