/**
 * UnitRankSystem — the unit rank ladder.
 *
 * Every unit belongs to exactly one of four ranks. Rank 1 (Rookie) is the
 * default for freshly built units; the ranks above are earned with combat
 * experience and feed a strength multiplier into the central CombatSystem, so
 * a battle-hardened veteran genuinely hits (and soaks) harder than a green
 * rookie. The ladder caps at ×1.5 — the classic Civ veteran bonus.
 *
 *   Rank 1  Rookie            ×1.00   default
 *   Rank 2  Trained           ×1.10
 *   Rank 3  Seasoned          ×1.25
 *   Rank 4  Battle-Hardened   ×1.50
 *
 * Progression is experience-based:
 *   - winning a combat round        → +COMBAT_XP.ROUND_WON
 *   - destroying an enemy unit      → +COMBAT_XP.UNIT_DESTROYED
 *   - capturing or razing a city    → +COMBAT_XP.CITY_CAPTURED
 *
 * The legacy `Unit.isVeteran` boolean is kept in sync (true from Seasoned
 * upward) so old UI code, the progression export and older save files keep
 * working; new code must read the rank through {@link getUnitRank}.
 *
 * Everything here is pure and side-effect free except
 * {@link awardCombatExperience}, which is the single mutation point used by
 * the engine after each resolved combat.
 */

import { hasBuildingEffect } from './BuildingEffects';

/** The four rank grades, bottom (default) to top. */
export const UNIT_RANK = {
  ROOKIE: 1,
  TRAINED: 2,
  SEASONED: 3,
  BATTLE_HARDENED: 4,
} as const;

export type UnitRank = (typeof UNIT_RANK)[keyof typeof UNIT_RANK];

/** Display + balance metadata for one rank grade. */
export interface UnitRankInfo {
  id: UnitRank;
  /** Proper display name ("Trained", "Seasoned", …). */
  name: string;
  /** Total experience required to hold this rank. */
  xpThreshold: number;
  /** Combat strength multiplier applied by CombatSystem. */
  strengthMultiplier: number;
  /** Number of rank chevrons drawn over the unit sprite. */
  chevrons: number;
  /** Accent colour used by the canvas insignia and the UI badges. */
  color: string;
}

/** Experience points awarded for the three combat achievements. */
export const COMBAT_XP = {
  /** Won one combat round (attacker or defender). */
  ROUND_WON: 10,
  /** Destroyed an enemy unit (on top of the round win). */
  UNIT_DESTROYED: 30,
  /** Captured or razed an enemy city. */
  CITY_CAPTURED: 60,
} as const;

/** Full rank ladder, indexed by rank id (bottom → top). */
export const UNIT_RANK_INFO: Record<UnitRank, UnitRankInfo> = {
  [UNIT_RANK.ROOKIE]: {
    id: UNIT_RANK.ROOKIE,
    name: 'Rookie',
    xpThreshold: 0,
    strengthMultiplier: 1,
    chevrons: 0,
    color: '#8fa3b5',
  },
  [UNIT_RANK.TRAINED]: {
    id: UNIT_RANK.TRAINED,
    name: 'Trained',
    xpThreshold: 40,
    strengthMultiplier: 1.1,
    chevrons: 1,
    color: '#c8d2dc',
  },
  [UNIT_RANK.SEASONED]: {
    id: UNIT_RANK.SEASONED,
    name: 'Seasoned',
    xpThreshold: 120,
    strengthMultiplier: 1.25,
    chevrons: 2,
    color: '#f0c33c',
  },
  [UNIT_RANK.BATTLE_HARDENED]: {
    id: UNIT_RANK.BATTLE_HARDENED,
    name: 'Battle-Hardened',
    xpThreshold: 280,
    strengthMultiplier: 1.5,
    chevrons: 3,
    color: '#ffd75e',
  },
};

/** Top rank of the ladder (progression caps here). */
export const UNIT_RANK_MAX: UnitRank = UNIT_RANK.BATTLE_HARDENED;

/**
 * Whether a UNIT_PROPERTIES `type` field counts as a combat unit class.
 * Combat units are the ones a Barracks' `veteranUnits` effect can seed with
 * rank, and the ones a building's `unitProduction` shields speed up;
 * civilians (settlers, caravans, …) are neither.
 */
export function isCombatUnitClass(unitClass?: string): boolean {
  return unitClass === 'military'
    || unitClass === 'siege'
    || unitClass === 'naval'
    || unitClass === 'air'
    || unitClass === 'scout';
}

/**
 * Minimal rank-bearing shape. The engine's `Unit` satisfies it; tests can pass
 * plain objects.
 */
export interface RankBearingUnit {
  experience?: number;
  rank?: number;
  /** Legacy flag — kept in sync as `rank >= SEASONED`. */
  isVeteran?: boolean;
}

/** Coerce any stored rank value to a valid ladder step (old saves included). */
function clampRank(rank: number | undefined): UnitRank {
  if (typeof rank !== 'number' || !Number.isFinite(rank)) return UNIT_RANK.ROOKIE;
  if (rank >= UNIT_RANK.BATTLE_HARDENED) return UNIT_RANK.BATTLE_HARDENED;
  if (rank <= UNIT_RANK.ROOKIE) return UNIT_RANK.ROOKIE;
  return Math.floor(rank) as UnitRank;
}

/**
 * The unit's current rank. Falls back to the legacy `isVeteran` flag so units
 * loaded from saves written before the rank system still read as Seasoned.
 */
export function getUnitRank(unit: RankBearingUnit | null | undefined): UnitRank {
  if (!unit) return UNIT_RANK.ROOKIE;
  if (typeof unit.rank === 'number') return clampRank(unit.rank);
  return unit.isVeteran ? UNIT_RANK.SEASONED : UNIT_RANK.ROOKIE;
}

/** Rank metadata (name, multiplier, colour, …) for a unit. */
export function getUnitRankInfo(unit: RankBearingUnit | null | undefined): UnitRankInfo {
  return UNIT_RANK_INFO[getUnitRank(unit)];
}

/** The rank a given experience total holds. */
export function rankForExperience(experience: number): UnitRank {
  const xp = Number.isFinite(experience) ? Math.max(0, experience) : 0;
  if (xp >= UNIT_RANK_INFO[UNIT_RANK.BATTLE_HARDENED].xpThreshold) return UNIT_RANK.BATTLE_HARDENED;
  if (xp >= UNIT_RANK_INFO[UNIT_RANK.SEASONED].xpThreshold) return UNIT_RANK.SEASONED;
  if (xp >= UNIT_RANK_INFO[UNIT_RANK.TRAINED].xpThreshold) return UNIT_RANK.TRAINED;
  return UNIT_RANK.ROOKIE;
}

/** Combat strength multiplier for a rank (unknown ranks behave as Rookie). */
export function rankStrengthMultiplier(rank: number | undefined): number {
  return UNIT_RANK_INFO[clampRank(rank)].strengthMultiplier;
}

/** Fresh-unit rank state: a green Rookie with zero experience. */
export function createRookieRankState(): { experience: number; rank: UnitRank; isVeteran: boolean } {
  return { experience: 0, rank: UNIT_RANK.ROOKIE, isVeteran: false };
}

/** What a city's workshop hands to the tile when a unit finishes production. */
export interface StartingRankState {
  experience: number;
  rank: UnitRank;
  isVeteran: boolean;
}

/**
 * Starting rank for a unit produced by `city`.
 *
 * Civ1: a city with Barracks produces veteran units. Here that is the third
 * rank (Seasoned) with its threshold experience pre-loaded, so a barracks
 * unit still has to fight its way up to Battle-Hardened. The barracks is read
 * from the declared `veteranUnits` effect (BuildingEffects), not from its id.
 *
 * `unitClass` is the UNIT_PROPERTIES `type` field — only combat units gain the
 * bonus; civilians (settlers, caravans, …) stay Rookies.
 */
export function startingRankForCity(
  city: { buildings?: string[] | null } | null | undefined,
  unitClass?: string,
): StartingRankState {
  if (isCombatUnitClass(unitClass) && hasBuildingEffect(city, 'veteranUnits')) {
    const rank = UNIT_RANK.SEASONED;
    return {
      experience: UNIT_RANK_INFO[rank].xpThreshold,
      rank,
      isVeteran: true,
    };
  }
  return createRookieRankState();
}

/** Result of adding experience to a unit. */
export interface ExperienceAward {
  /** Whether this award crossed a rank threshold. */
  promoted: boolean;
  rankBefore: UnitRank;
  rankAfter: UnitRank;
  /** Experience total after the award. */
  experience: number;
}

/**
 * The single mutation point for ranks: add experience, recompute the rank,
 * keep the legacy `isVeteran` flag in sync and report a promotion.
 *
 * The rank is derived from the experience total (never incremented blindly),
 * so awards from any source — combat, huts, scenario scripts — stay
 * consistent with the ladder thresholds.
 */
export function awardCombatExperience(unit: RankBearingUnit, amount: number): ExperienceAward {
  const rankBefore = getUnitRank(unit);
  const gained = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const experience = Math.max(0, (unit.experience ?? 0) + gained);
  const rankAfter = rankForExperience(experience);

  unit.experience = experience;
  unit.rank = rankAfter;
  unit.isVeteran = rankAfter >= UNIT_RANK.SEASONED;

  return {
    promoted: rankAfter > rankBefore,
    rankBefore,
    rankAfter,
    experience,
  };
}

/**
 * Fill in rank fields on a unit loaded from a save written before the rank
 * system existed (or from an older branch). Mutates and returns the unit.
 */
export function normalizeUnitRankFields<T extends RankBearingUnit>(unit: T): T {
  const rank = getUnitRank(unit);
  unit.rank = rank;
  if (typeof unit.experience !== 'number' || !Number.isFinite(unit.experience) || unit.experience < 0) {
    // A legacy veteran without experience data starts at its rank threshold.
    unit.experience = UNIT_RANK_INFO[rank].xpThreshold;
  }
  unit.isVeteran = rank >= UNIT_RANK.SEASONED;
  return unit;
}

/** Experience still needed to reach the next rank (0 when already maxed). */
export function experienceToNextRank(unit: RankBearingUnit): number {
  const xp = Math.max(0, unit.experience ?? 0);
  // The experience total is the source of truth (rank is derived from it),
  // so the "to next rank" math works even on units without a rank field.
  const rank = rankForExperience(xp);
  if (rank >= UNIT_RANK_MAX) return 0;
  const nextThreshold = UNIT_RANK_INFO[(rank + 1) as UnitRank].xpThreshold;
  return Math.max(0, nextThreshold - xp);
}
