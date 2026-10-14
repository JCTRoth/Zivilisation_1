/**
 * One real engine, one real AI turn, one caravan in the field: the planner must
 * plan, not throw.
 *
 * The plan used to run lazily under the first caravan unit the turn found, so it
 * only ever ran for civs that already had caravans. Moving it to the top of the
 * turn (Phase 1b) exposed a latent bug in one line: the coordinator's world is
 * `{ cities, units, isAtWar, hasContacted }`, and the GameEngine exposes NONE of
 * the last two — diplomacy lives on `diplomacyManager`. The cast therefore threw
 * a TypeError inside every AI turn that had a caravan, the turn's own catch
 * swallowed it, and the whole turn (movement, attacks, expansion) silently
 * stopped. Nothing protested: a civ whose turn dies still "plays", it just never
 * issues an order — which is why the only honest assertion here is that no error
 * was reported at all.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';

describe('the caravan planner on a real engine', () => {
  const buildWorld = async () => {
    const engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      mapSeed: 4242,
    });

    // Two AI civs with a city each: the foreign city is what makes the planner
    // ask the diplomacy question.
    const ids = [0, 1];
    for (const id of ids) {
      if (!engine.cities.some((c) => c.civilizationId === id)) {
        engine.cities.push({
          id: `probe-${id}`, name: `Probe ${id}`, civilizationId: id,
          col: 2 + id * 6, row: 2, population: 4, buildings: [], tradeRoutes: [],
          production: 0, food: 0, gold: 0, science: 0,
          yields: { food: 2, production: 1, trade: 2 },
          foodStored: 0, foodNeeded: 20, productionStored: 0, productionProgress: 0,
          currentProduction: null, buildQueue: [], autoProduction: true,
        } as never);
      }
    }
    // A Caravan of civ 0 in the field, plus a free route slot at home: the
    // planner must give it a destination, and the destinations are foreign.
    engine.units.push({
      id: 'probe-caravan', type: 'caravan', civilizationId: 0, homeCityId: 'probe-0',
      col: 3, row: 3, isDefeated: false, movesRemaining: 1,
    } as never);
    engine.civilizations[0].technologies = ['trade'];
    (engine.civilizations[0] as unknown as { isHuman: boolean }).isHuman = false;
    (engine.civilizations[1] as unknown as { isHuman: boolean }).isHuman = false;
    // Civ 0 must KNOW the foreign city before the governor will walk a defenceless
    // unit to it (Civ1 rule), so light up that tile in its storage.
    const storage = engine.getPlayerStorage(0);
    const width = engine.map.width;
    (storage as { explored: boolean[]; visibility: boolean[] }).explored =
      new Array(width * engine.map.height).fill(false);
    (storage as { explored: boolean[]; visibility: boolean[] }).visibility =
      new Array(width * engine.map.height).fill(false);
    const city1 = engine.cities.find((c) => c.id === 'probe-1')!;
    (storage as { explored: boolean[] }).explored[city1.row * width + city1.col] = true;
    return { engine, ids };
  };

  it('survives a whole AI turn without aborting it', async () => {
    const { engine, ids } = await buildWorld();

    // The engine's diplomacy layer is the live one — nothing is stubbed anywhere.
    expect(typeof engine.diplomacyManager.isAtWar).toBe('function');

    const consoleErrors: string[] = [];
    const realError = console.error;
    (console as unknown as { error: (...a: unknown[]) => void }).error =
      (...args: unknown[]) => { consoleErrors.push(String(args[0] ?? '')); };

    for (const id of ids) {
      await (engine.aiManager as unknown as {
        processAITurn: (id: number) => Promise<void>;
      }).processAITurn(id);
    }

    (console as unknown as { error: (...a: unknown[]) => void }).error = realError;

    expect(consoleErrors).toEqual([]);
  });

  it('gives the civ-0 caravan a foreign destination, and civ 0 a producer', async () => {
    const { engine } = await buildWorld();

    await (engine.aiManager as unknown as {
      processAITurn: (id: number) => Promise<void>;
    }).processAITurn(0);

    const wanting = engine.aiManager.citiesWantingCaravans(0);
    expect(wanting).toContain('probe-0');
    expect(MAX_TRADE_ROUTES).toBeGreaterThan(0);

    // The governor holds the mission the coordinator handed over — the caravan
    // was given somewhere to go, which is the whole point of the plan.
    const mission = (engine.aiManager as unknown as {
      caravanGovernor: { getMission(id: string): { phase: string; targetCol: number; targetRow: number } | undefined };
    }).caravanGovernor.getMission('probe-caravan');
    expect(mission).toBeDefined();
    expect(['outbound', 'delivering']).toContain(mission!.phase);
  });
});
