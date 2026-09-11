import type { Technology, Civilization } from '../../../types/game';
import GameEngine from './GameEngine';

/**
 * Civ I–style research model.
 *
 * Adds the exact conditions that make research speed depend on more than just
 * raw beaker output:
 *
 * 1. Tech cost scales with map size and difficulty:
 *      cost = floor((baseCost * mapTechRate) / difficultyFactor)
 *    and is further adjusted by comparing the civ's tech count to the most
 *    advanced known civ (bonus if behind, penalty if ahead).
 * 2. Beakers applied per turn:
 *      applied = floor(floor((totalBaseBeakers + 1) * knownCivsModifier)
 *                      * prerequisitesModifier)
 *    - knownCivsModifier < 1.0 when contacted civs already know the tech.
 *    - prerequisitesModifier < 1.0 when the civ has discovered prerequisite
 *      techs.
 * 3. Research can never finish in fewer than MIN_TURNS (4) turns, nor take
 *    longer than MAX_TURNS (32) turns.
 */

export const MIN_RESEARCH_TURNS = 4;
export const MAX_RESEARCH_TURNS = 32;

/** Difficulty cost factor — higher = cheaper techs (easier difficulty). */
const DIFFICULTY_FACTORS: Record<string, number> = {
  CHIEFTAIN: 1.2,
  WARLORD: 1.1,
  PRINCE: 1.0,
  KING: 0.9,
  EMPEROR: 0.8,
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export class ResearchManager {
  constructor(private gameEngine: GameEngine) {}

  /** Map-size tech multiplier (bigger maps → pricier techs, like Civ 1). */
  mapTechRate(): number {
    const map = (this.gameEngine as unknown as { map?: { width?: number; height?: number } }).map;
    const w = map?.width ?? 80;
    const h = map?.height ?? 50;
    return clamp(Math.round((w + h) / 45), 1, 3);
  }

  difficultyFactor(): number {
    const d = String(this.gameEngine.gameSettings?.difficulty ?? 'PRINCE').toUpperCase();
    return DIFFICULTY_FACTORS[d] ?? 1;
  }

  /**
   * Civ 1 tech-count comparison: a civ behind the most-advanced known civ gets
   * a cost bonus (< 1), the leader pays a penalty (> 1). Clamped to ±20%.
   */
  techCountFactor(civ: Civilization): number {
    const civs = this.gameEngine.civilizations ?? [];
    const myCount = Array.isArray(civ.technologies) ? civ.technologies.length : 0;
    let maxCount = myCount;
    for (const other of civs) {
      if (other.id === civ.id || other.isAlive === false) continue;
      const count = Array.isArray(other.technologies) ? other.technologies.length : 0;
      if (count > maxCount) maxCount = count;
    }
    return clamp(1 + (myCount - maxCount) * 0.1, 0.8, 1.2);
  }

  /** Effective, fully-modified tech cost for a civ (used for completion + UI). */
  effectiveTechCost(civ: Civilization, tech: Technology): number {
    const base = typeof tech.cost === 'number' ? tech.cost : 0;
    const raw = (base * this.mapTechRate()) / this.difficultyFactor();
    return Math.max(10, Math.floor(raw * this.techCountFactor(civ)));
  }

  /** < 1.0 when contacted civs already know the researched tech. */
  knownCivsModifier(civ: Civilization, tech: Technology): number {
    const dm = this.gameEngine.diplomacyManager as { getStatus?: (a: number, b: number) => string | undefined } | undefined;
    let known = 0;
    for (const other of this.gameEngine.civilizations ?? []) {
      if (other.id === civ.id || other.isAlive === false) continue;
      const contacted = dm && typeof dm.getStatus === 'function' ? dm.getStatus(civ.id, other.id) !== undefined : true;
      if (!contacted) continue;
      if (Array.isArray(other.technologies) && other.technologies.includes(tech.id)) known++;
    }
    return clamp(1 - known * 0.1, 0.6, 1);
  }

  /** < 1.0 when the civ has discovered some of the tech's prerequisites. */
  prerequisitesModifier(civ: Civilization, tech: Technology): number {
    const prereqs = Array.isArray(tech.prerequisites) ? tech.prerequisites : [];
    if (prereqs.length === 0) return 1;
    const researched = prereqs.filter((p) =>
      Array.isArray(civ.technologies) && civ.technologies.includes(p),
    ).length;
    return clamp(1 - (researched / prereqs.length) * 0.4, 0.6, 1);
  }

  /** Civ 1 beakers-applied formula for a turn. */
  beakersApplied(civ: Civilization, tech: Technology, totalBaseBeakers: number): number {
    const known = this.knownCivsModifier(civ, tech);
    const prereq = this.prerequisitesModifier(civ, tech);
    const base = Math.max(0, totalBaseBeakers || 0);
    return Math.floor(Math.floor((base + 1) * known) * prereq);
  }

  /**
   * Estimated turns to finish the current research at the given per-turn
   * science, honoring the 4-turn minimum and 32-turn maximum. Used by the UI
   * so the "research time" responds immediately when the Science Rate changes.
   */
  estimatedTurns(civ: Civilization, tech: Technology, perTurnScience: number): number {
    const cost = this.effectiveTechCost(civ, tech);
    const progress = civ.researchProgress ?? 0;
    const remaining = Math.max(0, cost - progress);
    if (remaining <= 0) return 0;
    const perTurn = Math.max(0, this.beakersApplied(civ, tech, perTurnScience));
    if (perTurn <= 0) return MAX_RESEARCH_TURNS;
    return clamp(Math.ceil(remaining / perTurn), MIN_RESEARCH_TURNS, MAX_RESEARCH_TURNS);
  }

  /**
   * Beakers that would ACTUALLY be applied to the civ's current tech this
   * turn — the exact value `advanceResearch` adds, including the 4-turn
   * minimum (per-turn cap) and the 32-turn maximum (per-turn floor), but
   * without mutating any state. UI displays must use this instead of
   * `beakersApplied`: the raw modifier value over-reports whenever the
   * min-turns cap clips the progress (e.g. the panel showed "+19" while only
   * 9 points were actually added to the tech).
   */
  perTurnProgress(civ: Civilization, tech: Technology, totalBaseBeakers: number): number {
    const cost = this.effectiveTechCost(civ, tech);
    const progress = civ.researchProgress ?? 0;
    const remaining = Math.max(0, cost - progress);
    if (remaining <= 0) return 0;

    let beakers = this.beakersApplied(civ, tech, totalBaseBeakers);

    // Min turns: never apply more than remaining/MIN_TURNS per turn, so the
    // remaining work always spans at least MIN_RESEARCH_TURNS turns.
    const maxPerTurn = Math.max(1, Math.ceil(remaining / MIN_RESEARCH_TURNS));
    beakers = Math.min(beakers, maxPerTurn);

    // Max turns: always apply at least cost/MAX_TURNS per turn (fixed floor,
    // based on the FULL cost). The floor never overrides the min-turns cap.
    const minPerTurn = Math.ceil(cost / MAX_RESEARCH_TURNS);
    beakers = Math.max(beakers, Math.min(minPerTurn, maxPerTurn));

    // Never overshoot past the remaining cost, and always make ≥ 1 progress.
    return Math.max(1, Math.min(beakers, remaining));
  }

  /**
   * Advance one turn of research for the civ's current tech. Returns the
   * completed tech id, or null if still in progress.
   *
   * Enforces the hard caps:
   *  - never more than ceil(remaining / MIN_TURNS) progress per turn (so a
   *    tech can't be finished in fewer than 4 turns)
   *  - always at least ceil(remaining / MAX_TURNS) progress per turn (so a
   *    tech can't take longer than 32 turns)
   */
  advanceResearch(civ: Civilization, tech: Technology, totalBaseBeakers: number): string | null {
    const cost = this.effectiveTechCost(civ, tech);
    const progress = civ.researchProgress ?? 0;
    const remaining = Math.max(0, cost - progress);
    if (remaining <= 0) return tech.id;

    const beakers = this.perTurnProgress(civ, tech, totalBaseBeakers);

    civ.researchProgress = progress + beakers;
    if (civ.researchProgress >= cost) return tech.id;
    return null;
  }
}
