/**
 * Shared presentation constants for fixed alliances.
 *
 * Team ids are zero-based engine values; every user-facing label is one-based
 * ("Team 1"). Keeping the palette in one place means the setup builder, the
 * diplomacy roster, the side panel and the result screen can never disagree
 * about which colour belongs to which team.
 */
export const TEAM_COLORS = [
  '#d4af37', // gold
  '#5b9bd5', // steel blue
  '#7fb069', // moss green
  '#c46a6a', // brick red
  '#9b7fd4', // violet
  '#d08c3a', // amber
] as const;

/** Colour for a zero-based team id, wrapping around the palette. */
export function teamColor(teamId: number | null | undefined): string {
  if (teamId === null || teamId === undefined || teamId < 0) return '#9e9e9e';
  return TEAM_COLORS[teamId % TEAM_COLORS.length];
}

/** User-facing name for a zero-based team id ("Team 1"). */
export function teamName(teamId: number | null | undefined): string {
  if (teamId === null || teamId === undefined || teamId < 0) return '';
  return `Team ${teamId + 1}`;
}
