import { useGameStore } from '../stores/GameStore';
import type { GameEngine } from '../../types/game';

export class EngineEventRouter {
  private gameEngine: GameEngine;
  private actions = useGameStore.getState().actions;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  handle(eventType: string, eventData: any) {
    switch (eventType) {
      case 'TURN_START':
        this.onTurnStart(eventData);
        break;
      case 'PHASE_CHANGE':
        this.onPhaseChange(eventData);
        break;
      case 'NEW_GAME':
        this.onNewGame(eventData);
        break;
      case 'UNIT_MOVED':
        this.onUnitMoved(eventData);
        break;
      case 'COMBAT_VICTORY':
      case 'COMBAT_DEFEAT':
        this.onCombat(eventType);
        break;
      case 'UNIT_PRODUCED':
      case 'UNIT_PURCHASED':
        this.onUnitCreated(eventData);
        break;
      case 'CITY_FOUNDED':
        this.onCityFounded(eventData);
        break;
      case 'CITY_PRODUCTION_CHANGED':
        this.onCityProductionChanged(eventData);
        break;
      case 'TURN_PROCESSED':
        this.onTurnProcessed();
        break;
      case 'AI_FINISHED':
        this.onAIFinished();
        break;
      case 'IMPROVEMENT_BUILT':
        this.onImprovementBuilt(eventData);
        break;
      case 'AUTO_END_TURN':
        this.onAutoEndTurn(eventData);
        break;
      case 'CHECK_AUTO_END_TURN':
        this.onCheckAutoEndTurn();
        break;
      case 'TURN_END_CONFIRMATION_NEEDED':
        this.onTurnEndConfirmationNeeded();
        break;
      case 'TURN_END':
        this.onTurnEnd();
        break;
      case 'AI_CLEAR_HIGHLIGHTS':
        this.onAIClearHighlights(eventData);
        break;
      case 'CITY_PRODUCTION_PHASE':
        this.onCityProductionPhase(eventData);
        break;
      case 'RESEARCH_PHASE':
        this.onResearchPhase(eventData);
        break;
      case 'PLAYER_REGISTERED':
        this.onPlayerRegistered(eventData);
        break;
      case 'UNIT_SKIPPED':
        this.onUnitSkipped(eventData);
        break;
      case 'AI_TARGET_HIGHLIGHT':
        this.onAITargetHighlight(eventData);
        break;
      default:
        console.log('Unhandled game engine event:', eventType, eventData);
    }
  }

  private onTurnStart(_eventData: any) {
    const active = (this.gameEngine as any).activePlayer;
    const civ = this.gameEngine.civilizations?.[active];
    console.log('[EngineEventRouter] TURN_START for player', active, civ?.name);
    
    const tm = (this.gameEngine as any).roundManager;
    
    if (civ?.isHuman) {
      if (tm && typeof tm.registerPlayer === 'function') {
        console.log('[EngineEventRouter] Registering human player', active);
        tm.registerPlayer(active);
      } else {
        console.warn('[EngineEventRouter] TurnManager not found or registerPlayer not available');
      }
    }

    // Re-enable the end turn button at the start of each turn
    this.actions.setTurnButtonDisabled(false);
  }

  private onPhaseChange(eventData: any) {
    console.log('[EngineEventRouter] PHASE_CHANGE:', eventData);
    this.actions.updateGameState({ currentTurn: useGameStore.getState().gameState.currentTurn });
  }

  private onNewGame(eventData: any) {
    console.log('[EngineEventRouter] NEW_GAME: Updating map and initial visibility');
    eventData.civilizations.forEach((civ: any, index: number) => {
      if (!civ.capital) {
        const firstCity = eventData.cities.find((c: any) => c.civilizationId === index);
        if (firstCity) civ.capital = firstCity;
      }
    });
    this.actions.updateCivilizations(eventData.civilizations);
    this.actions.updateMap(eventData.map);
    this.actions.updateUnits(eventData.units);
    this.actions.updateCities(eventData.cities);
    this.actions.updateTechnologies(eventData.technologies);
    this.actions.updateVisibility();
    this.actions.startGame();
  }

  private onUnitMoved(eventData: any) {
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.updateVisibility();
    const moved = eventData && eventData.unit ? eventData.unit : null;
    if (moved) {
      const movesLeft = moved.movesRemaining || 0;
      if (movesLeft > 0) this.actions.selectUnit(moved.id);
      else this.actions.focusOnNextUnit();
    }
  }

  private onCombat(eventType: string) {
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.updateVisibility();
    this.actions.addNotification({
      type: eventType === 'COMBAT_VICTORY' ? 'success' : 'warning',
      message: eventType === 'COMBAT_VICTORY' ? 'Victory in combat!' : 'Unit defeated in combat!'
    });
  }

  private onUnitCreated(eventData: any) {
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.updateVisibility();
    if (eventData && eventData.unit) {
      this.actions.selectUnit(eventData.unit.id);
      this.actions.addNotification({ type: 'success', message: `${eventData.unit.type} ready to move!` });
    }
  }

  private onCityFounded(eventData: any) {
    const civId = eventData.city.civilizationId;
    const civ = this.gameEngine.civilizations[civId];
    if (civ && !civ.capital) {
      const firstCity = this.gameEngine.getAllCities().find(c => c.civilizationId === civId);
      if (firstCity) civ.capital = firstCity;
    }
    this.actions.updateCities(this.gameEngine.getAllCities());
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.updateCivilizations(this.gameEngine.civilizations);
    this.actions.updateVisibility();
    if (eventData.city.civilizationId === 0) this.actions.selectCity(eventData.city.id);
    this.actions.addNotification({ type: 'info', message: `${eventData.city.name} founded!` });
  }

  private onCityProductionChanged(eventData: any) {
    this.actions.updateCities(this.gameEngine.getAllCities());
    if (eventData && eventData.item) {
      const name = eventData.item.name || eventData.item.itemType || 'Production';
      this.actions.addNotification({ type: 'success', message: eventData.queued ? `Queued ${name}` : `Started production: ${name}` });
    }
  }

  private onTurnProcessed() {
    this.actions.updateCivilizations(this.gameEngine.civilizations);
    this.actions.updateCities(this.gameEngine.getAllCities());
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.updateTechnologies(this.gameEngine.technologies);
    this.actions.updateVisibility();
    this.actions.focusOnNextUnit();
  }

  private onAIFinished() {
    this.actions.updateUnits(this.gameEngine.getAllUnits());
    this.actions.addNotification({ type: 'info', message: 'AI finished its turn' });
  }

  private onImprovementBuilt(eventData: any) {
    try {
      console.log('[EngineEventRouter] IMPROVEMENT_BUILT', eventData);
      this.actions.updateUnits(this.gameEngine.getAllUnits());
      this.actions.updateMap(this.gameEngine.map);
      this.actions.updateVisibility();
      if (eventData && eventData.improvementType) {
        this.actions.addNotification({ type: 'success', message: `${eventData.improvementType} built` });
      } else {
        this.actions.addNotification({ type: 'info', message: 'Improvement built' });
      }
    } catch (e) {
      console.warn('[EngineEventRouter] Error handling IMPROVEMENT_BUILT', e);
    }
  }

  private onAutoEndTurn(eventData: any) {
    console.log('[EngineEventRouter] AUTO_END_TURN for civ', eventData?.civilizationId);
    // Pure UI updates only - no game logic
    this.actions.setGoToMode(false, null);
    this.actions.selectUnit(null);
    this.actions.nextTurn();
    // Note: TurnManager now handles turn advancement internally
  }

  private onCheckAutoEndTurn() {
    const settings = useGameStore.getState().settings;
    if (settings.autoEndTurn) {
      // Trigger proper turn ending through TurnManager (advances through all phases)
      const tm = (this.gameEngine as any).roundManager;
      if (tm && typeof tm.endHumanTurn === 'function') {
        tm.endHumanTurn();
      } else {
        console.error('[EngineEventRouter] TurnManager not available for auto-end turn');
      }
    } else {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('showEndTurnConfirmation'));
      }
    }
  }

  private onTurnEndConfirmationNeeded() {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('showEndTurnConfirmation'));
    }
  }

  private onTurnEnd() {
    console.log('[EngineEventRouter] TURN_END: Clearing UI state');
    // Pure UI cleanup only
    this.actions.setGoToMode(false, null);
    this.actions.selectUnit(null);
    // Renderer cleanup is now handled in TurnManager
  }

  private onAIClearHighlights(eventData: any) {
    console.log('[EngineEventRouter] AI_CLEAR_HIGHLIGHTS for civ', eventData?.civilizationId);
    // Clear any UI highlights when AI finishes its turn
    this.actions.setGoToMode(false, null);
    this.actions.selectUnit(null);
  }

  private onCityProductionPhase(eventData: any) {
    console.log('[EngineEventRouter] CITY_PRODUCTION_PHASE for civ', eventData?.civilizationId);
    // Update UI to show city production phase
    this.actions.updateGameState({ currentTurn: useGameStore.getState().gameState.currentTurn });
  }

  private onResearchPhase(eventData: any) {
    console.log('[EngineEventRouter] RESEARCH_PHASE for civ', eventData?.civilizationId);
    // Update UI to show research phase
    this.actions.updateGameState({ currentTurn: useGameStore.getState().gameState.currentTurn });
  }

  private onPlayerRegistered(eventData: any) {
    console.log('[EngineEventRouter] PLAYER_REGISTERED for civ', eventData?.civilizationId);
    // Player registration is handled - update UI state
    this.actions.updateGameState({ currentTurn: useGameStore.getState().gameState.currentTurn });
  }

  private onUnitSkipped(eventData: any) {
    console.log('[EngineEventRouter] UNIT_SKIPPED:', eventData?.unit?.id, eventData?.unit?.type);
    // Unit was skipped - update unit state in UI
    if (this.actions?.updateUnits) {
      this.actions.updateUnits(this.gameEngine.getAllUnits());
    }
  }

  private onAITargetHighlight(eventData: any) {
    console.log('[EngineEventRouter] AI_TARGET_HIGHLIGHT:', eventData);
    // Optionally, highlight the target tile in the UI (red overlay, etc.)
    // For now, just log and update visibility
    this.actions.updateVisibility();
  }
}
