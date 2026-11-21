import type { AiWarPlan, Civilization } from '@shared/types/game';
import { devWarPlanColor } from './DevWarPlanColors';

/** One row of the "All players" war-plan overview. */
export interface DevWarPlanEntry {
  playerName: string;
  color: string;
  plan: AiWarPlan;
}

/**
 * Build the rows of the Forge of War "All players" overview.
 *
 * Only living AI civilizations are included: humans have no AI war plan, the
 * barbarian faction has its own horde overlay, and a dead civ has no army left
 * to march. Pure so the selection rules are testable without a canvas.
 */
export function buildDevWarPlanEntries(
  civilizations: Civilization[],
  getWarPlan: (civilizationId: number) => AiWarPlan,
  barbarianCivId = -1,
): DevWarPlanEntry[] {
  return civilizations
    .filter(
      (civ) =>
        civ.isAI && civ.id !== barbarianCivId && civ.isAlive !== false,
    )
    .map((civ) => ({
      playerName: civ.name,
      // Indexed by id: the same civ keeps its colour between frames and
      // between the single-player view and this overview.
      color: devWarPlanColor(civ.id),
      plan: getWarPlan(civ.id),
    }));
}
