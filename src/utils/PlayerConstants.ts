/**
 * The human player is always civilization 0 in single-player. The UI's fog of
 * war (`map.visibility`) reflects this player's perspective, and the camera may
 * only follow units the human can actually see.
 *
 * Kept in one place: the renderer used to derive "own unit" from
 * `gameState.activePlayer`, which leaks every AI unit through the fog during an
 * AI turn (there `activePlayer` is the AI, not the human).
 *
 * In hotseat mode, multiple civ slots are human. Use `isHumanPlayer()` and
 * `humanPlayerIds()` to check membership; `HUMAN_PLAYER_ID` remains the
 * DEFAULT human seat (player 0) for backward compatibility in single-player.
 */
export const HUMAN_PLAYER_ID = 0;

/**
 * The list of human-controlled civilization slots in a game.
 * Defaults to `[0]` when no hotseat config is present (single-player).
 */
export function humanPlayerIds(gameMode?: string, ids?: number[]): number[] {
  if (gameMode === 'hotseat' && Array.isArray(ids) && ids.length > 0) {
    return [...ids];
  }
  return [HUMAN_PLAYER_ID];
}

/**
 * Whether `civId` is a human-controlled player in the given game settings.
 */
export function isHumanPlayer(
  civId: number,
  gameMode?: string,
  humanIds?: number[],
): boolean {
  return humanPlayerIds(gameMode, humanIds).includes(civId);
}

/**
 * The active human player's ID, or `HUMAN_PLAYER_ID` when not in hotseat.
 */
export function activeHumanPlayer(
  gameMode?: string,
  humanIds?: number[],
  activePlayer?: number,
): number {
  const ids = humanPlayerIds(gameMode, humanIds);
  if (activePlayer !== undefined && ids.includes(activePlayer)) {
    return activePlayer;
  }
  return ids[0] ?? HUMAN_PLAYER_ID;
}
