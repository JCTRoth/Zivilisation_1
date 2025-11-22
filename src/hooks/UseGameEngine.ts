import { useEffect } from 'react';
import { useGameStore } from '../stores/GameStore';
import type { GameEngine } from '../../types/game';

/**
 * Custom hook to integrate GameEngine with Zustand state
 */
export const useGameEngine = (gameEngine: GameEngine | null) => {
  const actions = useGameStore(state => state.actions);

  useEffect(() => {
    if (!gameEngine) return;

    // Set up state change callback
    gameEngine.onStateChange = (eventType, eventData) => {
      switch (eventType) {
        case 'NEW_GAME':
          console.log('[useGameEngine] NEW_GAME: Updating map and initial visibility');
          
          // Ensure capitals are set for all civilizations
          eventData.civilizations.forEach((civ, index) => {
            if (!civ.capital) {
              const firstCity = eventData.cities.find(c => c.civilizationId === index);
              if (firstCity) {
                civ.capital = firstCity;
                console.log('[useGameEngine] Set capital for civilization', index, 'to city', firstCity.name);
              }
            }
          });
          
          // Update civilizations FIRST so unit colors work
          actions.updateCivilizations(eventData.civilizations);
          actions.updateMap(eventData.map);
          actions.updateUnits(eventData.units);
          actions.updateCities(eventData.cities);
          actions.updateTechnologies(eventData.technologies);
          actions.updateVisibility(); // Calculate initial visibility around starting units
          actions.startGame();
          console.log('[useGameEngine] NEW_GAME: Initial game state updated');
          break;

        case 'UNIT_MOVED': {
          // Sync units and visibility
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateVisibility();

          // eventData.unit is the moved unit
          const moved = eventData && eventData.unit ? eventData.unit : null;
          if (moved) {
            // If unit has moves remaining, keep it as active; otherwise advance to next unit
            const movesLeft = moved.movesRemaining || 0;
            if (movesLeft > 0) {
              actions.selectUnit(moved.id);
            } else {
              // Move to next unit that can act
              actions.focusOnNextUnit();
            }
          }

          break;
        }

        case 'COMBAT_VICTORY':
        case 'COMBAT_DEFEAT':
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateVisibility();
          actions.addNotification({
            type: eventType === 'COMBAT_VICTORY' ? 'success' : 'warning',
            message: eventType === 'COMBAT_VICTORY' ? 'Victory in combat!' : 'Unit defeated in combat!'
          });
          break;

        case 'UNIT_PRODUCED':
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateVisibility();
          // Select the newly produced unit immediately
          if (eventData && eventData.unit) {
            actions.selectUnit(eventData.unit.id);
            actions.addNotification({
              type: 'success',
              message: `${eventData.unit.type} produced and ready to move!`
            });
          }
          break;

        case 'UNIT_PURCHASED':
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateVisibility();
          // Select the newly purchased unit immediately
          if (eventData && eventData.unit) {
            actions.selectUnit(eventData.unit.id);
            actions.addNotification({
              type: 'success',
              message: `${eventData.unit.type} purchased and ready to move!`
            });
          }
          break;

        case 'CITY_FOUNDED':
          console.log('[useGameEngine] CITY_FOUNDED:', {
            mapWidth: gameEngine.map?.width,
            mapHeight: gameEngine.map?.height,
            tilesLength: gameEngine.map?.tiles?.length,
            eventData
          });
          
          // Ensure capital is set for the civilization that founded the city
          const civId = eventData.city.civilizationId;
          const civ = gameEngine.civilizations[civId];
          if (civ && !civ.capital) {
            // Find the first city of this civilization
            const firstCity = gameEngine.getAllCities().find(c => c.civilizationId === civId);
            if (firstCity) {
              civ.capital = firstCity;
              console.log('[useGameEngine] Set capital for civilization', civId, 'to city', firstCity.name);
            }
          }
          
          actions.updateCities(gameEngine.getAllCities());
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateCivilizations(gameEngine.civilizations);
          actions.updateVisibility();
          if (eventData.city.civilizationId === 0) {
            actions.selectCity(eventData.city.id);
          }
          actions.addNotification({
            type: 'info',
            message: `${eventData.city.name} founded!`
          });
          break;

        case 'CITY_PRODUCTION_CHANGED':
          // Sync cities (engine is authoritative)
          actions.updateCities(gameEngine.getAllCities());
          if (eventData && eventData.item) {
            const name = eventData.item.name || eventData.item.itemType || 'Production';
            actions.addNotification({ type: 'success', message: eventData.queued ? `Queued ${name}` : `Started production: ${name}` });
          }
          break;

        case 'TURN_PROCESSED':
          actions.updateCivilizations(gameEngine.civilizations);
          actions.updateCities(gameEngine.getAllCities());
          actions.updateUnits(gameEngine.getAllUnits());
          actions.updateTechnologies(gameEngine.technologies);
          actions.updateVisibility();
          // Focus camera on next unit for active player
          actions.focusOnNextUnit();
          break;

        case 'AI_FINISHED':
          // AI finished its moves for the given civilization
          actions.updateUnits(gameEngine.getAllUnits());
          // Note: updateVisibility is handled by TURN_PROCESSED event
          actions.addNotification({ type: 'info', message: 'AI finished its turn' });
          // Note: focusOnNextUnit is handled by TURN_PROCESSED event
          break;

        case 'AUTO_END_TURN':
          console.log('[useGameEngine] AUTO_END_TURN: All units moved, ending turn automatically');
          // Automatically end the turn
          actions.nextTurn();
          gameEngine.processTurn();
          break;

        case 'TURN_END_CONFIRMATION_NEEDED':
          console.log('[useGameEngine] TURN_END_CONFIRMATION_NEEDED: Human player has no moves left, asking for confirmation');
          // Trigger the end turn confirmation modal for human players
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('showEndTurnConfirmation'));
          }
          break;

        case 'UNIT_PATH_CALCULATED':
          console.log('[useGameEngine] UNIT_PATH_CALCULATED: Path calculated for unit', eventData.unit?.id);
          // Update units to reflect new path
          actions.updateUnits(gameEngine.getAllUnits());
          break;

        case 'UNIT_PATH_CLEARED':
          console.log('[useGameEngine] UNIT_PATH_CLEARED: Path cleared for unit', eventData.unit?.id);
          // Update units to reflect cleared path
          actions.updateUnits(gameEngine.getAllUnits());
          break;

        case 'UNIT_SKIPPED':
        case 'UNIT_SLEPT':
        case 'UNIT_FORTIFIED':
          // Clear path when unit action changes
          if (eventData.unit && gameEngine.clearUnitPath) {
            gameEngine.clearUnitPath(eventData.unit.id);
          }
          actions.updateUnits(gameEngine.getAllUnits());
          break;

        default:
          console.log('Unhandled game engine event:', eventType, eventData);
      }
    };

    // Initial state sync
    if (gameEngine.isInitialized) {
      console.log('[useGameEngine] Initial sync starting...');
      actions.updateMap(gameEngine.map);
      actions.updateUnits(gameEngine.getAllUnits());
      actions.updateCities(gameEngine.getAllCities());
      actions.updateCivilizations(gameEngine.civilizations);
      actions.updateTechnologies(gameEngine.technologies);
      
      // Reveal starting area around player's settler
      const playerSettler = gameEngine.units.find(u => u.civilizationId === 0 && u.type === 'settlers');
      console.log('[useGameEngine] Player settler found:', playerSettler);
      if (playerSettler) {
        console.log('[useGameEngine] Revealing area around settler at', playerSettler.col, playerSettler.row);
        actions.revealArea(playerSettler.col, playerSettler.row, 2);
      }
      
      console.log('[useGameEngine] Calling updateVisibility...');
      actions.updateVisibility();
      // Focus camera on player's first movable unit at start
      actions.focusOnNextUnit();
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