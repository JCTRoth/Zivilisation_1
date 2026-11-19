/**
 * WonderManager — ownership, world-uniqueness and obsolescence for the 24
 * World Wonders.
 *
 * State model: a wonder "exists" wherever it sits in `city.buildings`. There
 * is deliberately NO second registry to keep in sync — capture, save/load and
 * legacy saves all work for free. Obsolescence is evaluated on demand from
 * live technologies, so effects switch off the moment any civilization
 * discovers the obsolescence tech, with no event bookkeeping to drift.
 *
 * All heavy lifting happens through this class so engine code has one place
 * to ask wonder questions.
 */

import type GameEngine from './GameEngine';
import type { City, Civilization } from '../../../types/game';
import {
  getWonder,
  isWonderId,
  isWonderObsolete,
  wonderGroupId,
  wonderGroupMembers,
  wondersInCity,
  WONDERS,
  type WonderDefinition,
} from '@/data/WonderData';

export class WonderManager {
  constructor(private readonly gameEngine: GameEngine) {}

  private get cities(): City[] {
    return this.gameEngine.cities ?? [];
  }

  private get civilizations(): Civilization[] {
    return this.gameEngine.civilizations ?? [];
  }

  // ── Ownership / uniqueness ──────────────────────────────────────────────

  /** The city that completed `wonderId`, or null when nobody has it. */
  findWonderCity(wonderId: string): City | null {
    return this.cities.find((c) => (c.buildings ?? []).includes(wonderId)) ?? null;
  }

  /** True once any civilization has completed `wonderId` (spec: only once). */
  isBuilt(wonderId: string): boolean {
    return this.findWonderCity(wonderId) !== null;
  }

  /** The civilization that owns `wonderId`, or null. */
  ownerCivId(wonderId: string): number | null {
    return this.findWonderCity(wonderId)?.civilizationId ?? null;
  }

  // ── Mutual-exclusion groups (e.g. the space stations) ───────────────────

  /** True once ANY member of `groupId` has been completed anywhere. */
  isGroupCompleted(groupId: string): boolean {
    return WONDERS.some((w) => w.groupId === groupId && this.isBuilt(w.id));
  }

  /**
   * True when `wonderId` belongs to a group that already has a completed
   * member — the wonder can no longer be started (one station per world).
   */
  isGroupClosed(wonderId: string): boolean {
    const gid = wonderGroupId(wonderId);
    return !!gid && this.isGroupCompleted(gid);
  }

  /**
   * City holding a completed member of `wonderId`'s group, or null. Used for
   * the production-conflict path so the loser learns which wonder won.
   */
  findGroupCity(wonderId: string): City | null {
    const members = wonderGroupMembers(wonderId);
    if (members.length === 0) return null;
    return (
      this.cities.find((c) => (c.buildings ?? []).some((b) => members.includes(b))) ?? null
    );
  }

  /** Wonder ids held by one city. */
  wondersInCity(city: City): string[] {
    return wondersInCity(city);
  }

  /** All wonder ids owned by `civId` (including obsolete ones — they still score). */
  wondersOfCiv(civId: number): string[] {
    const result: string[] = [];
    for (const city of this.cities) {
      if (city.civilizationId !== civId) continue;
      result.push(...wondersInCity(city));
    }
    return result;
  }

  /** The wonder definitions owned by `civId`. */
  wonderDefinitionsOfCiv(civId: number): WonderDefinition[] {
    return this.wondersOfCiv(civId)
      .map((id) => getWonder(id))
      .filter((w): w is WonderDefinition => !!w);
  }

  // ── Obsolescence ────────────────────────────────────────────────────────

  /** True when ANY civilization has discovered `wonderId`'s obsolescence tech. */
  isObsolete(wonderId: string): boolean {
    if (!isWonderId(wonderId)) return false;
    return isWonderObsolete(wonderId, this.civilizations);
  }

  /**
   * Whether `wonderId` currently works for `civId`: the civ must own it AND it
   * must not be obsolete anywhere in the world.
   */
  isActive(wonderId: string, civId: number): boolean {
    if (this.ownerCivId(wonderId) !== civId) return false;
    return !this.isObsolete(wonderId);
  }

  /** Active (owned + non-obsolete) wonders of one civilization. */
  activeWonders(civId: number): WonderDefinition[] {
    return this.wonderDefinitionsOfCiv(civId).filter((w) => !this.isObsolete(w.id));
  }

  /** Convenience: is this active wonder owned by `civId`? */
  hasActive(wonderId: string, civId: number): boolean {
    return this.isActive(wonderId, civId);
  }

  // ── Continent helpers ───────────────────────────────────────────────────

  /** Landmass id of the city's tile (-1 when unknown/water). */
  landmassOf(city: City): number {
    try {
      return this.gameEngine.getLandmassId?.(city.col, city.row) ?? -1;
    } catch {
      return -1;
    }
  }

  /**
   * Are two cities on the same continent? Cities on unknown landmasses (-1)
   * only match each other when they are the same city, so a broken map never
   * makes every city "continent-wide".
   */
  sameContinent(a: City, b: City): boolean {
    if (a.id === b.id) return true;
    const la = this.landmassOf(a);
    const lb = this.landmassOf(b);
    return la >= 0 && lb >= 0 && la === lb;
  }

  /**
   * Every city of `wonderId`'s owner that sits on the same continent as the
   * wonder itself. For continent-scoped effects the reference point is always
   * the wonder city.
   */
  citiesOnWonderContinent(wonderId: string): City[] {
    const wonderCity = this.findWonderCity(wonderId);
    if (!wonderCity) return [];
    return this.cities.filter(
      (c) => c.civilizationId === wonderCity.civilizationId && this.sameContinent(c, wonderCity),
    );
  }

  // ── Construction gate ───────────────────────────────────────────────────

  /**
   * Can `city` still complete `wonderId` right now? Returns the blocking
   * reason when not. In-progress races are allowed (multiple cities may work
   * on the same wonder); only COMPLETED wonders block.
   */
  completionBlocker(wonderId: string, city: City): string | null {
    if (!isWonderId(wonderId)) return null;
    if ((city.buildings ?? []).includes(wonderId)) return 'already_built';
    if (this.isBuilt(wonderId)) return 'wonder_already_completed';
    if (this.isGroupClosed(wonderId)) return 'wonder_group_completed';
    return null;
  }

  /**
   * Global gates (work for every civ once the wonder exists anywhere):
   *  - Manhattan Project → nuclear weapons
   *  - International Space Station → the space race (Moonshot)
   */
  isGlobalGateBuilt(wonderId: string): boolean {
    return this.isBuilt(wonderId) && !this.isObsolete(wonderId);
  }
}
