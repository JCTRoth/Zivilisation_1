import { useEffect } from 'react';
import { useGameStore } from '../stores/GameStore';
import type { GameEngine } from '../../types/game';
import { EngineEventRouter } from '../utils/EngineEventHandlers';

/**
 * Custom hook to integrate GameEngine with Zustand state
 */
export const useGameEngine = (gameEngine: GameEngine | null) => {
  const actions = useGameStore(state => state.actions);

  useEffect(() => {
    if (!gameEngine) return;

    // Set up state change callback via router
    const router = new EngineEventRouter(gameEngine as GameEngine);
    gameEngine.onStateChange = (eventType, eventData) => router.handle(eventType, eventData);

    // Initial state sync
    if (gameEngine.isInitialized) {
      console.log('[useGameEngine] Initial sync starting...');
      actions.updateMap(gameEngine.map);
      actions.updateUnits(gameEngine.getAllUnits());
      actions.updateCities(gameEngine.getAllCities());
      actions.updateCivilizations(gameEngine.civilizations);
      actions.updateTechnologies(gameEngine.technologies);

      const playerSettler = gameEngine.units.find(u => u.civilizationId === 0 && u.type === 'settler');
      console.log('[useGameEngine] Player settler found:', playerSettler);
      if (playerSettler) {
        console.log('[useGameEngine] Revealing area around settler at', playerSettler.col, playerSettler.row);
        actions.revealArea(playerSettler.col, playerSettler.row, 2);
      }

      console.log('[useGameEngine] Calling updateVisibility...');
      actions.updateVisibility();
      actions.focusOnNextUnit();
      
      // Register human player if their turn has started but wasn't registered
      // (This happens because startTurn is called before the event router is connected)
      const tm = (gameEngine as any).turnManager || (gameEngine as any).roundManager;
      const activePlayer = (gameEngine as any).activePlayer;
      const activeCiv = gameEngine.civilizations?.[activePlayer];
      if (activeCiv?.isHuman && tm && typeof tm.registerPlayer === 'function') {
        console.log('[useGameEngine] Registering human player for initial turn', activePlayer);
        tm.registerPlayer(activePlayer);
      }
      
      console.log('[useGameEngine] Initial sync complete');
    }

    return () => {
      // Cleanup
      if (gameEngine) {
        gameEngine.onStateChange = null;
      }
    };
  }, [gameEngine, actions]);
};

/**
 * Custom hook for game controls
 */
export const useGameControls = (gameEngine: GameEngine | null) => {
  const actions = useGameStore(state => state.actions);

  const controls = {
    newGame: () => {
      if (gameEngine) {
        gameEngine.newGame();
      }
    },

    nextTurn: () => {
      actions.nextTurn();
      if (gameEngine) {
        gameEngine.processTurn();
      }
    },

    selectUnit: (unitId) => {
      actions.selectUnit(unitId);
    },

    selectCity: (cityId) => {
      actions.selectCity(cityId);
    },

    moveUnit: (unitId, col, row) => {
      if (gameEngine) {
        return gameEngine.moveUnit(unitId, col, row);
      }
      return { success: false, reason: 'engine_unavailable' };
    },

    foundCity: (settlerId) => {
      if (gameEngine) {
        return gameEngine.foundCityWithSettler(settlerId);
      }
      return false;
    },

    setResearch: (civId, techId) => {
      if (gameEngine) {
        gameEngine.setResearch(civId, techId);
      }
    },

    unitAction: (unitId, action) => {
      if (!gameEngine) return;

      switch (action) {
        case 'sleep':
          gameEngine.unitSleep(unitId);
          break;
        case 'wake':
          gameEngine.unitWake(unitId);
          break;
        case 'fortify':
          gameEngine.unitFortify(unitId);
          break;
        case 'skip':
          gameEngine.skipUnit(unitId);
          break;
        case 'build_road':
          gameEngine.buildImprovement(unitId, 'road');
          break;
        default:
          console.warn('Unknown unit action:', action);
      }

      // Update units state
      actions.updateUnits(gameEngine.getAllUnits());
    }
  };

  return controls;
};

export default { useGameEngine, useGameControls };