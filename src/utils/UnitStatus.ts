import type { Unit } from '../../types/game';

/**
 * Short status badge for a unit (label + bootstrap variant), shared by the
 * unit stack modal and the city screen's Units tab.
 */
export function unitStatus(unit: Unit): { label: string; variant: string } {
  if (unit.isDefeated) return { label: 'Destroyed', variant: 'secondary' };
  if (unit.isFortified) return { label: 'Fortified', variant: 'primary' };
  if (unit.isSleeping) return { label: 'Sleeping', variant: 'info' };
  if (unit.isSkipped) return { label: 'Skipped', variant: 'warning' };
  if ((unit.movesRemaining || 0) > 0) {
    return { label: `Ready (${unit.movesRemaining} moves)`, variant: 'success' };
  }
  return { label: 'No moves left', variant: 'secondary' };
}
