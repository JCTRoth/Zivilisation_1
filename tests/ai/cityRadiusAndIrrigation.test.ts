/**
 * Two settler rules that the AI must never break:
 *
 *  1. **Founding** — the AI never places a city inside the radius of one of
 *     its OWN cities. A city works a 5×5 area, so two cities closer than
 *     Chebyshev 5 compete for the same tiles and one of the settlers was
 *     wasted. It is an absolute rule, so it lives in one engine method that
 *     every founding path consults (settler founding, the context menu, and
 *     the Advanced-Tribe village hut, which used to be able to land a city
 *     two tiles from an existing one).
 *
 *  2. **Irrigation** — from city size 6 the AI sends its settlers to irrigate
 *     and pave the tiles around that city. The ONLY two things that stop it
 *     are a direct threat to the city and attacks still going on there.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import type { City, Unit } from '../../types/game';

const G = 'grassland';
const R = 'river';

/** 11×11 grassland with a river down column 2 — irrigation in reach of a city. */
function riverMap(): string[][] {
  return Array.from({ length: 11 }, (_row, _r) =>
    Array.from({ length: 11 }, (_col, c) => (c === 2 ? R : G)),
  );
}

function makeEngine(layout: string[][], civs: Array<{ id: number; name: string; isHuman?: boolean }>) {
  const height = layout.length;
  const width = layout[0].length;
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
    tiles: layout.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = civs.map((c) => ({
    id: c.id,
    name: c.name,
    isHuman: c.isHuman ?? false,
    isAlive: true,
    technologies: [],
    resources: { gold: 100 },
  }));
  e.diplomacyManager = new DiplomacyManager(e as GameEngine);
  e.diplomacyManager.initialize(civs.map((c) => c.id));
  for (const c of civs) e.initializePlayerStorage(c.id);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number, pop: number) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: pop,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
    workingTiles: new Set<string>(),
  };
  engine.cities.push(city as never);
  return city as City;
}

function addUnit(
  engine: GameEngine,
  opts: Partial<Unit> & { id: string; col: number; row: number; civilizationId: number },
) {
  const unit = {
    health: 100,
    isDefeated: false,
    attack: 1,
    defense: 1,
    movesRemaining: 3,
    movement: 1,
    type: 'warrior',
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ai = (engine: GameEngine) => engine.aiManager as any;

/** Every tile of a city's workable area (centre and far corners dropped). */
function areaTiles(city: City): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let dCol = -2; dCol <= 2; dCol++) {
    for (let dRow = -2; dRow <= 2; dRow++) {
      if (dCol === 0 && dRow === 0) continue;
      if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;
      out.push({ col: city.col + dCol, row: city.row + dRow });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Founding inside an own city's radius is forbidden
// ---------------------------------------------------------------------------

describe('an AI never founds inside its own city radius', () => {
  const layout = Array.from({ length: 11 }, () => Array(11).fill(G));

  it('rejects every tile closer than MIN_CITY_CENTER_DISTANCE to an own city', () => {
    const engine = makeEngine(layout, [{ id: 0, name: 'Settlers' }]);
    addCity(engine, 'Home', 5, 5, 0, 3);

    // Chebyshev 0..4 → inside the 5×5 workable area → illegal.
    for (let d = 0; d <= 4; d++) {
      expect(engine.canPlaceCityAt(5 + d, 5, 0), `distance ${d}`).toBe(false);
      expect(engine.canPlaceCityAt(5, 5 + d, 0), `distance ${d}`).toBe(false);
    }
    // Exactly MIN_CITY_CENTER_DISTANCE is legal.
    expect(engine.canPlaceCityAt(10, 5, 0)).toBe(true);
    expect(engine.canPlaceCityAt(5, 0, 0)).toBe(true);
  });

  it('holds even when the civ is not flagged isAI (the rule must not be losable)', () => {
    const engine = makeEngine(layout, [{ id: 0, name: 'Settlers' }]);
    addCity(engine, 'Home', 5, 5, 0, 3);
    const civ = engine.civilizations[0] as { isAI?: boolean; isHuman?: boolean };
    civ.isAI = false;
    civ.isHuman = undefined;

    expect(engine.canPlaceCityAt(7, 5, 0)).toBe(false);
  });

  it('leaves the human player free to found next door', () => {
    const engine = makeEngine(layout, [{ id: 0, name: 'Player', isHuman: true }]);
    addCity(engine, 'Home', 5, 5, 0, 3);
    expect(engine.canPlaceCityAt(6, 5, 0)).toBe(true);
  });

  it('foundCityWithSettler refuses the founding and leaves no city behind', () => {
    const engine = makeEngine(layout, [{ id: 0, name: 'Settlers' }]);
    addCity(engine, 'Home', 5, 5, 0, 3);
    const settler = addUnit(engine, { id: 's1', type: 'settler', col: 7, row: 5, civilizationId: 0 });

    expect(engine.foundCityWithSettler(settler.id)).toBe(false);
    expect(engine.cities).toHaveLength(1);
    expect(engine.units.some((u) => u.id === 's1')).toBe(true);

    // The same settler five tiles away is fine.
    settler.col = 10;
    settler.row = 5;
    expect(engine.canPlaceCityAt(10, 5, 0)).toBe(true);
    expect(engine.foundCityWithSettler(settler.id)).toBe(true);
    expect(engine.cities).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. From size 6 the settlers irrigate the city's surroundings
// ---------------------------------------------------------------------------

describe('size-6 cities get their fields irrigated', () => {
  function withCity(population: number) {
    const engine = makeEngine(riverMap(), [{ id: 0, name: 'Growers' }, { id: 1, name: 'Rivals' }]);
    const city = addCity(engine, 'Bigtown', 5, 3, 0, population);
    // Saturate the civ-wide improvement budget: 10 of the 20 area tiles are
    // already improved, so `wantsPublicWorks` is false and the mandate has to
    // carry the decision on its own.
    const tiles = areaTiles(city);
    for (const { col, row } of tiles.slice(0, 10)) {
      const tile = engine.map!.tiles[row * engine.map!.width + col];
      (tile as { improvement?: string }).improvement = 'road';
    }
    const settler = addUnit(engine, { id: 'w1', type: 'settler', col: 5, row: 4, civilizationId: 0 });
    return { engine, city, settler, tiles };
  }

  it('recognises a city as mature only from size 6 on', () => {
    const { engine, city } = withCity(5);
    expect(ai(engine).hasMatureCity(0)).toBe(false);
    city.population = 6;
    expect(ai(engine).hasMatureCity(0)).toBe(true);
    expect(ai(engine).hasSettlerWorksMandate(0)).toBe(true);
  });

  it('tasks a settler with the city fields even when the works budget is spent', () => {
    const { engine, settler } = withCity(6);
    // Budget is exhausted (10 improvements, budget 2) — the mandate still fires.
    expect(ai(engine).wantsPublicWorks(0)).toBe(false);

    const target = ai(engine).findInfrastructureWorksTarget(settler);
    expect(target).not.toBeNull();
    expect(Math.max(Math.abs(target.col - 5), Math.abs(target.row - 3))).toBeLessThanOrEqual(2);
  });

  it('picks an irrigable tile for the mature city rather than any road site', () => {
    const { engine, settler } = withCity(6);
    const target = ai(engine).findInfrastructureWorksTarget(settler) as { col: number; row: number };
    const tile = engine.map!.tiles[target.row * engine.map!.width + target.col];
    expect(tile.improvement).toBeUndefined();
    expect((tile as { type?: string }).type).toBe(G);
    // Three tiles off the river at column 2 — inside irrigation reach.
    expect(target.col).toBeGreaterThan(2);
  });

  it('a size-5 city gets nothing while the budget is spent', () => {
    const { engine, settler } = withCity(5);
    expect(ai(engine).findInfrastructureWorksTarget(settler)).toBeNull();
  });

  it('lays a road first while the city trade cannot cover its unhappiness', () => {
    const { engine, settler } = withCity(6);
    // Size 6 with raw tiles: unhappy, and the trade it has is nowhere near
    // enough to buy luxury — so the road (commerce) beats irrigation (food).
    expect(ai(engine).chooseImprovementForSettler(settler)).toBe('road');
  });

  it('goes back to irrigation once the city is content', () => {
    const { engine, city, settler } = withCity(6);
    // Happiness buildings cover the six unhappy citizens, so the city is no
    // longer paying for its own contentment and can afford to grow again.
    city.buildings = ['temple', 'colosseum', 'cathedral'];
    expect(ai(engine).chooseImprovementForSettler(settler)).toBe('irrigation');
  });

  it('refuses while an enemy stands next to the city (direct threat)', () => {
    const { engine, settler } = withCity(6);
    addUnit(engine, { id: 'raider', col: 6, row: 3, civilizationId: 1 });

    expect(ai(engine).findInfrastructureWorksTarget(settler)).toBeNull();
    expect(ai(engine).chooseImprovementForSettler(settler)).toBeNull();
  });

  it('refuses while the city is still being attacked (ongoing attacks)', () => {
    const { engine, city, settler } = withCity(6);
    city.lastAttackedRound = 0; // assaulted this very round

    expect(ai(engine).findInfrastructureWorksTarget(settler)).toBeNull();
    expect(ai(engine).chooseImprovementForSettler(settler)).toBeNull();
  });

  it('resumes once the attack is over', () => {
    const { engine, city, settler } = withCity(6);
    city.lastAttackedRound = 0;
    expect(ai(engine).findInfrastructureWorksTarget(settler)).toBeNull();

    // ONGOING_ATTACK_WINDOW is 6 rounds; well past it the fields are safe.
    (engine as unknown as { roundManager?: unknown }).roundManager = {
      getRoundNumber: () => 20,
    };
    expect(ai(engine).findInfrastructureWorksTarget(settler)).not.toBeNull();
  });
});
