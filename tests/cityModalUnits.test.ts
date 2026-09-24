import { describe, it, expect } from 'vitest';
import { CityModalLogic } from '@/components/ui/gamemodals/CityModalLogic';
import type { City, Unit } from '../types/game';
import type GameEngine from '@/game/engine/GameEngine';

/**
 * The city screen's Units tab: the garrison on the city tile plus every unit
 * the city supports (homeCityId), de-duplicated, without defeated or foreign
 * units.
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

  it('lists the garrison first, then supported units, once each', () => {
    const garrison = unit({ id: 'garrison', col: 5, row: 5 });
    const supported = unit({ id: 'settler', type: 'settler', col: 9, row: 9, homeCityId: 'city-1' });
    const both = unit({ id: 'boat', type: 'trireme', col: 5, row: 5, homeCityId: 'city-1' });
    const foreign = unit({ id: 'foreign', civilizationId: 1, col: 5, row: 5 });
    const dead = unit({ id: 'dead', col: 5, row: 5, isDefeated: true });

    const engine = {
      units: [foreign, supported, dead, both, garrison],
    } as unknown as GameEngine;

    const logic = new CityModalLogic(city, engine, null, city as never);
    const ids = logic.getCityUnits().map((u) => u.id);

    // Garrison (engine order), then supported units; 'both' appears once.
    expect(ids).toEqual(['boat', 'garrison', 'settler']);
  });

  it('returns an empty list when nothing is tied to the city', () => {
    const engine = { units: [unit({ id: 'far', col: 20, row: 20 })] } as unknown as GameEngine;
    const logic = new CityModalLogic(city, engine, null, city as never);
    expect(logic.getCityUnits()).toEqual([]);
  });
});
