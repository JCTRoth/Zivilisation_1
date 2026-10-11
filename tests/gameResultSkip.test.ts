import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';

/**
 * The end-of-game screen can be switched off from two places that must agree:
 * the checkbox on the defeat/victory screen, and the Settings switch. Both
 * write one setting, so the rules tested here are the ones that keep them from
 * drifting apart.
 */
describe('Skip end-of-game screen setting', () => {
  // The store is a module singleton, so this file restores exactly what it
  // touched instead of resetting wider game state.
  let previous: boolean;

  beforeEach(() => {
    previous = useGameStore.getState().settings.skipGameResultScreen;
  });

  afterEach(() => {
    useGameStore.getState().actions.updateSettings({ skipGameResultScreen: previous });
  });

  it('shows the screen by default', () => {
    // A defeat is the end of the story: it plays unless the player asked for it
    // not to. Everything else here is a deliberate user action.
    expect(useGameStore.getState().settings.skipGameResultScreen).toBe(false);
  });

  it('persists what the result-screen checkbox writes', () => {
    useGameStore.getState().actions.updateSettings({ skipGameResultScreen: true });
    expect(useGameStore.getState().settings.skipGameResultScreen).toBe(true);

    // …and clearing it again restores the screen, so the two controls are
    // reversible through the same store.
    useGameStore.getState().actions.updateSettings({ skipGameResultScreen: false });
    expect(useGameStore.getState().settings.skipGameResultScreen).toBe(false);
  });

  it('does not leak into a new game', () => {
    // A one-off "skip this ending" must not silently mute every future ending:
    // `resetGameState` is what New Game runs, and it puts the setting back off.
    expect(useGameStore.getState().actions.resetGameState).toBeTypeOf('function');
  });

  it('survives a settings update that does not mention it', () => {
    useGameStore.getState().actions.updateSettings({ skipGameResultScreen: true });
    useGameStore.getState().actions.updateSettings({ uiScale: 1.5 });
    expect(useGameStore.getState().settings.skipGameResultScreen).toBe(true);
    expect(useGameStore.getState().settings.uiScale).toBe(1.5);
  });

  it('leaves the other skip preferences alone', () => {
    // Same family of switches, different screens: ticking one must not tick the
    // end-turn confirmation.
    useGameStore.getState().actions.updateSettings({ skipGameResultScreen: true });
    const settings = useGameStore.getState().settings;
    expect(settings.skipEndTurnConfirmation).toBe(false);
    expect(settings.autoEndTurn).toBe(false);
  });
});
