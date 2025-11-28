/**
 * AutoProduction - Automatically manages production queues for cities
 * Used by AI and can be enabled for player cities via city modal
 */

import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';

export class AutoProduction {
  private gameEngine: any;

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
  }

  /**
   * Set automatic production for a city based on its needs and current state
   */
  setAutoProduction(cityId: string): boolean {
    try {
      console.log('[AutoProduction] setAutoProduction called for city', cityId);
      
      const city = this.gameEngine.cities.find((c: any) => c.id === cityId);
      if (!city) {
        console.warn('[AutoProduction] City not found:', cityId);
        return false;
      }

      // If city already has current production, don't override it
      if (city.currentProduction) {
        console.log('[AutoProduction] City already has production:', city.currentProduction);
        return true;
      }

      // Determine what the city should produce based on its state
      const productionItem = this.determineProductionItem(city);
      
      if (productionItem) {
        console.log('[AutoProduction] Setting production item:', productionItem);
        
        // Use ProductionManager to set production
        if (this.gameEngine.productionManager) {
          const result = this.gameEngine.productionManager.setCityProduction(cityId, productionItem, false);
          return result.success || false;
        }
      }

      return false;
    } catch (e) {
      console.error('[AutoProduction] setAutoProduction error', e);
      return false;
    }
  }

  /**
   * Determine what production item a city should build
   */
  private determineProductionItem(city: any): any | null {
    // Priority order:
    // 1. Basic military unit if city has no defenders
    // 2. Essential buildings (granary, barracks)
    // 3. Worker/Settler if needed
    // 4. Military units
    // 5. Economy buildings

    // Check for city defenders
    const unitsInCity = this.gameEngine.units.filter(
      (u: any) => u.col === city.col && u.row === city.row && u.civilizationId === city.civilizationId
    );
    
    const hasDefender = unitsInCity.some((u: any) => {
      const unitProps = UNIT_PROPS[u.type];
      return unitProps && unitProps.defense > 0;
    });

    // 1. Build a defender if none exists
    if (!hasDefender) {
      console.log('[AutoProduction] City needs defender');
      return {
        type: 'unit',
        itemType: 'warrior',
        name: UNIT_PROPS.warrior.name,
        cost: UNIT_PROPS.warrior.cost
      };
    }

    // 2. Check for essential buildings
    const hasGranary = city.buildings?.some((b: any) => b === 'granary' || b.type === 'granary');
    if (!hasGranary && BUILDING_PROPS.granary) {
      console.log('[AutoProduction] City needs granary');
      return {
        type: 'building',
        itemType: 'granary',
        name: BUILDING_PROPS.granary.name,
        cost: BUILDING_PROPS.granary.cost
      };
    }

    const hasBarracks = city.buildings?.some((b: any) => b === 'barracks' || b.type === 'barracks');
    if (!hasBarracks && BUILDING_PROPS.barracks) {
      console.log('[AutoProduction] City needs barracks');
      return {
        type: 'building',
        itemType: 'barracks',
        name: BUILDING_PROPS.barracks.name,
        cost: BUILDING_PROPS.barracks.cost
      };
    }

    // 3. Build settlers if civilization has few cities
    const civCities = this.gameEngine.cities.filter((c: any) => c.civilizationId === city.civilizationId);
    if (civCities.length < 3 && city.population >= 2) {
      console.log('[AutoProduction] Civilization needs more cities');
      return {
        type: 'unit',
        itemType: 'settlers',
        name: UNIT_PROPS.settlers.name,
        cost: UNIT_PROPS.settlers.cost
      };
    }

    // 4. Build military units (default to warrior)
    console.log('[AutoProduction] Building default military unit');
    return {
      type: 'unit',
      itemType: 'warrior',
      name: UNIT_PROPS.warrior.name,
      cost: UNIT_PROPS.warrior.cost
    };
  }

  /**
   * Process auto-production for all cities belonging to a civilization
   */
  processAutoProductionForCivilization(civilizationId: number): void {
    try {
      console.log('[AutoProduction] Processing auto-production for civilization', civilizationId);
      
      const civCities = this.gameEngine.cities.filter((c: any) => c.civilizationId === civilizationId);
      
      for (const city of civCities) {
        // Only set production if city has auto-production enabled
        if ((city as any).autoProduction) {
          this.setAutoProduction(city.id);
        }
      }
    } catch (e) {
      console.error('[AutoProduction] processAutoProductionForCivilization error', e);
    }
  }

  /**
   * Process auto-production for all AI civilizations
   */
  processAutoProductionForAI(): void {
    try {
      console.log('[AutoProduction] Processing auto-production for all AI');
      
      const aiCivilizations = this.gameEngine.civilizations.filter(
        (civ: any) => civ.isAI || civ.id !== 0
      );
      
      for (const civ of aiCivilizations) {
        this.processAutoProductionForCivilization(civ.id);
      }
    } catch (e) {
      console.error('[AutoProduction] processAutoProductionForAI error', e);
    }
  }
}
