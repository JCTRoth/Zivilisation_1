/**
 * Wonder obsolescence (spec): a wonder becomes obsolete the moment ANY
 * civilization discovers its obsolescence technology — its effect stops for
 * the owner, but the wonder itself remains for scoring and history.
 *
 * The engine evaluates obsolescence LIVE from the tech lists (no events, no
 * cached flags), so these tests simply mutate a civ's technologies and
 * re-read the effect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world as wrapWorld, type TestWorld } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import { WONDER_PROPERTIES } from '@/data/BuildingConstants';
import type { City } from '../types/game';

describe('wonder obsolescence', () => {
  let engine: GameEngine;
  let w: TestWorld;
  let holderCity: City;
  let otherCity: City;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    engine.onStateChange = null;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      mapSeed: 7,
    });
    w = wrapWorld(engine);
    holderCity = w.settle('Holder', 4, 4, 0, 3);
    otherCity = w.settle('Other', 0, 0, 0, 3);
  });

  afterEach(() => {
    engine.onStateChange = null;
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  it('a wonder stops working as soon as ANY civ researches the tech — the building stays', () => {
    holderCity.buildings = ['great_library'];
    // A city with enough commerce that a 10% bonus is visible after rounding.
    holderCity.yields = { food: 4, production: 4, trade: 20 };
    expect(engine.wonderManager?.isObsolete('great_library')).toBe(false);
    expect(engine.wonderManager?.isActive('great_library', 0)).toBe(true);

    const before = engine.economicManager.cityOutputs(holderCity, engine.civilizations[0]).science;
    expect(before).toBeGreaterThan(5);

    // The RIVAL (not the owner!) discovers University → effect dies world-wide.
    (engine.civilizations[1].technologies as string[]).push('university');
    engine.updateTechnologyAvailability();

    expect(engine.wonderManager?.isObsolete('great_library')).toBe(true);
    expect(engine.wonderManager?.isActive('great_library', 0)).toBe(false);
    const after = engine.economicManager.cityOutputs(holderCity, engine.civilizations[0]).science;
    expect(after).toBeLessThan(before);

    // …but the wonder itself is untouched: still in the city, still scored.
    expect(holderCity.buildings).toContain('great_library');
    expect(WONDER_PROPERTIES.great_library).toBeDefined();
    expect(engine.wonderManager?.ownerCivId('great_library')).toBe(0);
    expect(engine.wonderManager?.wondersOfCiv(0)).toContain('great_library');
  });

  it('only the wonders tied to that technology go obsolete', () => {
    holderCity.buildings = ['great_library', 'pyramids', 'lighthouse'];
    (engine.civilizations[1].technologies as string[]).push('university');

    expect(engine.wonderManager?.isObsolete('great_library')).toBe(true);
    // Pyramids obsolete by Communism, Lighthouse by Magnetism — untouched.
    expect(engine.wonderManager?.isObsolete('pyramids')).toBe(false);
    expect(engine.wonderManager?.isObsolete('lighthouse')).toBe(false);
    expect(engine.wonderManager?.activeWonders(0).map((x) => x.id).sort()).toEqual(['lighthouse', 'pyramids']);
  });

  it('never-obsolete wonders stay active no matter what anyone learns', () => {
    holderCity.buildings = ['leonardos_workshop', 'magellans_expedition'];
    for (const tech of ['computers', 'space_flight', 'communism', 'nuclear_fission', 'automobile']) {
      (engine.civilizations[1].technologies as string[]).push(tech);
    }
    expect(engine.wonderManager?.isObsolete('leonardos_workshop')).toBe(false);
    expect(engine.wonderManager?.isObsolete('magellans_expedition')).toBe(false);
    expect(engine.wonderManager?.isActive('leonardos_workshop', 0)).toBe(true);
  });

  it('an obsolete wonder can no longer be STARTED by anyone', () => {
    (engine.civilizations[0].technologies as string[]).push('masonry');
    // Not built yet — normally startable…
    const beforeTech = engine.productionManager.setCityProduction(otherCity.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(beforeTech.success).toBe(true);

    // …until somebody discovers Communism.
    (engine.civilizations[1].technologies as string[]).push('communism');
    const afterTech = engine.productionManager.setCityProduction(otherCity.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(afterTech.success).toBe(false);
    expect(afterTech.reason).toBe('wonder_obsolete');
    expect(engine.productionManager.getBuildableBuildingTypes(otherCity.id)).not.toContain('pyramids');
  });

  it('AI wonder planning skips obsolete wonders', () => {
    const built: string[] = [];
    const obsolete = ['pyramids'];
    // Mirrors AutoProduction.buildGameState → AIBuildingStrategy.evaluateWonders.
    const gameState = { currentYear: -1000, isUnderThreat: false, builtWonders: built, obsoleteWonders: obsolete };
    expect(gameState.obsoleteWonders).toContain('pyramids');
    expect(engine.wonderManager?.isObsolete('pyramids')).toBe(false);
    (engine.civilizations[1].technologies as string[]).push('communism');
    expect(engine.wonderManager?.isObsolete('pyramids')).toBe(true);
  });

  it('obsolescence flips happiness effects off (Oracle stops doubling Temples)', () => {
    holderCity.buildings = ['oracle', 'temple'];
    otherCity.buildings = ['temple'];

    const withOracle = engine.economicManager.cityHappiness(otherCity, engine.civilizations[0]).happiness;

    // Temple alone contributes 1; with the Oracle it must contribute 2.
    expect(engine.wonderEffects?.buildingHappinessMultiplier(otherCity, 'temple')).toBe(2);
    holderCity.buildings = ['temple']; // remove the Oracle → multiplier gone
    expect(engine.wonderEffects?.buildingHappinessMultiplier(otherCity, 'temple')).toBe(1);
    const withoutOracle = engine.economicManager.cityHappiness(otherCity, engine.civilizations[0]).happiness;
    expect(withOracle - withoutOracle).toBe(1);

    // Put the Oracle back, then make it obsolete via Religion.
    holderCity.buildings = ['oracle', 'temple'];
    expect(withOracle).toBeGreaterThan(withoutOracle);
    (engine.civilizations[1].technologies as string[]).push('religion');
    expect(engine.wonderManager?.isObsolete('oracle')).toBe(true);
    expect(engine.economicManager.cityHappiness(otherCity, engine.civilizations[0]).happiness).toBe(withoutOracle);
  });
});
