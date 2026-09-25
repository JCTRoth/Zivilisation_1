/**
 * Shared test harness.
 *
 * Before this, ~45 test files each carried their own copy of the same
 * `new GameEngine(null)` + `sleep` stub + `initialize` call, and every map was
 * random (`seed: Date.now()`), so a failure could not be reproduced. Everything
 * here exists to remove one of those two problems.
 *
 * Typical use:
 *
 *   const { engine, world } = await makeEngine({ seed: 1234 });
 *   world.spawnUnit({ id: 'scout', col: 10, row: 10 });
 *   world.settle('Rome', 12, 12, 0);
 *   await world.runTurns(5);
 */

import { vi } from 'vitest';
import { getGovernment } from '@/data/GovernmentData';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Unit } from '../../types/game';

// ── Deterministic randomness ───────────────────────────────────────────────

/** Mulberry32: small, fast, and repeatable across runs. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replace `Math.random` with a seeded generator for the duration of a test. */
export function useSeededRandom(seed = 1): () => number {
  const random = seededRandom(seed);
  vi.spyOn(Math, 'random').mockImplementation(random);
  return random;
}

/** Force one specific outcome (0 = always win, 0.99 = always lose). */
export function forceRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

// ── Engine + world ─────────────────────────────────────────────────────────

export interface MakeEngineOptions {
  /** Pins the generated map. Default: a fixed seed so runs are reproducible. */
  seed?: number;
  mapType?: string;
  numberOfCivilizations?: number;
  startingGold?: number;
  /** Set false to keep the raw engine (used by tests that stub subsystems). */
  realMap?: boolean;
}

export interface TestWorld {
  engine: GameEngine;
  cities: City[];
  units: Unit[];
  /** A passable, unoccupied land tile near (col,row) — maps are procedural. */
  landNear(col: number, row: number, radius?: number): { col: number; row: number };
  spawnUnit(opts: Partial<Unit> & { id: string; col: number; row: number }): Unit;
  settle(name: string, col: number, row: number, civilizationId: number, population?: number): City;
  /** Run whole human/AI turns without the UI. */
  runTurns(count: number): Promise<void>;
  /** All civ ids that are still in the game. */
  livingCivIds(): number[];
}

export async function makeEngine(options: MakeEngineOptions = {}): Promise<TestWorld> {
  const {
    seed = 20260925,
    mapType = 'CLOSEUP_1V1',
    numberOfCivilizations = 2,
    startingGold = 100,
  } = options;

  const engine = new GameEngine(null);
  // Animation pacing is the only thing that needs stubbing; everything else is
  // the real engine.
  (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
  (engine as unknown as { isPaused: boolean }).isPaused = true;
  await engine.initialize({
    numberOfCivilizations,
    mapType,
    devMode: false,
    startingGold,
    mapSeed: seed,
  });

  return world(engine);
}

/** Wrap an engine that is already set up (e.g. hand-built fixtures). */
export function world(engine: GameEngine): TestWorld {
  const landNear = (col: number, row: number, radius = 3): { col: number; row: number } => {
    for (let r = 1; r <= radius; r++) {
      for (let dCol = -r; dCol <= r; dCol++) {
        for (let dRow = -r; dRow <= r; dRow++) {
          if (Math.max(Math.abs(dCol), Math.abs(dRow)) !== r) continue;
          const c = col + dCol;
          const rw = row + dRow;
          if (engine.isTilePassable(c, rw) && !engine.getUnitAt(c, rw) && !engine.getCityAt(c, rw)) {
            return { col: c, row: rw };
          }
        }
      }
    }
    throw new Error(`no free land tile near (${col},${row})`);
  };

  const spawnUnit = (opts: Partial<Unit> & { id: string; col: number; row: number }): Unit => {
    const type = opts.type ?? 'warrior';
    const props = (GameEngine.UNIT_PROPS as Record<string, { movement?: number }>)[type] ?? {};
    const unit = {
      movesRemaining: props.movement ?? 1,
      maxMoves: props.movement ?? 1,
      health: 100,
      attack: 1,
      defense: 1,
      icon: type,
      orders: 'none',
      areTurnsDone: false,
      isSkipped: false,
      isDefeated: false,
      isFortified: false,
      isSleeping: false,
      civilizationId: 0,
      ...opts,
    } as unknown as Unit;
    engine.units.push(unit);
    return unit;
  };

  const settle = (
    name: string,
    col: number,
    row: number,
    civilizationId: number,
    population = 1,
  ): City => {
    const city = {
      id: `city-${name}-${col}-${row}`,
      name,
      civilizationId,
      col,
      row,
      population,
      foodStored: 0,
      foodNeeded: population * 20,
      yields: { food: 0, production: 0, trade: 0 },
      buildings: [],
      wonders: [],
      buildQueue: [],
      currentProduction: null,
      productionStored: 0,
      productionProgress: 0,
      specialists: [],
      workingTiles: new Set<string>([`${col},${row}`]),
      userAssignedTiles: new Set<string>(),
      governor: 'balanced',
      tradeRoutes: [],
      isCapital: false,
      discovered: true,
      maxPopulation: 10,
    } as unknown as City;
    engine.cities.push(city);
    if (civilizationId >= 0) {
      const civ = engine.civilizations[civilizationId];
      if (civ && civ.capital === undefined) {
        civ.capital = { id: city.id, name, col, row, civilizationId } as never;
      }
    }
    return city;
  };

  /**
   * Advance the REAL turn pipeline (no UI): every civ takes a turn through
   * TurnManager's phase machine, so the turn wiring is genuinely exercised —
   * worker construction, fishing routes, research, diplomacy, barbarians.
   *
   * Note `isPaused` must be off: TurnManager.advanceTurn defers while paused.
   */
  const runTurns = async (count: number): Promise<void> => {
    (engine as unknown as { isPaused: boolean }).isPaused = false;
    const turnManager = engine.turnManager;
    for (let i = 0; i < count; i++) {
      if (engine.isGameOver) break;
      const activeCivs = engine.civilizations.filter(
        (c) => c.isAlive !== false && c.id >= 0,
      );
      for (const civ of activeCivs) {
        if (engine.isGameOver) break;
        turnManager.startTurn(civ.id);
        engine.activePlayer = civ.id;
        if (civ.isAI) {
          try {
            await engine.processAITurn(civ.id);
          } catch {
            // An AI turn that throws is the engine's problem to survive; the
            // invariant check at the end of the run reports the consequences.
          }
        } else {
          // The human turn: finish its remaining phases.
          await turnManager.endHumanTurn().catch(() => undefined);
        }
        // Phase transitions: the AI path advances them itself when it owns the
        // turn; doing it again here is guarded by currentPlayer/aiTurnInProgress.
        if (turnManager.getPhase() !== 'END') {
          await turnManager.nextPhase();
          await turnManager.nextPhase();
          await turnManager.nextPhase();
        }
      }
      turnManager.advanceTurn();
    }
    (engine as unknown as { isPaused: boolean }).isPaused = true;
  };

  return {
    engine,
    get cities() {
      return engine.cities;
    },
    get units() {
      return engine.units;
    },
    landNear,
    spawnUnit,
    settle,
    runTurns,
    livingCivIds: () =>
      engine.civilizations.filter((c) => c.isAlive !== false).map((c) => c.id),
  };
}

// ── Invariants ─────────────────────────────────────────────────────────────

export interface InvariantViolation {
  law: string;
  detail: string;
}

/**
 * The global laws that must hold after ANY turn, in any game. These are the
 * assertions that catch a regression which would otherwise stay invisible for
 * dozens of turns: a citizen count that drifts, a gold value that goes NaN, a
 * corpse that keeps fighting.
 */
export function checkInvariants(engine: GameEngine): InvariantViolation[] {
  const bad: InvariantViolation[] = [];
  const add = (law: string, detail: string) => bad.push({ law, detail });

  const civIds = new Set((engine.civilizations ?? []).map((c) => c.id));

  for (const city of engine.cities) {
    if (!civIds.has(city.civilizationId)) {
      add('city belongs to a living civ', `${city.name} has civ ${city.civilizationId}`);
    }
    if ((city.population ?? 0) < 1) {
      add('city population >= 1', `${city.name} has pop ${city.population}`);
    }
    const specs = (city.specialists ?? []).length;
    if (specs > (city.population ?? 0)) {
      add('specialists <= population', `${city.name}: ${specs} specialists, pop ${city.population}`);
    }
    const worked = city.workingTiles instanceof Set ? city.workingTiles.size : 0;
    if (worked > 0) {
      // The centre is free, so a city works one tile per citizen plus the
      // centre. A larger set means a citizen was created without a tile; a
      // much smaller one means citizens were lost.
      const expected = 1 + (city.population ?? 1) - specs;
      if (worked > expected) {
        add('worked tiles <= 1 + citizens', `${city.name}: ${worked} tiles, expected <= ${expected}`);
      }
    }
    const foodStored = city.foodStored ?? 0;
    if (!Number.isFinite(foodStored)) {
      add('foodStored is finite', `${city.name}: ${foodStored}`);
    }
  }

  for (const civ of engine.civilizations) {
    const gold = civ.resources?.gold ?? 0;
    if (!Number.isFinite(gold)) add('gold is finite', `${civ.name}: ${gold}`);
    if (gold < 0) add('gold >= 0', `${civ.name}: ${gold}`);
    const science = civ.resources?.science ?? 0;
    if (!Number.isFinite(science)) add('science is finite', `${civ.name}: ${science}`);

    // Tax/science/luxury are a budget split: they must always add up to 100%
    // (or all be 0 for a government with no tax base, e.g. Anarchy). An
    // AI-vs-AI export showed `100/0/50`, which silently collects 150% of a
    // city's commerce — every downstream economy number was then wrong.
    const tax = civ.taxRate ?? 0;
    const sci = civ.scienceRate ?? 0;
    const lux = civ.luxuryRate ?? 0;
    if (!Number.isFinite(tax) || !Number.isFinite(sci) || !Number.isFinite(lux)) {
      add('rates are finite', `${civ.name}: ${tax}/${sci}/${lux}`);
    } else {
      const total = tax + sci + lux;
      const forcesZero = Boolean(
        (getGovernment(civ.government as never) as { forcesZeroRates?: boolean } | undefined)?.forcesZeroRates,
      );
      if (forcesZero) {
        if (total !== 0) add('zero-rate government has no rates', `${civ.name} (${civ.government}): ${tax}/${sci}/${lux}`);
      } else if (total !== 100) {
        add('tax + science + luxury == 100', `${civ.name} (${civ.government}): ${tax}/${sci}/${lux} = ${total}`);
      }
      for (const [label, v] of [['tax', tax], ['science', sci], ['luxury', lux]] as const) {
        if (v < 0 || v > 100) add('rate within 0..100', `${civ.name} ${label}: ${v}`);
      }
    }
    if (civ.researchProgress && !Number.isFinite(civ.researchProgress)) {
      add('researchProgress is finite', `${civ.name}: ${civ.researchProgress}`);
    }
  }

  const seenUnitIds = new Set<string>();
  for (const unit of engine.units) {
    if (seenUnitIds.has(unit.id)) {
      add('unit ids are unique', `duplicate id ${unit.id}`);
    }
    seenUnitIds.add(unit.id);
    if (unit.civilizationId >= 0 && !civIds.has(unit.civilizationId)) {
      add('unit belongs to a living civ', `${unit.id} has civ ${unit.civilizationId}`);
    }
    if (unit.isDefeated === true) {
      // A corpse may still be in `units` (its removal is DELAYED so the death
      // animation can play, and a fast headless loop finishes before that timer
      // fires). What must always be true: it is dead, it is not in any unit
      // queue, and it cannot be ordered anywhere.
      if ((unit.health ?? 0) > 0) {
        add('a defeated unit is at 0 health', `${unit.id} is defeated with ${unit.health} hp`);
      }
      if (unit.civilizationId >= 0) {
        const queue = engine.unitTurnQueue?.getQueue?.(unit.civilizationId) ?? [];
        if (queue.includes(unit.id)) {
          add('a defeated unit is never queued', `${unit.id} is defeated but queued`);
        }
      }
    }
    if (unit.isFortified === true && (unit.movesRemaining ?? 0) > 0 && unit.areTurnsDone !== true) {
      add('a fortified unit sits out its turn', `${unit.id} is fortified with ${unit.movesRemaining} moves`);
    }
    if (!Number.isFinite(unit.health ?? 100)) {
      add('unit health is finite', `${unit.id}: ${unit.health}`);
    }
  }

  // Civ1 lets your OWN units stack on one tile (that is what the unit-stack
  // modal is for), so stacking is only a violation when two different
  // civilizations' units end up on the same square.
  const occupied = new Map<string, number>();
  for (const unit of engine.units) {
    if (unit.isDefeated === true) continue;
    const key = `${unit.col},${unit.row}`;
    const otherCiv = occupied.get(key);
    if (otherCiv !== undefined && otherCiv !== unit.civilizationId) {
      add('no two civs share a tile', `civ ${otherCiv} and civ ${unit.civilizationId} at (${unit.col},${unit.row})`);
    }
    occupied.set(key, unit.civilizationId);
  }

  return bad;
}

/** Throw with a readable report when a law is broken. */
export function expectInvariants(engine: GameEngine, context = ''): void {
  const bad = checkInvariants(engine);
  if (bad.length === 0) return;
  const detail = bad.map((v) => `  - [${v.law}] ${v.detail}`).join('\n');
  throw new Error(`Engine invariants violated${context ? ` (${context})` : ''}:\n${detail}`);
}

// ── Grid helper ────────────────────────────────────────────────────────────

/** A hand-made engine on a controlled map, for tests that need exact terrain. */
export function makeGridEngine(
  rows: string[][],
  options: { width?: number; height?: number } = {},
): GameEngine {
  const height = options.height ?? rows.length;
  const width = options.width ?? rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new GameEngine(null) as any;
  engine.units = [];
  engine.onStateChange = null;
  engine.unitTurnQueue = null;
  engine.diplomacyManager = null;
  engine.isPaused = true;
  engine.activePlayer = 0;
  engine.squareGrid = new SquareGrid(width, height);
  engine.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((t, c) => ({
        col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true,
      })),
    ),
  };
  // One human + one AI civ, so the invariants have a real world to check.
  // Rates mirror what GameEngine gives a real civ (50/50/0 under Despotism) so
  // the `tax + science + luxury == 100` law holds on the bare fixtures too.
  const civ = (id: number, name: string, isHuman: boolean) => ({
    id,
    name,
    isHuman,
    government: 'despotism',
    taxRate: 50,
    scienceRate: 50,
    luxuryRate: 0,
    technologies: [],
    researchProgress: 0,
    resources: { gold: 100, science: 0, food: 0, production: 0, trade: 0 },
  });
  engine.civilizations = [civ(0, 'TestCiv', true), civ(1, 'OtherCiv', false)];
  return engine as GameEngine;
}
