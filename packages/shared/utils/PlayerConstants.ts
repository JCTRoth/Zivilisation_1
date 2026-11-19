/**
 * The human player is always civilization 0 in single-player. The UI's fog of
 * war (`map.visibility`) reflects this player's perspective, and the camera may
 * only follow units the human can actually see.
 *
 * Kept in one place: the renderer used to derive "own unit" from
 * `gameState.activePlayer`, which leaks every AI unit through the fog during an
 * AI turn (there `activePlayer` is the AI, not the human).
 *
 * In hotseat mode, multiple civ slots are human; `HUMAN_PLAYER_ID` remains the
 * DEFAULT human seat (player 0) for backward compatibility in single-player.
 */
export const HUMAN_PLAYER_ID = 0;
