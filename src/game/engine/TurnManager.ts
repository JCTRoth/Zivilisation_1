/**
 * TurnManager - Manages phased turn execution for all civilizations.
 * 
 * TERMINOLOGY:
 * - Round: A round is finished when all active (alive) players have completed their turns.
 *          The game year advances at the end of each round using era-based increments.
 * - Turn: Each player has one turn per round if they are active (not eliminated).
 *         Each turn has phases: START -> UNIT_MOVEMENT -> CITY_PRODUCTION -> RESEARCH -> END
 * - Move: Each unit has available moves (movesRemaining) they can use during their owner's turn.
 *         Units cannot move more than their movesRemaining allows.
 * 
 * Phases: START -> UNIT_MOVEMENT -> CITY_PRODUCTION -> RESEARCH -> END
 * Emits events via GameEngine.onStateChange callback for UI / hooks.
 */
export enum TurnPhase {
  START = 'START',
  UNIT_MOVEMENT = 'UNIT_MOVEMENT',
  CITY_PRODUCTION = 'CITY_PRODUCTION',
  RESEARCH = 'RESEARCH',
  END = 'END'
}

import { AIResearch } from './AIResearch';
import { createDefaultAIState, resolveAICivStrategy } from './AITypes';
import { serializeCities } from '../../utils/CitySnapshots';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import type { ProcessTurnResult } from './EconomicManager';
import type { City, Civilization, Technology, Unit } from '../../../types/game';
import GameEngine from './GameEngine';
import { awaitPendingAnimations } from './GlideAnimation';

export class TurnManager {
  private gameEngine: GameEngine;
  private unitPaths: Map<string, Array<{ col: number; row: number }>>;
  private AI_MAX_TURN_MS = 30000; // timeout for AI movement phase
  private isProcessingGoToPaths = false; // Prevents auto-end while GoTo is executing
  private aiTurnInProgress = false; // Prevents auto-end / re-entrant phase advances while the AI turn is running

  private currentPlayer: number | null = null;
  private currentPhase: TurnPhase | null = null;
  private playerRegistered = false;
  private roundNumber = 0; // Tracks complete rounds (all players have played)

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
    this.unitPaths = new Map();
    console.log('[TurnManager] Initialized');
  }

  // --- Public accessors ---
  getPhase(): TurnPhase | null { return this.currentPhase; }
  getCurrentPlayer(): number | null { return this.currentPlayer; }
  getRoundNumber(): number { return this.roundNumber; }
  isProcessingGoTo(): boolean { return this.isProcessingGoToPaths; }
  isAITurnInProgress(): boolean { return this.aiTurnInProgress; }

  /** Reset all turn manager state for a new game. */
  reset(): void {
    this.unitPaths.clear();
    this.currentPlayer = null;
    this.currentPhase = null;
    this.playerRegistered = false;
    this.roundNumber = 0;
    this.aiTurnInProgress = false;
    this.isProcessingGoToPaths = false;
  }

  // --- Event helper ---
  private emit(eventType: string, data: Record<string, unknown> = {}) {
    if (this.gameEngine && typeof this.gameEngine.onStateChange === 'function') {
      this.gameEngine.onStateChange(eventType, data);
    }
  }

  /**
   * Format year for display (handles BC/AD notation)
   */
  private formatYear(year: number): string {
    if (year < 0) {
      return `${Math.abs(year)} BC`;
    } else if (year === 0) {
      return '1 BC';
    } else {
      return `${year} AD`;
    }
  }

  /**
   * Calculate year increment based on era.
   * Era-based progression:
   * - Before 1000 AD: +20 years/round
   * - 1000-1499 AD: +10 years/round  
   * - 1500-1749 AD: +5 years/round
   * - 1750-1849 AD: +2 years/round
   * - 1850+ AD: +1 year/round
   */
  private getYearIncrement(currentYear: number): number {
    if (currentYear < 1000) {
      return 20;
    } else if (currentYear < 1500) {
      return 10;
    } else if (currentYear < 1750) {
      return 5;
    } else if (currentYear < 1850) {
      return 2;
    } else {
      return 1;
    }
  }

  /**
   * Advance the game year using era-based progression.
   * Skips year 0 (there is no year 0 - goes from 1 BC to 1 AD).
   */
  private advanceYear(): void {
    const currentYear = this.gameEngine.currentYear || -4000;
    const increment = this.getYearIncrement(currentYear);
    let newYear = currentYear + increment;
    
    // Skip year 0 (1 BC -> 1 AD)
    if (currentYear < 0 && newYear >= 0) {
      newYear = newYear === 0 ? 1 : newYear;
    }
    
    this.gameEngine.currentYear = newYear;
    console.log(`[TurnManager] Year advanced: ${this.formatYear(currentYear)} -> ${this.formatYear(newYear)} (+${increment})`);
  }

  // --- Unit path management (compatibility with previous RoundManager) ---
  setUnitPath(unitId: string, path: Array<{ col: number; row: number }>): void {
    console.log(`[TurnManager] Setting path for unit ${unitId}:`, path);
    this.unitPaths.set(unitId, path);
  }
  getUnitPath(unitId: string): Array<{ col: number; row: number }> | undefined {
    return this.unitPaths.get(unitId);
  }
  clearUnitPath(unitId: string): void {
    console.log(`[TurnManager] Clearing path for unit ${unitId}`);
    this.unitPaths.delete(unitId);
  }
  getAllUnitPaths(): Map<string, Array<{ col: number; row: number }>> {
    return new Map(this.unitPaths);
  }
  cleanupDestroyedUnits(existingUnitIds: string[]): void {
    for (const id of Array.from(this.unitPaths.keys())) {
      if (!existingUnitIds.includes(id)) {
        console.log(`[TurnManager] Cleaning path for destroyed unit ${id}`);
        this.unitPaths.delete(id);
      }
    }
  }

  // --- Turn lifecycle ---
  startTurn(civilizationId: number): void {
    // Don't start a new turn while the game is paused — otherwise the AI would
    // keep playing through paused turns (e.g. AI-vs-AI auto mode).
    if (this.gameEngine.isPaused) {
      console.warn(`[TurnManager] startTurn: Game paused — deferring turn start for civ ${civilizationId}`);
      return;
    }
    this.currentPlayer = civilizationId;
    this.currentPhase = TurnPhase.START;
    this.playerRegistered = false;
    
    // Format year for display
    const currentYear = this.gameEngine.currentYear || -4000;
    const yearDisplay = this.formatYear(currentYear);
    
    console.log(`[TurnManager] Starting turn for civ ${civilizationId} | Round: ${this.roundNumber} | Year: ${yearDisplay}`);
    this.emit('TURN_START', {
      civilizationId,
      roundNumber: this.roundNumber,
      // Full city JSONs of the active player so the game log regularly
      // contains the complete per-player city state.
      cities: serializeCities(
        this.gameEngine?.getAllCities?.()?.filter((c) => c?.civilizationId === civilizationId) ?? [],
      ),
    });

    const civ = this.gameEngine.civilizations?.[civilizationId];
    if (civ?.isAI) {
      // AI auto-registration
      this.registerPlayer(civilizationId);
    } else {
      console.log('[TurnManager] Awaiting human registration (call turnManager.registerPlayer(civId))');
      setTimeout(() => {
        if (!this.playerRegistered && this.currentPlayer === civilizationId) {
          console.log('[TurnManager] Reminder: human not registered yet for this turn');
        }
      }, 3000);
    }
  }

  async registerPlayer(civilizationId: number): Promise<boolean> {
    if (this.currentPlayer !== civilizationId) {
      console.warn(`[TurnManager] registerPlayer mismatch expected ${this.currentPlayer} got ${civilizationId}`);
      return false;
    }
    if (this.playerRegistered) {
      console.log('[TurnManager] Player already registered');
      return true;
    }
    this.playerRegistered = true;
    console.log(`[TurnManager] Player ${civilizationId} registered`);
    this.emit('PLAYER_REGISTERED', { civilizationId });
    // Move to first actionable phase
    await this.advanceToPhase(TurnPhase.UNIT_MOVEMENT);
    return true;
  }

  async nextPhase(): Promise<void> {
    if (this.currentPlayer == null || this.currentPhase == null) return;
    switch (this.currentPhase) {
      case TurnPhase.START:
        await this.advanceToPhase(TurnPhase.UNIT_MOVEMENT); break;
      case TurnPhase.UNIT_MOVEMENT:
        await this.advanceToPhase(TurnPhase.CITY_PRODUCTION); break;
      case TurnPhase.CITY_PRODUCTION:
        await this.advanceToPhase(TurnPhase.RESEARCH); break;
      case TurnPhase.RESEARCH:
        await this.advanceToPhase(TurnPhase.END); break;
      case TurnPhase.END:
        console.log('[TurnManager] nextPhase: At END phase, not advancing further (finalization happens via advanceToPhase)');
        break;
    }
  }

  /**
   * End the current human player's turn properly by advancing through all remaining phases.
   * This ensures CITY_PRODUCTION, RESEARCH, and END phases are processed before moving to the next player.
   * Should be called when:
   * - Human clicks "End Turn" button
   * - Auto-end turn triggers (all units done)
   */
  async endHumanTurn(): Promise<void> {
    const civId = this.currentPlayer;
    if (civId == null) {
      console.warn('[TurnManager] endHumanTurn: No current player');
      return;
    }
    
    const civ = this.gameEngine.civilizations?.[civId];
    if (!civ?.isHuman) {
      console.warn(`[TurnManager] endHumanTurn: Player ${civId} is not human, ignoring`);
      return;
    }

    // Research must never sit idle: if the player ends the turn without a
    // selected technology, research a random available one. The auto-end gate
    // only PROMPTS for a choice — this is the safety net for "selected
    // nothing" so the turn's science is not wasted.
    if (!civ.currentResearch && typeof this.gameEngine.autoSelectResearch === 'function') {
      const autoPicked = this.gameEngine.autoSelectResearch(civId);
      if (autoPicked) {
        console.log(`[TurnManager] No research selected — auto-selected '${autoPicked}' for ${civ.name}`);
      }
    }
    
    console.log(`[TurnManager] endHumanTurn: Ending turn for human player ${civId}, current phase: ${this.currentPhase}`);
    
    // Advance through remaining phases. advanceToPhase handles END phase finalization.
    if (this.currentPhase === TurnPhase.UNIT_MOVEMENT) {
      await this.advanceToPhase(TurnPhase.CITY_PRODUCTION);
    }
    if (this.currentPhase === TurnPhase.CITY_PRODUCTION) {
      await this.advanceToPhase(TurnPhase.RESEARCH);
    }
    if (this.currentPhase === TurnPhase.RESEARCH) {
      await this.advanceToPhase(TurnPhase.END);
    }
    
    console.log(`[TurnManager] endHumanTurn: Human player ${civId} turn completed`);
  }

  private async advanceToPhase(phase: TurnPhase): Promise<void> {
    if (this.currentPlayer == null) return;
    this.currentPhase = phase;
    console.log(`[TurnManager] Phase -> ${phase} for civ ${this.currentPlayer}`);
    this.emit('PHASE_CHANGE', { civilizationId: this.currentPlayer, phase });

    switch (phase) {
      case TurnPhase.UNIT_MOVEMENT:
        await this.processAutomatedMovements(this.currentPlayer);
        
        // Initialize the unit turn queue for this player
        if (this.gameEngine.unitTurnQueue) {
          this.gameEngine.unitTurnQueue.initializeQueue(this.currentPlayer);
        }
        
        // Human movement waits for UI. AI movement triggered asynchronously below.
        const civ = this.gameEngine.civilizations?.[this.currentPlayer];
        if (civ?.isAI) {
          this.runAIUnitMovementPhase(this.currentPlayer);
        } else if (civ?.isHuman) {
          // For human players, auto-select and focus on the first unit in the queue
          this.selectCurrentQueueUnit(this.currentPlayer);
        }
        
        // After GoTo paths are processed and queue is initialized, check if turn should auto-end
        // (GoTo movements may have consumed all unit moves, leaving nothing for the player to do)
        if (this.gameEngine.checkAndEndTurnIfNoMoves) {
          this.gameEngine.checkAndEndTurnIfNoMoves('turn-start');
        }
        break;
      case TurnPhase.CITY_PRODUCTION:
        this.handleCityProduction(this.currentPlayer);
        break;
      case TurnPhase.RESEARCH:
        this.handleResearch(this.currentPlayer);
        break;
      case TurnPhase.END:
        // Clear the unit queue at end of turn
        if (this.gameEngine.unitTurnQueue) {
          this.gameEngine.unitTurnQueue.clearQueue(this.currentPlayer);
        }
        this.finalizeEndPhase(this.currentPlayer);
        break;
      case TurnPhase.START:
        // Should not be re-entered via advanceToPhase
        break;
    }
  }

  /**
   * Select and focus on the current unit in the queue for human players.
   * This auto-selects the unit and centers the camera on it.
   */
  private selectCurrentQueueUnit(civilizationId: number): void {
    const queue = this.gameEngine.unitTurnQueue;
    if (!queue) return;
    
    const currentUnit = queue.getCurrentUnit(civilizationId);
    if (currentUnit) {
      console.log(`[TurnManager] Auto-selecting queue unit: ${currentUnit.id} (${currentUnit.type}) at (${currentUnit.col}, ${currentUnit.row})`);
      
      // Emit event to select and focus on this unit
      this.emit('SELECT_QUEUE_UNIT', { 
        unit: currentUnit,
        civilizationId 
      });
      
      // Also update store directly if available
      if (this.gameEngine.storeActions) {
        this.gameEngine.storeActions.selectUnit(currentUnit.id);
      }
    } else {
      console.log(`[TurnManager] No units in queue for civ ${civilizationId}`);
    }
  }

  // --- Phase handlers ---
  private runAIUnitMovementPhase(civilizationId: number) {
    console.log(`[TurnManager] AI movement phase for civ ${civilizationId}`);
    if (!this.gameEngine.processAITurn) {
      this.nextPhase();
      return;
    }
    // Flag that an AI turn is in flight so checkAndEndTurnIfNoMoves cannot
    // re-entrantly advance the phase chain while the AI is still processing
    // (that used to start the NEXT player's turn mid-AI-turn, leaving a stale
    // AI turn running on the wrong player which froze all unit movement).
    this.aiTurnInProgress = true;
    const promise = this.gameEngine.processAITurn(civilizationId);
    if (!promise || typeof promise.then !== 'function') {
      console.warn('[TurnManager] AI processAITurn not promise-based; skipping to production');
      this.aiTurnInProgress = false;
      this.nextPhase(); // CITY_PRODUCTION
      return;
    }
    let finished = false;
    const timeoutHandle = setTimeout(() => {
      if (!finished && this.currentPlayer === civilizationId) {
        console.warn(`[TurnManager] ⏰ AI movement timeout for civ ${civilizationId}`);
        this.forceEndAITurn(civilizationId, 'timeout');
      }
    }, this.AI_MAX_TURN_MS);

      promise.then(() => {
      if (finished) return;
      finished = true; clearTimeout(timeoutHandle);
      if (this.currentPlayer !== civilizationId) {
        console.warn(`[TurnManager] Stale AI turn for civ ${civilizationId} resolved on civ ${this.currentPlayer}'s turn — not advancing phases`);
        return;
      }
      this.aiTurnInProgress = false;
      // Phase transitions fire as synchronous microtasks. The test harness
      // (or the engine's own endHumanTurn path) also calls nextPhase, which
      // can double-advance the turn. We rely on the test guard (see
      // aiAggression.test.ts) and the isAITurnInProgress check in
      // checkAndEndTurnIfNoMoves to prevent this. If this.chached var is
      // stale (the test already called nextPhase), the currentPlayer check
      // catches it and returns early.
      this.nextPhase(); // CITY_PRODUCTION
      this.nextPhase(); // RESEARCH
      this.nextPhase(); // END
    }).catch(err => {
      if (finished) return;
      finished = true; clearTimeout(timeoutHandle);
      console.error('[TurnManager] AI movement error:', err);
      if (this.currentPlayer === civilizationId) {
        this.forceEndAITurn(civilizationId, 'error');
      } else {
        // Stale turn errored on another player's turn — leave their state alone.
        console.warn(`[TurnManager] Stale AI turn for civ ${civilizationId} errored on civ ${this.currentPlayer}'s turn`);
      }
    });
  }

  private handleCityProduction(civilizationId: number) {
    console.log(`[TurnManager] City production phase for civ ${civilizationId}`);
    try {
      const civ = this.gameEngine.civilizations?.[civilizationId];
      // Auto Production applies to human cities too. processAutoProduction
      // internally only touches cities with autoProduction enabled, so cities
      // where the player turned it off are left alone.
      if (civ && this.gameEngine.autoProduction) {
        this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);
      }
      this.emit('CITY_PRODUCTION_PHASE', { civilizationId });
    } catch (e) {
      console.warn('[TurnManager] City production error', e);
    }
  }

  private handleResearch(civilizationId: number) {
    console.log(`[TurnManager] Research phase for civ ${civilizationId}`);
    
    // If AI has no current research, select one via AIResearch
    const civ = this.gameEngine.civilizations?.[civilizationId];
    if (civ && !civ.isHuman && !civ.currentResearch && typeof this.gameEngine.setResearch === 'function') {
      try {
        const storage = this.gameEngine.getPlayerStorage?.(civilizationId);
        const aiState = storage?.turnData?.aiState ?? createDefaultAIState();
        const strategy = resolveAICivStrategy(civ, aiState);

        const cities = this.gameEngine.cities?.filter((c) => c.civilizationId === civilizationId) ?? [];
        const gameState = {
          currentYear: this.gameEngine.currentYear ?? -4000,
          roundNumber: this.roundNumber,
          numCities: cities.length,
          numEnemyCitiesKnown: 0,
          isAtWar: (civ.warWith?.size ?? 0) > 0,
hasLibrary: cities.some((c) => c.buildings?.includes('library')),
            totalScience: this.gameEngine.cities?.reduce((s: number, c) => s + (c.science || 0), 0) ?? 0,
          hasWaterAccess: cities.some((city) => this.cityHasDirectWaterAccess(city)),
        };

        const techChoice = AIResearch.selectResearch(civ, strategy, gameState);
        if (techChoice) {
          this.gameEngine.setResearch(civilizationId, techChoice);
          console.log(`[TurnManager] AI ${civ.name} selected research: ${techChoice}`);
        }
      } catch (err) {
        console.warn('[TurnManager] Failed to select AI research in handleResearch', err);
      }
    }

    this.emit('RESEARCH_PHASE', { civilizationId });
  }

  private cityHasDirectWaterAccess(city: { col: number; row: number }): boolean {
    for (let dCol = -1; dCol <= 1; dCol++) {
      for (let dRow = -1; dRow <= 1; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        const tile = this.gameEngine.getTileAt?.(city.col + dCol, city.row + dRow);
        if (tile?.type === 'ocean' || tile?.type === 'sea') return true;
      }
    }
    return false;
  }

  private finalizeEndPhase(civilizationId: number) {
    console.log(`[TurnManager] Finalizing end phase for civ ${civilizationId}`);
    
    // Emit event for UI to clear highlights and selection; include the active
    // player's full city JSONs so the game log carries them on every turn end.
    this.emit('TURN_END', {
      civilizationId,
      roundNumber: this.roundNumber,
      cities: serializeCities(
        this.gameEngine?.getAllCities?.()?.filter((c) => c?.civilizationId === civilizationId) ?? [],
      ),
    });
    
    // Advance to the next player's turn
    this.advanceTurn();
  }

  /**
   * Advance to the next player's turn.
   * When all active players have had their turn, a new round begins and the year advances.
   * This is the core turn management logic - no external calls needed.
   */
  advanceTurn(): void {
    console.log('[TurnManager] advanceTurn: Advancing from player', this.currentPlayer);
    
    // Do not advance to the next player while paused — this freezes the whole
    // turn cycle (human AND AI) so nothing continues behind the pause screen.
    if (this.gameEngine.isPaused) {
      console.warn('[TurnManager] advanceTurn: Game paused — deferring turn advance');
      return;
    }
    
    const previousPlayer = this.currentPlayer;
    
    // Get only active (alive) civilizations. The barbarian faction (if it has
    // been promoted to a real faction by capturing a city) is EXCLUDED from the
    // normal turn rotation — its units and cities are driven by the dedicated
    // BarbarianManager once per round instead.
    const activeCivs = this.gameEngine.civilizations?.filter((civ) => civ.isAlive !== false && civ.id !== BARBARIAN_CIV_ID) || [];
    const numActiveCivs = activeCivs.length;
    
    if (numActiveCivs === 0) {
      console.error('[TurnManager] advanceTurn: No active civilizations found');
      return;
    }
    
    // Find current player's index in active civs and move to next
    const currentActiveIndex = activeCivs.findIndex((civ) => civ.id === previousPlayer);
    const nextActiveIndex = (currentActiveIndex + 1) % numActiveCivs;
    const nextCiv = activeCivs[nextActiveIndex];
    const nextPlayer = nextCiv?.id ?? 0;
    
    if (!nextCiv) {
      console.error('[TurnManager] advanceTurn: Next civilization not found');
      return;
    }
    
    // Check if a new round is starting (wrapped back to first active player)
    const isNewRound = nextActiveIndex === 0 && currentActiveIndex !== -1;
    
    if (isNewRound) {
      this.roundNumber += 1;
      // Advance year using era-based progression
      this.advanceYear();
      // Also sync to GameEngine.currentTurn for consistency
      this.gameEngine.currentTurn = this.roundNumber;
      
      // Phase 3.1: Update scout memory with new round and prune old discoveries
      this.gameEngine.scoutMemory.setCurrentRound(this.roundNumber);

      // Barbarians act once per round — their own dedicated AI (hunt cities,
      // and captured cities pump out raiders). Runs before any civ moves so
      // the horde's actions are visible within the round.
      this.gameEngine.barbarianManager?.processBarbarians();

      console.log(`[TurnManager] ═══════════════════════════════════════════════`);
      console.log(`[TurnManager] NEW ROUND ${this.roundNumber} | Year: ${this.formatYear(this.gameEngine.currentYear)}`);
      console.log(`[TurnManager] ═══════════════════════════════════════════════`);
      this.gameEngine.log?.('turn', `ROUND ${this.roundNumber} | Year: ${this.formatYear(this.gameEngine.currentYear)}`);
      
      // Sync turn and year to the store
      if (this.gameEngine.storeActions) {
        this.gameEngine.storeActions.updateGameState({
          currentTurn: this.roundNumber,
          currentYear: this.gameEngine.currentYear
        });
      }

      // Process diplomacy turn (reputation recovery, ceasefire timers)
      if (this.gameEngine.diplomacyManager) {
        this.gameEngine.diplomacyManager.processTurn(this.roundNumber);
      }
    }
    
    // Sync active player to store on every turn change
    if (this.gameEngine.storeActions) {
      this.gameEngine.storeActions.updateGameState({
        activePlayer: nextPlayer
      });
    }
    
    console.log(`[TurnManager] advanceTurn: Moving from player ${previousPlayer} to ${nextPlayer} (${nextCiv.name}, ${nextCiv.isHuman ? 'human' : 'AI'})`);

    if (this.gameEngine.victoryManager && this.gameEngine.victoryManager.evaluateEndOfTurn()) {
      console.log('[TurnManager] advanceTurn: VictoryManager reported game end; halting further turn processing.');
      this.currentPlayer = null;
      this.currentPhase = null;
      return;
    }
    
    // Update active player in game engine
    this.gameEngine.activePlayer = nextPlayer;
    
    // Reset unit moves for the new active player
    this.resetUnitsForPlayer(nextPlayer);
    
    // Process turn-based game events (production, purchases, research)
    this.processTurnEvents(nextPlayer);
    
    // Start the new turn
    this.startTurn(nextPlayer);
  }

  /**
   * Reset units for a player at the start of their turn
   */
  private resetUnitsForPlayer(playerId: number): void {
    // Access UNIT_PROPS from Constants or global scope
    const UNIT_PROPS = (this.gameEngine.constructor as typeof GameEngine).UNIT_PROPS
      || (globalThis as { UNIT_PROPS?: typeof GameEngine['UNIT_PROPS'] }).UNIT_PROPS;
    const units = this.gameEngine.units.filter((u) => u.civilizationId === playerId);
    
    console.log(`[TurnManager] Resetting moves for ${units.length} units of player ${playerId}`);
    
    units.forEach((unit) => {
      const unitProps = UNIT_PROPS?.[unit.type];
      unit.movesRemaining = unitProps?.movement || 1;
      // Civ1: at the start of the owner's turn every unit is "fresh" — full
      // movement restored and no action taken yet, so the Minimum-1-Move
      // exception applies to its first move.
      unit.hasMovedThisTurn = false;
      unit.areTurnsDone = false;
      unit.isSkipped = false; // "Skip turn" only applies to the current turn

      // Civ1 multi-turn settler construction: a settler with in-progress
      // improvement work spends this turn on the site. advanceUnitWork
      // decrements the worker-turns and — if still under construction —
      // consumes the moves we just reset; when it completes the settler keeps
      // its fresh moves and can move on.
      if (unit.workTarget) {
        this.gameEngine.advanceUnitWork(unit.id);
      }
    });
  }

  /**
   * Process turn events: city production, purchases, research
   */
  private processTurnEvents(playerId: number): void {
    console.log(`[TurnManager] Processing turn events for player ${playerId}`);
    
    // Process purchased items from previous turn
    this.gameEngine.cities?.forEach((city) => {
      if (city.purchasedThisTurn && city.purchasedThisTurn.length > 0) {
        city.purchasedThisTurn.forEach((item) => {
          if (item.type === 'unit') {
            this.createPurchasedUnit(city, item);
          } else if (item.type === 'building') {
            this.addBuildingToCity(city, item.itemType, true);
          }
        });
        city.purchasedThisTurn = [];
      }
    });

    // Process cities for the active player
    const playerCities = this.gameEngine.cities?.filter((c) => c.civilizationId === playerId) || [];
    const civ = this.gameEngine.civilizations[playerId];

    // Compute real tile-based yields FIRST so production/growth use real
    // food/production, then economic outputs + happiness so disorder is known
    // before production/growth is applied.
    playerCities.forEach((city: City) => {
      this.gameEngine.economicManager?.recomputeCityYields(city);
      this.gameEngine.economicManager?.applyCityOutputs(city, civ);
    });

    playerCities.forEach((city: City) => {
      // Captured-city unrest fades a little each turn (Civ1: resentment
      // subsides once the new owner garrisons and manages the city).
      if (city.capturedTurns && city.capturedTurns > 0) {
        city.capturedTurns -= 1;
        if (city.capturedTurns < 0) city.capturedTurns = 0;
      }
      const inDisorder = city.disorder === true;
      // Emit CITY_DISORDER only on transitions (enter/leave) to avoid spamming.
      if (inDisorder !== (city.disorderLastTurn === true)) {
        if (this.gameEngine.onStateChange) {
          this.gameEngine.onStateChange('CITY_DISORDER', { city, civilizationId: playerId });
        }
      }
      city.disorderLastTurn = inDisorder;

      if (inDisorder) {
        // Disorder halts growth (stability) but NOT production — otherwise a
        // low-commerce economy (trade ~0) would deadlock forever. Commerce is
        // already lost to unrest in EconomicManager.applyCityOutputs.
        console.log(`[TurnManager] City ${city.name} is in disorder — growth halted`);
      } else {
        this.processCityGrowth(city);
      }
      this.processCityProduction(city);
    });

    // Process civilization resources (rate-based income + upkeep) and research
    if (civ) {
      // Advance any revolution (anarchy) countdown so the pending government
      // applies BEFORE the economy is computed for this turn.
      this.gameEngine.governmentManager?.processTurn(civ);
      const econResult = this.processCivilizationResources(civ);
      if (econResult && (econResult.upkeep > 0 || econResult.disbanded > 0)) {
        this.gameEngine.log('economy',
          `Upkeep −${econResult.upkeep} gold (deficit ${econResult.deficit}, ${econResult.disbanded} unit(s) disbanded)`,
          { upkeep: econResult.upkeep, deficit: econResult.deficit, disbanded: econResult.disbanded, civilizationId: playerId });
      }
      this.processCivilizationResearch(civ);
    }

    // Update store with processed state
    if (this.gameEngine.storeActions) {
      this.gameEngine.storeActions.updateCities([...this.gameEngine.cities]);
      this.gameEngine.storeActions.updateCivilizations([...this.gameEngine.civilizations]);
      this.gameEngine.storeActions.updateUnits([...this.gameEngine.units]);
    }

    // Emit event for UI synchronization
    this.emit('TURN_PROCESSED', { civilizationId: playerId });
  }

  private createPurchasedUnit(city: City, item: { type?: string; itemType?: string; name?: string; cost?: number }): void {
    const unitType = item.itemType;
    // Purchased units do NOT consume population or destroy the city —
    // that only happens for shield-based production (Civ1 rules).
    this.createProducedUnit(city, unitType, 'UNIT_PURCHASED', /* isPurchased */ true);
  }

  private processCityProduction(city: City): void {
    // Start production from queue if needed
    if (!city.currentProduction && city.buildQueue && city.buildQueue.length > 0) {
      const nextItem = city.buildQueue.shift();
      if (nextItem) {
        city.currentProduction = nextItem;
        city.productionProgress = city.carriedOverProgress || 0;
        city.carriedOverProgress = 0;
      }
    }

    // Add production
    if (city.currentProduction) {
      const grossShields = city.yields?.production ?? 0;
      const shieldSupport = this.calculateCityShieldSupport(city);
      city.productionStored += Math.max(0, grossShields - shieldSupport);
      city.productionProgress = city.productionStored;

      if (city.productionStored >= city.currentProduction.cost) {
        this.completeProduction(city);
      }
    }
  }

  /**
   * Civ1-style shield support. A city supports up to its population, capped
   * by the government's per-city allowance; units beyond that allowance
   * consume one shield each. NONE units never enter the calculation.
   */
  private calculateCityShieldSupport(city: City): number {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const government = String(civ?.government ?? 'despotism').toLowerCase();
    
    // Civ1: only settlers cost shields in Republic and Democracy.
    // In Republic: 1 shield per settler. In Democracy: 1 shield per settler.
    // All other governments: settlers cost 0 shields.
    if (government === 'republic' || government === 'democracy') {
      const settlerCount = (this.gameEngine.units ?? []).filter(
        (unit) => unit.type === 'settler'
          && unit.homeCityId === city.id
          && !unit.isNoneUnit,
      ).length;
      return settlerCount; // 1 shield per settler
    }
    
    // Despotism/Monarchy/Communism/Anarchy: no shield support for settlers.
    return 0;
  }

  private completeProduction(city: City): void {
    console.log(`[TurnManager] City ${city.name} completed production: ${city.currentProduction.type} ${city.currentProduction.itemType}`);
    
    city.productionStored = 0;
    city.productionProgress = 0;

    if (city.currentProduction.type === 'unit') {
      const cityDestroyed = this.createProducedUnit(city, city.currentProduction.itemType);
      if (cityDestroyed) return;
    } else if (city.currentProduction.type === 'building') {
      this.addBuildingToCity(city, city.currentProduction.itemType, false);
    }

    // Advance queue if present
    if (Array.isArray(city.buildQueue) && city.buildQueue.length > 0) {
      city.currentProduction = city.buildQueue.shift();
      city.productionProgress = 0;
    } else {
      city.currentProduction = null;
      // Queue empty after completion — let auto-production fill it next turn
      if (this.gameEngine.autoProduction && city.autoProduction) {
        this.gameEngine.autoProduction.ensureProductionQueue(city.id);
      }
    }
  }

  private createProducedUnit(city: City, unitType: string, eventType = 'UNIT_PRODUCED', isPurchased = false): boolean {
    const unitProps = ((this.gameEngine.constructor as typeof GameEngine).UNIT_PROPS?.[unitType]
      ?? { movement: 1, attack: 0, defense: 1 }) as {
        movement: number; attack: number; defense: number;
        hitPoints?: number; maintenance?: number; icon?: string;
      };
    const isSettler = unitType === 'settler';
    const isChieftain = String(this.gameEngine.gameSettings?.difficulty ?? '').toUpperCase() === 'CHIEFTAIN';
    const population = Number(city.population ?? 1);
    // Purchased settlers do NOT consume population or destroy the city —
    // only shield-based production triggers the Civ1 settler rule.
    const destroysCity = isSettler && population <= 1 && !isChieftain && !isPurchased;

    if (isSettler && population > 1 && !isPurchased) {
      // Civ1 consumes exactly one citizen when the settler completes.
      city.population = population - 1;
      city.foodNeeded = Math.max(20, city.population * 20);
      if (typeof city.hitPoints === 'number') city.hitPoints = Math.min(city.hitPoints, city.population);
    }

    // Mirror GameEngine.createUnit so produced units have full combat stats
    // (attack/defense/maxMoves). Previously these were missing, which made
    // `attacker.attack` undefined → NaN strength → produced units ALWAYS
    // lost combat.
    const unit = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: unitType,
      civilizationId: city.civilizationId,
      col: city.col,
      row: city.row,
      health: 100,
      hitPoints: unitProps.hitPoints ?? 2,
      maxHitPoints: unitProps.hitPoints ?? 2,
      movement: unitProps.movement,
      movesRemaining: unitProps.movement,
      maxMoves: unitProps.movement,
      hasMovedThisTurn: false,
      isVeteran: false,
      attack: unitProps.attack || 0,
      defense: unitProps.defense || 1,
      maintenance: destroysCity ? 0 : (unitProps.maintenance ?? 0),
      icon: unitProps.icon || '⚔️',
      orders: null,
      homeCityId: destroysCity ? null : city.id,
      isNoneUnit: destroysCity,
      foodSupport: destroysCity ? 0 : (isSettler ? 1 : 0),
      shieldSupport: destroysCity ? 0 : (isSettler ? 1 : 0),
    };

    this.gameEngine.units.push(unit);
    console.log(`[TurnManager] Created unit ${unit.type} at city ${city.name}`);

    if (destroysCity) {
      this.destroyCityForSettler(city, unit);
      return true;
    }
    
    // Phase 3.2: If a scout was created, reassign zones
    if (unitType === 'scout') {
      this.gameEngine.onScoutCreated(unit);
    }
    
    this.emit(eventType, { cityId: city.id, unit });
    return false;
  }

  /** Apply the Civ1 size-1 settler exception and turn the new unit into NONE. */
  private destroyCityForSettler(city: City, settler: Unit): void {
    const cityId = city.id;
    const cityUnits = this.gameEngine.units.filter((u) => u.homeCityId === cityId);
    for (const unit of cityUnits) {
      unit.homeCityId = null;
      unit.isNoneUnit = true;
      unit.foodSupport = 0;
      unit.shieldSupport = 0;
    }

    this.gameEngine.cities = this.gameEngine.cities.filter((c) => c.id !== cityId);
    this.gameEngine.governmentManager?.ensureCapital?.(city.civilizationId);
    this.gameEngine.onStateChange?.('CITY_DESTROYED', {
      city,
      reason: 'size_one_settler_completion',
      settler,
    });
    console.log(`[TurnManager] Settler completion destroyed size-1 city ${city.name}; settler is now NONE`);
  }

  private addBuildingToCity(city: City, buildingType: string, isPurchased: boolean): void {
    if (!city.buildings) city.buildings = [];
    // Buildings are one-per-city in Civ1 — never add a duplicate (the AI
    // purchase + production paths could otherwise double-add the same item).
    if (city.buildings.includes(buildingType)) {
      console.log(`[TurnManager] Skipping duplicate building ${buildingType} in city ${city.name}`);
      return;
    }
    city.buildings.push(buildingType);

    // Building a Palace moves the seat of government to this city.
    if (buildingType === 'palace') {
      this.gameEngine.governmentManager?.designateCapital(city.civilizationId, city);
    }

    console.log(`[TurnManager] Added ${isPurchased ? 'purchased' : 'produced'} building ${buildingType} to city ${city.name}`);
    
    this.emit(isPurchased ? 'BUILDING_PURCHASED' : 'BUILDING_COMPLETED', { 
      cityId: city.id, 
      buildingType 
    });
  }

  private processCityGrowth(city: City): void {
    const civ = this.gameEngine.civilizations?.[city.civilizationId];
    const government = String(civ?.government ?? 'despotism').toLowerCase();
    
    // Civ1: each settler attached to a city consumes food per turn.
    // Democracy is special: settlers cost 2 food instead of 1.
    const settlerFoodPerTurn = government === 'democracy' ? 2 : 1;
    const settlerFoodSupport = (this.gameEngine.units ?? []).filter(
      (unit) => unit.type === 'settler'
        && unit.homeCityId === city.id
        && !unit.isNoneUnit,
    ).length * settlerFoodPerTurn;
    // Settlers consume food from their home city's food box each turn.
    city.foodStored = Math.max(0, (city.foodStored ?? 0) + (city.yields?.food ?? 0) - settlerFoodSupport);
    
    if (city.foodStored >= city.foodNeeded) {
      city.population++;
      city.foodStored = 0;
      city.foodNeeded = city.population * 20;
      console.log(`[TurnManager] City ${city.name} grew to population ${city.population}`);
    }
  }

  private processCivilizationResources(civ: Civilization): ProcessTurnResult | null {
    try {
      if (civ?.resources && this.gameEngine.economicManager) {
        // Rate-based income (tax/science/luxury split) + upkeep + deficit
        // handling. Also resets per-turn resource accumulators, which fixes
        // the research compounding bug (science is now the per-turn amount).
        return this.gameEngine.economicManager.processTurn(civ);
      }
    } catch (e) {
      console.warn('[TurnManager] Error processing civilization resources', e);
    }
    return null;
  }

  private processCivilizationResearch(civ: Civilization): void {
    try {
      if (!civ.currentResearch) return;

      // Civ I research model: beaker modifiers + tech cost scaling + the
      // 4-turn minimum / 32-turn maximum. Even a civ with 0 science makes
      // minimum progress so a tech can never take more than 32 turns.
      const totalScience = civ.resources?.science ?? 0;
      const completedTechId = this.gameEngine.researchManager
        ? this.gameEngine.researchManager.advanceResearch(civ, civ.currentResearch, totalScience)
        : this.legacyAdvanceResearch(civ, civ.currentResearch, totalScience);

      if (!completedTechId) return;

      const completedId = completedTechId;
      if (Array.isArray(civ.technologies)) {
        civ.technologies.push(completedId);
      }
      civ.researchProgress = 0;
      civ.currentResearch = null;

      // City walls become obsolete once Metallurgy is discovered (Civ1) — they
      // are automatically scrapped in every city of this civilization.
      if (completedId === 'metallurgy') {
        this.gameEngine.scrapObsoleteCityWalls?.(civ.id);
      }

      if (this.gameEngine.updateTechnologyAvailability) {
        this.gameEngine.updateTechnologyAvailability();
      }

      console.log(`[TurnManager] Civilization ${civ.name} completed research: ${completedId}`);

      // Notify listeners (UI research-complete modal, log, progression…).
      this.emit('TECH_RESEARCHED', { civilizationId: civ.id, techId: completedId });

      // Newly researched techs may unlock units/buildings — refresh the
      // civ's production queues so it can build the newest options.
      this.gameEngine.autoProduction?.processAutoProductionForCivilization(civ.id);

      // AI auto-selects next research via AIResearch module
      if (!civ.isHuman && typeof this.gameEngine.setResearch === 'function') {
        try {
          const storage = this.gameEngine.getPlayerStorage?.(civ.id);
          const aiState = storage?.turnData?.aiState ?? createDefaultAIState();
          const strategy = resolveAICivStrategy(civ, aiState);

          const cities = this.gameEngine.cities?.filter((c) => c.civilizationId === civ.id) ?? [];
          const gameState = {
            currentYear: this.gameEngine.currentYear ?? -4000,
            roundNumber: this.roundNumber,
            numCities: cities.length,
            numEnemyCitiesKnown: 0,
            isAtWar: (civ.warWith?.size ?? 0) > 0,
            hasLibrary: cities.some((c) => c.buildings?.includes('library')),
            totalScience: this.gameEngine.cities?.reduce((s: number, c) => s + (c.science || 0), 0) ?? 0,
          };

          const techChoice = AIResearch.selectResearch(civ, strategy, gameState);
          if (techChoice) {
            this.gameEngine.setResearch(civ.id, techChoice);
            console.log(`[TurnManager] AI ${civ.name} auto-selected next research: ${techChoice}`);
          }
        } catch (err) {
          console.warn('[TurnManager] Failed to auto-select AI research', err);
        }
      }
    } catch (e) {
      console.warn('[TurnManager] Error processing research', e);
    }
  }

  /** Fallback when researchManager isn't available (defensive). */
  private legacyAdvanceResearch(civ: Civilization, tech: Technology, totalScience: number): string | null {
    civ.researchProgress = (civ.researchProgress || 0) + (totalScience || 0);
    const techCost = typeof tech === 'object' && tech.cost ? tech.cost : 0;
    if (civ.researchProgress >= techCost && techCost > 0) {
      return tech.id || null;
    }
    return null;
  }

  // --- Automated movement (path following) ---
  private async processAutomatedMovements(civilizationId: number): Promise<void> {
    const unitsWithPaths = Array.from(this.unitPaths.entries())
      .filter(([unitId]) => {
        const unit = this.gameEngine.units.find((u) => u.id === unitId);
        return unit && unit.civilizationId === civilizationId;
      });
    
    // Flag that we're processing GoTo paths - prevents checkAndEndTurnIfNoMoves from triggering
    this.isProcessingGoToPaths = true;
    
    try {
      console.log(`[TurnManager] 🚀 Processing automated GoTo paths for civ ${civilizationId}`);
      console.log(`[TurnManager] Found ${unitsWithPaths.length} units with GoTo paths`);
    
    // Check if this is a human player (for animated movement)
    const civ = this.gameEngine.civilizations.find((c) => c.id === civilizationId);
    const isHumanPlayer = civ?.isHuman || false;
    
    const units = this.gameEngine.units.filter((u) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0);
    
    for (const unit of units) {
      const path = this.unitPaths.get(unit.id);
      if (!path || path.length === 0) continue;
      
      // Safety: skip path entries the unit already passed (stale GoTo from
      // a previous turn where the AI moved the unit mid-turn).  Without
      // this the scout walks backward to its old position first, consuming
      // moves and oscillating every turn.
      while (path.length > 1 &&
             path[0].col === unit.col && path[0].row === unit.row) {
        path.shift(); // already here — skip to the next step
      }
      if (path.length === 0) {
        this.clearUnitPath(unit.id);
        continue;
      }
      
      console.log(`[TurnManager] ➡️ Unit ${unit.id} (${unit.type}) has GoTo path with ${path.length} steps, ${unit.movesRemaining} moves remaining`);
      
      if (isHumanPlayer) {
        // Use animated movement for human players so they can see the unit moving
        console.log(`[TurnManager] 🎬 Using animated GoTo movement for human player unit ${unit.id}`);
        try {
          const result = await this.gameEngine.goToManager.executePathWithAnimation(unit.id, 200); // 200ms delay between moves
          if (result.success) {
            console.log(`[TurnManager] ✅ Animated path completed for unit ${unit.id}, ${result.stepsCompleted} steps taken`);
            if (this.unitPaths.get(unit.id)?.length === 0) {
              console.log(`[TurnManager] 🎯 Unit ${unit.id} completed GoTo path - destination reached!`);
              this.clearUnitPath(unit.id);
            }
          } else {
            console.log(`[TurnManager] ❌ Animated path failed for unit ${unit.id}`);
          }
        } catch (error) {
          console.error(`[TurnManager] Error in animated GoTo for unit ${unit.id}:`, error);
        }
      } else {
        // Use instant movement for AI players
        let safety = 0;
        while ((unit.movesRemaining || 0) > 0 && path.length > 0 && safety < 100) {
          safety++;
          const next = path[0];
          const result = this.gameEngine.moveUnit(unit.id, next.col, next.row);
          if (result?.success) {
            path.shift();
            console.log(`[TurnManager] ✅ Unit ${unit.id} moved to (${next.col}, ${next.row}), ${path.length} steps remaining in path`);
            // Pace automated AI movement so visible enemy moves animate instead
            // of teleporting. No-op (and instant) when animations are disabled.
            await awaitPendingAnimations();
          } else {
            console.log(`[TurnManager] ❌ Path step failed for unit ${unit.id}, reason=${result?.reason}`);
            // Only clear path if blocked, not if just out of moves
            if (result?.reason !== 'no_moves' && result?.reason !== 'insufficient_moves') {
              console.log(`[TurnManager] 🚫 Clearing path due to blocking issue`);
              this.clearUnitPath(unit.id);
            }
            break;
          }
        }
        
        // Only clear path if actually completed (reached destination)
        if (path.length === 0) {
          console.log(`[TurnManager] 🎯 Unit ${unit.id} completed GoTo path - destination reached!`);
          this.clearUnitPath(unit.id);
        } else {
          console.log(`[TurnManager] ⏸️ Unit ${unit.id} path incomplete: ${path.length} steps remaining, will continue next turn`);
        }
      }
    }
    
    if (unitsWithPaths.length === 0) {
      console.log(`[TurnManager] No units with active GoTo paths for civ ${civilizationId}`);
    }
    } finally {
      // Reset the flag after GoTo path processing is complete
      this.isProcessingGoToPaths = false;
    }
  }

  // --- Forced end for AI (timeout/error) ---
  private forceEndAITurn(civilizationId: number, reason: 'timeout' | 'error') {
    this.aiTurnInProgress = false;
    this.gameEngine.units.filter((u) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0)
      .forEach((u) => {
        u.movesRemaining = 0;
        u.areTurnsDone = true;
      });
    try {
      if (this.gameEngine.autoProduction?.processAutoProductionForCivilization) {
        this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);
      }
    } catch (e) {
      console.warn('[TurnManager] AutoProduction failed during forced end', e);
    }
    // Emit event for UI to clear highlights
    this.emit('AI_TURN_COMPLETE', { civilizationId, reason });
    console.log(`[TurnManager] Forced AI turn end for civ ${civilizationId} due to ${reason}`);
    this.finalizeEndPhase(civilizationId);
  }
}
