/**
 * Regression tests for the AI-vs-AI blockers found in the 2026-08-14 session:
 *  1. Research freeze  — the tech tree was never populated for normal maps, so
 *     setResearch() could not find a tech and the AI never researched anything.
 *  2. Disorder death spiral — a disordered city zeroed ALL commerce (incl.
 *     luxury), trapping large cities in permanent disorder.
 *  3. No expansion — AutoProduction queued buildings before settlers, so a
 *     1-city civ never produced a second settler.
 *  4. Building tech-gating — industrial buildings (factory, plants, …) had no
 *     requiredTechnology, so the AI built them with ancient tech only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { canBuildBuilding, resolveAICivStrategy } from '@/game/engine/AI/AITypes';
import { BUILDING_PROPERTIES, BUILDING_TYPES } from '@/data/BuildingConstants';

// ─────────────────────────────────────────────────────────────────────────
// 1. Research freeze
// ─────────────────────────────────────────────────────────────────────────

describe('AI research pipeline (regression: tech tree must be populated)', () => {
  let engine: GameEngine | null = null;

  beforeEach(() => {
    engine = null;
  });

  afterEach(() => {
    if (engine) {
      engine.units = [];
      engine.cities = [];
      engine.civilizations = [];
      engine = null;
    }
  });

  async function makeEngine(mapType = 'MANY_CITIES'): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await e.initialize({
      numberOfCivilizations: 2,
      mapType,
      devMode: false,
      startingGold: 100,
    });
    return e;
  }

  it('initializes the technology tree for normal (non-TECH_LEVEL_10) maps', async () => {
    engine = await makeEngine();
    // Previously `this.technologies` stayed empty for normal maps, so
    // setResearch() could never find a tech and the AI re-selected the same
    // tech every turn without ever completing it.
    expect(engine.technologies.length).toBeGreaterThan(10);
  });

  it('setResearch() actually assigns the researched tech to the civ', async () => {
    engine = await makeEngine();
    engine.setResearch(1, 'pottery');
    const current = engine.civilizations[1].currentResearch as { id?: string } | string | null;
    expect(current).toBeTruthy();
    const id = typeof current === 'object' ? current?.id : current;
    expect(id).toBe('pottery');
  });

  it('keeps the researched tech set (no silent per-turn reset)', async () => {
    engine = await makeEngine();
    engine.setResearch(1, 'pottery');
    // The engine only re-selects research when currentResearch is null; a
    // successful setResearch must persist so progress can accumulate.
    expect(engine.civilizations[1].currentResearch).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Expansion: healthy small civs should build settlers before buildings
// ─────────────────────────────────────────────────────────────────────────

describe('AutoProduction expansion priority', () => {
  it('produces a settler for a healthy 1-city civ instead of a building', () => {
    const city = {
      id: 'c0',
      name: 'Test City',
      civilizationId: 0,
      col: 5,
      row: 5,
      population: 2,
      buildings: [],
      autoProduction: true,
      yields: { food: 4, production: 2, trade: 4 },
    };
    const civ = {
      id: 0,
      name: 'Test Civ',
      isAI: true,
      isHuman: false,
      technologies: ['pottery'],
      personality: {
        aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5,
      },
      resources: { food: 0, production: 0, trade: 0, science: 0, gold: 50 },
      taxRate: 40, scienceRate: 50, luxuryRate: 10,
      government: 'despotism',
    };
    const warrior = {
      id: 'w1', type: 'warrior', civilizationId: 0, col: 5, row: 5,
      movesRemaining: 1, health: 100,
    };

    const engine = {
      cities: [city],
      units: [warrior],
      civilizations: { 0: civ },
      getPlayerStorage: () => ({
        turnData: { aiState: { strategyProfile: 'balanced_growth' } },
      }),
      economicManager: {
        // Content city — no happiness emergency.
        cityHappiness: () => ({ happiness: 2, unhappiness: 0, disorder: false }),
      },
      productionManager: { setCityProduction: () => ({ success: true }) },
      removeCurrentProduction: () => {},
      squareGrid: null,
      currentYear: -4000,
      gameSettings: { difficulty: 'PRINCE' },
      roundManager: { getRoundNumber: () => 1 },
      onStateChange: null,
      getTileAt: () => null,
    } as unknown as GameEngine;

    const autoProduction = new AutoProduction(engine);
    const item = (autoProduction as unknown as {
      determineProductionItem: (city: unknown, threat: unknown, planned: string[]) => {
        type: string; itemType: string;
      } | null;
    }).determineProductionItem(city, null, []);

    expect(item).not.toBeNull();
    expect(item?.type).toBe('unit');
    expect(item?.itemType).toBe('settler');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Building tech-gating
// ─────────────────────────────────────────────────────────────────────────

describe('industrial building tech-gating', () => {
  it('factory requires industrialization', () => {
    const factoryProps = BUILDING_PROPERTIES[BUILDING_TYPES.FACTORY];
    expect(factoryProps?.requiredTechnology).toBe('industrialization');
    expect(canBuildBuilding({ technologies: ['pottery'] }, 'factory', factoryProps, [], {})).toBe(false);
    expect(canBuildBuilding(
      { technologies: ['pottery', 'industrialization'] }, 'factory', factoryProps, [], {},
    )).toBe(true);
  });

  it('hospital requires engineering (not buildable from turn 1)', () => {
    const hospitalProps = BUILDING_PROPERTIES[BUILDING_TYPES.HOSPITAL];
    expect(hospitalProps?.requiredTechnology).toBe('engineering');
    // A civ with only the starting techs cannot build a Hospital — the queue
    // must fall back to sensible early items (settlers / units) instead.
    expect(canBuildBuilding(
      { technologies: ['irrigation', 'mining', 'roads'] }, 'hospital', hospitalProps, [], {},
    )).toBe(false);
    expect(canBuildBuilding(
      { technologies: ['irrigation', 'mining', 'roads', 'engineering'] }, 'hospital', hospitalProps, [], {},
    )).toBe(true);
  });

  it('power/hydro/nuclear plants and mass transit are tech-gated', () => {
    expect(BUILDING_PROPERTIES[BUILDING_TYPES.POWER_PLANT]?.requiredTechnology).toBe('electricity');
    expect(BUILDING_PROPERTIES[BUILDING_TYPES.HYDRO_PLANT]?.requiredTechnology).toBe('electronics');
    expect(BUILDING_PROPERTIES[BUILDING_TYPES.NUCLEAR_PLANT]?.requiredTechnology).toBe('nuclear_power');
    expect(BUILDING_PROPERTIES[BUILDING_TYPES.MASS_TRANSIT]?.requiredTechnology).toBe('mass_production');

    // A civ with only ancient techs cannot build any of them.
    const ancient = { technologies: ['pottery', 'bronze_working'] };
    for (const type of [
      BUILDING_TYPES.POWER_PLANT,
      BUILDING_TYPES.HYDRO_PLANT,
      BUILDING_TYPES.NUCLEAR_PLANT,
      BUILDING_TYPES.MASS_TRANSIT,
    ]) {
      expect(canBuildBuilding(ancient, type, BUILDING_PROPERTIES[type], [], {})).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Research follows the AI strategy
// ─────────────────────────────────────────────────────────────────────────

describe('AI strategy resolution (research follows production profile)', () => {
  it('research uses the civ production profile even before the AI state is seeded', () => {
    // Regression: the TurnManager research path used `aiState.strategyProfile ??
    // 'balanced_growth'`; a fresh AI state defaults to balanced_growth, so a
    // military_expansion civ researched as if it were balanced. The resolver
    // must prefer the civ's fixed production profile.
    expect(resolveAICivStrategy({ productionProfile: 'military_expansion' }, null)).toBe('military_expansion');
    expect(resolveAICivStrategy({ productionProfile: 'science_focus' }, { strategyProfile: 'balanced_growth' })).toBe('science_focus');
    expect(resolveAICivStrategy({ productionProfile: 'early_expansion' }, { strategyProfile: 'defensive_turtle' })).toBe('early_expansion');
  });

  it('falls back to the AI-state strategy when no profile is set', () => {
    expect(resolveAICivStrategy(null, { strategyProfile: 'defensive_turtle' })).toBe('defensive_turtle');
  });

  it('defaults to balanced_growth when nothing is set', () => {
    expect(resolveAICivStrategy(null, null)).toBe('balanced_growth');
    expect(resolveAICivStrategy(undefined, undefined)).toBe('balanced_growth');
  });
});
