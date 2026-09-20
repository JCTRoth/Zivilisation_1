/**
 * CombatSystem — the single source of truth for fighting.
 *
 * Every unit-vs-unit and unit-vs-city exchange resolves through this module so
 * the engine, the event/notification layer and the renderer all agree on the
 * numbers the player sees. It owns:
 *
 *   - the single `COMBAT_DAMAGE` constant (HP% a lost round costs),
 *   - the strength formulas (health, terrain, fortification, city, fortress),
 *   - the round roll and the "no run-overs" overrun rule,
 *   - how much damage each side takes and whether it was destroyed,
 *   - the player-facing summary strings shown as toasts.
 *
 * Rules (Civ1-flavoured, as implemented by this clone):
 *   - Strength = stat × health%, defender additionally gets terrain defence,
 *     +50% when fortified or inside a city, and the fortress multiplier.
 *   - The attacker wins the round with probability A / (A + D).
 *   - Only the side that LOSES the round takes damage:
 *       attacker wins → defender takes damage (lethal when the attacker is at
 *       least as strong as the defender — the overrun rule — otherwise
 *       `COMBAT_DAMAGE`), attacker takes none;
 *       defender wins → attacker takes `COMBAT_DAMAGE`, defender takes none.
 *   - A victorious attacker never advances into the defender's tile.
 */

import { TERRAIN_PROPS, UNIT_PROPS } from '@/utils/Constants';
import { IMPROVEMENT_PROPERTIES } from '@/data/TileImprovementConstants';

/** HP (%) a lost combat round costs a unit. */
export const COMBAT_DAMAGE = 25;

/** Terrain-ish shape needed for defence bonuses. */
export interface CombatTerrainLike {
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

/** Whether a unit type ignores city walls (air units and siege artillery). */
export function unitIgnoresCityWalls(type: string): boolean {
  const key = String(type ?? '').trim().toLowerCase();
  if (UNIT_PROPS[key]?.type === 'air') return true;
  return key === 'cannon' || key === 'artillery';
}

export class CombatSystem {
  /** Attacking strength: attack stat scaled by remaining health. */
  static attackerStrength(unit: CombatUnitLike): number {
    return (unit.attack ?? 0) * ((unit.health ?? 100) / 100);
  }

  /**
   * Defending strength: defence stat × health, plus the Civ1 stacking bonuses
   * (terrain defence, +50% fortification/in-city, fortress multiplier).
   */
  static defenderStrength(
    defender: CombatUnitLike,
    context: UnitCombatContext = {},
  ): number {
    const tile = context.defenderTile ?? null;
    const terrainKey = context.defenderTerrainKey ?? terrainKeyOf(tile);
    const terrainDefense = terrainKey ? TERRAIN_PROPS[terrainKey]?.defense ?? 1 : 1;
    let strength = (defender.defense ?? 0) * ((defender.health ?? 100) / 100) * Math.max(1, terrainDefense);

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
   * City assault odds: attacker strength vs `max(1, population)`, tripled by
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
    if (wallsApplied) cityDefense *= 3;

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
      return `${attackerName} destroyed ${defenderName} (−${damage.defenderDamage} HP)`;
    }
    if (kind === 'hit') {
      return `${attackerName} hit ${defenderName} for ${damage.defenderDamage} HP`;
    }
    return `${defenderName} hit ${attackerName} for ${damage.attackerDamage} HP`;
  }
}

export default CombatSystem;
