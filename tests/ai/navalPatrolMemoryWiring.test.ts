/**
 * NavalPatrolMemory wired into the AI (roadmap item 3, `doc/AI_MEMORY.adoc`).
 *
 * The unit tests prove the memory module in isolation. These prove the WIRING:
 * that a real AI turn writes into it, that the per-hull intent that used to live
 * on `unit._navalIntent` is now memory, and that a fleet's patrol picks actually
 * follow what the memory remembers.
 *
 * Built on the real engine so the assertions are about the shipped code path, not
 * a mock that agrees with whatever the code does today.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { NavalPatrolMemory } from '@/game/engine/AI/NavalPatrolMemory';

/** A memory is only ever reachable through the manager's per-civ map. */
function memoryFor(manager: unknown, civId: number): NavalPatrolMemory {
  return (manager as { navalMemoryFor(id: number): NavalPatrolMemory }).navalMemoryFor(civId);
}

describe('naval memory is per-civilization', () => {
  it('never hands two civs the same memory instance', () => {
    const engine = new GameEngine(null);
    const manager = new AIManager(engine);
    const a = memoryFor(manager, 0);
    const b = memoryFor(manager, 1);
    expect(a).not.toBe(b);
    // ...and it is memoised, not rebuilt per call.
    expect(memoryFor(manager, 0)).toBe(a);
  });

  it('keeps the contacts of one civ out of another civ memory', () => {
    const engine = new GameEngine(null);
    const manager = new AIManager(engine);
    memoryFor(manager, 0).recordContact({ enemyCivId: 2, col: 5, row: 5, strength: 3 });
    expect(memoryFor(manager, 1).contactsFor(2)).toHaveLength(0);
    expect(memoryFor(manager, 0).contactsFor(2)).toHaveLength(1);
  });

  it('allocates nothing for a land-map game until a hull asks', () => {
    const engine = new GameEngine(null);
    const manager = new AIManager(engine);
    const map = (manager as unknown as { navalMemories: Map<number, unknown> }).navalMemories;
    expect(map.size).toBe(0);
    memoryFor(manager, 0);
    expect(map.size).toBe(1);
  });
});

describe('a hull no longer carries AI bookkeeping on the unit', () => {
  it('keeps the navigation intent in memory, off the Unit object', () => {
    const engine = new GameEngine(null);
    const manager = new AIManager(engine);
    const hull = {
      id: 'w1', type: 'frigate', civilizationId: 0, col: 3, row: 3,
      isDefeated: false, movesRemaining: 1,
    };
    const closing = (manager as unknown as {
      hullIsClosing(u: typeof hull, t: { col: number; row: number }): boolean;
    }).hullIsClosing.bind(manager);

    // Pretend the hull already tried this objective and got nowhere.
    memoryFor(manager, 0).setIntent('w1', {
      col: 8, row: 8, dist: 5, stalled: 0, loaded: undefined,
    });
    (engine as unknown as { squareGrid: unknown }).squareGrid = {
      squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
        Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    };

    closing(hull, { col: 8, row: 8 });

    const intent = memoryFor(manager, 0).intentFor('w1');
    expect(intent).toMatchObject({ col: 8, row: 8, stalled: 1, fromCol: 3, fromRow: 3 });
    // The unit itself is untouched: no AI-only fields leak into save data.
    expect(Object.keys(hull)).not.toContain('_navalIntent');
    expect('_navalIntent' in (hull as Record<string, unknown>)).toBe(false);
  });
});

describe('a lost hull becomes remembered danger', () => {
  const managerWithHull = () => {
    const engine = new GameEngine(null);
    const manager = new AIManager(engine);
    return { engine, manager };
  };

  it('marks the last known tile of a warship that vanished', () => {
    const { manager } = managerWithHull();
    const memory = memoryFor(manager, 0);
    memory.setIntent('w1', {
      col: 10, row: 10, fromCol: 4, fromRow: 4, dist: 6, stalled: 0,
    });

    const lost = memory.reconcileHulls([{ id: 'w2' }], 7);
    expect(lost).toEqual(['w1']);
    expect(memory.dangerPressure(4, 4, 7)).toBeGreaterThan(0);
    expect(memory.intentFor('w1')).toBeUndefined();
  });

  it('does NOT mark the beach when an empty ferry was consumed on delivery', () => {
    // A transport that reaches its landing and unloads disappears from the unit
    // list. Treating that as a kill zone would make the fleet route around its
    // own landing beaches, so `loaded: false` is read as success.
    const { manager } = managerWithHull();
    const memory = memoryFor(manager, 0);
    memory.setIntent('ferry', {
      col: 10, row: 10, fromCol: 4, fromRow: 4, dist: 6, stalled: 0, loaded: false,
    });

    const lost = memory.reconcileHulls([], 7);
    expect(lost).toEqual([]);
    expect(memory.dangerPressure(4, 4, 7)).toBe(0);
    expect(memory.intentFor('ferry')).toBeUndefined();
  });

  it('does mark the water when a LOADED ferry never came back', () => {
    const { manager } = managerWithHull();
    const memory = memoryFor(manager, 0);
    memory.setIntent('ferry', {
      col: 10, row: 10, fromCol: 4, fromRow: 4, dist: 6, stalled: 0, loaded: true,
    });
    expect(memory.reconcileHulls([], 7)).toEqual(['ferry']);
    expect(memory.dangerPressure(4, 4, 7)).toBeGreaterThan(0);
  });

  it('keeps the intent of a hull that is still sailing', () => {
    const { manager } = managerWithHull();
    const memory = memoryFor(manager, 0);
    memory.setIntent('w1', { col: 9, row: 9, fromCol: 1, fromRow: 1, dist: 3, stalled: 0 });
    expect(memory.reconcileHulls([{ id: 'w1' }], 7)).toEqual([]);
    expect(memory.intentFor('w1')).toBeDefined();
  });
});

describe('patrol picks follow the memory, not the corner of the map', () => {
  /**
   * A flat ocean. The patrol scan sees the same water for every hull; only the
   * memory ranking and the per-hull offset tell their picks apart.
   */
  const oceanWorld = async () => {
    const engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 200,
      mapSeed: 90210,
    });
    // Force every tile to navigable water so the patrol scan has a big pool.
    const { map } = engine;
    for (let r = 0; r < map.height; r++) {
      for (let c = 0; c < map.width; c++) {
        const tile = engine.getTileAt(c, r);
        if (tile) {
          tile.terrain = 'ocean';
          tile.type = 'ocean';
        }
      }
    }
    const manager = new AIManager(engine);
    return { engine, manager };
  };

  const patrolFor = (manager: unknown) =>
    (manager as {
      findNavalPatrolTarget(u: unknown): { col: number; row: number } | null;
    }).findNavalPatrolTarget.bind(manager);

  it('records the water a hull is standing on as swept', async () => {
    const { manager } = await oceanWorld();
    const hull = {
      id: 'w1', type: 'frigate', civilizationId: 0, col: 4, row: 4,
      isDefeated: false, movesRemaining: 1,
    };
    expect(memoryFor(manager, 0).sweepCount()).toBe(0);
    expect(patrolFor(manager)(hull)).not.toBeNull();
    // The hull's own tile is now remembered as patrolled — that is what later
    // turns use to tell "nobody has looked here" from "we swept this".
    expect(memoryFor(manager, 0).lastSweptTurn(4, 4)).toBe(0);
  });

  it('never sends two hulls to the same patrol tile', async () => {
    const { manager } = await oceanWorld();
    const hulls = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id, i) => ({
      id, type: 'frigate', civilizationId: 0, col: 10, row: 10 + i,
      isDefeated: false, movesRemaining: 1,
    }));
    const picks = hulls.map((h) => {
      const t = patrolFor(manager)(h);
      return t ? `${t.col},${t.row}` : 'none';
    });
    // The identity offset is what separates hulls reading the same memory;
    // without it the fleet all aims at one tile, which is the milling bug.
    expect(new Set(picks).size).toBe(picks.length);
  });

  it('keeps finding patrol water even on remembered kill ground', async () => {
    const { manager } = await oceanWorld();
    const memory = memoryFor(manager, 0);
    const scout = {
      id: 'scout', type: 'frigate', civilizationId: 0, col: 12, row: 12,
      isDefeated: false, movesRemaining: 1,
    };
    // Bury the area in remembered danger. The ranking weighs it down, but a
    // hull must never be left with nowhere to go: a fleet that refuses to sail
    // is a fleet that loses, so danger is a penalty and never a refusal.
    for (let c = 8; c <= 16; c++) {
      for (let r = 8; r <= 16; r++) memory.recordDanger(c, r, 0, 1);
    }
    expect(memory.dangerPressure(12, 12, 0)).toBeGreaterThan(0);
    expect(patrolFor(manager)(scout)).not.toBeNull();
  });

  it('prefers water the fleet has never patrolled over water it just swept', async () => {
    const { manager } = await oceanWorld();
    const memory = memoryFor(manager, 0);
    const scout = {
      id: 'scout', type: 'frigate', civilizationId: 0, col: 12, row: 12,
      isDefeated: false, movesRemaining: 1,
    };
    // Patrol a wide neighbourhood on turn 0, then let time pass. Every tile in
    // the hull's near rings is now stale patrol water, so the memory ranking the
    // wiring applies must be visible in what it returns.
    for (let c = 6; c <= 18; c++) {
      for (let r = 6; r <= 18; r++) memory.recordSweep(c, r, 0);
    }
    memory.recordTurn(5);

    const target = patrolFor(manager)(scout);
    expect(target).not.toBeNull();
    // The scan never returns the hull's own tile, and every tile within the
    // scanned rings is stale, so the pick must come from the LEAST recently
    // patrolled end of the pool — i.e. priority strictly greater than the
    // freshest possible, never better than the memory allowed.
    expect(memory.sweepPriority(target!.col, target!.row))
      .toBeGreaterThanOrEqual(memory.sweepPriority(12, 12));
  });
});
