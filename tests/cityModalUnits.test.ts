import { describe, it, expect } from 'vitest';
import { CityModalLogic } from '@/components/ui/gamemodals/CityModalLogic';
import type { City, Unit } from '../types/game';
import type GameEngine from '@/game/engine/GameEngine';

/**
 * The city screen's Units tab: only the units standing INSIDE the city (the
 * garrison). A unit that merely has this city as its home city but is out on
 * the map must not be listed — that belongs to the turn queue.
 */
describe('CityModalLogic.getCityUnits', () => {
  const city = {
    id: 'city-1', name: 'Port', civilizationId: 0, col: 5, row: 5,
    population: 3, buildings: [], specialists: [], workingTiles: new Set<string>(),
  } as unknown as City;

  const unit = (over: Partial<Unit>): Unit => ({
    id: 'u', type: 'warrior', civilizationId: 0, col: 0, row: 0,
    movesRemaining: 1, health: 100, icon: 'warrior', ...over,
  });

  it('lists only the units standing on the city tile', () => {
    const garrison = unit({ id: 'garrison', col: 5, row: 5 });
    const boat = unit({ id: 'boat', type: 'trireme', col: 5, row: 5 });
    const abroad = unit({ id: 'settler', type: 'settler', col: 9, row: 9, homeCityId: 'city-1' });
    const foreign = unit({ id: 'foreign', civilizationId: 1, col: 5, row: 5 });
    const dead = unit({ id: 'dead', col: 5, row: 5, isDefeated: true });

    const engine = {
      units: [foreign, abroad, dead, boat, garrison],
    } as unknown as GameEngine;

    const logic = new CityModalLogic(city, engine, null, city as never);
    const ids = logic.getCityUnits().map((u) => u.id);

    // Garrison + the boat sitting in the city; the unit out on the map
    // (homeCityId) is NOT part of the city's roster.
    expect(ids).toEqual(['boat', 'garrison']);
  });

  it('returns an empty list when nothing is inside the city', () => {
    const engine = {
      units: [unit({ id: 'far', col: 20, row: 20, homeCityId: 'city-1' })],
    } as unknown as GameEngine;
    const logic = new CityModalLogic(city, engine, null, city as never);
    expect(logic.getCityUnits()).toEqual([]);
  });
});
