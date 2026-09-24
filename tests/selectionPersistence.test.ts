import { describe, it, expect, beforeEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

/**
 * A unit the player is watching must stay selected when the turn changes.
 *
 * The auto turn manager used to deselect it twice on the way around:
 *  1. once the unit spent its moves the user lock was released and the queue
 *     focus picked another unit; and
 *  2. when the END phase cleared the queue, `onUnitQueueChange(null)` called
 *     `selectUnit(null)` and wiped even that selection right before TURN_END.
 *
 * Now the queue-empty clear leaves a living human-owned unit alone, so
 * TURN_END / AI_CLEAR_HIGHLIGHTS can re-assert it as a hand-made selection and
 * the player resumes with the same unit selected on their next turn.
 */
describe('unit selection survives turn changes', () => {
  let engine: GameEngine;
  let router: EngineEventRouter;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: unknown) =>
      router.handle(type, (data ?? {}) as Record<string, unknown>);

    useGameStore.setState((s) => ({
      ...s,
      gameState: {
        ...s.gameState,
        selectedUnit: null,
        activeUnit: null,
        selectedCity: null,
        focusedCity: null,
        selectionOrigin: null,
        selectedUnitIds: [],
      },
      uiState: { ...s.uiState, showUnitPanel: false, showCityPanel: false, activeDialog: null },
      units: engine.getAllUnits(),
      civilizations: engine.civilizations,
      cities: engine.getAllCities(),
      map: engine.map as never,
    }));
  });

  const state = () => useGameStore.getState();

  it('keeps the selected unit across a full turn cycle (router events)', () => {
    const humanUnit = engine.units.find((u) => u.civilizationId === 0)!;
    state().actions.selectUnit(humanUnit.id, 'user');

    // Human turn ends, AI plays, human turn starts again.
    router.handle('TURN_END', { civilizationId: 0 });
    engine.activePlayer = 1;
    router.handle('TURN_START', { civilizationId: 1 });
    router.handle('AI_CLEAR_HIGHLIGHTS', { civilizationId: 1 });
    router.handle('TURN_END', { civilizationId: 1 });
    engine.activePlayer = 0;
    router.handle('TURN_START', { civilizationId: 0 });

    expect(state().gameState.selectedUnit).toBe(humanUnit.id);
    expect(state().gameState.selectionOrigin).toBe('user');
  });

  it('keeps the selected unit across a full engine turn (processTurn)', async () => {
    const humanUnit = engine.units.find((u) => u.civilizationId === 0)!;
    engine.roundManager.registerPlayer(0);
    await new Promise((r) => setTimeout(r, 0));
    state().actions.selectUnit(humanUnit.id, 'user');
    for (const u of engine.units) {
      if (u.civilizationId === 0) u.movesRemaining = 0;
    }

    engine.processTurn();
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 10));
      if (engine.activePlayer === 0) break;
    }

    expect(state().gameState.selectedUnit).toBe(humanUnit.id);
    expect(state().gameState.selectionOrigin).toBe('user');
  });

  it('the queue emptying at the END phase does not drop a watched human unit', () => {
    const humanUnit = engine.units.find((u) => u.civilizationId === 0)!;
    state().actions.selectUnit(humanUnit.id, 'user');
    // The unit moves and becomes spent → the user lock is released, the auto
    // focus may pick another unit, and the human still watches a unit.
    humanUnit.movesRemaining = 0;
    state().actions.updateUnits(engine.getAllUnits());
    router.handle('UNIT_MOVED', { unit: humanUnit });

    const watched = state().gameState.selectedUnit;
    expect(watched).not.toBeNull();

    router.handle('UNIT_QUEUE_CHANGE', {
      civilizationId: 0,
      currentUnitId: null,
      queueLength: 0,
    });
    expect(state().gameState.selectedUnit).toBe(watched);

    // TURN_END re-asserts it as a hand-made selection for the next turn.
    router.handle('TURN_END', { civilizationId: 0 });
    expect(state().gameState.selectedUnit).toBe(watched);
    expect(state().gameState.selectionOrigin).toBe('user');
  });

  it('still clears a non-human (auto) selection when the queue empties', () => {
    const aiUnit = engine.units.find((u) => u.civilizationId === 1)!;
    state().actions.selectUnit(aiUnit.id);

    router.handle('UNIT_QUEUE_CHANGE', {
      civilizationId: 0,
      currentUnitId: null,
      queueLength: 0,
    });

    expect(state().gameState.selectedUnit).toBeNull();
  });
});
