import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import { applyRemoteEvent } from '@/remoteProjection';
import type { OutboundEvent } from '@shared/types/events';
import type { Unit } from '@shared/types/game';

/** Step 4: known events patch the store without a full /state reload. */
describe('remote projection', () => {
  beforeEach(() => {
    useGameStore.setState({
      units: [{ id: 'u1', type: 'warrior', col: 1, row: 1, civilizationId: 0 } as Unit],
      cities: [],
      gameState: { ...useGameStore.getState().gameState, currentTurn: 4, activePlayer: 0 },
    });
  });

  it('patches a moved unit in place', () => {
    const handled = applyRemoteEvent({
      type: 'UNIT_MOVED',
      scope: 'location',
      col: 3,
      row: 2,
      payload: { unit: { id: 'u1', col: 3, row: 2 } },
    });
    expect(handled).toBe(true);
    const units = useGameStore.getState().units;
    expect(units).toHaveLength(1);
    expect({ col: units[0].col, row: units[0].row }).toEqual({ col: 3, row: 2 });
  });

  it('removes a defeated unit that was destroyed', () => {
    applyRemoteEvent({
      type: 'UNIT_REMOVED',
      scope: 'location',
      payload: { unit: { id: 'u1' } },
    });
    expect(useGameStore.getState().units).toHaveLength(0);
  });

  it('advances the turn from TURN_START', () => {
    applyRemoteEvent({
      type: 'TURN_START',
      scope: 'universal',
      payload: { currentTurn: 5, civilizationId: 1 },
    });
    expect(useGameStore.getState().gameState.currentTurn).toBe(5);
    expect(useGameStore.getState().gameState.activePlayer).toBe(1);
  });

  it('patches a civilization on RESEARCH_COMPLETE', () => {
    useGameStore.setState({
      civilizations: [{ id: 0, name: 'Rome' } as never],
    });
    expect(applyRemoteEvent({
      type: 'RESEARCH_COMPLETE',
      scope: 'seat',
      civId: 0,
      payload: { civilization: { id: 0, currentTech: 'pottery' } },
    })).toBe(true);
    expect((useGameStore.getState().civilizations[0] as never as { currentTech: string }).currentTech).toBe('pottery');
  });

  it('patches both units from a combat event', () => {
    useGameStore.setState({
      units: [
        { id: 'a', type: 'warrior', health: 100 } as Unit,
        { id: 'b', type: 'warrior', health: 100 } as Unit,
      ],
    });
    expect(applyRemoteEvent({
      type: 'COMBAT_HIT',
      scope: 'location',
      payload: { attacker: { id: 'a', movesRemaining: 0 }, defender: { id: 'b', health: 75 } },
    })).toBe(true);
    const units = useGameStore.getState().units;
    expect(units.find((u) => u.id === 'a')?.movesRemaining).toBe(0);
    expect(units.find((u) => u.id === 'b')?.health).toBe(75);
  });

  it('updates the phase from PHASE_CHANGE', () => {
    expect(applyRemoteEvent({
      type: 'PHASE_CHANGE',
      scope: 'universal',
      payload: { civilizationId: 0, phase: 'CITY_PRODUCTION' },
    })).toBe(true);
    expect(useGameStore.getState().gameState.gamePhase).toBe('CITY_PRODUCTION');
  });

  it('reports unknown or malformed events so the caller can fall back to a snapshot', () => {
    expect(applyRemoteEvent({ type: 'SOMETHING_NEW', payload: {} } as OutboundEvent)).toBe(false);
    expect(applyRemoteEvent({ type: 'UNIT_MOVED', payload: { unit: { col: 2 } } })).toBe(false);
  });
});
