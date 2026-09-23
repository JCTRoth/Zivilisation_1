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
      const atWar = (civ.warWith?.size ?? 0) > 0;
      civ.peaceTurns = atWar ? 0 : (civ.peaceTurns ?? 0) + 1;
      // Keep the live scoreboard current (was permanently 0 before — the
      // statistics screen and the exported progression CSV read this).
      civ.score = this.calculateScore(civ);
    });

    this.pushCivilizationUpdates();

    const humanCivs = civilizations.filter((civ) => civ.isHuman);
    const onlyHuman = humanCivs.length === 1 ? humanCivs[0] : null;
    const defeatedHumans = humanCivs.filter((civ) => !aliveStatus.get(civ.id));

    if (onlyHuman && !aliveStatus.get(onlyHuman.id)) {
      return this.triggerDefeat(onlyHuman, 'elimination');
    }

    const moonshotWinner = this.detectMoonshotWinner();
    if (moonshotWinner) {
      return this.triggerVictory(moonshotWinner, 'moonshot');
    }

    const survivingCivs = civilizations.filter((civ) => aliveStatus.get(civ.id));
    // The game is ONLY won when all enemy units are destroyed. A rival that
    // still has a stray unit (even with no cities) keeps the game running —
    // there is no "own every city" domination shortcut.
    if (survivingCivs.length <= 1) {
      const winner = survivingCivs[0];
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

    if (defeatedHumans.length > 0) {
      this.handleAdditionalHumanDefeats(defeatedHumans);
    }

    return false;
  }

  /**
   * Civ1 score (GAMEPLAY.md): population (1/citizen), land area (1/tile the
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
    // subtracts from the score (GAMEPLAY.md).
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
      if (!civ.isHuman) {
        continue;
      }
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
    const hasUnits = this.gameEngine.units.some((unit) => unit.civilizationId === civId);
    const hasCities = this.gameEngine.cities.some((city) => city.civilizationId === civId);
    return hasUnits || hasCities;
  }

  private triggerVictory(civ: Civilization, reason: VictoryReason): boolean {
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
