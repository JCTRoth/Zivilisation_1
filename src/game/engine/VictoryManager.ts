import type GameEngine from './GameEngine';
import type { Civilization, GameActions } from '../../../types/game';
import { GameResult, type VictoryReason } from '../../../types/game';
import { BUILDING_PROPERTIES, WONDER_PROPERTIES } from '../../data/BuildingConstants';

/**
 * Centralized victory and defeat detection that runs at the end of each turn.
 * The TurnManager invokes {@link evaluateEndOfTurn} to determine whether the
 * game has concluded through elimination or scientific progress. The game is
 * won only when every enemy faction's units (and cities) are destroyed — the
 * "own every city" domination shortcut is intentionally not a win condition.
 */
export class VictoryManager {
  private readonly gameEngine: GameEngine;
  private storeActions: GameActions | null;
  private gameAlreadyEnded: boolean;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
    this.storeActions = gameEngine.storeActions;
    this.gameAlreadyEnded = false;
  }

  /**
   * Re-attach store actions (used when the engine is provided with a new set
   * of bound actions, e.g. after reinitialization).
   */
  syncStoreActions(actions: GameActions | null): void {
    this.storeActions = actions;
  }

  /** Reset internal state so a subsequent game can run fresh checks. */
  reset(): void {
    this.gameAlreadyEnded = false;
  }

  /**
   * Evaluate victory and defeat conditions. Returns true when the game ended
   * and the TurnManager should halt further processing for the current cycle.
   */
  evaluateEndOfTurn(): boolean {
    if (this.gameAlreadyEnded || this.gameEngine.isGameOver) {
      return true;
    }

    const civilizations: Civilization[] = this.gameEngine.civilizations || [];
    if (civilizations.length === 0) {
      return false;
    }

    const aliveStatus = new Map<number, boolean>();
    civilizations.forEach((civ) => {
      const alive = this.isCivilizationOperational(civ.id);
      aliveStatus.set(civ.id, alive);
      civ.isAlive = alive;
      // Peace-years tracking for the score bonus: consecutive rounds without
      // war. A declaration resets the streak.
      const atWar = this.gameEngine?.isCivAtWar?.(civ.id) ?? ((civ.warWith?.size ?? 0) > 0);
      civ.peaceTurns = atWar ? 0 : (civ.peaceTurns ?? 0) + 1;
      // Keep the live scoreboard current (was permanently 0 before — the
      // statistics screen and the exported progression CSV read this).
      civ.score = this.calculateScore(civ);
    });

    this.pushCivilizationUpdates();

    const humanCivs = civilizations.filter((civ) => civ.isHuman);
    const onlyHuman = humanCivs.length === 1 ? humanCivs[0] : null;
    const defeatedHumans = humanCivs.filter((civ) => !aliveStatus.get(civ.id));

    // Hotseat mode: detect if this is a multi-human game
    const isHotseatMultiHuman = humanCivs.length > 1;

    // Fixed alliances change what "defeat" means: a human whose civ is dead
    // but whose team still fights is a spectator, not a loser. The whole team
    // wins or loses together, so the team branch replaces the per-civ checks.
    if (this.isTeamGame()) {
      return this.evaluateTeamEndOfTurn(aliveStatus);
    }

    if (onlyHuman && !aliveStatus.get(onlyHuman.id)) {
      return this.triggerDefeat(onlyHuman, 'elimination');
    }

    // Hotseat moonshot victory: any human civ with moonshot means ALL humans win together
    if (isHotseatMultiHuman) {
      const humanHasMoonshot = humanCivs.some((civ) => aliveStatus.get(civ.id) && this.hasMoonshot(civ));
      if (humanHasMoonshot) {
        return this.triggerVictory(humanCivs, 'moonshot');
      }
    } else {
      const moonshotWinner = this.detectMoonshotWinner();
      if (moonshotWinner) {
        return this.triggerVictory(moonshotWinner, 'moonshot');
      }
    }

    const survivingCivs = civilizations.filter((civ) => aliveStatus.get(civ.id));
    // The game is ONLY won when all enemy units are destroyed. A rival that
    // still has a stray unit (even with no cities) keeps the game running —
    // there is no "own every city" domination shortcut.
    if (survivingCivs.length <= 1) {
      const winner = survivingCivs[0];
      if (isHotseatMultiHuman && humanCivs.length > 0) {
        // In hotseat, all surviving human civs win together
        const survivingHumans = humanCivs.filter((civ) => aliveStatus.get(civ.id));
        if (survivingHumans.length > 0) {
          return this.triggerVictory(survivingHumans, 'elimination');
        }
      }
      if (winner && winner.isHuman) {
        return this.triggerVictory(winner, 'elimination');
      }
      const humanTarget = onlyHuman ?? this.getPrimaryHumanCivilization();
      if (humanTarget) {
        return this.triggerDefeat(humanTarget, 'elimination');
      }
      if (winner) {
        return this.triggerVictory(winner, 'elimination');
      }
      return false;
    }

    // Hotseat: if ALL surviving civs are human AND at least one civ was
    // eliminated during the game, all surviving humans win jointly.
    if (isHotseatMultiHuman && humanCivs.length > 0 && survivingCivs.length > 0) {
      const onlyHumansSurvive = survivingCivs.every((c) => humanCivs.includes(c));
      const someCivEliminated = survivingCivs.length < civilizations.length;
      if (onlyHumansSurvive && someCivEliminated) {
        const survivingHumans = humanCivs.filter((civ) => aliveStatus.get(civ.id));
        if (survivingHumans.length > 0) {
          return this.triggerVictory(survivingHumans, 'elimination');
        }
      }
    }

    if (defeatedHumans.length > 0) {
      this.handleAdditionalHumanDefeats(defeatedHumans);
    }

    return false;
  }

  /** Whether the current game is a fixed-alliance (locked-team) game. */
  private isTeamGame(): boolean {
    return this.gameEngine.teamManager?.enabled === true;
  }

  /**
   * Victory and defeat for locked teams.
   *
   * The unit of survival is the team, not the civilization: one operational
   * member keeps the whole team in the game. A human whose own civ has fallen
   * therefore keeps watching (and their team can still win) until the team
   * itself is eliminated.
   */
  private evaluateTeamEndOfTurn(aliveStatus: Map<number, boolean>): boolean {
    const teams = this.gameEngine.teamManager;
    if (!teams) return false;

    const civilizations = this.gameEngine.civilizations || [];
    const humanCivs = civilizations.filter((civ) => civ.isHuman);
    const primaryHuman = this.getPrimaryHumanCivilization();
    const primaryHumanTeam = primaryHuman ? teams.getTeamId(primaryHuman.id) : null;

    // Team moonshot: the first operational member to complete the project
    // wins the space race for the whole team. It does not matter which
    // teammate's cities built the parts.
    const moonshotCiv = civilizations.find(
      (civ) => aliveStatus.get(civ.id) === true && this.hasMoonshot(civ),
    );
    if (moonshotCiv) {
      const winningTeam = teams.getTeamId(moonshotCiv.id);
      if (winningTeam !== null) {
        // The human's own team losing the race is a defeat, even if another
        // human seat (hotseat) happened to be on the winning team: one shared
        // screen has to show one perspective, and the first human is the
        // established primary seat.
        if (primaryHumanTeam !== null && primaryHumanTeam !== winningTeam) {
          return this.triggerTeamDefeat(primaryHumanTeam, 'moonshot');
        }
        return this.triggerTeamVictory(winningTeam, 'moonshot');
      }
    }

    const aliveTeams = teams.getTeamIds().filter((teamId) =>
      teams.getTeamMembers(teamId).some((civId) => aliveStatus.get(civId) === true),
    );

    // Last team standing wins. A team with one surviving scout (or one city)
    // still counts as alive, mirroring the free-for-all rule that a stray unit
    // keeps a civilization in the game.
    if (aliveTeams.length <= 1) {
      if (aliveTeams.length === 1) {
        const winningTeam = aliveTeams[0];
        const winningMembers = teams.getTeamMembers(winningTeam);
        const humanOnWinner = humanCivs.some((civ) => winningMembers.includes(civ.id));
        if (humanOnWinner) {
          return this.triggerTeamVictory(winningTeam, 'elimination');
        }
        if (primaryHumanTeam !== null) {
          return this.triggerTeamDefeat(primaryHumanTeam, 'elimination');
        }
        return this.triggerTeamVictory(winningTeam, 'elimination');
      }

      // Mutual annihilation: nobody is left to claim the world. Treat it as a
      // defeat for the human team, or end quietly in an all-AI game.
      if (primaryHumanTeam !== null) {
        return this.triggerTeamDefeat(primaryHumanTeam, 'elimination');
      }
      return false;
    }

    // The primary human's team is gone while other teams (possibly another
    // hotseat human's team) fight on. In single player this is the team's
    // final defeat; in hotseat the surviving human seats keep playing, and
    // the eliminated human simply sits out until the shared result.
    if (primaryHumanTeam !== null
      && !teams.getTeamMembers(primaryHumanTeam).some((civId) => aliveStatus.get(civId) === true)) {
      const anyHumanTeamAlive = humanCivs.some((civ) => {
        const teamId = teams.getTeamId(civ.id);
        return teamId !== null
          && teams.getTeamMembers(teamId).some((civId) => aliveStatus.get(civId) === true);
      });
      if (!anyHumanTeamAlive) {
        return this.triggerTeamDefeat(primaryHumanTeam, 'elimination');
      }
    }

    // A defeated human on a still-living team is a spectator: mark the civ
    // dead (the turn order already skips it) but do not end the game.
    const defeatedHumans = humanCivs.filter((civ) => !aliveStatus.get(civ.id));
    if (defeatedHumans.length > 0) {
      this.handleAdditionalHumanDefeats(defeatedHumans);
    }

    return false;
  }

  /**
   * Civ1 score (GAMEPLAY.adoc): population (1/citizen), land area (1/tile the
   * civ's cities work), cities (5 each), technologies (5 each) and wonders
   * (20 each). Recomputed every turn end so the scoreboard and the exported
   * progression CSV show live values.
   */
  private calculateScore(civ: Civilization): number {
    const cities = (this.gameEngine.cities ?? []).filter(
      (c) => c.civilizationId === civ.id,
    );
    const population = cities.reduce((sum, c) => sum + (c.population ?? 0), 0);
    const technologies = (civ.technologies ?? []).length;
    const wonders = cities.reduce(
      (sum, c) =>
        sum + (c.buildings ?? []).filter((b) => !!WONDER_PROPERTIES[String(b)]).length,
      0,
    );

    // Land area: every unique tile in a city's workable radius, plus the city
    // centre tiles themselves. Lightweight test engines may not implement the
    // map helpers — the score then falls back to population/cities/techs.
    const landTiles = new Set<string>();
    if (typeof this.gameEngine.isTileInCityRadius === 'function') {
      for (const city of cities) {
        for (let dc = -2; dc <= 2; dc++) {
          for (let dr = -2; dr <= 2; dr++) {
            const col = city.col + dc;
            const row = city.row + dr;
            if (!this.gameEngine.isTileInCityRadius(city, col, row)) continue;
            const tile = this.gameEngine.getTileAt?.(col, row);
            if (tile) landTiles.add(`${col},${row}`);
          }
        }
      }
    }

    // Pollution penalty: every pollution point from the civ's buildings
    // subtracts from the score (GAMEPLAY.adoc).
    const pollution = cities.reduce(
      (sum, c) =>
        sum +
        (c.buildings ?? []).reduce(
          (p, b) => p + ((BUILDING_PROPERTIES[String(b)]?.effects?.pollution as number | undefined) ?? 0),
          0,
        ),
      0,
    );

    // Peace bonus: 1 point per 5 consecutive peace rounds.
    const peaceBonus = Math.floor((civ.peaceTurns ?? 0) / 5);

    return (
      population +
      landTiles.size +
      cities.length + // the city centres
      cities.length * 5 +
      technologies * 5 +
      wonders * 20 +
      peaceBonus -
      pollution
    );
  }

  private detectMoonshotWinner(): Civilization | null {
    const civilizations = this.gameEngine.civilizations || [];
    for (const civ of civilizations) {
      // Any operational civ can win the space race — AI included. The old
      // human-only filter meant AI-vs-AI games could never end by Moonshot.
      if (this.hasMoonshot(civ)) {
        return civ;
      }
    }
    return null;
  }

  private hasMoonshot(civ: Civilization): boolean {
    const techs = civ?.technologies || [];
    return Array.isArray(techs) && techs.includes('moonshot');
  }

  private isCivilizationOperational(civId: number): boolean {
    const hasUnits = this.gameEngine.units.some(
      (unit) => unit.civilizationId === civId && unit.isDefeated !== true,
    );
    const hasCities = this.gameEngine.cities.some((city) => city.civilizationId === civId);
    return hasUnits || hasCities;
  }

  /** All civilizations on a team, in slot order. */
  private getTeamCivilizations(teamId: number): Civilization[] {
    const teams = this.gameEngine.teamManager;
    if (!teams) return [];
    const civilizations = this.gameEngine.civilizations || [];
    return teams
      .getTeamMembers(teamId)
      .map((civId) => civilizations.find((civ) => civ.id === civId))
      .filter((civ): civ is Civilization => !!civ);
  }

  /**
   * A whole team wins. Every member is listed in the result (dead teammates
   * included — they win together), and the primary civilization is the first
   * human member so the shared screen speaks to its player.
   */
  private triggerTeamVictory(teamId: number, reason: VictoryReason): boolean {
    const members = this.getTeamCivilizations(teamId);
    if (members.length === 0) return false;
    const primary = members.find((civ) => civ.isHuman)
      ?? members.find((civ) => civ.isAlive !== false)
      ?? members[0];
    const outcome = new GameResult({
      outcome: 'victory',
      civilizationId: primary.id,
      civName: primary.name,
      reason,
      isHuman: members.some((civ) => civ.isHuman === true),
      civilizationIds: members.map((civ) => civ.id),
      civNames: members.map((civ) => civ.name),
      teamId,
      teamName: this.gameEngine.teamManager?.getTeamName(teamId),
    });
    this.finalizeResult(outcome);
    return true;
  }

  /** A whole team loses: the mirror image of {@link triggerTeamVictory}. */
  private triggerTeamDefeat(teamId: number, reason: VictoryReason): boolean {
    const members = this.getTeamCivilizations(teamId);
    if (members.length === 0) return false;
    const primary = members.find((civ) => civ.isHuman)
      ?? members.find((civ) => civ.isAlive !== false)
      ?? members[0];
    const outcome = new GameResult({
      outcome: 'defeat',
      civilizationId: primary.id,
      civName: primary.name,
      reason,
      isHuman: members.some((civ) => civ.isHuman === true),
      civilizationIds: members.map((civ) => civ.id),
      civNames: members.map((civ) => civ.name),
      teamId,
      teamName: this.gameEngine.teamManager?.getTeamName(teamId),
    });
    this.finalizeResult(outcome);
    return true;
  }

  private triggerVictory(civ: Civilization, reason: VictoryReason): boolean;
  private triggerVictory(civs: Civilization[], reason: VictoryReason): boolean;
  private triggerVictory(civOrCivs: Civilization | Civilization[], reason: VictoryReason): boolean {
    const civs = Array.isArray(civOrCivs) ? civOrCivs : [civOrCivs];

    // Hotseat joint victory: all human civs win together
    if (civs.length > 1) {
      const outcome = new GameResult({
        outcome: 'victory',
        civilizationId: civs[0].id,
        civName: civs[0].name,
        reason,
        isHuman: true,
        civilizationIds: civs.map((c) => c.id),
        civNames: civs.map((c) => c.name)
      });
      this.finalizeResult(outcome);
      return true;
    }

    const civ = civs[0];
    const outcome = new GameResult({
      outcome: 'victory',
      civilizationId: civ.id,
      civName: civ.name,
      reason,
      isHuman: !!civ.isHuman
    });
    this.finalizeResult(outcome);
    return true;
  }

  private triggerDefeat(civ: Civilization, reason: VictoryReason): boolean {
    const outcome = new GameResult({
      outcome: 'defeat',
      civilizationId: civ.id,
      civName: civ.name,
      reason,
      isHuman: !!civ.isHuman
    });
    this.finalizeResult(outcome);
    return true;
  }

  private handleAdditionalHumanDefeats(defeatedHumans: Civilization[]): void {
    defeatedHumans.forEach((civ) => {
      civ.isAlive = false;
    });
    this.pushCivilizationUpdates();
  }

  private finalizeResult(result: GameResult): void {
    this.gameAlreadyEnded = true;
    this.gameEngine.isGameOver = true;

    // Freeze the game engine so no AI, turn processing, or unit movement
    // continues behind the result overlay.
    this.gameEngine.setPaused(true);

    const actions = this.gameEngine.storeActions || this.storeActions;
    actions?.setGameResult?.(result);
    actions?.updateGameState?.({
      winner: result.outcome === 'victory' ? result.civName : null,
      currentTurn: this.gameEngine.currentTurn,
      currentYear: this.gameEngine.currentYear,
      gamePhase: 'completed'
    });

    this.pushCivilizationUpdates();
    this.gameEngine.onStateChange?.(
      result.outcome === 'victory' ? 'GAME_WON' : 'GAME_LOST',
      result as unknown as Record<string, unknown>
    );
  }

  private pushCivilizationUpdates(): void {
    const actions = this.gameEngine.storeActions || this.storeActions;
    if (actions?.updateCivilizations) {
      actions.updateCivilizations([...(this.gameEngine.civilizations || [])]);
    }
  }

  private getPrimaryHumanCivilization(): Civilization | null {
    const civilizations = this.gameEngine.civilizations || [];
    return civilizations.find((civ) => civ.isHuman) || null;
  }
}
