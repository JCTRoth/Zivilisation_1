import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';
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
describe('Auto End Turn is opt-in', () => {
  it('is off in the default settings, and never turns itself on', () => {
    // "Auto. turn ending should be not enabled by default" — a fresh game must
    // not end a turn on its own. Only one place switches it on now, and it is a
    // deliberate user action (the one-time turn-15 offer), so nothing may set it
    // behind the player's back. In particular the End Turn modal's "Don't show
    // this confirmation next time" checkbox is an interface preference only: it
    // must never turn auto-end on (see the checkbox test below).
    const fresh = useGameStore.getState().settings;
    expect(fresh.autoEndTurn).toBe(false);
    expect(fresh.skipEndTurnConfirmation).toBe(false);

    // And a new game must not inherit an auto-end preference from an old one:
    // `resetGameState` is what New Game runs, so the setting has to come back
    // off afterwards.
    useGameStore.getState().actions.updateSettings({ autoEndTurn: true });
    useGameStore.getState().actions.resetGameState();
    expect(useGameStore.getState().settings.autoEndTurn).toBe(false);

    // A simulated round with every unit spent must not auto-end the turn.
    const engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    let ended = false;
    engine.onStateChange = (event: string) => {
      if (event === 'AUTO_END_TURN' || event === 'TURN_ENDED') ended = true;
    };
    (engine as unknown as { checkAutoEndTurn?: () => void }).checkAutoEndTurn?.();
    expect(ended).toBe(false);
  });
});

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
      deathFadeDuration: 450,
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
    useGameStore.getState().actions.showDialog('diplomacy');
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
    // No research selected (past the opening rounds): the turn must not be
    // auto-ended with idle research.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
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

  it('does NOT defer auto-end for missing research during the opening rounds', () => {
    // Round 0: research intentionally has not started yet, so an empty
    // research slot is expected and must not block the end of the turn.
    engine.civilizations[0].currentResearch = null;
    makeAllUnitsDone();

    router.handle('CHECK_AUTO_END_TURN', { civilizationId: 0 });

    expect(prompts).toContain('showEndTurnConfirmation');
    expect(useGameStore.getState().uiState.activeDialog).not.toBe('research-required');
  });
});

/**
 * "Don't show this confirmation next time" is an interface preference. It must
 * never turn Auto Turn Ending on or off — the modal used to flip `autoEndTurn`
 * on confirm and off on cancel, so ticking the box and pressing "End Turn"
 * silently switched auto-end on, and cancelling silently switched off an
 * auto-end setting the player had chosen elsewhere.
 */
describe("the End Turn checkbox does not drive auto-end turn", () => {
  /** The checkbox's whole contract: it writes this one setting, nothing else. */
  function checkboxChange(): void {
    const settings = useGameStore.getState().settings;
    const actions = useGameStore.getState().actions;
    // Mirrors EndTurnConfirmModal's onChange.
    actions.updateSettings({ skipEndTurnConfirmation: !settings.skipEndTurnConfirmation });
  }

  beforeEach(() => {
    useGameStore.setState((state) => ({
      settings: { ...state.settings, autoEndTurn: false, skipEndTurnConfirmation: false },
    }));
  });

  it("turning the checkbox on leaves auto-end off", () => {
    checkboxChange();
    const s = useGameStore.getState().settings;
    expect(s.skipEndTurnConfirmation).toBe(true);
    expect(s.autoEndTurn).toBe(false);
  });

  it("turning the checkbox off leaves a chosen auto-end setting alone", () => {
    useGameStore.getState().actions.updateSettings({ autoEndTurn: true });
    useGameStore.getState().actions.updateSettings({ skipEndTurnConfirmation: true });

    checkboxChange();

    const s = useGameStore.getState().settings;
    expect(s.skipEndTurnConfirmation).toBe(false);
    // Cancel/confirm must not have flipped the player's own choice.
    expect(s.autoEndTurn).toBe(true);
  });

  it("does not couple the two settings in either direction", () => {
    for (const autoEndTurn of [true, false]) {
      useGameStore.setState((state) => ({
        settings: { ...state.settings, autoEndTurn, skipEndTurnConfirmation: false },
      }));
      checkboxChange();
      expect(useGameStore.getState().settings.autoEndTurn).toBe(autoEndTurn);
    }
  });
});
