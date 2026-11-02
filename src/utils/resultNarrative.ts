import type { TranslationKey } from '@/i18n';

/**
 * The three epic tells of a TEAM victory. The result screen picks one per
 * game so no two wins read alike — but always the SAME one for the same
 * result, because a re-render must not flip the story under the player.
 */
export const TEAM_VICTORY_LEDE_KEYS: readonly TranslationKey[] = [
  'result.lede.teamVictory1',
  'result.lede.teamVictory2',
  'result.lede.teamVictory3',
];

/**
 * Which of the three team-victory ledes this result tells.
 *
 * Seeded from `GameResult.timestamp` (the result's own stamp): deterministic
 * for one result, spread across results over time.
 */
export function teamVictoryLedeKey(seed: number | null | undefined): TranslationKey {
  const keys = TEAM_VICTORY_LEDE_KEYS;
  const index = Math.abs(Math.trunc(seed ?? 0)) % keys.length;
  return keys[index];
}
