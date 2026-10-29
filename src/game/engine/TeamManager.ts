/**
 * TeamManager — the single source of truth for fixed alliances (locked teams).
 *
 * Fixed alliances are a setup-time game mode: the player divides the
 * civilizations into permanent teams before the game starts. A team is not a
 * diplomatic status of its own — it is a locked layer above the ordinary
 * pair-based diplomacy. Every teammate pair is forced to `alliance`, wars and
 * peace are expanded across whole teams by `DiplomacyManager`, and combat/AI
 * code asks this manager whether two civs may fight at all.
 *
 * Keeping membership here (instead of sprinkling `teamId` comparisons through
 * the engine) means there is exactly one place that can answer "are these two
 * on the same side?", and save/load only has to rebuild one map.
 */

import type GameEngine from './GameEngine';
import type { GameSettings } from './GameEngine';

export interface TeamValidationResult {
  ok: boolean;
  errors: string[];
  /** Team index per civilization slot, normalised to 0..teamCount-1. */
  normalized?: number[];
  teamCount: number;
}

const EMPTY_VALIDATION: TeamValidationResult = { ok: true, errors: [], teamCount: 0 };

/**
 * Validate a setup-time team assignment without an engine. Shared by
 * `TeamManager.configure()` and the setup screen, so the UI cannot offer a
 * configuration the engine would silently reject.
 *
 * The rules are deliberately strict about the two things that would make the
 * mode meaningless: a team game needs at least two teams, and at least one
 * team must actually contain an alliance (two or more civs). A 1v1v1 where
 * every civ is its own team is just a free-for-all.
 */
export function validateTeamAssignments(
  assignments: number[] | undefined,
  civCount: number,
): TeamValidationResult {
  if (!Array.isArray(assignments)) {
    return { ok: false, errors: ['No team assignment was provided.'], teamCount: 0 };
  }
  if (assignments.length !== civCount) {
    return {
      ok: false,
      errors: [`Expected ${civCount} team assignments, got ${assignments.length}.`],
      teamCount: 0,
    };
  }
  const errors: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < assignments.length; i++) {
    const value = assignments[i];
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`Civilization slot ${i} has an invalid team index.`);
      continue;
    }
    used.add(value);
  }
  if (errors.length > 0) return { ok: false, errors, teamCount: 0 };
  if (used.size < 2) {
    return { ok: false, errors: ['A fixed-alliance game needs at least two teams.'], teamCount: 0 };
  }

  // Normalise arbitrary team indices (e.g. 3, 7) to a dense 0..k-1 range.
  const sorted = [...used].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sorted.forEach((oldId, index) => remap.set(oldId, index));
  const normalized = assignments.map((value) => remap.get(value)!);

  const sizes = new Array(sorted.length).fill(0) as number[];
  for (const team of normalized) sizes[team] += 1;
  if (!sizes.some((size) => size >= 2)) {
    return {
      ok: false,
      errors: ['At least two civilizations must share a team.'],
      teamCount: 0,
    };
  }

  return { ok: true, errors: [], normalized, teamCount: sorted.length };
}

export class TeamManager {
  private readonly gameEngine: GameEngine;
  private enabledFlag = false;
  /** civilization slot -> team index */
  private teamByCiv = new Map<number, number>();
  /** team index -> civilization slots, ascending */
  private membersByTeam = new Map<number, number[]>();
  private teamIds: number[] = [];

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  /** Whether the current game is a fixed-alliance game. */
  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** Number of teams in the current game (0 when disabled). */
  get teamCount(): number {
    return this.teamIds.length;
  }

  /** Clear all team state (new game / load). */
  reset(): void {
    this.enabledFlag = false;
    this.teamByCiv.clear();
    this.membersByTeam.clear();
    this.teamIds = [];
  }

  /** Validate a setup-time team assignment (see {@link validateTeamAssignments}). */
  validate(assignments: number[] | undefined, civCount: number): TeamValidationResult {
    return validateTeamAssignments(assignments, civCount);
  }

  /**
   * Apply a validated assignment. Invalid input disables fixed alliances
   * instead of throwing: a corrupted save must still load as a normal game.
   */
  configure(settings: GameSettings, civCount: number): void {
    this.reset();
    if (!settings.fixedAlliances) return;

    const result = this.validate(settings.teamAssignments, civCount);
    if (!result.ok || !result.normalized) {
      console.warn('[TeamManager] Invalid fixed-alliance setup, falling back to free-for-all:', result.errors);
      return;
    }

    this.enabledFlag = true;
    this.teamIds = Array.from({ length: result.teamCount }, (_, index) => index);
    for (let civId = 0; civId < civCount; civId++) {
      const teamId = result.normalized[civId];
      this.teamByCiv.set(civId, teamId);
      const members = this.membersByTeam.get(teamId) ?? [];
      members.push(civId);
      this.membersByTeam.set(teamId, members);
    }
  }

  /** Write the team index onto every civilization for UI/save convenience. */
  applyToCivilizations(): void {
    for (const civ of this.gameEngine.civilizations ?? []) {
      civ.teamId = this.getTeamId(civ.id) ?? undefined;
    }
  }

  /** Team index for a civilization, or null when it has no team. */
  getTeamId(civId: number): number | null {
    if (!this.enabledFlag) return null;
    return this.teamByCiv.get(civId) ?? null;
  }

  /** All civilization slots in a team, ascending. */
  getTeamMembers(teamId: number): number[] {
    if (!this.enabledFlag) return [];
    return this.membersByTeam.get(teamId) ?? [];
  }

  /**
   * The civ itself plus its teammates. This is the expansion unit for
   * team-wide war/peace: a lone civ expands to `[civId]`, so the same code
   * path works for team and free-for-all games.
   */
  getTeamMembersOf(civId: number): number[] {
    const teamId = this.getTeamId(civId);
    if (teamId === null) return [civId];
    return this.getTeamMembers(teamId);
  }

  /** Teammates only (never includes `civId` itself). */
  getTeammates(civId: number): number[] {
    return this.getTeamMembersOf(civId).filter((id) => id !== civId);
  }

  /** Whether two distinct civilizations are locked allies. */
  isTeammate(civA: number, civB: number): boolean {
    if (!this.enabledFlag || civA === civB) return false;
    const teamA = this.teamByCiv.get(civA);
    const teamB = this.teamByCiv.get(civB);
    return teamA !== undefined && teamA === teamB;
  }

  /** All configured team ids (0..teamCount-1). */
  getTeamIds(): number[] {
    return [...this.teamIds];
  }

  /** Display name; team ids are zero-based internally, one-based for humans. */
  getTeamName(teamId: number): string {
    return `Team ${teamId + 1}`;
  }

  /**
   * A team is alive while at least one member still has a unit or a city.
   * This mirrors `VictoryManager.isCivilizationOperational` but works without
   * depending on the victory manager.
   */
  isTeamAlive(teamId: number): boolean {
    return this.getTeamMembers(teamId).some((civId) => this.isCivOperational(civId));
  }

  /** All teams that still have at least one operational member. */
  getAliveTeamIds(): number[] {
    return this.teamIds.filter((teamId) => this.isTeamAlive(teamId));
  }

  private isCivOperational(civId: number): boolean {
    const hasUnit = (this.gameEngine.units ?? []).some(
      (unit) => unit.civilizationId === civId && !unit.isDefeated,
    );
    if (hasUnit) return true;
    return (this.gameEngine.cities ?? []).some((city) => city.civilizationId === civId);
  }
}

export { EMPTY_VALIDATION };
