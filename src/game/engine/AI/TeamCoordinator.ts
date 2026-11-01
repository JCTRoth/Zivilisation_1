/**
 * TeamCoordinator — per-round strategic directives for fixed-alliance games.
 *
 * Teams v1 made teammates *safe* from each other (no friendly fire, shared
 * vision, team-wide war). This class makes them *coordinated*: it runs once
 * per round from `TurnManager.advanceTurn`'s new-round block, before any
 * member takes its turn, and recomputes a set of soft directives that member
 * AIs consult while picking targets:
 *
 *   * **Scout region claims** (Phase 1) — every frontier cell of the team is
 *     claimed by exactly one of the team's explorers (nearest land scout for
 *     land, nearest naval hull for water). Members prefer their own claims and
 *     only take a teammate's cell when nothing else is available, so two
 *     scouts stop sweeping the same fog.
 *   * **POI registry** (Phase 1 API) — points of interest any member reveals
 *     (enemy cities, good city sites, fish clusters) are published for the
 *     whole team, so a teammate's settler or navy never has to re-discover
 *     what one member already found.
 *   * **War plan / defense missions** (Phases 2–3) — added in later steps;
 *     the directive container below already reserves the shape.
 *
 * Design rules (matching the Teams v1 philosophy):
 *
 *   * **Advisory, never load-bearing.** Every directive is a preference. If
 *     the coordinator is skipped, has no state, or disagrees with an AI, the
 *     member AI still works — it just loses the coordination bonus. Nothing
 *     here can hard-lock a unit or block a turn.
 *   * **Stateless across rounds.** Claims are recomputed each round from live
 *     engine state; POIs expire by age. Nothing here is persisted, so the save
 *     format stays at v5 and loading a save cannot produce stale directives.
 *   * **FFA-inert.** With `!teamManager.enabled` every query returns
 *     "no directive" and `processRound` clears state, so free-for-all games
 *     behave exactly as before.
 *
 * Cost: one full-map frontier scan per team per round (only for teams that
 * actually have 2+ explorers), plus O(1) map lookups from the scout target
 * choosers.
 */

import type GameEngine from '../GameEngine';
import type { Unit } from '../../../../types/game';
import { UNIT_PROPS } from '@/utils/Constants';
import {
  assessCityThreat,
  calculateDangerThreshold,
  collectCityThreatSamples,
  computeCityGarrisonStrength,
} from './AIStrategy';

/** A published point of interest, visible to every member of `teamId`. */
export interface TeamPoi {
  kind: 'enemy_city' | 'city_site' | 'fish_cluster' | 'landmass_edge';
  col: number;
  row: number;
  teamId: number;
  /** Round in which the POI was published (for age-based pruning). */
  round: number;
}

/** POIs older than this many rounds are dropped — intel goes stale. */
const POI_MAX_AGE_ROUNDS = 15;

/** Keep a team's primary war target for at most this many rounds. */
const TEAM_PRIMARY_MAX_AGE_ROUNDS = 15;
/** A teammate's captured city steers the whole team for this long. */
const TEAM_RETALIATION_WINDOW_ROUNDS = 15;
/** Proximity distance cap in the primary-target score. */
const PRIMARY_MAX_FORCE_DISTANCE = 30;

/** The team's current joint war objective (Phase 2 — coordinated attacking). */
export interface TeamWarPlan {
  /** Enemy city the whole team converges on. */
  primary: { col: number; row: number; civId: number };
  /** Round in which this target was chosen (drives rotation and validity). */
  assignedRound: number;
}

/**
 * A teammate's city that needs help, and which member is assigned to send it
 * (Phase 3 — mutual defense). The nearest land-reachable member that is not
 * the owner takes the job; the owner's own defense machinery still ranks
 * above it.
 */
export interface TeamDefenseDirective {
  cityId: string;
  col: number;
  row: number;
  /** The teammate whose city it is. */
  ownerCivId: number;
  /** The member assigned to help (never the owner). */
  helperCivId: number;
  /** Threat score from the owner's perspective (diagnostics / UI). */
  netThreat: number;
  /** True when the OWNER asked for this help explicitly (player request). */
  requested?: boolean;
}

/** How long a player defense request stays active without renewal. */
const PLAYER_DEFENSE_REQUEST_ROUNDS = 10;

/** `"col,row"` cell key. */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export class TeamCoordinator {
  private readonly gameEngine: GameEngine;
  /** teamId -> ("col,row" -> owning unit id). Recomputed every round. */
  private claimsByTeam = new Map<number, Map<string, string>>();
  /** teamId -> published points of interest. */
  private poiByTeam = new Map<number, TeamPoi[]>();
  /** teamId -> current joint war objective (kept across rounds). */
  private warPlanByTeam = new Map<number, TeamWarPlan>();
  /** teamId -> threatened teammate cities and who helps (recomputed). */
  private defenseByTeam = new Map<number, TeamDefenseDirective[]>();
  /** Player-pinned team primary target ("Coordinate attack on city X"). */
  private pinnedPrimaryByTeam = new Map<number, { col: number; row: number; civId: number }>();
  /** Player defense requests ("Defend city X") by city id, round-stamped. */
  private defenseRequests = new Map<string, { ownerCivId: number; col: number; row: number; round: number }>();
  /**
   * Per-round diagnostics for verification runs (Phase 6): how often the
   * claim preference actually steered a scout away from a teammate's region
   * (`claimYields`) and how often the fallback had to rescue one
   * (`fallbackPicks`). Reset every round with the claims.
   */
  private claimYields = 0;
  private fallbackPicks = 0;
  /** Round stamp of the last {@link processRound} call. */
  private currentRound = 0;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  /** Whether the current game is a fixed-alliance game. */
  get enabled(): boolean {
    return this.gameEngine.teamManager?.enabled === true;
  }

  /** Drop all derived state (new game / load). */
  reset(): void {
    this.claimsByTeam.clear();
    this.poiByTeam.clear();
    this.warPlanByTeam.clear();
    this.defenseByTeam.clear();
    this.pinnedPrimaryByTeam.clear();
    this.defenseRequests.clear();
    this.currentRound = 0;
  }

  /**
   * Called once per round from `TurnManager.advanceTurn`, after the
   * diplomacy turn and before the first member's `startTurn`. Recomputes
   * scout region claims and the team war plan; clears everything in
   * free-for-all.
   */
  processRound(roundNumber: number): void {
    this.currentRound = roundNumber;
    if (!this.enabled || this.gameEngine.devMode) {
      this.claimsByTeam.clear();
      this.poiByTeam.clear();
      this.warPlanByTeam.clear();
      this.defenseByTeam.clear();
      return;
    }
    this.prunePois();
    this.claimYields = 0;
    this.fallbackPicks = 0;
    this.computeScoutClaims();
    this.computeWarPlans();
    this.computeDefenseAssignments();
  }

  /** Record that a scout yielded a claimed cell to a teammate (per round). */
  noteClaimYield(): void {
    this.claimYields += 1;
  }

  /** Record that the unfiltered fallback had to rescue a target pick. */
  noteFallbackPick(): void {
    this.fallbackPicks += 1;
  }

  /** Diagnostics snapshot for verification runs and tests. */
  get diagnostics(): { claimYields: number; fallbackPicks: number } {
    return { claimYields: this.claimYields, fallbackPicks: this.fallbackPicks };
  }

  // ──────────────────────────────────────────────────────────────
  // Scout region claims (Phase 1)
  // ──────────────────────────────────────────────────────────────

  /**
   * Whether `unit` should prefer NOT to target `(col, row)` because another
   * explorer of the same team has a closer claim on that frontier cell.
   *
   * Pure preference: callers must fall back to the unfiltered pick when this
   * returns true for every candidate, so a scout can never starve behind a
   * teammate's region.
   */
  shouldYield(unit: Pick<Unit, 'id' | 'civilizationId'>, col: number, row: number): boolean {
    const teamId = this.gameEngine.teamManager?.getTeamId(unit.civilizationId) ?? null;
    if (teamId === null) return false;
    const claims = this.claimsByTeam.get(teamId);
    if (!claims || claims.size === 0) return false;
    const owner = claims.get(cellKey(col, row));
    return owner !== undefined && owner !== unit.id;
  }

  /** The unit that owns a frontier claim, or null (tests / diagnostics). */
  claimOwnerAt(teamId: number, col: number, row: number): string | null {
    return this.claimsByTeam.get(teamId)?.get(cellKey(col, row)) ?? null;
  }

  /** Size of a team's claim map (0 for FFA / uncomputed teams). */
  claimCount(teamId: number): number {
    return this.claimsByTeam.get(teamId)?.size ?? 0;
  }

  /**
   * Partition the team's frontier among its explorers.
   *
   * A *frontier* cell is unexplored-for-the-team with at least one
   * 8-neighbour already explored by a member. Each frontier cell goes to the
   * nearest claimant of matching mobility — land scouts claim land (including
   * impassable land such as lakes, which are harmless: scouts filter
   * impassable targets out themselves), naval hulls claim water. Ties break
   * on the lower unit id so the assignment is deterministic within a round.
   *
   * Only teams with 2+ alive members AND 2+ explorers are computed: a team
   * with a single explorer has nobody to coordinate with, and scanning for it
   * would be pure cost.
   */
  private computeScoutClaims(): void {
    this.claimsByTeam.clear();
    const teamManager = this.gameEngine.teamManager;
    const map = this.gameEngine.map;
    const units = this.gameEngine.units;
    if (!teamManager?.enabled || !map || !Array.isArray(units)) return;

    const width = map.width;
    const height = map.height;
    if (!(width > 0 && height > 0)) return;

    for (const teamId of teamManager.getTeamIds()) {
      const members = teamManager.getTeamMembers(teamId);
      if (members.length < 2) continue;

      // Explorers of this team, split by mobility.
      const landExplorers: Unit[] = [];
      const navalExplorers: Unit[] = [];
      for (const unit of units) {
        if (unit.isDefeated) continue;
        if (!members.includes(unit.civilizationId)) continue;
        if (UNIT_PROPS[String(unit.type ?? '').trim().toLowerCase()]?.naval === true) {
          navalExplorers.push(unit);
        } else if (unit.type === 'scout') {
          landExplorers.push(unit);
        }
      }
      const explorers = landExplorers.length + navalExplorers.length;
      if (explorers < 2) continue;

      // Union of the members' explored arrays — the team's shared knowledge.
      const storages = members
        .map((civId) => this.gameEngine.playerStorage?.get(civId))
        .filter((s): s is NonNullable<typeof s> => !!s && Array.isArray(s.explored));
      if (storages.length === 0) continue;
      const explored = new Uint8Array(width * height);
      for (const storage of storages) {
        const source = storage.explored;
        const limit = Math.min(source.length, explored.length);
        for (let i = 0; i < limit; i++) {
          if (source[i]) explored[i] = 1;
        }
      }

      const claims = new Map<string, string>();
      for (let row = 0; row < height; row++) {
        const rowOffset = row * width;
        for (let col = 0; col < width; col++) {
          const index = rowOffset + col;
          if (explored[index]) continue; // already known to the team

          // Frontier: at least one 8-neighbour is team-explored.
          let isFrontier = false;
          for (let dr = -1; dr <= 1 && !isFrontier; dr++) {
            const nr = row + dr;
            if (nr < 0 || nr >= height) continue;
            for (let dc = -1; dc <= 1; dc++) {
              if (dc === 0 && dr === 0) continue;
              const nc = col + dc;
              if (nc < 0 || nc >= width) continue;
              if (explored[nr * width + nc]) {
                isFrontier = true;
                break;
              }
            }
          }
          if (!isFrontier) continue;

          // Mobility: water (ocean/river, navigable by hulls) vs land.
          const tile = this.gameEngine.getTileAt?.(col, row);
          const terrainKey = String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase();
          const isWater = terrainKey === 'ocean' || terrainKey === 'river';
          const claimants = isWater ? navalExplorers : landExplorers;
          if (claimants.length === 0) continue;

          // Nearest claimant by Chebyshev distance; ties break on unit id.
          let best: Unit | null = null;
          let bestDistance = Infinity;
          for (const claimant of claimants) {
            const distance = Math.max(Math.abs(claimant.col - col), Math.abs(claimant.row - row));
            if (
              distance < bestDistance ||
              (distance === bestDistance && best !== null && claimant.id < best.id)
            ) {
              best = claimant;
              bestDistance = distance;
            }
          }
          if (best) claims.set(cellKey(col, row), best.id);
        }
      }
      this.claimsByTeam.set(teamId, claims);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Team war plan (Phase 2 — coordinated attacking)
  // ──────────────────────────────────────────────────────────────

  /**
   * The team's joint primary target, or null when the team is at peace or no
   * enemy city is known to the team. Members hand this to their bulk planner
   * (`teamFocusFor` in `AIManager`) so every civ converges on the same city
   * instead of sieging a different one each.
   */
  getTeamWarPlan(teamId: number): TeamWarPlan | null {
    if (!this.enabled) return null;
    return this.warPlanByTeam.get(teamId) ?? null;
  }

  /** Shorthand for member code: the primary target of `civId`'s team. */
  teamFocusFor(civId: number): { col: number; row: number; civId: number } | null {
    if (!this.enabled) return null;
    const teamId = this.gameEngine.teamManager?.getTeamId(civId) ?? null;
    if (teamId === null) return null;
    return this.warPlanByTeam.get(teamId)?.primary ?? null;
  }

  /**
   * Player directive ("Coordinate attack on city X"): pin the team's primary
   * target regardless of what the scoring would pick. The city must be an
   * enemy city of the acting civ's team — an illegal pin is refused, never
   * silently applied. Returns whether the directive was accepted.
   */
  pinPrimaryTarget(civId: number, col: number, row: number): boolean {
    if (!this.enabled) return false;
    const teamId = this.gameEngine.teamManager?.getTeamId(civId) ?? null;
    if (teamId === null) return false;
    const city = this.gameEngine.getCityAt?.(col, row);
    if (!city) return false;
    // Own and teammate cities are not targets; the owner must be a current
    // enemy of the team (checked through the acting civ's own war set, which
    // for a team-wide war is every member's war set).
    if (this.gameEngine.teamManager?.getTeamMembers(teamId)?.includes(city.civilizationId)) return false;
    const diplomacy = this.gameEngine.diplomacyManager;
    if (diplomacy && !diplomacy.getEnemies(civId).includes(city.civilizationId)) return false;
    this.pinnedPrimaryByTeam.set(teamId, { col, row, civId: city.civilizationId });
    return true;
  }

  /**
   * Player directive ("Defend city X"): ask the teammates to defend one of
   * the actor's own cities explicitly. Unlike the computed directives this
   * ignores the threat arithmetic — the player decides — but it still
   * assigns a land-reachable helper and expires after
   * {@link PLAYER_DEFENSE_REQUEST_ROUNDS} rounds.
   */
  requestDefense(civId: number, cityId: string): boolean {
    if (!this.enabled) return false;
    const city = (this.gameEngine.cities ?? []).find((c) => c.id === cityId);
    if (!city || city.civilizationId !== civId) return false;
    const teamId = this.gameEngine.teamManager?.getTeamId(civId) ?? null;
    if (teamId === null) return false;
    if ((this.gameEngine.teamManager?.getTeamMembers(teamId) ?? []).length < 2) return false;
    this.defenseRequests.set(cityId, {
      ownerCivId: civId, col: city.col, row: city.row, round: this.currentRound,
    });
    return true;
  }

  /**
   * Recompute every team's joint primary target.
   *
   * A primary is an enemy city the team *knows* (explored by at least one
   * member — vision is shared, so this is team knowledge), scored by value,
   * proximity to the team's forces and retaliation pressure. A still-valid
   * plan is KEPT — stability matters: an army mid-march must not be
   * redirected because a richer city was spotted one ring over. It rotates
   * when the city is captured, changes owner, leaves the enemy set, ages out
   * ({@link TEAM_PRIMARY_MAX_AGE_ROUNDS}) or the intel goes stale.
   */
  private computeWarPlans(): void {
    const teamManager = this.gameEngine.teamManager;
    const diplomacy = this.gameEngine.diplomacyManager;
    if (!teamManager?.enabled || !diplomacy) {
      this.warPlanByTeam.clear();
      return;
    }

    const next = new Map<number, TeamWarPlan>();
    for (const teamId of teamManager.getTeamIds()) {
      const members = teamManager.getTeamMembers(teamId);
      if (members.length < 2) continue;

      // 1) The team's enemies: an enemy of any member is an enemy of all.
      const enemies = new Set<number>();
      for (const member of members) {
        for (const enemy of diplomacy.getEnemies(member)) enemies.add(enemy);
      }
      if (enemies.size === 0) continue; // peace → no joint objective

      // 2) Retaliation pressure: a member that recently lost a city points
      //    the whole team at the capturer (the per-civ memory widened to the
      //    team).
      const retaliateAgainst = new Set<number>();
      for (const member of members) {
        const turnData = this.gameEngine.playerStorage?.get(member)?.turnData;
        const lostRound = turnData?.lastCityLostRound as number | undefined;
        const lostTo = turnData?.lastCityLostTo as number | undefined;
        if (
          typeof lostRound === 'number'
          && typeof lostTo === 'number'
          && this.currentRound - lostRound <= TEAM_RETALIATION_WINDOW_ROUNDS
        ) {
          retaliateAgainst.add(lostTo);
        }
      }

      // 3) Candidate cities: enemy cities the team has explored.
      let best: { col: number; row: number; civId: number } | null = null;
      let bestScore = -Infinity;
      for (const city of this.gameEngine.cities ?? []) {
        if (!enemies.has(city.civilizationId)) continue;
        if (!this.isExploredByTeam(members, city.col, city.row)) continue;
        let score = 40 + (city.population ?? 1) * 4;
        if (retaliateAgainst.has(city.civilizationId)) score += 80;
        const distance = this.distanceToTeamForce(members, city.col, city.row);
        score -= Math.min(distance, PRIMARY_MAX_FORCE_DISTANCE) * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = { col: city.col, row: city.row, civId: city.civilizationId };
        }
      }

      // 4) A player-pinned primary ("Coordinate attack on city X") outranks
      //    everything while it stays valid — the player is the team's
      //    commander. A dead pin (captured, defected, no longer an enemy)
      //    retires itself and the computed pick takes over.
      const pinned = this.pinnedPrimaryByTeam.get(teamId);
      if (pinned) {
        const city = this.gameEngine.getCityAt?.(pinned.col, pinned.row);
        const pinValid = !!city
          && city.civilizationId === pinned.civId
          && enemies.has(city.civilizationId)
          && this.isExploredByTeam(members, city.col, city.row);
        if (pinValid) {
          const previous = this.warPlanByTeam.get(teamId);
          const sameTarget = previous != null
            && previous.primary.col === pinned.col
            && previous.primary.row === pinned.row;
          next.set(teamId, {
            primary: { ...pinned },
            assignedRound: sameTarget ? previous.assignedRound : this.currentRound,
          });
          continue;
        }
        this.pinnedPrimaryByTeam.delete(teamId);
      }

      // 5) Keep a still-valid plan; otherwise adopt the best candidate.
      const previous = this.warPlanByTeam.get(teamId);
      if (previous && this.isPlanStillValid(previous, members, enemies)) {
        next.set(teamId, previous);
        continue;
      }
      if (best) next.set(teamId, { primary: best, assignedRound: this.currentRound });
    }
    this.warPlanByTeam = next;
  }

  /** A kept primary must still be the same enemy's city, known and recent. */
  private isPlanStillValid(
    plan: TeamWarPlan,
    members: number[],
    enemies: Set<number>,
  ): boolean {
    if (this.currentRound - plan.assignedRound > TEAM_PRIMARY_MAX_AGE_ROUNDS) return false;
    const city = this.gameEngine.getCityAt?.(plan.primary.col, plan.primary.row);
    if (!city) return false; // captured or razed
    if (city.civilizationId !== plan.primary.civId || !enemies.has(city.civilizationId)) {
      return false; // defected / no longer an enemy
    }
    return this.isExploredByTeam(members, city.col, city.row);
  }

  private isExploredByTeam(members: number[], col: number, row: number): boolean {
    for (const member of members) {
      if (this.gameEngine.isExploredByPlayer?.(member, col, row)) return true;
    }
    return false;
  }

  /**
   * Chebyshev distance from the city to the nearest team unit (falling back
   * to the team's cities, then to the cap). An army already standing near a
   * city makes it the natural joint objective.
   */
  private distanceToTeamForce(members: number[], col: number, row: number): number {
    const grid = this.gameEngine.squareGrid;
    const dist = (fromCol: number, fromRow: number): number =>
      grid?.squareDistance?.(fromCol, fromRow, col, row)
      ?? Math.max(Math.abs(fromCol - col), Math.abs(fromRow - row));

    let best = Infinity;
    for (const unit of this.gameEngine.units ?? []) {
      if (unit.isDefeated || !members.includes(unit.civilizationId)) continue;
      const d = dist(unit.col, unit.row);
      if (d < best) best = d;
    }
    if (best !== Infinity) return best;
    for (const city of this.gameEngine.cities ?? []) {
      if (!members.includes(city.civilizationId)) continue;
      const d = dist(city.col, city.row);
      if (d < best) best = d;
    }
    return best === Infinity ? PRIMARY_MAX_FORCE_DISTANCE : best;
  }

  // ──────────────────────────────────────────────────────────────
  // Mutual defense (Phase 3)
  // ──────────────────────────────────────────────────────────────

  /**
   * The teammate-defense jobs assigned to `civId` this round (empty in
   * free-for-all). `AIManager.findDefensiveAssignment` consumes these for
   * its mobile surplus units once no own city needs them.
   */
  defenseDirectivesFor(civId: number): TeamDefenseDirective[] {
    if (!this.enabled) return [];
    const teamId = this.gameEngine.teamManager?.getTeamId(civId) ?? null;
    if (teamId === null) return [];
    return (this.defenseByTeam.get(teamId) ?? []).filter((d) => d.helperCivId === civId);
  }

  /** All of a team's defense directives (UI / tests). */
  getTeamDefenseDirectives(teamId: number): TeamDefenseDirective[] {
    if (!this.enabled) return [];
    return [...(this.defenseByTeam.get(teamId) ?? [])];
  }

  /**
   * Recompute threatened teammate cities and who helps.
   *
   * Each member's cities are assessed from the OWNER's perspective (the
   * garrison belongs to the owner and the sighting memory used is the
   * owner's — shared vision makes the live-unit scan identical for every
   * member anyway). Teammate units stacked in the city are counted as
   * garrison, never as threat samples. A city in need is assigned to the
   * NEAREST member that is not the owner and shares its landmass: someone
   * has to walk there, and two members must not both strip their fronts for
   * the same city.
   *
   * Recomputed from live state every round, so a captured or relieved city
   * drops out by itself — no abort bookkeeping needed.
   */
  private computeDefenseAssignments(): void {
    this.defenseByTeam.clear();
    const teamManager = this.gameEngine.teamManager;
    if (!teamManager?.enabled) return;

    const grid = this.gameEngine.squareGrid;
    const currentYear = this.gameEngine.currentYear ?? -4000;
    const difficulty = this.gameEngine.gameSettings?.difficulty ?? 'PRINCE';
    const dangerThreshold = calculateDangerThreshold(currentYear, difficulty);

    for (const teamId of teamManager.getTeamIds()) {
      const members = teamManager.getTeamMembers(teamId);
      if (members.length < 2) continue;

      const directives: TeamDefenseDirective[] = [];
      for (const ownerCivId of members) {
        const ownerStorage = this.gameEngine.playerStorage?.get(ownerCivId);
        if (!ownerStorage) continue;

        for (const city of this.gameEngine.cities ?? []) {
          if (city.civilizationId !== ownerCivId) continue;

          const samples = collectCityThreatSamples(
            this.gameEngine, city, ownerCivId, ownerStorage, this.currentRound,
          ).filter((sample) => !this.isFriendlyPosition(sample.col, sample.row, members));
          if (samples.length === 0) continue;

          // Garrison: the owner's defenders plus any teammate already there.
          let garrisonStrength = computeCityGarrisonStrength(this.gameEngine, city, ownerCivId);
          for (const unit of this.gameEngine.units ?? []) {
            if (unit.isDefeated || unit.civilizationId === ownerCivId) continue;
            if (!members.includes(unit.civilizationId)) continue;
            if (grid && grid.squareDistance(unit.col, unit.row, city.col, city.row) > 2) continue;
            garrisonStrength += Math.max(1, unit.defense || unit.attack || 1);
          }

          const assessment = assessCityThreat({
            city: { id: city.id, col: city.col, row: city.row },
            samples,
            garrisonStrength,
            defensiveBonus: 0,
            dangerThreshold,
          });
          if (!assessment.needsDefense) continue;

          // Helper: nearest member (by its closest unit) that is not the
          // owner and stands on the city's landmass — it must be able to
          // walk there or the job would churn against the water.
          const helperCivId = this.assignHelperMember(members, ownerCivId, city.col, city.row);
          if (helperCivId === null) continue; // nobody can reach it this round

          directives.push({
            cityId: city.id,
            col: city.col,
            row: city.row,
            ownerCivId,
            helperCivId,
            netThreat: assessment.netThreat,
          });
        }
      }

      // Player-directed defense requests ("Defend city X") override the
      // threat arithmetic: the player asked, so the city gets a helper even
      // when the numbers say it could hold. Expired requests and dead cities
      // drop out here; an auto-assigned directive wins over a duplicate
      // request for the same city.
      for (const [cityId, request] of this.defenseRequests) {
        if (!members.includes(request.ownerCivId)) continue; // another team's request
        if (this.currentRound - request.round > PLAYER_DEFENSE_REQUEST_ROUNDS) {
          this.defenseRequests.delete(cityId);
          continue;
        }
        const city = (this.gameEngine.cities ?? []).find((c) => c.id === cityId);
        if (!city || city.civilizationId !== request.ownerCivId) {
          this.defenseRequests.delete(cityId);
          continue;
        }
        if (directives.some((d) => d.cityId === cityId)) continue;
        const helperCivId = this.assignHelperMember(members, request.ownerCivId, request.col, request.row);
        if (helperCivId === null) continue;
        directives.push({
          cityId,
          col: request.col,
          row: request.row,
          ownerCivId: request.ownerCivId,
          helperCivId,
          netThreat: 0,
          requested: true,
        });
      }

      if (directives.length > 0) this.defenseByTeam.set(teamId, directives);
    }
  }

  /** The nearest member (not the owner) sharing the city's landmass, or null. */
  private assignHelperMember(
    members: number[],
    ownerCivId: number,
    col: number,
    row: number,
  ): number | null {
    const targetLandmass = this.gameEngine.getLandmassId?.(col, row) ?? -1;
    let helperCivId: number | null = null;
    let bestDistance = Infinity;
    for (const member of members) {
      if (member === ownerCivId) continue;
      if (!this.memberOnLandmass(member, targetLandmass)) continue;
      const distance = this.distanceToTeamForce([member], col, row);
      if (distance < bestDistance) {
        bestDistance = distance;
        helperCivId = member;
      }
    }
    return helperCivId;
  }

  /** A sample at a teammate's unit position is a friend, not a threat. */
  private isFriendlyPosition(col: number, row: number, members: number[]): boolean {
    for (const unit of this.gameEngine.units ?? []) {
      if (unit.isDefeated || !members.includes(unit.civilizationId)) continue;
      if (unit.col === col && unit.row === row) return true;
    }
    return false;
  }

  /** Whether a member has any land unit or city on `landmass` (-1 = unknown). */
  private memberOnLandmass(member: number, landmass: number): boolean {
    if (landmass < 0) return true; // unknown connectivity — do not block help
    const getLandmassId = this.gameEngine.getLandmassId?.bind(this.gameEngine);
    if (!getLandmassId) return true;
    for (const unit of this.gameEngine.units ?? []) {
      if (unit.isDefeated || unit.civilizationId !== member) continue;
      if (UNIT_PROPS[String(unit.type ?? '').trim().toLowerCase()]?.naval === true) continue;
      if (getLandmassId(unit.col, unit.row) === landmass) return true;
    }
    for (const city of this.gameEngine.cities ?? []) {
      if (city.civilizationId === member && getLandmassId(city.col, city.row) === landmass) {
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────
  // POI registry (Phase 1 API — consumers land with Phases 2–3)
  // ──────────────────────────────────────────────────────────────

  /**
   * Publish a point of interest for the whole team. Callers tag the team and
   * stamp the round (`engine.currentTurn`); the stamp drives age-based
   * pruning in {@link prunePois}.
   */
  publishPoi(poi: TeamPoi): void {
    if (!this.enabled || this.gameEngine.devMode) return;
    const list = this.poiByTeam.get(poi.teamId) ?? [];
    // One entry per cell+kind: re-sighting refreshes rather than duplicates.
    const existing = list.find((p) => p.kind === poi.kind && p.col === poi.col && p.row === poi.row);
    if (existing) {
      existing.round = poi.round;
      return;
    }
    list.push({ ...poi });
    this.poiByTeam.set(poi.teamId, list);
  }

  /** All (unexpired) points of interest of a team. Empty in FFA. */
  getPois(teamId: number): TeamPoi[] {
    if (!this.enabled) return [];
    return [...(this.poiByTeam.get(teamId) ?? [])];
  }

  /** Drop POIs older than {@link POI_MAX_AGE_ROUNDS} (intel goes stale). */
  private prunePois(): void {
    if (this.poiByTeam.size === 0) return;
    // The latest published round across all POIs is the age reference; POIs
    // carry the round they were published in, so pruning uses the newest stamp
    // seen rather than trusting a stored "current round" that a load could
    // have skipped.
    let newest = 0;
    for (const list of this.poiByTeam.values()) {
      for (const poi of list) newest = Math.max(newest, poi.round);
    }
    for (const [teamId, list] of this.poiByTeam) {
      const kept = list.filter((poi) => newest - poi.round <= POI_MAX_AGE_ROUNDS);
      if (kept.length === 0) this.poiByTeam.delete(teamId);
      else this.poiByTeam.set(teamId, kept);
    }
  }
}
