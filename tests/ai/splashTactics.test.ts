/**
 * Splash tactics: hunt clusters on open ground, refuse to form them.
 *
 *  - Target pick: a 3-stack two tiles out outranks the lone unit next door;
 *    under a roof (or for civilians) nearest wins exactly as before.
 *  - March discipline: combat steps divert around allied stacks on open
 *    ground, but pile onto cities and fortresses as before.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { scoreStackTarget, stackStepRisk, STACK_RISK_LIMIT } from '@/game/engine/AI/AITactics';
import type { City, Unit } from '../../types/game';

const G = 'grassland';

const FIELD = [
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
];

function makeEngine() {
  const height = FIELD.length;
  const width = FIELD[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: FIELD.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Hunters', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
    { id: 1, name: 'Clustered', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
  ];
  const enemies = new Map<string, number[]>();
  e.diplomacyManager = {
    getEnemies: (civId: number) => enemies.get(String(civId)) ?? [],
    isAtWar: (a: number, b: number) => (enemies.get(String(a)) ?? []).includes(b),
    declareWar: (a: number, b: number) => {
      const list = enemies.get(String(a)) ?? [];
      if (!list.includes(b)) list.push(b);
      enemies.set(String(a), list);
      const back = enemies.get(String(b)) ?? [];
      if (!back.includes(a)) back.push(a);
      enemies.set(String(b), back);
    },
  };
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: 3,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
  };
  engine.cities.push(city as never);
  return city as City;
}

function addUnit(engine: GameEngine, opts: Partial<Unit> & { id: string; col: number; row: number }) {
  const unit = {
    civilizationId: 0,
    health: 100,
    movesRemaining: 2,
    maxMoves: 2,
    isDefeated: false,
    attack: 2,
    defense: 2,
    hitPoints: 2,
    maxHitPoints: 2,
    movement: 1,
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const managerOf = (engine: GameEngine) => engine.aiManager as any;

describe('stack target scoring', () => {
  it('ranks an open-ground cluster above a nearer lone unit', () => {
    const lone = scoreStackTarget({ stackSize: 1, distance: 1, openGround: true });
    const cluster = scoreStackTarget({ stackSize: 3, distance: 3, openGround: true });
    expect(cluster).toBeGreaterThan(lone);
  });

  it('ignores stacking under a roof', () => {
    const single = scoreStackTarget({ stackSize: 1, distance: 2, openGround: false });
    const roofed = scoreStackTarget({ stackSize: 4, distance: 2, openGround: false });
    expect(roofed).toBe(single);
  });

  it('still prefers nearer among equals', () => {
    const near = scoreStackTarget({ stackSize: 1, distance: 1, openGround: true });
    const far = scoreStackTarget({ stackSize: 1, distance: 4, openGround: true });
    expect(near).toBeGreaterThan(far);
  });
});

describe('stack step risk', () => {
  it('is zero under a roof, alone, or unthreatened', () => {
    expect(stackStepRisk({ ownStack: 2, openGround: false, enemyThreat: 10 })).toBe(0);
    expect(stackStepRisk({ ownStack: 0, openGround: true, enemyThreat: 10 })).toBe(0);
    expect(stackStepRisk({ ownStack: 2, openGround: true, enemyThreat: 0 })).toBe(0);
  });

  it('flags piling onto allies on threatened open ground', () => {
    expect(stackStepRisk({ ownStack: 2, openGround: true, enemyThreat: 30 })).toBeGreaterThan(STACK_RISK_LIMIT);
  });
});

describe('splash-aware target pick', () => {
  it('hunts the cluster, not the nearer single', () => {
    const e = makeEngine();
    addUnit(e, { id: 'hunter', type: 'warrior', col: 0, row: 2, attack: 3, defense: 2 });
    // Lone scout next door…
    addUnit(e, { id: 'lone', type: 'scout', col: 1, row: 2, civilizationId: 1, attack: 0.5, defense: 1 });
    // …and a warband two tiles out.
    addUnit(e, { id: 'w1', type: 'warrior', col: 3, row: 2, civilizationId: 1, attack: 3, defense: 2 });
    addUnit(e, { id: 'w2', type: 'warrior', col: 3, row: 2, civilizationId: 1, attack: 3, defense: 2 });
    addUnit(e, { id: 'w3', type: 'warrior', col: 3, row: 2, civilizationId: 1, attack: 3, defense: 2 });
    e.diplomacyManager.declareWar(0, 1);
    const hunter = e.units.find((u) => u.id === 'hunter')!;
    const picked = managerOf(e).pickSplashTarget(hunter, [
      { col: 1, row: 2, distance: 1, type: 'unit' },
      { col: 3, row: 2, distance: 3, type: 'unit' },
    ]);
    expect(picked).toEqual({ col: 3, row: 2, distance: 3, type: 'unit' });
  });

  it('keeps nearest-first for civilians and roofed stacks', () => {
    const e = makeEngine();
    const scout = addUnit(e, { id: 'sc', type: 'scout', col: 0, row: 2, attack: 0.5, defense: 1 });
    addUnit(e, { id: 'w1', type: 'warrior', col: 3, row: 2, civilizationId: 1, attack: 3, defense: 2 });
    addUnit(e, { id: 'w2', type: 'warrior', col: 3, row: 2, civilizationId: 1, attack: 3, defense: 2 });
    e.diplomacyManager.declareWar(0, 1);
    const picked = managerOf(e).pickSplashTarget(scout, [
      { col: 1, row: 2, distance: 1, type: 'unit' },
      { col: 3, row: 2, distance: 3, type: 'unit' },
    ]);
    // A scout never stack-hunts: nearest first, as before.
    expect(picked).toEqual({ col: 1, row: 2, distance: 1, type: 'unit' });
  });
});

describe('march de-stacking', () => {
  it('diverts a combat step around allies on open ground', () => {
    const e = makeEngine();
    const marcher = addUnit(e, { id: 'm', type: 'warrior', col: 0, row: 2, attack: 3, defense: 2 });
    addUnit(e, { id: 'a', type: 'warrior', col: 1, row: 2, attack: 3, defense: 2 });
    const diverted = managerOf(e).deStackStep(marcher, { col: 1, row: 2 }, { col: 5, row: 2 });
    expect(diverted).not.toBeNull();
    expect(diverted).not.toEqual({ col: 1, row: 2 });
  });

  it('piles onto cities and fortresses as before (immune ground)', () => {
    const e = makeEngine();
    addCity(e, 'Walls', 1, 2, 0);
    const marcher = addUnit(e, { id: 'm', type: 'warrior', col: 0, row: 2, attack: 3, defense: 2 });
    addUnit(e, { id: 'a', type: 'warrior', col: 1, row: 2, attack: 3, defense: 2 });
    expect(managerOf(e).deStackStep(marcher, { col: 1, row: 2 }, { col: 5, row: 2 })).toBeNull();

    const e2 = makeEngine();
    const m2 = addUnit(e2, { id: 'm', type: 'warrior', col: 0, row: 2, attack: 3, defense: 2 });
    addUnit(e2, { id: 'a', type: 'warrior', col: 1, row: 2, attack: 3, defense: 2 });
    (e2.getTileAt(1, 2) as { improvement?: string }).improvement = 'fortress';
    expect(managerOf(e2).deStackStep(m2, { col: 1, row: 2 }, { col: 5, row: 2 })).toBeNull();
  });

  it('leaves civilians and empty tiles alone', () => {
    const e = makeEngine();
    const settler = addUnit(e, { id: 's', type: 'settler', col: 0, row: 2, attack: 0, defense: 1 });
    addUnit(e, { id: 'a', type: 'warrior', col: 1, row: 2, attack: 3, defense: 2 });
    expect(managerOf(e).deStackStep(settler, { col: 1, row: 2 }, { col: 5, row: 2 })).toBeNull();

    const marcher = addUnit(e, { id: 'm', type: 'warrior', col: 0, row: 0, attack: 3, defense: 2 });
    expect(managerOf(e).deStackStep(marcher, { col: 1, row: 0 }, { col: 5, row: 0 })).toBeNull();
  });
});
