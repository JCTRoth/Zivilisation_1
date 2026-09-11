import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

/**
 * Auto End Turn must NOT fire while a screen is open (combat animation or a
 * city management / production dialog). It is deferred until that screen
 * closes, then re-checked.
 *
 * When it would fire, the router asks the player to confirm by dispatching
 * `showEndTurnConfirmation` (the App shows the "All Your Units Have Moved!"
 * modal) instead of ending the turn instantly.
 *
 * The guard lives in EngineEventHandlers.onCheckAutoEndTurn, which consults
 * the store's `uiState.activeDialog` and `combatAnimations`.
 */
describe('Auto End Turn defers while a screen is open', () => {
  let engine: GameEngine;
  let router: EngineEventRouter;
  let prompts: string[];

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });

    // Wire the engine to the router exactly like UseGameEngine does.
    router = new EngineEventRouter(engine as GameEngine);
    engine.onStateChange = (type: string, data?: any) => {
      router.handle(type, data);
    };

    // Node test env has no DOM: fake a `window` so the router's
    // showEndTurnConfirmation dispatch is observable.
    prompts = [];
    if (typeof (globalThis as any).CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class {
        constructor(public type: string) {}
      };
    }
    (globalThis as any).window = {
      dispatchEvent: (e: any) => { prompts.push(e.type); }
    };

    // Reset store UI state between tests.
    useGameStore.getState().actions.hideDialog();
    useGameStore.getState().actions.updateSettings({ autoEndTurn: true });
    // The auto-end gate now ALSO defers while the human has no research
    // selected; pick one so these tests exercise the screen-deferral behavior
    // they are about (the research gate has its own test below).
    engine.setResearch(0, 'pottery');
    // Remove any combat animations.
    const anims = useGameStore.getState().combatAnimations || [];
    for (const a of anims) {
      useGameStore.getState().actions.removeCombatAnimation(a.id);
    }
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  const makeAllUnitsDone = () => {
    const units = (engine as any).units.filter((u: any) => u.civilizationId === 0);
    for (const u of units) {
      u.movesRemaining = 0;
      u.areTurnsDone = true;
    }
  };

  it('does NOT prompt while a city management dialog is open', () => {
    useGameStore.getState().actions.showDialog('city-details');
    makeAllUnitsDone();

    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).not.toContain('showEndTurnConfirmation');
  });

  it('does NOT prompt while a combat animation is active', () => {
    useGameStore.getState().actions.addCombatAnimation({
      id: 'test-combat',
      attackerId: 'a',
      defenderId: 'd',
      attackerCol: 5,
      attackerRow: 5,
      defenderCol: 6,
      defenderRow: 5,
      attackerSurvived: true,
      defenderSurvived: false,
      startTime: performance.now(),
      duration: 2000,
      deathBlinkDuration: 500,
    });
    makeAllUnitsDone();

    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).not.toContain('showEndTurnConfirmation');
  });

  it('prompts to confirm once the city dialog is closed', () => {
    useGameStore.getState().actions.showDialog('city-details');
    makeAllUnitsDone();

    // While open → deferred.
    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });
    expect(prompts).not.toContain('showEndTurnConfirmation');

    // Close the dialog → re-check → the router asks the player to confirm.
    useGameStore.getState().actions.hideDialog();
    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).toContain('showEndTurnConfirmation');
  });

  it('defers auto-end while a diplomacy dialog is open (a leader may be awaiting a response)', () => {
    useGameStore.getState().actions.showDialog('diplomacy-report');
    makeAllUnitsDone();

    // While the diplomacy screen is open → deferred.
    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });
    expect(prompts).not.toContain('showEndTurnConfirmation');

    // Close it → re-check → prompt to confirm.
    useGameStore.getState().actions.hideDialog();
    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).toContain('showEndTurnConfirmation');
  });

  it('defers auto-end while no technology is selected — and asks for a choice', () => {
    // No research selected: the turn must not be auto-ended with idle research.
    engine.civilizations[0].currentResearch = null;
    makeAllUnitsDone();

    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).not.toContain('showEndTurnConfirmation');
    // The player is only INFORMED that research is missing (and offered the
    // tech tree) — the tree itself must not be forced open.
    const dialog = useGameStore.getState().uiState.activeDialog;
    expect(dialog).toBe('research-required');
    expect(dialog).not.toBe('tech');

    // Once a research is selected the gate lets the turn end again.
    engine.setResearch(0, 'bronze_working');
    useGameStore.getState().actions.hideDialog();
    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });
    expect(prompts).toContain('showEndTurnConfirmation');
  });
});
