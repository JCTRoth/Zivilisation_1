import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

/**
 * Upkeep-disbanded modal:
 * When the economy disbands one of the HUMAN player's units because the
 * treasury cannot cover its upkeep (`UNIT_DISBANDED` with reason
 * `upkeep_deficit`), the router opens a modal telling the player about it and
 * how to balance the budget. Manual disbands (no reason) and AI-civ disbands
 * must NOT open it.
 */
describe('Upkeep-disbanded modal', () => {
  let engine: GameEngine;
  let router: EngineEventRouter;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    (engine as any).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100
    });

    router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: any) => {
      router.handle(type, data);
    };

    useGameStore.getState().actions.hideDialog();
    useGameStore.getState().actions.clearUpkeepDisbanded();
  });

  afterEach(() => {
    useGameStore.getState().actions.hideDialog();
    useGameStore.getState().actions.clearUpkeepDisbanded();
  });

  function emitDisband(unit: Record<string, unknown>, reason?: string): void {
    const eventData: Record<string, unknown> = { unit };
    if (reason) eventData.reason = reason;
    engine.onStateChange('UNIT_DISBANDED', eventData);
  }

  it('opens the modal when a human unit is disbanded for upkeep deficit', () => {
    const unit = { id: 'u_human', civilizationId: 0, type: 'warrior', name: 'Warrior' };
    emitDisband(unit, 'upkeep_deficit');

    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBe('upkeep-disbanded');
    expect(state.disbandNotice).toEqual({
      civId: 0,
      unitType: 'warrior',
      unitName: 'Warrior',
    });
  });

  it('does NOT open the modal for a manual disband (no reason)', () => {
    const unit = { id: 'u_manual', civilizationId: 0, type: 'warrior', name: 'Warrior' };
    emitDisband(unit);

    expect(useGameStore.getState().uiState.activeDialog).toBeNull();
    expect(useGameStore.getState().disbandNotice).toBeNull();
  });

  it('does NOT open the modal for an AI civilization', () => {
    // Civ 1 is AI in CLOSEUP_1V1.
    const unit = { id: 'u_ai', civilizationId: 1, type: 'warrior', name: 'Warrior' };
    emitDisband(unit, 'upkeep_deficit');

    expect(useGameStore.getState().uiState.activeDialog).toBeNull();
    expect(useGameStore.getState().disbandNotice).toBeNull();
  });

  it('clearUpkeepDisbanded dismisses the modal and clears the notice', () => {
    const unit = { id: 'u_settler', civilizationId: 0, type: 'settler', name: 'Settler' };
    emitDisband(unit, 'upkeep_deficit');
    expect(useGameStore.getState().uiState.activeDialog).toBe('upkeep-disbanded');

    useGameStore.getState().actions.clearUpkeepDisbanded();
    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBeNull();
    expect(state.disbandNotice).toBeNull();
  });
});
