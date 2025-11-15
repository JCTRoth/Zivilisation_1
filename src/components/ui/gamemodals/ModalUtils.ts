/// <reference types="vite/client" />

import { UNIT_PROPS } from '../../../utils/constants';
import { BUILDING_PROPERTIES } from '../../../utils/buildingConstants';

// Shared utilities for modal logic
export class ModalUtils {
  static capitalizeName(value?: string | null): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  static getProductionPerTurn(city: any): number {
    if (!city) return 0;
    if (typeof city?.yields?.production === 'number') return city.yields.production;
    if (typeof city?.production === 'number') return city.production;
    if (typeof city?.output?.production === 'number') return city.output.production;
    return 0;
  }

  static getProductionProgressValue(city: any): number {
    if (!city) return 0;
    // Prefer productionProgress for progress (used in original code)
    if (typeof city?.productionProgress === 'number') return city.productionProgress;
    if (typeof city?.productionStored === 'number') return city.productionStored;
    if (typeof city?.shields === 'number') return city.shields;
    return 0;
  }

  static getProductionCost(item: any): number {
    if (!item) return 0;
    if (typeof item === 'number') return item;
    if (typeof item === 'string') {
      const normalizedKey = ModalUtils.normalizeUnitKey(item);
      const unitDef = UNIT_PROPS[normalizedKey];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
      return 0;
    }
    if (typeof item.cost === 'number') return item.cost;
    if (item.itemType) {
      const normalizedKey = ModalUtils.normalizeUnitKey(item.itemType);
      const unitDef = UNIT_PROPS[normalizedKey];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item.itemType];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.type) {
      const buildingDef = BUILDING_PROPERTIES[item.type];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.name && typeof item.name === 'string') {
      // Try to find by name (case insensitive)
      const normalizedName = item.name.toLowerCase().replace(/\s+/g, '_');
      const buildingDef = BUILDING_PROPERTIES[normalizedName];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
      // Try units by name
      const unitKey = Object.keys(UNIT_PROPS).find(key => UNIT_PROPS[key].name.toLowerCase() === item.name.toLowerCase());
      if (unitKey) return UNIT_PROPS[unitKey].cost;
    }
    return 0;
  }

  static getProductionName(item: any): string {
    if (!item) return 'Unknown';
    if (typeof item === 'string') {
      const normalizedKey = ModalUtils.normalizeUnitKey(item);
      return UNIT_PROPS[normalizedKey]?.name || BUILDING_PROPERTIES[item]?.name || ModalUtils.capitalizeName(item);
    }
    if (item.name) return item.name;
    if (item.itemType) {
      const normalizedKey = ModalUtils.normalizeUnitKey(item.itemType);
      return UNIT_PROPS[normalizedKey]?.name || BUILDING_PROPERTIES[item.itemType]?.name || ModalUtils.capitalizeName(item.itemType);
    }
    if (item.type) {
      return BUILDING_PROPERTIES[item.type]?.name || ModalUtils.capitalizeName(item.type);
    }
    return 'Unknown';
  }

  static getTurnsRemaining(productionProgress: number, productionCost: number, productionPerTurn: number): number | null {
    if (productionCost <= 0 || productionPerTurn <= 0) return null;
    const remaining = productionCost - productionProgress;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / productionPerTurn);
  }

  static formatTurns(value: number | null): string {
    if (value === null) return '—';
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return value.toString();
  }

  static normalizeUnitKey(key: string): string {
    // Handle legacy mappings
    const legacyMap: Record<string, string> = {
      'militia': 'warrior',
      'phalang': 'archer', // assuming typo
      // Add other mappings as needed
    };
    return legacyMap[key] || key;
  }
}