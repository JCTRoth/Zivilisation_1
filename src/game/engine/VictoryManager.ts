import type GameEngine from './GameEngine';
import type { Civilization, GameActions } from '../../../types/game';
import { GameResult, type VictoryReason } from '../../../types/game';

/**
 * Centralized victory and defeat detection that runs at the end of each turn.
 * The TurnManager invokes {@link evaluateEndOfTurn} to determine whether the
 * game has concluded through domination or scientific progress.
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
      result
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
