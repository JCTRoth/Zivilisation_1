import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { Unit } from '@/../types/game';

/**
 * Same-tile combat: two enemy units stacked on one tile must be able to attack
 * each other (getUnitAt returns the FIRST unit on a tile, so a same-tile enemy
 * could previously be masked by the attacker itself and never fought).
 */
describe('Same-tile attacks', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    (e as any).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  function spawnUnit(e: GameEngine, id: string, civ: number, type: string, col: number, row: number, attack: number, defense: number): any {
    const unit = {
      id, civilizationId: civ, type, col, row,
      movesRemaining: 2, maxMoves: 2, health: 100,
      attack, defense, isFortified: false, hasMovedThisTurn: false,
    };
    (e as any).units.push(unit);
    return unit;
  }

  it('canUnitMoveTo allows a unit to attack an enemy stacked on its own tile', async () => {
    const e = await setup();
    const tile = e.getTileAt(10, 10) as any;
    const attacker = spawnUnit(e, 'att', 0, 'warrior', tile.col, tile.row, 1, 1);
    spawnUnit(e, 'def', 1, 'warrior', tile.col, tile.row, 1, 1);

    expect(e.canUnitMoveTo(attacker.id, tile.col, tile.row)).toBe(true);
  });

  it('moveUnit onto an enemy stacked on the same tile triggers combat', async () => {
    const e = await setup();
    const tile = e.getTileAt(10, 10) as any;
    const attacker = spawnUnit(e, 'att2', 0, 'archer', tile.col, tile.row, 3, 2);
    spawnUnit(e, 'def2', 1, 'warrior', tile.col, tile.row, 1, 1);

    const res = e.moveUnit(attacker.id, tile.col, tile.row);

    // Combat must have been RESOLVED (same-tile attack), not a no-op self-move
    // — the outcome itself is random, so either victory or defeat proves it.
    expect(['combat_victory', 'combat_defeat']).toContain(res.reason);
  });

  it('a unit cannot "move" onto its own tile when no enemy is stacked there', async () => {
    const e = await setup();
    const tile = e.getTileAt(10, 10) as any;
    const attacker = spawnUnit(e, 'att3', 0, 'warrior', tile.col, tile.row, 1, 1);

    expect(e.canUnitMoveTo(attacker.id, tile.col, tile.row)).toBe(false);
    const res = e.moveUnit(attacker.id, tile.col, tile.row);
    expect(res.success).toBe(false);
  });

  it('moving a fortified unit breaks its fortification (Civ1)', async () => {
    const e = await setup();
    const spot = e.getTileAt(10, 10) as any;
    const target = e.squareGrid!.getNeighbors(10, 10).find((n: any) => {
      const t = e.getTileAt(n.col, n.row) as any;
      return t && t.type !== 'ocean' && t.type !== 'mountains' && !e.getUnitAt(n.col, n.row);
    })!;
    const warrior = spawnUnit(e, 'fort', 0, 'warrior', spot.col, spot.row, 1, 1);
    warrior.isFortified = true;

    const res = e.moveUnit(warrior.id, target.col, target.row);
    expect(res.success).toBe(true);
    expect(warrior.isFortified).toBe(false);
  });
});

/**
 * AI fortification: a combat unit garrisoned at/next to a friendly city with
 * no other order should fortify (+50% defense).
 */
describe('AI fortify when defending a city', () => {
  const dist = (c1: number, r1: number, c2: number, r2: number) =>
    Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

  function makeEngine(unit: Partial<Unit> & { col: number; row: number; civilizationId: number }) {
    const city = { id: 'c1', name: 'Berlin', civilizationId: 1, col: 10, row: 10, population: 3 };
    const u: Unit = {
      id: unit.id ?? 'defender',
      type: unit.type ?? 'warrior',
      civilizationId: unit.civilizationId,
      col: unit.col,
      row: unit.row,
      movesRemaining: unit.movesRemaining ?? 1,
      health: 100,
      attack: unit.attack ?? 1,
      defense: unit.defense ?? 1,
      icon: 'warrior',
      isFortified: unit.isFortified ?? false,
    };
    const engine: any = {
      map: { width: 40, height: 40 },
      devMode: false,
      units: [u],
      cities: [city],
      getPlayerStorage: () => ({ enemyLocations: new Map() }),
      roundManager: { getRoundNumber: () => 0 },
      squareGrid: { squareDistance: dist, getNeighbors: () => [] },
      getUnitAt: (c: number, r: number) => [u].find((x: any) => x.col === c && x.row === r) ?? null,
      getCityAt: () => null,
      getTileAt: (c: number, r: number) => ({ col: c, row: r, type: 'grassland', passable: true }),
      isExploredByPlayer: () => true,
    };
    return { engine, unit: u };
  }

  it('a combat unit on a friendly city tile should fortify', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 10, row: 10 });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(true);
  });

  it('a combat unit adjacent to a friendly city should fortify', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 11, row: 10 });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(true);
  });

  it('a combat unit far from any friendly city should NOT fortify', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 30, row: 30 });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(false);
  });

  it('an already-fortified unit should not be re-fortified', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 10, row: 10, isFortified: true });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(false);
  });

  it('a civilian/non-combat unit at a city should NOT fortify', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 10, row: 10, type: 'settler', attack: 0, defense: 1 });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(false);
  });

  it('a combat unit near an ENEMY city should not fortify (not protecting our city)', () => {
    const { engine, unit } = makeEngine({ civilizationId: 1, col: 20, row: 20 });
    engine.cities.push({ id: 'enemy-city', name: 'Enemy', civilizationId: 2, col: 21, row: 20, population: 2 });
    const ai = new AIManager(engine);
    expect((ai as any).shouldFortifyForDefense(unit)).toBe(false);
  });
});
