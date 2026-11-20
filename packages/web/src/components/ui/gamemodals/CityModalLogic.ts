/// <reference types="vite/client" />

import { ModalUtils } from './ModalUtils';
import {CityUtils} from "@shared/utils/CityUtils";
import { FISHER_BOAT_STORAGE, fisherCatchValue, fisherFoodPerFish } from '@shared/data/UnitConstants';
import type { City, Civilization, ProductionItem, TradeRoute, Unit } from '@shared/types/game';
import GameEngine from '@shared/game/engine/GameEngine';
import { sendCommand } from '../../../session';

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

  /**
   * Fisher Boat status for this city (max one per city). Returns the boat
   * bound to the city — alive at sea (with its route stage and hold) or under
   * construction — plus the distance-based catch value of its fishing ground.
   */
  getFisherBoatStatus(): {
    exists: boolean;
    underConstruction: boolean;
    stage: 'outbound' | 'fishing' | 'inbound' | null;
    fishStored: number;
    capacity: number;
    tile: { col: number; row: number } | null;
    distance: number;
    foodPerFish: number;
    catchValue: number;
  } {
    const capacity = FISHER_BOAT_STORAGE;
    const base = {
      exists: false,
      underConstruction: false,
      stage: null as 'outbound' | 'fishing' | 'inbound' | null,
      fishStored: 0,
      capacity,
      tile: null as { col: number; row: number } | null,
      distance: 0,
      foodPerFish: 1,
      catchValue: capacity,
    };

    const boat = this.gameEngine?.units?.find(
      (u) => u.type === 'fisher_boat' && u.homeCityId === this.city.id && !u.isDefeated,
    );
    if (boat) {
      const route = boat.fishingRoute ?? null;
      const tile = route?.fishingTile ?? { col: boat.col, row: boat.row };
      const distance = this.gameEngine.squareGrid?.chebyshevDistance
        ? this.gameEngine.squareGrid.chebyshevDistance(
            this.city.col,
            this.city.row,
            tile.col,
            tile.row,
          )
        : Math.max(Math.abs(this.city.col - tile.col), Math.abs(this.city.row - tile.row));
      return {
        ...base,
        exists: true,
        stage: route?.stage ?? null,
        fishStored: boat.fishStored ?? 0,
        tile,
        distance,
        foodPerFish: fisherFoodPerFish(distance),
        catchValue: fisherCatchValue(distance),
      };
    }

    const underConstruction =
      String(this.city.currentProduction?.itemType ?? '') === 'fisher_boat'
      || (this.city.buildQueue ?? []).some(
        (q) => String((q as ProductionItem | undefined)?.itemType ?? '') === 'fisher_boat',
      );
    return { ...base, underConstruction };
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

  private async productionResult(
    result: Awaited<ReturnType<typeof sendCommand>>,
  ): Promise<{ success: boolean; reason?: string }> {
    if (result.ok === false) return { success: false, reason: result.reason };
    if (!('production' in result)) return { success: false, reason: 'UNKNOWN_COMMAND' };
    return { success: result.production.success, reason: result.production.reason };
  }

  async purchaseProduction(item: ProductionItem): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'PURCHASE_PRODUCTION', cityId: this.city.id, item }),
    );
  }

  async setProduction(item: ProductionItem, queue: boolean = false): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'SET_CITY_PRODUCTION', cityId: this.city.id, item, queue }),
    );
  }

  async removeQueueItem(index: number): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'REMOVE_QUEUE_ITEM', cityId: this.city.id, index }),
    );
  }

  async moveQueueItem(fromIndex: number, toIndex: number): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'MOVE_QUEUE_ITEM', cityId: this.city.id, fromIndex, toIndex }),
    );
  }

  /**
   * Promote a queued item to be produced right now. Queue entry #1 swaps with
   * the current production (which moves one slot down and keeps its progress).
   */
  async promoteQueueItem(index: number): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'PROMOTE_QUEUE_ITEM', cityId: this.city.id, index }),
    );
  }

  /**
   * Postpone the item being produced: it swaps places with the first queued
   * item. Returns the engine result so the UI can explain a refusal.
   */
  async moveCurrentProductionDown(): Promise<{ success: boolean; reason?: string }> {
    return this.productionResult(
      await sendCommand({ type: 'MOVE_CURRENT_PRODUCTION_DOWN', cityId: this.city.id }),
    );
  }

  /**
   * Unit types this city could start building. Delegates to the engine so the
   * UI, the purchase modal and the auto-end "idle city" gate all agree.
   */
  getAvailableProductionKeys(): string[] {
    if (this.gameEngine?.productionManager) {
      return this.gameEngine.productionManager.getBuildableUnitTypes(this.city.id);
    }
    return [];
  }

  /**
   * The engine's full gate for ONE unit in this city: `ok` only when every
   * requirement holds — required tech, required BUILDING (the Fisher Boat
   * needs its Harbor), the naval water-access rule and the per-city cap
   * (one Fisher Boat, max 3 in-transit Caravans come from the UI itself).
   * `reason` is the machine-readable rejection code, so the production modal
   * can grey a row out with the exact sentence the engine would answer.
   */
  canBuildUnit(itemType: string): { ok: boolean; reason?: string } {
    const pm = this.gameEngine?.productionManager;
    if (typeof pm?.canBuildItemType !== 'function') return { ok: true };
    return pm.canBuildItemType(this.city.id, itemType);
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
    const base = CityUtils.calculateCityResources(this.city, this.currentPlayer);
    // The engine owns the authoritative food math (citizens eat 2 each, the
    // city's own settlers eat 1–2 more). Show exactly those numbers so the
    // modal can never disagree with the growth pipeline.
    const balance = this.gameEngine?.economicManager?.cityFoodBalance?.(
      this.city,
      this.currentPlayer,
    );
    if (!balance) return base;
    return {
      ...base,
      food: {
        ...base.food,
        produced: balance.produced,
        // "Needs" is what the city actually eats, settler support included.
        needed: balance.citizenConsumption + balance.settlerSupport,
        surplus: balance.surplus,
        storage: balance.storage,
        growthThreshold: balance.growthThreshold,
        granaryLine: balance.granaryLine,
        hasGranary: balance.hasGranary,
        turnsUntilGrowth: balance.turnsUntilGrowth,
        turnsUntilStarvation: balance.turnsUntilStarvation,
        population: this.city.population ?? 1,
      },
    };
  }

  getTradeRoutes(): TradeRoute[] {
    return Array.isArray(this.city.tradeRoutes) ? this.city.tradeRoutes : [];
  }

  /** Total per-turn trade contributed by this city's permanent trade routes. */
  getRouteTrade(): number {
    return this.getTradeRoutes().reduce((total: number, r: TradeRoute) => total + (r.trade ?? 0), 0);
  }

  /**
   * Units IN this city for the city screen's Units tab: only the units
   * standing on the city tile (the garrison, plus a settler/boat that is
   * sitting in the city). Units that merely have this city as their home city
   * but are out on the map are NOT listed here — that is the turn queue's
   * business, not the city's. Defeated units are excluded.
   */
  getCityUnits(): Unit[] {
    const units = this.gameEngine?.units ?? [];
    return units.filter(
      (u: Unit) =>
        !!u &&
        u.civilizationId === this.city.civilizationId &&
        u.col === this.city.col &&
        u.row === this.city.row &&
        u.isDefeated !== true,
    );
  }
}