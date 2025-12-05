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

export class TurnManager {
  private gameEngine: any;
  private unitPaths: Map<string, Array<{ col: number; row: number }>>;
  private AI_MAX_TURN_MS = 30000; // timeout for AI movement phase

  private currentPlayer: number | null = null;
  private currentPhase: TurnPhase | null = null;
  private playerRegistered = false;
  private roundNumber = 0; // Tracks complete rounds (all players have played)

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
    this.unitPaths = new Map();
    console.log('[TurnManager] Initialized');
  }

  // --- Public accessors ---
  getPhase(): TurnPhase | null { return this.currentPhase; }
  getCurrentPlayer(): number | null { return this.currentPlayer; }
  getRoundNumber(): number { return this.roundNumber; }

  // --- Event helper ---
  private emit(eventType: string, data: any = {}) {
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
    this.currentPlayer = civilizationId;
    this.currentPhase = TurnPhase.START;
    this.playerRegistered = false;
    
    // Format year for display
    const currentYear = this.gameEngine.currentYear || -4000;
    const yearDisplay = this.formatYear(currentYear);
    
    console.log(`[TurnManager] Starting turn for civ ${civilizationId} | Round: ${this.roundNumber} | Year: ${yearDisplay}`);
    this.emit('TURN_START', { civilizationId, roundNumber: this.roundNumber });

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

  registerPlayer(civilizationId: number): boolean {
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
    this.advanceToPhase(TurnPhase.UNIT_MOVEMENT);
    return true;
  }

  nextPhase(): void {
    if (this.currentPlayer == null || this.currentPhase == null) return;
    switch (this.currentPhase) {
      case TurnPhase.START:
        this.advanceToPhase(TurnPhase.UNIT_MOVEMENT); break;
      case TurnPhase.UNIT_MOVEMENT:
        this.advanceToPhase(TurnPhase.CITY_PRODUCTION); break;
      case TurnPhase.CITY_PRODUCTION:
        this.advanceToPhase(TurnPhase.RESEARCH); break;
      case TurnPhase.RESEARCH:
        this.advanceToPhase(TurnPhase.END); break;
      case TurnPhase.END:
        console.log('[TurnManager] nextPhase called but already at END');
        break;
    }
  }

  private advanceToPhase(phase: TurnPhase): void {
    if (this.currentPlayer == null) return;
    this.currentPhase = phase;
    console.log(`[TurnManager] Phase -> ${phase} for civ ${this.currentPlayer}`);
    this.emit('PHASE_CHANGE', { civilizationId: this.currentPlayer, phase });

    switch (phase) {
      case TurnPhase.UNIT_MOVEMENT:
        this.processAutomatedMovements(this.currentPlayer);
        // Human movement waits for UI. AI movement triggered asynchronously below.
        const civ = this.gameEngine.civilizations?.[this.currentPlayer];
        if (civ?.isAI) this.runAIUnitMovementPhase(this.currentPlayer);
        break;
      case TurnPhase.CITY_PRODUCTION:
        this.handleCityProduction(this.currentPlayer);
        break;
      case TurnPhase.RESEARCH:
        this.handleResearch(this.currentPlayer);
        break;
      case TurnPhase.END:
        this.finalizeEndPhase(this.currentPlayer);
        break;
      case TurnPhase.START:
        // Should not be re-entered via advanceToPhase
        break;
    }
  }

  // --- Phase handlers ---
  private runAIUnitMovementPhase(civilizationId: number) {
    console.log(`[TurnManager] AI movement phase for civ ${civilizationId}`);
    if (!this.gameEngine.processAITurn) {
      this.nextPhase();
      return;
    }
    const promise = this.gameEngine.processAITurn(civilizationId);
    if (!promise || typeof promise.then !== 'function') {
      console.warn('[TurnManager] AI processAITurn not promise-based; skipping to production');
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
      // After AI movement, move to next phase
      this.nextPhase(); // CITY_PRODUCTION
      this.nextPhase(); // RESEARCH
      this.nextPhase(); // END
    }).catch(err => {
      if (finished) return;
      finished = true; clearTimeout(timeoutHandle);
      console.error('[TurnManager] AI movement error:', err);
      this.forceEndAITurn(civilizationId, 'error');
    });
  }

  private handleCityProduction(civilizationId: number) {
    console.log(`[TurnManager] City production phase for civ ${civilizationId}`);
    try {
      const civ = this.gameEngine.civilizations?.[civilizationId];
      if (civ?.isAI && this.gameEngine.autoProduction) {
        this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);
      }
      this.emit('CITY_PRODUCTION_PHASE', { civilizationId });
    } catch (e) {
      console.warn('[TurnManager] City production error', e);
    }
  }

  private handleResearch(civilizationId: number) {
    console.log(`[TurnManager] Research phase for civ ${civilizationId}`);
    // Placeholder: integrate tech progression selection
    this.emit('RESEARCH_PHASE', { civilizationId });
  }

  private finalizeEndPhase(civilizationId: number) {
    console.log(`[TurnManager] Finalizing end phase for civ ${civilizationId}`);
    
    // Emit event for UI to clear highlights and selection
    this.emit('TURN_END', { civilizationId, roundNumber: this.roundNumber });
    
    // Now advance to the next player's turn
    this.advanceTurn();
  }

  /**
   * Advance to the next player's turn.
   * When all active players have had their turn, a new round begins and the year advances.
   * This is the core turn management logic - no external calls needed.
   */
  advanceTurn(): void {
    console.log('[TurnManager] advanceTurn: Advancing from player', this.currentPlayer);
    
    const previousPlayer = this.currentPlayer;
    
    // Get only active (alive) civilizations
    const activeCivs = this.gameEngine.civilizations?.filter((civ: any) => civ.isAlive !== false) || [];
    const numActiveCivs = activeCivs.length;
    
    if (numActiveCivs === 0) {
      console.error('[TurnManager] advanceTurn: No active civilizations found');
      return;
    }
    
    // Find current player's index in active civs and move to next
    const currentActiveIndex = activeCivs.findIndex((civ: any) => civ.id === previousPlayer);
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
      
      console.log(`[TurnManager] ═══════════════════════════════════════════════`);
      console.log(`[TurnManager] NEW ROUND ${this.roundNumber} | Year: ${this.formatYear(this.gameEngine.currentYear)}`);
      console.log(`[TurnManager] ═══════════════════════════════════════════════`);
      
      // Sync turn and year to the store
      if (this.gameEngine.storeActions) {
        this.gameEngine.storeActions.updateGameState({
          currentTurn: this.roundNumber,
          currentYear: this.gameEngine.currentYear
        });
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
    const UNIT_PROPS = (this.gameEngine.constructor as any).UNIT_PROPS || (globalThis as any).UNIT_PROPS;
    const units = this.gameEngine.units.filter((u: any) => u.civilizationId === playerId);
    
    console.log(`[TurnManager] Resetting moves for ${units.length} units of player ${playerId}`);
    
    units.forEach((unit: any) => {
      const unitProps = UNIT_PROPS?.[unit.type];
      unit.movesRemaining = unitProps?.movement || 1;
      unit.areTurnsDone = false;
    });
  }

  /**
   * Process turn events: city production, purchases, research
   */
  private processTurnEvents(playerId: number): void {
    console.log(`[TurnManager] Processing turn events for player ${playerId}`);
    
    // Process purchased items from previous turn
    this.gameEngine.cities?.forEach((city: any) => {
      if (city.purchasedThisTurn && city.purchasedThisTurn.length > 0) {
        city.purchasedThisTurn.forEach((item: any) => {
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
    const playerCities = this.gameEngine.cities?.filter((c: any) => c.civilizationId === playerId) || [];
    
    playerCities.forEach((city: any) => {
      this.processCityProduction(city);
      this.processCityGrowth(city);
    });

    // Process civilization resources and research
    const civ = this.gameEngine.civilizations[playerId];
    if (civ) {
      this.processCivilizationResources(civ);
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

  private createPurchasedUnit(city: any, item: any): void {
    const UNIT_PROPS = (this.gameEngine.constructor as any).UNIT_PROPS || (globalThis as any).UNIT_PROPS;
    const unitType = item.itemType;
    const unitProps = UNIT_PROPS?.[unitType] || { movement: 1 };
    
    const unit = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: unitType,
      civilizationId: city.civilizationId,
      col: city.col,
      row: city.row,
      health: 100,
      movement: unitProps.movement,
      movesRemaining: unitProps.movement,
      homeCityId: city.id
    };

    this.gameEngine.units.push(unit);
    console.log(`[TurnManager] Created purchased unit ${unit.type} at city ${city.name}`);
    
    this.emit('UNIT_PURCHASED', { cityId: city.id, unit });
  }

  private processCityProduction(city: any): void {
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
      const before = city.productionStored;
      city.productionStored += city.yields.production;
      city.productionProgress = city.productionStored;

      if (city.productionStored >= city.currentProduction.cost) {
        this.completeProduction(city);
      }
    }
  }

  private completeProduction(city: any): void {
    console.log(`[TurnManager] City ${city.name} completed production: ${city.currentProduction.type} ${city.currentProduction.itemType}`);
    
    city.productionStored = 0;
    city.productionProgress = 0;

    if (city.currentProduction.type === 'unit') {
      this.createProducedUnit(city, city.currentProduction.itemType);
    } else if (city.currentProduction.type === 'building') {
      this.addBuildingToCity(city, city.currentProduction.itemType, false);
    }

    // Advance queue if present
    if (Array.isArray(city.buildQueue) && city.buildQueue.length > 0) {
      city.currentProduction = city.buildQueue.shift();
      city.productionProgress = 0;
    } else {
      city.currentProduction = null;
    }
  }

  private createProducedUnit(city: any, unitType: string): void {
    const UNIT_PROPS = (this.gameEngine.constructor as any).UNIT_PROPS || (globalThis as any).UNIT_PROPS;
    const unitProps = UNIT_PROPS?.[unitType] || { movement: 1 };
    
    const unit = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: unitType,
      civilizationId: city.civilizationId,
      col: city.col,
      row: city.row,
      health: 100,
      movement: unitProps.movement,
      movesRemaining: unitProps.movement,
      homeCityId: city.id
    };

    this.gameEngine.units.push(unit);
    console.log(`[TurnManager] Created unit ${unit.type} at city ${city.name}`);
    
    this.emit('UNIT_PRODUCED', { cityId: city.id, unit });
  }

  private addBuildingToCity(city: any, buildingType: string, isPurchased: boolean): void {
    if (!city.buildings) city.buildings = [];
    city.buildings.push(buildingType);
    
    console.log(`[TurnManager] Added ${isPurchased ? 'purchased' : 'produced'} building ${buildingType} to city ${city.name}`);
    
    this.emit(isPurchased ? 'BUILDING_PURCHASED' : 'BUILDING_COMPLETED', { 
      cityId: city.id, 
      buildingType 
    });
  }

  private processCityGrowth(city: any): void {
    city.foodStored += city.yields.food;
    
    if (city.foodStored >= city.foodNeeded) {
      city.population++;
      city.foodStored = 0;
      city.foodNeeded = city.population * 20;
      console.log(`[TurnManager] City ${city.name} grew to population ${city.population}`);
    }
  }

  private processCivilizationResources(civ: any): void {
    try {
      if (civ.resources && this.gameEngine.calculateCivScience && this.gameEngine.calculateCivGold) {
        civ.resources.science += this.gameEngine.calculateCivScience(civ.id);
        civ.resources.gold += this.gameEngine.calculateCivGold(civ.id);
      }
    } catch (e) {
      console.warn('[TurnManager] Error processing civilization resources', e);
    }
  }

  private processCivilizationResearch(civ: any): void {
    try {
      if (civ.currentResearch && civ.resources && civ.resources.science > 0) {
        civ.researchProgress = (civ.researchProgress || 0) + civ.resources.science;
        
        const TECHNOLOGIES = (this.gameEngine.constructor as any).TECHNOLOGIES || (globalThis as any).TECHNOLOGIES;
        const techCost = typeof civ.currentResearch === 'object' && civ.currentResearch.cost 
          ? civ.currentResearch.cost 
          : (TECHNOLOGIES?.[civ.currentResearch]?.cost || 0);
        
        if (civ.researchProgress >= techCost && techCost > 0) {
          if (Array.isArray(civ.technologies)) {
            civ.technologies.push(civ.currentResearch.id || civ.currentResearch);
          }
          civ.researchProgress = 0;
          civ.currentResearch = null;
          
          if (this.gameEngine.updateTechnologyAvailability) {
            this.gameEngine.updateTechnologyAvailability();
          }
          
          console.log(`[TurnManager] Civilization ${civ.name} completed research`);
        }
      }
    } catch (e) {
      console.warn('[TurnManager] Error processing research', e);
    }
  }

  // --- Automated movement (path following) ---
  private processAutomatedMovements(civilizationId: number): void {
    const unitsWithPaths = Array.from(this.unitPaths.entries())
      .filter(([unitId]) => {
        const unit = this.gameEngine.units.find((u: any) => u.id === unitId);
        return unit && unit.civilizationId === civilizationId;
      });
    
    console.log(`[TurnManager] 🚀 Processing automated GoTo paths for civ ${civilizationId}`);
    console.log(`[TurnManager] Found ${unitsWithPaths.length} units with GoTo paths`);
    
    const units = this.gameEngine.units.filter((u: any) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0);
    
    for (const unit of units) {
      const path = this.unitPaths.get(unit.id);
      if (!path || path.length === 0) continue;
      
      console.log(`[TurnManager] ➡️ Unit ${unit.id} (${unit.type}) has GoTo path with ${path.length} steps, ${unit.movesRemaining} moves remaining`);
      
      let safety = 0;
      while ((unit.movesRemaining || 0) > 0 && path.length > 0 && safety < 100) {
        safety++;
        const next = path[0];
        const result = this.gameEngine.moveUnit(unit.id, next.col, next.row);
        if (result?.success) {
          path.shift();
          console.log(`[TurnManager] ✅ Unit ${unit.id} moved to (${next.col}, ${next.row}), ${path.length} steps remaining in path`);
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
    
    if (unitsWithPaths.length === 0) {
      console.log(`[TurnManager] No units with active GoTo paths for civ ${civilizationId}`);
    }
  }

  // --- Forced end for AI (timeout/error) ---
  private forceEndAITurn(civilizationId: number, reason: 'timeout' | 'error') {
    this.gameEngine.units.filter((u: any) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0)
      .forEach((u: any) => {
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