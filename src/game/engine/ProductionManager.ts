/**
 * Production Manager - Handles city production, purchasing, and queuing
 */

import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import type { City, Civilization } from '../../../types/game';
import GameEngine from './GameEngine';

/** A production item that can be queued in a city's build queue. */
interface ProductionItem {
  // Matches types/game.ProductionItem — built dynamically with string types.
  type: string;
  itemType: string;
  name: string;
  cost: number;
  shields?: number;
}

/** Result of a production manager operation. */
interface ProductionResult {
  success: boolean;
  reason?: string;
  city?: City;
  removed?: ProductionItem;
  moved?: ProductionItem;
}

export class ProductionManager {
  private gameEngine: GameEngine;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  /**
   * Tech-gating: return false when the city's owner hasn't researched the
   * technology required to build/produce the item. Enforced on EVERY
   * production path (UI modal, purchase, auto-production, queueing) so an
   * item requiring an unresearched tech can never be produced.
   */
  private canBuildItem(cityId: string, item: ProductionItem | string): { ok: boolean; reason?: string } {
    try {
      const city: City | undefined = this.gameEngine.cities?.find((c) => c.id === cityId)
        || (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function' && (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId))
        || undefined;
      if (!city) return { ok: true }; // City not found — don't block in validation
      const civ: Civilization | undefined = this.gameEngine.civilizations?.[city.civilizationId];
      const techs = new Set<string>();
      const rawTechs = civ?.technologies;
      if (Array.isArray(rawTechs)) {
        for (const t of rawTechs) techs.add(String(t));
      } else if (rawTechs && typeof rawTechs[Symbol.iterator] === 'function') {
        for (const t of rawTechs as Iterable<string>) techs.add(String(t));
      }

      const itemType: string | null = typeof item === 'string' ? item : (item?.itemType ?? item?.type ?? null);
      if (!itemType) return { ok: true };

      // Units: required tech lives on the unit definition (`requires`).
      const unitProps = UNIT_PROPERTIES[itemType];
      if (unitProps) {
        const req: string | null | undefined = unitProps.requires ?? null;
        if (req && !techs.has(req)) {
          return { ok: false, reason: `requires_tech_${req}` };
        }
      }

      // Buildings: required tech lives on the building definition.
      const buildingProps = BUILDING_PROPERTIES[itemType];
      if (buildingProps) {
        const req: string | undefined = buildingProps.requiredTechnology;
        if (req && !techs.has(req)) {
          return { ok: false, reason: `requires_tech_${req}` };
        }
      }

      return { ok: true };
    } catch (e) {
      console.warn('[ProductionManager] canBuildItem validation error', e);
      return { ok: true };
    }
  }

  setCityProduction(cityId: string, item: ProductionItem, queue: boolean = false): ProductionResult {
    console.log('[ProductionManager] setCityProduction called', { cityId, item, queue });

    // Enforce tech requirements before anything is queued or set.
    const gate = this.canBuildItem(cityId, item);
    if (!gate.ok) {
      console.warn(`[ProductionManager] Rejected production ${item?.name ?? item?.itemType ?? item}: ${gate.reason}`);
      return { success: false, reason: gate.reason };
    }
    // Try city manager if available
    try {
      if (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function') {
        const cityRaw: City | undefined = (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId) || this.gameEngine.cities.find((c) => c.id === cityId);
          if (!cityRaw) return { success: false, reason: 'city_not_found' };
          const city = cityRaw;

          // Ensure buildQueue exists on the city instance (defensive)
          if (!Array.isArray(city.buildQueue)) city.buildQueue = [];
          console.log('[ProductionManager] After buildQueue init', { cityId, buildQueue: city.buildQueue, city });

          if (queue && typeof (city as { queueProduction?: (item: ProductionItem) => void }).queueProduction === 'function') {
            // Prevent duplicate queue entries — skip if same item already in queue
            const isDuplicate = city.buildQueue.some((q: ProductionItem) => q.itemType === item.itemType && q.type === item.type);
            if (!isDuplicate) {
              (city as { queueProduction: (item: ProductionItem) => void }).queueProduction(item);
            }
            console.log('[ProductionManager] city.queueProduction executed', { cityId, buildQueue: city.buildQueue, isDuplicate });
            // If no current production, start the first queued item with carried over progress
            if (!city.currentProduction && city.buildQueue.length > 0) {
              city.currentProduction = city.buildQueue[0];
              city.productionProgress = city.carriedOverProgress || 0;
              city.carriedOverProgress = 0;
              console.log('[ProductionManager] started queued item as currentProduction', { cityId, currentProduction: city.currentProduction, productionProgress: city.productionProgress });
            }
          } else if (!queue && typeof (city as { setProduction?: (item: ProductionItem) => void }).setProduction === 'function') {
            (city as { setProduction: (item: ProductionItem) => void }).setProduction(item);
          } else if (queue && Array.isArray(city.buildQueue)) {
            const isDuplicate = city.buildQueue.some((q: ProductionItem) => q.itemType === item.itemType && q.type === item.type);
            if (!isDuplicate) {
              city.buildQueue.push(item);
            }
            console.log('[ProductionManager] pushed to city.buildQueue', { cityId, buildQueue: city.buildQueue, isDuplicate });
            // If no current production, start the first queued item with carried over progress
            if (!city.currentProduction && city.buildQueue.length === 1) {
              city.currentProduction = item;
              city.productionProgress = city.carriedOverProgress || 0;
              city.carriedOverProgress = 0;
              console.log('[ProductionManager] started single queued item as currentProduction', { cityId, currentProduction: city.currentProduction, productionProgress: city.productionProgress });
            }
          } else if (!queue) {
            city.currentProduction = item;
            city.productionProgress = city.carriedOverProgress || 0;
            city.carriedOverProgress = 0;
          }

        // Emit state change for React
        if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_PRODUCTION_CHANGED', { cityId, item, queued: !!queue });
        return { success: true, city };
      }

      // Fallback: find in this.cities
      const cityRaw2: City | undefined = this.gameEngine.cities.find(c => c.id === cityId);
      if (!cityRaw2) return { success: false, reason: 'city_not_found' };
      const city2 = cityRaw2;

      // Ensure buildQueue exists on the fallback city
      if (!Array.isArray(city2.buildQueue)) city2.buildQueue = [];

      if (queue && Array.isArray(city2.buildQueue)) {
        const isDuplicate2 = city2.buildQueue.some((q: ProductionItem) => q.itemType === item.itemType && q.type === item.type);
        if (!isDuplicate2) {
          city2.buildQueue.push(item);
        }
        console.log('[ProductionManager] fallback pushed to city2.buildQueue', { cityId, buildQueue: city2.buildQueue, isDuplicate: isDuplicate2 });
        // If no current production, start the first queued item with carried over progress
        if (!city2.currentProduction && city2.buildQueue.length === 1) {
          city2.currentProduction = item;
          city2.productionProgress = city2.carriedOverProgress || 0;
          city2.carriedOverProgress = 0;
          console.log('[ProductionManager] fallback started queued item as currentProduction', { cityId, currentProduction: city2.currentProduction, productionProgress: city2.productionProgress });
        }
      } else {
        city2.currentProduction = item;
        city2.productionProgress = city2.carriedOverProgress || 0;
        city2.carriedOverProgress = 0;
        console.log('[ProductionManager] fallback set currentProduction', { cityId, currentProduction: city2.currentProduction, productionProgress: city2.productionProgress });
      }

      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_PRODUCTION_CHANGED', { cityId, item, queued: !!queue });
      return { success: true, city: city2 };
    } catch (e) {
      console.error('[ProductionManager] setCityProduction error', e);
      return { success: false, reason: 'exception' };
    }
  }

  purchaseCityProduction(cityId: string, item: ProductionItem, civId?: number): ProductionResult {
    try {
      console.log('[ProductionManager] purchaseCityProduction called', { cityId, item, civId });
      const city: City | undefined = this.gameEngine.cities.find(c => c.id === cityId) || (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function' ? (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId) : undefined);
      if (!city) return { success: false, reason: 'city_not_found' };

      // Purchasing must respect tech requirements too.
      const gate = this.canBuildItem(cityId, item);
      if (!gate.ok) {
        console.warn(`[ProductionManager] Rejected purchase ${item?.name ?? item?.itemType ?? item}: ${gate.reason}`);
        return { success: false, reason: gate.reason };
      }

      // Check if city has already purchased something this turn
      if (city.purchasedThisTurn && city.purchasedThisTurn.length > 0) {
        return { success: false, reason: 'already_purchased_this_turn' };
      }

      // Find civilization / owner
      const civ: Civilization | undefined = civId !== undefined ? this.gameEngine.civilizations[civId] : this.gameEngine.civilizations[city.civilizationId] || this.gameEngine.civilizations[(city as { civId?: number }).civId] || undefined;
      if (!civ || !civ.resources) return { success: false, reason: 'civ_not_found' };

      const cost: number = item.cost || (item.shields || 0);
      if ((civ.resources.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

      // Deduct gold
      civ.resources.gold -= cost;

      // Queue the purchase for next turn instead of creating immediately
      if (!city.purchasedThisTurn) city.purchasedThisTurn = [];
      city.purchasedThisTurn.push({
        type: item.type,
        itemType: item.itemType,
        name: item.name,
        cost: cost
      });

      console.log('[ProductionManager] queued purchase for next turn', { cityId, item: item.itemType });
      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_ITEM_PURCHASED', { cityId, item: item.itemType });
      return { success: true };
    } catch (e) {
      console.error('[ProductionManager] purchaseCityProduction error', e);
      return { success: false, reason: 'exception' };
    }
  }

  /**
   * Remove an item from a city's build queue by index.
   */
  removeCityQueueItem(cityId: string, index: number): ProductionResult {
    try {
      console.log('[ProductionManager] removeCityQueueItem called', { cityId, index });
      const city: City | undefined = this.gameEngine.cities.find(c => c.id === cityId) || (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function' ? (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId) : undefined);
      if (!city) return { success: false, reason: 'city_not_found' };

      if (!Array.isArray(city.buildQueue)) {
        return { success: false, reason: 'no_build_queue' };
      }

      const buildQueue = city.buildQueue;
      if (index < 0 || index >= buildQueue.length) {
        return { success: false, reason: 'invalid_index' };
      }

      const removed = buildQueue.splice(index, 1)[0];

      console.log('[ProductionManager] removed item from queue', { cityId, index, removed, remainingQueue: buildQueue });
      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_QUEUE_UPDATED', { cityId, removed, index });
      return { success: true, removed };
    } catch (e) {
      console.error('[ProductionManager] removeCityQueueItem error', e);
      return { success: false, reason: 'exception' };
    }
  }

  /**
   * Move an item in a city's build queue from one index to another.
   * Used by the city modal to reorder queued items (mobile-first UI).
   */
  moveCityQueueItem(cityId: string, fromIndex: number, toIndex: number): ProductionResult {
    try {
      const city: City | undefined = this.gameEngine.cities.find(c => c.id === cityId) || (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function' ? (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId) : undefined);
      if (!city) return { success: false, reason: 'city_not_found' };

      const buildQueue = city.buildQueue;
      if (!Array.isArray(buildQueue)) return { success: false, reason: 'no_build_queue' };
      if (fromIndex < 0 || fromIndex >= buildQueue.length) return { success: false, reason: 'invalid_from_index' };
      if (toIndex < 0 || toIndex >= buildQueue.length) return { success: false, reason: 'invalid_to_index' };
      if (fromIndex === toIndex) return { success: true };

      const [moved] = buildQueue.splice(fromIndex, 1);
      buildQueue.splice(toIndex, 0, moved);

      console.log('[ProductionManager] moved queue item', { cityId, fromIndex, toIndex, moved, queue: buildQueue });
      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_QUEUE_UPDATED', { cityId, fromIndex, toIndex });
      return { success: true, moved };
    } catch (e) {
      console.error('[ProductionManager] moveCityQueueItem error', e);
      return { success: false, reason: 'exception' };
    }
  }

  /**
   * Remove current production from a city
   */
  removeCurrentProduction(cityId: string): ProductionResult {
    try {
      console.log('[ProductionManager] removeCurrentProduction called', { cityId });
      const city: City | undefined = this.gameEngine.cities.find(c => c.id === cityId) || (this.gameEngine.map && typeof (this.gameEngine.map as { getCity?: (id: string) => City | undefined }).getCity === 'function' ? (this.gameEngine.map as unknown as { getCity: (id: string) => City | undefined }).getCity(cityId) : undefined);
      if (!city) return { success: false, reason: 'city_not_found' };

      const removed = city.currentProduction;
      
      // Store production progress as carried over progress
      city.carriedOverProgress = city.productionProgress || 0;
      
      // Clear current production
      city.currentProduction = null;
      city.productionProgress = 0;

      // If there's something in the queue, make it the new current production
      if (Array.isArray(city.buildQueue) && city.buildQueue.length > 0) {
        const nextItem = city.buildQueue.shift();
        city.currentProduction = nextItem;
        city.productionProgress = city.carriedOverProgress || 0;
        city.carriedOverProgress = 0;
        console.log('[ProductionManager] started next queued item as currentProduction', { cityId, currentProduction: city.currentProduction });
      }

      console.log('[ProductionManager] removed current production', { cityId, removed });
      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_PRODUCTION_CHANGED', { cityId, removed });
      return { success: true, removed };
    } catch (e) {
      console.error('[ProductionManager] removeCurrentProduction error', e);
      return { success: false, reason: 'exception' };
    }
  }
}