import { Unit } from '../../../types/game';

/**
 * KeyboardHandler - Manages keyboard input for unit actions
 */
export class KeyboardHandler {
  private gameEngine: any;
  private actions: any;
  private getSelectedUnit: () => Unit | null;
  private getAllUnits: () => Unit[];
  private isMinimapMode: () => boolean;

  constructor(
    gameEngine: any,
    actions: any,
    getSelectedUnit: () => Unit | null,
    getAllUnits: () => Unit[],
    isMinimapMode: () => boolean
  ) {
    this.gameEngine = gameEngine;
    this.actions = actions;
    this.getSelectedUnit = getSelectedUnit;
    this.getAllUnits = getAllUnits;
    this.isMinimapMode = isMinimapMode;
    
    console.log('[KeyboardHandler] Initialized');
  }

  /**
   * Handle keyboard events for unit actions
   */
  handleKeyDown = (event: KeyboardEvent): boolean => {
    console.log('[KeyboardHandler] Key pressed:', event.key, 'Target:', event.target);
    
    // Don't handle if user is typing in an input field
    if (event.target instanceof HTMLInputElement || 
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.contentEditable === 'true')) {
      console.log('[KeyboardHandler] Ignoring - user typing in input field');
      return false;
    }

    // Skip if in minimap mode
    if (this.isMinimapMode()) {
      console.log('[KeyboardHandler] Skipping - minimap mode');
      return false;
    }

    const selectedUnit = this.getSelectedUnit();
    console.log('[KeyboardHandler] Selected unit:', selectedUnit);
    
    if (!selectedUnit) {
      console.log('[KeyboardHandler] No unit selected');
      return false;
    }
    
    // Verify unit belongs to current player
    const currentPlayer = this.gameEngine?.civilizations?.[this.gameEngine?.activePlayer];
    if (selectedUnit.civilizationId !== currentPlayer?.id) {
      console.log('[KeyboardHandler] Unit does not belong to current player');
      return false;
    }

    let handled = false;

    switch (event.key.toLowerCase()) {
      case 'i':
        // Irrigate
        handled = this.handleIrrigate(selectedUnit);
        if (handled) event.preventDefault();
        break;
        
      case 'm':
        // Mine
        handled = this.handleMine(selectedUnit);
        if (handled) event.preventDefault();
        break;
        
      case 'b':
        // Build road
        handled = this.handleBuildRoad(selectedUnit);
        if (handled) event.preventDefault();
        break;
        
      case 'f':
        // Fortify
        handled = this.handleFortify(selectedUnit);
        if (handled) event.preventDefault();
        break;
        
      case 's':
        // Skip turn
        handled = this.handleSkipTurn(selectedUnit);
        if (handled) event.preventDefault();
        break;
        
      case 'g':
        // GoTo mode (handled elsewhere, just acknowledge)
        console.log('[KeyboardHandler] GoTo mode - handled by GameCanvas');
        handled = false; // Let other handlers process this
        break;
    }

    return handled;
  };

  /**
   * Handle irrigate action
   */
  private handleIrrigate(unit: Unit): boolean {
    console.log('[KeyboardHandler] Irrigate command - Building irrigation at', unit.col, unit.row);
    console.log('[KeyboardHandler] GameEngine available:', !!this.gameEngine);
    console.log('[KeyboardHandler] buildImprovement method:', typeof this.gameEngine?.buildImprovement);
    
    if (this.gameEngine?.buildImprovement) {
      console.log('[KeyboardHandler] Calling buildImprovement for unit', unit.id);
      const result = this.gameEngine.buildImprovement(unit.id, 'irrigation');
      console.log('[KeyboardHandler] buildImprovement result:', result);
      
      if (result) {
        console.log('[KeyboardHandler] Irrigation built successfully');
        this.updateGameState();
        this.showNotification('success', 'Irrigation built');
        return true;
      } else {
        console.log('[KeyboardHandler] Cannot irrigate here');
        this.showNotification('warning', 'Cannot irrigate here');
        return false;
      }
    } else {
      console.error('[KeyboardHandler] buildImprovement method not available on gameEngine');
      return false;
    }
  }

  /**
   * Handle mine action
   */
  private handleMine(unit: Unit): boolean {
    console.log('[KeyboardHandler] Mine command');
    if (this.gameEngine?.buildImprovement) {
      const result = this.gameEngine.buildImprovement(unit.id, 'mine');
      console.log('[KeyboardHandler] Mine build result:', result);
      if (result) {
        this.updateGameState();
        this.showNotification('success', 'Mine built');
        return true;
      } else {
        this.showNotification('warning', 'Cannot build mine here');
        return false;
      }
    }
    return false;
  }

  /**
   * Handle build road action
   */
  private handleBuildRoad(unit: Unit): boolean {
    console.log('[KeyboardHandler] Build road command');
    if (this.gameEngine?.buildImprovement) {
      const result = this.gameEngine.buildImprovement(unit.id, 'road');
      console.log('[KeyboardHandler] Road build result:', result);
      if (result) {
        this.updateGameState();
        this.showNotification('success', 'Road built');
        return true;
      } else {
        this.showNotification('warning', 'Cannot build road here');
        return false;
      }
    }
    return false;
  }

  /**
   * Handle fortify action
   */
  private handleFortify(unit: Unit): boolean {
    console.log('[KeyboardHandler] Fortify command');
    if (this.gameEngine?.fortifyUnit) {
      const result = this.gameEngine.fortifyUnit(unit.id);
      console.log('[KeyboardHandler] Fortify result:', result);
      if (result) {
        this.updateGameState();
        this.showNotification('success', 'Unit fortified');
        return true;
      } else {
        this.showNotification('warning', 'Cannot fortify unit');
        return false;
      }
    }
    return false;
  }

  /**
   * Handle skip turn action
   */
  private handleSkipTurn(unit: Unit): boolean {
    console.log('[KeyboardHandler] Skip turn command');
    if (this.gameEngine?.skipUnit) {
      const result = this.gameEngine.skipUnit(unit.id);
      console.log('[KeyboardHandler] Skip result:', result);
      if (result !== false) {
        this.updateGameState();
        this.showNotification('info', 'Unit turn skipped');
        return true;
      }
    }
    return false;
  }

  /**
   * Update game state after action
   */
  private updateGameState(): void {
    if (this.actions?.updateUnits) {
      const updatedUnits = this.getAllUnits();
      console.log('[KeyboardHandler] Updating units:', updatedUnits.length);
      this.actions.updateUnits(updatedUnits);
    }
    if (this.actions?.updateMap && this.gameEngine) {
      console.log('[KeyboardHandler] Updating map');
      this.actions.updateMap(this.gameEngine.map);
    }
  }

  /**
   * Show notification to user
   */
  private showNotification(type: string, message: string): void {
    if (this.actions?.addNotification) {
      this.actions.addNotification({ type, message });
    }
  }

  /**
   * Clean up event listeners
   */
  dispose(): void {
    console.log('[KeyboardHandler] Disposed');
  }
}
