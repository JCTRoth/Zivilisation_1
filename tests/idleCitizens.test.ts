/**
 * A city with more citizens than fields has IDLE citizens — mouths it feeds
 * that produce nothing. They become Entertainers automatically, so the tile
 * list and the specialist list always add up and the city still gets something
 * (happiness) out of a citizen it could not employ.
 *
 * The conversion lives in `EconomicManager.cityWorkedTiles`, i.e. it is an
 * engine rule for every city, not an AI preference: the governor may staff
 * SPARE citizens as Taxmen or Scientists, but a citizen with no field has no
 * choice to make.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City } from '../types/game';

const G = 'grassland';

function makeEngine(size: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(size, size);
  e.map = {
    width: size,
    height: size,
    tiles: Array.from({ length: size * size }, (_, i) => {
      const col = i % size;
      const row = Math.floor(i / size);
      return { id: `${col},${row}`, col, row, type: G, terrain: G, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Cornerfolk', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
  ];
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, pop: number): City {
  const city = {
    id: `city_${name}`,
    name,
    civilizationId: 0,
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

describe('idle citizens become Entertainers', () => {
  it('staffs the overflow when the city has fewer fields than citizens', () => {
    const engine = makeEngine(11);
    // A corner city only has 7 field slots outside its centre, but 10 citizens.
    const city = addCity(engine, 'Corner', 0, 0, 10);

    engine.economicManager.recomputeCityYields(city);

    expect(city.workingTiles!.size).toBe(8); // centre + all 7 fields
    expect(city.specialists).toHaveLength(3); // 10 − 7
    expect(city.specialists!.every((s) => s === 'entertainer')).toBe(true);
    // Tile list + specialists covers every citizen (the centre is free).
    expect(city.workingTiles!.size + city.specialists!.length).toBe(city.population! + 1);
  });

  it('adds nothing when every citizen has a field', () => {
    const engine = makeEngine(11);
    const city = addCity(engine, 'Open', 5, 5, 6);

    engine.economicManager.recomputeCityYields(city);

    expect(city.specialists ?? []).toHaveLength(0);
    expect(city.workingTiles!.size).toBe(7); // centre + one per citizen
  });

  it('keeps the count stable over repeated recomputes', () => {
    const engine = makeEngine(11);
    const city = addCity(engine, 'Corner', 0, 0, 10);

    engine.economicManager.recomputeCityYields(city);
    const first = city.specialists!.length;
    for (let i = 0; i < 5; i++) engine.economicManager.recomputeCityYields(city);

    expect(city.specialists!.length).toBe(first);
    expect(city.workingTiles!.size).toBe(8);
  });

  it('counts tiles a besieging enemy has taken out of production', () => {
    const engine = makeEngine(11);
    const city = addCity(engine, 'Besieged', 5, 5, 12);
    // Ten of the city's twenty fields are under enemy boots: only ten remain,
    // so two citizens have nothing to do.
    let placed = 0;
    for (let dCol = -2; dCol <= 2 && placed < 10; dCol++) {
      for (let dRow = -2; dRow <= 2 && placed < 10; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;
        engine.units.push({
          id: `enemy_${placed}`,
          type: 'warrior',
          col: city.col + dCol,
          row: city.row + dRow,
          civilizationId: 1,
          attack: 1,
          defense: 1,
          health: 100,
          isDefeated: false,
          movesRemaining: 0,
        } as never);
        placed++;
      }
    }

    engine.economicManager.recomputeCityYields(city);

    expect(city.workingTiles!.size).toBe(11); // centre + the 10 free fields
    expect(city.specialists).toHaveLength(2);
    expect(city.specialists!.every((s) => s === 'entertainer')).toBe(true);
  });
});
