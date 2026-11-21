/**
 * Colours for the Development-Mode "Forge of War" war-plan overlay.
 *
 * The civilization's own map colour cannot be used: several civs are near-black
 * (Rome) or bright yellow (China), which respectively vanish on the map or
 * blend into the normal unit-path lines. This fixed palette keeps every AI
 * player readable on grass, desert and water.
 *
 * Indexed by civilization id so a civ keeps the same colour between frames and
 * between the single-player view and the "All players" overview.
 *
 * Module-private: only `devWarPlanColor()` is part of the API (knip fails on
 * an export nothing imports).
 */
const DEV_WAR_PLAN_COLORS = [
  '#4fd6ff',
  '#ffd166',
  '#ef476f',
  '#06d6a0',
  '#c77dff',
  '#ff9f1c',
  '#8ecae6',
] as const;

export function devWarPlanColor(civilizationId: number): string {
  return DEV_WAR_PLAN_COLORS[
    Math.abs(civilizationId) % DEV_WAR_PLAN_COLORS.length
  ];
}
