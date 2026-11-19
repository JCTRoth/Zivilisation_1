import { describe, it, expect } from 'vitest';
import { makeEngine, type TestWorld } from './helpers/world';
import GameEngine from '@shared/game/engine/GameEngine';
import { mulberry32 } from '@shared/game/engine/Rng';

/**
 * Split blocker 1 — one engine RNG, seeded from the lobby seed.
 *
 * A server room and a browser lobby that start from the same seed must reach
 * the same state after the same commands; otherwise a replay, a reconnect or a
 * second room diverges silently. These tests pin that property at the engine
 * boundary (the seeded test harness pins the ambient Math.random too, but a
 * server has many rooms and cannot share one global stream).
 */

describe('engine-owned RNG', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(4242);
    const b = mulberry32(4242);
    const streamA = Array.from({ length: 32 }, () => a());
    expect(streamA).toEqual(Array.from({ length: 32 }, () => b()));
    expect(new Set(streamA).size).toBeGreaterThan(1);
  });

  it('seeds the engine stream from the lobby seed', () => {
    const a = new GameEngine(null);
    const b = new GameEngine(null);
    a.seedRng(99);
    b.seedRng(99);
    expect(Array.from({ length: 16 }, () => a.rng()))
      .toEqual(Array.from({ length: 16 }, () => b.rng()));
  });

  it('generates ids from a deterministic counter, not a timestamp', async () => {
    const build = async () => {
      const world = await makeEngine({ rngSeed: 7 });
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const spot = world.landNear(origin.col, origin.row, 5);
      const first = world.spawnUnit({ id: world.engine.nextId('u'), type: 'warrior', col: spot.col, row: spot.row });
      const second = world.spawnUnit({ id: world.engine.nextId('u'), type: 'warrior', col: spot.col + 1, row: spot.row });
      return [first.id, second.id];
    };
    expect(await build()).toEqual(['u_1', 'u_2']);
    expect(await build()).toEqual(['u_1', 'u_2']);
  });

  it('rolls combat from the engine RNG, not the ambient Math.random', async () => {
    const fight = async (roll: number): Promise<number> => {
      const world = await makeEngine({ rngSeed: 1 });
      world.engine.setRng(() => roll);
      const origin = world.units.find((u) => u.civilizationId === 0)!;
      const spot = world.landNear(origin.col, origin.row, 5);
      const attacker = world.spawnUnit({
        id: 'duel_attacker', type: 'warrior', col: spot.col, row: spot.row, health: 100, movesRemaining: 2,
      });
      const defender = world.spawnUnit({
        id: 'duel_defender', type: 'warrior', civilizationId: 1,
        col: spot.col + 1, row: spot.row, health: 100,
      });
      world.engine.combatUnit(attacker, defender);
      return defender.health;
    };

    // 0.01 always wins the roll for the attacker; 0.99 always loses it.
    expect(await fight(0.01)).toBeLessThan(await fight(0.99));
  });

  it('runs corpse-removal deadlines off simulation ticks when the clock is enabled', async () => {
    const world = await makeEngine({ rngSeed: 3 });
    world.engine.enableTickClock();
    world.engine.setRng(() => 0.01); // attacker always wins the roll
    const removed: string[] = [];
    world.engine.onStateChange = (type, data) => {
      if (type === 'UNIT_REMOVED') removed.push(String((data as { unit: { id: string } }).unit.id));
    };
    const origin = world.units.find((u) => u.civilizationId === 0)!;
    const spot = world.landNear(origin.col, origin.row, 5);
    const attacker = world.spawnUnit({
      id: 'tick_attacker', type: 'warrior', col: spot.col, row: spot.row, health: 100, movesRemaining: 2,
    });
    const victim = world.spawnUnit({
      id: 'tick_victim', type: 'warrior', civilizationId: 1,
      col: spot.col + 1, row: spot.row, health: 1,
    });

    world.engine.combatUnit(attacker, victim);
    expect(victim.isDefeated).toBe(true);
    expect(world.engine.units.some((u) => u.id === victim.id)).toBe(true);

    for (let i = 0; i < Math.ceil(1500 / GameEngine.TICK_MS); i++) world.engine.advanceTick();
    expect(world.engine.units.some((u) => u.id === victim.id)).toBe(false);
    expect(removed).toContain(victim.id);
  });

  it('replays the same game from the same seed and command stream', async () => {
    const snapshot = (engine: GameEngine) => JSON.stringify({
      turn: engine.currentTurn,
      player: engine.activePlayer,
      units: engine.units.map((u) => [u.id, u.type, u.col, u.row, u.health, u.civilizationId, u.movesRemaining]),
      cities: engine.cities.map((c) => [c.id, c.name, c.population, c.civilizationId]),
      gold: engine.civilizations.map((c) => (c.resources as { gold?: number } | undefined)?.gold),
    });

    const play = async (): Promise<string> => {
      const world: TestWorld = await makeEngine({ seed: 12345, rngSeed: 4242, numberOfCivilizations: 2 });
      world.engine.setPaused(false);
      await world.runTurns(4);
      return snapshot(world.engine);
    };

    const first = await play();
    const second = await play();
    expect(first).toBe(second);
    expect(JSON.parse(first).turn).toBeGreaterThan(1);
  });
});
