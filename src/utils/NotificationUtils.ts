import { useGameStore } from '../stores/GameStore';
import { HUMAN_PLAYER_ID } from './PlayerConstants';

/**
 * Return HUMAN_PLAYER_ID if either side belongs to the human player,
 * otherwise fall back to idA (the "first" party). Useful for routing
 * engine-level notifications to the correct player.
 */
export function humanOrFirst(
  idA?: string | number,
  idB?: string | number,
): string | number | undefined {
  if (idA === HUMAN_PLAYER_ID || idB === HUMAN_PLAYER_ID) return HUMAN_PLAYER_ID;
  return idA ?? idB ?? undefined;
}

/**
 * Thin wrapper around `addNotification` to cut boilerplate in engine
 * classes that access the store directly.
 *
 * Pass an optional `civId` to restrict the toast to a single player
 * (see {@link humanOrFirst} for the common two-party case).
 */
export function notify(
  type: 'success' | 'error' | 'info' | 'warning',
  message: string,
  civId?: string | number,
): void {
  useGameStore.getState().actions.addNotification?.({
    type,
    civId: civId as number | undefined,
    message,
  });
}
