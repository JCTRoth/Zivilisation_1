/// <reference types="vite/client" />

import { ModalUtils } from './ModalUtils';
import { UNIT_PROPS } from '@/utils/Constants';
import {CityUtils} from "@/utils/CityUtils";
import type { City, Civilization, ProductionItem, TradeRoute } from '../../../../types/game';
import GameEngine from '@/game/engine/GameEngine';

export class CityModalLogic {
  private readonly city: City;
  private readonly gameEngine: GameEngine;
  private readonly currentPlayer: Civilization;

  constructor(city: City, gameEngine: GameEngine, _actions: unknown, currentPlayer: Civilization) {
    this.city = city;
    this.gameEngine = gameEngine;
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

  getQueueItems(): ProductionItem[] {
    return this.city.buildQueue || [];
  }

  canPurchase(item: ProductionItem): boolean {
    // Check if city has already purchased something this turn
    const purchasedThisTurn = this.city.purchasedThisTurn || [];
    if (purchasedThisTurn.length > 0) {
      return false;
    }
    
    // Check if civilization has enough gold
    const civ = this.gameEngine?.civilizations?.[this.city.civilizationId];
    if (!civ || !civ.resources) return false;
    
    const cost = item.cost || (item.shields || 0);
    return (civ.resources.gold || 0) >= cost;
  }

  purchaseProduction(item: ProductionItem): void {
    if (this.gameEngine && this.gameEngine.purchaseCityProduction) {
      this.gameEngine.purchaseCityProduction(this.city.id, item);
    }
  }

  setProduction(item: ProductionItem, queue: boolean = false): { success: boolean; reason?: string } {
    if (this.gameEngine && this.gameEngine.productionManager) {
      return this.gameEngine.productionManager.setCityProduction(this.city.id, item, queue);
    }
    return { success: false, reason: 'production_manager_unavailable' };
  }

  removeQueueItem(index: number): void {
    if (this.gameEngine && this.gameEngine.productionManager) {
      this.gameEngine.productionManager.removeCityQueueItem(this.city.id, index);
      // ProductionManager now handles updating currentProduction automatically
    }
  }

  moveQueueItem(fromIndex: number, toIndex: number): void {
    if (this.gameEngine && this.gameEngine.productionManager) {
      this.gameEngine.productionManager.moveCityQueueItem(this.city.id, fromIndex, toIndex);
    }
  }

  getAvailableProductionKeys(): string[] {
    return Object.keys(UNIT_PROPS).filter((key) => {
      const u = UNIT_PROPS[key];
      const req = u.requires || null;
      if (req && this.currentPlayer && Array.isArray(this.currentPlayer.technologies)) {
        // Handle both single requirement and array of requirements
        const requirements = Array.isArray(req) ? req : [req];
        const hasAllRequiredTechs = requirements.every((tech: string) => this.currentPlayer.technologies!.includes(tech));
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
    const map = this.gameEngine.map as unknown as { getTile?(col: number, row: number): { terrain: string } | undefined };
    if (!this.gameEngine || !map || !map.getTile) return false;
    
    const directions = [
      { col: 0, row: 0 }, // city tile itself
      { col: -1, row: -1 }, { col: 0, row: -1 }, { col: 1, row: -1 },
      { col: -1, row: 0 }, { col: 1, row: 0 },
      { col: -1, row: 1 }, { col: 0, row: 1 }, { col: 1, row: 1 }
    ];
    
    for (const dir of directions) {
      const tile = map.getTile(this.city.col + dir.col, this.city.row + dir.row);
      if (tile && tile.terrain === 'ocean') {
        return true;
      }
    }
    return false;
  }

  canAffordBuyNow(itemType: string): boolean {
    // Check if city has already purchased something this turn
    const purchasedThisTurn = this.city.purchasedThisTurn || [];
    if (purchasedThisTurn.length > 0) {
      return false;
    }
    
    const item: ProductionItem = { type: 'unit', itemType, name: itemType, cost: 0 };
    const cost = ModalUtils.getProductionCost(item);
    const playerGold = this.currentPlayer?.resources?.gold || 0;
    return playerGold >= cost;
  }

  getCityResources() {
    return CityUtils.calculateCityResources(this.city, this.currentPlayer);
  }

  getTradeRoutes(): TradeRoute[] {
    return Array.isArray(this.city.tradeRoutes) ? this.city.tradeRoutes : [];
  }

  /** Total per-turn trade contributed by this city's permanent trade routes. */
  getRouteTrade(): number {
    return this.getTradeRoutes().reduce((total: number, r: TradeRoute) => total + (r.trade ?? 0), 0);
  }
}