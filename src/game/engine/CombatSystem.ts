/**
 * CombatSystem — the single source of truth for fighting.
 *
 * Every unit-vs-unit and unit-vs-city exchange resolves through this module so
 * the engine, the event/notification layer and the renderer all agree on the
 * numbers the player sees. It owns:
 *
 *   - the single `COMBAT_DAMAGE` constant (HP% a lost round costs),
 *   - the strength formulas (health, rank, terrain, fortification, city, fortress),
 *   - the round roll and the "no run-overs" overrun rule,
 *   - how much damage each side takes and whether it was destroyed,
 *   - the player-facing summary strings shown as toasts.
 *
 * Rules (Civ1-flavoured, as implemented by this clone):
 *   - Strength = stat × health% × rank multiplier, defender additionally gets
 *     terrain defence, +50% when fortified or inside a city, and the fortress
 *     multiplier.
 *   - The attacker wins the round with probability A / (A + D).
 *   - Only the side that LOSES the round takes damage:
 *       attacker wins → defender takes damage (lethal when the attacker is at
 *       least as strong as the defender — the overrun rule — otherwise
 *       `COMBAT_DAMAGE`), attacker takes none;
 *       defender wins → attacker takes `COMBAT_DAMAGE`, defender takes none.
 *   - A victorious attacker never advances into the defender's tile.
 *   - Splash damage: when the attacker damages a tile holding 2+ stacked
 *     units on open ground, every other exposed unit on the tile takes 25%
 *     of the primary hit (min 1). Entrenched cover is complete immunity:
 *     cities, fortress tiles, fortified units and embarked cargo take none.
 *   - City healing: units inside their own cities recover 2 HP/turn, up to a
 *     lifetime total of 15% of all battle damage they ever took.
 */

import { TERRAIN_PROPS, UNIT_PROPS } from '@/utils/Constants';
import { MathUtils } from '@/utils/MathUtils';
import { IMPROVEMENT_PROPERTIES } from '@/data/TileImprovementConstants';
import { getUnitRank, rankStrengthMultiplier } from './UnitRankSystem';

/** HP (%) a lost combat round costs a unit. */
const COMBAT_DAMAGE = 25;

/**
 * Splash share: secondary stacked units take this fraction of the primary
 * attack damage when their tile is hit on open ground.
 */
export const SPLASH_DAMAGE_FRACTION = 0.25;

/** HP per turn a unit recovers while stationed inside one of its own cities. */
export const CITY_HEAL_PER_TURN = 2;

/**
 * Lifetime city-healing cap as a share of all battle damage the unit ever
 * took: at most 15% of what combat cost it ever comes back in a city.
 */
export const CITY_HEAL_CAP_FRACTION = 0.15;

/** Terrain-ish shape needed for defence bonuses. */
interface CombatTerrainLike {
  type?: string;
  terrain?: string;
  improvement?: string | null;
}

/** Minimal unit shape this module needs (engine units have optional stats). */
export interface CombatUnitLike {
  id?: string;
  type?: string;
  civilizationId?: number;
  attack?: number;
  defense?: number;
  health?: number;
  isFortified?: boolean;
  /** Rank grade (1 Rookie … 4 Battle-Hardened) — feeds the strength multiplier. */
  rank?: number;
  /** Legacy veterancy flag, read when `rank` is absent (old saves). */
  isVeteran?: boolean;
  /** Cumulative HP lost in combat (the city-healing ledger). */
  battleDamageTaken?: number;
  /** Cumulative HP restored by city healing (capped against the ledger). */
  healedInCityTotal?: number;
}

/** One secondary victim of splash damage. */
export interface SplashVictim {
  /** Damage this stacked unit takes (25% of the primary hit, min 1). */
  damage: number;
}

/** Minimal city shape needed for the city-assault math. */
export interface CombatCityLike {
  population?: number;
  buildings?: string[] | null;
}

export interface UnitCombatContext {
  /** The defender's tile (terrain/fortress bonuses). */
  defenderTile?: CombatTerrainLike | null;
  /** Pre-resolved terrain key (falls back to the tile's type/terrain). */
  defenderTerrainKey?: string;
  /** Whether the defender stands inside a city (+50% fortification). */
  defenderInCity?: boolean;
  /** Random source returning [0, 1) — injectable for deterministic tests. */
  random?: () => number;
}

export interface UnitCombatOutcome {
  attackerWins: boolean;
  attackerStrength: number;
  defenderStrength: number;
  /** Probability (0..1) that the attacker wins the round. */
  attackerWinChance: number;
  /** Damage dealt TO the attacker this round (0 when the attacker won). */
  attackerDamage: number;
  /** Damage dealt TO the defender this round (0 when the defender won). */
  defenderDamage: number;
  defenderDestroyed: boolean;
  attackerDestroyed: boolean;
  /** True when the attacker was at least as strong as the defender. */
  canOverrun: boolean;
}

export interface CityCombatContext {
  /** Air units / siege artillery ignore city walls. */
  ignoresWalls?: boolean;
  /** Random source returning [0, 1) — injectable for deterministic tests. */
  random?: () => number;
}

export interface CityCombatRound {
  attackerWins: boolean;
  attackerStrength: number;
  cityDefense: number;
  attackerWinChance: number;
  /** Damage a FAILED assault deals to the attacker. */
  attackerDamage: number;
  /** Whether the city actually owns walls (regardless of wall-ignoring units). */
  cityHasWalls: boolean;
  /** Whether the walls bonus was applied to the defence. */
  wallsApplied: boolean;
}

export type CombatEventKind = 'victory' | 'hit' | 'defeat';

/** The terrain key for a tile (accepts `type` or `terrain`). */
function terrainKeyOf(tile?: CombatTerrainLike | null): string {
  return String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase();
}

export class CombatSystem {
  /** Rank multiplier for a unit (Rookie ×1 … Battle-Hardened ×1.5). */
  static rankMultiplier(unit: CombatUnitLike): number {
    return rankStrengthMultiplier(getUnitRank(unit));
  }

  /** Attacking strength: attack stat scaled by remaining health and rank. */
  static attackerStrength(unit: CombatUnitLike): number {
    return (unit.attack ?? 0) * ((unit.health ?? 100) / 100) * this.rankMultiplier(unit);
  }

  /**
   * Defending strength: defence stat × health × rank, plus the Civ1 stacking
   * bonuses (terrain defence, +50% fortification/in-city, fortress multiplier).
   */
  static defenderStrength(
    defender: CombatUnitLike,
    context: UnitCombatContext = {},
  ): number {
    const tile = context.defenderTile ?? null;
    const terrainKey = context.defenderTerrainKey ?? terrainKeyOf(tile);
    const terrainDefense = terrainKey ? TERRAIN_PROPS[terrainKey]?.defense ?? 1 : 1;
    let strength = (defender.defense ?? 0)
      * ((defender.health ?? 100) / 100)
      * Math.max(1, terrainDefense)
      * this.rankMultiplier(defender);

    // Units inside a city are automatically fortified (+50%).
    if (defender.isFortified || context.defenderInCity) {
      strength *= 1.5;
    }

    const fortressDef = tile?.improvement
      ? IMPROVEMENT_PROPERTIES[String(tile.improvement)]?.defenseMultiplier
      : undefined;
    if (fortressDef) {
      strength *= fortressDef;
    }

    return strength;
  }

  /** Win probability for the attacker given both strengths. */
  static winChance(attackerStrength: number, defenderStrength: number): number {
    const total = attackerStrength + defenderStrength;
    return total > 0 ? attackerStrength / total : 0;
  }

  /**
   * Whether this attacker type ignores city walls: air units and siege
   * artillery (catapult, cannon, artillery) are the historical counters to a
   * walled city — the `CityCombatContext` docblock and `resolveCityCombat`
   * have always said so, and the Civ1 guide's siege advice ("catapults work
   * best … right up against the enemies' cities") depends on it. This is the
   * single predicate the engine passes as `ignoresWalls`.
   */
  static ignoresCityWalls(unit: CombatUnitLike): boolean {
    const unitClass = UNIT_PROPS[String(unit.type ?? '')]?.type;
    return unitClass === 'siege' || unitClass === 'air';
  }

  /**
   * Resolve one unit-vs-unit round. Only the loser of the roll takes damage;
   * damage is lethal on an overrun (attacker strength >= defender strength)
   * or when the defender is already at or below `COMBAT_DAMAGE`.
   */
  static resolveUnitRound(
    attacker: CombatUnitLike,
    defender: CombatUnitLike,
    context: UnitCombatContext = {},
  ): UnitCombatOutcome {
    const random = context.random ?? Math.random;
    const attackerStrength = this.attackerStrength(attacker);
    const defenderStrength = this.defenderStrength(defender, context);
    const attackerWinChance = this.winChance(attackerStrength, defenderStrength);
    const attackerWins = random() * (attackerStrength + defenderStrength) < attackerStrength;
    const canOverrun = attackerStrength >= defenderStrength;

    if (attackerWins) {
      const remaining = defender.health ?? 100;
      const lethal = canOverrun || remaining <= COMBAT_DAMAGE;
      const defenderDamage = lethal ? remaining : COMBAT_DAMAGE;
      return {
        attackerWins: true,
        attackerStrength,
        defenderStrength,
        attackerWinChance,
        attackerDamage: 0,
        defenderDamage,
        defenderDestroyed: remaining - defenderDamage <= 0,
        attackerDestroyed: false,
        canOverrun,
      };
    }

    const attackerDamage = COMBAT_DAMAGE;
    return {
      attackerWins: false,
      attackerStrength,
      defenderStrength,
      attackerWinChance,
      attackerDamage,
      defenderDamage: 0,
      defenderDestroyed: false,
      attackerDestroyed: (attacker.health ?? 100) - attackerDamage <= 0,
      canOverrun,
    };
  }

  /**
    * City assault odds: attacker strength vs `max(1, population)`, multiplied by 1.5 by
    * city walls (wall bonus only applies when the attacker does not ignore it).
   */
  static resolveCityRound(
    attacker: CombatUnitLike,
    city: CombatCityLike,
    context: CityCombatContext = {},
  ): CityCombatRound {
    const random = context.random ?? Math.random;
    const attackerStrength = this.attackerStrength(attacker);

    const buildings = Array.isArray(city.buildings) ? city.buildings : [];
    const hasWalls = buildings.includes('city_walls') || buildings.includes('walls');
    const wallsApplied = hasWalls && !context.ignoresWalls;
    let cityDefense = Math.max(1, city.population || 1);
    if (wallsApplied) cityDefense *= 1.5;

    const attackerWinChance = this.winChance(attackerStrength, cityDefense);
    const attackerWins = random() * (attackerStrength + cityDefense) < attackerStrength;

    return {
      attackerWins,
      attackerStrength,
      cityDefense,
      attackerWinChance,
      attackerDamage: attackerWins ? 0 : COMBAT_DAMAGE,
      cityHasWalls: hasWalls,
      wallsApplied,
    };
  }

  /**
   * Splash damage for one secondary stacked unit: 25% of the primary attack
   * damage, at least 1 HP whenever the primary hit landed. Pure — the caller
   * decides who is exposed (open ground) and who is immune (city, fortress,
   * fortified, embarked).
   */
  static splashDamage(primaryDamage: number): number {
    if (primaryDamage <= 0) return 0;
    return Math.max(1, Math.round(primaryDamage * SPLASH_DAMAGE_FRACTION));
  }

  /**
   * HP a unit recovers this turn inside one of its own cities: 2 HP, bounded
   * by missing health above and by the lifetime ledger below (at most 15% of
   * all battle damage ever taken comes back). Returns 0 when there is nothing
   * to heal or the ledger is exhausted. Pure — the caller checks city
   * presence and stamps the blood-drop marker.
   */
  static cityHealAmount(unit: CombatUnitLike): number {
    const missing = 100 - (unit.health ?? 100);
    if (missing <= 0) return 0;
    const cap = (unit.battleDamageTaken ?? 0) * CITY_HEAL_CAP_FRACTION;
    const healed = unit.healedInCityTotal ?? 0;
    const remaining = cap - healed;
    if (remaining <= 0) return 0;
    return Math.min(CITY_HEAL_PER_TURN, missing, Math.floor(remaining));
  }

  /**
   * Player-facing one-line summary of a unit round. Kept here so the toast and
   * any future combat log always describe the same numbers.
   */
  static describeUnitRound(
    kind: CombatEventKind,
    attackerName: string,
    defenderName: string,
    damage: Pick<UnitCombatOutcome, 'attackerDamage' | 'defenderDamage'>,
  ): string {
    if (kind === 'victory') {
      return `${attackerName} destroyed ${defenderName} (−${MathUtils.formatDamage(damage.defenderDamage)} HP)`;
    }
    if (kind === 'hit') {
      return `${attackerName} hit ${defenderName} for ${MathUtils.formatDamage(damage.defenderDamage)} HP`;
    }
    return `${defenderName} hit ${attackerName} for ${MathUtils.formatDamage(damage.attackerDamage)} HP`;
  }
}
