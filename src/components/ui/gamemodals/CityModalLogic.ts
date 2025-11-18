/// <reference types="vite/client" />

import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS } from '@/utils/Constants';
import { CityUtils } from '@/utils/Helpers';

export class CityModalLogic {
  private readonly city: any;
  private readonly gameEngine: any;
  private actions: any;
  private readonly currentPlayer: any;

  constructor(city: any, gameEngine: any, actions: any, currentPlayer: any) {
    this.city = city;
    this.gameEngine = gameEngine;
    this.actions = actions;
    this.currentPlayer = currentPlayer;
  }

  getProductionPerTurn(): number {
    return ModalUtils.getProductionPerTurn(this.city);
  }

  getProductionProgressValue(): number {
    return ModalUtils.getProductionProgressValue(this.city);
  }

  getCurrentProductionCost(): number {
    return ModalUtils.getProductionCost(this.city.currentProduction);
  }

  getCurrentProductionName(): string {
    return ModalUtils.getProductionName(this.city.currentProduction);
  }

  getProgressPercent(): number {
    const progress = this.getProductionProgressValue();
    const cost = this.getCurrentProductionCost();
    if (cost > 0) {
      return Math.min(100, Math.round((progress / cost) * 100));
    }
    return 0;
  }

  getTurnsRemaining(): number | null {
    const progress = this.getProductionProgressValue();
    const cost = this.getCurrentProductionCost();
    const perTurn = this.getProductionPerTurn();
    return ModalUtils.getTurnsRemaining(progress, cost, perTurn);
  }

  getFormattedTurns(): string {
    return ModalUtils.formatTurns(this.getTurnsRemaining());
  }

  hasQueueItems(): boolean {
    return Array.isArray(this.city.buildQueue) && this.city.buildQueue.length > 0;
  }

  getQueueItems(): any[] {
    return this.city.buildQueue || [];
  }

  canPurchase(item: any): boolean {
    // Check if city has already purchased something this turn
    const purchasedThisTurn = (this.city as any).purchasedThisTurn || [];
    if (purchasedThisTurn.length > 0) {
      return false;
    }
    
    // Check if civilization has enough gold
    const civ = this.gameEngine?.civilizations?.[this.city.civilizationId];
    if (!civ || !civ.resources) return false;
    
    const cost = item.cost || (item.shields || 0);
    return (civ.resources.gold || 0) >= cost;
  }

  purchaseProduction(item: any): void {
    if (this.gameEngine && this.gameEngine.purchaseCityProduction) {
      this.gameEngine.purchaseCityProduction(this.city.id, item);
    }
  }

  setProduction(item: any, queue: boolean = false): void {
    if (this.gameEngine && this.gameEngine.setCityProduction) {
      this.gameEngine.setCityProduction(this.city.id, item, queue);
    }
  }

  removeQueueItem(index: number): void {
    if (this.gameEngine && this.gameEngine.removeCityQueueItem) {
      this.gameEngine.removeCityQueueItem(this.city.id, index);
    }
  }

  getAvailableProductionKeys(): string[] {
    return Object.keys(UNIT_PROPS).filter((key) => {
      const u = UNIT_PROPS[key];
      const req = (u as any).requires || null;
      if (req && this.currentPlayer && Array.isArray(this.currentPlayer.technologies)) {
        // Handle both single requirement and array of requirements
        const requirements = Array.isArray(req) ? req : [req];
        const hasAllRequiredTechs = requirements.every((tech: string) => this.currentPlayer.technologies.includes(tech));
        if (!hasAllRequiredTechs) return false;
      }

      if (u.naval && this.city) {
        // Check if city has harbor or is coastal (tile or adjacent tiles are water)
        const hasHarbor = this.city.buildings && this.city.buildings.includes('harbor');
        if (!hasHarbor) {
          const isCoastal = this.checkIfCityIsCoastal();
          if (!isCoastal) return false;
        }
      }

      return true;
    });
  }

  private checkIfCityIsCoastal(): boolean {
    if (!this.gameEngine || !this.gameEngine.map || !this.gameEngine.map.getTile) return false;
    
    const directions = [
      { col: 0, row: 0 }, // city tile itself
      { col: -1, row: -1 }, { col: 0, row: -1 }, { col: 1, row: -1 },
      { col: -1, row: 0 }, { col: 1, row: 0 },
      { col: -1, row: 1 }, { col: 0, row: 1 }, { col: 1, row: 1 }
    ];
    
    for (const dir of directions) {
      const tile = this.gameEngine.map.getTile(this.city.col + dir.col, this.city.row + dir.row);
      if (tile && (tile.terrain === 'ocean' || tile.terrain === 'coast')) {
        return true;
      }
    }
    return false;
  }

  canAffordBuyNow(itemType: string): boolean {
    // Check if city has already purchased something this turn
    const purchasedThisTurn = (this.city as any).purchasedThisTurn || [];
    if (purchasedThisTurn.length > 0) {
      return false;
    }
    
    const item = { itemType };
    const cost = ModalUtils.getProductionCost(item);
    const playerGold = this.currentPlayer?.resources?.gold || 0;
    return playerGold >= cost;
  }

  getCityResources() {
    return CityUtils.calculateCityResources(this.city, this.currentPlayer);
  }
}