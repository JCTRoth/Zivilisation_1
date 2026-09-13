import { useEffect } from 'react';
import { useGameStore } from '../stores/GameStore';
import GameEngine from '../game/engine/GameEngine';
import { EngineEventRouter } from '../utils/EngineEventHandlers';
import { gameLogger } from '../utils/GameLogger';
import { gameProgression } from '../utils/GameProgression';

/**
 * Custom hook to integrate GameEngine with Zustand state
 */
export const useGameEngine = (gameEngine: GameEngine | null) => {
  const actions = useGameStore(state => state.actions);

  useEffect(() => {
    if (!gameEngine) return;

    // Keep the logger's context (round/player) in sync with the live engine.
    gameLogger.setContext(() => ({
      round: gameEngine.currentTurn ?? 0,
      player: gameEngine.activePlayer ?? 0,
    }));

    // Set up state change callback via router, tapping every event into the
    // game log first so moves/combat/turns are recorded in detail, into the
    // progression tracker so one snapshot is kept per round, and into
    // auto-production so it can react to war/capture/completions immediately.
    const router = new EngineEventRouter(gameEngine);
    gameEngine.onStateChange = (eventType, eventData) => {
      gameLogger.record(eventType, eventData);
      gameProgression.recordIfNewRound(gameEngine);
      gameEngine.autoProduction?.onGameEvent?.(eventType, eventData);
      router.handle(eventType, eventData);
    };

    // Initial state sync
    if (gameEngine.isInitialized) {
      console.log('[useGameEngine] Initial sync starting...');
      actions.updateMap(gameEngine.map);
      actions.updateUnits(gameEngine.getAllUnits());
      actions.updateCities(gameEngine.getAllCities());
      actions.updateCivilizations(gameEngine.civilizations);
      actions.updateTechnologies(gameEngine.technologies);

      const playerSettler = gameEngine.units.find(u => u.civilizationId === 0 && u.type === 'settler');
      // console.log('[useGameEngine] Player settler found:', playerSettler.id);
      if (playerSettler) {
        console.log('[useGameEngine] Revealing area around settler at', playerSettler.col, playerSettler.row);
        actions.revealArea(playerSettler.col, playerSettler.row, 2);
      }

      console.log('[useGameEngine] Calling updateVisibility...');
      actions.updateVisibility();
      actions.focusOnNextUnit();
      
      // Register human player if their turn has started but wasn't registered
      // (This happens because startTurn is called before the event router is connected)
      const tm = gameEngine.turnManager || gameEngine.roundManager;
      const activePlayer = gameEngine.activePlayer;
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
      // Flush any buffered log lines (best-effort) before the hook unmounts.
      gameLogger.flushNow().catch(() => undefined);
    };
  }, [gameEngine, actions]);
};
