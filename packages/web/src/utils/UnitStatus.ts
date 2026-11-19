import type { Unit } from '../../types/game';
import {
  UNIT_RANK,
  UNIT_RANK_INFO,
  experienceToNextRank,
  getUnitRank,
} from '@/game/engine/UnitRankSystem';

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

/** Rank badge rendering data (Rookies have no badge — it is the default). */
export interface UnitRankBadge {
  label: string;
  /** CSS class from `unitRank.css`, incl. the rank variant. */
  className: string;
  /** Hover text: strength multiplier + XP still needed for the next rank. */
  title: string;
  /** Combat strength multiplier this rank carries. */
  multiplier: number;
  /** Rank display name ("Trained", "Seasoned", "Battle-Hardened"). */
  name: string;
}

/**
 * Rank badge for a unit, or null for a plain Rookie. Shared by the unit
 * stack modal, the city screen and the side panel so all three always show
 * the same rank name, colour and tooltip.
 */
export function unitRankBadge(unit: Unit): UnitRankBadge | null {
  const rank = getUnitRank(unit);
  if (rank === UNIT_RANK.ROOKIE) return null;
  const info = UNIT_RANK_INFO[rank];
  const toNext = experienceToNextRank(unit);
  const multiplierText = `×${info.strengthMultiplier} strength`;
  return {
    label: `★ ${info.name}`,
    className: `unit-rank-badge unit-rank-badge--${info.name.toLowerCase()}`,
    title: toNext > 0
      ? `${info.name} (${multiplierText}) — ${toNext} XP to next rank`
      : `${info.name} (${multiplierText}) — highest rank`,
    multiplier: info.strengthMultiplier,
    name: info.name,
  };
}

/** Format a possibly fractional combat stat ("2.5", never "2.50"). */
export function formatCombatStat(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
