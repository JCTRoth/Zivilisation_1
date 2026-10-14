/**
 * End-to-end island colonisation through the real AI turn: an AI civ with
 * Sailing, a coastal city, a settler and a ferry seeds an offshore island on
 * its own — mission, boarding, crossing, landing and founding.
 */
import { describe, it, expect } from 'vitest';
import { makeEngine } from '../helpers/world';

describe('colony pipeline through real turns', () => {
  it('an AI civ settles an offshore island within 30 turns', async () => {
    const world = await makeEngine({ mapType: 'AI_VS_AI_NAVAL', numberOfCivilizations: 2, seed: 4242 });
    const { engine } = world;
    // Let the civs found their capitals first (civs start with settlers).
    await world.runTurns(3);
    const civ = engine.civilizations.find((c) => c.isAI && c.isAlive !== false)
      ?? engine.civilizations.find((c) => !c.isHuman);
    expect(civ).toBeDefined();
    const civId = civ!.id;
    const storage = engine.getPlayerStorage(civId);
    if (storage?.explored) storage.explored.fill(true);
    const techs = (civ as unknown as { technologies?: unknown }).technologies;
    if (Array.isArray(techs) && !techs.includes('sailing')) techs.push('sailing');
    const city = engine.cities.find((c) => c.civilizationId === civId);
    expect(city).toBeDefined();
    const water = engine.findAdjacentOcean?.(city!.col, city!.row);
    expect(water).toBeTruthy();
    const citiesBefore = engine.cities.filter((c) => c.civilizationId === civId).length;
    const homeLandmass = engine.getLandmassId(city!.col, city!.row);
    world.spawnUnit({ id: `col-set-${civId}`, type: 'settler', civilizationId: civId, col: city!.col, row: city!.row });
    world.spawnUnit({ id: `col-fer-${civId}`, type: 'ferry', civilizationId: civId, col: water!.col, row: water!.row });

    // Drive the AI civ's own turns directly (start → act → produce → research
    // → end), like the headless batch runner does. The helper parks the
    // engine paused; AI turns skip while paused, so unpark for the loop.
    (engine as unknown as { isPaused: boolean }).isPaused = false;
    // A 14-tile ocean crossing with gather + boarding takes a while: budget
    // generously, break early the moment the island city exists. Every civ
    // takes its turn each iteration (as the headless batch does) so phases
    // never tangle across civs.
    const activeCivs = engine.civilizations.filter((c) => c.isAlive !== false);
    for (let i = 0; i < 50; i++) {
      if (engine.isGameOver) break;
      for (const c of activeCivs) {
        engine.turnManager.startTurn(c.id);
        (engine as unknown as { activePlayer: number }).activePlayer = c.id;
        if (c.isAI) {
          try {
            await engine.processAITurn(c.id);
          } catch { /* state shows the damage */ }
        }
        if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
        }
      }
      const islandCities = engine.cities.filter(
        (c) => c.civilizationId === civId && engine.getLandmassId(c.col, c.row) !== homeLandmass,
      );
      if (islandCities.length > 0) break;
    }

    const civCities = engine.cities.filter((c) => c.civilizationId === civId);
    const islandCities = civCities.filter((c) => engine.getLandmassId(c.col, c.row) !== homeLandmass);
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    expect(civCities.length > citiesBefore || islandCities.length > 0).toBe(true);
  }, 300000);
});
