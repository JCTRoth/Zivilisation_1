import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';

/**
 * Verify that changing the civ's Science Rate actually changes per-turn
 * research accumulation (bug report: "changing the Science Rate does not
 * change research time").
 *
 * First test drives the economy directly; the second drives the REAL turn
 * pipeline (advanceTurn → processTurnEvents) to make sure the rate flows all
 * the way into research progress.
 */
describe('Science rate affects research', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
  });

  afterEach(() => {
    (engine as any).units = [];
    (engine as any).cities = [];
    (engine as any).civilizations = [];
  });

  const foundCity = () => {
    const civ = engine.civilizations[0];
    const settler = engine.units.find((u: any) => u.type === 'settler' && u.civilizationId === 0);
    if (settler) engine.foundCityWithSettler(settler.id);
    const city = engine.cities.find((c: any) => c.civilizationId === 0);
    if (city) {
      city.population = 3;
      (engine as any).economicManager?.recomputeCityYields?.(city);
    }
    return { civ, city };
  };

  const scienceForRate = (scienceRate: number): number => {
    const civ = engine.civilizations[0];
    engine.economicManager?.setRates(civ.id, 100 - scienceRate, scienceRate, 0);
    const result = engine.economicManager?.processTurn(civ);
    return result?.science ?? civ.resources?.science ?? 0;
  };

  it('a city produces more science at a higher science rate', () => {
    foundCity();
    const at50 = scienceForRate(50);
    const at100 = scienceForRate(100);
    expect(at100).toBeGreaterThan(at50);
  });

  it('research progress per round scales with the science rate through the real turn pipeline', () => {
    const { civ } = foundCity();
    // The engine refuses to start research during the opening rounds.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    (engine as any).setResearch?.(0, 'pottery');
    civ.researchProgress = 0;
    const tm = engine.turnManager as any;

    // Round at 100% science.
    engine.economicManager?.setRates(0, 0, 100, 0);
    // eslint-disable-next-line no-console
    console.log('[DEBUG] before: currentPlayer=', tm.currentPlayer, 'phase=', tm.currentPhase, 'research=', civ.currentResearch?.id, 'scienceRate=', civ.scienceRate, 'resources.science=', civ.resources?.science);
    tm.advanceTurn(); // human -> AI
    // eslint-disable-next-line no-console
    console.log('[DEBUG] after 1st advanceTurn: currentPlayer=', tm.currentPlayer, 'phase=', tm.currentPhase, 'resources.science=', civ.resources?.science, 'researchProgress=', civ.researchProgress);
    tm.advanceTurn(); // AI -> human (processes human economy + research)
    // eslint-disable-next-line no-console
    console.log('[DEBUG] after 2nd advanceTurn: currentPlayer=', tm.currentPlayer, 'phase=', tm.currentPhase, 'resources.science=', civ.resources?.science, 'researchProgress=', civ.researchProgress);
    const progress100 = civ.researchProgress;

    // Round at 25% science.
    civ.researchProgress = 0;
    engine.economicManager?.setRates(0, 75, 25, 0);
    tm.advanceTurn();
    tm.advanceTurn();
    const progress25 = civ.researchProgress;

    expect(progress100).toBeGreaterThan(0);
    expect(progress100).toBeGreaterThan(progress25);
  });
});
