import { useGameStore } from './stores/GameStore';
import { asProjectableEvent, type OutboundEvent } from '@shared/types/events';

/**
 * Incremental client projection (report step 4).
 *
 * Applies the typed, projectable engine events directly to the Zustand read
 * model. Unknown or malformed events return false so `remoteGame` can fall
 * back to a full snapshot; this keeps the projection simple without silently
 * dropping state changes it does not understand.
 */
export function applyRemoteEvent(event: OutboundEvent): boolean {
  const typed = asProjectableEvent(event);
  if (!typed) return false;

  const state = useGameStore.getState();
  const actions = state.actions;

  switch (typed.type) {
    case 'TURN_START':
    case 'TURN_END': {
      const data = typed.payload;
      const turn = data.currentTurn ?? state.gameState.currentTurn;
      const player = 'civilizationId' in data && typeof data.civilizationId === 'number'
        ? data.civilizationId
        : 'playerId' in data && typeof data.playerId === 'number'
          ? data.playerId
          : state.gameState.activePlayer;
      actions.updateGameState?.({ currentTurn: turn, activePlayer: player });
      return true;
    }

    case 'UNIT_MOVED':
    case 'UNIT_CREATED':
    case 'UNIT_DEFEATED':
    case 'UNIT_REMOVED': {
      const { unit } = typed.payload;
      const units = state.units ?? [];
      const exists = units.some((u) => u.id === unit.id);
      const next = typed.type === 'UNIT_REMOVED'
        ? units.filter((u) => u.id !== unit.id)
        : exists
          ? units.map((u) => (u.id === unit.id ? { ...u, ...unit } : u))
          : [...units, unit as never];
      actions.updateUnits?.(next as never);
      return true;
    }

    case 'CITY_FOUND':
    case 'CITY_CAPTURED':
    case 'CITY_UPDATED': {
      const { city } = typed.payload;
      const cities = state.cities ?? [];
      const next = cities.some((c) => c.id === city.id)
        ? cities.map((c) => (c.id === city.id ? { ...c, ...city } : c))
        : [...cities, city as never];
      actions.updateCities?.(next as never);
      return true;
    }

    case 'CIVILIZATION_UPDATED':
    case 'RESEARCH_COMPLETE': {
      const { civilization } = typed.payload;
      const civs = state.civilizations ?? [];
      actions.updateCivilizations?.(
        civs.map((c) => (c.id === civilization.id ? { ...c, ...civilization } : c)) as never,
      );
      return true;
    }

    case 'COMBAT_HIT':
    case 'COMBAT_VICTORY': {
      const { attacker, defender } = typed.payload;
      const units = state.units ?? [];
      const patch = (unit: typeof attacker) => units.map((u) => (u.id === unit.id ? { ...u, ...unit } : u));
      actions.updateUnits?.(patch(defender).map((u) => (u.id === attacker.id ? { ...u, ...attacker } : u)) as never);
      return true;
    }

    case 'VILLAGE_RESULT': {
      const data = typed.payload;
      if (typeof data.goldAmount !== 'number') return true;
      const civs = state.civilizations ?? [];
      const civ = civs.find((c) => c.id === data.civId);
      if (!civ) return true;
      const resources = (civ as never as { resources?: { gold?: number } }).resources;
      actions.updateCivilizations?.(civs.map((c) => c.id === data.civId
        ? { ...c, resources: { ...resources, gold: (resources?.gold ?? 0) + data.goldAmount! } }
        : c) as never);
      return true;
    }

    case 'PHASE_CHANGE': {
      const data = typed.payload;
      if (data.phase) actions.updateGameState?.({ gamePhase: data.phase as never });
      return true;
    }

    case 'NOTIFICATION': {
      const data = typed.payload;
      if (data.civId !== undefined && data.civId !== state.gameState.activePlayer) return true;
      if (data.message) {
        actions.addNotification?.({
          type: data.kind ?? 'info',
          message: data.message,
        });
      }
      return true;
    }

    default:
      return false;
  }
}
