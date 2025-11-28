/**
 * Production Manager - Handles city production, purchasing, and queuing
 */
export class ProductionManager {
  private gameEngine: any;

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
  }

  setCityProduction(cityId: string, item: any, queue: boolean = false) {
    console.log('[ProductionManager] setCityProduction called', { cityId, item, queue });
    // Try city manager if available
    try {
      if ((this.gameEngine as any).map && (this.gameEngine as any).map.getCity) {
        const cityRaw = (this.gameEngine as any).map.getCity(cityId) || this.gameEngine.cities.find((c: any) => c.id === cityId);
          if (!cityRaw) return false;
          const city: any = cityRaw;

          // Ensure buildQueue exists on the city instance (defensive)
          if (!Array.isArray(city.buildQueue)) city.buildQueue = [];
          console.log('[ProductionManager] After buildQueue init', { cityId, buildQueue: city.buildQueue, city });

          if (queue && typeof city.queueProduction === 'function') {
            city.queueProduction(item);
            console.log('[ProductionManager] city.queueProduction executed', { cityId, buildQueue: city.buildQueue });
            // If no current production, start the first queued item with carried over progress
            if (!city.currentProduction && city.buildQueue.length > 0) {
              city.currentProduction = city.buildQueue[0];
              city.productionProgress = city.carriedOverProgress || 0;
              city.carriedOverProgress = 0;
              console.log('[ProductionManager] started queued item as currentProduction', { cityId, currentProduction: city.currentProduction, productionProgress: city.productionProgress });
            }
          } else if (!queue && typeof city.setProduction === 'function') {
            city.setProduction(item);
          } else if (queue && Array.isArray(city.buildQueue)) {
            city.buildQueue.push(item);
            console.log('[ProductionManager] pushed to city.buildQueue', { cityId, buildQueue: city.buildQueue });
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
      const cityRaw2 = this.gameEngine.cities.find(c => c.id === cityId);
      if (!cityRaw2) return { success: false, reason: 'city_not_found' };
      const city2: any = cityRaw2;

      // Ensure buildQueue exists on the fallback city
      if (!Array.isArray(city2.buildQueue)) city2.buildQueue = [];

      if (queue && Array.isArray(city2.buildQueue)) {
        city2.buildQueue.push(item);
        console.log('[ProductionManager] fallback pushed to city2.buildQueue', { cityId, buildQueue: city2.buildQueue });
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

  purchaseCityProduction(cityId: string, item: any, civId?: number) {
    try {
      console.log('[ProductionManager] purchaseCityProduction called', { cityId, item, civId });
      const city = this.gameEngine.cities.find(c => c.id === cityId) || ((this.gameEngine as any).map && (this.gameEngine as any).map.getCity(cityId));
      if (!city) return { success: false, reason: 'city_not_found' };

      // Check if city has already purchased something this turn
      if ((city as any).purchasedThisTurn && (city as any).purchasedThisTurn.length > 0) {
        return { success: false, reason: 'already_purchased_this_turn' };
      }

      // Find civilization / owner
      const civ = civId !== undefined ? this.gameEngine.civilizations[civId] : this.gameEngine.civilizations[city.civilizationId] || this.gameEngine.civilizations[city.civId] || null;
      if (!civ || !civ.resources) return { success: false, reason: 'civ_not_found' };

      const cost = item.cost || (item.shields || 0);
      if ((civ.resources.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

      // Deduct gold
      civ.resources.gold -= cost;

      // Queue the purchase for next turn instead of creating immediately
      if (!(city as any).purchasedThisTurn) (city as any).purchasedThisTurn = [];
      (city as any).purchasedThisTurn.push({
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
  removeCityQueueItem(cityId: string, index: number) {
    try {
      console.log('[ProductionManager] removeCityQueueItem called', { cityId, index });
      const city = this.gameEngine.cities.find(c => c.id === cityId) || ((this.gameEngine as any).map && (this.gameEngine as any).map.getCity(cityId));
      if (!city) return { success: false, reason: 'city_not_found' };

      if (!Array.isArray((city as any).buildQueue)) {
        return { success: false, reason: 'no_build_queue' };
      }

      const buildQueue = (city as any).buildQueue;
      if (index < 0 || index >= buildQueue.length) {
        return { success: false, reason: 'invalid_index' };
      }

      const removed = buildQueue.splice(index, 1)[0];

      // If we removed the first item in the queue (index 0), it should become the new current production
      if (index === 0 && buildQueue.length > 0) {
        const nextItem = buildQueue.shift(); // Remove from queue and use as current production
        if (nextItem) {
          (city as any).currentProduction = nextItem;
          // Keep existing production progress when switching
          console.log('[ProductionManager] started next queued item after removal', { cityId, currentProduction: (city as any).currentProduction });
        }
      } else if (index === 0 && buildQueue.length === 0) {
        // Removed the last queue item, clear current production
        console.log('[ProductionManager] cleared current production - queue is now empty');
      }

      console.log('[ProductionManager] removed item from queue', { cityId, index, removed, remainingQueue: buildQueue });
      if (this.gameEngine.onStateChange) this.gameEngine.onStateChange('CITY_QUEUE_UPDATED', { cityId, removed, index });
      return { success: true, removed };
    } catch (e) {
      console.error('[ProductionManager] removeCityQueueItem error', e);
      return { success: false, reason: 'exception' };
    }
  }

  /**
   * Remove current production from a city
   */
  removeCurrentProduction(cityId: string) {
    try {
      console.log('[ProductionManager] removeCurrentProduction called', { cityId });
      const city = this.gameEngine.cities.find(c => c.id === cityId) || ((this.gameEngine as any).map && (this.gameEngine as any).map.getCity(cityId));
      if (!city) return { success: false, reason: 'city_not_found' };

      const removed = (city as any).currentProduction;
      
      // Store production progress as carried over progress
      (city as any).carriedOverProgress = (city as any).productionProgress || 0;
      
      // Clear current production
      (city as any).currentProduction = null;
      (city as any).productionProgress = 0;

      // If there's something in the queue, make it the new current production
      if (Array.isArray((city as any).buildQueue) && (city as any).buildQueue.length > 0) {
        const nextItem = (city as any).buildQueue.shift();
        (city as any).currentProduction = nextItem;
        (city as any).productionProgress = (city as any).carriedOverProgress || 0;
        (city as any).carriedOverProgress = 0;
        console.log('[ProductionManager] started next queued item as currentProduction', { cityId, currentProduction: (city as any).currentProduction });
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