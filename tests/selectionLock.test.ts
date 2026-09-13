import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';

/**
 * Selection ownership.
 *
 * A selection the player made by hand (a city they opened, a unit they clicked)
 * must not be replaced by the engine's automatic selection a moment later.
 * That is the bug where clicking a city also selected the next unit that still
 * had moves — the deferred move/queue advance landed right after the click.
 *
 * Only one thing is selected at a time: a user unit selection also clears the
 * persistent city marker and closes the city dialogs.
 */
describe('selection ownership (user vs auto)', () => {
  const actions = () => useGameStore.getState().actions;
  const state = () => useGameStore.getState();

  beforeEach(() => {
    useGameStore.setState((s) => ({
      ...s,
      gameState: {
        ...s.gameState,
        selectedUnit: null,
        activeUnit: null,
        selectedCity: null,
        focusedCity: null,
        selectionOrigin: null,
      },
      uiState: {
        ...s.uiState,
        showUnitPanel: false,
        showCityPanel: false,
        activeDialog: null,
      },
    }));
  });

  it('ignores an auto selection while the player holds a user selection', () => {
    actions().selectCity('city-1', 'user');
    expect(state().gameState.selectionOrigin).toBe('user');

    // The engine's auto-select (queue advance / unit moved / selectAndFocusUnit).
    actions().selectUnit('unit-9');

    expect(state().gameState.selectedUnit).toBeNull();
    expect(state().gameState.selectedCity).toBe('city-1');
    expect(state().uiState.showUnitPanel).toBe(false);
  });

  it('ignores an auto deselection while the player holds a user selection', () => {
    actions().selectCity('city-1', 'user');

    // e.g. the turn queue emptying calls selectUnit(null) with the auto origin.
    actions().selectUnit(null);

    expect(state().gameState.selectedCity).toBe('city-1');
    expect(state().gameState.selectionOrigin).toBe('user');
  });

  it('a user unit selection clears the city marker and closes city dialogs', () => {
    actions().selectCity('city-1', 'user');
    actions().showDialog('city-details');
    expect(state().gameState.focusedCity).toBe('city-1');

    actions().selectUnit('unit-9', 'user');

    expect(state().gameState.selectedUnit).toBe('unit-9');
    expect(state().gameState.selectedCity).toBeNull();
    expect(state().gameState.focusedCity).toBeNull();
    expect(state().uiState.activeDialog).toBeNull();
    expect(state().uiState.showUnitPanel).toBe(true);
    expect(state().uiState.showCityPanel).toBe(false);
  });

  it('auto selection resumes once the dialog is closed', () => {
    actions().selectCity('city-1', 'user');
    actions().selectUnit('unit-9');
    expect(state().gameState.selectedUnit).toBeNull();

    // Closing the decision screen releases the lock.
    actions().hideDialog();

    actions().selectUnit('unit-9');
    expect(state().gameState.selectedUnit).toBe('unit-9');
    expect(state().gameState.selectedCity).toBeNull();
  });

  it('nextTurn releases the lock and clears both selections', () => {
    actions().selectCity('city-1', 'user');

    actions().nextTurn();

    expect(state().gameState.selectionOrigin).toBeNull();
    expect(state().gameState.selectedCity).toBeNull();
    expect(state().gameState.selectedUnit).toBeNull();
  });

  it('a user city deselection clears the persistent city marker', () => {
    actions().selectCity('city-1', 'user');
    actions().selectCity(null, 'user');

    expect(state().gameState.selectedCity).toBeNull();
    expect(state().gameState.focusedCity).toBeNull();
    expect(state().gameState.selectionOrigin).toBeNull();
  });

  it('releasing the lock (the selected unit ran out of moves) restores auto-selection', () => {
    actions().selectUnit('unit-a', 'user');
    // EngineEventRouter releases the lock once the *selected* unit has no moves
    // left, so the turn queue can focus the next unit as before.
    actions().updateGameState({ selectionOrigin: null });

    actions().selectUnit('unit-b');

    expect(state().gameState.selectedUnit).toBe('unit-b');
  });
});
